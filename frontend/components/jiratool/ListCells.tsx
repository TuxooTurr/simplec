"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Bookmark, Bug, CheckSquare, Layers, Plus, X, Zap } from "lucide-react";
import {
  FIELD_BY_ID, ROLE_STATES, ROLE_STATE_LABEL, WORK_DAY, tagColor, blockersOf, factMinutes, fmtJiraDate, fmtMinutes, isOpenDefect, parseDuration,
  type Issue, type OwnField, type Participant, type RoleState, type RoleValue, type Spend,
} from "@/lib/jiraTool";
import { STAGE_LABEL, stageStyle, stageText, textOn, type StageInfo } from "@/lib/jiraStages";

/* Ячейки таблицы Jira tool. Ширину задаёт колонка (её можно растягивать), поэтому
   у содержимого нет своих минимальных ширин — текст переносится или обрезается. */

const STATUS_CLS: Record<string, string> = {
  "Открыт": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  "В работе": "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "Разработка": "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "Готов к тестированию": "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  "Готово к тестированию": "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  "Переоткрыт": "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  "Выполнен": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  "Выполнено": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  "Закрыт": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
};
const PRIO_DOT: Record<string, string> = {
  "Блокирующий": "bg-red-600", "Критичный": "bg-orange-500", "Высокий": "bg-amber-400", "Средний": "bg-sky-400", "Низкий": "bg-slate-400",
};

/* ── Ячейки ────────────────────────────────────────────────────────────── */

export function JiraCell({ id, issue }: { id: string; issue: Issue }) {
  const v = issue.fields[id];
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return <span className="text-text-muted/50">—</span>;
  if (id === "status") return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${STATUS_CLS[String(v)] ?? "bg-bg-subtle text-text-main"}`}>{String(v)}</span>;
  if (id === "priority") return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`w-2 h-2 rounded-full ${PRIO_DOT[String(v)] ?? "bg-slate-400"}`} />{String(v)}</span>;
  if (id === "issuetype") return <IssueTypeBadge type={String(v)} />;
  const kind = FIELD_BY_ID[id]?.kind;
  if (kind === "date" || kind === "datetime") {
    return <span className="whitespace-nowrap" title={String(v)}>{fmtJiraDate(String(v), kind === "datetime")}</span>;
  }
  if (Array.isArray(v)) return (
    <span className="flex flex-wrap gap-1">{v.map(x => <span key={x} className="px-1.5 py-0.5 rounded bg-bg-subtle text-[11px] whitespace-nowrap">{x}</span>)}</span>
  );
  if (id === "summary") return <span className="block break-words">{String(v)}</span>;
  if (FIELD_BY_ID[id]?.kind === "longtext") return <span className="block line-clamp-2 break-words text-text-muted">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

/**
 * Сумма неустранённых дефектов задачи (всё, кроме «Подтверждено исправление» и «Закрыт»);
 * по клику — окно со списком. У самих дефектов поля нет.
 */
export function DefectsCell({ defects, onOpen }: { defects: Issue[] | null; onOpen: () => void }) {
  if (defects === null) return <span className="text-text-muted/50">—</span>;
  const open = defects.filter(isOpenDefect).length;
  const fixed = defects.length - open;
  return (
    <button type="button" onClick={onOpen}
      title={`Неустранённых ${open}${fixed ? `, устранённых ${fixed}` : ""} — открыть список`}
      className={`inline-flex items-center gap-1 min-w-[32px] justify-center px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors
        ${open > 0 ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-300"
          : "bg-bg-subtle text-text-muted hover:text-text-main"}`}>
      {open}
    </button>
  );
}

/** Знак внимания, если среди неустранённых дефектов есть блокирующие. */
export function BlockCell({ defects, onOpen }: { defects: Issue[] | null; onOpen: () => void }) {
  if (defects === null) return <span className="text-text-muted/50">—</span>;
  const blockers = blockersOf(defects);
  if (!blockers.length) return null;
  return (
    <button type="button" onClick={onOpen} aria-label={`Блокирующих дефектов: ${blockers.length}`}
      title={`Блокирующих дефектов: ${blockers.length} — ${blockers.map(b => b.key).join(", ")}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60">
      <AlertTriangle className="w-4 h-4" strokeWidth={2.5} />
      {blockers.length > 1 && <span className="text-xs font-bold">{blockers.length}</span>}
    </button>
  );
}

