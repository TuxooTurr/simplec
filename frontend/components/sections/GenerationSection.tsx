"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  Sparkles, ChevronDown, RotateCcw, Download, Clock,
  Paperclip, FileText, SlidersHorizontal, X, CheckCircle2, Plus, Trash2,
  StopCircle, History, ChevronLeft, BookmarkPlus, Loader2, XCircle, FlaskConical,
} from "lucide-react";
import StatusPanel from "@/components/StatusPanel";
import CaseCard from "@/components/CaseCard";
import ExportPanel from "@/components/ExportPanel";
import { useGeneration, type Case, type ExportResult } from "@/lib/useGeneration";
import { parseFile, addEtalon } from "@/lib/api";
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

interface HistEntry {
  id: string;
  timestamp: number;
  depth: string;
  feature: string;
  platform: string[];
  project: string;
  team: string;
  ke: string;
  elapsed: number;
  caseCount: number;
  cases: Case[];
  qaDoc: string;
  requirement?: string;
  exportResult?: ExportResult;
  loadedAsEtalon?: boolean;
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

function loadHistory(): HistEntry[] {
  try {
    const raw = localStorage.getItem("st_gen_history");
    return raw ? (JSON.parse(raw) as HistEntry[]) : [];
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

/* ── End history helpers ─────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none " +
  "focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2";

/* ═══════════════════════════════════════════════════════════════
   EDITABLE DROPDOWN — комбобокс с редактируемым списком (localStorage)
═══════════════════════════════════════════════════════════════ */

interface EditableDropdownProps {
  value: string;
  onChange: (v: string) => void;
  list: string[];
  onListChange: (list: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
}

function EditableDropdown({ value, onChange, list, onListChange, placeholder, invalid }: EditableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // Sync external value → input when closed
  useEffect(() => { if (!open) setInput(value); }, [value, open]);

  // Click outside → close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = list.filter(s => s.toLowerCase().includes(input.toLowerCase()));
  const canAdd = input.trim() && !list.includes(input.trim());

  const select = (item: string) => {
    onChange(item);
    setInput(item);
    setOpen(false);
  };

  const addToList = () => {
    const v = input.trim();
    if (!v || list.includes(v)) return;
    const next = [...list, v];
    onListChange(next);
    onChange(v);
    setOpen(false);
  };

  const removeFromList = (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onListChange(list.filter(s => s !== item));
    if (value === item) onChange("");
  };

  return (
    <div ref={ref} className="relative">
      <div className={`flex items-center gap-1 border rounded-lg px-3 py-2 transition-shadow duration-150
        ${invalid ? "border-red-300 focus-within:border-red-400 focus-within:ring-2 focus-within:ring-red-100"
                  : "border-border-main focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/40"}`}>
        <input
          className="flex-1 text-sm outline-none bg-transparent min-w-0"
          value={input}
          placeholder={placeholder}
          onChange={e => { setInput(e.target.value); onChange(e.target.value); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); canAdd ? addToList() : filtered[0] && select(filtered[0]); }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {input && (
          <button type="button" onClick={() => { onChange(""); setInput(""); setOpen(true); }}
            className="text-text-muted hover:text-text-main shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="button" onClick={() => setOpen(o => !o)}
          className="text-text-muted hover:text-text-main shrink-0">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-border-main rounded-lg shadow-lg overflow-hidden">
          {filtered.length > 0 && (
            <ul className="max-h-48 overflow-y-auto divide-y divide-border-main">
              {filtered.map(item => (
                <li key={item}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-bg-subtle cursor-pointer group"
                  onClick={() => select(item)}>
                  <span className="flex-1 text-sm text-text-main truncate">{item}</span>
                  <button type="button"
                    onClick={e => removeFromList(item, e)}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canAdd && (
            <button type="button" onClick={addToList}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-indigo-50 border-t border-border-main">
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Добавить «{input.trim()}»</span>
            </button>
          )}
          {filtered.length === 0 && !canAdd && (
            <p className="px-3 py-2 text-xs text-text-muted text-center">Список пуст — введите значение</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL — вынесен на уровень модуля (не внутри функции),
   чтобы React не создавал новый тип компонента на каждый рендер
   и не делал unmount/remount с потерей фокуса.
═══════════════════════════════════════════════════════════════ */
interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  platform: string[]; onPlatform: (v: string[]) => void;
  feature: string;  onFeature:  (v: string) => void;
  team: string;     onTeam:     (v: string) => void;    teamList: string[];    onTeamList:    (l: string[]) => void;
  project: string;  onProject:  (v: string) => void;   projectList: string[]; onProjectList: (l: string[]) => void;
  ke: string;       onKe:       (v: string) => void;   keList: string[];      onKeList:      (l: string[]) => void;
  critRegress: boolean; onCritRegress: (v: boolean) => void;
  settingsDone: boolean;
  filledCount: number;
  touched: boolean;
  onApply: () => void;
}

function SettingsModal({
  open, onClose,
  platform, onPlatform,
  feature, onFeature,
  team, onTeam, teamList, onTeamList,
  project, onProject, projectList, onProjectList,
  ke, onKe, keList, onKeList,
  critRegress, onCritRegress,
  settingsDone, filledCount, touched, onApply,
}: SettingsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl border border-border-main w-full max-w-sm p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-main flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            Настройки кейса
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Platform */}
          <div>
            <label className={LABEL_CLS}>Платформа <span className="text-red-400">*</span></label>
            <div className="grid grid-cols-2 gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPlatform(
                    platform.includes(p.id)
                      ? platform.filter((x) => x !== p.id).length > 0
                        ? platform.filter((x) => x !== p.id)
                        : platform // prevent deselecting last
                      : [...platform, p.id]
                  )}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-150 text-center
                    ${platform.includes(p.id)
                      ? "border-primary bg-indigo-50 text-primary"
                      : "border-border-main bg-white text-text-muted hover:border-primary/40 hover:text-text-main"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Feature */}
          <div>
            <label className={LABEL_CLS}>Фича <span className="text-red-400">*</span></label>
            <input
              value={feature}
              onChange={(e) => onFeature(e.target.value)}
              placeholder="Например: Оплата картой"
              className={`${INPUT_CLS} ${touched && !feature.trim() ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""}`}
            />
          </div>

          {/* Team */}
          <div>
            <label className={LABEL_CLS}>Команда <span className="text-red-400">*</span></label>
            <EditableDropdown
              value={team} onChange={onTeam}
              list={teamList} onListChange={onTeamList}
              placeholder="Например: Team Alpha"
              invalid={touched && !team.trim()}
            />
          </div>

          {/* Project */}
          <div>
            <label className={LABEL_CLS}>Проект <span className="text-red-400">*</span></label>
            <EditableDropdown
              value={project} onChange={onProject}
              list={projectList} onListChange={onProjectList}
              placeholder="Например: SBER911"
              invalid={touched && !project.trim()}
            />
          </div>

          {/* АС / КЭ */}
          <div>
            <label className={LABEL_CLS}>АС / КЭ <span className="text-red-400">*</span></label>
            <EditableDropdown
              value={ke} onChange={onKe}
              list={keList} onListChange={onKeList}
              placeholder="Например: ЛК Физ. лица"
              invalid={touched && !ke.trim()}
            />
          </div>

          {/* Критичный регресс */}
          <div>
            <label className={LABEL_CLS}>Критичный регресс</label>
            <label className="flex items-center gap-3 cursor-pointer group select-none">
              <button
                type="button"
                role="switch"
                aria-checked={critRegress}
                onClick={() => onCritRegress(!critRegress)}
                className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0
                  ${critRegress ? "bg-primary" : "bg-gray-200 group-hover:bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200
                    ${critRegress ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
              <span className="text-sm text-text-muted group-hover:text-text-main transition-colors leading-tight">
                LLM оценивает критичность для регресса
              </span>
            </label>
          </div>
        </div>

        {/* Apply */}
        <button
          onClick={onApply}
          className={`mt-6 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg
            text-sm font-semibold transition-all duration-150 active:scale-[0.98]
            ${settingsDone
              ? "bg-violet-600 hover:bg-violet-700 text-white shadow-sm"
              : "bg-gray-100 text-text-muted cursor-default"}`}
        >
          {settingsDone
            ? <><CheckCircle2 className="w-4 h-4" /> Применить</>
            : `Заполните все поля (${filledCount}/4)`}
        </button>
      </div>
    </div>
  );
}

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
  const [fileLoading, setFileLoading] = useState(false);
  const [fileName, setFileName]       = useState("");
  const reqFileRef = useRef<HTMLInputElement>(null);

  // Settings state (persists between generations)
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [platform, setPlatformState]        = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("st_platform") ?? '["Web"]'); } catch { return ["Web"]; }
  });
  const setPlatform = (p: string[]) => {
    setPlatformState(p);
    try { localStorage.setItem("st_platform", JSON.stringify(p)); } catch {}
  };
  const [feature, setFeature]               = useState("");
  const [team, setTeam]                     = useState("");
  const [project, setProject]               = useState("");
  const [ke, setKe]                         = useState("");
  const [critRegress, setCritRegress]       = useState(false);
  const [settingsTouched, setSettingsTouched] = useState(false);

  // Editable dropdown lists (localStorage-backed)
  const loadList = (key: string): string[] => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  };
  const [teamList,    setTeamListState]    = useState<string[]>(() => loadList("st_teams"));
  const [projectList, setProjectListState] = useState<string[]>(() => loadList("st_projects"));
  const [keList,      setKeListState]      = useState<string[]>(() => loadList("st_ke"));

  const setTeamList    = useCallback((l: string[]) => { setTeamListState(l);    localStorage.setItem("st_teams",    JSON.stringify(l)); }, []);
  const setProjectList = useCallback((l: string[]) => { setProjectListState(l); localStorage.setItem("st_projects", JSON.stringify(l)); }, []);
  const setKeList      = useCallback((l: string[]) => { setKeListState(l);      localStorage.setItem("st_ke",       JSON.stringify(l)); }, []);

  // Shake animation state for settings button
  const [settingsShake, setSettingsShake] = useState(false);

  // ── Generation history ─────────────────────────────────────────
  const [histEntries, setHistEntries] = useState<HistEntry[]>(() => loadHistory());
  const [histView, setHistView] = useState<HistEntry | null>(null);
  const [histFromStage, setHistFromStage] = useState<Stage>("input");
  const [exportSource, setExportSource] = useState<{ cases: Case[]; qaDoc: string } | null>(null);
  const [exportBackStage, setExportBackStage] = useState<Stage>("review");
  const genMetaRef = useRef({ feature: "", project: "", team: "", ke: "", depth: "smoke", platform: ["Web"] as string[], requirement: "" });
  const historySavedRef = useRef(false);
  const currentHistIdRef = useRef<string | null>(null);
  const exportingHistIdRef = useRef<string | null>(null);

  const saveHistEntry = useCallback((entry: HistEntry) => {
    setHistEntries(prev => {
      const next = [entry, ...prev].slice(0, 30);
      try { localStorage.setItem("st_gen_history", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const deleteHistEntry = useCallback((id: string) => {
    setHistEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      try { localStorage.setItem("st_gen_history", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistEntries([]);
    try { localStorage.removeItem("st_gen_history"); } catch {}
  }, []);

  const [etalonStatus, setEtalonStatus] = useState<Record<string, "loading" | "done" | "error">>({});

  const handleLoadAsEtalon = useCallback(async (entry: HistEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEtalonStatus(prev => ({ ...prev, [entry.id]: "loading" }));
    try {
      await addEtalon({
        req_text: stripMarkdown(entry.requirement ?? entry.qaDoc ?? ""),
        tc_text: casesToText(entry.cases),
        qa_doc: stripMarkdown(entry.qaDoc),
        platform: entry.platform.join(", "),
        feature: entry.feature,
      });
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "done" }));
      setHistEntries(prev => {
        const next = prev.map(e => e.id === entry.id ? { ...e, loadedAsEtalon: true } : e);
        try { localStorage.setItem("st_gen_history", JSON.stringify(next)); } catch {}
        return next;
      });
    } catch {
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "error" }));
      setTimeout(() => setEtalonStatus(prev => { const n = { ...prev }; delete n[entry.id]; return n; }), 2500);
    }
  }, []);
  // ── End history ────────────────────────────────────────────────

  const { state, events, progress, cases, qaDoc, start, exportCases, cancel, exportResult, exporting, reset } =
    useGeneration();

  // Сохраняем exportResult в запись истории, когда экспорт завершён
  useEffect(() => {
    if (!exportResult || !exportingHistIdRef.current) return;
    const hid = exportingHistIdRef.current;
    setHistEntries(prev => {
      const next = prev.map(e => e.id === hid ? { ...e, exportResult } : e);
      try { localStorage.setItem("st_gen_history", JSON.stringify(next)); } catch {}
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportResult]);

  // Restore stage immediately (before paint) when returning to this page
  useLayoutEffect(() => {
    if (state === "generating") {
      setStage("generating");
    } else if (state === "done" || state === "error") {
      const lastDone = events.find((e) => e.type === "layer_done" && e.layer === 2);
      setElapsedFinal(lastDone?.elapsed ?? 0);
      setStage("review");
    }
    // state === "idle" → keep "input"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount — ongoing transitions handled by useEffect below

  const settingsDone =
    feature.trim().length > 0 &&
    team.trim().length > 0 &&
    project.trim().length > 0 &&
    ke.trim().length > 0;

  const filledCount = [
    feature.trim().length > 0,
    team.trim().length > 0,
    project.trim().length > 0,
    ke.trim().length > 0,
  ].filter(Boolean).length;

  useEffect(() => {
    if (state === "generating") setStage("generating");
    if (state === "done") {
      const lastDone = events.find((e) => e.type === "layer_done" && e.layer === 2);
      const elapsed = lastDone?.elapsed ?? 0;
      setElapsedFinal(elapsed);
      setStage("review");
      // Save to history (once per generation)
      if (!historySavedRef.current && cases.length > 0) {
        historySavedRef.current = true;
        const meta = genMetaRef.current;
        const histId = Date.now().toString();
        currentHistIdRef.current = histId;
        saveHistEntry({
          id: histId,
          timestamp: Date.now(),
          depth: meta.depth,
          feature: meta.feature,
          platform: meta.platform,
          project: meta.project,
          team: meta.team,
          ke: meta.ke,
          elapsed,
          caseCount: cases.length,
          cases,
          qaDoc,
          requirement: meta.requirement,
        });
      }
    }
    if (state === "error") setStage("review");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, events]);

  const handleGenerate = () => {
    if (!settingsDone) {
      // Trigger shake on settings button, don't start generation
      setSettingsShake(true);
      return;
    }
    const text = requirement.trim();
    if (!text) return;
    genMetaRef.current = { feature, project, team, ke, depth, platform, requirement: text };
    historySavedRef.current = false;
    start({ requirement: text, feature, depth, provider, platform: platform.join(", ") });
  };


  const handleReset = () => {
    historySavedRef.current = false;
    reset();
    setStage("input");
    setRequirement("");
    setQaExpanded(false);
  };

  const currentDepth = DEPTHS.find((d) => d.id === depth);

  /* ─────────────── RENDER ─────────────── */
  return (
    <>
      {/* Modal рендерится на уровне компонента (вне stage-блоков) */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        platform={platform}   onPlatform={setPlatform}
        feature={feature}     onFeature={setFeature}
        team={team}           onTeam={setTeam}    teamList={teamList}       onTeamList={setTeamList}
        project={project}     onProject={setProject} projectList={projectList} onProjectList={setProjectList}
        ke={ke}               onKe={setKe}        keList={keList}           onKeList={setKeList}
        critRegress={critRegress} onCritRegress={setCritRegress}
        settingsDone={settingsDone}
        filledCount={filledCount}
        touched={settingsTouched}
        onApply={() => {
          setSettingsTouched(true);
          if (settingsDone) setSettingsOpen(false);
        }}
      />

      {/* ── INPUT ── */}
      {stage === "input" && (
        <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
          <div className="flex items-start justify-between mb-1 gap-4">
            <h1 className="text-xl font-bold text-text-main">Генерация тест-кейсов</h1>
            {histEntries.length > 0 && (
              <button
                onClick={() => { setHistFromStage("input"); setStage("history"); }}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors flex-shrink-0 mt-1"
              >
                <History className="w-3.5 h-3.5" />
                История ({histEntries.length})
              </button>
            )}
          </div>
          <p className="text-sm text-text-muted mb-4">
            Вставьте требование или загрузите файл — AI создаст тест-кейсы для Zephyr Scale.
          </p>

          {/* Depth + Settings button */}
          <div className="bg-white border border-border-main rounded-xl p-4 mb-3">
            <div className="flex items-start justify-between gap-4 mb-2">
              <label className={LABEL_CLS + " mb-0"}>Глубина</label>

              {/* Settings button — стиль как у «Генерировать» */}
              <button
                onClick={() => setSettingsOpen(true)}
                onAnimationEnd={() => setSettingsShake(false)}
                className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold
                  border transition-all duration-150 active:scale-[0.97] flex-shrink-0
                  bg-primary border-primary text-white hover:bg-primary-dark shadow-sm
                  ${settingsShake ? "animate-shake" : ""}`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Настройки кейса
                {settingsDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-white/90" />
                ) : (
                  <>
                    {/* Красная точка-индикатор */}
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white shadow-sm" />
                    <span className="ml-0.5 bg-white/20 rounded-full px-1.5 py-0 text-[10px] font-bold text-white">
                      {filledCount}/4
                    </span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {DEPTHS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDepth(d.id)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium border transition-all duration-150 text-center
                    ${depth === d.id
                      ? "border-primary bg-indigo-50 text-primary"
                      : "border-border-main bg-white text-text-muted hover:border-primary/40 hover:text-text-main"}`}
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
          <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
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
              accept=".pdf,.docx,.doc,.xlsx,.xls,.xml,.png,.jpg,.jpeg,.txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileLoading(true);
                setFileName(file.name);
                try {
                  const result = await parseFile(file);
                  setRequirement(result.text);
                } catch (err) {
                  alert("Ошибка: " + String(err));
                  setFileName("");
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
                {fileName && !fileLoading && (
                  <span className="flex items-center gap-1 text-xs text-text-muted bg-gray-50 border border-border-main rounded-lg px-2 py-1">
                    <FileText className="w-3 h-3 flex-shrink-0 text-indigo-400" />
                    {fileName}
                    <button
                      type="button"
                      onClick={() => { setFileName(""); setRequirement(""); }}
                      className="ml-0.5 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
              <span className="text-xs text-text-muted tabular-nums">
                {requirement.length.toLocaleString()} симв.
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            {!settingsDone ? (
              <p className="text-xs text-red-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                Заполните настройки кейса перед генерацией
              </p>
            ) : (
              <p className="text-xs text-text-muted flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                <span className="text-violet-700 font-medium">[{platform.join(", ")}]</span>
                &nbsp;{feature}&nbsp;·&nbsp;{project}&nbsp;·&nbsp;{team}
              </p>
            )}

            <button
              onClick={handleGenerate}
              disabled={!requirement.trim() && settingsDone}
              className={`flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
                hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md
                ${(!requirement.trim() || !settingsDone) ? "opacity-40" : ""}`}
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
            <div className="flex gap-2">
              {histEntries.length > 0 && (
                <button
                  onClick={() => { setHistFromStage("review"); setStage("history"); }}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                    text-text-muted hover:bg-gray-50 hover:text-primary transition-all duration-150"
                >
                  <History className="w-3.5 h-3.5" />
                  История
                </button>
              )}
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                  text-text-muted hover:bg-gray-50 hover:text-text-main transition-all duration-150 group"
              >
                <Plus className="w-3.5 h-3.5" />
                Новая генерация
              </button>
              {cases.length > 0 && (
                <>
                  <button
                    onClick={() => {
                      const entry = histEntries[0];
                      const text = entry?.exportResult?.xml ?? casesToText(cases);
                      sessionStorage.setItem("st_automodel_prefill",
                        JSON.stringify({ text, feature: entry?.feature ?? feature }));
                      window.location.href = "/auto-model";
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                      text-text-muted hover:bg-gray-50 hover:text-violet-600 transition-all duration-150"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    В автотесты
                  </button>
                  <button
                    onClick={() => { exportingHistIdRef.current = currentHistIdRef.current; setExportSource(null); setExportBackStage("review"); setStage("export"); }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                      hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Экспорт
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
              <div className="mb-4 bg-white border border-border-main rounded-xl overflow-hidden">
                <button
                  onClick={() => setQaExpanded((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium
                    text-text-main hover:bg-gray-50/70 transition-colors group"
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
                  <div className="px-4 pb-4 border-t border-border-main animate-fade-in">
                    <pre className="text-xs text-text-muted whitespace-pre-wrap mt-3 font-mono overflow-x-auto leading-relaxed">
                      {qaDoc}
                    </pre>
                  </div>
                )}
              </div>
            )}
            {cases.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Тест-кейсы</p>
                {cases.map((c, i) => (
                  <CaseCard
                    key={i}
                    index={i + 1}
                    case_={c}
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
            {histEntries.length > 0 && (
              <button
                onClick={() => { if (window.confirm("Удалить всю историю генераций?")) clearHistory(); }}
                className="text-xs text-text-muted hover:text-red-500 transition-colors"
              >
                Очистить всё
              </button>
            )}
          </div>

          {histEntries.length === 0 ? (
            <div className="max-w-2xl flex flex-col items-center justify-center py-16 text-text-muted">
              <History className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">История пуста — завершите генерацию, чтобы она появилась здесь</p>
            </div>
          ) : (
            <div className="max-w-2xl space-y-5">
              {HIST_GROUPS
                .map(g => [g, histEntries.filter(e => getDateGroup(e.timestamp) === g)] as [string, HistEntry[]])
                .filter(([, entries]) => entries.length > 0)
                .map(([group, entries]) => (
                  <div key={group}>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{group}</p>
                    <div className="bg-white border border-border-main rounded-xl overflow-hidden divide-y divide-border-main">
                      {entries.map(entry => (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 cursor-pointer group transition-colors"
                          onClick={() => { setHistView(entry); setStage("histitem"); }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-main truncate">{entry.feature || "Без названия"}</p>
                            <p className="text-xs text-text-muted mt-0.5">
                              {entry.caseCount} кейсов
                              {" · "}
                              {DEPTHS.find(d => d.id === entry.depth)?.label ?? entry.depth}
                              {" · "}
                              {entry.platform.join(", ")}
                              {entry.project ? ` · ${entry.project}` : ""}
                            </p>
                            {entry.exportResult && (
                              <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                                <button onClick={() => downloadBlob(entry.exportResult!.xml, `cases_${entry.id}.xml`, "application/xml")}
                                  className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors">
                                  <Download className="w-2.5 h-2.5" /> XML
                                </button>
                                <span className="text-text-muted/40">·</span>
                                <button onClick={() => downloadBlob(entry.exportResult!.csv, `cases_${entry.id}.csv`, "text/csv")}
                                  className="text-[11px] font-medium text-emerald-500 hover:text-emerald-700 flex items-center gap-0.5 transition-colors">
                                  <Download className="w-2.5 h-2.5" /> CSV
                                </button>
                                <span className="text-text-muted/40">·</span>
                                <button onClick={() => downloadBlob(entry.exportResult!.md, `cases_${entry.id}.md`, "text/markdown")}
                                  className="text-[11px] font-medium text-violet-500 hover:text-violet-700 flex items-center gap-0.5 transition-colors">
                                  <Download className="w-2.5 h-2.5" /> MD
                                </button>
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-text-muted flex-shrink-0">{formatHistTime(entry.timestamp)}</span>
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
                                title="Загрузить в эталон"
                                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-indigo-500 transition-opacity flex-shrink-0 p-0.5"
                              >
                                <BookmarkPlus className="w-3.5 h-3.5" />
                              </button>
                            );
                          })()}
                          <button
                            onClick={e => { e.stopPropagation(); if (window.confirm("Удалить эту запись из истории?")) deleteHistEntry(entry.id); }}
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
      )}

      {/* ── HISTORY ITEM ── */}
      {stage === "histitem" && histView && (
        <div className="p-6 animate-slide-up">
          <div className="flex items-start justify-between mb-4 max-w-3xl gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setStage("history")}
                className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group flex-shrink-0"
              >
                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                История
              </button>
              <span className="text-text-muted/40 flex-shrink-0">·</span>
              <h1 className="text-lg font-bold text-text-main truncate">{histView.feature || "Без названия"}</h1>
            </div>
            {histView.cases.length > 0 && (
              <>
                <button
                  onClick={() => {
                    const text = histView.exportResult?.xml ?? casesToText(histView.cases);
                    sessionStorage.setItem("st_automodel_prefill",
                      JSON.stringify({ text, feature: histView.feature }));
                    window.location.href = "/auto-model";
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                    text-text-muted hover:bg-gray-50 hover:text-violet-600 transition-all duration-150 flex-shrink-0"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  В автотесты
                </button>
                <button
                  onClick={() => {
                    exportingHistIdRef.current = histView.id;
                    setExportSource({ cases: histView.cases, qaDoc: histView.qaDoc });
                    setExportBackStage("histitem");
                    setStage("export");
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                    hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm flex-shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Экспорт
                </button>
              </>
            )}
          </div>

          <div className="max-w-3xl">
            {/* Meta badges */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className="text-xs bg-indigo-50 text-primary border border-indigo-100 px-2 py-1 rounded-md font-medium">
                {DEPTHS.find(d => d.id === histView.depth)?.label ?? histView.depth}
              </span>
              {histView.platform.map(p => (
                <span key={p} className="text-xs bg-gray-50 text-text-muted border border-border-main px-2 py-1 rounded-md">
                  {p}
                </span>
              ))}
              <span className="text-xs text-text-muted">
                {histView.caseCount} кейсов{histView.elapsed > 0 ? ` · за ${histView.elapsed}с` : ""}
              </span>
              {histView.project && <span className="text-xs text-text-muted">{histView.project}</span>}
              {histView.team && <span className="text-xs text-text-muted">{histView.team}</span>}
              <span className="text-xs text-text-muted ml-auto">{formatHistTime(histView.timestamp)}</span>
            </div>

            {/* QA Doc */}
            {histView.qaDoc && (
              <div className="mb-4 bg-white border border-border-main rounded-xl overflow-hidden">
                <button
                  onClick={() => setQaExpanded(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium
                    text-text-main hover:bg-gray-50/70 transition-colors group"
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
                  <div className="px-4 pb-4 border-t border-border-main animate-fade-in">
                    <pre className="text-xs text-text-muted whitespace-pre-wrap mt-3 font-mono overflow-x-auto leading-relaxed">
                      {histView.qaDoc}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Cases */}
            {histView.cases.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                  {histView.caseCount} тест-кейсов
                </p>
                {histView.cases.map((c, i) => (
                  <CaseCard
                    key={i}
                    index={i + 1}
                    case_={c}
                    className="animate-slide-up"
                    style={{ animationDelay: `${Math.min(i * 30, 300)}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            )}
          </div>
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
              initialProject={project}
              initialTeam={team}
              initialSystem={ke}
              initialCritRegress={critRegress}
            />
          </div>
        </div>
      )}
    </>
  );
}
