"use client";

import { useState, useEffect, useCallback } from "react";
import { Scale, Search, Settings, RefreshCw, X, AlertCircle } from "lucide-react";
import {
  getRevisorData, getStands,
  podStatus, rowMatchStatus,
  type RevisorData, type StandConfig, type PodInfo, type PodStatus,
} from "@/lib/revisorApi";

/* ── Dot colours ─────────────────────────────────────────────── */
const DOT_CLS: Record<PodStatus, string> = {
  green:  "bg-green-500",
  yellow: "bg-amber-400",
  red:    "bg-red-500",
  grey:   "bg-gray-300",
};

const ROW_BG: Record<"green" | "yellow" | "grey", string> = {
  green:  "bg-green-50/50",
  yellow: "bg-amber-50/40",
  grey:   "",
};

const ROW_MARKER_CLS: Record<"green" | "yellow" | "grey", string> = {
  green:  "bg-green-500",
  yellow: "bg-amber-400",
  grey:   "bg-gray-300",
};

/* ── Pod cell ─────────────────────────────────────────────────── */
function PodCell({ info }: { info: PodInfo | undefined }) {
  if (!info) return <span className="text-xs text-text-muted/40">—</span>;
  const st = podStatus(info);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT_CLS[st]}`} />
      <span className="text-xs font-mono text-text-main truncate">
        {info.version || "—"}
      </span>
      <span className="text-[11px] text-text-muted flex-shrink-0 tabular-nums">
        {info.total > 0 ? `${info.running}/${info.total}` : "0/0"}
      </span>
    </div>
  );
}

/* ── Settings modal ───────────────────────────────────────────── */
function SettingsModal({
  stands,
  onClose,
}: {
  stands: StandConfig[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-border-main w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-main flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            Подключение к стендам
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {stands.map(s => (
            <div key={s.name} className="rounded-xl border border-border-main p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.connected ? "bg-green-500" : "bg-red-400"}`} />
                <span className="text-sm font-semibold text-text-main">{s.name}</span>
                <span className={`ml-auto text-xs font-medium ${s.connected ? "text-green-600" : "text-red-500"}`}>
                  {s.connected ? "Подключён" : "Не настроен"}
                </span>
              </div>
              {s.url ? (
                <p className="text-xs text-text-muted font-mono truncate">{s.url}</p>
              ) : (
                <p className="text-xs text-text-muted italic">URL не задан</p>
              )}
              {s.namespace && (
                <p className="text-xs text-text-muted mt-0.5">namespace: {s.namespace}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl bg-indigo-50 border border-indigo-100 p-3">
          <p className="text-xs text-indigo-700 font-medium mb-1">Как настроить подключение</p>
          <p className="text-xs text-indigo-600 leading-relaxed">
            Задайте переменные в <code className="bg-indigo-100 px-1 rounded">.env</code> на сервере:
          </p>
          <pre className="text-[11px] text-indigo-700 mt-1.5 font-mono leading-relaxed whitespace-pre-wrap">
{`REVISOR_NT_URL=https://k8s.nt.example.com
REVISOR_NT_TOKEN=<bearer-token>
REVISOR_NT_NAMESPACE=production`}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
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
      const [revisorData, standsData] = await Promise.all([
        getRevisorData(),
        getStands(),
      ]);
      setData(revisorData);
      setStands(standsData.stands);
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

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <RefreshCw className="w-6 h-6 animate-spin" />
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
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 mb-1">Ошибка загрузки</p>
            <p className="text-xs text-red-600">{error}</p>
            <button
              onClick={() => loadData()}
              className="mt-2 text-xs text-red-600 underline hover:text-red-800"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main render ── */
  const totalRows  = filtered.length;
  const greenRows  = filtered.filter(r => rowMatchStatus(r, standNames) === "green").length;
  const yellowRows = filtered.filter(r => rowMatchStatus(r, standNames) === "yellow").length;
  const greyRows   = totalRows - greenRows - yellowRows;

  const colTemplate = `minmax(180px,1fr) repeat(${standNames.length}, minmax(160px,1fr)) 60px`;

  return (
    <>
      {settingsOpen && (
        <SettingsModal stands={stands} onClose={() => setSettingsOpen(false)} />
      )}

      <div className="p-6 animate-slide-up overflow-x-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-text-main">Ревизор стендов</h1>
            {/* Stand connection dots */}
            {stands.length > 0 && (
              <div className="flex items-center gap-1.5 ml-1">
                {stands.map(s => (
                  <span
                    key={s.name}
                    title={`${s.name}: ${s.connected ? "подключён" : "не настроен"}`}
                    className={`w-2 h-2 rounded-full ${s.connected ? "bg-green-500" : "bg-gray-300"}`}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted
                border border-border-main rounded-lg hover:bg-gray-50 hover:text-text-main transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Настройки
            </button>
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted
                border border-border-main rounded-lg hover:bg-gray-50 hover:text-text-main transition-colors
                disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Обновить
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {greenRows} синхронно
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            {yellowRows} расхождений
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full bg-gray-300" />
            {greyRows} без данных
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск микросервиса..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-border-main rounded-lg
              focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
              transition-shadow duration-150"
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

        {/* Table */}
        <div className="rounded-xl border border-border-main overflow-hidden bg-white">
          {/* Table header */}
          <div
            className="grid border-b border-border-main bg-gray-50/80"
            style={{ gridTemplateColumns: colTemplate }}
          >
            <div className="px-4 py-2.5 text-xs font-semibold text-text-muted uppercase tracking-wide">
              Микросервис
            </div>
            {standNames.map(name => (
              <div
                key={name}
                className="px-4 py-2.5 text-xs font-semibold text-text-muted uppercase tracking-wide border-l border-border-main"
              >
                {name}
              </div>
            ))}
            <div className="px-3 py-2.5 text-xs font-semibold text-text-muted uppercase tracking-wide border-l border-border-main text-center">
              ●
            </div>
          </div>

          {/* Table body */}
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              {search ? `Ничего не найдено по запросу «${search}»` : "Нет данных"}
            </div>
          ) : (
            filtered.map(row => {
              const ms = rowMatchStatus(row, standNames);
              return (
                <div
                  key={row.name}
                  className={`grid border-b border-border-main last:border-0 ${ROW_BG[ms]}`}
                  style={{ gridTemplateColumns: colTemplate }}
                >
                  {/* Service name */}
                  <div className="px-4 py-3 flex items-center">
                    <span className="text-sm font-medium text-text-main font-mono truncate">
                      {row.name}
                    </span>
                  </div>
                  {/* Per-stand cells */}
                  {standNames.map(stand => (
                    <div key={stand} className="px-4 py-3 border-l border-border-main">
                      <PodCell info={row.stands[stand]} />
                    </div>
                  ))}
                  {/* Row status dot */}
                  <div className="px-3 py-3 border-l border-border-main flex items-center justify-center">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${ROW_MARKER_CLS[ms]}`}
                      title={
                        ms === "green"  ? "Все версии совпадают" :
                        ms === "yellow" ? "Версии расходятся" :
                        "Нет данных"
                      }
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-5 flex-wrap">
          {([
            ["bg-green-500", "Все поды запущены"],
            ["bg-amber-400", "Часть подов недоступна"],
            ["bg-red-500",   "Все поды упали"],
            ["bg-gray-300",  "Поды выключены"],
          ] as [string, string][]).map(([cls, label]) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className={`w-2 h-2 rounded-full ${cls}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
