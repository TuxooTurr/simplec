"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Folder, GripVertical, MoreHorizontal, Pencil, Pin, PinOff, Trash2, WrapText, X } from "lucide-react";
import {
  BLOCK_COL, DEFECTS_COL, EMPTY_GROUP, END_COL, FACT_COL, PLAN_COL, START_COL, factMinutes, fmtJiraDate, fmtMinutes, jiraDateKind, FIELD_BY_ID, FOLDER_COL, NO_FOLDER, PARTICIPANT_COL, STAGE_COL, colLabel, colValues, folderSections,
  LOAD_COL, REQ_COL, categoryOf, groupIssues, isRoleCol, loadSkip, isWritableGroupRef, orderIndex,
  type ColCtx, type ColRef, type GroupLevel, type GroupNode, type Issue,
} from "@/lib/jiraTool";
import { stageText, type Stage } from "@/lib/jiraStages";
import type { ReqOption } from "./ListCells";
import { BlockCell, DefectsCell, FactCell, JiraCell, OwnCell, ParticipantCell, LoadCell, PlanCell, ReqCell, RoleCell, SpendDateCell, StageCell, Tag } from "./ListCells";

export type SortState = { col: ColRef; dir: 1 | -1 } | null;
export type Place = "before" | "after";
export type GroupChange = { ref: ColRef; from: string; to: string };

function sortKey(ref: ColRef, issue: Issue, ctx: ColCtx): string {
  const v = colValues(ref, issue, ctx);
  if (ref === DEFECTS_COL) return v.length ? v[0].padStart(5, "0") : "￿";
  const idx = orderIndex(ref, v[0] ?? "");
  if (idx !== -1 || ref === "jira:status" || ref === "jira:priority" || ref === STAGE_COL) return String(idx + 10).padStart(4, "0");
  return (v.join(", ") || "￿").toLowerCase();
}

export function sortIssues(issues: Issue[], sort: SortState, ctx: ColCtx): Issue[] {
  if (!sort) return issues;
  return [...issues].sort((a, b) =>
    sortKey(sort.col, a, ctx).localeCompare(sortKey(sort.col, b, ctx), "ru", { numeric: true }) * sort.dir);
}

/* ── Ширина колонок ──────────────────────────────────────────────────────── */

const SELECT_W = 56, REMOVE_W = 36, MIN_W = 60, INDENT = 12;

/** Ширина по умолчанию — по смыслу колонки; пользователь растягивает её за край заголовка. */
export function defaultWidth(ref: ColRef, ctx: ColCtx): number {
  if (ref === "jira:summary") return 360;
  if (ref === STAGE_COL) return 180;
  if (ref === DEFECTS_COL) return 110;
  if (ref === BLOCK_COL) return 90;
  if (ref === PARTICIPANT_COL) return 220;
  if (ref === FOLDER_COL) return 180;
  if (ref === PLAN_COL || ref === FACT_COL) return 140;
  if (ref === START_COL || ref === END_COL) return 200;
  if (isRoleCol(ref)) return 170;
  if (ref === LOAD_COL) return 150;
  if (ref === REQ_COL) return 220;
  if (ref.startsWith("own:")) {
    const t = ctx.list.ownFields.find(f => f.id === ref.slice(4))?.type;
    return t === "link" ? 90 : t === "datetime" ? 200 : t === "date" ? 150 : t === "multiselect" ? 190 : 170;
  }
  const kind = FIELD_BY_ID[ref.slice(5)]?.kind;
  if (kind === "longtext") return 260;
  if (ref === "jira:status") return 180;
  if (ref === "jira:issuetype") return 120;
  return 150;
}

/* ── Таблица ───────────────────────────────────────────────────────────── */

/** Куда ведёт перенос строки: в другую папку, в другую группу (со сменой полей) или просто порядок. */
type DropPlan = { kind: "folder"; folder: string | null } | { kind: "group"; changes: GroupChange[] };

/** Папка строки: undefined — в списке нет папок; null — «Без папки». */
type FolderKey = string | null | undefined;

