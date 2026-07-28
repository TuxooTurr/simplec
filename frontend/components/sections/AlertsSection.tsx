"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Bell, Plus, Trash2, Pencil, Loader2, X,
  Upload, Code, AlignLeft, ChevronDown, ChevronUp, GripVertical,
  BookOpen, Settings2, Play, Square, Timer,
  CircleCheck, CircleX, Wifi, WifiOff, RefreshCw, Eraser,
  RotateCcw, Eye, EyeOff, Clock, User, List,
  FolderOpen, FolderClosed, FolderPlus, ChevronRight,
  Maximize2, Minimize2,
} from "lucide-react";
import { Select } from "@/components/ui";
import {
  saveAlertScript, deleteAlertScript, parseNotebook,
  saveAlertFolder, deleteAlertFolder,
  kernelAllStatus, kernelAudit,
  type AlertScript, type AlertFolder, type DynamicParam, type NotebookCell,
  type ParamFieldType, type KernelInfo, type KernelAuditEntry,
} from "@/lib/api";
import { useAlertsScheduler, missingParams, type OutputLine } from "@/contexts/AlertsSchedulerContext";
import { useAuth } from "@/contexts/AuthContext";

// ── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

const FREQS = [
  { label: "10с",   secs: 10  },
  { label: "30с",   secs: 30  },
  { label: "1 мин", secs: 60  },
  { label: "5 мин", secs: 300 },
  { label: "10 мин",secs: 600 },
  { label: "30 мин",secs: 1800},
  { label: "1 ч",   secs: 3600},
];

const CELL_TYPES = {
  markdown: { label: "Markdown", color: "bg-blue-100 text-blue-700 hover:bg-blue-200",   border: "border-blue-200" },
  init:     { label: "Init",     color: "bg-green-100 text-green-700 hover:bg-green-200", border: "border-green-200" },
  loop:     { label: "Loop",     color: "bg-amber-100 text-amber-700 hover:bg-amber-200", border: "border-amber-200" },
} as const;

type EditableCellType = "markdown" | "init" | "loop";

const FIELD_TYPE_LABELS: Record<ParamFieldType, string> = {
  text:           "Свободный ввод",
  select:         "Выпадающий список",
  multiselect:    "Множественный выбор",
  dropdown:       "Список (один)",
  dropdown_multi: "Список (несколько)",
  datetime:       "Дата и время",
  json:           "JSON-тело",
};

/** JSON-параметры редактируются и показываются отдельно от обычных полей. */
const isJsonParam = (p: DynamicParam) => p.field_type === "json";

// ── Helpers ───────────────────────────────────────────────────────────────────

function normType(t: string): EditableCellType {
  if (t === "loop") return "loop";
  if (t === "markdown") return "markdown";
  return "init";
}

function newCell(type: EditableCellType): NotebookCell {
  return { id: `cell-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, source: "" };
}

function newParam(): DynamicParam {
  return {
    id: `param-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    label: "", code_key: "", placeholder: "",
    field_type: "text", options: [],
  };
}

function formatDatetime(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.000`;
}

function datetimeToInputValue(val: string): string {
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}ч ${String(m).padStart(2, "0")}м`;
  if (m > 0) return `${m}м ${String(s).padStart(2, "0")}с`;
  return `${s}с`;
}

function inputValueToDatetime(val: string): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return formatDatetime(d);
}

// ── NotebookEditor ────────────────────────────────────────────────────────────

