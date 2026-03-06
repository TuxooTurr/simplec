"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart2, Plus, Trash2, Play, Square, Settings2,
  Loader2, RefreshCw, ChevronRight, ToggleLeft, ToggleRight,
  AlertTriangle, Database, Wifi, Save, X, Zap, Eye,
  CheckCircle, XCircle, Pencil, Bell, MessageSquare,
} from "lucide-react";
import {
  getSystems, createSystem, updateSystem, deleteSystem, toggleSystem, toggleAll,
  getSystemMetrics, createMetric, updateMetric, deleteMetric, toggleMetric,
  getMetricsSettings, saveMetricsSettings,
  getMetricBuilder, saveValuesConfig, saveBaselineConfig,
  saveThresholdsConfig, saveHealthConfig, sendNow, previewMessage, getMetricLogs,
  createAccessRequest, getMyRequests, resolveRequest,
  type System, type Metric, type MetricCreate, type MetricUpdate, type SettingsMap,
  type BuilderConfig, type ValuesConfig, type BaselineConfig,
  type ThresholdsConfig, type ThresholdRow, type HealthConfig,
  type LogEntry, type SendNowResult, type PreviewResult, type AccessRequest,
} from "@/lib/metricsApi";

// ── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150 bg-white";

const INPUT_SM =
  "border border-border-main rounded-md px-2 py-1 text-xs " +
  "focus:outline-none focus:ring-1 focus:ring-primary/30 bg-white w-full";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

const BTN_PRIMARY =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm " +
  "font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BTN_GHOST =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm " +
  "text-text-main hover:bg-bg-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BTN_SM =
  "flex items-center gap-1 px-2 py-1 rounded-md border border-border-main text-xs " +
  "text-text-muted hover:bg-bg-subtle transition-colors";

// ── Health labels ─────────────────────────────────────────────────────────────

const HEALTH_LABELS: Record<number, { label: string; cls: string }> = {
  1: { label: "OK",       cls: "text-green-700 bg-green-50 border-green-200"    },
  2: { label: "Info",     cls: "text-lime-700 bg-lime-50 border-lime-200"       },
  3: { label: "Warning",  cls: "text-yellow-700 bg-yellow-50 border-yellow-200" },
  4: { label: "Minor",    cls: "text-orange-700 bg-orange-50 border-orange-200" },
  5: { label: "Critical", cls: "text-red-700 bg-red-50 border-red-200"          },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 60_000)  return "только что";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} мин`;
    if (diffMs < 86_400_000) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  } catch { return ""; }
}

// ── Pattern Sparkline ─────────────────────────────────────────────────────────

// Y-координаты в диапазоне 0–20 (реальные пиксели, viewBox совпадает с size)
const _SINE_PTS: [number, number][] = Array.from({ length: 9 }, (_, i) => [
  i * 8,
  Math.round(10 + 9 * Math.sin((i / 8) * 2 * Math.PI)),
] as [number, number]);

const SPARKLINE_PTS: Record<string, [number, number][]> = {
  constant: [[0, 10], [64, 10]],
  sine:     _SINE_PTS,
  spike:    [[0, 16], [26, 16], [34, 1], [42, 16], [64, 16]],
  random:   [[0, 12], [8,  6], [16, 15], [24,  9], [32,  4], [40, 13], [48,  8], [56, 16], [64,  7]],
};

const THRESHOLD_STROKE: Record<number, string> = {
  0: "#3b82f6", // blue-500  (baseline)
  1: "#4ade80", // green-400
  2: "#a3e635", // lime-400
  3: "#facc15", // yellow-400
  4: "#fb923c", // orange-400
  5: "#ef4444", // red-500
};

function PatternSparkline({
  pattern,
  thresholds,
}: {
  pattern: string;
  thresholds?: number[];  // отсортированные health-типы
}) {
  const pts = SPARKLINE_PTS[pattern] ?? SPARKLINE_PTS.random;
  const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const n = thresholds?.length ?? 0;
  return (
    <svg width={64} height={20} viewBox="0 0 64 20" className="overflow-visible">
      {/* Линии порогов — равномерно, health 1 → верх, 5 → низ */}
      {thresholds?.map((ht, i) => {
        const y = +((i + 1) * 20 / (n + 1)).toFixed(1);
        return (
          <line
            key={i}
            x1="0" y1={y} x2="64" y2={y}
            stroke={THRESHOLD_STROKE[ht] ?? "#aaa"}
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity="0.85"
          />
        );
      })}
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Threshold Dots ────────────────────────────────────────────────────────────

const THRESHOLD_DOT_COLOR: Record<number, string> = {
  1: "bg-green-400",
  2: "bg-lime-400",
  3: "bg-yellow-400",
  4: "bg-orange-400",
  5: "bg-red-500",
};

function ThresholdDots({ types }: { types: number[] }) {
  if (!types.length) return null;
  return (
    <div className="flex flex-col gap-0.5 items-center justify-center shrink-0 self-center">
      {types.map((ht, i) => (
        <div key={i} className={`w-2 h-1 rounded-sm ${THRESHOLD_DOT_COLOR[ht] ?? "bg-gray-300"}`} />
      ))}
    </div>
  );
}

// ── Helper: Toggle ────────────────────────────────────────────────────────────

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2 text-sm font-medium transition-colors ${value ? "text-primary" : "text-text-muted"}`}
    >
      {value ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
      {label}
    </button>
  );
}

// ── Helper: SaveBar ───────────────────────────────────────────────────────────

