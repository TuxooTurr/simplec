"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, GripVertical, X } from "lucide-react";
import {
  BLOCK_COL, DEFECTS_COL, FIELD_BY_ID, FOLDER_COL, PARTICIPANT_COL, STAGE_COL, blockersOf, colLabel, colValues, groupIssues,
  isOpenDefect, isWritableGroupRef, orderIndex, type GroupLevel,
  type ColCtx, type ColRef, type GroupNode, type Issue, type OwnField, type Participant,
} from "@/lib/jiraTool";
import { STAGE_CLS, STAGE_LABEL, type StageInfo } from "@/lib/jiraStages";

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

export type SortState = { col: ColRef; dir: 1 | -1 } | null;
export type Place = "before" | "after";
export type GroupChange = { ref: ColRef; from: string; to: string };

function sortKey(ref: ColRef, issue: Issue, ctx: ColCtx): string {
  const v = colValues(ref, issue, ctx);
  if (ref === DEFECTS_COL) return v.length ? v[0].padStart(5, "0") : "\uffff";
  const idx = orderIndex(ref, v[0] ?? "");
  if (idx !== -1 || ref === "jira:status" || ref === "jira:priority" || ref === STAGE_COL) return String(idx + 10).padStart(4, "0");
  return (v.join(", ") || "￿").toLowerCase();
}

export function sortIssues(issues: Issue[], sort: SortState, ctx: ColCtx): Issue[] {
  if (!sort) return issues;
  return [...issues].sort((a, b) =>
    sortKey(sort.col, a, ctx).localeCompare(sortKey(sort.col, b, ctx), "ru", { numeric: true }) * sort.dir);
}

/* ── Ячейки ────────────────────────────────────────────────────────────── */

