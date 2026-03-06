"use client";

/**
 * AlertsSchedulerContext
 *
 * Persists Kafka-alert scheduler state (timer, selected script, form values,
 * send results, history) across page navigations.
 * The periodic setInterval survives unmount because it lives here, not in
 * the AlertsSection component.
 */

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import {
  getAlertScripts,
  sendAlert,
  getAlertHistory,
  type AlertScript,
  type AlertHistoryEntry,
} from "@/lib/api";

// ── Context interface ─────────────────────────────────────────────────────────

interface AlertsSchedulerCtx {
  // Data
  scripts:     AlertScript[];
  setScripts:  React.Dispatch<React.SetStateAction<AlertScript[]>>;
  history:     AlertHistoryEntry[];
  setHistory:  React.Dispatch<React.SetStateAction<AlertHistoryEntry[]>>;
  loadErr:     string;
  loadScripts: () => void;

  // Selection + form
  selectedId:      string | null;
  setSelectedId:   (id: string | null) => void;
  values:          Record<string, string>;
  setValues:       React.Dispatch<React.SetStateAction<Record<string, string>>>;
  topicOverride:   string;
  setTopicOverride: (t: string) => void;

  // Send state
  sending:       boolean;
  sendResult:    { ok: boolean; error?: string; offset?: number } | null;
  setSendResult: React.Dispatch<React.SetStateAction<{ ok: boolean; error?: string; offset?: number } | null>>;

  // Scheduler
  schedMode:     "once" | "periodic";
  setSchedMode:  (m: "once" | "periodic") => void;
  schedFreq:     number;
  setSchedFreq:  (n: number) => void;
  schedFrom:     string;
  setSchedFrom:  (s: string) => void;
  schedTo:       string;
  setSchedTo:    (s: string) => void;
  schedActive:   boolean;
  schedCount:    number;

  // Actions
  doSendCore:    () => Promise<void>;
  startSchedule: (freqSecs: number) => void;
  stopSchedule:  () => void;
}