/** Статус (st). onOpen есть только у эпика: клик — окно со сторями эпика. */
export function StageCell({ info, onOpen }: { info: StageInfo; onOpen?: () => void }) {
  if (!onOpen) return <StageBadge info={info} />;
  return (
    <button type="button" onClick={onOpen} className="max-w-full text-left rounded-md hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={`Статус (st): ${stageText(info)} — подробнее`}>
      <StageBadge info={info} />
    </button>
  );
}

export function StageBadge({ info }: { info: StageInfo }) {
  switch (info.kind) {
    case "blocked":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap" style={stageStyle("blocked")}
          title={`Блокирующие незакрытые дефекты: ${info.by.map(d => d.key).join(", ")} (список — в «Дефекты (st)»). Без блокировки — «${stageText(info.base)}».`}>
          <Ban className="w-3 h-3" /> {STAGE_LABEL.blocked}
          {info.by.length > 1 && <span className="opacity-80">· {info.by.length}</span>}
        </span>
      );
    case "stage":
      return <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap" style={stageStyle(info.stage)}>{STAGE_LABEL[info.stage]}</span>;
    case "epic":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={`Статус (st) по сторям эпика: ${info.behind} из ${info.total} — «${STAGE_LABEL[info.stage]}»`
            + (info.unmapped ? `; не сопоставлено: ${info.unmapped}` : "")}>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={stageStyle(info.stage)}>{STAGE_LABEL[info.stage]}</span>
          <span className="text-[10px] text-text-muted">{info.behind}/{info.total}</span>
          {info.unmapped > 0 && <AlertTriangle className="w-3 h-3 text-amber-500" />}
        </span>
      );
    case "unmapped":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 whitespace-nowrap"
          title={`Статус Jira «${info.status}» не сопоставлен — настройте в «Статус (st)»`}>
          <AlertTriangle className="w-3 h-3" /> Не сопоставлен
        </span>
      );
    case "no-stories":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400 whitespace-nowrap"
          title="У эпика нет сторей — этап не посчитать. Это нарушение процесса: стори нужно завести и привязать через Epic Link.">
          <AlertTriangle className="w-3 h-3" /> Нет сторей
        </span>
      );
  }
}

/**
 * Свободный ввод. В просмотре длинный текст либо обрезается многоточием (wrap=false),
 * либо переносится и показывается целиком (wrap=true) — это настройка поля.
 * По клику — поле редактирования на несколько строк; Enter — сохранить, Shift+Enter — новая строка.
 */
