"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart2, Plus, Trash2, Play, Square, Settings2,
  Loader2, RefreshCw, ChevronRight, ToggleLeft, ToggleRight,
  AlertTriangle, Database, Wifi, Save, X, Zap, Eye,
  CheckCircle, XCircle,
} from "lucide-react";
import {
  getSystems, createSystem, deleteSystem, toggleSystem, toggleAll,
  getSystemMetrics, createMetric, deleteMetric, toggleMetric,
  getMetricsSettings, saveMetricsSettings,
  getMetricBuilder, saveValuesConfig, saveBaselineConfig,
  saveThresholdsConfig, saveHealthConfig, sendNow, previewMessage, getMetricLogs,
  type System, type Metric, type MetricCreate, type SettingsMap,
  type BuilderConfig, type ValuesConfig, type BaselineConfig,
  type ThresholdsConfig, type ThresholdRow, type HealthConfig,
  type LogEntry, type SendNowResult, type PreviewResult,
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

// ── Modal: Add Metric ────────────────────────────────────────────────────────

interface AddMetricModalProps {
  systemId: number;
  onSave:   (m: Metric) => void;
  onClose:  () => void;
}

function AddMetricModal({ systemId, onSave, onClose }: AddMetricModalProps) {
  const [form, setForm] = useState<MetricCreate>({
    metricName:        "",
    metricDescription: "",
    metricType:        "GAUGE",
    metricGroup:       "",
    metricUnit:        "",
    metricPeriodSec:   60,
    objectId:          "",
    objectName:        "",
    monSystemMetricId: "",
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  const set = (k: keyof MetricCreate, v: string | number) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setErr("");
    if (!form.metricName || !form.objectId || !form.objectName || !form.monSystemMetricId) {
      setErr("Название, Object ID, Object Name и Metric ID в системе мониторинга — обязательны");
      return;
    }
    if (form.metricPeriodSec < 10) {
      setErr("Период не может быть менее 10 секунд");
      return;
    }
    setSaving(true);
    try {
      const m = await createMetric(systemId, form);
      onSave(m);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-main">Добавить метрику</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL_CLS}>Название метрики *</label>
            <input className={INPUT_CLS} placeholder="CPU usage" value={form.metricName}
              onChange={e => set("metricName", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>Описание</label>
            <input className={INPUT_CLS} placeholder="Загрузка процессора" value={form.metricDescription}
              onChange={e => set("metricDescription", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Тип метрики</label>
            <select className={INPUT_CLS} value={form.metricType}
              onChange={e => set("metricType", e.target.value)}>
              {["GAUGE","COUNTER","HISTOGRAM","SUMMARY","BOOLEAN"].map(t =>
                <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Группа</label>
            <input className={INPUT_CLS} placeholder="system" value={form.metricGroup}
              onChange={e => set("metricGroup", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Единица измерения</label>
            <input className={INPUT_CLS} placeholder="%" value={form.metricUnit}
              onChange={e => set("metricUnit", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Период (сек) *</label>
            <input className={INPUT_CLS} type="number" min={10} value={form.metricPeriodSec}
              onChange={e => set("metricPeriodSec", Number(e.target.value))} />
          </div>

          <div className="col-span-2 border-t border-border-main pt-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Объект мониторинга</p>
          </div>

          <div>
            <label className={LABEL_CLS}>Object ID *</label>
            <input className={INPUT_CLS} placeholder="server-01" value={form.objectId}
              onChange={e => set("objectId", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Object Name *</label>
            <input className={INPUT_CLS} placeholder="Сервер 01" value={form.objectName}
              onChange={e => set("objectName", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Object CI</label>
            <input className={INPUT_CLS} placeholder="CI00000003" value={form.objectCi ?? ""}
              onChange={e => set("objectCi", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Object Type</label>
            <input className={INPUT_CLS} placeholder="host" value={form.objectType ?? ""}
              onChange={e => set("objectType", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>ID метрики в системе мониторинга *</label>
            <input className={INPUT_CLS} placeholder="cpu.usage.percent" value={form.monSystemMetricId}
              onChange={e => set("monSystemMetricId", e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Spec Version</label>
            <input className={INPUT_CLS} placeholder="1.0" value={form.specVersion ?? ""}
              onChange={e => set("specVersion", e.target.value)} />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className={BTN_GHOST} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Создать метрику
          </button>
        </div>
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

// ── Metric Row ───────────────────────────────────────────────────────────────

interface MetricRowProps {
  metric:    Metric;
  selected:  boolean;
  onSelect:  () => void;
  onToggle:  (id: number) => Promise<void>;
  onDelete:  (id: number) => Promise<void>;
}

function MetricRow({ metric, selected, onSelect, onToggle, onDelete }: MetricRowProps) {
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
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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

interface SystemCardProps {
  system:     System;
  selected:   boolean;
  onSelect:   () => void;
  onToggle:   (id: number) => Promise<void>;
  onDelete:   (id: number) => Promise<void>;
}

function SystemCard({ system, selected, onSelect, onToggle, onDelete }: SystemCardProps) {
  const [busy, setBusy] = useState(false);

  const doToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      className={`flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors border ${
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
      </div>
      <div className="flex items-center gap-1 shrink-0">
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

function ValuesTab({ metricId, initial }: { metricId: number; initial: ValuesConfig }) {
  const [form, setForm] = useState<ValuesConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveValuesConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
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

function BaselineTab({ metricId, initial }: { metricId: number; initial: BaselineConfig }) {
  const [form, setForm] = useState<BaselineConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveBaselineConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
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

function ThresholdsTab({ metricId, initial }: { metricId: number; initial: ThresholdsConfig }) {
  const [form, setForm] = useState<ThresholdsConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveThresholdsConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
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

function HealthTab({ metricId, initial }: { metricId: number; initial: HealthConfig }) {
  const [form, setForm] = useState<HealthConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try {
      await saveHealthConfig(metricId, form);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
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
}

function BuilderPanel({ metricId, onClose }: BuilderPanelProps) {
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
            {tab === "values"     && <ValuesTab     metricId={metricId} initial={config.valuesConfig}     />}
            {tab === "baseline"   && <BaselineTab   metricId={metricId} initial={config.baselineConfig}   />}
            {tab === "thresholds" && <ThresholdsTab metricId={metricId} initial={config.thresholdsConfig} />}
            {tab === "health"     && <HealthTab     metricId={metricId} initial={config.healthConfig}     />}
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
  const [showAddMetric,    setShowAddMetric]     = useState(false);
  const [globalBusy,       setGlobalBusy]       = useState(false);
  const [selectedMetricId, setSelectedMetricId] = useState<number | null>(null);

  // ── Load systems ──────────────────────────────────────────────────────────

  const loadSystems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await getSystems();
      setSystems(d.systems);
      setStats({ totalSystems: d.totalSystems, activeSystems: d.activeSystems, totalMetrics: d.totalMetrics, activeMetrics: d.activeMetrics });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSystems(); }, [loadSystems]);

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

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSystemToggle = async (id: number) => {
    const r = await toggleSystem(id);
    setSystems(prev => prev.map(s => s.id === id ? { ...s, isActive: r.isActive } : s));
    setStats(prev => ({
      ...prev,
      activeSystems: r.isActive ? prev.activeSystems + 1 : prev.activeSystems - 1,
    }));
  };

  const handleSystemDelete = async (id: number) => {
    await deleteSystem(id);
    if (selectedId === id) { setSelectedId(null); setSelectedMetricId(null); }
    await loadSystems();
  };

  const handleMetricToggle = async (id: number) => {
    const r = await toggleMetric(id);
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, isActive: r.isActive } : m));
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
      await loadSystems();
    } finally {
      setGlobalBusy(false);
    }
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
      <button className={BTN_GHOST} onClick={loadSystems}>
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
        <button className={BTN_GHOST} onClick={loadSystems} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Обновить
        </button>

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
            <div className="w-52 shrink-0 border-r border-border-main overflow-y-auto flex flex-col gap-1 p-2">
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
                  />
                ))
              )}
            </div>

            {/* Metrics panel */}
            <div className={`${selectedMetricId != null ? "w-64" : "flex-1"} shrink-0 border-r border-border-main overflow-hidden flex flex-col transition-all`}>
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
                    <button className={BTN_PRIMARY} onClick={() => setShowAddMetric(true)}>
                      <Plus className="w-3.5 h-3.5" /> Метрика
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
                        <button className={BTN_GHOST} onClick={() => setShowAddMetric(true)}>
                          <Plus className="w-3.5 h-3.5" /> Добавить первую метрику
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

      {showAddMetric && selectedId != null && (
        <AddMetricModal
          systemId={selectedId}
          onSave={m => { setMetrics(prev => [...prev, m]); setShowAddMetric(false); loadSystems(); }}
          onClose={() => setShowAddMetric(false)}
        />
      )}

    </div>
  );
}
