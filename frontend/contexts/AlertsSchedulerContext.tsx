"use client";

/**
 * AlertsSchedulerContext
 *
 * Per-script sessions: each alert keeps its own kernel, output,
 * scheduler, and param values. Switching alerts preserves running
 * schedulers and kernels in the background.
 */

import {
  createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode,
} from "react";
import {
  getAlertScripts, getAlertFolders, kernelStart, kernelStop, kernelExecute, kernelStatus,
  type AlertScript, type AlertFolder, type NotebookCell, type DynamicParam,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutputLine {
  ts:    string;
  kind:  "stdout" | "error" | "system";
  text:  string;
}

export interface ScriptSession {
  kernelAlive:      boolean;
  kernelConnecting: boolean;
  /** Epoch ms — когда подключилось текущее ядро (для отображения времени работы) */
  kernelStartedAt?: number;
  executing:        boolean;
  output:           OutputLine[];
  schedMode:        "once" | "periodic";
  schedFreq:        number;
  schedFrom:        string;
  schedTo:          string;
  schedActive:      boolean;
  /** Epoch ms — когда стартовал текущий планировщик (для отображения времени работы) */
  schedStartedAt?: number;
  schedCount:       number;
  values:           Record<string, string>;
}

interface AlertsSchedulerCtx {
  scripts:    AlertScript[];
  setScripts: React.Dispatch<React.SetStateAction<AlertScript[]>>;
  folders:    AlertFolder[];
  setFolders: React.Dispatch<React.SetStateAction<AlertFolder[]>>;
  loadErr:    string;

  selectedId:    string | null;
  setSelectedId: (id: string | null) => void;

  sessions: Record<string, ScriptSession>;

  values:           Record<string, string>;
  setValues:        React.Dispatch<React.SetStateAction<Record<string, string>>>;
  kernelAlive:      boolean;
  kernelConnecting: boolean;
  connectKernel:    () => Promise<void>;
  disconnectKernel: () => Promise<void>;
  connectKernelFor:    (scriptId: string) => Promise<void>;
  disconnectKernelFor: (scriptId: string) => Promise<void>;
  executing:        boolean;
  output:           OutputLine[];
  clearOutput:      () => void;
  schedMode:        "once" | "periodic";
  setSchedMode:     (m: "once" | "periodic") => void;
  schedFreq:        number;
  setSchedFreq:     (n: number) => void;
  schedFrom:        string;
  setSchedFrom:     (s: string) => void;
  schedTo:          string;
  setSchedTo:       (s: string) => void;
  schedActive:      boolean;
  schedCount:       number;
  doExecuteCore:    () => Promise<void>;
  startSchedule:    (freqSecs: number) => void;
  stopSchedule:     () => void;
  stopScheduleFor:  (scriptId: string) => void;
  /** Запустить все скрипты в папке: подключить ядра + выполнить параллельно */
  runFolderScripts: (folderId: string) => Promise<void>;
}

const EMPTY: ScriptSession = {
  kernelAlive: false, kernelConnecting: false, executing: false,
  output: [], schedMode: "once", schedFreq: 30, schedFrom: "", schedTo: "",
  schedActive: false, schedCount: 0, values: {},
};

const Ctx = createContext<AlertsSchedulerCtx>({
  scripts: [], setScripts: () => {}, folders: [], setFolders: () => {}, loadErr: "",
  selectedId: null, setSelectedId: () => {},
  sessions: {},
  values: {}, setValues: () => {},
  kernelAlive: false, kernelConnecting: false,
  connectKernel: async () => {}, disconnectKernel: async () => {},
  connectKernelFor: async () => {}, disconnectKernelFor: async () => {},
  executing: false, output: [], clearOutput: () => {},
  schedMode: "once", setSchedMode: () => {},
  schedFreq: 30, setSchedFreq: () => {},
  schedFrom: "", setSchedFrom: () => {},
  schedTo: "", setSchedTo: () => {},
  schedActive: false, schedCount: 0,
  doExecuteCore: async () => {}, startSchedule: () => {}, stopSchedule: () => {},
  stopScheduleFor: () => {},
  runFolderScripts: async () => {},
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyParams(source: string, params: DynamicParam[], values: Record<string, string>) {
  let s = source;
  for (const p of params) {
    if (p.placeholder) s = s.replaceAll(p.placeholder, values[p.id] ?? p.placeholder);
  }
  return s;
}

function cellIsInit(c: NotebookCell) { return c.type === "init" || c.type === "code"; }
function cellIsLoop(c: NotebookCell) { return c.type === "loop"; }

function defaultValues(params: DynamicParam[]): Record<string, string> {
  const v: Record<string, string> = {};
  for (const p of params) v[p.id] = p.placeholder;
  return v;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AlertsSchedulerProvider({ children }: { children: ReactNode }) {
  const [scripts,         setScripts]         = useState<AlertScript[]>([]);
  const [folders,         setFolders]         = useState<AlertFolder[]>([]);
  const [loadErr,         setLoadErr]         = useState("");
  const [selectedIdState, setSelectedIdState] = useState<string | null>(null);
  const [sessions,        _setSessions]       = useState<Record<string, ScriptSession>>({});

  const selectedIdRef  = useRef<string | null>(null);
  const scriptsRef     = useRef<AlertScript[]>([]);
  const sessionsRef    = useRef<Record<string, ScriptSession>>({});
  const executingLocks = useRef<Set<string>>(new Set());

  // Internal per-script state (timers, init tracking — no re-renders)
  const internals = useRef<Record<string, {
    initDone:   boolean;
    prevValues: Record<string, string>;
    timer:      ReturnType<typeof setInterval> | null;
  }>>({});

  const getInternal = (sid: string) => {
    if (!internals.current[sid]) {
      internals.current[sid] = { initDone: false, prevValues: {}, timer: null };
    }
    return internals.current[sid];
  };

  useEffect(() => { scriptsRef.current = scripts; }, [scripts]);

  const setSessions = useCallback(
    (updater: Record<string, ScriptSession> | ((prev: Record<string, ScriptSession>) => Record<string, ScriptSession>)) => {
      _setSessions(prev => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        sessionsRef.current = next;
        return next;
      });
    },
    [],
  );

  const patchSession = useCallback(
    (sid: string, patch: Partial<ScriptSession>) => {
      setSessions(prev => ({
        ...prev,
        [sid]: { ...(prev[sid] || { ...EMPTY }), ...patch },
      }));
    },
    [setSessions],
  );

  const pushOutput = useCallback(
    (sid: string, kind: OutputLine["kind"], text: string) => {
      const line: OutputLine = { ts: new Date().toLocaleTimeString("ru-RU"), kind, text };
      setSessions(prev => {
        const s = prev[sid] || { ...EMPTY };
        return { ...prev, [sid]: { ...s, output: [...s.output.slice(-199), line] } };
      });
    },
    [setSessions],
  );

  // ── Select ──────────────────────────────────────────────────────────────────

  const setSelectedId = useCallback(
    (id: string | null) => {
      setSelectedIdState(id);
      selectedIdRef.current = id;
      if (id && !sessionsRef.current[id]) {
        const script = scriptsRef.current.find(s => s.id === id);
        if (script) patchSession(id, { values: defaultValues(script.dynamic_params) });
      }
    },
    [patchSession],
  );

  // Verify kernel is still alive when switching scripts
  useEffect(() => {
    if (!selectedIdState) return;
    const s = sessionsRef.current[selectedIdState];
    if (s?.kernelAlive) {
      kernelStatus(selectedIdState)
        .then(res => { if (!res.alive) patchSession(selectedIdState, { kernelAlive: false }); })
        .catch(() => {});
    }
  }, [selectedIdState, patchSession]);

  // ── Load scripts ────────────────────────────────────────────────────────────

  useEffect(() => {
    getAlertFolders().then(setFolders).catch(() => {});
    getAlertScripts()
      .then(data => {
        setScripts(data);
        const batch: Record<string, ScriptSession> = {};
        for (const s of data) {
          if (!sessionsRef.current[s.id]) {
            batch[s.id] = { ...EMPTY, values: defaultValues(s.dynamic_params) };
          }
        }
        if (Object.keys(batch).length > 0) setSessions(prev => ({ ...prev, ...batch }));
        if (data.length > 0 && !selectedIdRef.current) {
          selectedIdRef.current = data[0].id;
          setSelectedIdState(data[0].id);
        }
      })
      .catch(e => setLoadErr(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup timers for deleted scripts
  useEffect(() => {
    const ids = new Set(scripts.map(s => s.id));
    for (const [sid, int] of Object.entries(internals.current)) {
      if (!ids.has(sid) && int.timer) { clearInterval(int.timer); int.timer = null; }
    }
  }, [scripts]);

  // ── Kernel ──────────────────────────────────────────────────────────────────

  const connectKernelFor = useCallback(async (sid: string) => {
    if (!sid) return;
    const scriptName = scriptsRef.current.find(s => s.id === sid)?.name ?? "";
    patchSession(sid, { kernelConnecting: true });
    pushOutput(sid, "system", "Подключение к ядру Python...");
    try {
      const res = await kernelStart(sid, scriptName);
      const int = getInternal(sid);
      int.initDone = false;
      int.prevValues = {};
      patchSession(sid, { kernelAlive: true, kernelConnecting: false, kernelStartedAt: Date.now() });
      pushOutput(sid, "system",
        res.status === "already_running"
          ? `Ядро уже запущено (${res.kernel_id})`
          : `Ядро запущено (${res.kernel_id})`);
    } catch (e) {
      pushOutput(sid, "error", `Ошибка подключения: ${e}`);
      patchSession(sid, { kernelConnecting: false });
    }
  }, [patchSession, pushOutput]);

  const connectKernel = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (sid) await connectKernelFor(sid);
  }, [connectKernelFor]);

  const disconnectKernelFor = useCallback(async (sid: string) => {
    if (!sid) return;
    const int = getInternal(sid);
    if (int.timer) { clearInterval(int.timer); int.timer = null; }
    patchSession(sid, { schedActive: false, schedStartedAt: undefined });
    try { await kernelStop(sid); } catch {}
    int.initDone = false;
    patchSession(sid, { kernelAlive: false, kernelStartedAt: undefined });
    pushOutput(sid, "system", "Ядро остановлено.");
  }, [patchSession, pushOutput]);

  const disconnectKernel = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (sid) await disconnectKernelFor(sid);
  }, [disconnectKernelFor]);

  // ── Execute ─────────────────────────────────────────────────────────────────

  const _handleKernelDead = useCallback((sid: string) => {
    const int = getInternal(sid);
    if (int.timer) { clearInterval(int.timer); int.timer = null; }
    int.initDone = false;
    patchSession(sid, {
      kernelAlive: false, kernelStartedAt: undefined,
      schedActive: false, schedStartedAt: undefined,
      executing: false,
    });
    pushOutput(sid, "error", "Ядро недоступно — планировщик остановлен.");
  }, [patchSession, pushOutput]);

  const _isKernelDeadError = (e: unknown): boolean => {
    const msg = String(e).toLowerCase();
    return msg.includes("404") || msg.includes("ядро не запущено") || msg.includes("не найдено");
  };

  const _doExecute = useCallback(async (sid: string) => {
    const sel = scriptsRef.current.find(s => s.id === sid);
    if (!sel || executingLocks.current.has(sid)) return;
    executingLocks.current.add(sid);
    patchSession(sid, { executing: true });

    const s      = sessionsRef.current[sid] || { ...EMPTY };
    const int    = getInternal(sid);
    const vals   = s.values;
    const params = sel.dynamic_params;
    const cells  = sel.notebook ?? [];

    const paramsChanged = !int.initDone ||
      params.some(p => (vals[p.id] ?? p.placeholder) !== (int.prevValues[p.id] ?? p.placeholder));

    if (paramsChanged) {
      const initCells = cells.filter(cellIsInit);
      if (initCells.length > 0) {
        pushOutput(sid, "system", `▶ Init-ячейки (${initCells.length})...`);
        for (const cell of initCells) {
          if (!cell.source.trim()) continue;
          const code = applyParams(cell.source, params, vals);
          try {
            const res = await kernelExecute(sid, code, 60);
            if (res.output) pushOutput(sid, "stdout", res.output);
            if (res.error)  pushOutput(sid, "error",  res.error);
          } catch (e) {
            if (_isKernelDeadError(e)) {
              _handleKernelDead(sid);
              executingLocks.current.delete(sid);
              return;
            }
            pushOutput(sid, "error", `Init error: ${e}`);
          }
        }
        const snap: Record<string, string> = {};
        for (const p of params) snap[p.id] = vals[p.id] ?? p.placeholder;
        int.prevValues = snap;
      }
      int.initDone = true;
    }

    const loopCells = cells.filter(cellIsLoop);
    for (const cell of loopCells) {
      if (!cell.source.trim()) continue;
      const code = applyParams(cell.source, params, vals);
      try {
        const res = await kernelExecute(sid, code, 60);
        if (res.output) pushOutput(sid, "stdout", res.output);
        if (res.error)  pushOutput(sid, "error",  res.error);
      } catch (e) {
        if (_isKernelDeadError(e)) {
          _handleKernelDead(sid);
          executingLocks.current.delete(sid);
          return;
        }
        pushOutput(sid, "error", `Loop error: ${e}`);
      }
    }

    executingLocks.current.delete(sid);
    patchSession(sid, { executing: false });
  }, [patchSession, pushOutput, _handleKernelDead]);

  const doExecuteCore = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (sid) await _doExecute(sid);
  }, [_doExecute]);

  // ── Scheduler ───────────────────────────────────────────────────────────────

  const stopScheduleFor = useCallback((sid: string) => {
    if (!sid) return;
    const int = getInternal(sid);
    if (int.timer) { clearInterval(int.timer); int.timer = null; }
    patchSession(sid, { schedActive: false, schedStartedAt: undefined });
  }, [patchSession]);

  const stopSchedule = useCallback(() => {
    const sid = selectedIdRef.current;
    if (sid) stopScheduleFor(sid);
  }, [stopScheduleFor]);

  const startSchedule = useCallback((freqSecs: number) => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const int = getInternal(sid);
    if (int.timer) { clearInterval(int.timer); int.timer = null; }
    patchSession(sid, { schedActive: true, schedCount: 0, schedStartedAt: Date.now() });

    const tick = async () => {
      const cur = sessionsRef.current[sid];
      if (!cur?.schedActive) return;
      const now = new Date();
      if (cur.schedFrom && now < new Date(cur.schedFrom)) return;
      if (cur.schedTo   && now > new Date(cur.schedTo)) {
        const i = getInternal(sid);
        if (i.timer) { clearInterval(i.timer); i.timer = null; }
        patchSession(sid, { schedActive: false, schedStartedAt: undefined });
        return;
      }
      await _doExecute(sid);
      const after = sessionsRef.current[sid];
      if (after) patchSession(sid, { schedCount: (after.schedCount || 0) + 1 });
    };

    tick();
    int.timer = setInterval(tick, freqSecs * 1000);
  }, [patchSession, _doExecute]);

  // Background polling: verify all "alive" kernels every 15s
  useEffect(() => {
    const poll = async () => {
      const snap = sessionsRef.current;
      const aliveIds = Object.entries(snap)
        .filter(([, s]) => s.kernelAlive)
        .map(([id]) => id);
      for (const sid of aliveIds) {
        try {
          const res = await kernelStatus(sid);
          if (!res.alive) _handleKernelDead(sid);
        } catch {
          _handleKernelDead(sid);
        }
      }
    };
    const timer = setInterval(poll, 15_000);
    return () => clearInterval(timer);
  }, [_handleKernelDead]);

  // Cleanup all timers on unmount
  useEffect(() => () => {
    for (const int of Object.values(internals.current)) {
      if (int.timer) clearInterval(int.timer);
    }
  }, []);

  // ── Selected session convenience ────────────────────────────────────────────

  const sel = sessions[selectedIdState ?? ""] || EMPTY;

  const setValues: React.Dispatch<React.SetStateAction<Record<string, string>>> = useCallback(
    (action) => {
      const sid = selectedIdRef.current;
      if (!sid) return;
      setSessions(prev => {
        const s = prev[sid] || { ...EMPTY };
        const next = typeof action === "function" ? action(s.values) : action;
        return { ...prev, [sid]: { ...s, values: next } };
      });
    },
    [setSessions],
  );

  const setSchedMode = useCallback((m: "once" | "periodic") => {
    const sid = selectedIdRef.current;
    if (sid) patchSession(sid, { schedMode: m });
  }, [patchSession]);

  const setSchedFreq = useCallback((n: number) => {
    const sid = selectedIdRef.current;
    if (sid) patchSession(sid, { schedFreq: n });
  }, [patchSession]);

  const setSchedFrom = useCallback((s: string) => {
    const sid = selectedIdRef.current;
    if (sid) patchSession(sid, { schedFrom: s });
  }, [patchSession]);

  const setSchedTo = useCallback((s: string) => {
    const sid = selectedIdRef.current;
    if (sid) patchSession(sid, { schedTo: s });
  }, [patchSession]);

  const clearOutput = useCallback(() => {
    const sid = selectedIdRef.current;
    if (sid) patchSession(sid, { output: [] });
  }, [patchSession]);

  // ── Run all scripts in a folder ────────────────────────────────────────────

  const runFolderScripts = useCallback(async (folderId: string) => {
    const folderScripts = scriptsRef.current.filter(s => s.folder_id === folderId);
    if (folderScripts.length === 0) return;

    // Connect kernels + execute in parallel
    await Promise.all(folderScripts.map(async (script) => {
      const sid = script.id;
      const sess = sessionsRef.current[sid];
      // Connect kernel if not alive
      if (!sess?.kernelAlive) {
        await connectKernelFor(sid);
      }
      // Execute
      await _doExecute(sid);
    }));
  }, [connectKernelFor, _doExecute]);

  return (
    <Ctx.Provider value={{
      scripts, setScripts, folders, setFolders, loadErr,
      selectedId: selectedIdState, setSelectedId,
      sessions,
      values: sel.values, setValues,
      kernelAlive: sel.kernelAlive, kernelConnecting: sel.kernelConnecting,
      connectKernel, disconnectKernel,
      connectKernelFor, disconnectKernelFor,
      executing: sel.executing, output: sel.output, clearOutput,
      schedMode: sel.schedMode, setSchedMode,
      schedFreq: sel.schedFreq, setSchedFreq,
      schedFrom: sel.schedFrom, setSchedFrom,
      schedTo: sel.schedTo, setSchedTo,
      schedActive: sel.schedActive, schedCount: sel.schedCount,
      doExecuteCore, startSchedule, stopSchedule, stopScheduleFor,
      runFolderScripts,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAlertsScheduler() {
  return useContext(Ctx);
}
