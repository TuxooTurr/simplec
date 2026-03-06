"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";

// ── Types (re-exported so consumers can import from here or from useGeneration.ts) ──

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
  provider?: string;
}

// ── Context interface ─────────────────────────────────────────────────────────

interface GenerationCtx {
  state: GenerationState;
  events: GenEvent[];
  progress: Progress | null;
  cases: Case[];
  qaDoc: string;
  exportResult: ExportResult | null;
  exporting: boolean;
  start: (params: {
    requirement: string;
    feature: string;
    depth: string;
    provider: string;
    platform: string;
  }) => Promise<void>;
  exportCases: (params: ExportParams) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8000/api/ws/generation";
  const wsBase =
    process.env.NEXT_PUBLIC_WS_URL ||
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return `${wsBase}/api/ws/generation`;
}

// ── Context ───────────────────────────────────────────────────────────────────

const GenerationContext = createContext<GenerationCtx>({
  state: "idle",
  events: [],
  progress: null,
  cases: [],
  qaDoc: "",
  exportResult: null,
  exporting: false,
  start: async () => {},
  exportCases: async () => {},
  cancel: () => {},
  reset: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GenerationState>("idle");
  const [events, setEvents] = useState<GenEvent[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [qaDoc, setQaDoc] = useState("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const getWs = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const existing = wsRef.current;
      if (existing && existing.readyState === WebSocket.OPEN) {
        resolve(existing);
        return;
      }
      const ws = new WebSocket(getWsUrl());
      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      ws.onopen = () => resolve(ws);
      wsRef.current = ws;
    });
  }, []);

  const addEvent = useCallback((ev: GenEvent) => {
    setEvents((prev) => [...prev, ev]);
  }, []);

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

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      try {
        const ws = await getWs();

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string);

          switch (msg.type) {
            case "layer_start":
              addEvent({ type: "layer_start", layer: msg.layer, name: msg.name });
              break;
            case "layer_done":
              addEvent({
                type: "layer_done",
                layer: msg.layer,
                elapsed: msg.elapsed,
                count: msg.data?.count,
              });
              if (msg.layer === 1 && msg.data?.qa_doc) {
                setQaDoc(msg.data.qa_doc);
              }
              break;
            case "case_start":
              setProgress({ current: msg.i, total: msg.total, name: msg.name });
              break;
            case "case_done":
              setCases((prev) => [...prev, msg.case as Case]);
              break;
            case "generation_done":
              setState("done");
              setProgress(null);
              if (msg.qa_doc) setQaDoc(msg.qa_doc);
              break;
            case "export_done":
              setExportResult({ xml: msg.xml, csv: msg.csv, md: msg.md });
              break;
            case "error":
              setState("error");
              setProgress(null);
              addEvent({ type: "error", message: msg.message, llm_error: msg.llm_error ?? false });
              break;
          }
        };

        ws.onerror = () => {
          setState("error");
          addEvent({ type: "error", message: "WebSocket connection error" });
        };

        ws.send(JSON.stringify({ action: "start", ...params }));
      } catch (err) {
        setState("error");
        addEvent({ type: "error", message: String(err) });
      }
    },
    [getWs, addEvent]
  );

  const exportCases = useCallback(
    async (params: ExportParams) => {
      setExporting(true);
      setExportResult(null);
      try {
        const ws = await getWs();
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "export_done") {
            setExportResult({ xml: msg.xml, csv: msg.csv, md: msg.md });
            setExporting(false);
          } else if (msg.type === "error") {
            addEvent({ type: "error", message: msg.message, llm_error: msg.llm_error ?? false });
            setExporting(false);
          }
        };
        ws.send(JSON.stringify({ action: "export", ...params }));
      } catch (err) {
        addEvent({ type: "error", message: String(err) });
        setExporting(false);
      }
    },
    [getWs, addEvent]
  );

  const cancel = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState("error");
    setProgress(null);
    addEvent({ type: "error", message: "Генерация отменена пользователем", llm_error: false });
  }, [addEvent]);

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState("idle");
    setEvents([]);
    setProgress(null);
    setCases([]);
    setQaDoc("");
    setExportResult(null);
  }, []);

  return (
    <GenerationContext.Provider
      value={{ state, events, progress, cases, qaDoc, exportResult, exporting, start, exportCases, cancel, reset }}
    >
      {children}
    </GenerationContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGeneration() {
  return useContext(GenerationContext);
}
