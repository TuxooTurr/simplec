"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { PRIORITIES, STATUS_ORDER, blockersOf, isOpenDefect, type Issue } from "@/lib/jiraTool";

type Col = "key" | "summary" | "status" | "priority" | "assignee";

const COLS: { id: Col; label: string }[] = [
  { id: "key", label: "Код" },
  { id: "summary", label: "Название" },
  { id: "status", label: "Статус" },
  { id: "priority", label: "Приоритет" },
  { id: "assignee", label: "Исполнитель" },
];

function sortValue(d: Issue, col: Col): string | number {
  if (col === "key") return Number(d.key.split("-")[1]) || 0;
  if (col === "status") return STATUS_ORDER.indexOf(String(d.fields.status ?? ""));
  if (col === "priority") return PRIORITIES.indexOf(String(d.fields.priority ?? ""));
  return String(d.fields[col] ?? "").toLowerCase() || "￿";
}

/**
 * Дефекты задачи: привязанные через Epic Link или связь. По умолчанию — только неустранённые
 * (всё, кроме «Подтверждено исправление» и «Закрыт»); галочка показывает и устранённые.
 * Все колонки сортируются.
 */
export default function DefectsModal({ open, issue, defects, onClose }: {
  open: boolean;
  issue: Issue;
  defects: Issue[];
  onClose: () => void;
}) {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "priority", dir: 1 });
  const [showFixed, setShowFixed] = useState(false);
  const shown = showFixed ? defects : defects.filter(isOpenDefect);
  const rows = [...shown].sort((a, b) => {
    const x = sortValue(a, sort.col), y = sortValue(b, sort.col);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru")) * sort.dir;
  });
  const open_ = defects.filter(isOpenDefect).length;
  const blockers = blockersOf(defects).length;
  const click = (col: Col) => setSort(s => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));

  return (
    <Modal open={open} onClose={onClose} title={`Дефекты ${issue.key}`} size="max-w-4xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          {String(issue.fields.summary ?? "")} · неустранённых {open_}, устранённых {defects.length - open_}
          {blockers > 0 && <b className="text-red-600 dark:text-red-400"> · блокирующих {blockers}</b>}.
          {issue.fields.issuetype === "Epic" ? " Считаются дефекты с Epic Link на эпик и связанные с ним." : " Считаются связанные дефекты."}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
          <input type="checkbox" checked={showFixed} onChange={e => setShowFixed(e.target.checked)} />
          Показать устранённые <span className="text-text-muted">(«Подтверждено исправление», «Закрыт»)</span>
        </label>
        {shown.length === 0 ? (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
            {defects.length ? "Неустранённых дефектов нет." : "Дефектов нет."}
          </p>
        ) : (
          <div className="border border-border-main rounded-xl overflow-auto max-h-[60vh] scrollbar-thin">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="text-left">
                  {COLS.map(c => (
                    <th key={c.id} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap"
                      aria-sort={sort.col === c.id ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                      <button type="button" onClick={() => click(c.id)} className="inline-flex items-center gap-1 uppercase hover:text-text-main">
                        {c.label}
                        {sort.col === c.id
                          ? (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.key} className={`border-t border-border-main ${isOpenDefect(d) ? "" : "opacity-60"}`}>
                    <td className="px-3 py-1.5 font-mono text-xs text-primary whitespace-nowrap">{d.key}</td>
                    <td className="px-3 py-1.5 text-text-main">{String(d.fields.summary ?? "")}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-text-main">{String(d.fields.status ?? "")}</td>
                    <td className={`px-3 py-1.5 whitespace-nowrap ${blockersOf([d]).length ? "text-red-600 dark:text-red-400 font-semibold" : "text-text-main"}`}>{String(d.fields.priority ?? "")}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-text-main">{String(d.fields.assignee ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
