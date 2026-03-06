"use client";

import { useState, useEffect, useCallback } from "react";
import { Scale, Search, Settings, RefreshCw, X, AlertCircle } from "lucide-react";
import {
  getRevisorData, getStands,
  podStatus, rowMatchStatus,
  type RevisorData, type StandConfig, type PodInfo, type PodStatus,
} from "@/lib/revisorApi";

/* ── Shared style constants (same as Metrics/Alerts/Generation) ── */
const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150 bg-white";

/* ── Status colour maps ──────────────────────────────────────────── */
const POD_DOT: Record<PodStatus, string> = {
  green:  "bg-green-500",
  yellow: "bg-amber-400",
  red:    "bg-red-500",
  grey:   "bg-gray-300",
};

// Left border accent on the service-name cell
const ROW_ACCENT: Record<"green" | "yellow" | "grey", string> = {
  green:  "border-l-2 border-l-green-400",
  yellow: "border-l-2 border-l-amber-400",
  grey:   "border-l-2 border-l-transparent",
};

// Subtle row background tint
const ROW_TINT: Record<"green" | "yellow" | "grey", string> = {
  green:  "bg-green-50/30",
  yellow: "bg-amber-50/30",
  grey:   "",
};

// Badge for the match-status column
const ROW_BADGE: Record<"green" | "yellow" | "grey", { cls: string; label: string }> = {
  green:  { cls: "text-green-700  bg-green-50  border border-green-200",  label: "Синхр." },
  yellow: { cls: "text-amber-700  bg-amber-50  border border-amber-200",  label: "Расх."  },
  grey:   { cls: "text-gray-500   bg-gray-50   border border-gray-200",   label: "—"       },
};