const AlertsSchedulerContext = createContext<AlertsSchedulerCtx>({
  scripts: [], setScripts: () => {},
  history: [], setHistory: () => {},
  loadErr: "", loadScripts: () => {},
  selectedId: null, setSelectedId: () => {},
  values: {}, setValues: () => {},
  topicOverride: "", setTopicOverride: () => {},
  sending: false,
  sendResult: null, setSendResult: () => {},
  schedMode: "once", setSchedMode: () => {},
  schedFreq: 30, setSchedFreq: () => {},
  schedFrom: "", setSchedFrom: () => {},
  schedTo: "", setSchedTo: () => {},
  schedActive: false, schedCount: 0,
  doSendCore: async () => {},
  startSchedule: () => {},
  stopSchedule: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function AlertsSchedulerProvider({ children }: { children: ReactNode }) {
  const [scripts,       setScripts]       = useState<AlertScript[]>([]);
  const [history,       setHistory]       = useState<AlertHistoryEntry[]>([]);
  const [loadErr,       setLoadErr]       = useState("");
  const [selectedId,    setSelectedIdState] = useState<string | null>(null);
  const [values,        setValues]        = useState<Record<string, string>>({});
  const [topicOverride, setTopicOverrideState] = useState("");
  const [sending,       setSending]       = useState(false);
  const [sendResult,    setSendResult]    = useState<{ ok: boolean; error?: string; offset?: number } | null>(null);
  const [schedMode,     setSchedModeState] = useState<"once" | "periodic">("once");
  const [schedFreq,     setSchedFreqState] = useState(30);
  const [schedFrom,     setSchedFromState] = useState("");
  const [schedTo,       setSchedToState]   = useState("");
  const [schedActive,   setSchedActive]   = useState(false);
  const [schedCount,    setSchedCount]    = useState(0);

  // Refs to avoid stale closures in timer callback
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendingRef     = useRef(false);
  const schedActiveRef = useRef(false);
  const valuesRef      = useRef(values);
  const topicRef       = useRef(topicOverride);
  const selectedIdRef  = useRef(selectedId);
  const scriptsRef     = useRef(scripts);
  const schedFromRef   = useRef(schedFrom);
  const schedToRef     = useRef(schedTo);

  useEffect(() => { valuesRef.current     = values; },        [values]);
  useEffect(() => { topicRef.current      = topicOverride; }, [topicOverride]);
  useEffect(() => { selectedIdRef.current = selectedId; },    [selectedId]);
  useEffect(() => { scriptsRef.current    = scripts; },       [scripts]);
  useEffect(() => { schedFromRef.current  = schedFrom; },     [schedFrom]);
  useEffect(() => { schedToRef.current    = schedTo; },       [schedTo]);

  // Setters that keep both state and ref in sync
  const setSelectedId    = useCallback((id: string | null)           => { setSelectedIdState(id); selectedIdRef.current = id; },         []);
  const setTopicOverride = useCallback((t: string)                   => { setTopicOverrideState(t); topicRef.current = t; },             []);
  const setSchedMode     = useCallback((m: "once" | "periodic")      => setSchedModeState(m),    []);
  const setSchedFreq     = useCallback((n: number)                   => setSchedFreqState(n),    []);
  const setSchedFrom     = useCallback((s: string)                   => { setSchedFromState(s); schedFromRef.current = s; },             []);
  const setSchedTo       = useCallback((s: string)                   => { setSchedToState(s);   schedToRef.current = s; },               []);

  // Load scripts on mount (once)
  const loadScripts = useCallback(() => {
    getAlertScripts()
      .then(data => {
        setScripts(data);
        if (data.length > 0 && selectedIdRef.current == null) {
          const s = data[0];
          setSelectedId(s.id);
          const v: Record<string, string> = {};
          for (const p of s.params) {
            v[p.key] = p.default === "__now__" ? new Date().toISOString() : (p.default ?? "");
          }
          setValues(v);
          setTopicOverride(s.topic);
        }
      })
      .catch(e => setLoadErr(String(e)));
    getAlertHistory().then(setHistory).catch(() => {});
  }, [setSelectedId, setTopicOverride]);

  useEffect(() => { loadScripts(); }, [loadScripts]);

  // Core send — reads from refs (safe in timer callback)
  const doSendCore = useCallback(async () => {
    const sid = selectedIdRef.current;
    const sel = scriptsRef.current.find(s => s.id === sid) ?? null;
    if (!sel || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendResult(null);
    try {
      const topic = topicRef.current;
      const res = await sendAlert({
        script_id:      sel.id,
        values:         valuesRef.current,
        topic_override: topic !== sel.topic ? topic : "",
      });
      setSendResult({ ok: res.ok, error: res.error, offset: res.offset });
      getAlertHistory().then(setHistory).catch(() => {});
    } catch (e) {
      setSendResult({ ok: false, error: String(e) });
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, []);

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
      await doSendCore();
      count++;
      setSchedCount(count);
    };

    tick();
    timerRef.current = setInterval(tick, freqSecs * 1000);
  }, [stopSchedule, doSendCore]);

  // Clean up timer on full app unmount (not on page navigation, since provider is above pages)
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <AlertsSchedulerContext.Provider value={{
      scripts, setScripts,
      history, setHistory,
      loadErr, loadScripts,
      selectedId, setSelectedId,
      values, setValues,
      topicOverride, setTopicOverride,
      sending,
      sendResult, setSendResult,
      schedMode, setSchedMode,
      schedFreq, setSchedFreq,
      schedFrom, setSchedFrom,
      schedTo, setSchedTo,
      schedActive, schedCount,
      doSendCore, startSchedule, stopSchedule,
    }}>
      {children}
    </AlertsSchedulerContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAlertsScheduler() {
  return useContext(AlertsSchedulerContext);
}
