"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ScrollText, Search, Loader2, AlertTriangle, ChevronDown, ChevronUp,
  Copy, CheckCheck, Bug, Sparkles, Filter, Clock, Server,
  RefreshCw, Settings, XCircle, CheckCircle2, ChevronRight,
  History, ChevronLeft, Trash2,
} from "lucide-react";
import { Select } from "@/components/ui";
import {
  searchLogs, analyzeLogs, getLogServices,
  type LogEntry, type LogGroup, type LogAnalysis, type LogSearchResult,
} from "@/lib/api";
import {
  getLogsVpsConnections,
  type LogsVpsConnection,
} from "@/lib/settingsApi";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import NotionRenderer from "@/components/NotionRenderer";

/* ── Стили (дизайн-система) ─────────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150";

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium " +
  "rounded-lg bg-primary text-white shadow-sm hover:bg-primary-dark " +
  "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium " +
  "rounded-lg text-text-muted hover:bg-bg-subtle hover:text-text-main " +
  "transition-colors";

const BADGE_CLS = "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full";

/* ── Константы ──────────────────────────────────────────────────────────── */

const TIME_PRESETS = [
  { label: "1 ч",   hours: 1 },
  { label: "6 ч",   hours: 6 },
  { label: "24 ч",  hours: 24 },
  { label: "7 д",   hours: 168 },
] as const;

const LEVELS = [
  { id: "ERROR",      label: "ERROR",       color: "bg-red-100 text-red-700" },
  { id: "WARN",       label: "WARN",        color: "bg-amber-100 text-amber-700" },
  { id: "FATAL",      label: "FATAL",       color: "bg-red-200 text-red-900" },
  { id: "ERROR+WARN", label: "ERROR+WARN",  color: "bg-orange-100 text-orange-700" },
] as const;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border border-red-200",
  major:    "bg-orange-100 text-orange-800 border border-orange-200",
  minor:    "bg-yellow-100 text-yellow-800 border border-yellow-200",
};

const CATEGORY_STYLES: Record<string, string> = {
  NPE:           "bg-red-50 text-red-600",
  timeout:       "bg-amber-50 text-amber-600",
  config:        "bg-blue-50 text-blue-600",
  auth:          "bg-purple-50 text-purple-600",
  db:            "bg-emerald-50 text-emerald-600",
  network:       "bg-cyan-50 text-cyan-600",
  memory:        "bg-pink-50 text-pink-600",
  serialization: "bg-indigo-50 text-indigo-600",
  other:         "bg-gray-50 text-gray-600",
};

const LEVEL_DOTS: Record<string, string> = {
  FATAL: "bg-red-600",
  ERROR: "bg-red-500",
  WARN:  "bg-amber-500",
  INFO:  "bg-blue-400",
};

const VPS_TYPE_LABELS: Record<string, string> = {
  graylog: "Graylog",
  elastic: "Elasticsearch",
  loki:    "Loki",
  generic: "REST API",
};

/* ── История поисков ────────────────────────────────────────────────────── */

interface SearchHistEntry {
  id: string;
  timestamp: number;
  vps_name: string;
  services: string[];
  level: string;
  total: number;
  unique: number;
}

function loadSearchHistory(): SearchHistEntry[] {
  try {
    return JSON.parse(localStorage.getItem("st_logs_history") || "[]");
  } catch { return []; }
}

/* ── LogErrorCard ───────────────────────────────────────────────────────── */