/* ── Pod cell ─────────────────────────────────────────────────────── */
function PodCell({ info }: { info: PodInfo | undefined }) {
  if (!info) {
    return <span className="text-xs text-text-muted/40">—</span>;
  }
  const st = podStatus(info);
  const noData = info.total === 0 && !info.version;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${POD_DOT[st]}`} />
      <div className="min-w-0 flex flex-col">
        <span className={`text-xs font-mono truncate ${noData ? "text-text-muted/50" : "text-text-main"}`}>
          {info.version || "—"}
        </span>
        {info.total > 0 && (
          <span className="text-[10px] text-text-muted tabular-nums leading-tight">
            {info.running}/{info.total} pod
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Settings modal ────────────────────────────────────────────────── */
function SettingsModal({ stands, onClose }: { stands: StandConfig[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-border-main w-full max-w-md p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-main flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            Подключение к стендам
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stand cards */}
        <div className="space-y-2.5">
          {stands.map(s => (
            <div key={s.name} className="rounded-xl border border-border-main p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.connected ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="text-sm font-semibold text-text-main">{s.name}</span>
                <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full border ${
                  s.connected
                    ? "text-green-700 bg-green-50 border-green-200"
                    : "text-gray-500 bg-gray-50 border-gray-200"
                }`}>
                  {s.connected ? "Подключён" : "Не настроен"}
                </span>
              </div>
              {s.url ? (
                <p className="text-xs text-text-muted font-mono truncate">{s.url}</p>
              ) : (
                <p className="text-xs text-text-muted/60 italic">URL не задан</p>
              )}
              {s.namespace && (
                <p className="text-xs text-text-muted mt-0.5">ns: {s.namespace}</p>
              )}
            </div>
          ))}
        </div>

        {/* How-to hint */}
        <div className="mt-4 rounded-xl bg-indigo-50/70 border border-indigo-100 p-3.5">
          <p className="text-xs font-semibold text-indigo-700 mb-1.5">Как подключить стенд</p>
          <p className="text-xs text-indigo-600 mb-1.5 leading-relaxed">
            Добавьте переменные в <code className="bg-indigo-100/80 px-1 py-0.5 rounded text-[11px]">.env</code> на сервере:
          </p>
          <pre className="text-[11px] text-indigo-700 font-mono leading-relaxed whitespace-pre-wrap">{
`REVISOR_NT_URL=https://k8s.nt.example.com
REVISOR_NT_TOKEN=<bearer-token>
REVISOR_NT_NAMESPACE=production`
          }</pre>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function RevisorSection() {
  const [data,         setData]         = useState<RevisorData | null>(null);
  const [stands,       setStands]       = useState<StandConfig[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [error,        setError]        = useState("");
  const [search,       setSearch]       = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [rev, st] = await Promise.all([getRevisorData(), getStands()]);
      setData(rev);
      setStands(st.stands);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const standNames = data?.stands ?? [];
  const filtered   = (data?.services ?? []).filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const greenRows  = filtered.filter(r => rowMatchStatus(r, standNames) === "green").length;
  const yellowRows = filtered.filter(r => rowMatchStatus(r, standNames) === "yellow").length;

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <p className="text-sm">Загрузка данных стендов...</p>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 max-w-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 mb-0.5">Ошибка загрузки</p>
            <p className="text-xs text-red-600 mb-2">{error}</p>
            <button onClick={() => loadData()} className="text-xs text-red-600 underline hover:text-red-800">
              Попробовать снова
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main render ── */
  // Dynamic grid: name + N stand cols + status badge
  const colTemplate = `minmax(160px,1.2fr) repeat(${standNames.length}, minmax(150px,1fr)) 90px`;

  return (
    <>
      {settingsOpen && <SettingsModal stands={stands} onClose={() => setSettingsOpen(false)} />}

      <div className="p-6 animate-slide-up overflow-x-auto">

        {/* ── Page header ──────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-1 gap-4">
          <h1 className="text-xl font-bold text-text-main flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            Ревизор стендов
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg
                text-sm text-text-muted hover:bg-gray-50 hover:text-primary transition-all duration-150"
            >
              <Settings className="w-3.5 h-3.5" />
              Настройки
            </button>
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg
                text-sm text-text-muted hover:bg-gray-50 hover:text-primary transition-all duration-150
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Обновить
            </button>
          </div>
        </div>

        {/* ── Subtitle / stats ─────────────────────────────────── */}
        <p className="text-sm text-text-muted mb-4 flex items-center gap-3 flex-wrap">
          Сравнение Docker-сборок и статуса подов по стендам.
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-xs">{greenRows} синхронно</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-xs">{yellowRows} расхождений</span>
          </span>
          {/* Stand connection dots */}
          <span className="flex items-center gap-1.5 ml-auto">
            {stands.map(s => (
              <span key={s.name} title={`${s.name}: ${s.connected ? "подключён" : "не настроен"}`}
                className={`w-2 h-2 rounded-full ${s.connected ? "bg-green-500" : "bg-gray-300"}`} />
            ))}
          </span>
        </p>

        {/* ── Search ───────────────────────────────────────────── */}
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск микросервиса..."
            className={`${INPUT_CLS} pl-9 pr-8`}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ── Table card ───────────────────────────────────────── */}
        <div className="bg-white border border-border-main rounded-xl overflow-hidden">

          {/* Table header row */}
          <div
            className="grid bg-gray-50/80 border-b border-border-main"
            style={{ gridTemplateColumns: colTemplate }}
          >
            <div className="px-4 py-2.5 text-xs font-semibold text-text-muted uppercase tracking-wide">
              Микросервис
            </div>
            {standNames.map(name => (
              <div key={name}
                className="px-4 py-2.5 text-xs font-semibold text-text-muted uppercase tracking-wide border-l border-border-main">
                {name}
              </div>
            ))}
            <div className="px-3 py-2.5 text-xs font-semibold text-text-muted uppercase tracking-wide border-l border-border-main text-center">
              Статус
            </div>
          </div>

          {/* Body */}
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              {search ? `Ничего не найдено по запросу «${search}»` : "Нет данных"}
            </div>
          ) : filtered.map(row => {
            const ms = rowMatchStatus(row, standNames);
            const badge = ROW_BADGE[ms];
            return (
              <div
                key={row.name}
                className={`grid border-b border-border-main last:border-0 transition-colors ${ROW_TINT[ms]}`}
                style={{ gridTemplateColumns: colTemplate }}
              >
                {/* Service name with left-border accent */}
                <div className={`px-4 py-3 flex items-center ${ROW_ACCENT[ms]}`}>
                  <span className="text-sm font-medium text-text-main font-mono truncate">
                    {row.name}
                  </span>
                </div>

                {/* Per-stand pod cells */}
                {standNames.map(stand => (
                  <div key={stand} className="px-4 py-3 border-l border-border-main">
                    <PodCell info={row.stands[stand]} />
                  </div>
                ))}

                {/* Status badge */}
                <div className="px-3 py-3 border-l border-border-main flex items-center justify-center">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Legend ───────────────────────────────────────────── */}
        <div className="mt-3 flex items-center gap-5 flex-wrap">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Статус пода:</span>
          {([
            ["bg-green-500", "Все запущены"],
            ["bg-amber-400", "Часть упала"],
            ["bg-red-500",   "Все упали"],
            ["bg-gray-300",  "Выключены"],
          ] as [string, string][]).map(([cls, label]) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
