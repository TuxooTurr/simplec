"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { PRIORITIES, STATUS_ORDER, isBlocker, type Issue } from "@/lib/jiraTool";
import { IssueTypeBadge } from "./ListCells";

/* Таблица задач Jira для окон «Статус (st)» и «Дефекты»: тип, номер со ссылкой в Jira,
   название, статус, приоритет, исполнитель. Колонки сортируются; задачи можно разбить
   на группы — сортировка работает внутри каждой группы. */

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

export function sortIssueRows(rows: Issue[], sort: IssueSort, stageRank?: (i: Issue) => number): Issue[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.col, stageRank), y = sortValue(b, sort.col, stageRank);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru")) * sort.dir;
  });
}

export default function IssueTable({ groups, cols, initialSort, stage, stageRank, dim }: {
  /** Группы строк: заголовок (null — без заголовка) и задачи. */
  groups: { title: ReactNode | null; issues: Issue[] }[];
  cols: IssueCol[];
  initialSort: IssueSort;
  /** Ячейка «Статус (st)», если колонка есть. */
  stage?: (i: Issue) => ReactNode;
  stageRank?: (i: Issue) => number;
  /** Приглушить строку (например, устранённый дефект). */
  dim?: (i: Issue) => boolean;
}) {
  const [sort, setSort] = useState<IssueSort>(initialSort);
  const click = (col: IssueCol) => setSort(s => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));

  return (
    <div className="border border-border-main rounded-xl overflow-auto max-h-[60vh] scrollbar-thin">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="text-left">
            {cols.map(c => (
              <th key={c} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap"
                aria-sort={sort.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => click(c)} className="inline-flex items-center gap-1 uppercase hover:text-text-main">
                  {LABEL[c]}
                  {sort.col === c
                    ? (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                    : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g, gi) => (
          <tbody key={gi}>
            {g.title !== null && (
              <tr className="border-t border-border-main bg-bg-subtle/70">
                <td colSpan={cols.length} className="px-3 py-1.5 text-xs font-semibold text-text-muted">{g.title}</td>
              </tr>
            )}
            {sortIssueRows(g.issues, sort, stageRank).map(d => (
              <tr key={d.key} className={`border-t border-border-main ${dim?.(d) ? "opacity-60" : ""}`}>
                {cols.map(c => (
                  <td key={c} className={`px-3 py-1.5 ${c === "summary" ? "text-text-main" : "whitespace-nowrap text-text-main"}`}>
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
              <tr className="border-t border-border-main"><td colSpan={cols.length} className="px-3 py-2 text-xs text-text-muted">Нет</td></tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}
