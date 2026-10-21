"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Ban, Bookmark, Bug, Check, CheckSquare, ChevronDown, Globe, Layers, Pencil, Plus, Smile, X, Zap } from "lucide-react";
import { parseCellIcon, useIcons } from "@/lib/cellIcon";
import Floating from "./Floating";

// Окно ярлычков тянет весь набор иконок — грузим его, только когда его открыли.
const IconPicker = dynamic(() => import("./IconPicker"), { ssr: false });
import {
  FIELD_BY_ID, ROLE_STATES, ROLE_STATE_LABEL, WORK_DAY, linkHref, tagColor, blockersOf, factMinutes, fmtJiraDate, fmtMinutes, getTimeDay, inDirection, isOpenDefect, parseDuration,
  type Issue, type LoadSkip, type OwnField, type Participant, type RoleState, type RoleValue, type Spend,
} from "@/lib/jiraTool";
import { STAGES, STAGE_LABEL, jiraRankOf, jiraStageOf, stageRankOf, stageStyle, stageText, textOn, type Stage, type StageInfo } from "@/lib/jiraStages";

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
/**
 * Статус (st) в строке. Клик по статусу эпика — его стори. Стрелка рядом — поставить статус руками:
 * он держится, пока этап по Jira не станет выше (ниже Jira выбрать нельзя — ничего бы не изменилось).
 */
export function StageCell({ info, onOpen, manual, onManual }: {
  info: StageInfo;
  onOpen?: () => void;
  /** Ручной статус задачи (даже если Jira его уже обогнала). */
  manual?: Stage;
  onManual: (stage: Stage | null) => void;
}) {
  const [pos, setPos] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const jira = jiraStageOf(info);
  const jiraRank = jiraRankOf(info);
  const progress = STAGES.filter(st => st !== "excluded");
  const set = (st: Stage | null) => { onManual(st); setPos(false); };
  const open = () => setPos(p => !p);

  return (
    <span className="group/st inline-flex items-center gap-0.5 max-w-full">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="max-w-full text-left rounded-md hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`Статус (st): ${stageText(info)} — подробнее`}>
          <StageBadge info={info} />
        </button>
      ) : <StageBadge info={info} />}
      <button ref={btn} type="button" onClick={open} aria-haspopup="menu" aria-expanded={!!pos} aria-label="Поставить статус (st) вручную"
        title="Поставить статус (st) вручную"
        className={`p-0.5 rounded text-text-muted hover:text-primary hover:bg-bg-subtle focus-visible:opacity-100
          ${pos ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 group-hover/st:opacity-100"}`}>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {pos && (
        <Floating anchor={btn} onClose={() => setPos(false)} width={240} role="menu" ariaLabel="Статус (st) вручную" className="p-1">
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-text-muted leading-snug">
            По Jira: <b className="text-text-main font-medium">{stageText(jira)}</b>. Ручной держится, пока Jira не покажет статус выше.
          </p>
          {progress.map(st => {
            const below = stageRankOf(st) <= jiraRank;
            const on = manual === st;
            return (
              <button key={st} type="button" role="menuitemradio" aria-checked={on} disabled={below} onClick={() => set(st)}
                title={below ? "Не выше статуса по Jira — ручной ничего бы не изменил" : undefined}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left hover:bg-bg-subtle disabled:opacity-40 disabled:hover:bg-transparent">
                <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={stageStyle(st)}>{STAGE_LABEL[st]}</span>
                {on && <Check className="ml-auto w-3.5 h-3.5 text-primary" />}
              </button>
            );
          })}
          {manual && (
            <button type="button" onClick={() => set(null)}
              className="w-full mt-1 pt-1.5 border-t border-border-main px-2 pb-1 text-left text-sm text-text-muted hover:text-text-main">
              Сбросить — как в Jira
            </button>
          )}
        </Floating>
      )}
    </span>
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
      return (
        <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap" style={stageStyle(info.stage)}
          title={info.manual ? `Поставлен вручную. По Jira — «${stageText(info.manual)}»` : undefined}>
          {STAGE_LABEL[info.stage]}
        </span>
      );
    case "epic":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={info.manual
            ? `Поставлен вручную. По сторям эпика — «${stageText(info.manual)}»`
            : `Статус (st) по сторям эпика: ${info.behind} из ${info.total} — «${STAGE_LABEL[info.stage]}»`
              + (info.unmapped ? `; не сопоставлено: ${info.unmapped}` : "")}>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={stageStyle(info.stage)}>
            {STAGE_LABEL[info.stage]}
          </span>

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
/** Ярлычок ячейки: цветная иконка или эмодзи. Пока набор иконок грузится — пустое место того же размера. */
export function CellIconView({ code, className = "w-4 h-4" }: { code?: string; className?: string }) {
  const c = parseCellIcon(code);
  const icons = useIcons();
  if (!c) return null;
  if (c.kind === "emoji") return <span className="inline-flex items-center justify-center w-4 h-4 text-sm leading-none flex-shrink-0" aria-hidden>{c.emoji}</span>;
  const I = icons?.[c.name];
  return I ? <I className={`${className} flex-shrink-0 text-text-main`} style={c.color ? { color: c.color } : undefined} strokeWidth={2.2} aria-hidden />
    : <span className={`${className} inline-block flex-shrink-0`} aria-hidden />;
}

