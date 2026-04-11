"use client";

/**
 * AlertsSchedulerContext
 *
 * Управляет состоянием Jupyter-ядра и планировщика для алертов.
 * Выживает между навигациями (провайдер выше страниц).
 *
 * Логика выполнения:
 *  1. connect()  → POST /api/kernel/start/{id}  — запустить ядро
 *  2. execute()  → выполнить init-ячейки (если не выполнялись или params изменились)
 *                → выполнить loop-ячейки на каждом тике
 *  3. disconnect → DELETE /api/kernel/stop/{id}
 */

import {
  createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode,
} from "react";
import {
  getAlertScripts, kernelStart, kernelStop, kernelExecute,
  type AlertScript, type NotebookCell, type DynamicParam,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutputLine {
  ts:    string;
  kind:  "stdout" | "error" | "system";
  text:  string;
}

interface AlertsSchedulerCtx {
  // Data
  scripts:    AlertScript[];
  setScripts: React.Dispatch<React.SetStateAction<AlertScript[]>>;
  loadErr:    string;

  // Selection + params
  selectedId:    string | null;
  setSelectedId: (id: string | null) => void;
  values:        Record<string, string>;   // param.id → user value
  setValues:     React.Dispatch<React.SetStateAction<Record<string, string>>>;

  // Kernel
  kernelAlive:      boolean;
  kernelConnecting: boolean;
  connectKernel:    () => Promise<void>;
  disconnectKernel: () => Promise<void>;

  // Execution
  executing:  boolean;
  output:     OutputLine[];
  clearOutput: () => void;

  // Scheduler
  schedMode:    "once" | "periodic";
  setSchedMode: (m: "once" | "periodic") => void;
  schedFreq:    number;
  setSchedFreq: (n: number) => void;
  schedFrom:    string;
  setSchedFrom: (s: string) => void;
  schedTo:      string;
  setSchedTo:   (s: string) => void;
  schedActive:  boolean;
  schedCount:   number;

  doExecuteCore:  () => Promise<void>;
  startSchedule:  (freqSecs: number) => void;
  stopSchedule:   () => void;
}

const Ctx = createContext<AlertsSchedulerCtx>({
  scripts: [], setScripts: () => {}, loadErr: "",
  selectedId: null, setSelectedId: () => {},
  values: {}, setValues: () => {},
  kernelAlive: false, kernelConnecting: false,
  connectKernel: async () => {}, disconnectKernel: async () => {},
  executing: false, output: [], clearOutput: () => {},
  schedMode: "once", setSchedMode: () => {},
  schedFreq: 30, setSchedFreq: () => {},
  schedFrom: "", setSchedFrom: () => {},
  schedTo: "", setSchedTo: () => {},
  schedActive: false, schedCount: 0,
  doExecuteCore: async () => {}, startSchedule: () => {}, stopSchedule: () => {},
});

// ── Helper ────────────────────────────────────────────────────────────────────

function applyParams(source: string, params: DynamicParam[], values: Record<string, string>) {
  let s = source;
  for (const p of params) {
    if (p.placeholder) s = s.replaceAll(p.placeholder, values[p.id] ?? p.placeholder);
  }
  return s;
}

function cellIsInit(c: NotebookCell) { return c.type === "init" || c.type === "code"; }
function cellIsLoop(c: NotebookCell) { return c.type === "loop"; }

// ── Provider ──────────────────────────────────────────────────────────────────

export function AlertsSchedulerProvider({ children }: { children: ReactNode }) {
  const [scripts,          setScripts]         = useState<AlertScript[]>([]);
  const [loadErr,          setLoadErr]         = useState("");
  const [selectedIdState,  setSelectedIdState] = useState<string | null>(null);
  const [values,           setValues]          = useState<Record<string, string>>({});
  const [kernelAlive,      setKernelAlive]     = useState(false);
  const [kernelConnecting, setKernelConnecting]= useState(false);
  const [executing,        setExecuting]       = useState(false);
  const [output,           setOutput]          = useState<OutputLine[]>([]);
  const [schedMode,        setSchedModeState]  = useState<"once" | "periodic">("once");
  const [schedFreq,        setSchedFreqState]  = useState(30);
  const [schedFrom,        setSchedFromState]  = useState("");
  const [schedTo,          setSchedToState]    = useState("");
  const [schedActive,      setSchedActive]     = useState(false);
  const [schedCount,       setSchedCount]      = useState(0);

  // Refs for stale-closure safety
  const selectedIdRef  = useRef<string | null>(null);
  const scriptsRef     = useRef<AlertScript[]>([]);
  const valuesRef      = useRef<Record<string, string>>({});
  const prevValuesRef  = useRef<Record<string, string>>({});  // last executed values
  const initDoneRef    = useRef(false);                        // init cells executed at least once
  const executingRef   = useRef(false);
  const schedActiveRef = useRef(false);
  const schedFromRef   = useRef("");
  const schedToRef     = useRef("");
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { scriptsRef.current    = scripts; },       [scripts]);
  useEffect(() => { valuesRef.current     = values; },        [values]);
  useEffect(() => { schedFromRef.current  = schedFrom; },     [schedFrom]);
  useEffect(() => { schedToRef.current    = schedTo; },       [schedTo]);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    selectedIdRef.current = id;
    // reset init-done when switching alerts
    initDoneRef.current = false;
    prevValuesRef.current = {};
  }, []);

  const setSchedMode = useCallback((m: "once" | "periodic") => setSchedModeState(m), []);
  const setSchedFreq = useCallback((n: number)               => setSchedFreqState(n), []);
  const setSchedFrom = useCallback((s: string) => { setSchedFromState(s); schedFromRef.current = s; }, []);
  const setSchedTo   = useCallback((s: string) => { setSchedToState(s);   schedToRef.current   = s; }, []);

  // Load scripts on mount
  useEffect(() => {
    getAlertScripts()
      .then(data => {
        setScripts(data);
        if (data.length > 0) {
          const s = data[0];
          selectedIdRef.current = s.id;
          setSelectedIdState(s.id);
          const v: Record<string, string> = {};
          for (const p of s.dynamic_params) v[p.id] = p.placeholder;
          setValues(v);
        }
      })
      .catch(e => setLoadErr(String(e)));
  }, []);

  // ── Output helpers ──────────────────────────────────────────────────────────

  const pushOutput = useCallback((kind: OutputLine["kind"], text: string) => {
    const line: OutputLine = { ts: new Date().toLocaleTimeString("ru-RU"), kind, text };
    setOutput(prev => [...prev.slice(-199), line]);  // keep last 200 lines
  }, []);

  const clearOutput = useCallback(() => setOutput([]), []);

  // ── Kernel ──────────────────────────────────────────────────────────────────

  const connectKernel = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    setKernelConnecting(true);
    pushOutput("system", "Подключение к ядру Python...");
    try {
      const res = await kernelStart(sid);
      setKernelAlive(true);
      initDoneRef.current = false;
      prevValuesRef.current = {};
      pushOutput("system", res.status === "already_running"
        ? `Ядро уже запущено (${res.kernel_id})`
        : `Ядро запущено (${res.kernel_id})`);
    } catch (e) {
      pushOutput("error", `Ошибка подключения: ${e}`);
    } finally {
      setKernelConnecting(false);
    }
  }, [pushOutput]);

  const disconnectKernel = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    // stop scheduler if running
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    schedActiveRef.current = false;
    setSchedActive(false);
    try {
      await kernelStop(sid);
    } catch (_) {}
    setKernelAlive(false);
    initDoneRef.current = false;
    pushOutput("system", "Ядро остановлено.");
  }, [pushOutput]);

  // ── Execute ─────────────────────────────────────────────────────────────────

  const doExecuteCore = useCallback(async () => {
    const sid = selectedIdRef.current;
    const sel = scriptsRef.current.find(s => s.id === sid);
    if (!sel || executingRef.current) return;

    executingRef.current = true;
    setExecuting(true);

    const vals   = valuesRef.current;
    const params = sel.dynamic_params;
    const cells  = sel.notebook ?? [];

    // Проверяем изменились ли params с прошлого запуска init
    const paramsChanged = !initDoneRef.current ||
      params.some(p => (vals[p.id] ?? p.placeholder) !== (prevValuesRef.current[p.id] ?? p.placeholder));

    // Запускаем init-ячейки если нужно
    if (paramsChanged) {
      const initCells = cells.filter(cellIsInit);
      if (initCells.length > 0) {
        pushOutput("system", `▶ Init-ячейки (${initCells.length})...`);
        for (const cell of initCells) {
          if (!cell.source.trim()) continue;
          const code = applyParams(cell.source, params, vals);
          try {
            const res = await kernelExecute(sid, code, 60);
            if (res.output) pushOutput("stdout", res.output);
            if (res.error)  pushOutput("error",  res.error);
          } catch (e) {
            pushOutput("error", `Init error: ${e}`);
          }
        }
        // Запомнить выполненные значения
        const snapshot: Record<string, string> = {};
        for (const p of params) snapshot[p.id] = vals[p.id] ?? p.placeholder;
        prevValuesRef.current = snapshot;
        initDoneRef.current = true;
      } else {
        initDoneRef.current = true;
        prevValuesRef.current = { ...vals };
      }
    }

    // Запускаем loop-ячейки
    const loopCells = cells.filter(cellIsLoop);
    if (loopCells.length > 0) {
      for (const cell of loopCells) {
        if (!cell.source.trim()) continue;
        const code = applyParams(cell.source, params, vals);
        try {
          const res = await kernelExecute(sid, code, 60);
          if (res.output) pushOutput("stdout", res.output);
          if (res.error)  pushOutput("error",  res.error);
        } catch (e) {
          pushOutput("error", `Loop error: ${e}`);
        }
      }
    } else if (initDoneRef.current) {
      // No loop cells — just confirm init ran
    }

    executingRef.current = false;
    setExecuting(false);
  }, [pushOutput]);

  // ── Scheduler ───────────────────────────────────────────────────────────────

  const stopSchedule = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    schedActiveRef.current = false;
    setSchedActive(false);
  }, []);

  const startSchedule = useCallback((freqSecs: number) => {
    stopSchedule();
    let count = 0;
    setSchedCount(0);
    schedActiveRef.current = true;
    setSchedActive(true);

    const tick = async () => {
      if (!schedActiveRef.current) return;
      const now  = new Date();
      const from = schedFromRef.current;
      const to   = schedToRef.current;
      if (from && now < new Date(from)) return;
      if (to   && now > new Date(to))   { stopSchedule(); return; }
      await doExecuteCore();
      count++;
      setSchedCount(count);
    };

    tick();
    timerRef.current = setInterval(tick, freqSecs * 1000);
  }, [stopSchedule, doExecuteCore]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const selectedId = selectedIdState;

  return (
    <Ctx.Provider value={{
      scripts, setScripts, loadErr,
      selectedId, setSelectedId,
      values, setValues,
      kernelAlive, kernelConnecting,
      connectKernel, disconnectKernel,
      executing, output, clearOutput,
      schedMode, setSchedMode,
      schedFreq, setSchedFreq,
      schedFrom, setSchedFrom,
      schedTo, setSchedTo,
      schedActive, schedCount,
      doExecuteCore, startSchedule, stopSchedule,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAlertsScheduler() {
  return useContext(Ctx);
}