function TextCell({ value, wrap, onChange }: { value: string; wrap?: boolean; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const t = ref.current;
    if (editing && t) { t.focus(); t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }
  }, [editing]);
  const commit = () => { setEditing(false); if (draft !== value) onChange(draft); };

  if (editing) {
    return (
      <textarea ref={ref} value={draft} rows={1}
        onChange={e => { setDraft(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className="w-full resize-none bg-[var(--color-input-bg)] px-1 py-0.5 rounded border border-primary/40 focus:outline-none text-sm text-text-main" />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title={!wrap && value ? value : "Нажмите, чтобы изменить"}
      className={`w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main text-sm
        ${wrap ? "whitespace-pre-wrap break-words" : "truncate"} ${value ? "text-text-main" : "text-text-muted/50"}`}>
      {value || "—"}
    </button>
  );
}

function MultiCell({ field, value, onChange }: { field: OwnField; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex flex-wrap gap-1 min-h-[24px] w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main">
        {value.length ? value.map(x => <span key={x} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px]">{x}</span>)
          : <span className="text-text-muted/50 text-sm">—</span>}
      </button>
      {open && (
        <div className="absolute z-30 left-0 mt-1 w-48 rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-1">
          {field.options.map(o => (
            <label key={o} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-subtle text-sm cursor-pointer">
              <input type="checkbox" checked={value.includes(o)}
                onChange={() => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o])} />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Цветной тег варианта своего поля. */
export function Tag({ field, value }: { field: OwnField; value: string }) {
  const c = tagColor(field, value);
  return (
    <span className="inline-block max-w-full truncate px-1.5 py-0.5 rounded-md text-[11px] font-medium align-middle"
      style={{ backgroundColor: c, color: textOn(c) }}>{value}</span>
  );
}

/**
 * Список или множественный выбор в виде цветных тегов. Выбор — во всплывающем списке поверх таблицы
 * (fixed: внутри ячейки его обрезала бы прокрутка таблицы); при прокрутке он закрывается.
 */
function TagCell({ field, value, onChange }: { field: OwnField; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const multi = field.type === "multiselect";
  const chosen = Array.isArray(value) ? value : value ? [value] : [];
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setPos(null);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); };
  }, [pos]);
  const toggleOpen = () => {
    if (pos) { setPos(null); return; }
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4 });
  };
  const pick = (o: string) => {
    if (multi) onChange(chosen.includes(o) ? chosen.filter(x => x !== o) : [...chosen, o]);
    else { onChange(chosen[0] === o ? "" : o); setPos(null); }
  };
  return (
    <>
      <button ref={btn} type="button" onClick={toggleOpen} aria-expanded={!!pos} aria-haspopup="listbox" aria-label={field.name}
        className="flex flex-wrap gap-1 min-h-[24px] w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main">
        {chosen.length ? chosen.map(x => <Tag key={x} field={field} value={x} />) : <span className="text-text-muted/50 text-sm">—</span>}
      </button>
      {pos && (
        <div ref={box} role="listbox" aria-multiselectable={multi} aria-label={field.name}
          style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 60 }}
          className="w-56 max-h-64 overflow-y-auto scrollbar-thin rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-1 animate-fade-in">
          {field.options.map(o => (
            <button key={o} type="button" role="option" aria-selected={chosen.includes(o)} onClick={() => pick(o)}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-bg-subtle ${chosen.includes(o) ? "bg-primary/10" : ""}`}>
              {multi && <input type="checkbox" readOnly checked={chosen.includes(o)} tabIndex={-1} aria-hidden />}
              <Tag field={field} value={o} />
            </button>
          ))}
          {!multi && chosen.length > 0 && (
            <button type="button" onClick={() => { onChange(""); setPos(null); }}
              className="w-full text-left px-2 py-1 rounded text-sm text-text-muted hover:bg-bg-subtle">— снять</button>
          )}
        </div>
      )}
    </>
  );
}

export function OwnCell({ field, value, onChange }: { field: OwnField; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  if (field.tags && (field.type === "select" || field.type === "multiselect")) return <TagCell field={field} value={value} onChange={onChange} />;
  const cls = "bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main focus:border-primary/40 " +
    "focus:outline-none focus:bg-[var(--color-input-bg)] text-sm text-text-main";
  const s = typeof value === "string" ? value : "";
  switch (field.type) {
    case "date": return <input type="date" value={s} onChange={e => onChange(e.target.value)} aria-label={field.name} className={cls} />;
    case "datetime": return <input type="datetime-local" value={s} onChange={e => onChange(e.target.value)} aria-label={field.name} className={cls} />;
    case "select": return (
      <select value={s} onChange={e => onChange(e.target.value)} aria-label={field.name} className={`${cls} w-full`}>
        <option value="">—</option>
        {field.options.map(o => <option key={o}>{o}</option>)}
      </select>
    );
    case "multiselect": return <MultiCell field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    default: return <TextCell value={s} wrap={field.wrap} onChange={onChange} />;
  }
}

/** Цветная метка участника с его должностью (QA, AQA, LQA…). Без должности — пустой цветной кружок. */
export function RoleBadge({ participant, size = "sm" }: { participant?: Participant; size?: "sm" | "md" }) {
  const dims = size === "md" ? "min-w-[30px] h-6 text-[10px]" : "min-w-[26px] h-5 text-[9px]";
  if (!participant) {
    return <span className={`${dims} inline-block rounded-md border border-dashed border-text-muted/40 flex-shrink-0`} aria-hidden />;
  }
  return (
    <span className={`${dims} inline-flex items-center justify-center px-1 rounded-md font-bold text-white tracking-tight flex-shrink-0`}
      style={{ backgroundColor: participant.color }} title={participant.role ? `Должность: ${participant.role}` : "Должность не указана"}>
      {participant.role || ""}
    </span>
  );
}

export function ParticipantCell({ value, participants, onChange }: { value: string; participants: Participant[]; onChange: (id: string) => void }) {
  const p = participants.find(x => x.id === value);
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <RoleBadge participant={p} />
      <select value={value} onChange={e => onChange(e.target.value)} aria-label="Участник"
        className="min-w-0 flex-1 bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main focus:outline-none text-sm text-text-main truncate">
        <option value="">— не назначен</option>
        {participants.map(x => <option key={x.id} value={x.id}>{x.role ? `${x.name} · ${x.role}` : x.name}</option>)}
      </select>
    </span>
  );
}

/* ── Поля направлений (st): фамилия и состояние ─────────────────────────── */

const ROLE_STATE_CLS: Record<RoleState, string> = {
  todo:  "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  doing: "bg-amber-300 text-amber-950 dark:bg-amber-500 dark:text-amber-950",
  done:  "bg-green-600 text-white dark:bg-green-600",
};

/**
 * Ячейка направления: фамилия (свой список у каждого поля — добавить и удалить можно прямо
 * в выпадающем списке) и состояние цветом: серый — не взят, жёлтый — в работе, зелёный — выполнен.
 */
export function RoleCell({ label, value, names, onChange, onNames }: {
  label: string;
  value: RoleValue | undefined;
  names: string[];
  onChange: (patch: RoleValue) => void;
  onNames: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [draft, setDraft] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const state = value?.state ?? "todo";

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    // Список рисуется поверх таблицы (fixed): при прокрутке он бы отстал от ячейки — закрываем.
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); };
  }, [open]);

  const toggle = () => {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4 });
    }
    setOpen(o => !o);
  };
  const add = () => {
    const n = draft.trim();
    if (!n) return;
    if (!names.includes(n)) onNames([...names, n]);
    onChange({ ...value, name: n });
    setDraft(""); setOpen(false);
  };
  const shown = value?.name && !names.includes(value.name) ? [value.name, ...names] : names;

  return (
    <span className="flex items-center gap-1 min-w-0">
      {/* Цветной кружок; поверх — прозрачный выпадающий список (родной: работает с клавиатуры и экранным диктором). */}
      <span title={ROLE_STATE_LABEL[state]}
        className={`relative w-4 h-4 flex-shrink-0 rounded-full border border-black/10 focus-within:ring-2 focus-within:ring-primary/50 ${ROLE_STATE_CLS[state]}`}>
        <select value={state} onChange={e => onChange({ ...value, state: e.target.value as RoleState })}
          aria-label={`${label}: состояние — ${ROLE_STATE_LABEL[state]}`}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
          {ROLE_STATES.map(st => <option key={st} value={st}>{ROLE_STATE_LABEL[st]}</option>)}
        </select>
      </span>
      <button ref={btn} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="listbox" aria-label={`${label}: фамилия`}
        className="min-w-0 flex-1 text-left truncate px-1 py-0.5 rounded border border-transparent hover:border-border-main text-sm">
        {value?.name || <span className="text-text-muted/50">—</span>}
      </button>
      {open && pos && (
        <div ref={box} role="listbox" aria-label={`${label}: фамилии`} style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 60 }}
          className="w-56 rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-1 animate-fade-in">
          <button type="button" role="option" aria-selected={!value?.name} onClick={() => { onChange({ ...value, name: "" }); setOpen(false); }}
            className="w-full text-left px-2 py-1 rounded text-sm text-text-muted hover:bg-bg-subtle">— не назначен</button>
          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {shown.map(n => (
              <div key={n} className={`group/rn flex items-center rounded ${value?.name === n ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                <button type="button" role="option" aria-selected={value?.name === n} onClick={() => { onChange({ ...value, name: n }); setOpen(false); }}
                  className="flex-1 min-w-0 truncate text-left px-2 py-1 text-sm text-text-main">{n}</button>
                {names.includes(n) && (
                  <button type="button" onClick={() => onNames(names.filter(x => x !== n))} aria-label={`Убрать ${n} из списка ${label}`}
                    title="Убрать из списка фамилий (в уже заполненных ячейках останется)"
                    className="p-1 mr-0.5 rounded text-text-muted opacity-0 group-hover/rn:opacity-100 focus-visible:opacity-100 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 border-t border-border-main mt-1 pt-1">
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="Новая фамилия, Enter"
              onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") setOpen(false); }} aria-label={`Добавить фамилию в ${label}`}
              className="min-w-0 flex-1 text-sm px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <button type="button" onClick={add} disabled={!draft.trim()} aria-label="Добавить фамилию"
              className="p-1.5 rounded bg-primary text-white disabled:opacity-40"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </span>
  );
}

/* ── Тип задачи — цветной лейбл как в Jira ─────────────────────────────── */

const TYPE_STYLE: { re: RegExp; color: string; Icon: typeof Bug }[] = [
  { re: /дефект|bug|баг|ошибк/i,             color: "#e5493a", Icon: Bug },        // красный
  { re: /^epic$|эпик/i,                      color: "#904ee2", Icon: Zap },        // фиолетовый
  { re: /истори|story/i,                     color: "#63ba3c", Icon: Bookmark },   // зелёный
  { re: /подзадач|sub-?task/i,               color: "#4bade8", Icon: Layers },     // голубой
  { re: /задач|task/i,                       color: "#2684ff", Icon: CheckSquare },// синий
];

/** Тип задачи: иконка в цветном квадрате + название — дефект красный, стори зелёная, эпик фиолетовый, задача синяя. */
export function IssueTypeBadge({ type }: { type: string }) {
  const st = TYPE_STYLE.find(t => t.re.test(type)) ?? { color: "#6b778c", Icon: CheckSquare };
  const { Icon } = st;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium max-w-full"
      style={{ color: st.color }} title={type}>
      <span className="w-4 h-4 rounded-[3px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: st.color }}>
        <Icon className="w-2.5 h-2.5 text-white" strokeWidth={3} />
      </span>
      <span className="truncate">{type}</span>
    </span>
  );
}

/* ── Трудозатраты ──────────────────────────────────────────────────────── */

const UNIT_KEY = "st_plan_unit";

/**
 * Траты план: показываем «1 ч 40 мин», храним минуты. При вводе — быстрый
 * переключатель ч/мин: значение пересчитывается (100 мин → 1:40 ч) и под полем
 * сразу видно, как оно будет записано.
 */
export function PlanCell({ value, onChange }: { value: number | undefined; onChange: (min: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState<"h" | "m">("h");
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const toText = (min: number | undefined, u: "h" | "m") =>
    min == null ? "" : u === "m" ? String(min) : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

  const open = () => {
    let u: "h" | "m" = "h";
    try { u = localStorage.getItem(UNIT_KEY) === "m" ? "m" : "h"; } catch { /* по умолчанию часы */ }
    setUnit(u); setDraft(toText(value, u)); setEditing(true);
  };
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const parsed = parseDuration(draft, unit);
  const switchUnit = (u: "h" | "m") => {
    if (u === unit) return;
    setDraft(parsed == null ? draft : toText(parsed, u));
    setUnit(u);
    try { localStorage.setItem(UNIT_KEY, u); } catch { /* не запомнится */ }
    ref.current?.focus();
  };
  const commit = () => {
    setEditing(false);
    if (!draft.trim()) { if (value != null) onChange(null); return; }
    if (parsed != null && parsed !== value) onChange(parsed);
  };

  if (!editing) {
    return (
      <button type="button" onClick={open} title="Нажмите, чтобы указать план"
        className={`w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main text-sm whitespace-nowrap
          ${value != null ? "text-text-main" : "text-text-muted/50"}`}>
        {value != null ? fmtMinutes(value) : "—"}
      </button>
    );
  }
  return (
    <div className="space-y-0.5" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(); }}>
      <div className="flex items-center gap-1">
        <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)} inputMode="decimal"
          placeholder={unit === "h" ? "1.5 или 1:30" : "90"} aria-label="Траты план"
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          className={`min-w-0 flex-1 bg-[var(--color-input-bg)] px-1 py-0.5 rounded border text-sm text-text-main focus:outline-none
            ${draft.trim() && parsed == null ? "border-red-400" : "border-primary/40"}`} />
        <span className="flex rounded border border-border-main overflow-hidden text-[10px] font-semibold flex-shrink-0" role="radiogroup" aria-label="Единица">
          {(["h", "m"] as const).map(u => (
            <button key={u} type="button" role="radio" aria-checked={unit === u} onMouseDown={e => e.preventDefault()} onClick={() => switchUnit(u)}
              className={`px-1.5 py-0.5 ${unit === u ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}>
              {u === "h" ? "ч" : "мин"}
            </button>
          ))}
        </span>
      </div>
      <p className="text-[10px] text-text-muted">{draft.trim() ? (parsed == null ? "не понял — пример: 1.5, 1:30, 90" : `= ${fmtMinutes(parsed)}`) : "пусто — убрать план"}</p>
    </div>
  );
}

/** Начало / конец теста — дата и время. */
export function SpendDateCell({ value, label, onChange }: { value: string | undefined; label: string; onChange: (v: string) => void }) {
  return (
    <input type="datetime-local" value={value ?? ""} onChange={e => onChange(e.target.value)} aria-label={label}
      className="w-full bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main focus:border-primary/40
        focus:outline-none focus:bg-[var(--color-input-bg)] text-sm text-text-main" />
  );
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const WORK_HINT = `рабочее время: пн–пт ${hhmm(WORK_DAY.start)}–${hhmm(WORK_DAY.end)}, без обеда ${hhmm(WORK_DAY.lunch[0])}–${hhmm(WORK_DAY.lunch[1])}`;

/** Траты факт = рабочее время между началом и концом; не заполнено хоть одно — пусто. Больше плана — подсвечиваем. */
export function FactCell({ spend }: { spend: Spend | undefined }) {
  const f = factMinutes(spend);
  if (f == null) {
    return <span className="text-text-muted/50 text-sm" title="Заполните «Начало теста» и «Конец теста»">—</span>;
  }
  if (f < 0) return <span className="text-xs text-red-600 dark:text-red-400" title="Конец теста раньше начала">конец раньше начала</span>;
  const over = spend?.plan != null && f > spend.plan;
  return (
    <span className={`text-sm whitespace-nowrap ${over ? "text-amber-700 dark:text-amber-300 font-medium" : "text-text-main"}`}
      title={`${spend?.plan != null ? `План ${fmtMinutes(spend.plan)}${over ? ` — превышен на ${fmtMinutes(f - spend.plan)}` : ""}. ` : ""}Считается ${WORK_HINT}`}>
      {fmtMinutes(f)}
    </span>
  );
}