function JiraCell({ id, issue }: { id: string; issue: Issue }) {
  const v = issue.fields[id];
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return <span className="text-text-muted/50">—</span>;
  if (id === "status") return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${STATUS_CLS[String(v)] ?? "bg-bg-subtle text-text-main"}`}>{String(v)}</span>;
  if (id === "priority") return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`w-2 h-2 rounded-full ${PRIO_DOT[String(v)] ?? "bg-slate-400"}`} />{String(v)}</span>;
  if (id === "issuetype" && v === "Epic") return <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 text-[11px] font-semibold">Epic</span>;
  if (Array.isArray(v)) return (
    <span className="flex flex-wrap gap-1">{v.map(x => <span key={x} className="px-1.5 py-0.5 rounded bg-bg-subtle text-[11px] whitespace-nowrap">{x}</span>)}</span>
  );
  if (id === "summary") return <span className="block min-w-[260px] max-w-[460px]">{String(v)}</span>;
  if (FIELD_BY_ID[id]?.kind === "longtext") return <span className="block min-w-[220px] line-clamp-2 text-text-muted">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

/**
 * Сумма неустранённых дефектов задачи (всё, кроме «Подтверждено исправление» и «Закрыт»);
 * по клику — окно со списком. У самих дефектов поля нет.
 */
function DefectsCell({ defects, onOpen }: { defects: Issue[] | null; onOpen: () => void }) {
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
function BlockCell({ defects, onOpen }: { defects: Issue[] | null; onOpen: () => void }) {
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

export function StageCell({ info }: { info: StageInfo }) {
  switch (info.kind) {
    case "stage":
      return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${STAGE_CLS[info.stage]}`}>{STAGE_LABEL[info.stage]}</span>;
    case "epic":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={`Статус (st) по сторям эпика: ${info.behind} из ${info.total} — «${STAGE_LABEL[info.stage]}»`
            + (info.unmapped ? `; не сопоставлено: ${info.unmapped}` : "")}>
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${STAGE_CLS[info.stage]}`}>{STAGE_LABEL[info.stage]}</span>
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

function TextCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => draft !== value && onChange(draft)}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(value); }}
      placeholder="—" className="w-full min-w-[120px] bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main
        focus:border-primary/40 focus:outline-none focus:bg-[var(--color-input-bg)] text-sm" />
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
        className="flex flex-wrap gap-1 min-h-[24px] min-w-[120px] w-full text-left px-1 py-0.5 rounded border border-transparent hover:border-border-main">
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

function OwnCell({ field, value, onChange }: { field: OwnField; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const cls = "bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main focus:border-primary/40 " +
    "focus:outline-none focus:bg-[var(--color-input-bg)] text-sm text-text-main";
  const s = typeof value === "string" ? value : "";
  switch (field.type) {
    case "date": return <input type="date" value={s} onChange={e => onChange(e.target.value)} aria-label={field.name} className={cls} />;
    case "datetime": return <input type="datetime-local" value={s} onChange={e => onChange(e.target.value)} aria-label={field.name} className={cls} />;
    case "select": return (
      <select value={s} onChange={e => onChange(e.target.value)} aria-label={field.name} className={`${cls} min-w-[110px]`}>
        <option value="">—</option>
        {field.options.map(o => <option key={o}>{o}</option>)}
      </select>
    );
    case "multiselect": return <MultiCell field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    default: return <TextCell value={s} onChange={onChange} />;
  }
}

function ParticipantCell({ value, participants, onChange }: { value: string; participants: Participant[]; onChange: (id: string) => void }) {
  const p = participants.find(x => x.id === value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p?.color ?? "transparent", border: p ? "none" : "1px dashed #94a3b8" }} />
      <select value={value} onChange={e => onChange(e.target.value)} aria-label="Участник"
        className="bg-transparent px-1 py-0.5 rounded border border-transparent hover:border-border-main focus:outline-none text-sm text-text-main min-w-[130px]">
        <option value="">— не назначен</option>
        {participants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </span>
  );
}

/* ── Таблица ───────────────────────────────────────────────────────────── */

export default function ListTable({
  ctx, issues, sort, onSort, selected, onSelect, onValue, onParticipant, onRemove, onOpenDefects, onMoveRow, onMoveColumn, onMoveToGroup,
}: {
  ctx: ColCtx;
  issues: Issue[];
  sort: SortState;
  onSort: (s: SortState) => void;
  selected: Set<string>;
  onSelect: (keys: string[], on: boolean) => void;
  onValue: (key: string, fieldId: string, v: string | string[]) => void;
  onParticipant: (key: string, id: string) => void;
  onRemove: (key: string) => void;
  onOpenDefects: (issue: Issue) => void;
  /** Ручной порядок строк: переставить key перед/после target. */
  onMoveRow: (key: string, target: string, place: Place) => void;
  /** Порядок колонок: переставить col перед/после target. */
  onMoveColumn: (col: ColRef, target: ColRef, place: Place) => void;
  /** Перенос в другую группу по полю SimpleTest: записать значения и (если есть target) встать рядом с ним. */
  onMoveToGroup: (key: string, changes: GroupChange[], target: string | null, place: Place) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { list, participants } = ctx;
  const cols = list.columns;
  const ownById = Object.fromEntries(list.ownFields.map(f => [f.id, f]));
  const width = cols.length + 3;
  const allOn = issues.length > 0 && issues.every(i => selected.has(i.key));

  /* ── Перетаскивание ───────────────────────────────────────────────────
     Строки тянутся только за ручку (иначе мешали бы вводу в своих полях).
     Внутри группы — меняется порядок. В другую группу — только если все отличающиеся
     уровни — записываемые поля SimpleTest (участник, папка, свои поля): у задачи
     меняется значение. Поля Jira и вычисляемые (st) переносом не меняются.
     При сортировке по колонке ручной порядок не виден — перетаскивание выключено. */
  const rowsMovable = !sort;
  const [armed, setArmed] = useState<string | null>(null);          // «row|path», за ручку которой взялись
  const [dragRow, setDragRow] = useState<{ key: string; path: string } | null>(null);
  // То же в ref: dragover приходит раньше, чем React успевает обновить состояние.
  const dragRef = useRef<{ key: string; path: string; levels: GroupLevel[] } | null>(null);
  const [overRow, setOverRow] = useState<{ key: string; path: string; place: Place } | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);

  /** Можно ли бросить в группу с уровнями dst и какие поля при этом изменятся. */
  const dropPlan = (dstPath: string, dst: GroupLevel[]): GroupChange[] | null => {
    const src = dragRef.current;
    if (!src) return null;
    if (src.path === dstPath) return [];
    const changes: GroupChange[] = [];
    for (let i = 0; i < dst.length; i++) {
      const from = src.levels[i]?.label, to = dst[i].label;
      if (from === to) continue;
      if (!isWritableGroupRef(dst[i].ref, list)) return null;
      changes.push({ ref: dst[i].ref, from: from ?? "", to });
    }
    return changes;
  };
  const [dragCol, setDragCol] = useState<ColRef | null>(null);
  const [overCol, setOverCol] = useState<{ col: ColRef; place: Place } | null>(null);

  const placeY = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "before" : "after";
  };
  const placeX = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "before" : "after";
  };
  /**
   * Запрет переноса. Раскладка приложения разрешает бросать что угодно (так в правую панель
   * переносят разделы), поэтому без stopPropagation курсор показывал бы «можно» там, где нельзя.
   */
  const refuse = (e: React.DragEvent) => {
    if (!dragRef.current && !dragCol) return;
    e.stopPropagation();
    if (e.defaultPrevented) return;                                 // строка уже разрешила перенос
    e.dataTransfer.dropEffect = "none";
  };
  const endRowDrag = () => { dragRef.current = null; setDragRow(null); setOverRow(null); setOverGroup(null); setArmed(null); };
  const endColDrag = () => { setDragCol(null); setOverCol(null); };

  const toggle = (path: string) => setCollapsed(c => { const n = new Set(c); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const clickSort = (col: ColRef) =>
    onSort(sort?.col !== col ? { col, dir: 1 } : sort.dir === 1 ? { col, dir: -1 } : null);

  const row = (issue: Issue, depth: number, path: string, levels: GroupLevel[], prev?: string, next?: string) => {
    const on = selected.has(issue.key);
    const id = `${issue.key}|${path}`;
    const over = overRow?.key === issue.key && overRow.path === path && dragRow && !(dragRow.key === issue.key && dragRow.path === path)
      ? overRow.place : null;
    return (
      <tr key={id} draggable={armed === id}
        onDragStart={e => {
          e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", issue.key);
          dragRef.current = { key: issue.key, path, levels };
          setDragRow({ key: issue.key, path });
        }}
        onDragOver={e => {
          if (dropPlan(path, levels) === null) return refuse(e);    // нельзя: меняется поле Jira или вычисляемое
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const place = placeY(e);
          if (overRow?.key !== issue.key || overRow.path !== path || overRow.place !== place) setOverRow({ key: issue.key, path, place });
        }}
        onDrop={e => {
          e.preventDefault();
          const src = dragRef.current, plan = dropPlan(path, levels);
          if (src && plan) {
            if (plan.length) onMoveToGroup(src.key, plan, issue.key === src.key ? null : issue.key, placeY(e));
            else if (src.key !== issue.key) onMoveRow(src.key, issue.key, placeY(e));
          }
          endRowDrag();
        }}
        onDragEnd={endRowDrag}
        className={`group/row border-t border-border-main ${on ? "bg-primary/5" : "hover:bg-bg-subtle/60"}
          ${dragRow?.key === issue.key && dragRow.path === path ? "opacity-40" : ""}
          ${over === "before" ? "shadow-[inset_0_2px_0_0_var(--color-primary,#6366f1)]" : ""}
          ${over === "after" ? "shadow-[inset_0_-2px_0_0_var(--color-primary,#6366f1)]" : ""}`}>
        <td className="pl-1 pr-1 py-1.5 align-top w-10 whitespace-nowrap">
          <button type="button" aria-label={`Переместить ${issue.key}`} disabled={!rowsMovable}
            title={rowsMovable ? "Перетащите, чтобы поменять порядок (или ↑/↓)" : "Сбросьте сортировку по колонке, чтобы менять порядок вручную"}
            onMouseDown={() => rowsMovable && setArmed(id)} onMouseUp={() => setArmed(null)}
            onKeyDown={e => {
              if (!rowsMovable) return;
              if (e.key === "ArrowUp" && prev) { e.preventDefault(); onMoveRow(issue.key, prev, "before"); }
              if (e.key === "ArrowDown" && next) { e.preventDefault(); onMoveRow(issue.key, next, "after"); }
            }}
            className={`inline-flex align-middle p-0.5 rounded text-text-muted opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100
              ${rowsMovable ? "cursor-grab active:cursor-grabbing hover:text-text-main" : "cursor-not-allowed"}`}>
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <input type="checkbox" checked={on} onChange={() => onSelect([issue.key], !on)} aria-label={`Выбрать ${issue.key}`}
            className="align-middle ml-0.5" />
        </td>
        <td className="px-3 py-1.5 whitespace-nowrap align-top" style={{ paddingLeft: 12 + depth * 18 }}>
          <span className="font-mono text-xs text-primary">{issue.key}</span>
          {issue.local && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">новый</span>}
        </td>
        {cols.map(c => (
          <td key={c} className="px-3 py-1.5 align-top text-sm text-text-main">
            {c === PARTICIPANT_COL ? (
              <ParticipantCell value={list.assignees[issue.key] ?? ""} participants={participants} onChange={id => onParticipant(issue.key, id)} />
            ) : c === STAGE_COL ? (
              <StageCell info={ctx.stageOf(issue)} />
            ) : c === DEFECTS_COL ? (
              <DefectsCell defects={ctx.defectsOf(issue)} onOpen={() => onOpenDefects(issue)} />
            ) : c === BLOCK_COL ? (
              <BlockCell defects={ctx.defectsOf(issue)} onOpen={() => onOpenDefects(issue)} />
            ) : c === FOLDER_COL ? (
              <span className="text-xs text-text-muted whitespace-nowrap">{list.folders?.[issue.key] ?? "—"}</span>
            ) : c.startsWith("jira:") ? (
              <JiraCell id={c.slice(5)} issue={issue} />
            ) : ownById[c.slice(4)] ? (
              <OwnCell field={ownById[c.slice(4)]} value={list.values[issue.key]?.[c.slice(4)]}
                onChange={v => onValue(issue.key, c.slice(4), v)} />
            ) : <span className="text-text-muted/50">—</span>}
          </td>
        ))}
        <td className="px-2 py-1.5 align-top w-8">
          <button type="button" onClick={() => onRemove(issue.key)} aria-label={`Убрать ${issue.key} из списка`} title="Убрать из списка"
            className="p-1 rounded text-text-muted opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    );
  };

  const group = (node: GroupNode, depth: number, parent: GroupLevel[] = []): React.ReactNode => {
    const shut = collapsed.has(node.path);
    const keys = node.issues.map(i => i.key);
    const groupOn = keys.length > 0 && keys.every(k => selected.has(k));
    const levels = [...parent, { ref: node.ref, label: node.label }];
    // На заголовок можно бросить, только если группа конечная (без подгрупп) — тогда понятно, куда класть.
    const leaf = !node.children.length;
    return (
      <Fragment key={node.path}>
        <tr className={`border-t border-border-main bg-bg-subtle/70 ${overGroup === node.path ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`}
          onDragOver={e => {
            if (!leaf) return refuse(e);
            const plan = dropPlan(node.path, levels);
            if (!plan || !plan.length) return refuse(e);
            e.preventDefault();
            if (overGroup !== node.path) setOverGroup(node.path);
          }}
          onDragLeave={() => overGroup === node.path && setOverGroup(null)}
          onDrop={e => {
            e.preventDefault();
            const src = dragRef.current, plan = leaf ? dropPlan(node.path, levels) : null;
            if (src && plan?.length) onMoveToGroup(src.key, plan, null, "after");
            endRowDrag();
          }}>
          <td className="pl-1 pr-1 py-1.5 w-10">
            <span className="inline-block w-[18px]" />
            <input type="checkbox" checked={groupOn} onChange={() => onSelect(keys, !groupOn)} aria-label={`Выбрать группу ${node.label}`}
              className="align-middle ml-0.5" />
          </td>
          <td colSpan={width - 1} className="py-1.5" style={{ paddingLeft: 8 + depth * 18 }}>
            <button type="button" onClick={() => toggle(node.path)} aria-expanded={!shut}
              className="flex items-center gap-1.5 text-sm text-text-main">
              <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${shut ? "" : "rotate-90"}`} />
              <span className="text-[11px] text-text-muted">{node.field}:</span>
              <span className={`font-semibold ${node.ref === STAGE_COL && node.label === "Нет сторей" ? "text-red-600 dark:text-red-400" : ""}`}>{node.label}</span>
              <span className="text-[11px] px-1.5 rounded-full bg-bg-card border border-border-main text-text-muted">{node.issues.length}</span>
            </button>
          </td>
        </tr>
        {!shut && (node.children.length
          ? node.children.map(ch => group(ch, depth + 1, levels))
          : node.issues.length === 0
            ? <tr className="border-t border-border-main"><td colSpan={width} className="py-1.5 text-[11px] text-text-muted/70"
                style={{ paddingLeft: 40 + depth * 18 }}>пусто — перетащите сюда задачу</td></tr>
            : sortIssues(node.issues, sort, ctx).map((i, n, arr) => row(i, depth + 1, node.path, levels, arr[n - 1]?.key, arr[n + 1]?.key)))}
      </Fragment>
    );
  };

  const groups = list.groupBy.length ? groupIssues(issues, list.groupBy, ctx) : null;

  return (
    <div className="border border-border-main rounded-xl overflow-auto scrollbar-thin bg-bg-card" onDragOver={refuse}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="text-left">
            <th className="pl-1 pr-1 py-2 w-10 text-left">
              <span className="inline-block w-[18px]" />
              <input type="checkbox" checked={allOn} onChange={() => onSelect(issues.map(i => i.key), !allOn)} aria-label="Выбрать все задачи"
                className="align-middle ml-0.5" />
            </th>
            <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">Ключ</th>
            {cols.map((c, n) => {
              const over = overCol?.col === c && dragCol && dragCol !== c ? overCol.place : null;
              return (
                <th key={c} draggable
                  onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c); setDragCol(c); }}
                  onDragOver={e => {
                    if (!dragCol) return refuse(e);
                    e.preventDefault();
                    const place = placeX(e);
                    if (overCol?.col !== c || overCol.place !== place) setOverCol({ col: c, place });
                  }}
                  onDrop={e => { e.preventDefault(); if (dragCol && dragCol !== c) onMoveColumn(dragCol, c, placeX(e)); endColDrag(); }}
                  onDragEnd={endColDrag}
                  title="Перетащите заголовок, чтобы поменять порядок колонок"
                  className={`group/th px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap cursor-grab
                    active:cursor-grabbing ${dragCol === c ? "opacity-40" : ""}
                    ${over === "before" ? "shadow-[inset_2px_0_0_0_var(--color-primary,#6366f1)]" : ""}
                    ${over === "after" ? "shadow-[inset_-2px_0_0_0_var(--color-primary,#6366f1)]" : ""}`}>
                  <span className="inline-flex items-center gap-0.5">
                    <GripVertical className="w-3 h-3 -ml-2 opacity-0 group-hover/th:opacity-60" />
                    <button type="button" onClick={() => clickSort(c)}
                      onKeyDown={e => {
                        // Alt+←/→ — переставить колонку с клавиатуры.
                        if (!e.altKey) return;
                        if (e.key === "ArrowLeft" && n > 0) { e.preventDefault(); onMoveColumn(c, cols[n - 1], "before"); }
                        if (e.key === "ArrowRight" && n < cols.length - 1) { e.preventDefault(); onMoveColumn(c, cols[n + 1], "after"); }
                      }}
                      className="inline-flex items-center gap-1 hover:text-text-main uppercase">
                      {colLabel(c, list)}
                      {sort?.col === c && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </span>
                </th>
              );
            })}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {groups ? groups.map(g => group(g, 0))
            : sortIssues(issues, sort, ctx).map((i, n, arr) => row(i, 0, "root", [], arr[n - 1]?.key, arr[n + 1]?.key))}
        </tbody>
      </table>
    </div>
  );
}
