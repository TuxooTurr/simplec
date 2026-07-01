"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  Sparkles, ChevronDown, RotateCcw, Download, Clock,
  Paperclip, FileText, SlidersHorizontal, X, CheckCircle2, Plus, Trash2,
  StopCircle, History, ChevronLeft, BookmarkPlus, Loader2, XCircle, FlaskConical,
  Copy, CheckCheck, RefreshCw, AlertCircle,
} from "lucide-react";
import StatusPanel from "@/components/StatusPanel";
import CaseCard from "@/components/CaseCard";
import ExportPanel from "@/components/ExportPanel";
import NotionRenderer from "@/components/NotionRenderer";
import { useGeneration, type Case, type ExportResult } from "@/lib/useGeneration";
import {
  parseFile, addEtalon, deleteGenSession, listGenSessions, getGenSession,
  listTestDataConnections, getTestDataSchemasText,
  type GenSessionSummary, type GenSession, type TestDataConnection,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type Stage = "input" | "generating" | "review" | "export" | "history" | "histitem";

const DEPTHS = [
  { id: "smoke",      label: "Smoke",      sub: "1-5 e2e",      hint: "~30–60 сек" },
  { id: "regression", label: "Regression", sub: "5-10 кейсов",  hint: "~1–3 мин" },
  { id: "full",       label: "Full",       sub: "11-30 кейсов", hint: "~3–8 мин" },
  { id: "atomary",    label: "Atomary",    sub: "31-100",        hint: "~10–20 мин" },
];

const PLATFORMS = [
  { id: "Web",     label: "Web" },
  { id: "Desktop", label: "Desktop" },
  { id: "iOS",     label: "iOS" },
  { id: "Android", label: "Android" },
];

/* ── History helpers ─────────────────────────────────────────────── */

interface ParsedFileAttachment {
  name: string;
  text: string;
}

function buildLlmSourceText(fieldText: string, files: ParsedFileAttachment[]): string {
  const cleanFieldText = fieldText.trim();
  const cleanFiles = files
    .map((file, index) => {
      const cleanText = file.text.trim();
      if (!cleanText) return "";
      return `### Файл ${index + 1}: ${file.name}\n${cleanText}`;
    })
    .filter(Boolean);

  const parts: string[] = [];
  if (cleanFieldText) {
    parts.push(`ТРЕБОВАНИЕ ИЗ ПОЛЯ:\n${cleanFieldText}`);
  }
  if (cleanFiles.length > 0) {
    parts.push(`СОДЕРЖИМОЕ ЗАГРУЖЕННЫХ ФАЙЛОВ, КОТОРОЕ ОБЯЗАТЕЛЬНО НУЖНО ИЗУЧИТЬ:\n${cleanFiles.join("\n\n")}`);
  }

  return parts.join("\n\n");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\w]*\n?/g, "").replace(/```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function casesToText(cases: Case[]): string {
  return cases.map((c, i) => {
    const lines = [
      `${i + 1}. ${c.name}`,
      `Приоритет: ${c.priority} | Тип: ${c.case_type}`,
      "",
    ];
    c.steps.forEach((s, si) => {
      lines.push(`Шаг ${si + 1}: ${s.action}`);
      if (s.test_data) lines.push(`Тест-данные: ${s.test_data}`);
      if (s.ui)        lines.push(`UI: ${s.ui}`);
      if (s.api)       lines.push(`API: ${s.api}`);
      if (s.db)        lines.push(`DB: ${s.db}`);
      lines.push("");
    });
    return lines.join("\n");
  }).join("\n---\n\n");
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const HIST_GROUPS = ["Сегодня", "Вчера", "На этой неделе", "Ранее"] as const;

function getDateGroup(isoDate: string): string {
  const ts = new Date(isoDate).getTime();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const t = todayStart.getTime();
  if (ts >= t) return "Сегодня";
  if (ts >= t - 86400000) return "Вчера";
  if (ts >= t - 6 * 86400000) return "На этой неделе";
  return "Ранее";
}

function formatHistTime(isoDate: string): string {
  const d = new Date(isoDate);
  const ts = d.getTime();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (ts >= todayStart.getTime()) return hm;
  if (ts >= todayStart.getTime() - 86400000) return `вчера ${hm}`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + " " + hm;
}

/** Получить заголовок сессии: feature или первые 60 символов requirement */
function sessionTitle(s: GenSessionSummary): string {
  if (s.feature) return s.feature;
  const req = (s.requirement ?? "").trim();
  if (req.length > 60) return req.slice(0, 57) + "...";
  return req || "Без названия";
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  generating: { label: "Генерация...",  cls: "tone-info" },
  done:       { label: "Готово",        cls: "tone-success" },
  error:      { label: "Ошибка",       cls: "tone-danger" },
  cancelled:  { label: "Отменена",     cls: "tone-neutral" },
};

/* ── End history helpers ─────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2";


/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function GenerationSection() {
  const { provider } = useWorkspace();

  const [requirement, setRequirement] = useState("");

  // Depth and platform persist across navigation via localStorage
  const [depth, setDepthState] = useState<string>(() => {
    try { return localStorage.getItem("st_depth") ?? "smoke"; } catch { return "smoke"; }
  });
  const setDepth = (d: string) => {
    setDepthState(d);
    try { localStorage.setItem("st_depth", d); } catch {}
  };

  const [stage, setStage]             = useState<Stage>("input");
  const [elapsedFinal, setElapsedFinal] = useState(0);
  const [qaExpanded, setQaExpanded]   = useState(false);
  const [qaCopied, setQaCopied]       = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileAttachments, setFileAttachments] = useState<ParsedFileAttachment[]>([]);
  const reqFileRef = useRef<HTMLInputElement>(null);

  // ── Test data search ─────────────────────────────────────────
  const [tdSearchEnabled, setTdSearchEnabled] = useState(false);
  const [tdConnections, setTdConnections] = useState<TestDataConnection[]>([]);
  const [selectedTdConns, setSelectedTdConns] = useState<Set<string>>(new Set());
  const [tdDropdownOpen, setTdDropdownOpen] = useState(false);
  const tdDropdownRef = useRef<HTMLDivElement>(null);

  // Load test data connections
  useEffect(() => {
    listTestDataConnections()
      .then(conns => {
        setTdConnections(conns);
        // Auto-select connections with schema
        const withSchema = conns.filter(c => c.cached_schema).map(c => c.id);
        if (withSchema.length > 0) setSelectedTdConns(new Set(withSchema));
      })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (tdDropdownRef.current && !tdDropdownRef.current.contains(e.target as Node)) {
        setTdDropdownOpen(false);
      }
    }
    if (tdDropdownOpen) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [tdDropdownOpen]);

  // ── Case selection ────────────────────────────────────────────
  const [selectedCases, setSelectedCases] = useState<Set<number>>(new Set());
  const [histSelectedCases, setHistSelectedCases] = useState<Set<number>>(new Set());

  // ── Generation history (from backend) ──────────────────────────
  const [histSessions, setHistSessions] = useState<GenSessionSummary[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histView, setHistView] = useState<GenSession | null>(null);
  const [histViewLoading, setHistViewLoading] = useState(false);
  const [histFromStage, setHistFromStage] = useState<Stage>("input");
  const [exportSource, setExportSource] = useState<{ cases: Case[]; qaDoc: string; sessionId?: string } | null>(null);
  const [exportBackStage, setExportBackStage] = useState<Stage>("review");
  const genMetaRef = useRef({ feature: "", project: "", team: "", ke: "", depth: "smoke", platform: ["Web"] as string[], requirement: "" });
  const historySavedRef = useRef(false);
  const currentHistIdRef = useRef<string | null>(null);
  const exportingHistIdRef = useRef<string | null>(null);

  /** Загрузить список сессий с бэкенда */
  const refreshHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const sessions = await listGenSessions({ limit: 50 });
      setHistSessions(sessions);
    } catch {
      // backend не доступен — оставляем пустой список
    } finally {
      setHistLoading(false);
    }
  }, []);

  /** Удалить сессию на бэкенде и убрать из локального списка */
  const deleteHistSession = useCallback(async (id: string) => {
    try {
      await deleteGenSession(id);
      setHistSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      // ignore
    }
  }, []);

  const [etalonStatus, setEtalonStatus] = useState<Record<string, "loading" | "done" | "error">>({});

  /** Загрузить полную сессию и отправить в эталон */
  const handleLoadAsEtalon = useCallback(async (entry: GenSessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setEtalonStatus(prev => ({ ...prev, [entry.id]: "loading" }));
    try {
      const full = await getGenSession(entry.id);
      await addEtalon({
        req_text: stripMarkdown(full.requirement ?? ""),
        tc_text: casesToText(full.cases as Case[]),
        qa_doc: stripMarkdown(full.qa_doc ?? ""),
        platform: full.platform,
        feature: full.feature,
      });
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "done" }));
    } catch {
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "error" }));
      setTimeout(() => setEtalonStatus(prev => { const n = { ...prev }; delete n[entry.id]; return n; }), 2500);
    }
  }, []);

  /** Открыть полную сессию из истории */
  const openHistSession = useCallback(async (entry: GenSessionSummary) => {
    setHistViewLoading(true);
    try {
      const full = await getGenSession(entry.id);
      setHistView(full);
      setHistSelectedCases(new Set((full.cases ?? []).map((_: unknown, i: number) => i)));
      setStage("histitem");
    } catch {
      // fallback — не удалось загрузить
    } finally {
      setHistViewLoading(false);
    }
  }, []);

  // Загрузить историю при первом рендере
  useEffect(() => { refreshHistory(); }, [refreshHistory]);
  // ── End history ────────────────────────────────────────────────

  const { state, events, progress, cases, qaDoc, start, resume, exportCases, cancel, exportResult, exporting, reset, sessionId, wsConnected } =
    useGeneration();

  // Когда экспорт завершён — обновляем has_export в локальном списке сессий
  useEffect(() => {
    if (!exportResult || !exportingHistIdRef.current) return;
    const hid = exportingHistIdRef.current;
    setHistSessions(prev => prev.map(s => s.id === hid ? { ...s, has_export: true } : s));
    // Обновляем histView если он открыт
    if (histView && histView.id === hid) {
      setHistView(prev => prev ? { ...prev, export_result: exportResult } : prev);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportResult]);

  // Restore stage immediately (before paint) when returning to this page
  useLayoutEffect(() => {
    // If export is in progress or has result — go straight to export
    if (exporting || (exportResult && (state === "done" || state === "error"))) {
      setStage("export");
    } else if (state === "generating") {
      setStage("generating");
    } else if (state === "done" || state === "error") {
      const lastDone = events.find((e) => e.type === "layer_done" && e.layer === 2);
      setElapsedFinal(lastDone?.elapsed ?? 0);
      setStage("review");
    }
    // state === "idle" → keep "input"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount — ongoing transitions handled by useEffect below


  useEffect(() => {
    if (state === "generating") setStage("generating");
    if (state === "done") {
      const lastDone = events.find((e) => e.type === "layer_done" && e.layer === 2);
      const elapsed = lastDone?.elapsed ?? 0;
      setElapsedFinal(elapsed);
      setStage("review");
      // Select all cases by default
      if (cases.length > 0) setSelectedCases(new Set(cases.map((_, i) => i)));
      // Обновляем список сессий с бэкенда (сессия уже сохранена на сервере)
      if (!historySavedRef.current && cases.length > 0) {
        historySavedRef.current = true;
        currentHistIdRef.current = sessionId || null;
        refreshHistory();
      }
    }
    if (state === "error") setStage("review");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, events]);

  const handleGenerate = async () => {
    const text = buildLlmSourceText(requirement, fileAttachments);
    if (!text) return;

    let finalText = text;

    // Если включён поиск тестовых данных — подгружаем схему БД и добавляем в промпт
    if (tdSearchEnabled && selectedTdConns.size > 0) {
      try {
        const schemasRes = await getTestDataSchemasText(Array.from(selectedTdConns));
        if (schemasRes.text) {
          finalText += "\n\n=== СХЕМЫ РЕАЛЬНЫХ БАЗ ДАННЫХ ДЛЯ ТЕСТОВЫХ ДАННЫХ ===\n"
            + "Используй реальные таблицы и колонки из схем ниже для формирования тестовых данных в шагах кейсов. "
            + "В поле test_data каждого шага указывай РЕАЛЬНЫЕ SQL-запросы для получения тестовых данных из этих таблиц.\n\n"
            + schemasRes.text;
        }
      } catch {
        // Если не удалось получить схему — генерируем без неё
      }
    }

    genMetaRef.current = { feature: "", project: "", team: "", ke: "", depth, platform: ["Web"], requirement: finalText };
    historySavedRef.current = false;
    start({ requirement: finalText, feature: "", depth, provider, platform: "Web" });
  };


  const handleReset = () => {
    historySavedRef.current = false;
    reset();
    setStage("input");
    setRequirement("");
    setFileAttachments([]);
    setQaExpanded(false);
  };

  const currentDepth = DEPTHS.find((d) => d.id === depth);
  const fileChars = fileAttachments.reduce((sum, file) => sum + file.text.length, 0);
  const hasGenerationSource = Boolean(requirement.trim() || fileAttachments.some((file) => file.text.trim()));

  /* ─────────────── RENDER ─────────────── */
  return (
    <>
      {/* Modal рендерится на уровне компонента (вне stage-блоков) */}

      {/* ── INPUT ── */}
      {stage === "input" && (
        <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
          <div className="flex items-start justify-between mb-1 gap-4">
            <h1 className="text-xl font-bold text-text-main">Генерация тест-кейсов</h1>
            <button
              onClick={() => { refreshHistory(); setHistFromStage("input"); setStage("history"); }}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors flex-shrink-0 mt-1"
            >
              <History className="w-3.5 h-3.5" />
              История{histSessions.length > 0 ? ` (${histSessions.length})` : ""}
            </button>
          </div>
          <p className="text-sm text-text-muted mb-4">
            Вставьте требование или загрузите файлы — AI изучит все источники и создаст тест-кейсы для Zephyr Scale.
          </p>

          {/* Depth */}
          <div className="bg-bg-card border border-border-main rounded-xl p-4 mb-3">
            <div className="mb-2">
              <label className={LABEL_CLS + " mb-0"}>Глубина</label>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {DEPTHS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDepth(d.id)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium border transition-all duration-150 text-center
                    ${depth === d.id
                      ? "border-primary bg-[var(--color-active-bg)] text-primary"
                      : "border-border-main bg-bg-card text-text-muted hover:border-primary/40 hover:text-text-main"}`}
                >
                  <div className="font-semibold">{d.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{d.sub}</div>
                </button>
              ))}
            </div>
            {currentDepth && (
              <p className="flex items-center gap-1 text-xs text-text-muted mt-1.5">
                <Clock className="w-3 h-3" />
                {currentDepth.hint}
              </p>
            )}
          </div>

          {/* Requirement input */}
          <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Требование</label>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="Вставьте текст требования, user story или описание функционала..."
              rows={10}
              className={`${INPUT_CLS} resize-none font-mono`}
            />
            <input
              ref={reqFileRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.xlsx,.xls,.xml,.png,.jpg,.jpeg,.txt"
              className="hidden"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length === 0) return;
                setFileLoading(true);
                try {
                  const parsedFiles = await Promise.all(files.map(async (file) => {
                    const result = await parseFile(file);
                    return {
                      name: result.filename || file.name,
                      text: result.text,
                    };
                  }));
                  setFileAttachments((prev) => [...prev, ...parsedFiles]);
                } catch (err) {
                  alert("Ошибка: " + String(err));
                } finally {
                  setFileLoading(false);
                  if (e.target) e.target.value = "";
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => reqFileRef.current?.click()}
                  disabled={fileLoading}
                  className="flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-border-main rounded-lg
                    text-xs text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-50 transition-all duration-150"
                >
                  {fileLoading
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Загружаю...</>
                    : <><Paperclip className="w-3 h-3" /> Загрузить из файла</>}
                </button>
                {fileAttachments.length > 0 && !fileLoading && fileAttachments.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    title={`${file.name}: ${file.text.length.toLocaleString()} симв. попадет в LLM`}
                    className="flex max-w-[260px] items-center gap-1 text-xs text-text-muted bg-bg-subtle border border-border-main rounded-lg px-2 py-1"
                  >
                    <FileText className="w-3 h-3 flex-shrink-0 text-indigo-400" />
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFileAttachments((prev) => prev.filter((_, i) => i !== index))}
                      className="ml-0.5 hover:text-red-500 transition-colors"
                      aria-label={`Убрать файл ${file.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <span className="text-xs text-text-muted tabular-nums">
                {requirement.length.toLocaleString()} симв. в поле
                {fileAttachments.length > 0 && ` + ${fileChars.toLocaleString()} симв. из файлов`}
              </span>
            </div>
          </div>

          {/* Test data from DB */}
          {tdConnections.length === 0 ? (
            <div className="bg-bg-card border border-dashed border-border-main rounded-xl p-4 mb-4">
              <span className="text-sm font-medium text-text-main">Искать тестовые данные в БД</span>
              <p className="text-xs text-text-muted mt-0.5">
                Подключите базу данных в <a href="/settings" className="text-primary underline">Настройках → Тестовые данные</a> —
                и здесь появится выбор БД: LLM получит реальную схему и подставит SQL-запросы в шаги кейсов.
              </p>
            </div>
          ) : (
            <div className="bg-bg-card border border-border-main rounded-xl p-4 mb-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tdSearchEnabled}
                  onChange={e => setTdSearchEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-border-main text-primary focus:ring-primary/30"
                />
                <div>
                  <span className="text-sm font-medium text-text-main">Искать тестовые данные в БД</span>
                  <p className="text-xs text-text-muted">LLM получит схему реальных БД и подставит запросы для тестовых данных в шаги кейсов</p>
                </div>
              </label>

              {tdSearchEnabled && (
                <div className="mt-3 ml-7 relative" ref={tdDropdownRef}>
                  <button
                    onClick={() => setTdDropdownOpen(p => !p)}
                    className={`${INPUT_CLS} flex items-center justify-between cursor-pointer text-left text-xs`}
                  >
                    <span className="truncate">
                      {selectedTdConns.size === 0
                        ? "Выберите базы данных..."
                        : tdConnections
                            .filter(c => selectedTdConns.has(c.id))
                            .map(c => c.display_name)
                            .join(", ")}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${tdDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {tdDropdownOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-bg-card border border-border-main rounded-lg shadow-lg overflow-hidden">
                      {tdConnections.map(c => {
                        const checked = selectedTdConns.has(c.id);
                        const hasSchema = !!c.cached_schema;
                        return (
                          <label
                            key={c.id}
                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-bg-subtle transition-colors text-xs
                              ${checked ? "bg-primary/5" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedTdConns(prev => {
                                  const next = new Set(prev);
                                  if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                  return next;
                                });
                              }}
                              className="w-3.5 h-3.5 rounded border-border-main text-primary focus:ring-primary/30"
                            />
                            <span className="text-text-main truncate">{c.display_name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              c.sql_dialect === "postgresql" ? "bg-blue-100 text-blue-700"
                              : c.sql_dialect === "mysql" ? "bg-orange-100 text-orange-700"
                              : "bg-red-100 text-red-700"
                            }`}>
                              {c.driver_name}
                            </span>
                            {!hasSchema && (
                              <span className="text-[10px] text-yellow-600">нет схемы</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {selectedTdConns.size > 0 && !tdConnections.some(c => selectedTdConns.has(c.id) && c.cached_schema) && (
                    <p className="text-[11px] text-yellow-600 mt-1.5">
                      У выбранных БД нет схемы. Выполните introspect в <a href="/settings" className="underline">Настройках</a>.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={!hasGenerationSource}
              className={`flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
                hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md
                ${!hasGenerationSource ? "opacity-40" : ""}`}
            >
              <Sparkles className="w-4 h-4" />
              Генерировать тест-кейсы
            </button>
          </div>
        </div>
      )}

      {/* ── GENERATING ── */}
      {stage === "generating" && (
        <div className="p-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4 max-w-2xl">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-text-main">Генерация...</h1>
              {currentDepth && (
                <span className="text-sm text-text-muted flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {currentDepth.hint}
                </span>
              )}
            </div>
            <button
              onClick={cancel}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-red-200 rounded-lg text-sm
                text-red-500 hover:bg-red-50 hover:border-red-300 transition-all duration-150 group"
            >
              <StopCircle className="w-3.5 h-3.5 transition-transform group-hover:scale-110 duration-200" />
              Отменить
            </button>
          </div>
          {!wsConnected && sessionId && (
            <div className="max-w-2xl mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              Соединение потеряно — генерация продолжается на сервере. Переподключение...
            </div>
          )}
          <div className="max-w-2xl">
            <StatusPanel events={events} progress={progress} />
          </div>
        </div>
      )}

      {/* ── REVIEW ── */}
      {stage === "review" && (
        <div className="p-6 animate-slide-up">
          <div className="flex items-center justify-between mb-4 max-w-3xl">
            <div>
              <h1 className="text-xl font-bold text-text-main">
                {state === "error"
                  ? events.some((e) => e.type === "error" && e.llm_error)
                    ? "Проблема с LLM-провайдером"
                    : "Ошибка генерации"
                  : `${cases.length} тест-кейсов готово`}
              </h1>
              {state !== "error" && elapsedFinal > 0 && (
                <p className="text-sm text-text-muted flex items-center gap-1 mt-0.5">
                  <Clock className="w-3.5 h-3.5" />
                  за {elapsedFinal}с
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto scrollbar-thin">
              {state === "error" && sessionId && (
                <button
                  onClick={() => { resume(sessionId); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold
                    hover:bg-amber-600 transition-all duration-150 active:scale-[0.98] shadow-sm whitespace-nowrap flex-shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  Продолжить
                </button>
              )}
              <button
                onClick={() => { refreshHistory(); setHistFromStage("review"); setStage("history"); }}
                className="flex items-center gap-1 px-2.5 py-1.5 border border-border-main rounded-lg text-xs
                  text-text-muted hover:bg-bg-subtle hover:text-primary transition-all duration-150 whitespace-nowrap flex-shrink-0"
              >
                <History className="w-3 h-3" />
                История
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-1 px-2.5 py-1.5 border border-border-main rounded-lg text-xs
                  text-text-muted hover:bg-bg-subtle hover:text-text-main transition-all duration-150 whitespace-nowrap flex-shrink-0"
              >
                <Plus className="w-3 h-3" />
                Новая
              </button>
              {cases.length > 0 && selectedCases.size > 0 && (
                <>
                  {/* В эталон */}
                  {(() => {
                    const eid = sessionId ?? "current";
                    const st = etalonStatus[eid];
                    if (st === "done") return (
                      <span className="flex items-center gap-1 px-2.5 py-1.5 border border-green-200 bg-green-50 rounded-lg text-xs text-green-700 whitespace-nowrap flex-shrink-0">
                        <CheckCircle2 className="w-3 h-3" /> Эталон
                      </span>
                    );
                    return (
                      <button
                        disabled={st === "loading"}
                        onClick={async () => {
                          setEtalonStatus(prev => ({ ...prev, [eid]: "loading" }));
                          try {
                            const sel = cases.filter((_, i) => selectedCases.has(i));
                            await addEtalon({
                              req_text: stripMarkdown(genMetaRef.current.requirement ?? ""),
                              tc_text: casesToText(sel),
                              qa_doc: stripMarkdown(qaDoc),
                              platform: genMetaRef.current.platform.join(", "),
                              feature: genMetaRef.current.feature,
                              name: genMetaRef.current.feature || "Генерация",
                            });
                            setEtalonStatus(prev => ({ ...prev, [eid]: "done" }));
                          } catch {
                            setEtalonStatus(prev => ({ ...prev, [eid]: "error" }));
                            setTimeout(() => setEtalonStatus(prev => { const n = { ...prev }; delete n[eid]; return n; }), 2500);
                          }
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs transition-all duration-150 whitespace-nowrap flex-shrink-0
                          ${st === "error"
                            ? "border-red-200 text-red-500"
                            : "border-border-main text-text-muted hover:bg-bg-subtle hover:text-indigo-600"}`}
                      >
                        {st === "loading"
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> ...</>
                          : st === "error"
                            ? <><XCircle className="w-3 h-3" /> Ошибка</>
                            : <><BookmarkPlus className="w-3 h-3" /> Эталон</>}
                      </button>
                    );
                  })()}
                  <button
                    onClick={() => {
                      const sel = cases.filter((_, i) => selectedCases.has(i));
                      const text = exportResult?.xml ?? casesToText(sel);
                      sessionStorage.setItem("st_automodel_prefill",
                        JSON.stringify({ text, feature: genMetaRef.current.feature ?? "" }));
                      window.location.href = "/auto-model";
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-border-main rounded-lg text-xs
                      text-text-muted hover:bg-bg-subtle hover:text-violet-600 transition-all duration-150 whitespace-nowrap flex-shrink-0"
                  >
                    <FlaskConical className="w-3 h-3" />
                    Автотест
                  </button>
                  <button
                    onClick={() => {
                      const sel = cases.filter((_, i) => selectedCases.has(i));
                      exportingHistIdRef.current = currentHistIdRef.current ?? sessionId;
                      setExportSource({ cases: sel, qaDoc });
                      setExportBackStage("review");
                      setStage("export");
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-semibold
                      hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm whitespace-nowrap flex-shrink-0"
                  >
                    <Download className="w-3 h-3" />
                    Экспорт ({selectedCases.size})
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="max-w-3xl">
            {events.length > 0 && (
              <div className="mb-4">
                <StatusPanel events={events} progress={null} done={state === "done"} error={state === "error"} elapsed={elapsedFinal} />
              </div>
            )}
            {qaDoc && (
              <div className="mb-4 bg-bg-card border border-border-main rounded-xl overflow-hidden">
                <button
                  onClick={() => setQaExpanded((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium
                    text-text-main hover:bg-bg-subtle/70 transition-colors group"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-text-muted" />
                    QA Документация
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-text-muted transition-transform duration-200 ${qaExpanded ? "rotate-180" : ""}`}
                  />
                </button>
                {qaExpanded && (
                  <div className="border-t border-border-main animate-fade-in">
                    <div className="flex justify-end px-4 pt-3">
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(qaDoc);
                          setQaCopied(true);
                          setTimeout(() => setQaCopied(false), 2000);
                        }}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-all duration-150
                          ${qaCopied
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "border-border-main text-text-muted hover:bg-bg-subtle hover:text-text-main"}`}
                      >
                        {qaCopied ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано!</> : <><Copy className="w-3.5 h-3.5" /> Копировать</>}
                      </button>
                    </div>
                    <div className="px-5 py-4">
                      <NotionRenderer text={qaDoc} />
                    </div>
                  </div>
                )}
              </div>
            )}
            {cases.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                    Тест-кейсы ({selectedCases.size}/{cases.length})
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedCases(new Set(cases.map((_, i) => i)))}
                      className="text-xs text-primary hover:text-primary-dark transition-colors"
                    >
                      Выбрать все
                    </button>
                    <span className="text-text-muted/30">|</span>
                    <button
                      onClick={() => setSelectedCases(new Set())}
                      className="text-xs text-text-muted hover:text-red-500 transition-colors"
                    >
                      Снять все
                    </button>
                  </div>
                </div>
                {cases.map((c, i) => (
                  <CaseCard
                    key={i}
                    index={i + 1}
                    case_={c}
                    selectable
                    selected={selectedCases.has(i)}
                    onToggle={() => setSelectedCases(prev => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })}
                    className="animate-slide-up"
                    style={{ animationDelay: `${Math.min(i * 30, 300)}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORY LIST ── */}
      {stage === "history" && (
        <div className="p-6 animate-slide-up">
          <div className="flex items-center justify-between mb-4 max-w-2xl">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStage(histFromStage)}
                className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
              >
                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                Назад
              </button>
              <span className="text-text-muted/40">·</span>
              <h1 className="text-xl font-bold text-text-main">История генераций</h1>
            </div>
            <button
              onClick={refreshHistory}
              disabled={histLoading}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${histLoading ? "animate-spin" : ""}`} />
              Обновить
            </button>
          </div>

          {histLoading && histSessions.length === 0 ? (
            <div className="max-w-2xl flex flex-col items-center justify-center py-16 text-text-muted">
              <Loader2 className="w-8 h-8 mb-3 animate-spin opacity-30" />
              <p className="text-sm">Загрузка истории...</p>
            </div>
          ) : histSessions.length === 0 ? (
            <div className="max-w-2xl flex flex-col items-center justify-center py-16 text-text-muted">
              <History className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">История пуста — завершите генерацию, чтобы она появилась здесь</p>
            </div>
          ) : (
            <div className="max-w-2xl space-y-5">
              {histViewLoading && (
                <div className="fixed inset-0 z-50 bg-black/10 flex items-center justify-center">
                  <div className="bg-bg-card rounded-xl px-6 py-4 shadow-lg flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <span className="text-sm text-text-main">Загрузка сессии...</span>
                  </div>
                </div>
              )}
              {HIST_GROUPS
                .map(g => [g, histSessions.filter(s => getDateGroup(s.created_at) === g)] as [string, GenSessionSummary[]])
                .filter(([, entries]) => entries.length > 0)
                .map(([group, entries]) => (
                  <div key={group}>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{group}</p>
                    <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden divide-y divide-border-main">
                      {entries.map(entry => {
                        const badge = STATUS_BADGE[entry.status] ?? STATUS_BADGE.done;
                        const isRunning = entry.status === "generating";
                        const hasError = entry.status === "error" || entry.status === "cancelled";
                        return (
                          <div
                            key={entry.id}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-bg-subtle/60 cursor-pointer group transition-colors"
                            onClick={() => openHistSession(entry)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-text-main truncate">{sessionTitle(entry)}</p>
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border flex-shrink-0 ${badge.cls}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <p className="text-xs text-text-muted mt-0.5">
                                {entry.case_count > 0 ? `${entry.case_count} кейсов` : "кейсы не готовы"}
                                {" · "}
                                {DEPTHS.find(d => d.id === entry.depth)?.label ?? entry.depth}
                                {" · "}
                                {entry.platform}
                                {entry.elapsed > 0 ? ` · ${entry.elapsed}с` : ""}
                              </p>
                              {/* Кнопки действий: экспорт / продолжить */}
                              <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                                {entry.status === "done" && !entry.has_export && entry.case_count > 0 && (
                                  <button
                                    onClick={() => openHistSession(entry)}
                                    className="text-[11px] font-medium text-primary hover:text-primary-dark flex items-center gap-0.5 transition-colors"
                                  >
                                    <Download className="w-2.5 h-2.5" /> Сгенерировать файл
                                  </button>
                                )}
                                {hasError && (
                                  <button
                                    onClick={() => {
                                      resume(entry.id);
                                      setStage("generating");
                                    }}
                                    className="text-[11px] font-medium text-amber-600 hover:text-amber-700 flex items-center gap-0.5 transition-colors"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> Продолжить
                                  </button>
                                )}
                                {isRunning && (
                                  <span className="text-[11px] text-blue-500 flex items-center gap-1">
                                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Идёт генерация
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="text-xs text-text-muted flex-shrink-0">{formatHistTime(entry.created_at)}</span>
                            {/* Загрузить в эталон */}
                            {entry.status === "done" && entry.case_count > 0 && (() => {
                              const st = etalonStatus[entry.id];
                              if (st === "done") return (
                                <span className="flex-shrink-0 p-0.5 text-green-500" title="Добавлено в эталоны">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </span>
                              );
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
                                  title="Загрузить в эталон"
                                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-indigo-500 transition-opacity flex-shrink-0 p-0.5"
                                >
                                  <BookmarkPlus className="w-3.5 h-3.5" />
                                </button>
                              );
                            })()}
                            <button
                              onClick={e => { e.stopPropagation(); if (window.confirm("Удалить эту запись?")) deleteHistSession(entry.id); }}
                              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity flex-shrink-0 p-0.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY ITEM ── */}
      {stage === "histitem" && histView && (
        <div className="p-6 animate-slide-up">
          {(() => {
            const hvCases = (histView.cases ?? []) as Case[];
            const hvQaDoc = histView.qa_doc ?? "";
            const hvBadge = STATUS_BADGE[histView.status] ?? STATUS_BADGE.done;
            const hvTitle = sessionTitle(histView);
            return (
              <>
                <div className="flex items-start justify-between mb-4 max-w-3xl gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => { setStage("history"); setHistView(null); }}
                      className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group flex-shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                      История
                    </button>
                    <span className="text-text-muted/40 flex-shrink-0">·</span>
                    <h1 className="text-lg font-bold text-text-main truncate">{hvTitle}</h1>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border flex-shrink-0 ${hvBadge.cls}`}>
                      {hvBadge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(histView.status === "error" || histView.status === "cancelled") && (
                      <button
                        onClick={() => { resume(histView.id); setStage("generating"); }}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold
                          hover:bg-amber-600 transition-all duration-150 active:scale-[0.98] shadow-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Продолжить
                      </button>
                    )}
                    {hvCases.length > 0 && histSelectedCases.size > 0 && (
                      <>
                        {/* В эталон */}
                        {(() => {
                          const eid = histView.id;
                          const st = etalonStatus[eid];
                          if (st === "done") return (
                            <span className="flex items-center gap-1.5 px-3.5 py-2 border border-green-200 bg-green-50 rounded-lg text-sm text-green-700">
                              <CheckCircle2 className="w-3.5 h-3.5" /> В эталонах
                            </span>
                          );
                          return (
                            <button
                              disabled={st === "loading"}
                              onClick={async () => {
                                setEtalonStatus(prev => ({ ...prev, [eid]: "loading" }));
                                try {
                                  const sel = hvCases.filter((_: Case, i: number) => histSelectedCases.has(i));
                                  await addEtalon({
                                    req_text: stripMarkdown(histView.requirement ?? ""),
                                    tc_text: casesToText(sel),
                                    qa_doc: stripMarkdown(hvQaDoc),
                                    platform: histView.platform,
                                    feature: histView.feature,
                                    name: histView.feature || "Генерация",
                                  });
                                  setEtalonStatus(prev => ({ ...prev, [eid]: "done" }));
                                } catch {
                                  setEtalonStatus(prev => ({ ...prev, [eid]: "error" }));
                                  setTimeout(() => setEtalonStatus(prev => { const n = { ...prev }; delete n[eid]; return n; }), 2500);
                                }
                              }}
                              className={`flex items-center gap-1.5 px-3.5 py-2 border rounded-lg text-sm transition-all duration-150
                                ${st === "error"
                                  ? "border-red-200 text-red-500"
                                  : "border-border-main text-text-muted hover:bg-bg-subtle hover:text-indigo-600"}`}
                            >
                              {st === "loading"
                                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохраняю...</>
                                : st === "error"
                                  ? <><XCircle className="w-3.5 h-3.5" /> Ошибка</>
                                  : <><BookmarkPlus className="w-3.5 h-3.5" /> В эталон</>}
                            </button>
                          );
                        })()}
                        <button
                          onClick={() => {
                            const sel = hvCases.filter((_: Case, i: number) => histSelectedCases.has(i));
                            const text = histView.export_result?.xml ?? casesToText(sel);
                            sessionStorage.setItem("st_automodel_prefill",
                              JSON.stringify({ text, feature: histView.feature }));
                            window.location.href = "/auto-model";
                          }}
                          className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                            text-text-muted hover:bg-bg-subtle hover:text-violet-600 transition-all duration-150"
                        >
                          <FlaskConical className="w-3.5 h-3.5" />
                          В автотесты
                        </button>
                        <button
                          onClick={() => {
                            const sel = hvCases.filter((_: Case, i: number) => histSelectedCases.has(i));
                            exportingHistIdRef.current = histView.id;
                            setExportSource({ cases: sel, qaDoc: hvQaDoc, sessionId: histView.id });
                            setExportBackStage("histitem");
                            setStage("export");
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                            hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Экспорт ({histSelectedCases.size})
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="max-w-3xl">
                  {/* Meta badges */}
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    <span className="text-xs bg-[var(--color-active-bg)] text-primary border border-indigo-100 px-2 py-1 rounded-md font-medium">
                      {DEPTHS.find(d => d.id === histView.depth)?.label ?? histView.depth}
                    </span>
                    <span className="text-xs bg-bg-subtle text-text-muted border border-border-main px-2 py-1 rounded-md">
                      {histView.platform}
                    </span>
                    <span className="text-xs text-text-muted">
                      {hvCases.length} кейсов{histView.elapsed > 0 ? ` · за ${histView.elapsed}с` : ""}
                    </span>
                    <span className="text-xs text-text-muted ml-auto">{formatHistTime(histView.created_at)}</span>
                  </div>

                  {/* Error message */}
                  {histView.error && (
                    <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{histView.error}</span>
                    </div>
                  )}

                  {/* Export result downloads */}
                  {histView.export_result && (
                    <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-green-50/50 border border-green-200 rounded-xl">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-green-700 font-medium">Файл экспортирован</span>
                      <div className="flex items-center gap-2 ml-auto">
                        <button onClick={() => downloadBlob(histView.export_result!.xml, `cases_${histView.id}.xml`, "application/xml")}
                          className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors">
                          <Download className="w-2.5 h-2.5" /> XML
                        </button>
                        <span className="text-text-muted/40">·</span>
                        <button onClick={() => downloadBlob(histView.export_result!.csv, `cases_${histView.id}.csv`, "text/csv")}
                          className="text-[11px] font-medium text-emerald-500 hover:text-emerald-700 flex items-center gap-0.5 transition-colors">
                          <Download className="w-2.5 h-2.5" /> CSV
                        </button>
                        <span className="text-text-muted/40">·</span>
                        <button onClick={() => downloadBlob(histView.export_result!.md, `cases_${histView.id}.md`, "text/markdown")}
                          className="text-[11px] font-medium text-violet-500 hover:text-violet-700 flex items-center gap-0.5 transition-colors">
                          <Download className="w-2.5 h-2.5" /> MD
                        </button>
                      </div>
                    </div>
                  )}

                  {/* QA Doc */}
                  {hvQaDoc && (
                    <div className="mb-4 bg-bg-card border border-border-main rounded-xl overflow-hidden">
                      <button
                        onClick={() => setQaExpanded(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium
                          text-text-main hover:bg-bg-subtle/70 transition-colors group"
                      >
                        <span className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-text-muted" />
                          QA Документация
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${qaExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {qaExpanded && (
                        <div className="border-t border-border-main animate-fade-in">
                          <div className="flex justify-end px-4 pt-3">
                            <button
                              onClick={async () => {
                                await navigator.clipboard.writeText(hvQaDoc);
                                setQaCopied(true);
                                setTimeout(() => setQaCopied(false), 2000);
                              }}
                              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-all duration-150
                                ${qaCopied
                                  ? "bg-green-50 border-green-200 text-green-700"
                                  : "border-border-main text-text-muted hover:bg-bg-subtle hover:text-text-main"}`}
                            >
                              {qaCopied ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано!</> : <><Copy className="w-3.5 h-3.5" /> Копировать</>}
                            </button>
                          </div>
                          <div className="px-5 py-4">
                            <NotionRenderer text={hvQaDoc} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cases */}
                  {hvCases.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                          {histSelectedCases.size}/{hvCases.length} тест-кейсов
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setHistSelectedCases(new Set(hvCases.map((_: Case, i: number) => i)))}
                            className="text-xs text-primary hover:text-primary-dark transition-colors"
                          >
                            Выбрать все
                          </button>
                          <span className="text-text-muted/30">|</span>
                          <button
                            onClick={() => setHistSelectedCases(new Set())}
                            className="text-xs text-text-muted hover:text-red-500 transition-colors"
                          >
                            Снять все
                          </button>
                        </div>
                      </div>
                      {hvCases.map((c: Case, i: number) => (
                        <CaseCard
                          key={i}
                          index={i + 1}
                          case_={c}
                          selectable
                          selected={histSelectedCases.has(i)}
                          onToggle={() => setHistSelectedCases(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          })}
                          className="animate-slide-up"
                          style={{ animationDelay: `${Math.min(i * 30, 300)}ms` } as React.CSSProperties}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── EXPORT ── */}
      {stage === "export" && (
        <div className="p-6">
          {exportBackStage !== "histitem" && (
            <div className="max-w-2xl flex justify-end mb-2">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" />
                Новая генерация
              </button>
            </div>
          )}
          <div className="max-w-2xl">
            <ExportPanel
              cases={exportSource?.cases ?? cases}
              qaDoc={exportSource?.qaDoc ?? qaDoc}
              onExport={exportCases}
              result={exportResult}
              exporting={exporting}
              onBack={() => { setExportSource(null); setStage(exportBackStage); }}
            />
          </div>
        </div>
      )}
    </>
  );
}
