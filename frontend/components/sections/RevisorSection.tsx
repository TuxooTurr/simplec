"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Scale, Search, Settings, RefreshCw, X, AlertCircle } from "lucide-react";
import {
  getRevisorData, getStands,
  podStatus, rowMatchStatus,
  type RevisorData, type StandConfig, type PodInfo, type PodStatus, type ServiceRow, type RevisorMethodResult,
} from "@/lib/revisorApi";

/* ── Shared style constants (same as Metrics/Alerts/Generation) ── */
const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150";

/* ── Status colour maps ──────────────────────────────────────────── */
const POD_DOT: Record<PodStatus, string> = {
  green:  "bg-green-500",
  yellow: "bg-amber-400",
  red:    "bg-red-500",
  grey:   "bg-bg-muted",
};

// Left border accent on the service-name cell
const ROW_ACCENT: Record<"green" | "yellow" | "grey", string> = {
  green:  "border-l-2 border-l-green-400",
  yellow: "border-l-2 border-l-amber-400",
  grey:   "border-l-2 border-l-transparent",
};

// Badge for the match-status column
const ROW_BADGE: Record<"green" | "yellow" | "grey", { cls: string; label: string }> = {
  green:  { cls: "text-green-700  bg-green-50  border border-green-200",  label: "Синхр." },
  yellow: { cls: "text-amber-700  bg-amber-50  border border-amber-200",  label: "Расх."  },
  grey:   { cls: "text-text-muted   bg-bg-subtle   border border-border-main",   label: "—"       },
};

/* ── Majority version helper ─────────────────────────────────────── */
function getMajorityVersion(row: ServiceRow, stands: string[]): string {
  const versions = stands.map(s => row.stands[s]?.compare_value || row.stands[s]?.version || "").filter(Boolean);
  if (versions.length === 0) return "";
  const counts: Record<string, number> = {};
  for (const v of versions) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

const METHOD_BADGE: Record<PodStatus, string> = {
  green:  "bg-green-50 text-green-700 border-green-200",
  yellow: "bg-amber-50 text-amber-700 border-amber-200",
  red:    "bg-red-50 text-red-700 border-red-200",
  grey:   "bg-bg-subtle text-text-muted border-border-main",
};

function MethodLine({ method }: { method: RevisorMethodResult }) {
  const status = method.status ?? "grey";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`px-1.5 py-0.5 rounded border text-[10px] leading-none flex-shrink-0 ${METHOD_BADGE[status]}`}>
        {method.label}
      </span>
      <span className={`text-[11px] truncate ${method.error ? "text-red-600" : "text-text-main"}`}>
        {method.value || "—"}
      </span>
    </div>
  );
}

