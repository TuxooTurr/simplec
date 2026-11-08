"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  Sparkles, ChevronDown, RotateCcw, Download, Clock,
  Paperclip, FileText, SlidersHorizontal, X, CheckCircle2, Plus, Trash2,
  StopCircle, History, ChevronLeft, BookmarkPlus, Loader2, XCircle, FlaskConical,
  Copy, CheckCheck, RefreshCw, AlertCircle, PenLine, ListChecks, Save, FolderTree, ArrowLeft, Send,
} from "lucide-react";
import TestDataSettingsModal from "@/components/settings/TestDataSettingsModal";
import StatusPanel from "@/components/StatusPanel";
import CaseCard from "@/components/CaseCard";
import ExportPanel, { type ExportPanelParams } from "@/components/ExportPanel";
import ModelPreviewModal from "@/components/taskgen/ModelPreviewModal";
import TaskDrafts from "@/components/taskgen/TaskDrafts";
import TaskPickerModal from "@/components/taskgen/TaskPickerModal";
import NotionRenderer from "@/components/NotionRenderer";
import StagePanel from "@/components/tmgen/StagePanel";
import TmBatchBar from "@/components/tmgen/TmBatchBar";
import DataTreePicker from "@/components/tmgen/DataTreePicker";
import { useTmGen } from "@/contexts/TmGenContext";
import { tmXml, zephyrProject, type TmStart } from "@/lib/tmApi";
import { useGeneration, type Case, type ExportResult } from "@/lib/useGeneration";
import {
  parseFile, addEtalon, deleteGenSession, listGenSessions, getGenSession, exportGenSession,
  listTestDataConnections, getTestDataSchemasText,
  listRequirements, addRequirement, listReqFolders,
  type GenSessionSummary, type GenSession, type TestDataConnection, type Requirement, type ReqFolder,
} from "@/lib/api";
import { useSplitView, useWorkspace } from "@/contexts/WorkspaceContext";
import { dataFolderPath, featureOf, modelFolder, taskSource, type ModelGroup, type TaskDraft, type TaskFile, type TaskJob, type TaskPick } from "@/lib/taskModel";
import { parseZephyrXml } from "@/lib/zephyrStaging";
import { RefreshIcon } from "@/components/ui/RefreshButton";

/** Ширина формы, когда результат сбоку: остальное место — кейсам. */
const FORM_W = "w-[520px]";

type Stage = "input" | "generating" | "tm" | "review" | "export" | "history" | "histitem";

/* Лейблы глубины — только для отображения старых записей истории */
const DEPTH_LABELS: Record<string, string> = {
  smoke: "Smoke", regression: "Regression", full: "Full", atomary: "Atomary", max: "Максимум",
};

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

