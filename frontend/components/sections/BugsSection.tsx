"use client";

import { useState, useCallback } from "react";
import {
  Bug, Loader2, Copy, CheckCheck, Server, Monitor, Smartphone,
  BarChart2, Palette, GitBranch, PlugZap,
  History, ChevronLeft, BookmarkPlus, CheckCircle2, XCircle, Trash2,
} from "lucide-react";
import { formatBug, addDefect } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

/* ── History helpers ──────────────────────────────────────────────── */

interface BugHistEntry {
  id: string;
  timestamp: number;
  platform: string;
  feature: string;
  description: string;
  report: string;
  loadedAsEtalon?: boolean;
}

function loadBugHistory(): BugHistEntry[] {
  try {
    const raw = localStorage.getItem("st_bug_history");
    return raw ? (JSON.parse(raw) as BugHistEntry[]) : [];
  } catch {
    return [];
  }
}

const HIST_GROUPS = ["Сегодня", "Вчера", "На этой неделе", "Ранее"] as const;

function getDateGroup(ts: number): string {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const t = todayStart.getTime();
  if (ts >= t) return "Сегодня";
  if (ts >= t - 86400000) return "Вчера";
  if (ts >= t - 6 * 86400000) return "На этой неделе";
  return "Ранее";
}

function formatHistTime(ts: number): string {
  const d = new Date(ts);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (ts >= todayStart.getTime()) return hm;
  if (ts >= todayStart.getTime() - 86400000) return `вчера ${hm}`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + " " + hm;
}

/* ── Constants ────────────────────────────────────────────────────── */

const PLATFORMS = [
  { id: "Back",      label: "Back",      Icon: Server },
  { id: "Front",     label: "Front",     Icon: Monitor },
  { id: "Mobile",    label: "Mobile",    Icon: Smartphone },
  { id: "Analytics", label: "Analytics", Icon: BarChart2 },
  { id: "Design",    label: "Design",    Icon: Palette },
  { id: "DevOps",    label: "DevOps",    Icon: GitBranch },
];

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

/* ── Component ────────────────────────────────────────────────────── */

