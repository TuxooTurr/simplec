"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { PRIORITIES, STATUS_ORDER, isBlocker, type Issue } from "@/lib/jiraTool";
import { IssueTypeBadge } from "./ListCells";
import ColumnFilter, { type FilterOption } from "./ColumnFilter";

/* Таблица задач Jira для окон «Статус (st)» и «Дефекты»: тип, номер со ссылкой в Jira,
   название, статус, приоритет, исполнитель. Колонки сортируются; задачи можно разбить
   на группы — сортировка работает внутри каждой группы. С picked/onPick — галочки у строк
   и «все» в шапке: выбрать, что отправить в чат.
   Ширина колонок тянется мышью за правый край заголовка и запоминается по widthKey (у каждого окна своя);
   текст в ячейках переносится, а не обрезается. С filter/onFilter — поиск по номеру и названию и фильтры
   по значениям колонок, как в Excel. Фильтруют строки снаружи (filterIssueRows): тем же списком окно
   собирает отчёт в чат и смену статуса — уходит только видимое. */

export type IssueCol = "type" | "key" | "summary" | "status" | "stage" | "priority" | "assignee";
export type IssueSort = { col: IssueCol; dir: 1 | -1 };

const LABEL: Record<IssueCol, string> = {
  type: "Тип", key: "Номер", summary: "Наименование", status: "Статус", stage: "Статус (st)",
  priority: "Приоритет", assignee: "Исполнитель",
};

function sortValue(d: Issue, col: IssueCol, stageRank?: (i: Issue) => number): string | number {
  if (col === "key") return Number(d.key.split("-").pop()) || 0;
  if (col === "type") return String(d.fields.issuetype ?? "").toLowerCase();
  if (col === "status") {
    const i = STATUS_ORDER.indexOf(String(d.fields.status ?? ""));
    return i === -1 ? 999 : i;
  }
  if (col === "stage") return stageRank?.(d) ?? 0;
  if (col === "priority") {
    const i = PRIORITIES.indexOf(String(d.fields.priority ?? ""));
    return i === -1 ? 999 : i;
  }
  return String(d.fields[col] ?? "").toLowerCase() || "￿";
}

/** Фильтр таблицы: строка поиска (номер, название) и отмеченные значения колонок (нет колонки — всё). */
export type IssueFilter = { q: string; cols: Partial<Record<IssueCol, string[]>> };
export const NO_FILTER: IssueFilter = { q: "", cols: {} };
const FILTER_COLS: IssueCol[] = ["type", "status", "stage", "priority", "assignee"];

/** Значение колонки для фильтра — как его видно в ячейке; пустое — "". */
function filterValue(d: Issue, col: IssueCol, stageLabel?: (i: Issue) => string): string {
  if (col === "stage") return stageLabel?.(d) ?? "";
  if (col === "type") return String(d.fields.issuetype ?? "");
  return String(d.fields[col] ?? "");
}

function matches(d: Issue, f: IssueFilter, stageLabel?: (i: Issue) => string, skip?: IssueCol): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !d.key.toLowerCase().includes(q) && !String(d.fields.summary ?? "").toLowerCase().includes(q)) return false;
  return Object.entries(f.cols).every(([c, vals]) =>
    c === skip || !vals || vals.includes(filterValue(d, c as IssueCol, stageLabel)));
}

export function filterIssueRows(rows: Issue[], f: IssueFilter, stageLabel?: (i: Issue) => string): Issue[] {
  return f.q.trim() || Object.keys(f.cols).length ? rows.filter(d => matches(d, f, stageLabel)) : rows;
}

export const isFiltered = (f: IssueFilter) => !!f.q.trim() || Object.keys(f.cols).length > 0;

/* ── Ширины колонок ── */
const MIN_W = 60;
const DEFAULT_W: Record<IssueCol, number> = {
  type: 110, key: 120, summary: 0, status: 150, stage: 180, priority: 110, assignee: 170,
};
const widthsKey = (k: string) => `st_jira_issue_table_w:${k}`;

function useWidths(key?: string) {
  const [w, setW] = useState<Partial<Record<IssueCol, number>>>({});
  useEffect(() => {
    if (!key) return;
    try { setW(JSON.parse(localStorage.getItem(widthsKey(key)) ?? "{}") ?? {}); } catch { /* по умолчанию */ }
  }, [key]);
  const save = (next: Partial<Record<IssueCol, number>>) => {
    setW(next);
    if (key) try { localStorage.setItem(widthsKey(key), JSON.stringify(next)); } catch { /* только на этот раз */ }
  };
  return [w, save] as const;
}