function sumEstimatedMinutes(cases: Case[]): number {
  return cases.reduce((sum, c) => sum + (c.estimated_minutes ?? 5), 0);
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
  planning:     { label: "Планирование…",     cls: "tone-info" },
  plan_ready:   { label: "Ждёт утверждения",  cls: "tone-info" },
  writing:      { label: "Генерация…",        cls: "tone-info" },
  reviewing:    { label: "Проверка…",         cls: "tone-info" },
  review_ready: { label: "Замечания арбитра", cls: "tone-info" },
  fixing:       { label: "Исправление…",      cls: "tone-info" },
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

  // Название фичи — обязательное, идёт в имена кейсов: [Фича] Группа. Наименование
  const [featureName, setFeatureName] = useState("");
  const [featureTouched, setFeatureTouched] = useState(false);

  // Источник требования: свободный ввод, документы из дерева «Данных» или задачи списка Jira tool
  const [reqSource, setReqSource] = useState<"free" | "data" | "tasks">("free");
  const [dataFolders, setDataFolders] = useState<ReqFolder[]>([]);
  const [dataDocs, setDataDocs] = useState<Requirement[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [pickedDocs, setPickedDocs] = useState<Set<string>>(new Set());
  // Платформы из вводных методики: W — веб и бэкенд, M — мобильное приложение
  const [platforms, setPlatforms] = useState<"W" | "M" | "W и M">("W");
  const [reqSaving, setReqSaving] = useState(false);
  const [reqSaved, setReqSaved] = useState(false);

  // Генерация по задачам Jira tool: выбранные задачи (предзаполнено из требований), выгрузка и предпросмотр модели
  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taskExportMode, setTaskExportMode] = useState(false);
  const [taskFiles, setTaskFiles] = useState<TaskFile[] | null>(null);
  const [taskExporting, setTaskExporting] = useState(false);
  const [taskExportErr, setTaskExportErr] = useState("");
  const [preview, setPreview] = useState<{ project: string; groups: ModelGroup[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const [stage, setStage]             = useState<Stage>("input");
  const split = useSplitView();
  const [elapsedFinal, setElapsedFinal] = useState(0);
  const [qaExpanded, setQaExpanded]   = useState(false);
  const [qaCopied, setQaCopied]       = useState(false);
  // Панель QA-дока на экране генерации: открыта сразу, чтобы читать не дожидаясь конца
  const [liveQaExpanded, setLiveQaExpanded] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileAttachments, setFileAttachments] = useState<ParsedFileAttachment[]>([]);
  const reqFileRef = useRef<HTMLInputElement>(null);

  // ── Test data search ─────────────────────────────────────────
  const [tdSearchEnabled, setTdSearchEnabled] = useState(false);
  const [tdConnections, setTdConnections] = useState<TestDataConnection[]>([]);
  const [selectedTdConns, setSelectedTdConns] = useState<Set<string>>(new Set());
  const [tdDropdownOpen, setTdDropdownOpen] = useState(false);
  const [tdSettingsOpen, setTdSettingsOpen] = useState(false);
  const tdDropdownRef = useRef<HTMLDivElement>(null);

  // Load test data connections
  const loadTdConnections = useCallback(() => {
    listTestDataConnections()
      .then(conns => {
        setTdConnections(conns);
        // Auto-select connections with schema
        const withSchema = conns.filter(c => c.cached_schema).map(c => c.id);
        if (withSchema.length > 0) setSelectedTdConns(new Set(withSchema));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadTdConnections(); }, [loadTdConnections]);

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
  const tmOpenRef = useRef<(id: string) => void>(() => {});
  const [exportSource, setExportSource] = useState<{ cases: Case[]; qaDoc: string; sessionId?: string } | null>(null);
  const [exportBackStage, setExportBackStage] = useState<Stage>("review");
  const genMetaRef = useRef({ feature: "", project: "", team: "", ke: "", depth: "max", platform: ["Web"] as string[], requirement: "" });
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
  const [etalonErrorMsg, setEtalonErrorMsg] = useState<Record<string, string>>({});

  // Пара исходник+документация в требования — доступно уже во время генерации
  // (сразу после layer 1), без ожидания кейсов: чистое локальное сохранение,
  // генерацию (websocket) не трогает и не прерывает.
  const [reqDocStatus, setReqDocStatus] = useState<Record<string, "loading" | "done" | "error">>({});
  const [reqDocErrorMsg, setReqDocErrorMsg] = useState<Record<string, string>>({});

  const handleSaveDocAsRequirement = useCallback(async (eid: string, qaDocText: string, qaDocWasTruncated: boolean) => {
    setReqDocStatus((prev) => ({ ...prev, [eid]: "loading" }));
    try {
      await addRequirement({
        name: genMetaRef.current.feature || "Без названия",
        feature: genMetaRef.current.feature,
        text: genMetaRef.current.requirement,
        qa_doc: qaDocText,
        qa_doc_truncated: qaDocWasTruncated,
      });
      setReqDocStatus((prev) => ({ ...prev, [eid]: "done" }));
    } catch (e) {
      setReqDocStatus((prev) => ({ ...prev, [eid]: "error" }));
      setReqDocErrorMsg((prev) => ({ ...prev, [eid]: e instanceof Error ? e.message : String(e) }));
      setTimeout(() => {
        setReqDocStatus((prev) => { const n = { ...prev }; delete n[eid]; return n; });
        setReqDocErrorMsg((prev) => { const n = { ...prev }; delete n[eid]; return n; });
      }, 8000);
    }
  }, []);

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
    } catch (e) {
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "error" }));
      setEtalonErrorMsg(prev => ({ ...prev, [entry.id]: e instanceof Error ? e.message : String(e) }));
      setTimeout(() => {
        setEtalonStatus(prev => { const n = { ...prev }; delete n[entry.id]; return n; });
        setEtalonErrorMsg(prev => { const n = { ...prev }; delete n[entry.id]; return n; });
      }, 8000);
    }
  }, []);

  /** Открыть полную сессию из истории */
  const openHistSession = useCallback(async (entry: GenSessionSummary) => {
    // Незавершённая тестовая модель по этапам — открываем её этапы, а не карточку истории.
    if (entry.kind === "tm" && entry.status !== "done") { tmOpenRef.current(entry.id); setStage("tm"); return; }
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

  // ── Дерево «Данных» (вкладка «Из «Данных»») ───────────────────────
  const refreshData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [d, f] = await Promise.all([listRequirements(), listReqFolders()]);
      setDataDocs(d); setDataFolders(f);
    } catch {
      // тихо — без «Данных» остаются свободный ввод и задачи
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { if (reqSource === "data") refreshData(); }, [reqSource, refreshData]);

  const chosenDocs = dataDocs.filter(d => pickedDocs.has(d.id));
  /** Документ отмечен: фича — из документа или его папки, если ещё не вписана. */
  const toggleDoc = (d: Requirement) => {
    setPickedDocs(cur => {
      const n = new Set(cur);
      if (n.has(d.id)) n.delete(d.id); else n.add(d.id);
      return n;
    });
    if (!pickedDocs.has(d.id) && !featureName.trim()) {
      const path = dataFolderPath(dataFolders, d.folder_id);
      setFeatureName((d.feature || path[path.length - 1] || d.name).trim());
    }
  };

  async function handleSaveAsRequirement() {
    if (!requirement.trim()) return;
    setReqSaving(true);
    try {
      await addRequirement({
        name: featureName.trim() || "Без названия",
        feature: featureName.trim(),
        text: requirement,
      });
      setReqSaved(true);
      setTimeout(() => setReqSaved(false), 2000);
      if (reqSource === "data") refreshData();
    } catch (err) {
      alert("Не удалось сохранить требование: " + String(err));
    } finally {
      setReqSaving(false);
    }
  }
  // ── End требования ─────────────────────────────────────────────

  const { state, events, progress, cases, qaDoc, qaDocTruncated, resume, exportCases, cancel, exportResult, exporting, reset, sessionId, wsConnected,
    attachToSession } = useGeneration();
  const tm = useTmGen();
  tmOpenRef.current = tm.open;
  // Принятые наборы по задачам — как прежние задачи очереди: по ним выгрузка в модель с прогоном на задачу.
  const doneJobs: TaskJob[] = tm.sessions.filter(s => s.status === "done" && s.task).map(s => ({
    key: s.task!.key, summary: s.task!.summary, project: s.task!.project, feature: s.feature, requirement: "",
    reqNames: s.task!.reqNames, dataPath: s.place, status: "done", sessionId: s.id, caseCount: s.cases.length,
  }));
  const batchMode = tm.sessions.some(s => s.task);

  // Сессия тестовой модели есть (в том числе после перезагрузки) — правая зона показывает её этапы.
  useEffect(() => { if (tm.active && stage === "input") setStage("tm"); }, [tm.active?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tm.sessions.some(s => s.status === "done")) refreshHistory(); }, [tm.sessions.filter(s => s.status === "done").length]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Принятый (или проверенный) набор → прежний экран результата: кейсы, эталон, экспорт. */
  const openTmCases = (id: string) => {
    const s = tm.sessions.find(x => x.id === id);
    genMetaRef.current = { ...genMetaRef.current, feature: s?.feature ?? "", requirement: s?.requirement ?? "" };
    historySavedRef.current = true;
    currentHistIdRef.current = id;
    void attachToSession(id);
    setSelectedCases(new Set((s?.cases ?? []).map((_, i) => i)));
    setStage("review");
  };

  /** Задачи выбраны: новые предзаполняем из требований, у оставшихся правки не трогаем. */
  const pickTasks = (tasks: TaskPick[]) => setTaskDrafts(cur => tasks.map(t =>
    cur.find(x => x.key === t.key) ?? { ...t, feature: featureOf(t), text: taskSource(t) }));

  /** Параметры ExportPanel → выгрузка каждой задачи её сессией; папка в XML — корень модели. */
  const exportTasks = async (p: ExportPanelParams) => {
    setTaskExporting(true); setTaskExportErr(""); setTaskFiles(null);
    try {
      const out: TaskFile[] = [];
      for (const job of doneJobs) {
        const r = await exportGenSession(job.sessionId!, {
          project: p.project, system: p.system, team: p.team, domain: p.domain, folder: p.folder, use_llm: p.use_llm, provider: p.provider,
          crit_regress: p.crit_regress, project_id: p.project_id, jira_version: p.jira_version, author_name: p.author_name, author_tab_num: p.author_tab_num,
        });
        out.push({ job, ...r });
      }
      setTaskFiles(out);
    } catch (e) {
      setTaskExportErr((e as Error).message);
    }
    setTaskExporting(false);
  };

  /** Группа предпросмотра задачи: кейсы из её XML, тип сценария — из сессии (по нему папка в модели). */
  const taskGroup = async (job: TaskJob, xml: string, root: string): Promise<ModelGroup> => {
    const [parsed, session] = await Promise.all([parseZephyrXml(xml), getGenSession(job.sessionId!)]);
    const types = new Map((session.cases as Case[] | undefined ?? []).map(c => [c.name, c.case_type]));
    const scenarios = new Map((session.cases as (Case & { scenario?: string })[] | undefined ?? []).map(c => [c.name, c.scenario]));
    return {
      id: job.key, task: { key: job.key, summary: job.summary }, reqNames: job.reqNames, run: true,
      folder: modelFolder(root, job.dataPath.length ? job.dataPath : [job.feature]),
      cases: parsed.cases.map((c, i) => ({ ...c, id: `${job.key}:${i}`, caseType: types.get(c.name), scenario: scenarios.get(c.name), on: true })),
    };
  };

  // ── Готовый XML тестовой модели: без окна настроек экспорта — скачать или сразу в Zephyr ──
  const [tmXmlBusy, setTmXmlBusy] = useState<"" | "download" | "zephyr">("");
  const [tmXmlErr, setTmXmlErr] = useState("");
  const xmlName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "model"}.xml`;

  const downloadTm = async (ids: string[], only?: Record<string, number[]>) => {
    setTmXmlBusy("download"); setTmXmlErr("");
    try {
      const r = await tmXml(ids, zephyrProject(), only);
      const one = tm.sessions.find(s => s.id === ids[0]);
      downloadBlob(r.xml, xmlName(ids.length === 1 ? (one?.task ? `${one.task.key} ${one.feature}` : one?.feature ?? "") : `Тестовая модель ${new Date().toLocaleDateString("ru-RU")}`), "application/xml");
    } catch (e) { setTmXmlErr((e as Error).message); }
    setTmXmlBusy("");
  };

  /** В Zephyr — через предпросмотр структуры: там видно, куда лягут кейсы, и создаются прогоны задач. */
  const sendTm = async (ids: string[], only?: Record<string, number[]>) => {
    setTmXmlBusy("zephyr"); setTmXmlErr("");
    try {
      const project = zephyrProject();
      const r = await tmXml(ids, project, only);
      const groups = await Promise.all(r.files.map(async f => {
        const s = tm.sessions.find(x => x.id === f.id);
        if (s?.task) {
          const job: TaskJob = { key: s.task.key, summary: s.task.summary, project: s.task.project, feature: s.feature, requirement: "",
            reqNames: s.task.reqNames, dataPath: s.place, status: "done", sessionId: s.id, caseCount: s.cases.length };
          return taskGroup(job, f.xml, "Новая ТМ");
        }
        return { id: f.id, reqNames: [], folder: "", run: false,
          cases: (await parseZephyrXml(f.xml)).cases.map((c, i) => ({ ...c, id: `${f.id}:${i}`, on: true })) } as ModelGroup;
      }));
      setPreview({ project, groups });
    } catch (e) { setTmXmlErr((e as Error).message); }
    setTmXmlBusy("");
  };
  const tmXmlActions = { busy: tmXmlBusy, error: tmXmlErr, download: downloadTm, send: sendTm };

  const openPreview = async (p: { project: string; folder: string }) => {
    setPreviewBusy(true); setTaskExportErr("");
    try {
      const groups = taskExportMode
        ? await Promise.all((taskFiles ?? []).map(f => taskGroup(f.job, f.xml, p.folder)))
        : [{ id: "xml", reqNames: [], folder: "", run: false,
             cases: (await parseZephyrXml(exportResult!.xml)).cases.map((c, i) => ({ ...c, id: `xml:${i}`, on: true })) }];
      setPreview({ project: p.project.trim().toUpperCase(), groups });
    } catch (e) {
      setTaskExportErr((e as Error).message);
    }
    setPreviewBusy(false);
  };

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

  /** Схемы БД для тестовых данных — дополнение к источнику; не получилось — генерируем без них. */
  const schemasBlock = async (): Promise<string> => {
    if (!tdSearchEnabled || selectedTdConns.size === 0) return "";
    try {
      const schemasRes = await getTestDataSchemasText(Array.from(selectedTdConns));
      if (!schemasRes.text) return "";
      return "\n\n=== СХЕМЫ РЕАЛЬНЫХ БАЗ ДАННЫХ ДЛЯ ТЕСТОВЫХ ДАННЫХ ===\n"
        + "Используй реальные таблицы и колонки из схем ниже для формирования тестовых данных в шагах кейсов. "
        + "В поле test_data каждого шага указывай РЕАЛЬНЫЕ SQL-запросы для получения тестовых данных из этих таблиц.\n\n"
        + schemasRes.text;
    } catch {
      return "";
    }
  };

  /** Сессии тестовой модели по этапам: одна — свободный ввод или документы, по задачам — очередь, у каждой своя. */
  const handleGenerate = async () => {
    const schemas = await schemasBlock();
    try {
      if (reqSource === "tasks") {
        const items: TmStart[] = taskDrafts.filter(t => t.text.trim() && t.feature.trim()).map(t => ({
          requirement: buildLlmSourceText(t.text, fileAttachments) + schemas, feature: t.feature.trim(), provider, platforms,
          source: "task", place: t.dataPath,
          task: { key: t.key, summary: t.summary, project: t.project, reqNames: t.docs.map(d => d.name), dataPath: t.dataPath },
        }));
        if (!items.length) return;
        await tm.startBatch(items);
      } else {
        if (!featureName.trim()) { setFeatureTouched(true); return; }
        const docText = chosenDocs.map(d => `=== Требование: ${d.name} ===\n${(d.text || d.qa_doc || "").trim()}`).join("\n\n");
        const text = reqSource === "data" ? buildLlmSourceText(docText, fileAttachments) : buildLlmSourceText(requirement, fileAttachments);
        if (!text) return;
        const place = reqSource === "data" ? dataFolderPath(dataFolders, chosenDocs.find(d => d.folder_id)?.folder_id) : [];
        await tm.startOne({ requirement: text + schemas, feature: featureName.trim(), provider, platforms, source: reqSource, place });
      }
      reset();
      setTaskFiles(null); setTaskExportMode(false);
      setStage("tm");
    } catch {
      // текст ошибки — под кнопкой (tm.error)
    }
  };


  const handleReset = () => {
    historySavedRef.current = false;
    tm.clear();
    setPickedDocs(new Set());
    setTaskDrafts([]); setTaskFiles(null); setTaskExportMode(false); setTaskExportErr("");
    reset();
    setStage("input");
    setRequirement("");
    setFeatureName("");
    setFeatureTouched(false);
    setFileAttachments([]);
    setQaExpanded(false);
  };

  const fileChars = fileAttachments.reduce((sum, file) => sum + file.text.length, 0);
  const readyTasks = taskDrafts.filter(t => t.text.trim() && t.feature.trim()).length;
  const hasGenerationSource = reqSource === "tasks" ? readyTasks > 0
    : reqSource === "data" ? chosenDocs.some(d => (d.text || d.qa_doc || "").trim())
    : Boolean(requirement.trim() || fileAttachments.some((file) => file.text.trim()));
  const tmBusy = !!tm.active && ["planning", "writing", "reviewing", "fixing"].includes(tm.active.status);

  /* ─────────────── RENDER ─────────────── */
  const withForm = stage === "input" || stage === "generating" || stage === "tm" || stage === "review";
  return (
    <>
      {/* Modal рендерится на уровне компонента (вне stage-блоков) */}
      <TaskPickerModal open={pickerOpen} picked={taskDrafts} onPick={pickTasks} onClose={() => setPickerOpen(false)} />
      {preview && <ModelPreviewModal open project={preview.project} groups={preview.groups} onClose={() => setPreview(null)} />}
      {batchMode && (stage === "input" || stage === "tm" || stage === "review") && (
        <TmBatchBar sessions={tm.sessions} current={tm.active?.id ?? null} onOpen={id => { tm.open(id); setStage("tm"); }} xml={tmXmlActions} />
      )}

      {/* Форма и результат: зона одна — рядом (у каждого своя прокрутка), зон две — результат под формой */}
      {withForm && (
      <div className={split ? "" : "flex h-full min-h-0"}>
      {/* ── INPUT ── */}
        <div className={`p-6 animate-slide-up ${split ? "" : `${FORM_W} flex-shrink-0 overflow-y-auto scrollbar-thin border-r border-border-main`}`}>
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

          <div>
          {/* Фича и платформы — вводные методики: вместе дают имя кейса [W][Фича] Группа проверок. Описание.
              По задачам название фичи у каждой своё (в списке задач), здесь остаются только платформы. */}
          <div className="bg-bg-card border border-border-main rounded-xl p-4 mb-3">
            <div className="flex items-end gap-3">
              {reqSource !== "tasks" && (
                <div className="min-w-0 flex-1">
                  <label htmlFor="tm-feature" className={LABEL_CLS}>
                    Название фичи <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="tm-feature"
                    value={featureName}
                    onChange={(e) => setFeatureName(e.target.value)}
                    onBlur={() => setFeatureTouched(true)}
                    placeholder="Например: Оплата картой"
                    className={`w-full border rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 transition-shadow duration-150
                      focus:outline-none focus:ring-2
                      ${featureTouched && !featureName.trim()
                        ? "border-red-300 focus:ring-red-100 focus:border-red-400"
                        : "border-border-main focus:ring-primary/30 focus:border-primary/40"}`}
                  />
                </div>
              )}
              <div className={reqSource === "tasks" ? "flex flex-1 flex-wrap items-center gap-3" : "flex-shrink-0"}>
                <p className={reqSource === "tasks" ? "text-xs font-semibold uppercase tracking-wide text-text-muted" : LABEL_CLS}>Платформы</p>
                <div className="flex items-center gap-1 bg-bg-subtle border border-border-main rounded-lg p-0.5" role="group" aria-label="Платформы">
                  {(["W", "M", "W и M"] as const).map(p => (
                    <button key={p} type="button" onClick={() => setPlatforms(p)} aria-pressed={platforms === p}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${platforms === p ? "bg-bg-card text-primary shadow-sm" : "text-text-muted hover:text-text-main"}`}>{p}</button>
                  ))}
                </div>
                {reqSource === "tasks" && <span className="text-[11px] text-text-muted">название фичи — у каждой задачи в списке ниже</span>}
              </div>
            </div>
            {reqSource !== "tasks" && (
              <>
                <p className="text-xs text-text-muted mt-1.5">
                  Имя кейса: <code className="bg-bg-subtle px-1 py-0.5 rounded text-[11px]">[{platforms === "W и M" ? "W/M" : platforms}][{featureName.trim() || "Фича"}] Группа проверок. Описание</code>
                </p>
                {featureTouched && !featureName.trim() && (
                  <p className="text-xs text-red-500 mt-1">Укажите название фичи — оно нужно для имён кейсов</p>
                )}
              </>
            )}
            <p className="text-[11px] text-text-muted mt-1">W — веб и бэкенд, M — мобильное приложение</p>
          </div>

          {/* Требование: свободный ввод, документы «Данных» или задачи списка Jira tool */}
          <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4">
            <div className="flex flex-col items-start gap-2 mb-3">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide">Требование</label>
              <div className="flex max-w-full items-center gap-1 bg-bg-subtle border border-border-main rounded-lg p-0.5">
                {([
                  { id: "free", label: "Свободный ввод", icon: <PenLine className="w-3 h-3" /> },
                  { id: "data", label: "Из «Данных»", icon: <FolderTree className="w-3 h-3" /> },
                  { id: "tasks", label: "Из списка задач", icon: <ListChecks className="w-3 h-3" /> },
                ] as const).map(t => (
                  <button key={t.id} type="button" onClick={() => setReqSource(t.id)} aria-pressed={reqSource === t.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      reqSource === t.id ? "bg-bg-card text-primary shadow-sm" : "text-text-muted hover:text-text-main"}`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>

            {reqSource === "data" && (
              <div className="mb-3 space-y-2">
                {dataLoading && !dataFolders.length ? (
                  <p className="flex items-center gap-1.5 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загружаю дерево…</p>
                ) : (
                  <DataTreePicker folders={dataFolders} docs={dataDocs} mode="docs" selectedDocs={pickedDocs} onToggleDoc={toggleDoc} />
                )}
                <p className="text-xs text-text-muted">
                  {chosenDocs.length
                    ? <>Выбрано: {chosenDocs.length}. Место в модели — папка документа: <b className="font-medium text-text-main">{dataFolderPath(dataFolders, chosenDocs.find(d => d.folder_id)?.folder_id).join(" / ") || "не в папке — уточните на планировании"}</b></>
                    : "Отметьте документы — их текст уйдёт в генерацию, место в дереве возьмётся из папки документа."}
                </p>
              </div>
            )}

            {reqSource === "tasks" && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-xs text-text-muted">
                    Выберите список Jira tool и задачи. Требования возьмутся из «Данных», место в дереве — из папки требований; у каждой задачи свой план и своё утверждение.
                  </p>
                  <button type="button" onClick={() => setPickerOpen(true)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
                    <ListChecks className="w-4 h-4" /> {taskDrafts.length ? "Изменить" : "Выбрать задачи"}
                  </button>
                </div>
                {taskDrafts.length > 0 && <TaskDrafts tasks={taskDrafts} onChange={setTaskDrafts} />}
              </div>
            )}

            {reqSource === "free" && (<>
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
                <button
                  type="button"
                  onClick={handleSaveAsRequirement}
                  disabled={reqSaving || !requirement.trim()}
                  title="Сохранить текущий текст в библиотеку требований — потом можно будет выбрать его из списка здесь и приложить как контекст при регистрации дефекта"
                  className="flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-border-main rounded-lg
                    text-xs text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-50 transition-all duration-150"
                >
                  {reqSaving
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Сохраняю...</>
                    : reqSaved
                      ? <><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Сохранено</>
                      : <><Save className="w-3 h-3" /> Сохранить как требование</>}
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
                      </>)}
            {reqSource === "free" && (
              <p className="mt-1 text-[11px] text-text-muted">Место в дереве предложит планирование — его можно поправить перед генерацией.</p>
            )}
          </div>

          {/* Test data from DB */}
          <TestDataSettingsModal
            open={tdSettingsOpen}
            onClose={() => setTdSettingsOpen(false)}
            onChanged={loadTdConnections}
          />
          {tdConnections.length === 0 ? (
            <div className="bg-bg-card border border-dashed border-border-main rounded-xl p-4 mb-4">
              <span className="text-sm font-medium text-text-main">Искать тестовые данные в БД</span>
              <p className="text-xs text-text-muted mt-0.5">
                <button type="button" onClick={() => setTdSettingsOpen(true)} className="text-primary underline">
                  Подключите базу данных
                </button> — и здесь появится выбор БД: LLM получит реальную схему и подставит
                SQL-запросы в шаги кейсов.
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
                      У выбранных БД нет схемы. Получите её в{" "}
                      <button type="button" onClick={() => setTdSettingsOpen(true)} className="underline">
                        настройках подключений
                      </button>.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={!hasGenerationSource || tmBusy}
              title={tmBusy ? "Идёт этап текущей модели — дождитесь или остановите его" : undefined}
              className={`flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
                hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md
                ${!hasGenerationSource || tmBusy ? "opacity-40" : ""}`}
            >
              <Sparkles className="w-4 h-4" />
              {reqSource === "tasks" ? `Спланировать по задачам: ${readyTasks}` : "Спланировать тест-кейсы"}
            </button>
          </div>
          <p className="mt-2 text-right text-[11px] text-text-muted">Планирование → утверждение → генерация → проверка арбитром</p>
          {tm.error && stage !== "tm" && <p className="mt-1 text-right text-xs text-red-500">{tm.error}</p>}
          </div>
        </div>

      <div className={split ? "" : "min-w-0 flex-1 overflow-y-auto scrollbar-thin"}>
      {stage === "input" && !split && (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-text-muted">
          <Sparkles className="h-8 w-8 opacity-30" />
          <p className="text-sm">Здесь появятся тест-кейсы</p>
        </div>
      )}

      {/* ── ТЕСТОВАЯ МОДЕЛЬ ПО ЭТАПАМ ── */}
      {stage === "tm" && tm.active && <StagePanel session={tm.active} onOpenCases={openTmCases} xml={tmXmlActions} />}
      {stage === "tm" && !tm.active && (
        <div className="flex h-full items-center justify-center p-8 text-sm text-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загружаю сессию…</div>
      )}

      {/* ── GENERATING ── */}
      {stage === "generating" && (
        <div className="p-6 animate-fade-in">
          {/* Пока идёт генерация, показывать нечего, кроме прогресса — узкая колонка.
              QA-документация и кейсы ниже, по мере готовности, разворачиваются на всю ширину. */}
          <div className="max-w-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-text-main">Генерация...</h1>
                {genMetaRef.current.feature && (
                  <span className="text-sm text-text-muted flex items-center gap-1">
                    <FlaskConical className="w-3.5 h-3.5" />
                    {genMetaRef.current.feature}
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
              <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                Соединение потеряно — генерация продолжается на сервере. Переподключение...
              </div>
            )}
            <StatusPanel events={events} progress={progress} />
          </div>

          {/* QA документация доступна сразу после слоя 1 — читаем, пока собираются кейсы */}
          {qaDoc && (
            <div className="mt-4 bg-bg-card border border-border-main rounded-xl overflow-hidden animate-fade-in">
              <button
                onClick={() => setLiveQaExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium
                  text-text-main hover:bg-bg-subtle/70 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  QA Документация
                  <span className="text-xs font-normal text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    готова — можно читать
                  </span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-text-muted transition-transform duration-200 ${liveQaExpanded ? "rotate-180" : ""}`}
                />
              </button>
              {liveQaExpanded && (
                <div className="border-t border-border-main animate-fade-in">
                  {qaDocTruncated && (
                    <div className="mx-4 mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>
                        Документ обрезан лимитом модели — конец текста мог не поместиться.
                        Попробуйте сократить требование или сменить провайдера.
                      </span>
                    </div>
                  )}
                  <div className="flex justify-end items-center gap-2 px-4 pt-3">
                    {(() => {
                      const eid = sessionId ?? "current";
                      const st = reqDocStatus[eid];
                      if (st === "done") return (
                        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-green-200 bg-green-50 rounded-lg text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> В эталоне
                        </span>
                      );
                      return (
                        <button
                          disabled={st === "loading"}
                          onClick={() => handleSaveDocAsRequirement(eid, qaDoc, qaDocTruncated)}
                          title={st === "error" ? (reqDocErrorMsg[eid] || "Ошибка") : "Сохранить пару исходник + документация в эталон — не прерывает генерацию"}
                          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-all duration-150
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
                  <div className="px-5 py-4 max-h-[50vh] overflow-y-auto scrollbar-thin">
                    <NotionRenderer text={qaDoc} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Готовые кейсы появляются по мере генерации */}
          {cases.length > 0 && (
            <div className="mt-4 animate-fade-in">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                Готовые кейсы ({cases.length})
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                {cases.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-bg-card border border-border-main rounded-lg text-sm">
                    <CheckCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    <span className="truncate text-text-main">{c.name}</span>
                    <span className="ml-auto text-xs text-text-muted flex-shrink-0">{c.steps?.length ?? 0} шаг.</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── REVIEW ── */}
      {stage === "review" && (
        <div className="p-6 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
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
              {state !== "error" && cases.length > 0 && (
                <p className="text-sm text-text-muted mt-0.5">
                  Создано {cases.length} кейсов. Общее время прохождения: {sumEstimatedMinutes(cases)} мин
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
              {tm.active && tm.active.id === sessionId && (
                <button onClick={() => setStage("tm")}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-border-main rounded-lg text-xs text-text-muted hover:bg-bg-subtle hover:text-primary transition-all duration-150 whitespace-nowrap flex-shrink-0">
                  <ArrowLeft className="w-3 h-3" /> К этапам
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
                          } catch (e) {
                            setEtalonStatus(prev => ({ ...prev, [eid]: "error" }));
                            setEtalonErrorMsg(prev => ({ ...prev, [eid]: e instanceof Error ? e.message : String(e) }));
                            setTimeout(() => {
                              setEtalonStatus(prev => { const n = { ...prev }; delete n[eid]; return n; });
                              setEtalonErrorMsg(prev => { const n = { ...prev }; delete n[eid]; return n; });
                            }, 8000);
                          }
                        }}
                        title={st === "error" ? (etalonErrorMsg[eid] || "Ошибка") : undefined}
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
                  {tm.sessions.some(x => x.id === sessionId && x.status === "done") ? (<>
                    {/* Тестовая модель: XML уже собран из кейсов — скачать или сразу в Zephyr, без окна экспорта */}
                    <button disabled={!!tmXmlBusy} onClick={() => void downloadTm([sessionId!], { [sessionId!]: [...selectedCases].sort((a, b) => a - b) })}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-border-main rounded-lg text-xs text-text-main hover:bg-bg-subtle disabled:opacity-40 whitespace-nowrap flex-shrink-0">
                      {tmXmlBusy === "download" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Скачать XML ({selectedCases.size})
                    </button>
                    <button disabled={!!tmXmlBusy} onClick={() => void sendTm([sessionId!], { [sessionId!]: [...selectedCases].sort((a, b) => a - b) })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-dark disabled:opacity-40 shadow-sm whitespace-nowrap flex-shrink-0">
                      {tmXmlBusy === "zephyr" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} В Zephyr ({selectedCases.size})
                    </button>
                  </>) : (
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
                  )}
                </>
              )}
            </div>
          </div>

          {tmXmlErr && stage === "review" && <p className="mb-3 text-sm text-red-500">{tmXmlErr}</p>}
          <div>
            {events.length > 0 && (
              <div className="mb-4 max-w-2xl">
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
                    {qaDocTruncated && (
                      <div className="mx-4 mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          Документ обрезан лимитом модели — конец текста мог не поместиться.
                          Попробуйте сократить требование или сменить провайдера.
                        </span>
                      </div>
                    )}
                    <div className="flex justify-end items-center gap-2 px-4 pt-3">
                      {(() => {
                        const eid = sessionId ?? "current";
                        const st = reqDocStatus[eid];
                        if (st === "done") return (
                          <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-green-200 bg-green-50 rounded-lg text-green-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> В эталоне
                          </span>
                        );
                        return (
                          <button
                            disabled={st === "loading"}
                            onClick={() => handleSaveDocAsRequirement(eid, qaDoc, qaDocTruncated)}
                            title={st === "error" ? (reqDocErrorMsg[eid] || "Ошибка") : "Сохранить пару исходник + документация в эталон"}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-all duration-150
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
              <RefreshIcon busy={histLoading} className="w-3 h-3" />
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
                                {DEPTH_LABELS[entry.depth] ?? entry.depth}
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
                                <span className="flex-shrink-0 p-0.5 text-red-500" title={etalonErrorMsg[entry.id] || "Ошибка"}>
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
                <div className="flex items-start justify-between mb-4 gap-4">
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
                                } catch (e) {
                                  setEtalonStatus(prev => ({ ...prev, [eid]: "error" }));
                                  setEtalonErrorMsg(prev => ({ ...prev, [eid]: e instanceof Error ? e.message : String(e) }));
                                  setTimeout(() => {
                                    setEtalonStatus(prev => { const n = { ...prev }; delete n[eid]; return n; });
                                    setEtalonErrorMsg(prev => { const n = { ...prev }; delete n[eid]; return n; });
                                  }, 8000);
                                }
                              }}
                              title={st === "error" ? (etalonErrorMsg[eid] || "Ошибка") : undefined}
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

                <div>
                  {/* Meta badges */}
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    <span className="text-xs bg-[var(--color-active-bg)] text-primary border border-indigo-100 px-2 py-1 rounded-md font-medium">
                      {DEPTH_LABELS[histView.depth] ?? histView.depth}
                    </span>
                    <span className="text-xs bg-bg-subtle text-text-muted border border-border-main px-2 py-1 rounded-md">
                      {histView.platform}
                    </span>
                    <span className="text-xs text-text-muted">
                      {hvCases.length} кейсов{histView.elapsed > 0 ? ` · за ${histView.elapsed}с` : ""}
                      {hvCases.length > 0 ? ` · время прохождения: ${sumEstimatedMinutes(hvCases)} мин` : ""}
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
                          {histView.qa_doc_truncated && (
                            <div className="mx-4 mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span>
                                Документ обрезан лимитом модели — конец текста мог не поместиться.
                                Попробуйте сократить требование или сменить провайдера.
                              </span>
                            </div>
                          )}
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
              onExport={taskExportMode ? p => void exportTasks(p) : exportCases}
              result={taskExportMode ? null : exportResult}
              exporting={taskExportMode ? taskExporting : exporting}
              initialProject={taskExportMode ? doneJobs[0]?.project : undefined}
              taskFiles={taskExportMode ? taskFiles ?? [] : undefined}
              taskTotal={taskExportMode ? { tasks: doneJobs.length, cases: doneJobs.reduce((n, j) => n + (j.caseCount ?? 0), 0) } : undefined}
              onPreview={p => void openPreview(p)}
              previewBusy={previewBusy}
              error={taskExportErr}
              onBack={() => { setExportSource(null); setTaskExportMode(false); setStage(exportBackStage); }}
            />
          </div>
        </div>
      )}
    </>
  );
}
