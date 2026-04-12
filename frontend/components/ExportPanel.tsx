"use client";

import { useState, useRef, useEffect } from "react";
import { FileCode2, Table2, FileText, Download, ChevronLeft, Loader2, CheckCircle2, Sparkles, Copy, CheckCheck, X, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { Case, ExportResult } from "@/lib/useGeneration";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface ExportPanelProps {
  cases: Case[];
  qaDoc: string;
  onExport: (params: ExportPanelParams) => void;
  result: ExportResult | null;
  exporting?: boolean;
  onBack: () => void;
}

export interface ExportPanelParams {
  cases: Case[];
  qa_doc: string;
  project: string;
  system: string;
  team: string;
  domain: string;
  folder: string;
  use_llm: boolean;
  provider: string;
  crit_regress: boolean;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DOWNLOAD_BUTTONS = [
  { key: "xml", label: "Zephyr XML",  mime: "application/xml", ext: "xml", Icon: FileCode2, color: "text-indigo-600 border-indigo-200 hover:bg-indigo-50" },
  { key: "csv", label: "CSV таблица", mime: "text/csv",         ext: "csv", Icon: Table2,    color: "text-emerald-600 border-emerald-200 hover:bg-emerald-50" },
  { key: "md",  label: "Markdown",    mime: "text/markdown",    ext: "md",  Icon: FileText,  color: "text-violet-600 border-violet-200 hover:bg-violet-50" },
] as const;

// ── EditableDropdown ────────────────────────────────────────────────────────
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

  useEffect(() => { if (!open) setInput(value); }, [value, open]);

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

  const select = (item: string) => { onChange(item); setInput(item); setOpen(false); };

  const addToList = () => {
    const v = input.trim();
    if (!v || list.includes(v)) return;
    onListChange([...list, v]);
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
        ${invalid
          ? "border-red-300 focus-within:ring-2 focus-within:ring-red-100 focus-within:border-red-400"
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

// ── ExportPanel ─────────────────────────────────────────────────────────────
const PLATFORMS = [
  { id: "Web",     label: "Web" },
  { id: "Desktop", label: "Desktop" },
  { id: "iOS",     label: "iOS" },
  { id: "Android", label: "Android" },
];

const loadList = (key: string): string[] => {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
};

export default function ExportPanel({ cases, qaDoc, onExport, result, exporting, onBack }: ExportPanelProps) {
  const { provider } = useWorkspace();
  const [feature, setFeature]       = useState("");
  const [platform, setPlatform]     = useState<string[]>(["Web"]);
  const [project, setProject]       = useState("");
  const [system, setSystem]         = useState("");
  const [team, setTeam]             = useState("");
  const [domain, setDomain]         = useState("");
  const [folder, setFolder]         = useState("Новая ТМ");
  const [useLlm, setUseLlm]         = useState(false);
  const [critRegress, setCritRegress] = useState(false);
  const [xmlCopied, setXmlCopied]   = useState(false);
  const [touched, setTouched]       = useState(false);

  // Lists from localStorage — shared with SettingsModal in GenerationSection
  const [projectList, setProjectListState] = useState<string[]>(() => loadList("st_projects"));
  const [teamList,    setTeamListState]    = useState<string[]>(() => loadList("st_teams"));
  const [keList,      setKeListState]      = useState<string[]>(() => loadList("st_ke"));

  const setProjectList = (l: string[]) => { setProjectListState(l); localStorage.setItem("st_projects", JSON.stringify(l)); };
  const setTeamList    = (l: string[]) => { setTeamListState(l);    localStorage.setItem("st_teams",    JSON.stringify(l)); };
  const setKeList      = (l: string[]) => { setKeListState(l);      localStorage.setItem("st_ke",       JSON.stringify(l)); };

  const requiredMissing = !feature.trim() || !project.trim() || !team.trim() || !system.trim();

  const handleExport = () => {
    if (requiredMissing) { setTouched(true); return; }
    onExport({ cases, qa_doc: qaDoc, project, system, team, domain, folder, use_llm: useLlm, provider, crit_regress: critRegress });
  };

  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          disabled={exporting}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Назад
        </button>
        <span className="text-text-muted/40">·</span>
        <h2 className="text-base font-semibold text-text-main">Экспорт {cases.length} кейсов</h2>
      </div>

      {/* Settings */}
      <div className="bg-white border border-border-main rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-main mb-4 flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-text-muted" />
          Настройки Zephyr XML
        </h3>
        {/* Feature + Platform */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Фича <span className="text-red-400">*</span>
            </label>
            <input
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              placeholder="Например: Оплата картой"
              className={`w-full border rounded-lg px-3 py-2 text-sm transition-shadow duration-150
                focus:outline-none focus:ring-2
                ${touched && !feature.trim()
                  ? "border-red-300 focus:ring-red-100 focus:border-red-400"
                  : "border-border-main focus:ring-primary/30 focus:border-primary/40"}`}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Платформа</label>
            <div className="grid grid-cols-2 gap-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(
                    platform.includes(p.id)
                      ? platform.filter(x => x !== p.id).length > 0
                        ? platform.filter(x => x !== p.id)
                        : platform
                      : [...platform, p.id]
                  )}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 text-center
                    ${platform.includes(p.id)
                      ? "border-primary bg-indigo-50 text-primary"
                      : "border-border-main bg-white text-text-muted hover:border-primary/40 hover:text-text-main"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Проект <span className="text-red-400">*</span>
            </label>
            <EditableDropdown
              value={project}
              onChange={setProject}
              list={projectList}
              onListChange={setProjectList}
              placeholder="SBER911"
              invalid={touched && !project.trim()}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">
              АС / КЭ <span className="text-red-400">*</span>
            </label>
            <EditableDropdown
              value={system}
              onChange={setSystem}
              list={keList}
              onListChange={setKeList}
              placeholder="Например: ЛК Физ. лица"
              invalid={touched && !system.trim()}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Команда <span className="text-red-400">*</span>
            </label>
            <EditableDropdown
              value={team}
              onChange={setTeam}
              list={teamList}
              onListChange={setTeamList}
              placeholder="Например: Team Alpha"
              invalid={touched && !team.trim()}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Домен</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Например: Платежи"
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                transition-shadow duration-150"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-text-muted mb-1">Папка в Zephyr</label>
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                transition-shadow duration-150"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          <label className="flex items-center gap-2.5 text-sm cursor-pointer group select-none">
            <input
              type="checkbox"
              checked={useLlm}
              onChange={(e) => setUseLlm(e.target.checked)}
              className="rounded border-border-main text-primary focus:ring-primary/30 w-4 h-4"
            />
            <span className="text-text-muted group-hover:text-text-main transition-colors flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              LLM XML-форматирование
              <span className="text-xs text-text-muted/70">(медленнее, HTML-разметка)</span>
            </span>
          </label>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer group select-none">
            <input
              type="checkbox"
              checked={critRegress}
              onChange={(e) => setCritRegress(e.target.checked)}
              className="rounded border-border-main text-primary focus:ring-primary/30 w-4 h-4"
            />
            <span className="text-text-muted group-hover:text-text-main transition-colors">
              Критичный регресс (LLM оценивает критичность)
            </span>
          </label>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-white
            rounded-lg py-2.5 text-sm font-medium hover:bg-primary-dark transition-all duration-150
            disabled:opacity-50 active:scale-[0.99]"
        >
          {exporting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Генерирую XML...</>
          ) : (
            <><Download className="w-4 h-4" /> Сгенерировать XML</>
          )}
        </button>
      </div>

      {/* Download buttons */}
      {result && (
        <div className="bg-white border border-border-main rounded-xl p-5 animate-slide-up">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-green-500 animate-success flex-shrink-0" />
            <p className="text-sm font-semibold text-text-main">Файлы готовы к скачиванию</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {DOWNLOAD_BUTTONS.map(({ key, label, mime, ext, Icon, color }) => (
              <button
                key={key}
                onClick={() => downloadBlob(result[key as keyof ExportResult], `test_cases_${ts}.${ext}`, mime)}
                className={`flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm font-medium
                  transition-all duration-150 active:scale-[0.97] hover:shadow-sm ${color}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* XML preview */}
      {result?.xml && (
        <div className="bg-white border border-border-main rounded-xl p-5 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">XML для Zephyr</p>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(result.xml);
                setXmlCopied(true);
                setTimeout(() => setXmlCopied(false), 2000);
              }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-all duration-150 active:scale-[0.97]
                ${xmlCopied
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "border-border-main text-text-muted hover:bg-gray-50 hover:text-text-main"}`}
            >
              {xmlCopied
                ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано!</>
                : <><Copy className="w-3.5 h-3.5" /> Копировать XML</>}
            </button>
          </div>
          <pre className="text-xs font-mono text-text-main bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-72 overflow-y-auto leading-relaxed whitespace-pre-wrap">
            {result.xml}
          </pre>
        </div>
      )}
    </div>
  );
}