function SaveBar({ saving, saved, err, onSave }: { saving: boolean; saved: boolean; err: string; onSave: () => void }) {
  return (
    <div className="flex items-center gap-3 pt-2 border-t border-border-main mt-2">
      <button className={BTN_PRIMARY} onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Сохранить
      </button>
      {saved && <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Сохранено</span>}
      {err   && <span className="text-xs text-red-500 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> {err}</span>}
    </div>
  );
}

// ── Modal: Add System ────────────────────────────────────────────────────────

interface AddSystemModalProps {
  onSave:  (s: System) => void;
  onClose: () => void;
}

function AddSystemModal({ onSave, onClose }: AddSystemModalProps) {
  const [itServiceCi, setItServiceCi] = useState("");
  const [name,        setName]        = useState("");
  const [monSystemCi, setMonSystemCi] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState("");

  const handleSave = async () => {
    setErr("");
    if (!itServiceCi.trim() || !name.trim() || !monSystemCi.trim()) {
      setErr("Все поля обязательны");
      return;
    }
    setSaving(true);
    try {
      const s = await createSystem({ itServiceCi: itServiceCi.trim(), name: name.trim(), monSystemCi: monSystemCi.trim() });
      onSave(s);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-main">Добавить услугу</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={LABEL_CLS}>КЭ Услуги (CI-код) *</label>
            <input className={INPUT_CLS} placeholder="CI00000001" value={itServiceCi}
              onChange={e => setItServiceCi(e.target.value)} />
            <p className="text-xs text-text-muted mt-1">Формат: CI + 8 цифр</p>
          </div>
          <div>
            <label className={LABEL_CLS}>Название услуги *</label>
            <input className={INPUT_CLS} placeholder="Sber911 — стенд ОД" value={name}
              onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>КЭ Системы мониторинга *</label>
            <input className={INPUT_CLS} placeholder="CI00000002" value={monSystemCi}
              onChange={e => setMonSystemCi(e.target.value)} />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className={BTN_GHOST} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Edit System ────────────────────────────────────────────────────────

interface EditSystemModalProps {
  system:  System;
  onSave:  (s: System) => void;
  onClose: () => void;
}

function EditSystemModal({ system, onSave, onClose }: EditSystemModalProps) {
  const [name,        setName]        = useState(system.name);
  const [monSystemCi, setMonSystemCi] = useState(system.monSystemCi);
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState("");

  const handleSave = async () => {
    setErr("");
    if (!name.trim()) { setErr("Название обязательно"); return; }
    setSaving(true);
    try {
      const s = await updateSystem(system.id, { name: name.trim(), monSystemCi: monSystemCi.trim() || undefined });
      onSave(s);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-main">Редактировать услугу</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={LABEL_CLS}>КЭ Услуги</label>
            <input className={INPUT_CLS + " bg-bg-subtle text-text-muted cursor-not-allowed"}
              value={system.itServiceCi} readOnly />
            <p className="text-xs text-text-muted mt-1">Нельзя изменить после создания</p>
          </div>
          <div>
            <label className={LABEL_CLS}>Название услуги *</label>
            <input className={INPUT_CLS} value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={LABEL_CLS}>КЭ Системы мониторинга</label>
            <input className={INPUT_CLS} placeholder="CI00000002" value={monSystemCi}
              onChange={e => setMonSystemCi(e.target.value)} />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className={BTN_GHOST} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Edit Metric ────────────────────────────────────────────────────────

interface EditMetricModalProps {
  metric:  Metric;
  onSave:  (m: Metric) => void;
  onClose: () => void;
}

function EditMetricModal({ metric, onSave, onClose }: EditMetricModalProps) {
  const [name,    setName]    = useState(metric.metricName);
  const [type,    setType]    = useState(metric.metricType);
  const [unit,    setUnit]    = useState(metric.metricUnit);
  const [period,  setPeriod]  = useState(metric.metricPeriodSec);
  const [pattern, setPattern] = useState(metric.valuePattern ?? "random");
  const [min,     setMin]     = useState(metric.valueMin ?? 0);
  const [max,     setMax]     = useState(metric.valueMax ?? 100);
  const [ke,      setKe]      = useState(metric.objectCi ?? metric.objectName ?? "");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  const handleSave = async () => {
    setErr("");
    if (!name.trim()) { setErr("Название обязательно"); return; }
    if (period < 10)  { setErr("Период не менее 10 секунд"); return; }
    setSaving(true);
    try {
      const body: MetricUpdate = {
        metricName:      name.trim(),
        metricType:      type,
        metricUnit:      unit,
        metricPeriodSec: period,
        ke:              ke.trim() || "",
        valueMin:        min,
        valueMax:        max,
        valuePattern:    pattern,
      };
      const updated = await updateMetric(metric.id, body);
      onSave(updated);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-main">Редактировать метрику</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL_CLS}>Название *</label>
            <input className={INPUT_CLS} value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={LABEL_CLS}>Тип *</label>
            <select className={INPUT_CLS} value={type} onChange={e => setType(e.target.value)}>
              {METRIC_TYPES_LIST.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Ед. измерения</label>
            <input className={INPUT_CLS} placeholder="%" value={unit} onChange={e => setUnit(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Период (сек) *</label>
            <input type="number" min={10} className={INPUT_CLS} value={period}
              onChange={e => setPeriod(Number(e.target.value))} />
          </div>
          <div>
            <label className={LABEL_CLS}>Паттерн</label>
            <select className={INPUT_CLS} value={pattern} onChange={e => setPattern(e.target.value)}>
              {METRIC_PATTERNS_LIST.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Min</label>
            <input type="number" className={INPUT_CLS} value={min} onChange={e => setMin(Number(e.target.value))} />
          </div>
          <div>
            <label className={LABEL_CLS}>Max</label>
            <input type="number" className={INPUT_CLS} value={max} onChange={e => setMax(Number(e.target.value))} />
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>КЭ (CI-код или название)</label>
            <input className={INPUT_CLS} placeholder="CI00000001 или оставить пустым" value={ke}
              onChange={e => setKe(e.target.value)} />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className={BTN_GHOST} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Batch Add Metrics ──────────────────────────────────────────────────

const METRIC_TYPES_LIST    = ["Availability", "Errors", "Latency", "Traffic", "Saturation", "Other"];
const METRIC_PATTERNS_LIST = ["random", "constant", "sine", "spike"];

interface BatchRow {
  id:      string;
  name:    string;
  unit:    string;
  type:    string;
  period:  number;
  min:     number;
  max:     number;
  pattern: string;
  ke:      string;
}

interface BatchDefaults {
  unit:    string;
  type:    string;
  period:  number;
  min:     number;
  max:     number;
  pattern: string;
  ke:      string;
}

type BatchPhase = "edit" | "creating" | "done";

function makeBatchRow(defaults: BatchDefaults): BatchRow {
  return {
    id:      Math.random().toString(36).slice(2),
    name:    "",
    unit:    defaults.unit,
    type:    defaults.type,
    period:  defaults.period,
    min:     defaults.min,
    max:     defaults.max,
    pattern: defaults.pattern,
    ke:      defaults.ke,
  };
}

interface BatchAddMetricsModalProps {
  systemId:   number;
  systemName: string;
  onDone:     (created: Metric[]) => void;
  onClose:    () => void;
}

function BatchAddMetricsModal({ systemId, systemName, onDone, onClose }: BatchAddMetricsModalProps) {
  const [defaults, setDefaults] = useState<BatchDefaults>({
    unit: "", type: "Availability", period: 60, min: 0, max: 100, pattern: "random", ke: "",
  });
  const [rows,    setRows]    = useState<BatchRow[]>([makeBatchRow({ unit: "", type: "Availability", period: 60, min: 0, max: 100, pattern: "random", ke: "" })]);
  const [phase,   setPhase]   = useState<BatchPhase>("edit");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults]   = useState<{ created: Metric[]; errors: string[] }>({ created: [], errors: [] });

  const setDefault = <K extends keyof BatchDefaults>(k: K, v: BatchDefaults[K]) =>
    setDefaults(p => ({ ...p, [k]: v }));

  const addRow = () => setRows(p => [...p, makeBatchRow(defaults)]);

  const dupLast = () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setRows(p => [...p, { ...last, id: Math.random().toString(36).slice(2), name: "" }]);
  };

  const removeRow = (id: string) => setRows(p => p.filter(r => r.id !== id));

  const setRow = <K extends keyof BatchRow>(id: string, k: K, v: BatchRow[K]) =>
    setRows(p => p.map(r => r.id === id ? { ...r, [k]: v } : r));

  const validRows = rows.filter(r => r.name.trim() !== "");

  const handleCreate = async () => {
    if (validRows.length === 0) return;
    setPhase("creating");
    setProgress({ done: 0, total: validRows.length });

    const created: Metric[] = [];
    const errors:  string[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const m = await createMetric(systemId, {
          metricName:      row.name.trim(),
          metricType:      row.type,
          metricUnit:      row.unit || undefined,
          metricPeriodSec: row.period,
          ke:              row.ke.trim() || undefined,
          valueMin:        row.min,
          valueMax:        row.max,
          valuePattern:    row.pattern,
        });
        created.push(m);
      } catch (e: unknown) {
        errors.push(`«${row.name}»: ${e instanceof Error ? e.message : "Ошибка"}`);
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setResults({ created, errors });
    setPhase("done");
    if (created.length > 0) onDone(created);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-main shrink-0 bg-white">
          <div>
            <h3 className="font-semibold text-text-main">Добавить метрики</h3>
            <p className="text-xs text-text-muted mt-0.5">Услуга: <span className="font-medium text-text-main">{systemName}</span></p>
          </div>
          <button onClick={onClose} disabled={phase === "creating"}
            className="text-text-muted hover:text-text-main disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {phase === "done" ? (
          /* Results */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex flex-col items-center gap-2">
              {results.created.length > 0 && (
                <div className="flex items-center gap-2 text-green-600 font-semibold">
                  <CheckCircle className="w-5 h-5" />
                  Создано: {results.created.length}
                </div>
              )}
              {results.errors.length > 0 && (
                <div className="flex flex-col gap-1 text-left">
                  <p className="text-red-500 font-semibold flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> Ошибок: {results.errors.length}
                  </p>
                  {results.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-400">{e}</p>
                  ))}
                </div>
              )}
            </div>
            <button className={BTN_PRIMARY} onClick={onClose}>Готово</button>
          </div>
        ) : phase === "creating" ? (
          /* Progress */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-text-main">
              Создаётся {progress.done + 1}/{progress.total}...
            </p>
            <div className="w-64 h-2 bg-bg-subtle rounded-full overflow-hidden border border-border-main">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          /* Edit mode */
          <>
            {/* ── Шаблон (дефолты) ──────────────────────────────────────────── */}
            <div className="shrink-0 px-6 pt-4 pb-3 border-b-2 border-border-main bg-indigo-50/40">
              <div className="flex items-center gap-2 mb-3">
                <Settings2 className="w-3.5 h-3.5 text-primary/70" />
                <p className="text-xs font-semibold text-primary/80 uppercase tracking-wide">Шаблон — дефолтные значения для новых строк</p>
              </div>
              <div className="grid grid-cols-[110px_60px_56px_56px_100px_72px_1fr] gap-x-4 gap-y-2">
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Тип</p>
                  <select className={INPUT_SM} value={defaults.type}
                    onChange={e => setDefault("type", e.target.value)}>
                    {METRIC_TYPES_LIST.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Период, с</p>
                  <input type="number" min={10} className={INPUT_SM} value={defaults.period}
                    onChange={e => setDefault("period", Number(e.target.value))} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Min</p>
                  <input type="number" className={INPUT_SM} value={defaults.min}
                    onChange={e => setDefault("min", Number(e.target.value))} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Max</p>
                  <input type="number" className={INPUT_SM} value={defaults.max}
                    onChange={e => setDefault("max", Number(e.target.value))} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Паттерн</p>
                  <select className={INPUT_SM} value={defaults.pattern}
                    onChange={e => setDefault("pattern", e.target.value)}>
                    {METRIC_PATTERNS_LIST.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Ед. изм.</p>
                  <input type="text" className={INPUT_SM} placeholder="%" value={defaults.unit}
                    onChange={e => setDefault("unit", e.target.value)} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">КЭ (опц.)</p>
                  <input type="text" className={INPUT_SM} placeholder="CI00000001 или название" value={defaults.ke}
                    onChange={e => setDefault("ke", e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── Таблица метрик ─────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {/* Table header */}
              <div className="flex items-center gap-2 mb-2">
                <BarChart2 className="w-3.5 h-3.5 text-text-muted" />
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Добавляемые метрики
                </p>
              </div>
              <div className="grid grid-cols-[1fr_64px_110px_60px_56px_56px_90px_96px_28px] gap-1.5 mb-1.5 px-1">
                {["Название *", "Ед.изм", "Тип", "Период", "Min", "Max", "Паттерн", "КЭ", ""].map(h => (
                  <span key={h} className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">{h}</span>
                ))}
              </div>

              {/* Rows */}
              <div className="flex flex-col gap-1.5">
                {rows.map((row, idx) => (
                  <div key={row.id}
                    className="grid grid-cols-[1fr_64px_110px_60px_56px_56px_90px_96px_28px] gap-1.5 items-center">
                    <input
                      type="text"
                      className={INPUT_SM + (row.name.trim() === "" && idx === 0 ? " border-primary/40" : "")}
                      placeholder="CPU usage"
                      value={row.name}
                      onChange={e => setRow(row.id, "name", e.target.value)}
                      autoFocus={idx === rows.length - 1 && rows.length > 1}
                    />
                    <input type="text" className={INPUT_SM} placeholder="%" value={row.unit}
                      onChange={e => setRow(row.id, "unit", e.target.value)} />
                    <select className={INPUT_SM} value={row.type}
                      onChange={e => setRow(row.id, "type", e.target.value)}>
                      {METRIC_TYPES_LIST.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <input type="number" min={10} className={INPUT_SM} value={row.period}
                      onChange={e => setRow(row.id, "period", Number(e.target.value))} />
                    <input type="number" className={INPUT_SM} value={row.min}
                      onChange={e => setRow(row.id, "min", Number(e.target.value))} />
                    <input type="number" className={INPUT_SM} value={row.max}
                      onChange={e => setRow(row.id, "max", Number(e.target.value))} />
                    <select className={INPUT_SM} value={row.pattern}
                      onChange={e => setRow(row.id, "pattern", e.target.value)}>
                      {METRIC_PATTERNS_LIST.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <input type="text" className={INPUT_SM} placeholder="CI или название" value={row.ke}
                      onChange={e => setRow(row.id, "ke", e.target.value)} />
                    <button onClick={() => removeRow(row.id)} disabled={rows.length === 1}
                      className="p-0.5 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors disabled:opacity-30">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add row buttons */}
              <div className="flex items-center gap-2 mt-3">
                <button className={BTN_SM} onClick={addRow} disabled={rows.length >= 100}>
                  <Plus className="w-3 h-3" /> Строка
                </button>
                <button className={BTN_SM} onClick={dupLast} disabled={rows.length >= 100}>
                  Дублировать последнюю
                </button>
                <span className="text-xs text-text-muted ml-1">{rows.length} / 100</span>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-between px-6 py-3 border-t border-border-main">
              <div className="text-xs text-text-muted">
                {validRows.length > 0
                  ? <span className="text-text-main font-medium">{validRows.length} метрик</span>
                  : "Заполните хотя бы одно название"
                }
                {rows.length > validRows.length && (
                  <span className="ml-1 text-text-muted">
                    ({rows.length - validRows.length} пустых будут пропущены)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button className={BTN_GHOST} onClick={onClose}>Отмена</button>
                <button className={BTN_PRIMARY} onClick={handleCreate} disabled={validRows.length === 0}>
                  <Plus className="w-3.5 h-3.5" /> Создать {validRows.length > 0 ? validRows.length : ""} метрик
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Kafka Settings Tab ───────────────────────────────────────────────────────

function KafkaSettingsTab() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [editing,  setEditing]  = useState<Record<string, string>>({});
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [err,      setErr]      = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getMetricsSettings();
      setSettings(d);
      setEditing(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value])));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка загрузки настроек");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setErr(""); setSaving(true); setSaved(false);
    try {
      await saveMetricsSettings(editing);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
    </div>
  );

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700">
          Настройки хранятся в базе данных и применяются без перезапуска.
          При переносе на инфраструктуру Сбера измените только <code className="font-mono">DATABASE_URL</code> в .env
          и обновите эти параметры через интерфейс.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {Object.entries(settings).map(([key, meta]) => (
          <div key={key}>
            <label className={LABEL_CLS}>{key}</label>
            <input
              className={INPUT_CLS}
              type={key.toLowerCase().includes("password") || key.toLowerCase().includes("secret") ? "password" : "text"}
              placeholder={meta.description}
              value={editing[key] ?? ""}
              onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
            />
            <p className="text-xs text-text-muted mt-0.5">{meta.description}</p>
          </div>
        ))}
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="flex items-center gap-3">
        <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
          {saving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Save className="w-3.5 h-3.5" />}
          Сохранить
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">Сохранено</span>}
      </div>
    </div>
  );
}

// ── Health Badge ──────────────────────────────────────────────────────────────

const HEALTH_META: Record<number, { label: string; cls: string }> = {
  1: { label: "OK",        cls: "bg-green-50  text-green-700  border-green-200"  },
  2: { label: "OK пониж.", cls: "bg-lime-50   text-lime-700   border-lime-200"   },
  3: { label: "Warning",   cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  4: { label: "Degraded",  cls: "bg-orange-50 text-orange-700 border-orange-200" },
  5: { label: "Critical",  cls: "bg-red-50    text-red-700    border-red-200"    },
};

function HealthBadge({ health }: { health: number }) {
  const meta = HEALTH_META[health];
  if (!meta) return null;
  return (
    <span className={`shrink-0 self-center whitespace-nowrap text-[10px] font-semibold px-2 py-0.5 rounded border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

// ── Metric Row ───────────────────────────────────────────────────────────────

interface MetricRowProps {
  metric:    Metric;
  selected:  boolean;
  onSelect:  () => void;
  onToggle:  (id: number) => Promise<void>;
  onDelete:  (id: number) => Promise<void>;
  onEdit:    (m: Metric) => void;
}

function MetricRow({ metric, selected, onSelect, onToggle, onDelete, onEdit }: MetricRowProps) {
  const [busy, setBusy] = useState(false);

  const doToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try { await onToggle(metric.id); }
    finally { setBusy(false); }
  };

  const doDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Удалить метрику «${metric.metricName}»?`)) return;
    setBusy(true);
    try { await onDelete(metric.id); }
    finally { setBusy(false); }
  };

  const ago = fmtAgo(metric.lastSentAt);
  const lastVal = metric.lastSentValue != null
    ? metric.lastSentValue % 1 === 0
      ? metric.lastSentValue.toFixed(0)
      : metric.lastSentValue.toFixed(2)
    : null;

  return (
    <div
      onClick={onSelect}
      className={`flex items-start gap-3 py-2.5 px-3 rounded-lg cursor-pointer transition-colors group border-l-2 ${
        selected
          ? "bg-primary/5 border-l-primary"
          : "border-l-transparent hover:bg-bg-subtle"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-main truncate">{metric.metricName}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
            {metric.metricType}
          </span>
          {metric.metricUnit && (
            <span className="text-[10px] text-text-muted">{metric.metricUnit}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-text-muted truncate">{metric.objectName}</span>
          <span className="text-xs text-text-muted">{metric.metricPeriodSec}с</span>
          <span className={`text-[10px] px-1 rounded font-semibold ${metric.isActive ? "text-green-600" : "text-text-muted"}`}>
            {metric.isActive ? "●" : "○"}
          </span>
          {ago && (
            <span className="text-[10px] text-text-muted tabular-nums">{ago}</span>
          )}
        </div>
      </div>
      {metric.thresholdLines.includes(0) && metric.thresholdLines.some(t => t > 0) && (
        <ThresholdDots types={metric.thresholdLines.filter(t => t > 0)} />
      )}
      {metric.isActive && metric.lastSentHealth != null && (
        <HealthBadge health={metric.lastSentHealth} />
      )}
      {metric.isActive && (
        <div className="shrink-0 flex flex-col items-end gap-0.5 mr-0.5">
          <div className="text-green-400 opacity-70">
            <PatternSparkline
              pattern={metric.valuePattern ?? "random"}
              thresholds={metric.thresholdLines}
            />
          </div>
          {lastVal != null && (
            <span className="text-[10px] tabular-nums font-mono text-text-muted leading-none">
              {lastVal}{metric.metricUnit ? ` ${metric.metricUnit}` : ""}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onEdit(metric); }}
          disabled={busy}
          className="p-1 rounded hover:bg-bg-muted text-text-muted hover:text-primary transition-colors"
          title="Редактировать"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={doToggle}
          disabled={busy}
          className="p-1 rounded hover:bg-bg-muted transition-colors"
          title={metric.isActive ? "Остановить" : "Запустить"}
        >
          {busy
            ? <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
            : metric.isActive
              ? <ToggleRight className="w-4 h-4 text-green-500" />
              : <ToggleLeft className="w-4 h-4 text-text-muted" />}
        </button>
        <button
          onClick={doDelete}
          disabled={busy}
          className="p-1 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── System Card ──────────────────────────────────────────────────────────────

// ── Request Modal ─────────────────────────────────────────────────────────────

function RequestModal({ system, onClose }: { system: System; onClose: () => void }) {
  const [reqType,  setReqType]  = useState<"stop" | "add">("stop");
  const [message,  setMessage]  = useState("");
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const [err,      setErr]      = useState("");

  const send = async () => {
    setSending(true); setErr("");
    try {
      await createAccessRequest(system.id, reqType, message);
      setSent(true);
      setTimeout(onClose, 1500);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-text-main flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Запрос к «{system.startedBy}»
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-subtle text-text-muted"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-text-muted">Услуга: <span className="font-medium text-text-main">{system.name}</span></p>

        <div className="flex gap-2">
          {([["stop", "Прошу остановить"], ["add", "Прошу добавить метрику"]] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setReqType(v)}
              className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                reqType === v ? "border-primary bg-primary/5 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"
              }`}
            >{l}</button>
          ))}
        </div>

        <div>
          <label className={LABEL_CLS}>Комментарий (необязательно)</label>
          <textarea
            className={INPUT_CLS + " resize-none h-24"}
            placeholder="Опишите детали..."
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
        </div>

        {sent && <p className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Запрос отправлен!</p>}
        {err  && <p className="text-sm text-red-500">{err}</p>}

        <div className="flex gap-2">
          <button className={BTN_GHOST + " flex-1"} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY + " flex-1 justify-center"} onClick={send} disabled={sending || sent}>
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── System Card ──────────────────────────────────────────────────────────────

interface SystemCardProps {
  system:      System;
  selected:    boolean;
  onSelect:    () => void;
  onToggle:    (id: number) => Promise<void>;
  onDelete:    (id: number) => Promise<void>;
  onEdit:      (s: System) => void;
  currentUser: string | null;
  onRequest:   (s: System) => void;
}

function SystemCard({ system, selected, onSelect, onToggle, onDelete, onEdit, currentUser, onRequest }: SystemCardProps) {
  const [busy, setBusy] = useState(false);

  const isOtherOwner = !!(system.isActive && system.startedBy && system.startedBy !== currentUser);
  const isOwner      = !!(system.isActive && system.startedBy && system.startedBy === currentUser);

  const doToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOtherOwner) return;
    setBusy(true);
    try { await onToggle(system.id); }
    finally { setBusy(false); }
  };

  const doDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Удалить услугу «${system.name}» со всеми метриками?`)) return;
    setBusy(true);
    try { await onDelete(system.id); }
    finally { setBusy(false); }
  };

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors border group ${
        selected
          ? "bg-primary/5 border-primary/20"
          : "border-transparent hover:bg-bg-subtle hover:border-border-main"
      }`}
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${system.isActive ? "bg-green-400" : "bg-text-muted/40"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-main truncate">{system.name}</p>
        <p className="text-xs text-text-muted truncate">{system.itServiceCi}</p>
        <p className="text-xs text-text-muted">
          {system.metricsActive}/{system.metricsTotal} метрик активно
        </p>
        {system.isActive && system.startedBy && (
          <p className={`text-[10px] font-medium mt-0.5 ${isOtherOwner ? "text-amber-600" : "text-green-600"}`}>
            {isOwner ? "▶ Запущено вами" : `▶ Запустил: ${system.startedBy}`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={e => { e.stopPropagation(); onEdit(system); }}
          disabled={busy}
          className="p-1 rounded hover:bg-bg-muted text-text-muted hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
          title="Редактировать"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {isOtherOwner ? (
          <button
            onClick={e => { e.stopPropagation(); onRequest(system); }}
            className="p-1 rounded hover:bg-amber-50 text-amber-500 transition-colors"
            title="Отправить запрос владельцу"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={doToggle}
            disabled={busy}
            title={system.isActive ? "Остановить" : "Запустить"}
            className="p-1 rounded hover:bg-bg-muted transition-colors"
          >
            {busy
              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" />
              : system.isActive
                ? <Square className="w-3.5 h-3.5 text-orange-500" />
                : <Play className="w-3.5 h-3.5 text-green-500" />}
          </button>
        )}
        <button
          onClick={doDelete}
          disabled={busy}
          className="p-1 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${selected ? "text-primary rotate-90" : "text-text-muted"}`} />
      </div>
    </div>
  );
}

// ── Builder: Values Tab ───────────────────────────────────────────────────────

function ValuesTab({ metricId, initial, onSaved }: { metricId: number; initial: ValuesConfig; onSaved?: () => void }) {
  const [form, setForm] = useState<ValuesConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveValuesConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof ValuesConfig>(k: K, v: ValuesConfig[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={LABEL_CLS}>Паттерн генерации</label>
        <select className={INPUT_CLS} value={form.pattern}
          onChange={e => set("pattern", e.target.value as ValuesConfig["pattern"])}>
          <option value="constant">constant — постоянное значение</option>
          <option value="random">random — случайное в диапазоне</option>
          <option value="sine">sine — синусоида min↔max</option>
          <option value="spike">spike — базовое + редкие пики</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>{form.pattern === "constant" ? "Значение" : "Min"}</label>
          <input type="number" className={INPUT_CLS} value={form.value_min}
            onChange={e => set("value_min", Number(e.target.value))} />
        </div>
        {form.pattern !== "constant" && (
          <div>
            <label className={LABEL_CLS}>Max</label>
            <input type="number" className={INPUT_CLS} value={form.value_max}
              onChange={e => set("value_max", Number(e.target.value))} />
          </div>
        )}
      </div>

      {form.pattern === "sine" && (
        <div>
          <label className={LABEL_CLS}>Период синусоиды (мин)</label>
          <input type="number" min={1} className={INPUT_CLS} value={form.sine_period_min ?? 60}
            onChange={e => set("sine_period_min", Number(e.target.value))} />
          <p className="text-xs text-text-muted mt-1">Полный цикл min→max→min за указанное время</p>
        </div>
      )}

      {form.pattern === "spike" && (
        <div>
          <label className={LABEL_CLS}>Интервал спайков (мин)</label>
          <input type="number" min={1} className={INPUT_CLS} value={form.spike_interval_min ?? 15}
            onChange={e => set("spike_interval_min", Number(e.target.value))} />
          <p className="text-xs text-text-muted mt-1">Последние 5% интервала = max, остальное = min</p>
        </div>
      )}

      <SaveBar saving={saving} saved={saved} err={err} onSave={handleSave} />
    </div>
  );
}

// ── Builder: Baseline Tab ─────────────────────────────────────────────────────

function BaselineTab({ metricId, initial, onSaved }: { metricId: number; initial: BaselineConfig; onSaved?: () => void }) {
  const [form, setForm] = useState<BaselineConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveBaselineConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Toggle label="Базовая линия включена" value={form.enabled}
        onChange={v => setForm(p => ({ ...p, enabled: v }))} />

      {form.enabled && (
        <>
          <div>
            <label className={LABEL_CLS}>Метод расчёта</label>
            <select className={INPUT_CLS} value={form.calc_method}
              onChange={e => setForm(p => ({ ...p, calc_method: e.target.value as BaselineConfig["calc_method"] }))}>
              <option value="fixed">fixed — фиксированное значение</option>
              <option value="offset">offset — текущее значение + смещение</option>
            </select>
          </div>

          {form.calc_method === "fixed" && (
            <div>
              <label className={LABEL_CLS}>Фиксированное значение</label>
              <input type="number" className={INPUT_CLS} value={form.fixed_value ?? ""}
                onChange={e => setForm(p => ({ ...p, fixed_value: Number(e.target.value) }))} />
            </div>
          )}

          {form.calc_method === "offset" && (
            <div>
              <label className={LABEL_CLS}>Смещение</label>
              <input type="number" className={INPUT_CLS} value={form.offset_value ?? ""}
                onChange={e => setForm(p => ({ ...p, offset_value: Number(e.target.value) }))} />
              <p className="text-xs text-text-muted mt-1">Пример: −5 → baseline = value − 5</p>
            </div>
          )}
        </>
      )}

      <SaveBar saving={saving} saved={saved} err={err} onSave={handleSave} />
    </div>
  );
}

// ── Builder: Thresholds Tab ───────────────────────────────────────────────────

const EMPTY_ROW: ThresholdRow = { health_type: 3, min_value: null, max_value: null, is_percent: false };

function ThresholdsTab({ metricId, initial, onSaved }: { metricId: number; initial: ThresholdsConfig; onSaved?: () => void }) {
  const [form, setForm] = useState<ThresholdsConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveThresholdsConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => setForm(p => ({ ...p, rows: [...p.rows, { ...EMPTY_ROW }] }));
  const removeRow = (i: number) => setForm(p => ({ ...p, rows: p.rows.filter((_, idx) => idx !== i) }));
  const setRow = <K extends keyof ThresholdRow>(i: number, k: K, v: ThresholdRow[K]) =>
    setForm(p => ({ ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r) }));

  return (
    <div className="flex flex-col gap-4">
      <Toggle label="Пороговые значения включены" value={form.enabled}
        onChange={v => setForm(p => ({ ...p, enabled: v }))} />

      {form.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Комбинирование</label>
              <select className={INPUT_CLS} value={form.combination_selector}
                onChange={e => setForm(p => ({ ...p, combination_selector: e.target.value as ThresholdsConfig["combination_selector"] }))}>
                <option value="worst">worst — берётся худший статус</option>
                <option value="best">best — берётся лучший статус</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Тип порогов</label>
              <select className={INPUT_CLS} value={form.threshold_type}
                onChange={e => setForm(p => ({ ...p, threshold_type: e.target.value as ThresholdsConfig["threshold_type"] }))}>
                <option value="threshold">threshold — абсолютные</option>
                <option value="baseline">baseline — от базовой линии</option>
              </select>
            </div>
          </div>

          {/* Rows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={LABEL_CLS + " mb-0"}>Строки порогов</label>
              <button className={BTN_SM} onClick={addRow} disabled={form.rows.length >= 8}>
                <Plus className="w-3 h-3" /> Добавить
              </button>
            </div>

            {form.rows.length === 0 ? (
              <p className="text-xs text-text-muted py-3 text-center border border-dashed border-border-main rounded-lg">
                Нет строк — статус здоровья не будет рассчитан
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[110px_1fr_1fr_64px_24px] gap-1.5 px-1">
                  <span className="text-[10px] font-semibold text-text-muted uppercase">Статус</span>
                  <span className="text-[10px] font-semibold text-text-muted uppercase">Min</span>
                  <span className="text-[10px] font-semibold text-text-muted uppercase">Max</span>
                  <span className="text-[10px] font-semibold text-text-muted uppercase">%</span>
                  <span />
                </div>
                {form.rows.map((row, i) => {
                  const hl = HEALTH_LABELS[row.health_type] ?? HEALTH_LABELS[3];
                  return (
                    <div key={i} className="grid grid-cols-[110px_1fr_1fr_64px_24px] gap-1.5 items-center">
                      <select
                        className={`${INPUT_SM} font-semibold ${hl.cls} border`}
                        value={row.health_type}
                        onChange={e => setRow(i, "health_type", Number(e.target.value))}
                      >
                        {Object.entries(HEALTH_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{k} — {v.label}</option>
                        ))}
                      </select>
                      <input type="number" placeholder="−∞" className={INPUT_SM}
                        value={row.min_value ?? ""}
                        onChange={e => setRow(i, "min_value", e.target.value === "" ? null : Number(e.target.value))} />
                      <input type="number" placeholder="+∞" className={INPUT_SM}
                        value={row.max_value ?? ""}
                        onChange={e => setRow(i, "max_value", e.target.value === "" ? null : Number(e.target.value))} />
                      <label className="flex items-center gap-1 cursor-pointer justify-center">
                        <input type="checkbox" className="accent-primary"
                          checked={row.is_percent}
                          onChange={e => setRow(i, "is_percent", e.target.checked)} />
                        <span className="text-xs text-text-muted">%</span>
                      </label>
                      <button onClick={() => removeRow(i)}
                        className="p-0.5 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <SaveBar saving={saving} saved={saved} err={err} onSave={handleSave} />
    </div>
  );
}

// ── Builder: Health Tab ───────────────────────────────────────────────────────

function HealthTab({ metricId, initial, onSaved }: { metricId: number; initial: HealthConfig; onSaved?: () => void }) {
  const [form, setForm] = useState<HealthConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveHealthConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Toggle label="Статус здоровья включён" value={form.enabled}
        onChange={v => setForm(p => ({ ...p, enabled: v }))} />

      {form.enabled && (
        <>
          <div>
            <label className={LABEL_CLS}>Метод расчёта</label>
            <select className={INPUT_CLS} value={form.calc_method}
              onChange={e => setForm(p => ({ ...p, calc_method: e.target.value as HealthConfig["calc_method"] }))}>
              <option value="auto">auto — из пороговых значений</option>
              <option value="fixed">fixed — фиксированный статус</option>
              <option value="pattern">pattern — паттерн поведения</option>
            </select>
          </div>

          {form.calc_method === "fixed" && (
            <div>
              <label className={LABEL_CLS}>Фиксированный статус (1–5)</label>
              <select className={INPUT_CLS} value={form.fixed_status ?? 1}
                onChange={e => setForm(p => ({ ...p, fixed_status: Number(e.target.value) }))}>
                {Object.entries(HEALTH_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{k} — {v.label}</option>
                ))}
              </select>
            </div>
          )}

          {form.calc_method === "pattern" && (
            <>
              <div>
                <label className={LABEL_CLS}>Паттерн</label>
                <select className={INPUT_CLS} value={form.health_pattern ?? "stable_ok"}
                  onChange={e => setForm(p => ({ ...p, health_pattern: e.target.value as HealthConfig["health_pattern"] }))}>
                  <option value="stable_ok">stable_ok — всегда OK (1)</option>
                  <option value="degrading">degrading — деградация 1→5</option>
                  <option value="flapping">flapping — мерцание 1↔3</option>
                </select>
              </div>

              {form.health_pattern === "degrading" && (
                <div>
                  <label className={LABEL_CLS}>Время деградации (часов)</label>
                  <input type="number" min={1} className={INPUT_CLS} value={form.degrade_hours ?? 4}
                    onChange={e => setForm(p => ({ ...p, degrade_hours: Number(e.target.value) }))} />
                  <p className="text-xs text-text-muted mt-1">За это время статус пройдёт путь от 1 (OK) до 5 (Critical)</p>
                </div>
              )}

              {form.health_pattern === "flapping" && (
                <div>
                  <label className={LABEL_CLS}>Интервал мерцания (мин)</label>
                  <input type="number" min={1} className={INPUT_CLS} value={form.flap_interval_min ?? 5}
                    onChange={e => setForm(p => ({ ...p, flap_interval_min: Number(e.target.value) }))} />
                  <p className="text-xs text-text-muted mt-1">Чередование OK/Warning каждые N минут</p>
                </div>
              )}
            </>
          )}

          {form.calc_method === "auto" && (
            <p className="text-xs text-text-muted p-3 bg-bg-subtle rounded-lg border border-border-main">
              Статус рассчитывается автоматически на основе вкладки «Пороги».
              Если пороги не настроены — возвращается 1 (OK).
            </p>
          )}
        </>
      )}

      <SaveBar saving={saving} saved={saved} err={err} onSave={handleSave} />
    </div>
  );
}

// ── Builder: Logs Section ─────────────────────────────────────────────────────

function LogsSection({ logs, loading }: { logs: LogEntry[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-text-muted" /></div>;
  if (logs.length === 0) return (
    <p className="text-xs text-text-muted text-center py-3">Нет истории отправок</p>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {logs.map(log => {
        const hl = log.healthSent != null ? HEALTH_LABELS[log.healthSent] : null;
        return (
          <div key={log.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-bg-subtle text-xs">
            <span className="text-text-muted w-20 shrink-0 tabular-nums">{fmtTime(log.sentAt)}</span>
            <span className="text-text-main w-16 shrink-0 tabular-nums font-mono">
              {log.valueSent != null ? log.valueSent.toFixed(2) : "—"}
            </span>
            {hl ? (
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${hl.cls}`}>{hl.label}</span>
            ) : (
              <span className="px-1.5 py-0.5 rounded border text-[10px] text-text-muted border-border-main">—</span>
            )}
            <span className="flex-1 text-text-muted tabular-nums">
              {log.kafkaOffset != null ? `offset ${log.kafkaOffset}` : ""}
            </span>
            <span className={log.status === "success" ? "text-green-500" : "text-red-500"}>
              {log.status === "success" ? "●" : "✕"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Builder Panel ─────────────────────────────────────────────────────────────

type BuilderTabKey = "values" | "baseline" | "thresholds" | "health";

const BUILDER_TABS: { key: BuilderTabKey; label: string }[] = [
  { key: "values",     label: "Значения"  },
  { key: "baseline",   label: "Базалайн"  },
  { key: "thresholds", label: "Пороги"    },
  { key: "health",     label: "Здоровье"  },
];

interface BuilderPanelProps {
  metricId: number;
  onClose:  () => void;
  onSaved?: () => void;
}

function BuilderPanel({ metricId, onClose, onSaved }: BuilderPanelProps) {
  const [config,      setConfig]      = useState<BuilderConfig | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<BuilderTabKey>("values");
  const [sending,     setSending]     = useState(false);
  const [sendResult,  setSendResult]  = useState<SendNowResult | null>(null);
  const [previewing,  setPreviewing]  = useState(false);
  const [preview,     setPreview]     = useState<PreviewResult | null>(null);
  const [logs,        setLogs]        = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setConfig(null);
    try {
      const [cfg, ls] = await Promise.all([
        getMetricBuilder(metricId),
        getMetricLogs(metricId, 5),
      ]);
      setConfig(cfg);
      setLogs(ls);
    } catch {
      // handled by null config check
    } finally {
      setLoading(false);
    }
  }, [metricId]);

  useEffect(() => { load(); }, [load]);

  const refreshLogs = () => {
    setLogsLoading(true);
    getMetricLogs(metricId, 5).then(setLogs).catch(() => {}).finally(() => setLogsLoading(false));
  };

  const handleSendNow = async () => {
    setSending(true); setSendResult(null); setPreview(null);
    try {
      const r = await sendNow(metricId);
      setSendResult(r);
      setTimeout(refreshLogs, 500);
    } finally {
      setSending(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true); setPreview(null); setSendResult(null);
    try {
      const r = await previewMessage(metricId);
      setPreview(r);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border-main bg-bg-subtle">
        <div className="flex-1 min-w-0">
          {config ? (
            <>
              <p className="text-sm font-semibold text-text-main truncate">{config.metricName}</p>
              <p className="text-xs text-text-muted">период {config.metricPeriodSec}с
                {" · "}
                <span className={config.isActive ? "text-green-600" : "text-text-muted"}>
                  {config.isActive ? "● активна" : "○ остановлена"}
                </span>
              </p>
            </>
          ) : (
            <p className="text-sm text-text-muted">Конфигуратор</p>
          )}
        </div>
        <button className={BTN_SM} onClick={handlePreview} disabled={previewing || loading}>
          {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
          Превью
        </button>
        <button className={BTN_PRIMARY} onClick={handleSendNow} disabled={sending || loading}>
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Отправить
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-bg-muted text-text-muted transition-colors ml-1" title="Закрыть">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Send / Preview result */}
      {sendResult && (
        <div className={`shrink-0 mx-4 mt-3 px-3 py-2 rounded-lg border text-xs flex items-start gap-2 ${
          sendResult.ok
            ? "bg-green-50 border-green-200 text-green-700"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {sendResult.ok
            ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            : <XCircle    className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            {sendResult.ok ? (
              <span>
                Отправлено · value={sendResult.value?.toFixed(4)}
                {sendResult.health != null && ` · health=${sendResult.health}`}
                {sendResult.offset != null && ` · offset=${sendResult.offset}`}
                {sendResult.topic && ` · topic=${sendResult.topic}`}
              </span>
            ) : (
              <span>{sendResult.error ?? "Ошибка отправки"}</span>
            )}
          </div>
          <button onClick={() => setSendResult(null)} className="shrink-0 text-current/60 hover:text-current">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {preview && (
        <div className="shrink-0 mx-4 mt-3 border border-border-main rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-bg-subtle border-b border-border-main">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Превью сообщения</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-text-main">value=<strong>{preview.value.toFixed(4)}</strong></span>
              {preview.baseline != null && <span className="text-text-muted">baseline={preview.baseline.toFixed(4)}</span>}
              {preview.health   != null && (
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${(HEALTH_LABELS[preview.health] ?? HEALTH_LABELS[1]).cls}`}>
                  {(HEALTH_LABELS[preview.health] ?? HEALTH_LABELS[1]).label}
                </span>
              )}
              <button onClick={() => setPreview(null)} className="text-text-muted hover:text-text-main"><X className="w-3 h-3" /></button>
            </div>
          </div>
          <pre className="text-xs font-mono p-3 max-h-48 overflow-y-auto bg-white text-text-main leading-relaxed">
            {preview.message_json}
          </pre>
        </div>
      )}

      {/* Loading / Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : !config ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
          <XCircle className="w-8 h-8 text-text-muted/40" />
          <p className="text-sm text-text-muted">Не удалось загрузить конфигурацию</p>
          <button className={BTN_GHOST} onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Повторить</button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-4 pt-3 pb-0">
            {BUILDER_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border-x border-t transition-colors ${
                  tab === t.key
                    ? "bg-white border-border-main text-text-main"
                    : "border-transparent text-text-muted hover:text-text-main hover:bg-bg-subtle"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="border border-border-main rounded-b-xl rounded-tr-xl mx-4 p-4 bg-white">
            {tab === "values"     && <ValuesTab     metricId={metricId} initial={config.valuesConfig}     onSaved={onSaved} />}
            {tab === "baseline"   && <BaselineTab   metricId={metricId} initial={config.baselineConfig}   onSaved={onSaved} />}
            {tab === "thresholds" && <ThresholdsTab metricId={metricId} initial={config.thresholdsConfig} onSaved={onSaved} />}
            {tab === "health"     && <HealthTab     metricId={metricId} initial={config.healthConfig}     onSaved={onSaved} />}
          </div>

          {/* Logs section */}
          <div className="mx-4 mt-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wide flex items-center gap-1.5">
                История отправок
              </span>
              <button className={BTN_SM} onClick={refreshLogs} disabled={logsLoading}>
                <RefreshCw className={`w-3 h-3 ${logsLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <LogsSection logs={logs} loading={logsLoading} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MetricsSection() {
  const [tab,              setTab]              = useState<"systems" | "kafka">("systems");
  const [systems,          setSystems]          = useState<System[]>([]);
  const [stats,            setStats]            = useState({ totalSystems: 0, activeSystems: 0, totalMetrics: 0, activeMetrics: 0 });
  const [selectedId,       setSelectedId]       = useState<number | null>(null);
  const [metrics,          setMetrics]          = useState<Metric[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [metricsLoading,   setMetricsLoading]   = useState(false);
  const [error,            setError]            = useState("");
  const [showAddSystem,    setShowAddSystem]     = useState(false);
  const [showBatchMetrics, setShowBatchMetrics]  = useState(false);
  const [globalBusy,       setGlobalBusy]       = useState(false);
  const [selectedMetricId, setSelectedMetricId] = useState<number | null>(null);
  const [editingMetric,    setEditingMetric]     = useState<Metric | null>(null);
  const [editingSystem,    setEditingSystem]     = useState<System | null>(null);
  const [currentUser,      setCurrentUser]       = useState<string | null>(null);
  const [requests,         setRequests]          = useState<AccessRequest[]>([]);
  const [requestModal,     setRequestModal]      = useState<System | null>(null);
  const [showNotif,        setShowNotif]         = useState(false);

  // ── Load current user ─────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(d => setCurrentUser((d as { username: string }).username))
      .catch(() => {});
    getMyRequests().then(setRequests).catch(() => {});
  }, []);

  // ── Load systems ──────────────────────────────────────────────────────────

  const loadSystems = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const d = await getSystems();
      setSystems(d.systems);
      setStats({ totalSystems: d.totalSystems, activeSystems: d.activeSystems, totalMetrics: d.totalMetrics, activeMetrics: d.activeMetrics });
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadSystems(); }, [loadSystems]);

  const reloadMetrics = useCallback(() => {
    if (selectedId == null) return;
    getSystemMetrics(selectedId).then(setMetrics).catch(() => {});
  }, [selectedId]);

  // ── Load metrics for selected system ─────────────────────────────────────

  useEffect(() => {
    if (selectedId == null) { setMetrics([]); setSelectedMetricId(null); return; }
    setMetricsLoading(true);
    getSystemMetrics(selectedId)
      .then(setMetrics)
      .catch(() => setMetrics([]))
      .finally(() => setMetricsLoading(false));
    setSelectedMetricId(null);
  }, [selectedId]);

  // ── Auto-poll: обновляем lastSentAt + lastSentValue каждые 30 сек ─────────

  useEffect(() => {
    if (selectedId == null) return;
    const intervalId = setInterval(() => {
      getSystemMetrics(selectedId)
        .then(fresh => {
          setMetrics(prev => prev.map(m => {
            const f = fresh.find(u => u.id === m.id);
            if (!f) return m;
            return { ...m, lastSentAt: f.lastSentAt, lastSentValue: f.lastSentValue, lastSentHealth: f.lastSentHealth };
          }));
        })
        .catch(() => {});
      loadSystems(true);
      getMyRequests().then(setRequests).catch(() => {});
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [selectedId, loadSystems]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSystemToggle = async (id: number) => {
    try {
      const r = await toggleSystem(id);
      setSystems(prev => prev.map(s => {
        if (s.id !== id) return s;
        return { ...s, isActive: r.isActive, startedBy: r.startedBy ?? null, startedAt: r.startedAt ?? null, metricsActive: r.isActive ? s.metricsTotal : 0 };
      }));
      if (id === selectedId) {
        setMetrics(prev => prev.map(m => ({ ...m, isActive: r.isActive })));
      }
      loadSystems(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      setError(msg);
      setTimeout(() => setError(""), 4000);
    }
  };

  const handleSystemDelete = async (id: number) => {
    await deleteSystem(id);
    if (selectedId === id) { setSelectedId(null); setSelectedMetricId(null); }
    await loadSystems();
  };

  const handleMetricToggle = async (id: number) => {
    const r = await toggleMetric(id);
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, isActive: r.isActive } : m));
    // Обновляем счётчик metricsActive в карточке услуги
    setSystems(prev => prev.map(s => {
      if (s.id !== selectedId) return s;
      const delta = r.isActive ? 1 : -1;
      return { ...s, metricsActive: Math.max(0, Math.min(s.metricsTotal, s.metricsActive + delta)) };
    }));
  };

  const handleMetricDelete = async (id: number) => {
    await deleteMetric(id);
    if (selectedMetricId === id) setSelectedMetricId(null);
    setMetrics(prev => prev.filter(m => m.id !== id));
    await loadSystems();
  };

  const handleToggleAll = async (action: "start" | "stop") => {
    setGlobalBusy(true);
    try {
      await toggleAll(action);
      const isActive = action === "start";
      // Locally flip all metrics of the selected system
      setMetrics(prev => prev.map(m => ({ ...m, isActive })));
      // Reload everything silently to get accurate counts
      await loadSystems(true);
    } finally {
      setGlobalBusy(false);
    }
  };

  const handleSystemSaved = (updated: System) => {
    setSystems(prev => prev.map(s => s.id === updated.id ? updated : s));
    setEditingSystem(null);
  };

  const handleMetricSaved = (updated: Metric) => {
    setMetrics(prev => prev.map(m => m.id === updated.id ? updated : m));
    setEditingMetric(null);
  };

  const selectedSystem = systems.find(s => s.id === selectedId) ?? null;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
    </div>
  );

  if (error) return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
        <Database className="w-6 h-6 text-red-400" />
      </div>
      <div>
        <p className="font-semibold text-text-main mb-1">PostgreSQL недоступен</p>
        <p className="text-sm text-text-muted mb-3">{error}</p>
        <code className="block text-xs bg-bg-subtle border border-border-main rounded-lg px-3 py-2 text-left text-text-main">
          docker compose up -d
        </code>
      </div>
      <button className={BTN_GHOST} onClick={() => loadSystems()}>
        <RefreshCw className="w-3.5 h-3.5" /> Повторить
      </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 grid grid-cols-4 gap-3 p-4 border-b border-border-main">
        {[
          { label: "Услуг всего",    value: stats.totalSystems  },
          { label: "Услуг активно",  value: stats.activeSystems,  accent: true },
          { label: "Метрик всего",   value: stats.totalMetrics  },
          { label: "Метрик активно", value: stats.activeMetrics, accent: true },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-bg-subtle rounded-xl px-3 py-2.5 border border-border-main">
            <p className="text-xs text-text-muted">{label}</p>
            <p className={`text-xl font-bold ${accent ? "text-primary" : "text-text-main"}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border-main">
        <button className={BTN_PRIMARY} onClick={() => setShowAddSystem(true)}>
          <Plus className="w-3.5 h-3.5" /> Услуга
        </button>
        <button className={BTN_GHOST} onClick={() => handleToggleAll("start")} disabled={globalBusy}>
          <Play className="w-3.5 h-3.5 text-green-500" /> Все старт
        </button>
        <button className={BTN_GHOST} onClick={() => handleToggleAll("stop")} disabled={globalBusy}>
          <Square className="w-3.5 h-3.5 text-orange-500" /> Все стоп
        </button>
        <button className={BTN_GHOST} onClick={() => loadSystems()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Обновить
        </button>

        {/* Колокол уведомлений */}
        <div className="relative">
          <button
            className={`relative p-1.5 rounded-lg border transition-colors ${
              showNotif ? "border-primary bg-primary/5 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"
            }`}
            onClick={() => setShowNotif(v => !v)}
            title="Входящие запросы"
          >
            <Bell className="w-4 h-4" />
            {requests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {requests.length}
              </span>
            )}
          </button>

          {showNotif && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-border-main rounded-xl shadow-xl z-40 overflow-hidden">
              <div className="px-4 py-3 border-b border-border-main flex items-center justify-between">
                <p className="text-sm font-semibold text-text-main">Входящие запросы</p>
                <button onClick={() => setShowNotif(false)}><X className="w-4 h-4 text-text-muted" /></button>
              </div>
              {requests.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-8">Нет новых запросов</p>
              ) : (
                <div className="flex flex-col divide-y divide-border-main max-h-80 overflow-y-auto">
                  {requests.map(req => (
                    <div key={req.id} className="px-4 py-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-text-main">{req.fromUser}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                          req.reqType === "stop"
                            ? "bg-orange-50 text-orange-700 border-orange-200"
                            : "bg-blue-50 text-blue-700 border-blue-200"
                        }`}>
                          {req.reqType === "stop" ? "Остановить" : "Добавить"}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">Услуга: <span className="font-medium text-text-main">{req.systemName}</span></p>
                      {req.message && <p className="text-xs text-text-muted italic">«{req.message}»</p>}
                      <button
                        className={BTN_SM + " self-end mt-1"}
                        onClick={async () => {
                          await resolveRequest(req.id);
                          setRequests(prev => prev.filter(r => r.id !== req.id));
                        }}
                      >
                        <CheckCircle className="w-3 h-3 text-green-500" /> Принято
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 p-0.5 bg-bg-subtle border border-border-main rounded-lg">
          <button
            onClick={() => setTab("systems")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === "systems" ? "bg-white shadow-sm text-text-main" : "text-text-muted hover:text-text-main"
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" /> Услуги
          </button>
          <button
            onClick={() => setTab("kafka")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === "kafka" ? "bg-white shadow-sm text-text-main" : "text-text-muted hover:text-text-main"
            }`}
          >
            <Wifi className="w-3.5 h-3.5" /> Kafka
          </button>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">

        {tab === "kafka" ? (
          <div className="h-full overflow-y-auto p-4">
            <KafkaSettingsTab />
          </div>
        ) : (
          <div className="h-full flex">

            {/* Systems list */}
            <div className="w-72 shrink-0 border-r border-border-main overflow-y-auto flex flex-col gap-1 p-2">
              {systems.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-4">
                  <Settings2 className="w-8 h-8 text-text-muted/40" />
                  <p className="text-xs text-text-muted">Добавьте первую услугу</p>
                </div>
              ) : (
                systems.map(s => (
                  <SystemCard
                    key={s.id}
                    system={s}
                    selected={selectedId === s.id}
                    onSelect={() => setSelectedId(s.id)}
                    onToggle={handleSystemToggle}
                    onDelete={handleSystemDelete}
                    onEdit={setEditingSystem}
                    currentUser={currentUser}
                    onRequest={setRequestModal}
                  />
                ))
              )}
            </div>

            {/* Metrics panel */}
            <div className={`${selectedMetricId != null ? "w-80" : "flex-1"} shrink-0 border-r border-border-main overflow-hidden flex flex-col transition-all`}>
              {!selectedSystem ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
                  <ChevronRight className="w-8 h-8 text-text-muted/40 -rotate-90" />
                  <p className="text-sm text-text-muted">Выберите услугу слева</p>
                </div>
              ) : (
                <>
                  {/* Metrics toolbar */}
                  <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-border-main bg-bg-subtle">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-main truncate">{selectedSystem.name}</p>
                      <p className="text-xs text-text-muted truncate">{selectedSystem.itServiceCi}</p>
                    </div>
                    <button className={BTN_PRIMARY} onClick={() => setShowBatchMetrics(true)}>
                      <Plus className="w-3.5 h-3.5" /> Добавить метрики
                    </button>
                  </div>

                  {/* Metrics list */}
                  <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
                    {metricsLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                      </div>
                    ) : metrics.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                        <BarChart2 className="w-8 h-8 text-text-muted/40" />
                        <p className="text-sm text-text-muted">Нет метрик</p>
                        <button className={BTN_GHOST} onClick={() => setShowBatchMetrics(true)}>
                          <Plus className="w-3.5 h-3.5" /> Добавить метрики
                        </button>
                      </div>
                    ) : (
                      metrics.map(m => (
                        <MetricRow
                          key={m.id}
                          metric={m}
                          selected={selectedMetricId === m.id}
                          onSelect={() => setSelectedMetricId(prev => prev === m.id ? null : m.id)}
                          onToggle={handleMetricToggle}
                          onDelete={handleMetricDelete}
                          onEdit={setEditingMetric}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Builder panel */}
            {selectedMetricId != null && (
              <div className="flex-1 overflow-hidden">
                <BuilderPanel
                  key={selectedMetricId}
                  metricId={selectedMetricId}
                  onClose={() => setSelectedMetricId(null)}
                  onSaved={reloadMetrics}
                />
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showAddSystem && (
        <AddSystemModal
          onSave={s => { setSystems(prev => [...prev, s]); setStats(p => ({ ...p, totalSystems: p.totalSystems + 1 })); setShowAddSystem(false); }}
          onClose={() => setShowAddSystem(false)}
        />
      )}

      {showBatchMetrics && selectedId != null && selectedSystem != null && (
        <BatchAddMetricsModal
          systemId={selectedId}
          systemName={selectedSystem.name}
          onDone={created => {
            setMetrics(prev => [...created, ...prev]);
            setShowBatchMetrics(false);
            loadSystems();
          }}
          onClose={() => setShowBatchMetrics(false)}
        />
      )}

      {editingSystem && (
        <EditSystemModal
          system={editingSystem}
          onSave={handleSystemSaved}
          onClose={() => setEditingSystem(null)}
        />
      )}

      {editingMetric && (
        <EditMetricModal
          metric={editingMetric}
          onSave={handleMetricSaved}
          onClose={() => setEditingMetric(null)}
        />
      )}

      {requestModal && (
        <RequestModal
          system={requestModal}
          onClose={() => setRequestModal(null)}
        />
      )}

    </div>
  );
}
