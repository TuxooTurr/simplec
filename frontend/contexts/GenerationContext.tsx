"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { getGenSession, listGenSessions, type GenSession } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

export type GenerationState = "idle" | "generating" | "done" | "error";

export interface Step {
  action: string;
  test_data: string;
  ui: string;
  api: string;
  db: string;
}

export interface Case {
  name: string;
  priority: string;
  case_type: string;
  steps: Step[];
}

export interface GenEvent {
  type: string;
  layer?: number;
  name?: string;
  elapsed?: number;
  message?: string;
  count?: number;
  llm_error?: boolean;
}

export interface Progress {
  current: number;
  total: number;
  name: string;
}

export interface ExportResult {
  xml: string;
  csv: string;
  md: string;
}

export interface ExportParams {
  cases: Case[];
  qa_doc: string;
  project?: string;
  system?: string;
  team?: string;
  domain?: string;
  folder?: string;
  use_llm?: boolean;
  provider: string;
  crit_regress?: boolean;
  session_id?: string;
}

// ── Context interface ────────────────────────────────────────────────────────

interface GenerationCtx {
  state: GenerationState;
  events: GenEvent[];
  progress: Progress | null;
  cases: Case[];
  qaDoc: string;
  exportResult: ExportResult | null;
  exporting: boolean;
  sessionId: string | null;
  wsConnected: boolean;
  start: (params: {
    requirement: string;
    feature: string;
    depth: string;
    provider: string;
    platform: string;
  }) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  exportCases: (params: ExportParams) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  attachToSession: (sessionId: string) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8000/api/ws/generation";
  const wsBase =
    process.env.NEXT_PUBLIC_WS_URL ||
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return `${wsBase}/api/ws/generation`;
}

// ── Context ──────────────────────────────────────────────────────────────────