export default function ListTable({
  ctx, issues, sort, onSort, selecting, onToggleSelecting, selected, onSelect, onValue, onIcon, stageManual, onStageManual, onParticipant, onRemove, onOpenDefects, onOpenIssue,
  onMoveRow, onMoveColumn, onMoveToGroup, onMoveToFolder, onResizeColumn, onRenameFolder, onDeleteFolder, onMoveFolder, onToggleWrap,
  onOpenDraft, onSpend, onTogglePin, onOpenStage, roleNames, onRole, onRoleNames, onNoLoad, reqLinks, reqOptions, onReqs, onClearMark,
}: {
  ctx: ColCtx;
  issues: Issue[];
  sort: SortState;
  onSort: (s: SortState) => void;
  /**
   * Режим выбора: чекбоксы видны только в нём (кнопка с карандашом в заголовке).
   * Вне режима у строки только ручка перетаскивания — чекбокс рядом с ней мешал схватить строку.
   */
  selecting: boolean;
  onToggleSelecting: () => void;
  selected: Set<string>;
  onSelect: (keys: string[], on: boolean) => void;
  onValue: (key: string, fieldId: string, v: string | string[]) => void;
  /** Статусы (st), поставленные руками: ключ → этап. */
  stageManual: Record<string, Stage>;
  /** Поставить статус (st) руками; null — вернуть расчёт по Jira. */
  onStageManual: (key: string, stage: Stage | null) => void;
  /** Ярлычок ячейки своего текстового поля; null — убрать. */
  onIcon: (key: string, fieldId: string, code: string | null) => void;
  onParticipant: (key: string, id: string) => void;
  onRemove: (key: string) => void;
  onOpenDefects: (issue: Issue) => void;
  /** Клик по «Теме» задачи из Jira: окно с описанием, автором и исполнителем. */
  onOpenIssue: (issue: Issue) => void;
  /** Ручной порядок строк: переставить key перед/после target. */
  onMoveRow: (key: string, target: string, place: Place) => void;
  /** Порядок колонок: переставить col перед/после target. */
  onMoveColumn: (col: ColRef, target: ColRef, place: Place) => void;
  /** Перенос в другую группу по полю SimpleTest: записать значения и (если есть target) встать рядом с ним. */
  onMoveToGroup: (key: string, changes: GroupChange[], target: string | null, place: Place) => void;
  /** Перенос в другую папку (null — «Без папки»); внутри неё задача сама попадёт в свою группу. */
  onMoveToFolder: (key: string, folder: string | null, target: string | null, place: Place) => void;
  /** Ширина колонки; null — вернуть стандартную. */
  onResizeColumn: (col: ColRef, width: number | null) => void;
  onRenameFolder: (name: string, next: string) => void;
  onDeleteFolder: (name: string) => void;
  onMoveFolder: (name: string, target: string, place: Place) => void;
  /** Своё текстовое поле: переносить текст или обрезать многоточием. */
  onToggleWrap: (fieldId: string) => void;
  /** Черновик SimpleTest: открыть форму, чтобы поправить или отправить в Jira. */
  onOpenDraft: (issue: Issue) => void;
  /** Трудозатраты задачи: план (минуты; null — убрать), начало или конец теста. */
  onSpend: (key: string, patch: { plan?: number | null; start?: string; end?: string }) => void;
  /** Закрепить / открепить колонку. */
  onTogglePin: (col: ColRef) => void;
  /** Клик по статусу (st) эпика: его стори. */
  onOpenStage: (issue: Issue) => void;
  /** Фамилии полей направлений (st): поле → список. */
  roleNames: Record<string, string[]>;
  onRole: (key: string, fieldId: string, patch: { name?: string; state?: "todo" | "doing" | "done" }) => void;
  onRoleNames: (fieldId: string, names: string[]) => void;
  /** Исключить задачу из нагрузки (true) или вернуть (false). */
  onNoLoad: (key: string, skip: boolean) => void;
  /** Требования по задачам (ключ → id документов «Данных») и все документы для выбора. */
  reqLinks: Record<string, string[]>;
  reqOptions: ReqOption[];
  onReqs: (key: string, ids: string[]) => void;
  /** Снять отметку «n» (если папок в списке нет — переложить задачу некуда). */
  onClearMark: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { list, participants } = ctx;
  // Закреплённые колонки идут первыми и при прокрутке вбок остаются на месте (как и ключ задачи).
  const pinned = new Set(list.pinned ?? []);
  const cols = [...list.columns.filter(c => pinned.has(c)), ...list.columns.filter(c => !pinned.has(c))];
  const lastPinned = [...cols].reverse().find(c => pinned.has(c));
  const ownById = Object.fromEntries(list.ownFields.map(f => [f.id, f]));
  const width = cols.length + 3;
  const allOn = issues.length > 0 && issues.every(i => selected.has(i.key));
  const sections = list.folderList?.length ? folderSections(list, issues) : null;

  /* ── Ширина колонок: тянем за край заголовка ── */
  const [live, setLive] = useState<{ col: ColRef; w: number } | null>(null);
  const resizing = useRef<{ col: ColRef; x: number; w: number } | null>(null);
  const colW = (c: ColRef) => (live?.col === c ? live.w : list.widths?.[c] ?? defaultWidth(c, ctx));
  // Ключ не должен обрезаться: ширина столбца — под самый глубокий уровень вложенности (папка + 3 группы).
  const depthMax = (sections ? 1 : 0) + list.groupBy.length;
  // Отметки «n»/«У» стоят перед ключом — под них место, чтобы ключ не обрезался.
  const KEY_W = 150 + depthMax * INDENT + (Object.keys(list.marks ?? {}).length ? 22 : 0);
  const tableW = SELECT_W + KEY_W + REMOVE_W + cols.reduce((n, c) => n + colW(c), 0);
  /** Отступ слева закреплённой колонки: выбор + ключ + закреплённые до неё. */
  const leftOf = (c: ColRef) => {
    let x = SELECT_W + KEY_W;
    for (const k of cols) { if (k === c) break; if (pinned.has(k)) x += colW(k); }
    return x;
  };
  const stick = (left: number, z = 2): React.CSSProperties => ({ position: "sticky", left, zIndex: z });
  // Граница справа у последней закреплённой (или у ключа, если закреплённых нет) — видно, где «стоп».
  const EDGE = "shadow-[inset_-1px_0_0_0_var(--color-border-main,#e2e8f0)]";
  /** Суммы трудозатрат для заголовков групп и папок — для отчётности. */
  const spendSum = (items: Issue[]) => {
    if (!cols.includes(PLAN_COL) && !cols.includes(FACT_COL)) return "";
    let plan = 0, fact = 0, hasPlan = false, hasFact = false;
    for (const i of items) {
      const sp = list.spend?.[i.key];
      if (sp?.plan != null) { plan += sp.plan; hasPlan = true; }
      const f = factMinutes(sp);
      if (f != null && f >= 0) { fact += f; hasFact = true; }
    }
    return [hasPlan ? `план ${fmtMinutes(plan)}` : "", hasFact ? `факт ${fmtMinutes(fact)}` : ""].filter(Boolean).join(" · ");
  };
  // Слушатели мыши вешаются один раз; свежий колбэк — через ref.
  const onResizeRef = useRef(onResizeColumn);
  onResizeRef.current = onResizeColumn;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizing.current;
      if (r) setLive({ col: r.col, w: Math.max(MIN_W, Math.round(r.w + e.clientX - r.x)) });
    };
    const up = (e: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      resizing.current = null;
      setLive(null);
      onResizeRef.current(r.col, Math.max(MIN_W, Math.round(r.w + e.clientX - r.x)));
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  /* ── Перетаскивание ───────────────────────────────────────────────────
     Строки тянутся только за ручку (иначе мешали бы вводу в своих полях).
     Папки — уровень выше группировки: перенос в другую папку меняет только папку,
     в новой папке задача сама встаёт в свою группу. Внутри папки (или списка без папок):
     в той же группе — порядок; в другой группе — только если все отличающиеся уровни —
     записываемые поля SimpleTest (участник, свои поля): у задачи меняется значение.
     При сортировке по колонке ручной порядок не виден — перетаскивание строк выключено. */
  const rowsMovable = !sort;
  /**
   * Строку тянут только за ручку ⋮⋮ (иначе нельзя выделить текст в ячейках). Строка становится
   * перетаскиваемой прямо в обработчике нажатия на ручку — атрибутом в DOM, без перерисовки React:
   * браузер решает, что тянуть, по нажатию, и ждать перерисовки нельзя.
   */
  const armedRef = useRef<{ id: string; tr: HTMLTableRowElement } | null>(null);
  const arm = (id: string, el: Element) => {
    const tr = el.closest("tr");
    if (!tr) return;
    tr.setAttribute("draggable", "true");
    armedRef.current = { id, tr };
  };
  const disarm = () => {
    armedRef.current?.tr.removeAttribute("draggable");
    armedRef.current = null;
  };
  const [dragRow, setDragRow] = useState<{ key: string; path: string } | null>(null);
  // То же в ref: dragover приходит раньше, чем React успевает обновить состояние.
  const dragRef = useRef<{ key: string; path: string; levels: GroupLevel[]; folder: FolderKey } | null>(null);
  const [overRow, setOverRow] = useState<{ key: string; path: string; place: Place } | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<ColRef | null>(null);
  const [overCol, setOverCol] = useState<{ col: ColRef; place: Place } | null>(null);
  const dragFolderRef = useRef<string | null>(null);
  const [overFolder, setOverFolder] = useState<{ name: string; place: Place } | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [askDelete, setAskDelete] = useState<string | null>(null);

  const dropPlan = (dstPath: string, dst: GroupLevel[], dstFolder: FolderKey): DropPlan | null => {
    const src = dragRef.current;
    if (!src) return null;
    if (dstFolder !== undefined && src.folder !== dstFolder) return { kind: "folder", folder: dstFolder };
    if (src.path === dstPath) return { kind: "group", changes: [] };
    const changes: GroupChange[] = [];
    for (let i = 0; i < dst.length; i++) {
      const from = src.levels[i]?.label, to = dst[i].label;
      if (from === to) continue;
      if (!isWritableGroupRef(dst[i].ref, list)) return null;
      changes.push({ ref: dst[i].ref, from: from ?? "", to });
    }
    return { kind: "group", changes };
  };

  /** Фон закреплённой ячейки — непрозрачный, иначе под ней просвечивают прокрученные колонки. */
  const rowBg = (on: boolean) => (on ? "bg-[var(--color-active-bg)]" : "bg-bg-card group-hover/row:bg-bg-subtle");

  const placeY = (e: React.DragEvent): Place => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "before" : "after";
  };
  const placeX = (e: React.DragEvent): Place => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "before" : "after";
  };
  /**
   * Запрет переноса. Раскладка приложения разрешает бросать что угодно (так в правую панель
   * переносят разделы), поэтому без stopPropagation курсор показывал бы «можно» там, где нельзя.
   */
  const refuse = (e: React.DragEvent) => {
    if (!dragRef.current && !dragCol && !dragFolderRef.current) return;
    e.stopPropagation();
    if (e.defaultPrevented) return;                                 // элемент уже разрешил перенос
    e.dataTransfer.dropEffect = "none";
  };
  const endRowDrag = () => {
    dragRef.current = null; dragFolderRef.current = null;
    setDragRow(null); setOverRow(null); setOverGroup(null); setOverFolder(null); disarm();
  };
  /*
   * Автопрокрутка вбок при переносе колонки: подвели заголовок к краю видимой области —
   * слева это граница закреплённых колонок, справа край таблицы — таблица едет со средней
   * скоростью, пока колонка у края. dragover приходит и без движения мыши, поэтому по нему
   * же понимаем, что перенос ещё идёт; нет событий 150 мс — останавливаемся.
   */
  const scrollBox = useRef<HTMLDivElement>(null);
  const auto = useRef<{ dir: number; last: number; raf: number | null }>({ dir: 0, last: 0, raf: null });
  const AUTO_ZONE = 56, AUTO_SPEED = 9;               // px от края; px за кадр (~540 px/с)
  const stopAuto = () => {
    if (auto.current.raf !== null) cancelAnimationFrame(auto.current.raf);
    auto.current = { dir: 0, last: 0, raf: null };
  };
  const autoScroll = (e: React.DragEvent) => {
    const el = scrollBox.current;
    if (!dragCol || !el) return;
    const r = el.getBoundingClientRect();
    const pinnedEdge = r.left + SELECT_W + KEY_W + cols.filter(c => pinned.has(c)).reduce((n, c) => n + colW(c), 0);
    const dir = e.clientX < pinnedEdge + AUTO_ZONE && el.scrollLeft > 0 ? -1
      : e.clientX > r.right - AUTO_ZONE && el.scrollLeft + el.clientWidth < el.scrollWidth ? 1 : 0;
    auto.current.dir = dir;
    auto.current.last = performance.now();
    if (dir && auto.current.raf === null) {
      const step = () => {
        const a = auto.current;
        if (!a.dir || performance.now() - a.last > 150 || !scrollBox.current) { stopAuto(); return; }
        scrollBox.current.scrollLeft += a.dir * AUTO_SPEED;
        a.raf = requestAnimationFrame(step);
      };
      auto.current.raf = requestAnimationFrame(step);
    }
  };
  useEffect(() => stopAuto, []);
  const endColDrag = () => { stopAuto(); setDragCol(null); setOverCol(null); };

  const toggle = (path: string) => setCollapsed(c => { const n = new Set(c); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const clickSort = (col: ColRef) =>
    onSort(sort?.col !== col ? { col, dir: 1 } : sort.dir === 1 ? { col, dir: -1 } : null);

  /** Бросили строку: в зависимости от плана — в папку, в группу или просто порядок. */
  const dropRow = (plan: DropPlan, target: string | null, place: Place) => {
    const src = dragRef.current;
    if (!src) return;
    if (plan.kind === "folder") onMoveToFolder(src.key, plan.folder, target === src.key ? null : target, place);
    else if (plan.changes.length) onMoveToGroup(src.key, plan.changes, target === src.key ? null : target, place);
    else if (target && target !== src.key) onMoveRow(src.key, target, place);
  };

  const row = (issue: Issue, depth: number, path: string, levels: GroupLevel[], folder: FolderKey, prev?: string, next?: string) => {
    const on = selected.has(issue.key);
    const id = `${issue.key}|${path}`;
    const over = overRow?.key === issue.key && overRow.path === path && dragRow && !(dragRow.key === issue.key && dragRow.path === path)
      ? overRow.place : null;
    return (
      <tr key={id}
        onDragStart={e => {
          if (dragFolderRef.current || dragCol) return;            // тянут папку или колонку — не строку
          if (armedRef.current?.id !== id) { e.preventDefault(); return; }
          e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", issue.key);
          dragRef.current = { key: issue.key, path, levels, folder };
          // Подсветку — после начала переноса: Chrome отменяет перенос, если в dragstart меняется страница.
          setTimeout(() => { if (dragRef.current?.key === issue.key) setDragRow({ key: issue.key, path }); }, 0);
        }}
        onDragOver={e => {
          if (!dragRef.current || dropPlan(path, levels, folder) === null) return refuse(e);
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const place = placeY(e);
          if (overRow?.key !== issue.key || overRow.path !== path || overRow.place !== place) setOverRow({ key: issue.key, path, place });
        }}
        onDrop={e => {
          e.preventDefault();
          const plan = dropPlan(path, levels, folder);
          if (plan) dropRow(plan, issue.key, placeY(e));
          endRowDrag();
        }}
        onDragEnd={endRowDrag}
        className={`group/row border-t border-border-main ${on ? "bg-primary/5" : "hover:bg-bg-subtle/60"}
          ${dragRow?.key === issue.key && dragRow.path === path ? "opacity-40" : ""}
          ${over === "before" ? "shadow-[inset_0_2px_0_0_var(--color-primary,#6366f1)]" : ""}
          ${over === "after" ? "shadow-[inset_0_-2px_0_0_var(--color-primary,#6366f1)]" : ""}`}>
        <td className={`pl-1 pr-1 py-1.5 align-top whitespace-nowrap ${rowBg(on)}`} style={stick(0)}>
          {/* span, а не button: с кнопки Firefox и Safari перенос не начинают (у папок ручка — тоже span) */}
          <span role="button" tabIndex={rowsMovable ? 0 : -1} aria-label={`Переместить ${issue.key}`} aria-disabled={!rowsMovable}
            title={rowsMovable ? "Перетащите, чтобы поменять порядок или папку (или ↑/↓)" : "Сбросьте сортировку по колонке, чтобы менять порядок вручную"}
            onMouseDown={e => { if (rowsMovable && e.button === 0) arm(id, e.currentTarget); }}
            onMouseUp={() => { if (!dragRef.current) disarm(); }}
            onKeyDown={e => {
              if (!rowsMovable) return;
              if (e.key === "ArrowUp" && prev) { e.preventDefault(); onMoveRow(issue.key, prev, "before"); }
              if (e.key === "ArrowDown" && next) { e.preventDefault(); onMoveRow(issue.key, next, "after"); }
            }}
            className={`inline-flex align-middle p-0.5 rounded text-text-muted opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100
              ${rowsMovable ? "cursor-grab active:cursor-grabbing hover:text-text-main" : "cursor-not-allowed"}`}>
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          {selecting && (
            <input type="checkbox" checked={on} onChange={() => onSelect([issue.key], !on)} aria-label={`Выбрать ${issue.key}`}
              className="align-middle ml-0.5" />
          )}
        </td>
        <td className={`px-3 py-1.5 whitespace-nowrap align-top overflow-hidden text-ellipsis ${rowBg(on)} ${lastPinned ? "" : EDGE}`}
          style={{ ...stick(SELECT_W), paddingLeft: 12 + depth * INDENT }}>
          {list.marks?.[issue.key] === "removed" && (
            <span role="img" aria-label="Выпала из источника" title="Задачи больше нет в источнике (JQL-фильтр или релиз) — решите, оставить ли её в списке"
              className="inline-flex items-center justify-center w-4 h-4 mr-1.5 rounded-full bg-red-600 text-white text-[9px] font-bold align-middle">У</span>
          )}
          {list.marks?.[issue.key] === "new" && (sections ? (
            <span role="img" aria-label="Новая из источника" title="Новая задача из источника (JQL-фильтр или релиз). Переложите в папку — отметка исчезнет"
              className="inline-flex items-center justify-center w-4 h-4 mr-1.5 rounded-full bg-blue-600 text-white text-[9px] font-bold align-middle">n</span>
          ) : (
            <button type="button" onClick={() => onClearMark(issue.key)} aria-label="Новая из источника — отметить просмотренной"
              title="Новая задача из источника (JQL-фильтр или релиз). Папок в списке нет — нажмите, чтобы снять отметку"
              className="inline-flex items-center justify-center w-4 h-4 mr-1.5 rounded-full bg-blue-600 text-white text-[9px] font-bold align-middle hover:ring-2 hover:ring-blue-300">n</button>
          ))}
          {issue.url ? (
            <a href={issue.url} target="_blank" rel="noreferrer" title="Открыть в Jira" className="font-mono text-xs text-primary hover:underline">{issue.key} ↗</a>
          ) : issue.local ? (
            <button type="button" onClick={() => onOpenDraft(issue)} title="Черновик SimpleTest: открыть, поправить или отправить в Jira"
              className="font-mono text-xs text-primary hover:underline">{issue.key}</button>
          ) : <span className="font-mono text-xs text-primary">{issue.key}</span>}
          {issue.local && (
            <button type="button" onClick={() => onOpenDraft(issue)} title="В Jira не отправлялся — открыть и отправить"
              className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-300">
              черновик → Jira</button>
          )}
        </td>
        {cols.map(c => (
          <td key={c} className={`px-3 py-1.5 align-top text-sm text-text-main overflow-hidden
            ${pinned.has(c) ? rowBg(on) : ""} ${c === lastPinned ? EDGE : ""}`}
            style={pinned.has(c) ? stick(leftOf(c)) : undefined}>
            {c === PARTICIPANT_COL ? (
              <ParticipantCell value={list.assignees[issue.key] ?? ""} participants={participants} onChange={pid => onParticipant(issue.key, pid)} />
            ) : c === STAGE_COL ? (
              <StageCell info={ctx.stageOf(issue)} onOpen={categoryOf(issue) === "epic" ? () => onOpenStage(issue) : undefined}
                manual={stageManual[issue.key]} onManual={st => onStageManual(issue.key, st)} />
            ) : c === DEFECTS_COL ? (
              <DefectsCell defects={ctx.defectsOf(issue)} onOpen={() => onOpenDefects(issue)} />
            ) : c === BLOCK_COL ? (
              <BlockCell defects={ctx.defectsOf(issue)} onOpen={() => onOpenDefects(issue)} />
            ) : c === PLAN_COL ? (
              <PlanCell value={list.spend?.[issue.key]?.plan} onChange={m => onSpend(issue.key, { plan: m })} />
            ) : c === START_COL || c === END_COL ? (
              <SpendDateCell value={list.spend?.[issue.key]?.[c === START_COL ? "start" : "end"]} label={colLabel(c, list)}
                onChange={v => onSpend(issue.key, c === START_COL ? { start: v } : { end: v })} />
            ) : c === FACT_COL ? (
              <FactCell spend={list.spend?.[issue.key]} />
            ) : c === REQ_COL ? (
              <ReqCell value={reqLinks[issue.key] ?? []} options={reqOptions} onChange={ids => onReqs(issue.key, ids)} />
            ) : c === LOAD_COL ? (
              <LoadCell skip={loadSkip(list, issue, ctx.stageOf)} stage={stageText(ctx.stageOf(issue))} onChange={v => onNoLoad(issue.key, v)} />
            ) : isRoleCol(c) ? (
              <RoleCell label={colLabel(c, list)} value={list.roles?.[issue.key]?.[c.slice(5)]} names={roleNames[c.slice(5)] ?? []}
                onChange={patch => onRole(issue.key, c.slice(5), patch)} onNames={names => onRoleNames(c.slice(5), names)} />
            ) : c === FOLDER_COL ? (
              <span className="block truncate text-xs text-text-muted">{list.folders?.[issue.key] ?? "—"}</span>
            ) : c === "jira:summary" && !issue.local ? (
              <button type="button" onClick={() => onOpenIssue(issue)} title="Открыть описание задачи"
                className="block w-full text-left break-words hover:text-primary hover:underline">
                {String(issue.fields.summary ?? "—")}
              </button>
            ) : c.startsWith("jira:") ? (
              <JiraCell id={c.slice(5)} issue={issue} />
            ) : ownById[c.slice(4)] ? (
              <OwnCell field={ownById[c.slice(4)]} value={list.values[issue.key]?.[c.slice(4)]} icon={list.icons?.[issue.key]?.[c.slice(4)]}
                onChange={v => onValue(issue.key, c.slice(4), v)} onIcon={code => onIcon(issue.key, c.slice(4), code)} />
            ) : <span className="text-text-muted/50">—</span>}
          </td>
        ))}
        <td className="px-1 py-1.5 align-top">
          <button type="button" onClick={() => onRemove(issue.key)} aria-label={`Убрать ${issue.key} из списка`} title="Убрать из списка"
            className="p-1 rounded text-text-muted opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    );
  };

  const group = (node: GroupNode, depth: number, parent: GroupLevel[], folder: FolderKey): React.ReactNode => {
    const shut = collapsed.has(node.path);
    const keys = node.issues.map(i => i.key);
    const groupOn = keys.length > 0 && keys.every(k => selected.has(k));
    const levels = [...parent, { ref: node.ref, label: node.label }];
    // На заголовок можно бросить, если группа конечная (понятно, куда класть) или это другая папка.
    const leaf = !node.children.length;
    return (
      <Fragment key={node.path}>
        <tr className={`border-t border-border-main bg-bg-subtle/70 ${overGroup === node.path ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`}
          onDragOver={e => {
            const plan = dropPlan(node.path, levels, folder);
            const ok = plan && (plan.kind === "folder" || (leaf && plan.changes.length > 0));
            if (!ok) return refuse(e);
            e.preventDefault();
            if (overGroup !== node.path) setOverGroup(node.path);
          }}
          onDragLeave={() => overGroup === node.path && setOverGroup(null)}
          onDrop={e => {
            e.preventDefault();
            const plan = dropPlan(node.path, levels, folder);
            if (plan && (plan.kind === "folder" || (leaf && plan.changes.length))) dropRow(plan, null, "after");
            endRowDrag();
          }}>
          <td className="pl-1 pr-1 py-1.5 bg-bg-subtle" style={stick(0)}>
            <span className="inline-block w-[18px]" />
            {selecting && (
              <input type="checkbox" checked={groupOn} onChange={() => onSelect(keys, !groupOn)} aria-label={`Выбрать группу ${node.label}`}
                className="align-middle ml-0.5" />
            )}
          </td>
          <td colSpan={width - 1} className="py-1.5">
            {/* Подпись группы не уезжает при прокрутке вбок */}
            <button type="button" onClick={() => toggle(node.path)} aria-expanded={!shut}
              style={{ position: "sticky", left: SELECT_W + 8 + depth * INDENT }}
              className="flex items-center gap-1.5 text-sm text-text-main w-max">
              <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${shut ? "" : "rotate-90"}`} />
              <span className="text-[11px] text-text-muted">{node.field}:</span>
              {node.ref.startsWith("own:") && ownById[node.ref.slice(4)]?.tags && node.label !== EMPTY_GROUP ? (
                <Tag field={ownById[node.ref.slice(4)]} value={node.label} />
              ) : (
                <span className={`font-semibold ${node.ref === STAGE_COL && node.label === "Нет сторей" ? "text-red-600 dark:text-red-400" : ""}`}>
                  {jiraDateKind(node.ref) && node.label !== EMPTY_GROUP ? fmtJiraDate(node.label, jiraDateKind(node.ref) === "datetime") : node.label}</span>
              )}
              <span className="text-[11px] px-1.5 rounded-full bg-bg-card border border-border-main text-text-muted">{node.issues.length}</span>
              {spendSum(node.issues) && <span className="text-[11px] text-text-muted ml-1">{spendSum(node.issues)}</span>}
            </button>
          </td>
        </tr>
        {!shut && (node.children.length
          ? node.children.map(ch => group(ch, depth + 1, levels, folder))
          : node.issues.length === 0
            ? <tr className="border-t border-border-main"><td colSpan={width} className="py-1.5 text-[11px] text-text-muted/70"
                style={{ paddingLeft: 40 + depth * INDENT }}>пусто — перетащите сюда задачу</td></tr>
            : sortIssues(node.issues, sort, ctx).map((i, n, arr) =>
                row(i, depth + 1, node.path, levels, folder, arr[n - 1]?.key, arr[n + 1]?.key)))}
      </Fragment>
    );
  };

  /** Содержимое папки (или всего списка): группы или строки по ручному порядку. */
  const content = (items: Issue[], prefix: string, folder: FolderKey, depth: number) =>
    list.groupBy.length
      ? groupIssues(items, list.groupBy, ctx, prefix).map(g => group(g, depth, [], folder))
      : sortIssues(items, sort, ctx).map((i, n, arr) => row(i, depth, prefix, [], folder, arr[n - 1]?.key, arr[n + 1]?.key));

  /** Заголовок папки: перенос задач внутрь, перестановка папок, переименование, удаление. */
  const folderHeader = (name: string | null, items: Issue[]) => {
    const path = `f:${name ?? ""}`;
    const shut = collapsed.has(path);
    const keys = items.map(i => i.key);
    const allIn = keys.length > 0 && keys.every(k => selected.has(k));
    const isOver = overGroup === path;
    const fOver = name && overFolder?.name === name ? overFolder.place : null;
    return (
      <tr key={`fh-${path}`} draggable={!!name && renaming?.name !== name}
        onDragStart={e => {
          if (!name) return;
          e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", name);
          dragFolderRef.current = name;
        }}
        onDragOver={e => {
          if (dragFolderRef.current) {
            if (!name || dragFolderRef.current === name) return refuse(e);
            e.preventDefault();
            const place = placeY(e);
            if (overFolder?.name !== name || overFolder.place !== place) setOverFolder({ name, place });
            return;
          }
          const plan = dropPlan(path, [], name);
          if (!plan || plan.kind !== "folder") return refuse(e);
          e.preventDefault();
          if (overGroup !== path) setOverGroup(path);
        }}
        onDragLeave={() => { if (overGroup === path) setOverGroup(null); }}
        onDrop={e => {
          e.preventDefault();
          if (dragFolderRef.current && name && dragFolderRef.current !== name) onMoveFolder(dragFolderRef.current, name, placeY(e));
          else {
            const plan = dropPlan(path, [], name);
            if (plan?.kind === "folder") dropRow(plan, null, "after");
          }
          endRowDrag();
        }}
        onDragEnd={endRowDrag}
        className={`group/fh border-t-2 border-border-main bg-bg-card ${isOver ? "outline outline-2 -outline-offset-2 outline-primary" : ""}
          ${fOver === "before" ? "shadow-[inset_0_2px_0_0_var(--color-primary,#6366f1)]" : ""}
          ${fOver === "after" ? "shadow-[inset_0_-2px_0_0_var(--color-primary,#6366f1)]" : ""}`}>
        <td className="pl-1 pr-1 py-2 whitespace-nowrap bg-bg-card" style={stick(0)}>
          {name ? (
            <span className="inline-flex align-middle p-0.5 text-text-muted opacity-0 group-hover/fh:opacity-100 cursor-grab" title="Перетащите, чтобы поменять порядок папок">
              <GripVertical className="w-3.5 h-3.5" />
            </span>
          ) : <span className="inline-block w-[18px]" />}
          {selecting && (
            <input type="checkbox" checked={allIn} onChange={() => onSelect(keys, !allIn)} aria-label={`Выбрать папку ${name ?? NO_FOLDER}`}
              className="align-middle ml-0.5" />
          )}
        </td>
        <td colSpan={width - 1} className="py-2 pl-2">
          <div className="flex items-center gap-2 min-w-0 w-max" style={{ position: "sticky", left: SELECT_W + 8 }}>
            <button type="button" onClick={() => toggle(path)} aria-expanded={!shut} className="flex items-center gap-1.5 min-w-0">
              <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${shut ? "" : "rotate-90"}`} />
              <Folder className={`w-4 h-4 flex-shrink-0 ${name ? "text-amber-500" : "text-text-muted"}`} />
            </button>
            {renaming?.name === name && name ? (
              <input autoFocus value={renaming.value} onChange={e => setRenaming({ name, value: e.target.value })} aria-label="Название папки"
                onBlur={() => { const v = renaming.value.trim(); if (v && v !== name) onRenameFolder(name, v); setRenaming(null); }}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                className="text-sm font-semibold bg-[var(--color-input-bg)] border border-primary/40 rounded px-1.5 py-0.5 text-text-main focus:outline-none" />
            ) : (
              <span className={`text-sm font-semibold truncate ${name ? "text-text-main" : "text-text-muted"}`}>{name ?? NO_FOLDER}</span>
            )}
            <span className="text-[11px] px-1.5 rounded-full bg-bg-subtle border border-border-main text-text-muted">{items.length}</span>
            {spendSum(items) && <span className="text-[11px] text-text-muted">{spendSum(items)}</span>}
            {name && renaming?.name !== name && (askDelete === name ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-text-muted">Удалить папку? Задачи перейдут в «{NO_FOLDER}».</span>
                <button type="button" onClick={() => { onDeleteFolder(name); setAskDelete(null); }}
                  className="px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold">Удалить</button>
                <button type="button" onClick={() => setAskDelete(null)} className="px-2 py-0.5 rounded-md border border-border-main text-text-muted">Нет</button>
              </span>
            ) : (
              <span className="flex items-center gap-0.5 opacity-0 group-hover/fh:opacity-100 focus-within:opacity-100">
                <button type="button" onClick={() => setRenaming({ name, value: name })} aria-label={`Переименовать папку ${name}`}
                  className="p-1 rounded text-text-muted hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => setAskDelete(name)} aria-label={`Удалить папку ${name}`}
                  className="p-1 rounded text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            ))}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div ref={scrollBox} className="border border-border-main rounded-xl overflow-auto scrollbar-thin bg-bg-card"
      onDragOverCapture={autoScroll} onDragOver={refuse}>
      <table className="border-collapse" style={{ tableLayout: "fixed", width: tableW }}>
        <colgroup>
          <col style={{ width: SELECT_W }} />
          <col style={{ width: KEY_W }} />
          {cols.map(c => <col key={c} style={{ width: colW(c) }} />)}
          <col style={{ width: REMOVE_W }} />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="text-left">
            <th className="pl-1 pr-1 py-2 text-left bg-bg-card whitespace-nowrap" style={stick(0, 4)}>
              <button type="button" onClick={onToggleSelecting} aria-pressed={selecting}
                aria-label={selecting ? "Скрыть выбор задач" : "Выбрать задачи"}
                title={selecting ? "Скрыть чекбоксы и снять выбор" : "Выбрать задачи: смена статуса, папка, убрать из списка"}
                className={`inline-flex align-middle p-0.5 rounded transition-colors
                  ${selecting ? "bg-primary/15 text-primary" : "text-text-muted hover:text-primary hover:bg-bg-subtle"}`}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {selecting && (
                <input type="checkbox" checked={allOn} onChange={() => onSelect(issues.map(i => i.key), !allOn)} aria-label="Выбрать все задачи"
                  className="align-middle ml-0.5" />
              )}
            </th>
            <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap bg-bg-card ${lastPinned ? "" : EDGE}`}
              style={stick(SELECT_W, 4)} title="Ключ закреплён всегда">Ключ</th>
            {cols.map((c, n) => {
              const over = overCol?.col === c && dragCol && dragCol !== c ? overCol.place : null;
              return (
                <th key={c} draggable={!live}
                  onDragStart={e => {
                    if (resizing.current) { e.preventDefault(); return; }
                    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c); setDragCol(c);
                  }}
                  onDragOver={e => {
                    if (!dragCol) return refuse(e);
                    e.preventDefault();
                    const place = placeX(e);
                    if (overCol?.col !== c || overCol.place !== place) setOverCol({ col: c, place });
                  }}
                  onDrop={e => { e.preventDefault(); if (dragCol && dragCol !== c) onMoveColumn(dragCol, c, placeX(e)); endColDrag(); }}
                  onDragEnd={endColDrag}
                  title="Перетащите заголовок — порядок колонок; край заголовка — ширина"
                  style={pinned.has(c) ? stick(leftOf(c), 4) : undefined}
                  className={`group/th relative bg-bg-card ${c === lastPinned ? EDGE : ""} px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap cursor-grab
                    active:cursor-grabbing overflow-hidden ${dragCol === c ? "opacity-40" : ""}
                    ${over === "before" ? "shadow-[inset_2px_0_0_0_var(--color-primary,#6366f1)]" : ""}
                    ${over === "after" ? "shadow-[inset_-2px_0_0_0_var(--color-primary,#6366f1)]" : ""}`}>
                  <span className="flex items-center gap-0.5 min-w-0">
                    <GripVertical className="w-3 h-3 -ml-2 flex-shrink-0 opacity-0 group-hover/th:opacity-60" />
                    <button type="button" onClick={() => clickSort(c)}
                      onKeyDown={e => {
                        // Alt+←/→ — переставить колонку с клавиатуры.
                        if (!e.altKey) return;
                        if (e.key === "ArrowLeft" && n > 0) { e.preventDefault(); onMoveColumn(c, cols[n - 1], "before"); }
                        if (e.key === "ArrowRight" && n < cols.length - 1) { e.preventDefault(); onMoveColumn(c, cols[n + 1], "after"); }
                      }}
                      className="inline-flex items-center gap-1 hover:text-text-main uppercase min-w-0">
                      <span className="truncate">{colLabel(c, list)}</span>
                      {sort?.col === c && (sort.dir === 1 ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />)}
                    </button>
                    <button type="button" onClick={() => onTogglePin(c)} aria-pressed={pinned.has(c)}
                      aria-label={pinned.has(c) ? `Открепить колонку ${colLabel(c, list)}` : `Закрепить колонку ${colLabel(c, list)}`}
                      title={pinned.has(c) ? "Открепить" : "Закрепить: колонка не уедет при прокрутке вбок"}
                      className={`ml-1 p-0.5 rounded flex-shrink-0 ${pinned.has(c) ? "text-primary" : "text-text-muted opacity-0 group-hover/th:opacity-100 hover:text-text-main"}`}>
                      {pinned.has(c) ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                    {ownById[c.slice(4)]?.type === "text" && (() => {
                      const wrap = !!ownById[c.slice(4)].wrap;
                      return (
                        <button type="button" onClick={() => onToggleWrap(c.slice(4))} aria-pressed={wrap}
                          aria-label={wrap ? "Обрезать длинный текст" : "Переносить длинный текст"}
                          title={wrap ? "Сейчас: перенос, весь текст. Нажмите — обрезать многоточием" : "Сейчас: обрезка многоточием. Нажмите — переносить и показывать всё"}
                          className={`ml-1 p-0.5 rounded flex-shrink-0 ${wrap ? "text-primary" : "text-text-muted hover:text-text-main"}`}>
                          {wrap ? <WrapText className="w-3.5 h-3.5" /> : <MoreHorizontal className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })()}
                  </span>
                  {/* Край для изменения ширины. Двойной щелчок — стандартная ширина. */}
                  <span role="separator" aria-orientation="vertical" aria-label={`Ширина колонки ${colLabel(c, list)}`}
                    title="Тяните — ширина колонки; двойной щелчок — по умолчанию"
                    onMouseDown={e => {
                      e.preventDefault(); e.stopPropagation();
                      resizing.current = { col: c, x: e.clientX, w: colW(c) };
                      setLive({ col: c, w: colW(c) });
                      document.body.style.cursor = "col-resize";
                    }}
                    onDoubleClick={e => { e.stopPropagation(); onResizeColumn(c, null); }}
                    className={`absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-primary/30 ${live?.col === c ? "bg-primary/40" : ""}`} />
                </th>
              );
            })}
            <th />
          </tr>
        </thead>
        <tbody>
          {sections
            // «Без папки» — только когда в нём есть задачи; пока тянут задачу, он виден пустым,
            // чтобы её можно было вынуть из папки перетаскиванием.
            ? sections.filter(sec => sec.name !== null || sec.issues.length > 0 || dragRow).map(sec => {
                const path = `f:${sec.name ?? ""}`;
                return (
                  <Fragment key={path}>
                    {folderHeader(sec.name, sec.issues)}
                    {!collapsed.has(path) && (sec.issues.length
                      ? content(sec.issues, path, sec.name, 1)
                      : <tr className="border-t border-border-main"><td colSpan={width} className="py-2 pl-12 text-[11px] text-text-muted/70">
                          пусто — перетащите сюда задачи</td></tr>)}
                  </Fragment>
                );
              })
            : content(issues, "root", undefined, 0)}
        </tbody>
      </table>
    </div>
  );
}