function NotebookEditor({ cells, onChange }: { cells: NotebookCell[]; onChange: (c: NotebookCell[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab,       setTab]       = useState<"editor" | "upload">("editor");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  // Код ячейки в поле на 5 строк читать невозможно — любую ячейку можно
  // развернуть на весь экран, оставаясь в той же форме.
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [cellRows, setCellRows] = useState(8);

  const fullscreenCell = fullscreenId ? cells.find(c => c.id === fullscreenId) ?? null : null;

  const addCell    = (type: EditableCellType) => onChange([...cells, newCell(type)]);
  const removeCell = (id: string) => onChange(cells.filter(c => c.id !== id));
  const updateSrc  = (id: string, source: string) => onChange(cells.map(c => c.id === id ? { ...c, source } : c));
  const moveCell   = (id: string, dir: -1 | 1) => {
    const idx = cells.findIndex(c => c.id === id);
    const nxt = idx + dir;
    if (idx < 0 || nxt < 0 || nxt >= cells.length) return;
    const arr = [...cells]; [arr[idx], arr[nxt]] = [arr[nxt], arr[idx]]; onChange(arr);
  };
  const cycleType = (id: string) => {
    const order: EditableCellType[] = ["markdown", "init", "loop"];
    onChange(cells.map(c => {
      if (c.id !== id) return c;
      const cur = normType(c.type);
      return { ...c, type: order[(order.indexOf(cur) + 1) % order.length] };
    }));
  };

  const handleUpload = async (file: File) => {
    setUploading(true); setUploadErr("");
    try {
      const res = await parseNotebook(file);
      onChange(res.cells.map(c => ({ ...c, type: normType(c.type) })));
      setTab("editor");
    } catch (e) { setUploadErr(String(e)); }
    finally { setUploading(false); }
  };

  return (
    <div className="border border-border-main rounded-xl overflow-hidden">
      <div className="flex items-center border-b border-border-main bg-bg-subtle">
        {(["editor", "upload"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
              tab === t ? "text-primary border-b-2 border-primary bg-bg-card" : "text-text-muted hover:text-text-main"}`}>
            {t === "editor" ? <><AlignLeft className="w-3.5 h-3.5" /> Редактор ячеек</> : <><Upload className="w-3.5 h-3.5" /> Загрузить .ipynb</>}
          </button>
        ))}
        {cells.length > 0 && (
          <div className="ml-auto mr-3 flex items-center gap-2">
            {/* Высота всех полей кода разом — быстрее, чем тянуть каждое за угол */}
            <span className="text-[10px] text-text-muted/70 hidden sm:inline">Высота полей</span>
            <input
              type="range" min={5} max={30} step={1}
              value={cellRows}
              onChange={e => setCellRows(Number(e.target.value))}
              title={`${cellRows} строк`}
              className="w-20 accent-[var(--color-primary)] cursor-pointer"
            />
            <span className="text-xs text-text-muted">{cells.length} яч.</span>
          </div>
        )}
      </div>

      {tab === "editor" && (
        <div className="p-3 space-y-2">
          {cells.length === 0 && (
            <p className="text-xs text-text-muted text-center py-4">Добавьте ячейки или загрузите .ipynb файл</p>
          )}
          {cells.map((cell, idx) => {
            const t = normType(cell.type);
            const cfg = CELL_TYPES[t];
            return (
              <div key={cell.id} className={`border rounded-lg overflow-hidden ${cfg.border}`}>
                <div className={`flex items-center gap-1.5 px-2 py-1 border-b ${cfg.border} bg-bg-card/60`}>
                  <GripVertical className="w-3 h-3 text-text-muted/40 flex-shrink-0" />
                  <button onClick={() => cycleType(cell.id)} title="Сменить тип (Markdown → Init → Loop)"
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${cfg.color}`}>
                    {t === "markdown" ? <AlignLeft className="w-2.5 h-2.5" /> : <Code className="w-2.5 h-2.5" />}
                    {cfg.label}
                  </button>
                  {t === "init" && <span className="text-[9px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">однократно</span>}
                  {t === "loop" && <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">циклично</span>}
                  <span className="text-[10px] text-text-muted/50 ml-auto">#{idx + 1}</span>
                  <button onClick={() => setFullscreenId(cell.id)} title="Развернуть на весь экран"
                    className="p-0.5 text-text-muted hover:text-primary transition-colors"><Maximize2 className="w-3 h-3" /></button>
                  <button onClick={() => moveCell(cell.id, -1)} disabled={idx === 0}
                    className="p-0.5 text-text-muted hover:text-text-main disabled:opacity-20"><ChevronUp className="w-3 h-3" /></button>
                  <button onClick={() => moveCell(cell.id, 1)} disabled={idx === cells.length - 1}
                    className="p-0.5 text-text-muted hover:text-text-main disabled:opacity-20"><ChevronDown className="w-3 h-3" /></button>
                  <button onClick={() => removeCell(cell.id)} className="p-0.5 text-text-muted hover:text-red-500 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <textarea value={cell.source} onChange={e => updateSrc(cell.id, e.target.value)}
                  rows={t === "markdown" ? Math.max(3, Math.round(cellRows / 2)) : cellRows}
                  placeholder={
                    t === "markdown" ? "# Заголовок\n\nТекст описания..." :
                    t === "init"     ? "# Инициализация (один раз)\nfrom kafka import KafkaProducer\nproducer = KafkaProducer(...)" :
                                       "# Отправка в Kafka (каждый тик)\nproducer.send('topic', value=b'...')"
                  }
                  className="w-full px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:bg-bg-card/80 transition-colors" />
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <button onClick={() => addCell("markdown")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
              <Plus className="w-3 h-3" /> Markdown
            </button>
            <button onClick={() => addCell("init")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition-colors">
              <Plus className="w-3 h-3" /> Init
            </button>
            <button onClick={() => addCell("loop")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-amber-300 text-amber-600 rounded-lg hover:bg-amber-50 transition-colors">
              <Plus className="w-3 h-3" /> Loop
            </button>
          </div>
        </div>
      )}

      {tab === "upload" && (
        <div className="p-4">
          <input ref={fileRef} type="file" accept=".ipynb" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); if (fileRef.current) fileRef.current.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full flex flex-col items-center gap-2 py-8 border-2 border-dashed border-border-main rounded-xl
              text-text-muted hover:border-primary/50 hover:text-primary hover:bg-[var(--color-active-bg)]/30 disabled:opacity-50 transition-all">
            {uploading
              ? <><Loader2 className="w-6 h-6 animate-spin" /><span className="text-sm">Парсим ноутбук...</span></>
              : <><Upload className="w-6 h-6" /><span className="text-sm font-medium">Нажмите чтобы выбрать .ipynb файл</span><span className="text-xs">Ячейки code → Init</span></>}
          </button>
          {uploadErr && <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{uploadErr}</p>}
          {cells.length > 0 && (
            <p className="mt-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
              Загружено {cells.length} ячеек
            </p>
          )}
        </div>
      )}

      {fullscreenCell && (
        <CellFullscreen
          cell={fullscreenCell}
          index={cells.findIndex(c => c.id === fullscreenCell.id) + 1}
          onChange={src => updateSrc(fullscreenCell.id, src)}
          onClose={() => setFullscreenId(null)}
        />
      )}
    </div>
  );
}

/** Одна ячейка на весь экран — поверх модалки редактора (z выше, чем у неё). */
function CellFullscreen({ cell, index, onChange, onClose }: {
  cell:     NotebookCell;
  index:    number;
  onChange: (source: string) => void;
  onClose:  () => void;
}) {
  const t = normType(cell.type);
  const cfg = CELL_TYPES[t];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 p-4 sm:p-8 animate-fade-in flex">
      <div className="bg-bg-card rounded-2xl shadow-2xl flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${cfg.border} bg-bg-subtle flex-shrink-0`}>
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${cfg.color}`}>
            {t === "markdown" ? <AlignLeft className="w-2.5 h-2.5" /> : <Code className="w-2.5 h-2.5" />}
            {cfg.label}
          </span>
          <span className="text-xs text-text-muted">Ячейка #{index}</span>
          {t === "init" && <span className="text-[9px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">однократно</span>}
          {t === "loop" && <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">циклично</span>}
          <span className="ml-auto text-[10px] text-text-muted/60 hidden sm:inline">Esc — свернуть</span>
          <button onClick={onClose} title="Свернуть"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-muted transition-colors">
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
        <textarea
          value={cell.source}
          onChange={e => onChange(e.target.value)}
          autoFocus
          spellCheck={false}
          className="flex-1 min-h-0 w-full px-4 py-3 text-sm font-mono leading-relaxed resize-none
            bg-bg-card text-text-main focus:outline-none scrollbar-thin"
        />
      </div>
    </div>
  );
}

/** Вертикальный разделитель колонок — тонкая полоса, подсвечивается при наведении. */
function ColumnResizer({ onDrag, title }: { onDrag: (e: React.MouseEvent) => void; title: string }) {
  return (
    <div
      onMouseDown={onDrag}
      title={title}
      role="separator"
      aria-orientation="vertical"
      className="group relative w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
    >
      <div className="h-10 w-1 rounded-full bg-border-main transition-colors group-hover:bg-primary/60" />
    </div>
  );
}

/** Поле для JSON-тела: многострочный ввод с проверкой синтаксиса и форматированием.
 *
 * Значение подставляется в код как обычный параметр (текстовой заменой образца),
 * поэтому в скрипте плейсхолдер должен стоять внутри кавычек — тогда сюда можно
 * вставить любое тело, а скрипт разберёт его через json.loads. */
function JsonParamInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [rows, setRows] = useState(10);
  const [full, setFull] = useState(false);

  const trimmed = value.trim();
  let error = "";
  if (trimmed) {
    try { JSON.parse(trimmed); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  const valid = !!trimmed && !error;

  const format = () => {
    try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch { /* невалидный — не трогаем */ }
  };

  const field = (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      spellCheck={false}
      placeholder={placeholder || '{\n  "table_name": "…",\n  "data": [ … ]\n}'}
      rows={full ? undefined : rows}
      className={`w-full px-3 py-2 text-xs font-mono leading-relaxed rounded-lg border bg-[var(--color-input-bg)]
        text-text-main placeholder:text-text-muted/50 focus:outline-none focus:ring-2 transition
        ${full ? "flex-1 min-h-0 resize-none" : "resize-y"}
        ${error ? "border-red-300 focus:ring-red-300/40 dark:border-red-800"
                : "border-border-main focus:ring-primary/30 focus:border-primary/40"}`}
    />
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {valid && (
          <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
            <CircleCheck className="w-3 h-3" /> Валидный JSON
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 truncate" title={error}>
            <CircleX className="w-3 h-3 flex-shrink-0" /> {error}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={format} disabled={!valid} title="Форматировать"
            className="px-2 py-0.5 rounded text-[11px] text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-40 transition-colors">
            Форматировать
          </button>
          <button type="button" onClick={() => setFull(true)} title="Развернуть на весь экран"
            className="p-1 rounded text-text-muted hover:text-primary hover:bg-bg-subtle transition-colors">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!full && field}
      {!full && (
        <input type="range" min={5} max={40} value={rows}
          onChange={e => setRows(Number(e.target.value))}
          title={`${rows} строк`}
          className="w-full h-1 accent-[var(--color-primary)] cursor-pointer" />
      )}

      {full && (
        <div className="fixed inset-0 z-[60] bg-black/60 p-4 sm:p-8 animate-fade-in flex">
          <div className="bg-bg-card rounded-2xl shadow-2xl flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-main bg-bg-subtle flex-shrink-0">
              <Code className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-text-main">JSON-тело</span>
              {valid && <span className="text-[11px] text-green-600 dark:text-green-400">валидный</span>}
              {error && <span className="text-[11px] text-red-600 dark:text-red-400 truncate">{error}</span>}
              <button type="button" onClick={format} disabled={!valid}
                className="ml-auto px-2 py-1 rounded text-xs text-text-muted hover:text-text-main hover:bg-bg-muted disabled:opacity-40 transition-colors">
                Форматировать
              </button>
              <button type="button" onClick={() => setFull(false)} title="Свернуть"
                className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-muted transition-colors">
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex p-3">{field}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ParamInput — renders the proper input based on field_type ──────────────────

function ParamInput({ param, value, onChange }: {
  param: DynamicParam;
  value: string;
  onChange: (v: string) => void;
}) {
  const ft = param.field_type || "text";
  const options = param.options ?? [];

  if (ft === "json") {
    return <JsonParamInput value={value} onChange={onChange} placeholder={param.placeholder} />;
  }

  if (ft === "datetime") {
    return (
      <input
        type="datetime-local"
        step="1"
        value={datetimeToInputValue(value)}
        onChange={e => onChange(inputValueToDatetime(e.target.value))}
        className={`${INPUT_CLS} text-xs`}
      />
    );
  }

  if (ft === "select" || ft === "dropdown") {
    return (
      <Select
        value={value}
        onChange={(value) => onChange(value)}
        
      >
        <option value="">— выберите —</option>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </Select>
    );
  }

  if (ft === "multiselect" || ft === "dropdown_multi") {
    const selected = value ? value.split(",").map(s => s.trim()).filter(Boolean) : [];
    const toggle = (opt: string) => {
      const next = selected.includes(opt)
        ? selected.filter(s => s !== opt)
        : [...selected, opt];
      onChange(next.join(", "));
    };

    if (ft === "dropdown_multi") {
      return (
        <div>
          <Select
            value=""
            onChange={(value) => {
              if (value && !selected.includes(value)) {
                onChange([...selected, value].join(", "));
              }
            }}
            className="mb-1.5"
          >
            <option value="">— добавить —</option>
            {options.filter(o => !selected.includes(o)).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map(s => (
                <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--color-active-bg)] border border-indigo-200 text-xs text-indigo-700">
                  {s}
                  <button type="button" onClick={() => toggle(s)} className="hover:text-red-500">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              selected.includes(opt)
                ? "border-indigo-200 bg-[var(--color-active-bg)] text-indigo-700"
                : "border-border-main bg-bg-card text-text-muted hover:border-indigo-200"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className={INPUT_CLS}
      placeholder={param.placeholder}
    />
  );
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function ScriptModal({ initial, folders, onSave, onClose }: {
  initial?: AlertScript | null;
  folders:  AlertFolder[];
  onSave:   (s: AlertScript) => void;
  onClose:  () => void;
}) {
  const { isSuperuser } = useAuth();
  const editing = !!initial?.id;
  const [name,     setName]     = useState(initial?.name  ?? "");
  const [folderId, setFolderId] = useState<string>(initial?.folder_id ?? "");
  const [cells,    setCells]    = useState<NotebookCell[]>(
    (initial?.notebook ?? []).map(c => ({ ...c, type: normType(c.type) }))
  );
  const [params, setParams] = useState<DynamicParam[]>(
    (initial?.dynamic_params ?? []).map(p => ({
      ...p,
      field_type: p.field_type || "text",
      options: p.options ?? [],
    }))
  );
  const [visibleToMon, setVisibleToMon] = useState(initial?.visible_to_monitoring ?? false);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");
  const [wide,   setWide]   = useState(false);

  const [editTab, setEditTab] = useState<"fields" | "json">("fields");
  const jsonParams  = params.filter(isJsonParam);
  const fieldParams = params.filter(p => !isJsonParam(p));
  const visibleParams = editTab === "json" ? jsonParams : fieldParams;

  const addParam = (type: ParamFieldType = "text") =>
    setParams(ps => [...ps, { ...newParam(), field_type: type }]);
  const removeParam = (id: string) => setParams(ps => ps.filter(p => p.id !== id));
  const updateParam = (id: string, field: string, val: unknown) =>
    setParams(ps => ps.map(p => p.id === id ? { ...p, [field]: val } : p));

  // ── Проверка образцов подстановки ────────────────────────────────────────
  // Подстановка ищет «Значение в коде» как обычную строку. Отсюда три способа
  // молча сломать скрипт: образца нет в коде (параметр-пустышка), он встречается
  // несколько раз (заменятся все), или два параметра делят один образец
  // (сработает только первый). Раньше ничего из этого не проверялось.
  const paramIssues = useMemo(() => {
    const code = cells.map(c => c.source ?? "").join("\n");
    const issues: { id: string; text: string; hard: boolean }[] = [];
    const seen = new Map<string, string>();

    for (const p of params) {
      const ph = p.placeholder;
      const who = p.label || p.code_key || "без названия";
      if (!ph) continue;

      const dup = seen.get(ph);
      if (dup) {
        issues.push({ id: p.id, hard: true,
          text: `«${who}»: образец ${JSON.stringify(ph)} уже занят параметром «${dup}» — сработает только первый` });
      } else {
        seen.set(ph, who);
      }

      const cnt = code.split(ph).length - 1;
      if (cnt === 0) {
        issues.push({ id: p.id, hard: true,
          text: `«${who}»: образец ${JSON.stringify(ph)} не найден в коде — значение никуда не подставится` });
      } else if (cnt > 1) {
        issues.push({ id: p.id, hard: false,
          text: `«${who}»: образец ${JSON.stringify(ph)} встречается ${cnt} раз — заменятся все вхождения` });
      }
      if (ph.length < 8) {
        issues.push({ id: p.id, hard: false,
          text: `«${who}»: образец ${JSON.stringify(ph)} короткий (${ph.length} симв.) — может случайно совпасть внутри другого слова` });
      }
    }
    return issues;
  }, [cells, params]);

  const hardIssues = paramIssues.filter(i => i.hard);

  const handleSave = async () => {
    if (!name.trim()) { setErr("Название обязательно"); return; }
    setSaving(true); setErr("");
    try {
      const saved = await saveAlertScript({
        id: initial?.id,
        name: name.trim(),
        topic: "",
        notebook: cells,
        dynamic_params: params,
        visible_to_monitoring: visibleToMon,
        folder_id: folderId || null,
      });
      onSave(saved as AlertScript);
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      {/* Ширина переключается: обычная для правки названия/папки, широкая — когда
          пишешь код. Базовая max-w-4xl вместо прежней 2xl: в 672px редактор ячеек
          не помещался.
          В развёрнутом режиме max-w-none, а не vw-значение: этот fixed-контейнер
          позиционируется от рабочей области (выше по дереву есть transform,
          создающий containing block), поэтому vw дал бы недостижимую ширину. */}
      <div className={`bg-bg-card rounded-2xl shadow-2xl w-full flex flex-col transition-[max-width,max-height] duration-200 ${
        wide ? "max-w-none max-h-[96vh]" : "max-w-4xl max-h-[92vh]"}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-main flex-shrink-0">
          <h2 className="text-base font-semibold">{editing ? "Редактировать алерт" : "Новый алерт"}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setWide(w => !w)} title={wide ? "Свернуть окно" : "Развернуть окно"}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors">
              {wide ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} title="Закрыть"
              className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto scrollbar-thin p-6 space-y-5 flex-1">
          {/* Name */}
          <div>
            <label className={LABEL_CLS}>Название *</label>
            <input value={name} onChange={e => setName(e.target.value)} className={INPUT_CLS} placeholder="МПР" />
          </div>

          {/* Folder */}
          {folders.length > 0 && (
            <div>
              <label className={LABEL_CLS}>Папка</label>
              <Select
                value={folderId}
                onChange={(value) => setFolderId(value)}
                
              >
                <option value="">— без папки —</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </div>
          )}

          {/* Visibility toggle for superuser */}
          {isSuperuser && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={visibleToMon}
                onChange={e => setVisibleToMon(e.target.checked)}
                className="h-4 w-4 rounded border-border-main accent-primary"
              />
              <span className="text-sm text-text-main">
                Доступен пользователю <span className="font-semibold text-blue-600">Monitoring</span>
              </span>
              {visibleToMon
                ? <Eye className="w-3.5 h-3.5 text-green-600" />
                : <EyeOff className="w-3.5 h-3.5 text-text-muted" />}
            </label>
          )}

          {/* Cell type legend */}
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200">
              <Code className="w-3 h-3" /> <b>Init</b> — один раз при запуске
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
              <RefreshCw className="w-3 h-3" /> <b>Loop</b> — каждый тик планировщика
            </span>
          </div>

          {/* Notebook */}
          <div>
            <label className={`${LABEL_CLS} flex items-center gap-1.5 mb-2`}>
              <BookOpen className="w-3.5 h-3.5" /> Ноутбук{cells.length > 0 ? ` (${cells.length})` : ""}
            </label>
            <NotebookEditor cells={cells} onChange={setCells} />
          </div>

          {/* Dynamic params */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`${LABEL_CLS} flex items-center gap-1.5`} style={{ marginBottom: 0 }}>
                <Settings2 className="w-3.5 h-3.5" /> Динамические параметры{params.length > 0 ? ` (${params.length})` : ""}
              </label>
              <button onClick={() => addParam(editTab === "json" ? "json" : "text")}
                className="flex items-center gap-1 text-xs text-primary font-medium">
                <Plus className="w-3.5 h-3.5" /> Добавить
              </button>
            </div>

            {/* Кнопки / JSON — раздельные наборы параметров */}
            <div className="flex gap-1.5 mb-3">
              {([["fields", "Кнопки", fieldParams], ["json", "JSON", jsonParams]] as const).map(([id, label, list]) => (
                <button key={id} onClick={() => setEditTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    editTab === id
                      ? "border-primary bg-[var(--color-active-bg)] text-primary"
                      : "border-border-main text-text-muted hover:border-primary/40"}`}>
                  {label}
                  <span className="text-[10px] text-text-muted/70">{list.length}</span>
                </button>
              ))}
            </div>

            {editTab === "json" && (
              <div className="rounded-lg px-3 py-2.5 mb-3 border border-border-main bg-bg-subtle text-xs text-text-muted space-y-1">
                <p className="font-semibold text-text-main">Как подставить тело в код</p>
                <p>В «Значение в коде» впишите плейсхолдер, который стоит в скрипте <b>внутри кавычек</b> — тогда вставленный JSON попадёт в переменную как строка:</p>
                <pre className="bg-[var(--color-code-bg)] rounded px-2 py-1.5 font-mono text-[11px] overflow-x-auto">{`JSON_BODY = """__JSON_BODY__"""`}</pre>
                <p>Скрипт разберёт её сам: <code className="font-mono">json.loads(JSON_BODY)</code>. При запуске поле принимает любое тело — оно заменит плейсхолдер целиком.</p>
              </div>
            )}
            {paramIssues.length > 0 && (
              <div className={`rounded-lg px-3 py-2.5 mb-3 border text-xs space-y-1 ${
                hardIssues.length > 0
                  ? "tone-danger"
                  : "tone-warning"}`}>
                <p className="font-semibold">
                  {hardIssues.length > 0
                    ? "Подстановка не сработает как задумано:"
                    : "Обратите внимание на подстановку:"}
                </p>
                {paramIssues.map((i, idx) => (
                  <p key={`${i.id}-${idx}`} className="leading-relaxed">• {i.text}</p>
                ))}
              </div>
            )}
            {visibleParams.length === 0 ? (
              <p className="text-xs text-text-muted bg-bg-subtle rounded-lg px-3 py-3">
                {editTab === "json"
                  ? "Добавьте JSON-параметр — при запуске в это поле можно будет вставить любое тело сообщения"
                  : "Добавьте параметры — их значения будут подставляться в код перед выполнением"}
              </p>
            ) : (
              <div className="space-y-3">
                {visibleParams.map(p => (
                  <div key={p.id} className="bg-bg-subtle rounded-lg px-3 py-3 space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 items-center">
                      <div>
                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Имя</span>
                        <input value={p.label} onChange={e => updateParam(p.id, "label", e.target.value)} className={`${INPUT_CLS} text-xs py-1.5`} placeholder="Система" />
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Ключ в коде</span>
                        <input value={p.code_key} onChange={e => updateParam(p.id, "code_key", e.target.value)} className={`${INPUT_CLS} text-xs py-1.5 font-mono`} placeholder="systems" />
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Значение в коде</span>
                        <input value={p.placeholder} onChange={e => updateParam(p.id, "placeholder", e.target.value)} className={`${INPUT_CLS} text-xs py-1.5 font-mono`} placeholder="CI0000000" />
                      </div>
                      <button onClick={() => removeParam(p.id)}
                        className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 mt-4">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-[1fr_2fr] gap-2 items-start">
                      <div>
                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Тип поля</span>
                        <Select
                          value={p.field_type || "text"}
                          onChange={(value) => updateParam(p.id, "field_type", value)}
                          className="text-xs py-1.5"
                        >
                          {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </Select>
                      </div>
                      {(p.field_type === "select" || p.field_type === "multiselect" || p.field_type === "dropdown" || p.field_type === "dropdown_multi") && (
                        <div>
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Варианты (через запятую)</span>
                          <input
                            value={(p.options ?? []).join(", ")}
                            onChange={e => updateParam(p.id, "options", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                            className={`${INPUT_CLS} text-xs py-1.5`}
                            placeholder="вариант1, вариант2, вариант3"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-main flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted border border-border-main rounded-lg">Отмена</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Output console bottom helper ──────────────────────────────────────────────

function OutputConsoleBottom({ output }: { output: OutputLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth" }); }, [output]);
  return <div ref={ref} />;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AlertsSection() {
  const { isSuperuser } = useAuth();

  const {
    scripts, setScripts, folders, setFolders, loadErr,
    selectedId, setSelectedId,
    sessions,
    values, setValues,
    kernelAlive, kernelConnecting,
    connectKernel, disconnectKernel,
    connectKernelFor, disconnectKernelFor,
    executing, output, clearOutput,
    schedMode, setSchedMode,
    schedFreq, setSchedFreq,
    schedFrom, setSchedFrom,
    schedTo, setSchedTo,
    schedActive, schedCount,
    doExecuteCore, startSchedule, stopSchedule, stopScheduleFor,
    runFolderScripts,
  } = useAlertsScheduler();

  const [showModal,  setShowModal]  = useState(false);
  const [editScript, setEditScript] = useState<AlertScript | null>(null);
  const [allKernels, setAllKernels] = useState<KernelInfo[]>([]);
  const [auditLog,   setAuditLog]   = useState<KernelAuditEntry[]>([]);
  const [showAudit,  setShowAudit]  = useState(false);

  const [openFolders,     setOpenFolders]     = useState<Set<string>>(new Set());
  const [newFolderName,   setNewFolderName]   = useState("");
  const [showNewFolder,   setShowNewFolder]   = useState(false);

  // Тикаем раз в секунду, чтобы "работает X" в статусах обновлялось живьём —
  // только пока хоть один планировщик активен (не тратим таймер впустую).
  const [nowTick, setNowTick] = useState(() => Date.now());
  const anySchedActive = Object.values(sessions).some(s => s.schedActive);
  useEffect(() => {
    if (!anySchedActive) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anySchedActive]);
  const [renamingFolder,  setRenamingFolder]  = useState<string | null>(null);
  const [renameValue,     setRenameValue]     = useState("");

  const toggleFolder = (fid: string) =>
    setOpenFolders(prev => { const n = new Set(prev); n.has(fid) ? n.delete(fid) : n.add(fid); return n; });

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const saved = await saveAlertFolder({ name });
      setFolders(prev => [...prev, saved]);
      setOpenFolders(prev => new Set(prev).add(saved.id));
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (e) { alert(String(e)); }
  };

  const handleRenameFolder = async (fid: string) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      const saved = await saveAlertFolder({ id: fid, name });
      setFolders(prev => prev.map(f => f.id === fid ? saved : f));
      setRenamingFolder(null);
    } catch (e) { alert(String(e)); }
  };

  const handleDeleteFolder = async (fid: string) => {
    if (!confirm("Удалить папку? Алерты из неё переместятся в корень.")) return;
    try {
      await deleteAlertFolder(fid);
      setFolders(prev => prev.filter(f => f.id !== fid));
      setScripts(prev => prev.map(s => s.folder_id === fid ? { ...s, folder_id: null } : s));
    } catch (e) { alert(String(e)); }
  };

  // ── Ширины колонок (тянутся мышью, запоминаются) ─────────────────────────
  // Фиксированные w-56 и 50/50 обрезали длинные названия алертов и параметров.
  const mainRowRef = useRef<HTMLDivElement>(null);
  const [listW,    setListW]    = useState(224);  // прежний w-56
  const [splitPct, setSplitPct] = useState(50);

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("st_alerts_list_w"));
      if (w >= 160 && w <= 560) setListW(w);
      const p = Number(localStorage.getItem("st_alerts_split"));
      if (p >= 20 && p <= 80) setSplitPct(p);
    } catch { /* ignore */ }
  }, []);

  const beginDrag = (onMove: (e: MouseEvent) => void, persist: () => void) => {
    const stop = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persist();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const dragList = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = listW;
    // Верхний предел — доля от реальной ширины строки, иначе на узком экране
    // список вытеснит рабочую область за край.
    const rowW = mainRowRef.current?.getBoundingClientRect().width ?? 900;
    const maxW = Math.max(200, Math.min(560, rowW * 0.4));
    let latest = startW;
    beginDrag(
      ev => { latest = Math.max(160, Math.min(maxW, startW + ev.clientX - startX)); setListW(latest); },
      () => { try { localStorage.setItem("st_alerts_list_w", String(Math.round(latest))); } catch { /* ignore */ } },
    );
  };

  const dragSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    const row = mainRowRef.current;
    if (!row) return;
    let latest = splitPct;
    beginDrag(
      ev => {
        const box = row.getBoundingClientRect();
        const available = box.width - listW;           // область под две колонки
        const x = ev.clientX - box.left - listW;
        latest = Math.max(20, Math.min(80, (x / available) * 100));
        setSplitPct(latest);
      },
      () => { try { localStorage.setItem("st_alerts_split", String(Math.round(latest))); } catch { /* ignore */ } },
    );
  };

  const selected = scripts.find(s => s.id === selectedId) ?? null;

  // Обычные поля и JSON-тела разведены по вкладкам: JSON-поле высокое и
  // вытесняло бы остальные параметры за пределы экрана.
  const [paramTab, setParamTab] = useState<"fields" | "json">("fields");
  const runParams     = selected?.dynamic_params ?? [];
  const runJsonParams = runParams.filter(isJsonParam);
  const runFieldParams = runParams.filter(p => !isJsonParam(p));
  // Если у скрипта только JSON-параметры — показываем их, вкладок не будет.
  const visibleRunParams =
    runFieldParams.length === 0 ? runJsonParams :
    runJsonParams.length  === 0 ? runFieldParams :
    paramTab === "json"          ? runJsonParams : runFieldParams;

  // Незаполненные параметры блокируют запуск: пустое поле больше не подменяется
  // образцом из шаблона, поэтому скрипт с пустым параметром просто не поедет.
  const missing = selected ? missingParams(selected.dynamic_params, values) : [];

  // ── Ручной порядок скриптов в колонке (drag-and-drop, хранится локально) ──
  const [scriptOrder, setScriptOrder] = useState<string[]>([]);
  const [scriptDragId, setScriptDragId] = useState<string | null>(null);
  useEffect(() => {
    try { setScriptOrder(JSON.parse(localStorage.getItem("st_alert_script_order") ?? "[]")); } catch { /* ignore */ }
  }, []);
  const sortByPref = (list: typeof scripts) => {
    const pos = (id: string) => { const i = scriptOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
    return [...list].sort((a, b) => pos(a.id) - pos(b.id));
  };
  const reorderScript = (drag: string, target: string) => {
    if (drag === target) return;
    const ids = sortByPref(scripts).map(s => s.id);
    const from = ids.indexOf(drag);
    if (from < 0) return;
    ids.splice(from, 1);
    const to = ids.indexOf(target);
    if (to < 0) return;
    ids.splice(to, 0, drag);
    setScriptOrder(ids);
    localStorage.setItem("st_alert_script_order", JSON.stringify(ids));
  };

  useEffect(() => {
    if (!isSuperuser) return;
    const load = () => {
      kernelAllStatus().then(setAllKernels).catch(() => {});
      kernelAudit(20).then(setAuditLog).catch(() => {});
    };
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [isSuperuser]);

  const handleSelectScript = (s: AlertScript) => {
    setSelectedId(s.id);
  };

  const handleModalSave = (saved: AlertScript) => {
    setScripts(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [...prev, saved];
    });
    setShowModal(false); setEditScript(null);
    setSelectedId(saved.id);
    setValues(prev => {
      const v: Record<string, string> = {};
      for (const p of saved.dynamic_params) v[p.id] = prev[p.id] ?? p.placeholder;
      return v;
    });
  };

  const handleDelete = async (s: AlertScript) => {
    if (!confirm(`Удалить алерт "${s.name}"?`)) return;
    try {
      await deleteAlertScript(s.id);
      const next = scripts.filter(x => x.id !== s.id);
      setScripts(next);
      if (selectedId === s.id) {
        if (next.length > 0) setSelectedId(next[0].id);
        else setSelectedId(null);
      }
    } catch (e) { alert(String(e)); }
  };

  const freqLabel = FREQS.find(f => f.secs === schedFreq)?.label ?? `${schedFreq}с`;
  const initCount = (selected?.notebook ?? []).filter(c => normType(c.type) === "init").length;
  const loopCount = (selected?.notebook ?? []).filter(c => normType(c.type) === "loop").length;

  const getKernelForScript = (scriptId: string) => allKernels.find(k => k.script_id === scriptId && k.alive);

  const runningAlerts = scripts.filter(s => {
    const sess = sessions[s.id];
    return sess?.kernelAlive || sess?.schedActive;
  });

  if (loadErr) {
    return <div className="p-6"><p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">{loadErr}</p></div>;
  }

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up h-full flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-main mb-1">Алерты</h1>
          <p className="text-sm text-text-muted">
            Jupyter-ядро · Init (однократно) + Loop (цикл)
            {runningAlerts.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {runningAlerts.length} акт.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperuser && (
            <button onClick={() => setShowAudit(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                showAudit ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border-main text-text-muted hover:bg-bg-subtle"
              }`}>
              <List className="w-3.5 h-3.5" /> Аудит
            </button>
          )}
          {isSuperuser && (
            <button onClick={() => { setEditScript(null); setShowModal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-dark transition-all">
              <Plus className="w-4 h-4" /> Новый алерт
            </button>
          )}
        </div>
      </div>

      {/* Audit panel for superuser */}
      {isSuperuser && showAudit && (
        <div className="bg-bg-card border border-amber-200 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> Аудит запусков ядер
          </h3>
          {auditLog.length === 0 ? (
            <p className="text-xs text-text-muted">Нет записей</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
              {auditLog.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-text-muted bg-bg-subtle rounded-lg px-2.5 py-1.5">
                  <span className="font-mono text-[11px] text-text-muted">
                    {entry.ts ? new Date(entry.ts).toLocaleString("ru-RU") : ""}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded-full font-semibold text-[10px] ${
                    entry.action === "start" ? "bg-green-50 text-green-700" :
                    entry.action === "stop"  ? "bg-red-50 text-red-700" :
                    "bg-blue-50 text-blue-700"
                  }`}>
                    {entry.action}
                  </span>
                  <User className="w-3 h-3" />
                  <span className="font-medium text-text-main">{entry.user}</span>
                  <span className="truncate">{entry.script_name || entry.script_id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {scripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 text-text-muted">
          <Bell className="w-12 h-12 opacity-20" />
          <p className="text-sm">Нет алертов. {isSuperuser ? "Создайте первый." : "Суперюзер ещё не открыл вам доступ."}</p>
        </div>
      ) : (
        <div ref={mainRowRef} className="flex gap-1 flex-1 min-h-0 min-w-0">

          {/* Alert list with folders — ширина тянется за разделитель справа */}
          <div style={{ width: listW }}
            className="flex-shrink-0 bg-bg-card border border-border-main rounded-xl p-3 overflow-y-auto scrollbar-thin flex flex-col gap-1">

            {/* New folder button + inline input */}
            {isSuperuser && (
              showNewFolder ? (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                    placeholder="Имя папки..."
                    className="flex-1 min-w-0 text-xs border border-border-main rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button onClick={handleCreateFolder} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Создать">
                    <CircleCheck className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setShowNewFolder(false)} className="p-1 text-text-muted hover:bg-bg-subtle rounded" title="Отмена">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowNewFolder(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]/50 rounded-lg transition-colors">
                  <FolderPlus className="w-3.5 h-3.5" /> Новая папка
                </button>
              )
            )}

            {/* Root-level alerts (no folder) */}
            {sortByPref(scripts.filter(s => !s.folder_id)).map(s => {
              const sess = sessions[s.id];
              const alive     = !!sess?.kernelAlive;
              const connecting = !!sess?.kernelConnecting;
              const sched     = !!sess?.schedActive;
              const exec      = !!sess?.executing;
              const kInfo = isSuperuser ? getKernelForScript(s.id) : null;

              let statusLabel = "";
              let statusColor = "";
              let dotColor    = "bg-bg-muted";

              if (sched) {
                const elapsed = sess?.schedStartedAt ? formatElapsed(nowTick - sess.schedStartedAt) : "";
                statusLabel = `Работает ${elapsed} · #${sess?.schedCount ?? 0}`.trim();
                statusColor = "text-green-600"; dotColor = "bg-green-500 animate-pulse";
              }
              else if (exec) { statusLabel = "Выполняется..."; statusColor = "text-amber-600"; dotColor = "bg-amber-400 animate-pulse"; }
              else if (connecting) { statusLabel = "Подключение..."; statusColor = "text-amber-500"; dotColor = "bg-amber-400 animate-pulse"; }
              else if (alive) { statusLabel = "Ядро подключено"; statusColor = "text-green-600"; dotColor = "bg-green-500"; }
              else if (isSuperuser && kInfo) { statusLabel = kInfo.started_by; statusColor = "text-blue-500"; dotColor = "bg-blue-400"; }

              const isActive = alive || sched || connecting;

              return (
                <div key={s.id} onClick={() => handleSelectScript(s)}
                  draggable
                  onDragStart={e => { e.stopPropagation(); setScriptDragId(s.id); }}
                  onDragEnd={() => setScriptDragId(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); if (scriptDragId) reorderScript(scriptDragId, s.id); }}
                  className={`group flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-all ${
                    scriptDragId === s.id ? "opacity-50" : ""} ${
                    selectedId === s.id ? "bg-[var(--color-active-bg)] border border-primary/30 shadow-sm"
                    : isActive ? "bg-green-50/50 border border-green-200/50 hover:bg-green-50"
                    : "hover:bg-bg-subtle border border-transparent"}`}>
                  <div className="relative flex-shrink-0 mt-0.5">
                    <Bell className={`w-4 h-4 ${selectedId === s.id ? "text-primary" : isActive ? "text-green-600" : "text-text-muted"}`} />
                    {(isActive || kInfo) && <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${dotColor}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm block truncate leading-5 ${selectedId === s.id ? "font-semibold text-primary" : isActive ? "font-medium text-text-main" : "text-text-main"}`}>{s.name}</span>
                    {statusLabel && <span className={`text-[10px] font-medium block truncate leading-4 ${statusColor}`}>{statusLabel}</span>}
                  </div>
                  {isSuperuser && (
                    <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                      <button onClick={e => { e.stopPropagation(); setEditScript(s); setShowModal(true); }} className="p-1 rounded text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]" title="Редактировать"><Pencil className="w-3 h-3" /></button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(s); }} className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Folders */}
            {folders.map(folder => {
              const isOpen = openFolders.has(folder.id);
              const folderScripts = sortByPref(scripts.filter(s => s.folder_id === folder.id));
              const hasActive = folderScripts.some(s => {
                const sess = sessions[s.id];
                return sess?.kernelAlive || sess?.schedActive;
              });

              return (
                <div key={folder.id}>
                  {/* Folder header */}
                  <div className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-subtle transition-colors"
                    onClick={() => toggleFolder(folder.id)}>
                    <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    {isOpen
                      ? <FolderOpen className={`w-4 h-4 flex-shrink-0 ${hasActive ? "text-green-600" : "text-amber-500"}`} />
                      : <FolderClosed className={`w-4 h-4 flex-shrink-0 ${hasActive ? "text-green-600" : "text-amber-500"}`} />}

                    {renamingFolder === folder.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleRenameFolder(folder.id); if (e.key === "Escape") setRenamingFolder(null); }}
                        onBlur={() => handleRenameFolder(folder.id)}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 min-w-0 text-xs font-medium border border-primary/30 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 text-xs font-semibold text-text-main truncate">{folder.name}</span>
                    )}

                    {hasActive && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
                    <span className="text-[10px] text-text-muted/50">{folderScripts.length}</span>

                    {/* Run all scripts in folder */}
                    {folderScripts.length > 0 && (
                      <button
                        onClick={e => { e.stopPropagation(); runFolderScripts(folder.id); }}
                        className="p-0.5 rounded text-green-600 hover:bg-green-50 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Запустить все скрипты в папке"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}

                    {isSuperuser && renamingFolder !== folder.id && (
                      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={e => { e.stopPropagation(); setRenamingFolder(folder.id); setRenameValue(folder.name); }}
                          className="p-0.5 rounded text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]" title="Переименовать">
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                          className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить папку">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Folder children */}
                  {isOpen && (
                    <div className="ml-3 pl-2 border-l border-border-main/50 flex flex-col gap-0.5 mt-0.5 mb-1">
                      {folderScripts.length === 0 && (
                        <p className="text-[10px] text-text-muted/50 px-2 py-1 italic">Пусто</p>
                      )}
                      {folderScripts.map(s => {
                        const sess = sessions[s.id];
                        const alive     = !!sess?.kernelAlive;
                        const connecting = !!sess?.kernelConnecting;
                        const sched     = !!sess?.schedActive;
                        const exec      = !!sess?.executing;
                        const kInfo = isSuperuser ? getKernelForScript(s.id) : null;

                        let statusLabel = "";
                        let statusColor = "";
                        let dotColor    = "bg-bg-muted";

                        if (sched) {
                const elapsed = sess?.schedStartedAt ? formatElapsed(nowTick - sess.schedStartedAt) : "";
                statusLabel = `Работает ${elapsed} · #${sess?.schedCount ?? 0}`.trim();
                statusColor = "text-green-600"; dotColor = "bg-green-500 animate-pulse";
              }
                        else if (exec) { statusLabel = "Выполняется..."; statusColor = "text-amber-600"; dotColor = "bg-amber-400 animate-pulse"; }
                        else if (connecting) { statusLabel = "Подключение..."; statusColor = "text-amber-500"; dotColor = "bg-amber-400 animate-pulse"; }
                        else if (alive) { statusLabel = "Ядро подключено"; statusColor = "text-green-600"; dotColor = "bg-green-500"; }
                        else if (isSuperuser && kInfo) { statusLabel = kInfo.started_by; statusColor = "text-blue-500"; dotColor = "bg-blue-400"; }

                        const isActive = alive || sched || connecting;

                        return (
                          <div key={s.id} onClick={() => handleSelectScript(s)}
                            draggable
                            onDragStart={e => { e.stopPropagation(); setScriptDragId(s.id); }}
                            onDragEnd={() => setScriptDragId(null)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); e.stopPropagation(); if (scriptDragId) reorderScript(scriptDragId, s.id); }}
                            className={`group flex items-start gap-2 px-2.5 py-1.5 rounded-lg cursor-grab active:cursor-grabbing transition-all ${
                              scriptDragId === s.id ? "opacity-50" : ""} ${
                              selectedId === s.id ? "bg-[var(--color-active-bg)] border border-primary/30 shadow-sm"
                              : isActive ? "bg-green-50/50 border border-green-200/50 hover:bg-green-50"
                              : "hover:bg-bg-subtle border border-transparent"}`}>
                            <div className="relative flex-shrink-0 mt-0.5">
                              <Bell className={`w-3.5 h-3.5 ${selectedId === s.id ? "text-primary" : isActive ? "text-green-600" : "text-text-muted"}`} />
                              {(isActive || kInfo) && <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${dotColor}`} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-xs block truncate leading-4 ${selectedId === s.id ? "font-semibold text-primary" : isActive ? "font-medium text-text-main" : "text-text-main"}`}>{s.name}</span>
                              {statusLabel && <span className={`text-[9px] font-medium block truncate leading-3 ${statusColor}`}>{statusLabel}</span>}
                            </div>
                            {isSuperuser && (
                              <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                                <button onClick={e => { e.stopPropagation(); setEditScript(s); setShowModal(true); }} className="p-0.5 rounded text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]" title="Редактировать"><Pencil className="w-2.5 h-2.5" /></button>
                                <button onClick={e => { e.stopPropagation(); handleDelete(s); }} className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить"><Trash2 className="w-2.5 h-2.5" /></button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <ColumnResizer onDrag={dragList} title="Ширина списка алертов" />

          {/* Main area — grid во fr, чтобы обе колонки сжимались вместе с окном:
              на flex с процентной шириной и flex-shrink-0 правая колонка вылезала
              за край, когда список алертов растягивали. */}
          {selected ? (
            <div className="flex-1 min-w-0 grid"
              style={{ gridTemplateColumns: `minmax(0, ${splitPct}fr) auto minmax(0, ${100 - splitPct}fr)` }}>

              {/* Left: kernel + params + notebook preview */}
              <div className="min-w-0 bg-bg-card border border-border-main rounded-xl p-5 overflow-y-auto scrollbar-thin flex flex-col gap-4">

                {/* Kernel status */}
                <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                  kernelAlive ? "bg-green-50 border-green-200" : "bg-bg-subtle border-border-main"}`}>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    kernelConnecting ? "bg-amber-400 animate-pulse" :
                    kernelAlive      ? "bg-green-500 animate-pulse" : "bg-bg-muted"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${kernelAlive ? "text-green-700" : "text-text-muted"}`}>
                      {kernelConnecting ? "Подключение..." : kernelAlive ? "Ядро активно" : "Ядро не подключено"}
                    </p>
                    {kernelAlive && (
                      <p className="text-[10px] text-green-600/70">
                        Init: {initCount} яч. · Loop: {loopCount} яч.
                      </p>
                    )}
                  </div>
                  {kernelAlive ? (
                    <button onClick={disconnectKernel}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors flex-shrink-0">
                      <WifiOff className="w-3.5 h-3.5" /> Отключить
                    </button>
                  ) : (
                    <button onClick={connectKernel} disabled={kernelConnecting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50 flex-shrink-0">
                      {kernelConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                      Подключить
                    </button>
                  )}
                </div>

                {/* Переключатель показывается только когда у скрипта есть оба вида
                    параметров — иначе он был бы лишним элементом. */}
                {runFieldParams.length > 0 && runJsonParams.length > 0 && (
                  <div className="flex gap-1.5">
                    {([["fields", "Поля", runFieldParams], ["json", "JSON", runJsonParams]] as const).map(([id, label, list]) => {
                      const unfilled = missingParams(list, values).length;
                      return (
                        <button key={id} onClick={() => setParamTab(id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            paramTab === id
                              ? "border-primary bg-[var(--color-active-bg)] text-primary"
                              : "border-border-main text-text-muted hover:border-primary/40"}`}>
                          {label}
                          <span className="text-[10px] text-text-muted/70">{list.length}</span>
                          {unfilled > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title={`${unfilled} не заполнено`} />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Dynamic param inputs — typed.
                    Значение больше не подменяется образцом (p.placeholder): образец
                    показывается серой подсказкой внутри поля, а пустое поле остаётся
                    пустым и блокирует запуск. */}
                {visibleRunParams.map(p => {
                  // JSON-тело необязательно: пустое поле = работает генерация скрипта,
                  // поэтому пометку «не заполнено» на него не вешаем.
                  const isMissing = !!p.placeholder && !isJsonParam(p) && !(values[p.id] ?? "").trim();
                  return (
                    <div key={p.id}>
                      <label className={LABEL_CLS}>
                        {p.label || p.code_key || "Параметр"}
                        {p.code_key && <span className="ml-1.5 normal-case font-mono font-normal text-text-muted/70">.{p.code_key}</span>}
                        <span className="ml-1.5 normal-case font-normal text-text-muted/50">({FIELD_TYPE_LABELS[p.field_type || "text"]})</span>
                        {isMissing && <span className="ml-1.5 normal-case font-normal text-amber-600 dark:text-amber-400">— не заполнено</span>}
                      </label>
                      <ParamInput
                        param={p}
                        value={values[p.id] ?? ""}
                        onChange={v => setValues(prev => ({ ...prev, [p.id]: v }))}
                      />
                    </div>
                  );
                })}

              </div>

              <ColumnResizer onDrag={dragSplit} title="Соотношение колонок" />

              {/* Right: output console + scheduler */}
              <div className="min-w-0 bg-bg-card border border-border-main rounded-xl p-5 flex flex-col gap-3 overflow-hidden">

                {/* Output header */}
                <div className="flex items-center justify-between flex-shrink-0">
                  <h3 className="text-sm font-semibold text-text-main flex items-center gap-1.5">
                    <Code className="w-4 h-4 text-text-muted" /> Вывод ядра
                    {executing && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-1" />}
                  </h3>
                  <button onClick={clearOutput} title="Очистить"
                    className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors">
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Output console */}
                <div className="flex-1 min-h-0 border border-border-main rounded-lg bg-gray-950 overflow-y-auto scrollbar-thin">
                  <div className="text-xs font-mono space-y-0 p-2 min-h-full">
                    {output.length === 0 ? (
                      <p className="text-text-muted italic p-2">— ожидание вывода —</p>
                    ) : (
                      output.map((line, i) => (
                        <div key={i} className={`flex gap-2 leading-5 ${
                          line.kind === "error"  ? "text-red-400" :
                          line.kind === "system" ? "text-blue-400" : "text-green-300"}`}>
                          <span className="text-text-muted flex-shrink-0 select-none">{line.ts}</span>
                          <pre className="whitespace-pre-wrap break-all flex-1">{line.text}</pre>
                        </div>
                      ))
                    )}
                    <OutputConsoleBottom output={output} />
                  </div>
                </div>

                {/* Scheduling */}
                <div className="border-t border-border-main pt-3 flex-shrink-0 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Timer className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Режим</span>
                    <div className="flex gap-1.5 ml-auto">
                      {(["once", "periodic"] as const).map(m => (
                        <button key={m} onClick={() => { setSchedMode(m); if (m === "once") stopSchedule(); }}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                            schedMode === m ? "border-primary bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:border-primary/40"}`}>
                          {m === "once" ? "Разовая" : "Периодическая"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {schedMode === "periodic" && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {FREQS.map(f => (
                          <button key={f.secs} onClick={() => setSchedFreq(f.secs)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                              schedFreq === f.secs ? "border-primary bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:border-primary/40"}`}>
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-text-muted mb-1 block font-medium uppercase tracking-wide">С</span>
                          <input type="datetime-local" value={schedFrom} onChange={e => setSchedFrom(e.target.value)} className={`${INPUT_CLS} text-xs py-1.5`} />
                        </div>
                        <div>
                          <span className="text-[10px] text-text-muted mb-1 block font-medium uppercase tracking-wide">По</span>
                          <input type="datetime-local" value={schedTo} onChange={e => setSchedTo(e.target.value)} className={`${INPUT_CLS} text-xs py-1.5`} />
                        </div>
                      </div>
                      {(schedActive || schedCount > 0) && (
                        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
                          schedActive ? "bg-green-50 text-green-700 border border-green-200" : "bg-bg-subtle text-text-muted border border-border-main"}`}>
                          {schedActive && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
                          {schedActive
                            ? `Работает · каждые ${freqLabel}${schedTo ? ` · до ${new Date(schedTo).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""} · выполнено: ${schedCount}`
                            : `Остановлено · выполнено: ${schedCount}`}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { stopSchedule(); }} disabled={!schedActive}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border-main rounded-lg text-text-muted hover:bg-bg-subtle disabled:opacity-30 transition-all">
                    <RotateCcw className="w-3.5 h-3.5" /> Сброс
                  </button>

                  <div className="ml-auto">
                    {!kernelAlive ? (
                      <button disabled className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 text-text-muted rounded-lg text-sm font-semibold cursor-not-allowed">
                        <Wifi className="w-4 h-4" /> Подключите ядро
                      </button>
                    ) : missing.length > 0 ? (
                      <button disabled
                        title={`Заполните: ${missing.map(p => p.label || p.code_key || "без названия").join(", ")}`}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 text-text-muted rounded-lg text-sm font-semibold cursor-not-allowed dark:bg-bg-muted">
                        <Play className="w-4 h-4" /> Заполните параметры ({missing.length})
                      </button>
                    ) : schedMode === "once" ? (
                      <button onClick={() => doExecuteCore()} disabled={executing}
                        className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-40 shadow-sm">
                        {executing ? <><Loader2 className="w-4 h-4 animate-spin" /> Выполняю...</> : <><Play className="w-4 h-4 fill-current" /> Запустить</>}
                      </button>
                    ) : schedActive ? (
                      <button onClick={stopSchedule}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 shadow-sm">
                        <Square className="w-4 h-4 fill-current" /> Остановить
                      </button>
                    ) : (
                      <button onClick={() => startSchedule(schedFreq)} disabled={executing}
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-40 shadow-sm">
                        <Play className="w-4 h-4 fill-current" /> Запустить · {freqLabel}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <p className="text-sm">Выберите алерт из списка</p>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <ScriptModal
          initial={editScript}
          folders={folders}
          onSave={handleModalSave}
          onClose={() => { setShowModal(false); setEditScript(null); }}
        />
      )}
    </div>
  );
}
