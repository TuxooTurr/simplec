"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart2, Plus, Trash2, Play, Square, Settings2,
  Loader2, RefreshCw, ChevronRight, ToggleLeft, ToggleRight,
  AlertTriangle, Database, Wifi, Save, X,
} from "lucide-react";
import {
  getSystems, createSystem, deleteSystem, toggleSystem, toggleAll,
  getSystemMetrics, createMetric, deleteMetric, toggleMetric,
  getMetricsSettings, saveMetricsSettings,
  type System, type Metric, type MetricCreate, type SettingsMap,
} from "@/lib/metricsApi";

// ── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150 bg-white";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

const BTN_PRIMARY =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm " +
  "font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BTN_GHOST =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm " +
  "text-text-main hover:bg-bg-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

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
  metric:     Metric;
  onToggle:   (id: number) => Promise<void>;
  onDelete:   (id: number) => Promise<void>;
}

function MetricRow({ metric, onToggle, onDelete }: MetricRowProps) {
  const [busy, setBusy] = useState(false);

  const doToggle = async () => {
    setBusy(true);
    try { await onToggle(metric.id); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!confirm(`Удалить метрику «${metric.metricName}»?`)) return;
    setBusy(true);
    try { await onDelete(metric.id); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-bg-subtle group transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-main truncate">{metric.metricName}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
            {metric.metricType}
          </span>
          {metric.metricUnit && (
            <span className="text-[10px] text-text-muted">{metric.metricUnit}</span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100 font-semibold">
            AI-AGENT
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-xs text-text-muted truncate">{metric.objectName} · {metric.objectId}</span>
          <span className="text-xs text-text-muted">{metric.metricPeriodSec}с</span>
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
    if (selectedId == null) { setMetrics([]); return; }
    setMetricsLoading(true);
    getSystemMetrics(selectedId)
      .then(setMetrics)
      .catch(() => setMetrics([]))
      .finally(() => setMetricsLoading(false));
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
    if (selectedId === id) setSelectedId(null);
    await loadSystems();
  };

  const handleMetricToggle = async (id: number) => {
    const r = await toggleMetric(id);
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, isActive: r.isActive } : m));
  };

  const handleMetricDelete = async (id: number) => {
    await deleteMetric(id);
    setMetrics(prev => prev.filter(m => m.id !== id));
    await loadSystems(); // refresh counts
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

  // ── Selected system ───────────────────────────────────────────────────────

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
            <div className="w-64 shrink-0 border-r border-border-main overflow-y-auto flex flex-col gap-1 p-2">
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
            <div className="flex-1 overflow-hidden flex flex-col">
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
                      <p className="text-xs text-text-muted">{selectedSystem.itServiceCi} · {selectedSystem.monSystemCi}</p>
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
                          onToggle={handleMetricToggle}
                          onDelete={handleMetricDelete}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

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