export default function BugsSection() {
  const { provider } = useWorkspace();

  const [stage, setStage]             = useState<"input" | "history">("input");
  const [platform, setPlatform]       = useState("Back");
  const [feature, setFeature]         = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading]         = useState(false);
  const [report, setReport]           = useState("");
  const [copied, setCopied]           = useState(false);
  const [bugError, setBugError]       = useState<{ message: string; llm_error: boolean } | null>(null);

  const [histEntries, setHistEntries] = useState<BugHistEntry[]>(() => loadBugHistory());
  const [etalonStatus, setEtalonStatus] = useState<Record<string, "loading" | "done" | "error">>({});

  /* ── History management ─────────────────────────────────────────── */

  const saveHistEntry = useCallback((entry: BugHistEntry) => {
    setHistEntries(prev => {
      const next = [entry, ...prev].slice(0, 30);
      localStorage.setItem("st_bug_history", JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteHistEntry = useCallback((id: string) => {
    setHistEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      localStorage.setItem("st_bug_history", JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistEntries([]);
    localStorage.removeItem("st_bug_history");
  }, []);

  const handleLoadAsEtalon = useCallback(async (entry: BugHistEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEtalonStatus(prev => ({ ...prev, [entry.id]: "loading" }));
    try {
      await addDefect({
        description: entry.description,
        defect_body: entry.report,
        feature: entry.feature || undefined,
      });
      setHistEntries(prev => {
        const next = prev.map(h => h.id === entry.id ? { ...h, loadedAsEtalon: true } : h);
        localStorage.setItem("st_bug_history", JSON.stringify(next));
        return next;
      });
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "done" }));
    } catch {
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "error" }));
      setTimeout(() => setEtalonStatus(prev => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      }), 3000);
    }
  }, []);

  /* ── Format handler ─────────────────────────────────────────────── */

  const handleFormat = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setReport("");
    setBugError(null);
    try {
      const res = await formatBug({ platform, feature, description, provider });
      setReport(res.report);
      saveHistEntry({
        id: Date.now().toString(),
        timestamp: Date.now(),
        platform,
        feature,
        description,
        report: res.report,
      });
    } catch (err) {
      const raw = String(err);
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const detail = parsed.detail ?? parsed;
          setBugError({
            message: detail.message ?? raw,
            llm_error: detail.llm_error ?? false,
          });
          return;
        }
      } catch { /* fallthrough */ }
      setBugError({ message: raw, llm_error: false });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ── History stage ──────────────────────────────────────────────── */

  if (stage === "history") return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="w-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStage("input")}
              className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
            >
              <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              Назад
            </button>
            <span className="text-text-muted/40">·</span>
            <h1 className="text-xl font-bold text-text-main">История дефектов</h1>
          </div>
          {histEntries.length > 0 && (
            <button
              onClick={() => { if (window.confirm("Удалить всю историю дефектов?")) clearHistory(); }}
              className="text-xs text-text-muted hover:text-red-500 transition-colors"
            >
              Очистить всё
            </button>
          )}
        </div>

        {histEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <History className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">История пуста — оформите дефект, чтобы он появился здесь</p>
          </div>
        ) : (
          <div className="space-y-5">
            {HIST_GROUPS
              .map(g => [g, histEntries.filter(e => getDateGroup(e.timestamp) === g)] as [string, BugHistEntry[]])
              .filter(([, entries]) => entries.length > 0)
              .map(([group, entries]) => (
                <div key={group}>
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{group}</p>
                  <div className="bg-white border border-border-main rounded-xl overflow-hidden divide-y divide-border-main">
                    {entries.map(entry => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 cursor-pointer group transition-colors"
                        onClick={() => {
                          setPlatform(entry.platform);
                          setFeature(entry.feature);
                          setDescription(entry.description);
                          setReport(entry.report);
                          setStage("input");
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-main truncate">
                            {entry.feature || "Без названия"}
                          </p>
                          <p className="text-xs text-text-muted mt-0.5">
                            {entry.platform}
                            {entry.description
                              ? ` · ${entry.description.slice(0, 60)}${entry.description.length > 60 ? "…" : ""}`
                              : ""}
                          </p>
                        </div>
                        <span className="text-xs text-text-muted flex-shrink-0">
                          {formatHistTime(entry.timestamp)}
                        </span>
                        {/* Загрузить в эталон */}
                        {(() => {
                          if (entry.loadedAsEtalon) return (
                            <span className="flex-shrink-0 p-0.5 text-green-500" title="Добавлено в эталоны">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </span>
                          );
                          const st = etalonStatus[entry.id];
                          if (st === "loading") return (
                            <span className="flex-shrink-0 p-0.5 text-text-muted">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </span>
                          );
                          if (st === "error") return (
                            <span className="flex-shrink-0 p-0.5 text-red-500" title="Ошибка">
                              <XCircle className="w-3.5 h-3.5" />
                            </span>
                          );
                          return (
                            <button
                              onClick={e => handleLoadAsEtalon(entry, e)}
                              title="Загрузить в эталон дефектов"
                              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-indigo-500 transition-opacity flex-shrink-0 p-0.5"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            </button>
                          );
                        })()}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (window.confirm("Удалить эту запись?")) deleteHistEntry(entry.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity flex-shrink-0 p-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );

  /* ── Input stage ────────────────────────────────────────────────── */

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="w-full">

        {/* Header */}
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h1 className="text-xl font-bold text-text-main mb-1">Форматирование дефектов</h1>
            <p className="text-sm text-text-muted">Опишите баг — AI оформит его по стандарту Jira.</p>
          </div>
          {histEntries.length > 0 && (
            <button
              onClick={() => setStage("history")}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors flex-shrink-0 mt-1"
            >
              <History className="w-3.5 h-3.5" />
              История ({histEntries.length})
            </button>
          )}
        </div>

        {/* Input card */}
        <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
          <div className="mb-4">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Направление
            </label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setPlatform(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border
                    transition-all duration-150
                    ${platform === id
                      ? "border-primary bg-indigo-50 text-primary"
                      : "border-border-main text-text-muted hover:border-primary/40 hover:text-text-main"}`}
                >
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Фича</label>
            <input
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              placeholder="Оплата картой..."
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Описание дефекта <span className="text-red-400 normal-case font-normal">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="Опишите, что произошло, что ожидалось, шаги воспроизведения..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>

        {/* Error */}
        {bugError && (
          <div className={`rounded-xl border p-4 mb-4 animate-slide-up ${
            bugError.llm_error
              ? "border-amber-200 bg-amber-50"
              : "border-red-200 bg-red-50"
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                bugError.llm_error ? "bg-amber-100" : "bg-red-100"
              }`}>
                {bugError.llm_error
                  ? <PlugZap className="w-4 h-4 text-amber-600" />
                  : <Bug className="w-4 h-4 text-red-500" />}
              </div>
              <div>
                <p className={`text-sm font-semibold mb-1 ${bugError.llm_error ? "text-amber-800" : "text-red-700"}`}>
                  {bugError.llm_error ? "Ошибка LLM-провайдера" : "Ошибка"}
                </p>
                <p className={`text-sm ${bugError.llm_error ? "text-amber-700" : "text-red-600"}`}>
                  {bugError.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Report */}
        {report && (
          <div className="bg-white border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-main">Баг-репорт</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setReport("");
                    setDescription("");
                    setFeature("");
                    setBugError(null);
                    setPlatform("Back");
                  }}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border-main rounded-lg
                    text-text-muted hover:bg-gray-50 hover:text-text-main transition-all duration-150 active:scale-[0.97]"
                >
                  <Bug className="w-3.5 h-3.5" /> Новый дефект
                </button>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg
                    transition-all duration-150 active:scale-[0.97]
                    ${copied
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "border-border-main text-text-muted hover:bg-gray-50 hover:text-text-main"}`}
                >
                  {copied
                    ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано!</>
                    : <><Copy className="w-3.5 h-3.5" /> Копировать</>}
                </button>
              </div>
            </div>
            <pre className="text-sm text-text-main whitespace-pre-wrap font-sans leading-relaxed">
              {report}
            </pre>
          </div>
        )}

        {/* Bottom action row */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted flex items-center gap-1">
            {description.trim() ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                <span className="text-violet-700 font-medium">[{platform}]</span>
                {feature ? <>&nbsp;{feature}</> : null}
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                Введите описание дефекта
              </>
            )}
          </p>
          <button
            onClick={handleFormat}
            disabled={loading || !description.trim()}
            className={`flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
              hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md
              ${!description.trim() ? "opacity-40" : ""}`}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Форматирую...</>
              : <><Bug className="w-4 h-4" /> Оформить по стандарту Jira</>}
          </button>
        </div>

      </div>
    </div>
  );
}