/* ── Pod cell ─────────────────────────────────────────────────────── */
function PodCell({ info, highlight = false }: { info: PodInfo | undefined; highlight?: boolean }) {
  if (!info) {
    return <span className="text-xs text-text-muted/40">—</span>;
  }
  const st = podStatus(info);
  const noData = (info.total ?? 0) === 0 && !info.version && !info.methods?.length;
  if (info.methods?.length) {
    return (
      <div className={`flex flex-col gap-1 min-w-0 ${highlight ? "text-amber-700" : ""}`}>
        {info.methods.map((m, idx) => (
          <MethodLine key={`${m.key}-${idx}`} method={m} />
        ))}
        {(info.total ?? 0) > 0 && (
          <span className="text-[10px] text-text-muted tabular-nums leading-tight">
            {info.running ?? 0}/{info.total ?? 0} pod
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${POD_DOT[st]}`} />
      <div className="min-w-0 flex flex-col">
        <span className={`text-xs font-mono truncate ${
          highlight  ? "text-amber-700 font-semibold" :
          noData     ? "text-text-muted/50" :
                       "text-text-main"
        }`}>
          {info.version || "—"}
        </span>
        {(info.total ?? 0) > 0 && (
          <span className="text-[10px] text-text-muted tabular-nums leading-tight">
            {info.running ?? 0}/{info.total ?? 0} pod
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Auto-refresh intervals ──────────────────────────────────────── */
const INTERVALS = [
  { label: "Выкл",  secs: 0   },
  { label: "30 с",  secs: 30  },
  { label: "1 мин", secs: 60  },
  { label: "5 мин", secs: 300 },
] as const;

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function RevisorSection() {
  const router = useRouter();
  const [data,         setData]         = useState<RevisorData | null>(null);
  const [stands,       setStands]       = useState<StandConfig[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [error,        setError]        = useState("");
  const [search,       setSearch]       = useState("");
  const [intervalSecs, setIntervalSecs] = useState(0);   // 0 = off
  const [countdown,    setCountdown]    = useState(0);   // seconds until next refresh
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLoadAt = useRef<number>(0);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [rev, st] = await Promise.all([getRevisorData(), getStands()]);
      setData(rev);
      setStands(st.stands);
      lastLoadAt.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh polling
  useEffect(() => {
    if (timerRef.current)  clearInterval(timerRef.current);
    if (countRef.current)  clearInterval(countRef.current);
    if (intervalSecs === 0) { setCountdown(0); return; }

    // Reset countdown immediately
    setCountdown(intervalSecs);

    // Tick down every second
    countRef.current = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? intervalSecs : prev - 1));
    }, 1000);

    // Fire reload on interval
    timerRef.current = setInterval(() => {
      loadData(true);
    }, intervalSecs * 1000);

    return () => {
      if (timerRef.current)  clearInterval(timerRef.current);
      if (countRef.current)  clearInterval(countRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalSecs]);

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
      <div className="p-6 animate-slide-up overflow-x-auto">

        {/* ── Page header ──────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-1 gap-4 flex-wrap">
          <h1 className="text-xl font-bold text-text-main flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            Ревизор стендов
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* Interval pills */}
            <div className="flex items-center gap-1 bg-bg-muted/80 rounded-lg p-1">
              {INTERVALS.map(iv => (
                <button
                  key={iv.secs}
                  onClick={() => setIntervalSecs(iv.secs)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                    intervalSecs === iv.secs
                      ? "bg-bg-card text-text-main shadow-sm"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  {iv.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => router.push("/settings")}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg
                text-sm text-text-muted hover:bg-bg-subtle hover:text-primary transition-all duration-150"
            >
              <Settings className="w-3.5 h-3.5" />
              Общие настройки
            </button>
            <button
              onClick={() => { loadData(true); if (intervalSecs > 0) setCountdown(intervalSecs); }}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg
                text-sm text-text-muted hover:bg-bg-subtle hover:text-primary transition-all duration-150
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Обновить
            </button>
          </div>
        </div>

        {/* ── Auto-refresh progress bar ─────────────────────────── */}
        {intervalSecs > 0 && (
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1 h-0.5 bg-bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/40 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(1 - countdown / intervalSecs) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-text-muted tabular-nums flex-shrink-0">
              {countdown}с
            </span>
          </div>
        )}

        {/* ── Subtitle / stats ─────────────────────────────────── */}
        <p className="text-sm text-text-muted mb-4 flex items-center gap-3 flex-wrap">
          Сравнение сборок, версий, статусов и подов по API-стендам.
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
                className={`w-2 h-2 rounded-full ${s.connected ? "bg-green-500" : "bg-bg-muted"}`} />
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
        <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden">

          {/* Table header row */}
          <div
            className="grid bg-bg-subtle/80 border-b border-border-main"
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
            const ms       = rowMatchStatus(row, standNames);
            const badge    = ROW_BADGE[ms];
            const majority = getMajorityVersion(row, standNames);
            return (
              <div
                key={row.name}
                className="grid border-b border-border-main last:border-0"
                style={{ gridTemplateColumns: colTemplate }}
              >
                {/* Service name with left-border accent */}
                <div className={`px-4 py-3 flex items-center ${ROW_ACCENT[ms]}`}>
                  <span className="text-sm font-medium text-text-main font-mono truncate">
                    {row.name}
                  </span>
                </div>

                {/* Per-stand pod cells — highlight only mismatching cells */}
                {standNames.map(stand => {
                  const info      = row.stands[stand];
                  const compare   = info?.compare_value || info?.version || "";
                  const isMismatch = !!(majority && compare && compare !== majority);
                  return (
                    <div
                      key={stand}
                      className={`px-4 py-3 border-l border-border-main transition-colors ${
                        isMismatch ? "bg-amber-50/70" : ""
                      }`}
                    >
                      <PodCell info={info} highlight={isMismatch} />
                    </div>
                  );
                })}

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
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Индикаторы:</span>
          {([
            ["bg-green-500", "Все запущены"],
            ["bg-amber-400", "Часть упала"],
            ["bg-red-500",   "Все упали"],
            ["bg-bg-muted",  "Выключены"],
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