const GenerationContext = createContext<GenerationCtx>({
  state: "idle",
  events: [],
  progress: null,
  cases: [],
  qaDoc: "",
  exportResult: null,
  exporting: false,
  sessionId: null,
  wsConnected: false,
  start: async () => {},
  resume: async () => {},
  exportCases: async () => {},
  cancel: () => {},
  reset: () => {},
  attachToSession: async () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GenerationState>("idle");
  const [events, setEvents] = useState<GenEvent[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [qaDoc, setQaDoc] = useState("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initCheckedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  // Keep ref in sync with state for use in closures
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // ── Stop polling ─────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Restore state from a server session ──────────────────────────
  const restoreFromSession = useCallback((session: GenSession) => {
    setSessionId(session.id);
    if (session.qa_doc) setQaDoc(session.qa_doc);
    if (session.cases?.length) setCases(session.cases as Case[]);
    if (session.export_result) setExportResult(session.export_result as ExportResult);

    if (session.status === "done") {
      setState("done");
      setProgress(null);
    } else if (session.status === "error" || session.status === "cancelled") {
      setState("error");
      setProgress(null);
      if (session.error) {
        setEvents(prev => [...prev, {
          type: "error",
          message: session.error!,
          llm_error: session.error_is_llm,
        }]);
      }
    } else if (session.status === "generating") {
      setState("generating");
      if (session.layer3_progress) {
        setProgress({
          current: session.layer3_progress.current,
          total: session.layer3_progress.total,
          name: session.layer3_progress.name,
        });
      }
    }
  }, []);

  // ── Poll a session via REST (when WS is not connected) ───────────
  const startPolling = useCallback((sid: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const session = await getGenSession(sid);
        if (session.qa_doc) setQaDoc(session.qa_doc);
        if (session.cases?.length) setCases(session.cases as Case[]);

        if (session.layer3_progress) {
          setProgress({
            current: session.layer3_progress.current,
            total: session.layer3_progress.total,
            name: session.layer3_progress.name,
          });
        }

        if (session.status === "done") {
          setState("done");
          setProgress(null);
          if (session.export_result) setExportResult(session.export_result as ExportResult);
          stopPolling();
        } else if (session.status === "error" || session.status === "cancelled") {
          setState("error");
          setProgress(null);
          if (session.error) {
            setEvents(prev => {
              if (prev.some(e => e.message === session.error)) return prev;
              return [...prev, { type: "error", message: session.error!, llm_error: session.error_is_llm }];
            });
          }
          stopPolling();
        }
      } catch {
        // network error — keep polling
      }
    }, 3000);
  }, [stopPolling]);

  // ── WS message handler ───────────────────────────────────────────
  const handleWsMessage = useCallback((msg: Record<string, unknown>) => {
    switch (msg.type) {
      case "session_created":
        setSessionId(msg.session_id as string);
        break;

      case "session_state": {
        const status = msg.status as string;
        if (msg.qa_doc) setQaDoc(msg.qa_doc as string);
        if ((msg.cases as unknown[])?.length) setCases(msg.cases as Case[]);
        if (msg.export_result) setExportResult(msg.export_result as ExportResult);

        if (status === "done") {
          setState("done");
          setProgress(null);
        } else if (status === "error" || status === "cancelled") {
          setState("error");
          setProgress(null);
          if (msg.error) {
            setEvents(prev => [...prev, {
              type: "error",
              message: msg.error as string,
              llm_error: msg.error_is_llm as boolean,
            }]);
          }
        } else if (status === "generating") {
          setState("generating");
          if (msg.layer3_progress) {
            const p = msg.layer3_progress as { current: number; total: number; name: string };
            setProgress({ current: p.current, total: p.total, name: p.name });
          }
        }
        break;
      }

      case "layer_start":
        setEvents(prev => [...prev, {
          type: "layer_start", layer: msg.layer as number, name: msg.name as string,
        }]);
        break;

      case "layer_done":
        setEvents(prev => [...prev, {
          type: "layer_done",
          layer: msg.layer as number,
          elapsed: msg.elapsed as number,
          count: (msg.data as Record<string, unknown>)?.count as number | undefined,
        }]);
        if (msg.layer === 1 && (msg.data as Record<string, unknown>)?.qa_doc) {
          setQaDoc((msg.data as Record<string, unknown>).qa_doc as string);
        }
        break;

      case "case_start":
        setProgress({
          current: msg.i as number,
          total: msg.total as number,
          name: msg.name as string,
        });
        break;

      case "case_done":
        setCases(prev => [...prev, msg.case as Case]);
        break;

      case "generation_done":
        setState("done");
        setProgress(null);
        if (msg.qa_doc) setQaDoc(msg.qa_doc as string);
        if (msg.session_id) setSessionId(msg.session_id as string);
        break;

      case "export_done":
        setExportResult({
          xml: msg.xml as string,
          csv: msg.csv as string,
          md: msg.md as string,
        });
        setExporting(false);
        break;

      case "error":
        setState("error");
        setProgress(null);
        setEvents(prev => [...prev, {
          type: "error",
          message: msg.message as string,
          llm_error: (msg.llm_error ?? false) as boolean,
        }]);
        setExporting(false);
        break;
    }
  }, []);

  // ── Auto-reconnect WS when generating ─────────────────────────────
  const scheduleReconnect = useCallback((sid: string) => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      const currentWs = wsRef.current;
      if (currentWs && currentWs.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(getWsUrl());
      ws.onopen = () => {
        wsRef.current = ws;
        setWsConnected(true);
        stopPolling();
        ws.send(JSON.stringify({ action: "attach", session_id: sid }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        handleWsMessage(msg);
      };
      ws.onclose = () => {
        wsRef.current = null;
        setWsConnected(false);
        const currentSid = sessionIdRef.current;
        if (currentSid) {
          startPolling(currentSid);
          scheduleReconnect(currentSid);
        }
      };
      ws.onerror = () => { /* onclose will fire */ };
    }, 5000);
  }, [handleWsMessage, startPolling, stopPolling]);

  // ── Get / create WS ──────────────────────────────────────────────
  const getWs = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const existing = wsRef.current;
      if (existing && existing.readyState === WebSocket.OPEN) {
        resolve(existing);
        return;
      }
      const ws = new WebSocket(getWsUrl());
      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      ws.onopen = () => {
        setWsConnected(true);
        resolve(ws);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        handleWsMessage(msg);
      };
      ws.onclose = () => {
        wsRef.current = null;
        setWsConnected(false);
        const sid = sessionIdRef.current;
        if (sid) {
          startPolling(sid);
          scheduleReconnect(sid);
        }
      };
      wsRef.current = ws;
    });
  }, [handleWsMessage, startPolling, scheduleReconnect]);

  // ── Start new generation ─────────────────────────────────────────
  const start = useCallback(
    async (params: {
      requirement: string;
      feature: string;
      depth: string;
      provider: string;
      platform: string;
    }) => {
      setState("generating");
      setEvents([]);
      setProgress(null);
      setCases([]);
      setQaDoc("");
      setExportResult(null);
      setSessionId(null);
      stopPolling();

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      try {
        const ws = await getWs();
        ws.send(JSON.stringify({ action: "start", ...params }));
      } catch (err) {
        setState("error");
        setEvents(prev => [...prev, { type: "error", message: String(err) }]);
      }
    },
    [getWs, stopPolling],
  );

  // ── Resume errored session ───────────────────────────────────────
  const resume = useCallback(
    async (sid: string) => {
      setState("generating");
      setEvents([]);
      setProgress(null);
      stopPolling();

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      try {
        const ws = await getWs();
        ws.send(JSON.stringify({ action: "resume", session_id: sid }));
      } catch (err) {
        setState("error");
        setEvents(prev => [...prev, { type: "error", message: String(err) }]);
      }
    },
    [getWs, stopPolling],
  );

  // ── Attach to existing session ───────────────────────────────────
  const attachToSession = useCallback(
    async (sid: string) => {
      setSessionId(sid);
      stopPolling();

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      try {
        const ws = await getWs();
        ws.send(JSON.stringify({ action: "attach", session_id: sid }));
      } catch {
        // WS failed — fall back to REST polling
        try {
          const session = await getGenSession(sid);
          restoreFromSession(session);
          if (session.status === "generating") {
            startPolling(sid);
          }
        } catch {
          // ignore
        }
      }
    },
    [getWs, stopPolling, startPolling, restoreFromSession],
  );

  // ── Export ────────────────────────────────────────────────────────
  const exportCases = useCallback(
    async (params: ExportParams) => {
      setExporting(true);
      setExportResult(null);
      try {
        const ws = await getWs();
        ws.send(JSON.stringify({
          action: "export",
          ...params,
          session_id: params.session_id ?? sessionId,
        }));
      } catch (err) {
        setEvents(prev => [...prev, { type: "error", message: String(err) }]);
        setExporting(false);
      }
    },
    [getWs, sessionId],
  );

  // ── Cancel ───────────────────────────────────────────────────────
  const cancel = useCallback(() => {
    stopPolling();
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    setState("error");
    setProgress(null);
    setEvents(prev => [...prev, {
      type: "error", message: "Генерация отменена пользователем", llm_error: false,
    }]);
  }, [stopPolling]);

  // ── Reset ────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    stopPolling();
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    setState("idle");
    setEvents([]);
    setProgress(null);
    setCases([]);
    setQaDoc("");
    setExportResult(null);
    setSessionId(null);
  }, [stopPolling]);

  // ── On mount: check for active server session ────────────────────
  useEffect(() => {
    if (initCheckedRef.current) return;
    initCheckedRef.current = true;

    (async () => {
      try {
        const active = await listGenSessions({ status: "generating", limit: 1 });
        if (active.length > 0) {
          const sid = active[0].id;
          const session = await getGenSession(sid);
          restoreFromSession(session);
          if (session.status === "generating") {
            // Try WS first, fall back to polling
            try {
              const ws = await getWs();
              ws.send(JSON.stringify({ action: "attach", session_id: sid }));
            } catch {
              startPolling(sid);
            }
          }
        }
      } catch {
        // backend not available — ok
      }
    })();

    return () => {
      stopPolling();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GenerationContext.Provider
      value={{
        state, events, progress, cases, qaDoc, exportResult, exporting,
        sessionId, wsConnected, start, resume, exportCases, cancel, reset, attachToSession,
      }}
    >
      {children}
    </GenerationContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGeneration() {
  return useContext(GenerationContext);
}
