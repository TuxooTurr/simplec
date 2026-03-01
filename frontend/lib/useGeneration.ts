"use client";

import { useState, useRef, useCallback } from "react";

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

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8000/api/ws/generation";
  const wsBase =
    process.env.NEXT_PUBLIC_WS_URL ||
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return `${wsBase}/api/ws/generation`;
}

export function useGeneration() {
  const [state, setState] = useState<GenerationState>("idle");
  const [events, setEvents] = useState<GenEvent[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [qaDoc, setQaDoc] = useState("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
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
      // Reset state
      setState("generating");
      setEvents([]);
      setProgress(null);
      setCases([]);
      setQaDoc("");
      setExportResult(null);

      // Close old connection
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
              addEvent({ type: "error", message: msg.message });
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
      try {
        const ws = await getWs();
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "export_done") {
            setExportResult({ xml: msg.xml, csv: msg.csv, md: msg.md });
          } else if (msg.type === "error") {
            addEvent({ type: "error", message: msg.message });
          }
        };
        ws.send(JSON.stringify({ action: "export", ...params }));
      } catch (err) {
        addEvent({ type: "error", message: String(err) });
      }
    },
    [getWs, addEvent]
  );

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

  return { state, events, progress, cases, qaDoc, start, exportCases, exportResult, reset };
}