function TextCell({ value, wrap, icon, onChange, onIcon }: {
  value: string;
  wrap?: boolean;
  /** Ярлычок ячейки (код из lib/cellIcon.ts). */
  icon?: string;
  onChange: (v: string) => void;
  onIcon: (code: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrapBox = useRef<HTMLDivElement>(null);
  const pickerBox = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value), [value]);
  const fit = (t: HTMLTextAreaElement) => { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; };
  useEffect(() => {
    const t = ref.current;
    // Курсор — в конец текста: обычно дописывают после уже написанного.
    if (editing && t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); fit(t); }
  }, [editing]);
  const commit = () => { setEditing(false); setPicker(null); if (draft !== value) onChange(draft); };
  // Окно ярлычков висит поверх таблицы (fixed): прокрутили таблицу — оно бы отстало от ячейки, закрываем.
  useEffect(() => {
    if (!picker) return;
    const close = (e: Event) => { if (!pickerBox.current?.contains(e.target as Node)) setPicker(null); };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [picker]);

  /** Ярлычок выбран (или убран) — сохраняем сразу, текст продолжаем редактировать. */
  const pickIcon = (code: string | null) => {
    onIcon(code);
    setPicker(null);
    requestAnimationFrame(() => ref.current?.focus());
  };

  if (editing) {
    return (
      <div ref={wrapBox} className="relative"
        // Фокус ушёл за пределы поля и окна ярлычков — сохраняем (события из портала тоже приходят сюда).
        onBlur={e => {
          const to = e.relatedTarget as Node | null;
          if (to && (wrapBox.current?.contains(to) || pickerBox.current?.contains(to))) return;
          commit();
        }}>
        <textarea ref={ref} value={draft} rows={1}
          onChange={e => { setDraft(e.target.value); fit(e.target); }}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === "Escape") {
              if (picker) { setPicker(null); return; }
              setDraft(value); setEditing(false);
            }
          }}
          className="w-full resize-none bg-[var(--color-input-bg)] pl-1 pr-8 py-0.5 rounded border border-primary/40 focus:outline-none text-sm text-text-main" />
        <button type="button" onMouseDown={e => e.preventDefault()} aria-label="Ярлычок: иконка или эмодзи" title="Ярлычок" aria-expanded={!!picker}
          onClick={() => setPicker(p => (p ? null : wrapBox.current?.getBoundingClientRect() ?? null))}
          className={`absolute right-1 top-0.5 p-0.5 rounded hover:bg-bg-subtle ${picker ? "ring-1 ring-primary/50" : ""}`}>
          {icon ? <CellIconView code={icon} /> : <Smile className="w-4 h-4 text-text-muted" />}
        </button>
        {picker && (
          <IconPicker anchor={picker} value={icon} boxRef={pickerBox} onPick={pickIcon}
            onClose={() => { setPicker(null); ref.current?.focus(); }} />
        )}
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title={!wrap && value ? value : "Нажмите, чтобы изменить"}
      className={`w-full flex items-start gap-1.5 text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main text-sm
        ${value ? "text-text-main" : "text-text-muted/50"}`}>
      {icon && <span className="mt-0.5"><CellIconView code={icon} /></span>}
      <span className={`min-w-0 flex-1 ${wrap ? "whitespace-pre-wrap break-words" : "truncate"}`}>{value || (icon ? "" : "—")}</span>
    </button>
  );
}