function LogErrorCard({
  group,
  analysis,
  analyzing,
  onAnalyze,
  onCreateDefect,
}: {
  group: LogGroup;
  analysis?: LogAnalysis;
  analyzing: boolean;
  onAnalyze: () => void;
  onCreateDefect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = `${group.service} | ${group.level} | ${group.message}\n\n${group.stacktrace || ""}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const levelDot = LEVEL_DOTS[group.level] || "bg-gray-400";
  const ts = new Date(group.timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden transition-shadow hover:shadow-md">
      {/* Заголовок */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${levelDot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-text-main">{group.service}</span>
            <span className="text-xs text-text-muted">{ts}</span>
            {group.count > 1 && (
              <span className={`${BADGE_CLS} bg-bg-subtle text-text-muted`}>×{group.count}</span>
            )}
            <span className={`${BADGE_CLS} ${
              group.level === "FATAL" ? "bg-red-200 text-red-900" :
              group.level === "ERROR" ? "bg-red-100 text-red-700" :
              "bg-amber-100 text-amber-700"
            }`}>{group.level}</span>
          </div>
          <p className="text-sm text-text-main leading-snug line-clamp-2 font-mono">
            {group.message}
          </p>
        </div>
      </div>

      {/* Стектрейс (раскрываемый) */}
      {group.stacktrace && (
        <div className="px-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors mb-1"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Свернуть стектрейс" : "Показать стектрейс"}
          </button>
          {expanded && (
            <pre className="text-xs bg-[var(--color-code-bg,#f8f9fa)] text-text-main p-3 rounded-lg overflow-x-auto max-h-60 mb-3 border border-border-main font-mono leading-relaxed">
              {group.stacktrace}
            </pre>
          )}
        </div>
      )}

      {/* AI-анализ */}
      {analysis && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-bg-subtle border border-border-main">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">AI-анализ</span>
            {analysis.severity && (
              <span className={`${BADGE_CLS} ${SEVERITY_STYLES[analysis.severity] || SEVERITY_STYLES.major}`}>
                {analysis.severity === "critical" ? "Критичный" :
                 analysis.severity === "major" ? "Значительный" : "Незначительный"}
              </span>
            )}
            {analysis.category && (
              <span className={`${BADGE_CLS} ${CATEGORY_STYLES[analysis.category] || CATEGORY_STYLES.other}`}>
                {analysis.category}
              </span>
            )}
          </div>
          <div className="space-y-1.5 text-sm">
            {analysis.summary && (
              <div>
                <span className="font-medium text-text-main">Что произошло: </span>
                <span className="text-text-muted">{analysis.summary}</span>
              </div>
            )}
            {analysis.root_cause && (
              <div>
                <span className="font-medium text-text-main">Причина: </span>
                <span className="text-text-muted">{analysis.root_cause}</span>
              </div>
            )}
            {analysis.impact && (
              <div>
                <span className="font-medium text-text-main">Влияние: </span>
                <span className="text-text-muted">{analysis.impact}</span>
              </div>
            )}
            {analysis.suggestion && (
              <div>
                <span className="font-medium text-text-main">Рекомендация: </span>
                <span className="text-text-muted">{analysis.suggestion}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Действия */}
      <div className="px-4 py-2.5 border-t border-border-main flex items-center gap-2 bg-bg-subtle/50">
        <button onClick={handleCopy} className={BTN_GHOST} title="Копировать">
          {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Скопировано" : "Копировать"}
        </button>
        {!analysis && (
          <button
            onClick={onAnalyze}
            disabled={analyzing}
            className={BTN_GHOST}
          >
            {analyzing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
            {analyzing ? "Анализ…" : "Анализировать"}
          </button>
        )}
        {analysis && (
          <button onClick={onCreateDefect} className={`${BTN_GHOST} text-red-600 hover:bg-red-50`}>
            <Bug className="w-3.5 h-3.5" />
            Создать дефект
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Основной компонент ─────────────────────────────────────────────────── */

export default function LogsSection() {
  const router = useRouter();
  const { provider, setBugPrefill } = useWorkspace();

  // Подключения VPS
  const [connections, setConnections] = useState<LogsVpsConnection[]>([]);
  const [selectedVps, setSelectedVps] = useState("");
  const [loadingConns, setLoadingConns] = useState(true);

  // Фильтры
  const [timePreset, setTimePreset] = useState(0); // индекс в TIME_PRESETS (1ч)
  const [level, setLevel] = useState("ERROR");
  const [services, setServices] = useState<string[]>([]);
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectAll, setSelectAll] = useState(true);
  const [queryText, setQueryText] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");

  // Результаты
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<LogSearchResult | null>(null);
  const [searchError, setSearchError] = useState("");

  // Анализ
  const [analyses, setAnalyses] = useState<Record<string, LogAnalysis>>({});
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());

  // История
  const [stage, setStage] = useState<"search" | "history">("search");
  const [history, setHistory] = useState<SearchHistEntry[]>(() => loadSearchHistory());

  /* ── Загрузка подключений ────────────────────────────────────────────── */

  const loadConnections = useCallback(async () => {
    setLoadingConns(true);
    try {
      const res = await getLogsVpsConnections();
      const enabled = (res.connections || []).filter(c => c.enabled !== false);
      setConnections(enabled);
      if (enabled.length > 0 && !selectedVps) {
        setSelectedVps(enabled[0].id || "");
      }
    } catch { /* ignore */ }
    setLoadingConns(false);
  }, [selectedVps]);

  useEffect(() => { loadConnections(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Загрузка сервисов при смене VPS ─────────────────────────────────── */

  useEffect(() => {
    if (!selectedVps) return;
    let cancelled = false;
    setLoadingServices(true);
    setAvailableServices([]);
    getLogServices(selectedVps)
      .then(res => {
        if (!cancelled) {
          setAvailableServices(res.services || []);
          setServices([]);
          setSelectAll(true);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingServices(false); });
    return () => { cancelled = true; };
  }, [selectedVps]);

  /* ── Поиск ───────────────────────────────────────────────────────────── */

  const handleSearch = async () => {
    if (!selectedVps) return;
    setSearching(true);
    setSearchError("");
    setResult(null);
    setAnalyses({});

    const now = new Date();
    const hoursBack = TIME_PRESETS[timePreset]?.hours ?? 1;
    const from = new Date(now.getTime() - hoursBack * 3600 * 1000);

    try {
      const res = await searchLogs({
        vps_id: selectedVps,
        services: selectAll ? [] : services,
        level,
        time_from: from.toISOString(),
        time_to: now.toISOString(),
        query: queryText,
        limit: 200,
      });
      setResult(res);

      // Сохраняем в историю
      const vpsName = connections.find(c => c.id === selectedVps)?.name || selectedVps;
      const entry: SearchHistEntry = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        vps_name: vpsName,
        services: selectAll ? ["Все"] : services,
        level,
        total: res.total,
        unique: res.unique_count,
      };
      setHistory(prev => {
        const next = [entry, ...prev].slice(0, 20);
        localStorage.setItem("st_logs_history", JSON.stringify(next));
        return next;
      });
    } catch (err) {
      setSearchError(String(err));
    }
    setSearching(false);
  };

  /* ── Анализ ──────────────────────────────────────────────────────────── */

  const analyzeOne = async (group: LogGroup) => {
    const fp = group.fingerprint;
    setAnalyzingIds(prev => new Set(prev).add(fp));
    try {
      const res = await analyzeLogs({
        vps_id: selectedVps,
        entries: [group],
        provider,
      });
      if (res.analyses.length > 0) {
        setAnalyses(prev => ({ ...prev, [fp]: res.analyses[0] }));
      }
    } catch { /* ignore */ }
    setAnalyzingIds(prev => {
      const next = new Set(prev);
      next.delete(fp);
      return next;
    });
  };

  const analyzeAll = async () => {
    if (!result?.grouped?.length) return;
    setAnalyzingAll(true);
    try {
      const entries = result.grouped.filter(g => !analyses[g.fingerprint]);
      if (entries.length === 0) { setAnalyzingAll(false); return; }

      const res = await analyzeLogs({
        vps_id: selectedVps,
        entries: entries,
        provider,
      });
      const newMap: Record<string, LogAnalysis> = {};
      for (const a of res.analyses) {
        // Привязываем по индексу
        const idx = (a.error_index || 1) - 1;
        if (idx >= 0 && idx < entries.length) {
          newMap[entries[idx].fingerprint] = a;
        }
      }
      setAnalyses(prev => ({ ...prev, ...newMap }));
    } catch { /* ignore */ }
    setAnalyzingAll(false);
  };

  /* ── Создание дефекта ────────────────────────────────────────────────── */

  const createDefect = (group: LogGroup, analysis: LogAnalysis) => {
    const desc = [
      `**Сервис:** ${group.service}`,
      `**Уровень:** ${group.level}`,
      `**Время:** ${group.timestamp}`,
      group.count > 1 ? `**Повторений:** ${group.count}` : "",
      "",
      `**Сообщение:**`,
      "```",
      group.message,
      "```",
      "",
      group.stacktrace ? `**Стектрейс:**\n\`\`\`\n${group.stacktrace.slice(0, 3000)}\n\`\`\`` : "",
      "",
      analysis.summary ? `**AI-анализ:** ${analysis.summary}` : "",
      analysis.root_cause ? `**Причина:** ${analysis.root_cause}` : "",
      analysis.impact ? `**Влияние:** ${analysis.impact}` : "",
      analysis.suggestion ? `**Рекомендация:** ${analysis.suggestion}` : "",
    ].filter(Boolean).join("\n");

    setBugPrefill({
      platform: "Back",
      feature: group.service,
      description: analysis.defect_draft || desc,
      source: "log_analyzer",
    });
    router.push("/bugs");
  };

  /* ── Чекбокс сервисов ────────────────────────────────────────────────── */

  const toggleService = (svc: string) => {
    setSelectAll(false);
    setServices(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  };

  const handleSelectAll = () => {
    setSelectAll(true);
    setServices([]);
  };

  const filteredServices = availableServices.filter(s =>
    !serviceFilter || s.toLowerCase().includes(serviceFilter.toLowerCase())
  );

  /* ── История ─────────────────────────────────────────────────────────── */

  if (stage === "history") return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="w-full max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStage("search")}
              className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
            >
              <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              Назад
            </button>
            <span className="text-text-muted/40">·</span>
            <h1 className="text-xl font-bold text-text-main">История поисков</h1>
          </div>
          {history.length > 0 && (
            <button
              onClick={() => {
                setHistory([]);
                localStorage.removeItem("st_logs_history");
              }}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Очистить
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">История поисков пуста</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-bg-card border border-border-main rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-text-main">{h.vps_name}</span>
                    <span className="text-xs text-text-muted ml-2">{h.level}</span>
                    <span className="text-xs text-text-muted ml-2">
                      {h.services.join(", ")}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-text-muted">
                      {new Date(h.timestamp).toLocaleString("ru-RU")}
                    </span>
                    <div className="text-xs text-text-muted">
                      {h.total} записей → {h.unique} уникальных
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  /* ── Пустое состояние: нет подключений ───────────────────────────────── */

  if (!loadingConns && connections.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-20">
      <div className="w-16 h-16 rounded-2xl bg-bg-subtle flex items-center justify-center mb-4">
        <ScrollText className="w-8 h-8 text-text-muted/40" />
      </div>
      <h2 className="text-lg font-bold text-text-main mb-2">Нет подключений к VPS</h2>
      <p className="text-sm text-text-muted mb-6 max-w-md">
        Подключите платформу агрегации логов (Graylog, Elasticsearch, Loki) в настройках,
        чтобы начать анализ ошибок микросервисов.
      </p>
      <button
        onClick={() => router.push("/settings")}
        className={BTN_PRIMARY}
      >
        <Settings className="w-4 h-4" />
        Открыть настройки
      </button>
    </div>
  );

  /* ── Основной UI ─────────────────────────────────────────────────────── */

  const unanalyzedCount = result
    ? result.grouped.filter(g => !analyses[g.fingerprint]).length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
        <ScrollText className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Анализатор логов</h1>

        <div className="flex-1" />

        {/* VPS selector */}
        <Select
          value={selectedVps}
          onChange={(value) => setSelectedVps(value)}
        >
          {connections.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} ({VPS_TYPE_LABELS[c.vps_type] || c.vps_type})
            </option>
          ))}
        </Select>

        <button onClick={() => setStage("history")} className={BTN_GHOST}>
          <History className="w-4 h-4" />
          История
        </button>

        <button onClick={loadConnections} className={BTN_GHOST} title="Обновить подключения">
          <RefreshCw className={`w-4 h-4 ${loadingConns ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto p-6 space-y-6">

          {/* ── Фильтры ───────────────────────────────────────────────── */}
          <div className="bg-bg-card border border-border-main rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Filter className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-text-main">Фильтры</span>
            </div>

            {/* Период */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
                Период
              </label>
              <div className="flex gap-1.5">
                {TIME_PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setTimePreset(i)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      timePreset === i
                        ? "bg-primary text-white"
                        : "bg-bg-subtle text-text-muted hover:bg-bg-muted"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Уровень */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
                Уровень
              </label>
              <div className="flex gap-1.5">
                {LEVELS.map(l => (
                  <button
                    key={l.id}
                    onClick={() => setLevel(l.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      level === l.id
                        ? `${l.color} ring-1 ring-current`
                        : "bg-bg-subtle text-text-muted hover:bg-bg-muted"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Сервисы */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
                Микросервисы
              </label>
              {loadingServices ? (
                <div className="flex items-center gap-2 text-sm text-text-muted py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Загрузка списка сервисов…
                </div>
              ) : availableServices.length === 0 ? (
                <p className="text-xs text-text-muted py-1">
                  Сервисы не найдены. Запустите поиск — сервисы определятся из результатов.
                </p>
              ) : (
                <>
                  {availableServices.length > 6 && (
                    <input
                      type="text"
                      value={serviceFilter}
                      onChange={e => setServiceFilter(e.target.value)}
                      placeholder="Поиск сервиса…"
                      className={`${INPUT_CLS} mb-2`}
                    />
                  )}
                  <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-0.5">
                    {/* Чекбокс "Все" */}
                    <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-subtle cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectAll}
                        onChange={handleSelectAll}
                        className="rounded border-border-main text-primary focus:ring-primary/30"
                      />
                      <span className="text-sm font-medium text-text-main">Все сервисы</span>
                      <span className="text-xs text-text-muted">({availableServices.length})</span>
                    </label>
                    {filteredServices.map(svc => (
                      <label
                        key={svc}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-subtle cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectAll || services.includes(svc)}
                          disabled={selectAll}
                          onChange={() => toggleService(svc)}
                          className="rounded border-border-main text-primary focus:ring-primary/30"
                        />
                        <Server className="w-3 h-3 text-text-muted flex-shrink-0" />
                        <span className="text-sm text-text-main">{svc}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Текстовый поиск */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wide">
                Текст в сообщении (опционально)
              </label>
              <input
                type="text"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                placeholder="NullPointerException, timeout, connection refused…"
                className={INPUT_CLS}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
            </div>

            {/* Кнопка поиска */}
            <button
              onClick={handleSearch}
              disabled={searching || !selectedVps}
              className={`${BTN_PRIMARY} w-full`}
            >
              {searching
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />}
              {searching ? "Поиск…" : "Найти ошибки"}
            </button>
          </div>

          {/* ── Ошибка поиска ──────────────────────────────────────────── */}
          {searchError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Ошибка поиска</p>
                <p className="text-xs text-red-600 mt-1">{searchError}</p>
              </div>
            </div>
          )}

          {/* ── Результаты ─────────────────────────────────────────────── */}
          {result && (
            <div className="space-y-4">
              {/* Заголовок результатов */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-bold text-text-main">
                    Найдено: {result.total} {result.total === 1 ? "запись" : "записей"}
                  </h2>
                  {result.unique_count < result.total && (
                    <span className="text-xs text-text-muted">
                      → {result.unique_count} уникальных
                    </span>
                  )}
                  {result.services_found.length > 0 && (
                    <span className="text-xs text-text-muted">
                      в {result.services_found.length} сервис{
                        result.services_found.length === 1 ? "е" :
                        result.services_found.length < 5 ? "ах" : "ах"
                      }
                    </span>
                  )}
                </div>
                {result.grouped.length > 0 && unanalyzedCount > 0 && (
                  <button
                    onClick={analyzeAll}
                    disabled={analyzingAll}
                    className={BTN_PRIMARY}
                  >
                    {analyzingAll
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Sparkles className="w-4 h-4" />}
                    {analyzingAll ? "Анализ…" : `Анализировать все (${unanalyzedCount})`}
                  </button>
                )}
              </div>

              {/* Пустой результат */}
              {result.grouped.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400 opacity-60" />
                  <p className="text-sm font-medium text-text-main">Ошибок не найдено</p>
                  <p className="text-xs text-text-muted mt-1">
                    За выбранный период в логах нет записей с уровнем {level}
                  </p>
                </div>
              )}

              {/* Карточки ошибок */}
              <div className="space-y-3">
                {result.grouped.map(group => (
                  <LogErrorCard
                    key={group.fingerprint}
                    group={group}
                    analysis={analyses[group.fingerprint]}
                    analyzing={analyzingIds.has(group.fingerprint) || analyzingAll}
                    onAnalyze={() => analyzeOne(group)}
                    onCreateDefect={() => {
                      const a = analyses[group.fingerprint];
                      if (a) createDefect(group, a);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
