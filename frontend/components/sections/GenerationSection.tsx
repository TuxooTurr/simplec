"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles, ChevronDown, RotateCcw, Download, Clock,
  AlignLeft, Paperclip, FileText, SlidersHorizontal, X, CheckCircle2, Plus, Trash2,
} from "lucide-react";
import StatusPanel from "@/components/StatusPanel";
import CaseCard from "@/components/CaseCard";
import ExportPanel from "@/components/ExportPanel";
import FileDropZone from "@/components/FileDropZone";
import { useGeneration } from "@/lib/useGeneration";
import { parseFile } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type Stage = "input" | "generating" | "review" | "export";

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
  const [depth, setDepth]             = useState("smoke");
  const [stage, setStage]             = useState<Stage>("input");
  const [elapsedFinal, setElapsedFinal] = useState(0);
  const [qaExpanded, setQaExpanded]   = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [inputMode, setInputMode]     = useState<"text" | "file">("text");

  // Settings state (persists between generations)
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [platform, setPlatform]             = useState<string[]>(["Web"]);
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

  const { state, events, progress, cases, qaDoc, start, exportCases, exportResult, reset } =
    useGeneration();

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
      setElapsedFinal(lastDone?.elapsed ?? 0);
      setStage("review");
    }
    if (state === "error") setStage("review");
  }, [state, events]);

  const handleGenerate = () => {
    if (!settingsDone) {
      // Trigger shake on settings button, don't start generation
      setSettingsShake(true);
      return;
    }
    const text = requirement.trim();
    if (!text) return;
    start({ requirement: text, feature, depth, provider, platform: platform.join(", ") });
  };

  const handleFileUpload = async (file: File) => {
    setFileLoading(true);
    try {
      const result = await parseFile(file);
      setRequirement(result.text);
    } catch (err) {
      alert("Ошибка при парсинге файла: " + String(err));
    } finally {
      setFileLoading(false);
    }
  };

  const handleReset = () => {
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
          <h1 className="text-xl font-bold text-text-main mb-1">Генерация тест-кейсов</h1>
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
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Требование</label>
              <div className="flex rounded-lg border border-border-main overflow-hidden text-xs">
                <button
                  onClick={() => setInputMode("text")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors duration-150
                    ${inputMode === "text" ? "bg-indigo-50 text-primary font-semibold" : "text-text-muted hover:bg-gray-50"}`}
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                  Текст
                </button>
                <button
                  onClick={() => setInputMode("file")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-border-main transition-colors duration-150
                    ${inputMode === "file" ? "bg-indigo-50 text-primary font-semibold" : "text-text-muted hover:bg-gray-50"}`}
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Файл
                </button>
              </div>
            </div>
            {inputMode === "text" ? (
              <>
                <textarea
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  placeholder="Вставьте текст требования, user story или описание функционала..."
                  rows={10}
                  className={`${INPUT_CLS} resize-none font-mono`}
                />
                <div className="flex justify-end mt-2">
                  <span className="text-xs text-text-muted tabular-nums">
                    {requirement.length.toLocaleString()} симв.
                  </span>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <FileDropZone onFile={handleFileUpload} loading={fileLoading} className="h-48" />
                {requirement && !fileLoading && (
                  <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                    Текст извлечён: {requirement.length.toLocaleString()} симв. — готов к генерации
                  </p>
                )}
              </div>
            )}
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
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-xl font-bold text-text-main">Генерация...</h1>
            {currentDepth && (
              <span className="text-sm text-text-muted flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {currentDepth.hint}
              </span>
            )}
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
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                  text-text-muted hover:bg-gray-50 hover:text-text-main transition-all duration-150 group"
              >
                <RotateCcw className="w-3.5 h-3.5 transition-transform group-hover:-rotate-90 duration-300" />
                Сбросить
              </button>
              {cases.length > 0 && (
                <button
                  onClick={() => setStage("export")}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                    hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Экспорт
                </button>
              )}
            </div>
          </div>

          <div className="max-w-3xl">
            {events.length > 0 && (
              <div className="mb-4">
                <StatusPanel events={events} progress={null} done={state === "done"} elapsed={elapsedFinal} />
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

      {/* ── EXPORT ── */}
      {stage === "export" && (
        <div className="p-6">
          <div className="max-w-2xl">
            <ExportPanel
              cases={cases}
              qaDoc={qaDoc}
              onExport={exportCases}
              result={exportResult}
              onBack={() => setStage("review")}
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