function MultiCell({ field, value, onChange }: { field: OwnField; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={field.name}
        className="flex flex-wrap gap-1 min-h-[24px] w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main">
        {value.length ? value.map(x => <span key={x} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px]">{x}</span>)
          : <span className="text-text-muted/50 text-sm">—</span>}
      </button>
      {open && (
        <Floating anchor={btn} onClose={() => setOpen(false)} width={192} className="p-1" ariaLabel={field.name}>
          {field.options.map(o => (
            <label key={o} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-subtle text-sm cursor-pointer">
              <input type="checkbox" checked={value.includes(o)}
                onChange={() => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o])} />
              {o}
            </label>
          ))}
        </Floating>
      )}
    </>
  );
}

/**
 * Поле «Ссылка»: что бы ни вставили, в ячейке — значок глобуса, по клику ссылка открывается в новой вкладке
 * (адрес — в подсказке). Карандаш рядом — изменить; пусто — «+ ссылка». Не похожее на адрес — серый глобус.
 */
function LinkCell({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const href = linkHref(value);
  const save = () => { setEditing(false); if (draft.trim() !== value) onChange(draft.trim()); };

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} aria-label={`${label}: ссылка`}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        placeholder="Вставьте ссылку"
        className="w-full text-sm px-1 py-0.5 rounded border border-primary/40 bg-[var(--color-input-bg)] text-text-main focus:outline-none" />
    );
  }
  if (!value) {
    return (
      <button type="button" onClick={() => setEditing(true)} aria-label={`${label}: добавить ссылку`}
        className="text-xs text-text-muted/60 hover:text-primary px-1 py-0.5">+ ссылка</button>
    );
  }
  return (
    <span className="group/ln inline-flex items-center gap-1">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={href} aria-label={`${label}: открыть ${href}`}
          className="inline-flex p-1 rounded-md text-primary hover:bg-primary/10">
          <Globe className="w-4 h-4" />
        </a>
      ) : (
        <span title={`Не похоже на ссылку: ${value}`} className="inline-flex p-1 text-text-muted/50"><Globe className="w-4 h-4" /></span>
      )}
      <button type="button" onClick={() => setEditing(true)} aria-label={`${label}: изменить ссылку`} title="Изменить"
        className="p-0.5 rounded text-text-muted opacity-0 group-hover/ln:opacity-100 focus-visible:opacity-100 hover:text-text-main">
        <Pencil className="w-3 h-3" />
      </button>
    </span>
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
  const [pos, setPos] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const toggleOpen = () => setPos(p => !p);
  const pick = (o: string) => {
    if (multi) onChange(chosen.includes(o) ? chosen.filter(x => x !== o) : [...chosen, o]);
    else { onChange(chosen[0] === o ? "" : o); setPos(false); }
  };
  return (
    <>
      <button ref={btn} type="button" onClick={toggleOpen} aria-expanded={!!pos} aria-haspopup="listbox" aria-label={field.name}
        className="flex flex-wrap gap-1 min-h-[24px] w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main">
        {chosen.length ? chosen.map(x => <Tag key={x} field={field} value={x} />) : <span className="text-text-muted/50 text-sm">—</span>}
      </button>
      {pos && (
        <Floating anchor={btn} onClose={() => setPos(false)} width={224} role="listbox" ariaLabel={field.name} className="p-1">
          {field.options.map(o => (
            <button key={o} type="button" role="option" aria-selected={chosen.includes(o)} onClick={() => pick(o)}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-bg-subtle ${chosen.includes(o) ? "bg-primary/10" : ""}`}>
              {multi && <input type="checkbox" readOnly checked={chosen.includes(o)} tabIndex={-1} aria-hidden />}
              <Tag field={field} value={o} />
            </button>
          ))}
          {!multi && chosen.length > 0 && (
            <button type="button" onClick={() => { onChange(""); setPos(false); }}
              className="w-full text-left px-2 py-1 rounded text-sm text-text-muted hover:bg-bg-subtle">— снять</button>
          )}
        </Floating>
      )}
    </>
  );
}

export function OwnCell({ field, value, icon, onChange, onIcon }: {
  field: OwnField;
  value: string | string[] | undefined;
  /** Ярлычок ячейки — только у свободного ввода. */
  icon?: string;
  onChange: (v: string | string[]) => void;
  onIcon: (code: string | null) => void;
}) {
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
    case "link": return <LinkCell value={s} label={field.name} onChange={onChange} />;
    default: return <TextCell value={s} wrap={field.wrap} icon={icon} onChange={onChange} onIcon={onIcon} />;
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
      <select value={value} onChange={e => onChange(e.target.value)} aria-label="Тестировщик"
        className="min-w-0 flex-1 bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main focus:outline-none text-sm text-text-main truncate">
        <option value="">— не назначен</option>
        {/* Должность не дописываем: она уже в цветной метке слева. */}
        {participants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </span>
  );
}

/* ── Поля направлений (st): человек, состояние и план ─────────────────────── */

const ROLE_STATE_CLS: Record<RoleState, string> = {
  todo:  "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  doing: "bg-amber-300 text-amber-950 dark:bg-amber-500 dark:text-amber-950",
  done:  "bg-green-600 text-white dark:bg-green-600",
};

/**
 * Ячейка направления — три значения: состояние цветом (серый — не взят, жёлтый — в работе, зелёный — выполнен),
 * человек из справочника (люди этого направления; новое имя прямо здесь добавляет человека в справочник)
 * и план трудозатрат — он идёт в нагрузку направления.
 */
export function RoleCell({ label, dir, value, people, onChange, onAddPerson, onLeave }: {
  label: string;
  dir: string;
  value: RoleValue | undefined;
  people: Participant[];
  onChange: (patch: RoleValue) => void;
  /** Добавить человека в справочник с этим направлением; вернуть его. */
  onAddPerson: (name: string) => Participant;
  /** Убрать человека из направления в справочнике (в заполненных ячейках он останется). */
  onLeave: (pid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const state = value?.state ?? "todo";
  const members = people.filter(p => inDirection(p, dir));
  const current = value?.pid ? people.find(p => p.id === value.pid) : undefined;
  const shownName = current?.name ?? value?.name ?? "";
  const pick = (p: Participant) => { onChange({ ...value, pid: p.id, name: p.name }); setOpen(false); };
  const add = () => {
    const n = draft.trim();
    if (!n) return;
    const hit = members.find(p => p.name.trim().toLowerCase() === n.toLowerCase());
    pick(hit ?? onAddPerson(n));
    setDraft("");
  };

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
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="listbox" aria-label={`${label}: исполнитель`}
        className="min-w-0 flex-1 text-left truncate px-1 py-0.5 rounded border border-transparent hover:border-border-main text-sm">
        {shownName || <span className="text-text-muted/50">—</span>}
      </button>
      <span className="flex-shrink-0"><PlanCell compact value={value?.plan} onChange={m => onChange({ ...value, plan: m ?? undefined })} /></span>
      {open && (
        <Floating anchor={btn} onClose={() => setOpen(false)} width={240} role="listbox" ariaLabel={`${label}: люди`} className="p-1">
          <button type="button" role="option" aria-selected={!shownName} onClick={() => { onChange({ ...value, pid: undefined, name: "" }); setOpen(false); }}
            className="w-full text-left px-2 py-1 rounded text-sm text-text-muted hover:bg-bg-subtle">— не назначен</button>
          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {value?.name && !current && (
              <p className="px-2 py-1 text-xs text-text-muted" title="Имени нет в справочнике: выберите человека или добавьте его ниже">
                сейчас: {value.name} (нет в справочнике)</p>
            )}
            {members.map(p => (
              <div key={p.id} className={`group/rn flex items-center rounded ${current?.id === p.id ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                <button type="button" role="option" aria-selected={current?.id === p.id} onClick={() => pick(p)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 text-left px-2 py-1 text-sm text-text-main">
                  <RoleBadge participant={p} /><span className="truncate">{p.name}</span></button>
                <button type="button" onClick={() => onLeave(p.id)} aria-label={`Убрать ${p.name} из направления ${label}`}
                  title="Убрать из направления в справочнике (в уже заполненных ячейках останется)"
                  className="p-1 mr-0.5 rounded text-text-muted opacity-0 group-hover/rn:opacity-100 focus-visible:opacity-100 hover:text-red-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 border-t border-border-main mt-1 pt-1">
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="Новый человек, Enter"
              onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") setOpen(false); }} aria-label={`Добавить человека в ${label}`}
              className="min-w-0 flex-1 text-sm px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <button type="button" onClick={add} disabled={!draft.trim()} aria-label="Добавить человека"
              className="p-1.5 rounded bg-primary text-white disabled:opacity-40"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </Floating>
      )}
    </span>
  );
}

/* ── Требования (st): документы из раздела «Данные» ─────────────────────── */

export interface ReqOption { id: string; name: string; feature?: string }

/** Адрес требования в SimpleTest: раздел «Данные» сам раскроет его и прокрутит к нему. */
export const reqDocHref = (id: string) => `/etalons?req=${encodeURIComponent(id)}`;

/**
 * Требования задачи — двойное поле: документы из «Данных» и ссылка на исходник (Confluence, Figma…).
 * Можно только документы, только ссылку или всё вместе. Документ и значок исходника открываются
 * в новой вкладке; карандаш (и пустая ячейка) — редактирование: ссылка сверху, документы с галочками ниже.
 * Окно поверх таблицы (fixed): внутри ячейки его обрезала бы прокрутка; при прокрутке таблицы закрывается.
 */
export function ReqCell({ value, url, options, onChange, onUrl }: {
  value: string[];
  url: string;
  options: ReqOption[];
  onChange: (ids: string[]) => void;
  onUrl: (url: string) => void;
}) {
  const [pos, setPos] = useState(false);
  const [q, setQ] = useState("");
  const [draftUrl, setDraftUrl] = useState(url);
  const anchor = useRef<HTMLSpanElement>(null);
  const saveUrl = () => { if (draftUrl.trim() !== url) onUrl(draftUrl.trim()); };
  const close = () => { saveUrl(); setPos(false); };
  const open = () => {
    if (pos) { close(); return; }
    setQ(""); setDraftUrl(url); setPos(true);
  };

  const byId = new Map(options.map(o => [o.id, o]));
  const s = q.trim().toLowerCase();
  const shown = options.filter(o => !s || o.name.toLowerCase().includes(s) || (o.feature ?? "").toLowerCase().includes(s));
  const href = linkHref(url);
  const draftHref = linkHref(draftUrl);
  const empty = !value.length && !url;

  return (
    <>
      <span ref={anchor} className="group/rq flex items-start gap-1 min-h-[24px] w-full px-1 py-0.5">
        {empty ? (
          <button type="button" onClick={open} aria-expanded={!!pos} aria-label="Требования (st): добавить документ или ссылку"
            className="flex-1 text-left text-text-muted/50 text-sm hover:text-primary">—</button>
        ) : (
          <span className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
            {value.map(id => {
              const doc = byId.get(id);
              return doc ? (
                <a key={id} href={reqDocHref(id)} target="_blank" rel="noopener" title={`${doc.name} — открыть в SimpleTest`}
                  className="max-w-full truncate px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] hover:bg-primary/20 hover:underline">
                  {doc.name}
                </a>
              ) : (
                <span key={id} title="Документ удалён из «Данных»" className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted text-[11px] line-through">удалён</span>
              );
            })}
            {url && (href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" title={`Исходник требований: ${href}`} aria-label={`Открыть исходник требований ${href}`}
                className="inline-flex p-0.5 rounded-md text-primary hover:bg-primary/10"><Globe className="w-4 h-4" /></a>
            ) : (
              <span title={`Не похоже на ссылку: ${url}`} className="inline-flex p-0.5 text-text-muted/50"><Globe className="w-4 h-4" /></span>
            ))}
          </span>
        )}
        {!empty && (
          <button type="button" onClick={open} aria-expanded={!!pos} aria-label="Требования (st): изменить" title="Изменить требования"
            className={`p-0.5 rounded text-text-muted hover:text-text-main focus-visible:opacity-100 ${pos ? "opacity-100" : "opacity-0 group-hover/rq:opacity-100 group-hover/row:opacity-100"}`}>
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </span>
      {pos && (
        <Floating anchor={anchor} onClose={close} width={300} className="p-1.5 space-y-1.5">
          <div>
            <p className="px-0.5 pb-1 text-[11px] font-semibold text-text-muted">Исходник — ссылка</p>
            <label className="flex items-center gap-1.5 px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30">
              <Globe className={`w-3.5 h-3.5 flex-shrink-0 ${draftHref ? "text-primary" : "text-text-muted"}`} />
              <input value={draftUrl} onChange={e => setDraftUrl(e.target.value)} onBlur={saveUrl}
                onKeyDown={e => { if (e.key === "Enter") { saveUrl(); setPos(false); } }}
                placeholder="Confluence, Figma, Google Docs…" aria-label="Ссылка на исходник требований"
                className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
              {draftUrl && (
                <button type="button" onClick={() => { setDraftUrl(""); onUrl(""); }} aria-label="Убрать ссылку" className="text-text-muted hover:text-red-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </label>
            {draftUrl.trim() && !draftHref && <p className="px-0.5 pt-0.5 text-[10px] text-amber-600 dark:text-amber-400">Не похоже на ссылку</p>}
          </div>
          <div className="border-t border-border-main pt-1.5">
            <p className="px-0.5 pb-1 text-[11px] font-semibold text-text-muted">Документы из «Данных»</p>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти требование" aria-label="Найти требование"
              className="w-full mb-1 text-sm px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <div role="listbox" aria-multiselectable aria-label="Требования" className="max-h-56 overflow-y-auto scrollbar-thin">
              {options.length === 0 && <p className="px-2 py-1.5 text-xs text-text-muted">В разделе «Данные» пока нет требований.</p>}
              {options.length > 0 && shown.length === 0 && <p className="px-2 py-1.5 text-xs text-text-muted">Ничего не нашлось.</p>}
              {shown.map(o => {
                const on = value.includes(o.id);
                return (
                  <button key={o.id} type="button" role="option" aria-selected={on}
                    onClick={() => onChange(on ? value.filter(x => x !== o.id) : [...value, o.id])}
                    className={`w-full flex items-start gap-2 px-2 py-1 rounded text-left hover:bg-bg-subtle ${on ? "bg-primary/10" : ""}`}>
                    <input type="checkbox" readOnly checked={on} tabIndex={-1} aria-hidden className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm text-text-main truncate">{o.name}</span>
                      {o.feature && <span className="block text-[10px] text-text-muted truncate">{o.feature}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Floating>
      )}
    </>
  );
}

/* ── Нагрузка (st): учитывать ли задачу ─────────────────────────────────── */

/**
 * Галочка «учитывать в нагрузке». Снята вручную — «вручную»; задача в «Готово к релизу» и дальше
 * не учитывается сама (правило списка) — галочка недоступна, подсказка объясняет почему.
 */
export function LoadCell({ skip, stage, onChange }: { skip: LoadSkip; stage: string; onChange: (skip: boolean) => void }) {
  const auto = skip === "stage";
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${auto ? "cursor-not-allowed" : "cursor-pointer"}`}
      title={auto ? `Статус (st) «${stage}» — в нагрузке не учитывается автоматически. Правило выключается в блоке «Нагрузка по списку».`
        : skip === "manual" ? "Исключена из нагрузки вручную — отметьте, чтобы снова учитывать" : "Учитывается в нагрузке — снимите, чтобы исключить"}>
      <input type="checkbox" checked={!skip} disabled={auto} onChange={e => onChange(!e.target.checked)} />
      <span className={skip ? "text-text-muted" : "text-text-main"}>{auto ? "нет · по статусу" : skip ? "нет · вручную" : "да"}</span>
    </label>
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
export function PlanCell({ value, onChange, compact }: { value: number | undefined; onChange: (min: number | null) => void; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState<"h" | "m" | "d">("h");
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  /** Esc: окно закрывается тем же «закрыть», что и щелчок мимо, — но без сохранения. */
  const cancelled = useRef(false);

  const toText = (min: number | undefined, u: "h" | "m" | "d") =>
    min == null ? "" : u === "m" ? String(min) : u === "d" ? String(Math.round((min / getTimeDay()) * 100) / 100)
      : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

  const open = () => {
    let u: "h" | "m" | "d" = "h";
    try { const x = localStorage.getItem(UNIT_KEY); u = x === "m" || x === "d" ? x : "h"; } catch { /* по умолчанию часы */ }
    cancelled.current = false;
    setUnit(u); setDraft(toText(value, u)); setEditing(true);
  };
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const parsed = parseDuration(draft, unit);
  const switchUnit = (u: "h" | "m" | "d") => {
    if (u === unit) return;
    setDraft(parsed == null ? draft : toText(parsed, u));
    setUnit(u);
    try { localStorage.setItem(UNIT_KEY, u); } catch { /* не запомнится */ }
    ref.current?.focus();
  };
  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    if (!draft.trim()) { if (value != null) onChange(null); return; }
    if (parsed != null && parsed !== value) onChange(parsed);
  };
  const cancel = () => { cancelled.current = true; setEditing(false); };

  const editor = (
    <>
      <div className="flex items-center gap-1">
        <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)} inputMode="decimal"
          onFocus={e => e.currentTarget.select()}   // старое значение выделено — ввод его заменяет, а не дописывается
          placeholder={unit === "h" ? "1.5 или 1:30" : unit === "d" ? "1.5 или 1 д 2 ч" : "90"} aria-label="Траты план"
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
          className={`min-w-0 flex-1 bg-[var(--color-input-bg)] px-1 py-0.5 rounded border text-sm text-text-main focus:outline-none
            ${draft.trim() && parsed == null ? "border-red-400" : "border-primary/40"}`} />
        <span className="flex rounded border border-border-main overflow-hidden text-[10px] font-semibold flex-shrink-0" role="radiogroup" aria-label="Единица">
          {(["d", "h", "m"] as const).map(u => (
            <button key={u} type="button" role="radio" aria-checked={unit === u} onMouseDown={e => e.preventDefault()} onClick={() => switchUnit(u)}
              className={`px-1.5 py-0.5 ${unit === u ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}>
              {u === "d" ? "д" : u === "h" ? "ч" : "мин"}
            </button>
          ))}
        </span>
      </div>
      <p className="text-[10px] text-text-muted">{draft.trim() ? (parsed == null ? "не понял — пример: 1.5, 1:30, 90, 1 д 2 ч" : `= ${fmtMinutes(parsed)}`) : "пусто — убрать план"}</p>
    </>
  );

  // В ячейке «Тестировщик» и в полях направлений план — рядом с именем: показывается целиком (сжимается имя),
  // а ввод открывается окном поверх таблицы — в узкой ячейке вводимое не было видно.
  if (compact) {
    return (
      <>
        <button ref={btn} type="button" onClick={() => (editing ? commit() : open())} title="Нажмите, чтобы указать план трудозатрат"
          aria-expanded={editing}
          className={`text-left px-1 py-0.5 rounded border whitespace-nowrap text-xs tabular-nums
            ${editing ? "border-primary/40" : "border-transparent hover:border-border-main"} ${value != null ? "text-text-main" : "text-text-muted/50"}`}>
          {value != null ? fmtMinutes(value) : "план"}
        </button>
        {editing && (
          <Floating anchor={btn} onClose={commit} width={220} ariaLabel="Траты план" className="p-2 space-y-1">
            {editor}
          </Floating>
        )}
      </>
    );
  }
  if (!editing) {
    return (
      <button type="button" onClick={open} title="Нажмите, чтобы указать план трудозатрат"
        className={`w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main whitespace-nowrap text-sm
          ${value != null ? "text-text-main" : "text-text-muted/50"}`}>
        {value != null ? fmtMinutes(value) : "—"}
      </button>
    );
  }
  return (
    <div className="space-y-0.5" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(); }}>
      {editor}
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
export function FactCell({ spend, weekends }: { spend: Spend | undefined; weekends?: boolean }) {
  const f = factMinutes(spend, weekends);
  if (f == null) {
    return <span className="text-text-muted/50 text-sm" title="Заполните «Начало теста» и «Конец теста»">—</span>;
  }
  if (f < 0) return <span className="text-xs text-red-600 dark:text-red-400" title="Конец теста раньше начала">конец раньше начала</span>;
  const over = spend?.plan != null && f > spend.plan;
  return (
    <span className={`text-sm whitespace-nowrap ${over ? "text-amber-700 dark:text-amber-300 font-medium" : "text-text-main"}`}
      title={`${spend?.plan != null ? `План ${fmtMinutes(spend.plan)}${over ? ` — превышен на ${fmtMinutes(f - spend.plan)}` : ""}. ` : ""}Считается ${WORK_HINT}${weekends ? ", выходные тоже (переработка)" : ""}`}>
      {fmtMinutes(f)}
    </span>
  );
}