export function sortIssueRows(rows: Issue[], sort: IssueSort, stageRank?: (i: Issue) => number): Issue[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.col, stageRank), y = sortValue(b, sort.col, stageRank);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru")) * sort.dir;
  });
}

export default function IssueTable({
  groups, cols, initialSort, stage, stageRank, dim, picked, onPick, onSort,
  widthKey, filter, onFilter, source, stageLabel,
}: {
  /** Группы строк (уже отфильтрованные): заголовок (null — без заголовка) и задачи. */
  groups: { title: ReactNode | null; issues: Issue[] }[];
  cols: IssueCol[];
  initialSort: IssueSort;
  /** Ячейка «Статус (st)», если колонка есть. */
  stage?: (i: Issue) => ReactNode;
  stageRank?: (i: Issue) => number;
  /** Приглушить строку (например, устранённый дефект). */
  dim?: (i: Issue) => boolean;
  /** Отмеченные строки (ключи) — с ним появляется колонка галочек. */
  picked?: Set<string>;
  onPick?: (keys: string[], on: boolean) => void;
  /** Сортировка сменилась — чтобы снаружи собрать отчёт в том же порядке, что в таблице. */
  onSort?: (s: IssueSort) => void;
  /** Где запомнить ширины колонок (localStorage); нет — ширины на один показ. */
  widthKey?: string;
  /** Фильтр — с ним появляются поиск и фильтры колонок. */
  filter?: IssueFilter;
  onFilter?: (f: IssueFilter) => void;
  /** Все задачи до фильтра — из них варианты фильтров и счётчик «найдено из». */
  source?: Issue[];
  /** Подпись статуса (st) задачи — для фильтра по этой колонке. */
  stageLabel?: (i: Issue) => string;
}) {
  const [sort, setSort] = useState<IssueSort>(initialSort);
  const click = (col: IssueCol) => {
    const next: IssueSort = sort.col === col ? { col, dir: sort.dir === 1 ? -1 : 1 } : { col, dir: 1 };
    setSort(next); onSort?.(next);
  };
  const pickable = !!picked && !!onPick;
  const allKeys = groups.flatMap(g => g.issues.map(i => i.key));
  const allOn = allKeys.length > 0 && allKeys.every(k => picked?.has(k));
  const span = cols.length + (pickable ? 1 : 0);

  const [widths, setWidths] = useWidths(widthKey);
  const widthOf = (c: IssueCol) => widths[c] ?? DEFAULT_W[c];
  const drag = useRef<{ col: IssueCol; x: number; w: number } | null>(null);
  const startResize = (c: IssueCol, e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement!;
    drag.current = { col: c, x: e.clientX, w: th.getBoundingClientRect().width };
    let last = widths;
    const move = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      last = { ...widths, [d.col]: Math.max(MIN_W, Math.round(d.w + ev.clientX - d.x)) };
      setWidths(last);
    };
    const up = () => {
      drag.current = null;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      setWidths(last);
      // Отпустили мышь за краем окна — браузер шлёт click подложке, и Modal закрылся бы. Этот click гасим.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      document.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 0);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
  };
  const resetWidth = (c: IssueCol) => {
    const next = { ...widths };
    delete next[c];
    setWidths(next);
  };
  // «Наименование» без своей ширины забирает остаток; шире окна — таблица прокручивается вбок.
  const minTable = cols.reduce((sum, c) => sum + (widthOf(c) || 320), pickable ? 32 : 0);

  const filterOn = !!filter && !!onFilter;
  const all = source ?? groups.flatMap(g => g.issues);
  const shownCount = groups.reduce((n, g) => n + g.issues.length, 0);
  const options = (c: IssueCol) => (): FilterOption[] => {
    const counts = new Map<string, number>();
    for (const d of all) {
      if (!matches(d, filter!, stageLabel, c)) continue;
      const v = filterValue(d, c, stageLabel);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: value || "(пусто)" }))
      .sort((a, b) => (a.value ? 0 : 1) - (b.value ? 0 : 1) || a.label.localeCompare(b.label, "ru"));
  };
  const setCol = (c: IssueCol, vals: string[] | null) => {
    const next = { ...filter!.cols };
    if (vals === null) delete next[c]; else next[c] = vals;
    onFilter!({ ...filter!, cols: next });
  };

  return (
    <div className="space-y-2">
    {filterOn && (
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" aria-hidden />
          <input value={filter!.q} onChange={e => onFilter!({ ...filter!, q: e.target.value })}
            placeholder="Поиск по номеру и названию" aria-label="Поиск по номеру и названию"
            className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main
              placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </label>
        {isFiltered(filter!) && (
          <>
            <span className="text-xs text-text-muted">Показано {shownCount} из {all.length}</span>
            <button type="button" onClick={() => onFilter!(NO_FILTER)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <X className="w-3 h-3" /> Сбросить фильтры</button>
          </>
        )}
      </div>
    )}
    <div className="border border-border-main rounded-xl overflow-auto max-h-[60vh] scrollbar-thin">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: minTable }}>
        <colgroup>
          {pickable && <col style={{ width: 32 }} />}
          {cols.map(c => <col key={c} style={widthOf(c) ? { width: widthOf(c) } : undefined} />)}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="text-left">
            {pickable && (
              <th className="pl-3 pr-1 py-2 w-6">
                <input type="checkbox" checked={allOn} aria-label={allOn ? "Снять все" : "Отметить все"} title="Все строки"
                  onChange={e => onPick!(allKeys, e.target.checked)} />
              </th>
            )}
            {cols.map(c => (
              <th key={c} className="group/th relative px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap"
                aria-sort={sort.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <span className="flex items-center min-w-0">
                  <button type="button" onClick={() => click(c)} className="inline-flex min-w-0 items-center gap-1 uppercase hover:text-text-main">
                    <span className="truncate">{LABEL[c]}</span>
                    {sort.col === c
                      ? (sort.dir === 1 ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />)
                      : <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-40" />}
                  </button>
                  {filterOn && FILTER_COLS.includes(c) && (c !== "stage" || !!stageLabel) && (
                    <ColumnFilter label={LABEL[c]} active={!!filter!.cols[c]} selected={filter!.cols[c] ?? []}
                      options={options(c)} onChange={v => setCol(c, v)} />
                  )}
                </span>
                {/* Ручка ширины: тянуть — шире или уже, двойной щелчок — ширина по умолчанию. */}
                <span role="separator" aria-orientation="vertical" aria-label={`Ширина колонки ${LABEL[c]}`}
                  title="Потяните, чтобы изменить ширину; двойной щелчок — как было"
                  onMouseDown={e => startResize(c, e)} onDoubleClick={() => resetWidth(c)}
                  className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none
                    after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-px after:bg-border-main hover:after:bg-primary hover:after:w-0.5" />
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g, gi) => (
          <tbody key={gi}>
            {g.title !== null && (
              <tr className="border-t border-border-main bg-bg-subtle/70">
                <td colSpan={span} className="px-3 py-1.5 text-xs font-semibold text-text-muted">{g.title}</td>
              </tr>
            )}
            {sortIssueRows(g.issues, sort, stageRank).map(d => (
              <tr key={d.key} className={`border-t border-border-main ${dim?.(d) ? "opacity-60" : ""}`}>
                {pickable && (
                  <td className="pl-3 pr-1 py-1.5 w-6 align-top">
                    <input type="checkbox" checked={picked!.has(d.key)} aria-label={`Отправить в чат ${d.key}`}
                      onChange={e => onPick!([d.key], e.target.checked)} />
                  </td>
                )}
                {cols.map(c => (
                  // Переносим, а не обрезаем: узкую колонку видно целиком в несколько строк.
                  <td key={c} className="px-3 py-1.5 align-top text-text-main break-words [overflow-wrap:anywhere]">
                    {c === "type" ? <IssueTypeBadge type={String(d.fields.issuetype ?? "")} />
                      : c === "key" ? (d.url
                        ? <a href={d.url} target="_blank" rel="noreferrer" title="Открыть в Jira"
                            className="font-mono text-xs text-primary hover:underline">{d.key} ↗</a>
                        : <span className="font-mono text-xs text-primary">{d.key}</span>)
                      : c === "stage" ? stage?.(d)
                      : c === "priority" ? (
                        <span className={isBlocker(d) ? "text-red-600 dark:text-red-400 font-semibold" : ""}>{String(d.fields.priority ?? "—")}</span>
                      )
                      : String(d.fields[c] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {g.issues.length === 0 && (
              <tr className="border-t border-border-main">
                <td colSpan={span} className="px-3 py-2 text-xs text-text-muted">{filterOn && isFiltered(filter!) ? "Под фильтр ничего не попало" : "Нет"}</td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
    </div>
  );
}
