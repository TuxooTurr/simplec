"use client";

import { Bug, Flag, SquareCheck } from "lucide-react";
import { fmtDay, isOverdue, type AqaEpic } from "@/lib/aqaApi";

/** Роадмап классическим списком: эпик — заголовком группы, под ним задачи и дефекты с датами и исполнителем. */
export default function RoadmapList({ epics }: { epics: AqaEpic[] }) {
  const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap";
  return (
    <div className="border border-border-main rounded-xl overflow-auto scrollbar-thin bg-bg-card">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="text-left">
            <th className={TH}>Номер</th><th className={TH}>Название</th><th className={TH}>Тип</th><th className={TH}>Статус</th>
            <th className={TH}>Исполнитель</th><th className={TH}>Создана</th><th className={TH}>Срок</th><th className={TH}>Решена</th>
          </tr>
        </thead>
        {epics.map(e => (
          <tbody key={e.key}>
            <tr className="border-t border-border-main bg-bg-subtle/70">
              <td colSpan={8} className="px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <Flag className="w-3.5 h-3.5 text-violet-500" />
                  {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">{e.key}</a>
                    : <span className="font-mono text-xs text-primary">{e.key}</span>}
                  <span className="font-semibold text-text-main">{e.missing ? "не найден в Jira" : e.summary}</span>
                  {e.status && <span className="text-xs text-text-muted">· {e.status}</span>}
                  <span className="ml-auto text-xs text-text-muted">задач и дефектов: {e.issues.length}</span>
                </span>
              </td>
            </tr>
            {e.issues.map(i => (
              <tr key={i.key} className={`border-t border-border-main align-top ${i.statusCategory === "done" ? "opacity-60" : ""}`}>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">{i.key} ↗</a>
                </td>
                <td className="px-3 py-1.5 text-text-main min-w-[280px]">{i.summary}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1 text-xs ${i.defect ? "text-red-600 dark:text-red-400" : "text-text-main"}`}>
                    {i.defect ? <Bug className="w-3.5 h-3.5" /> : <SquareCheck className="w-3.5 h-3.5 text-blue-500" />}{i.type}</span>
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-text-main">{i.status}</td>
                <td className="px-3 py-1.5 text-text-main">{i.assignee || <span className="text-text-muted">—</span>}</td>
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-text-main">{fmtDay(i.created)}</td>
                <td className={`px-3 py-1.5 whitespace-nowrap tabular-nums ${isOverdue(i) ? "text-red-600 dark:text-red-400 font-semibold" : "text-text-main"}`}
                  title={isOverdue(i) ? "Срок прошёл, задача не решена" : undefined}>{fmtDay(i.due)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-text-main">{fmtDay(i.resolved)}</td>
              </tr>
            ))}
            {e.issues.length === 0 && (
              <tr className="border-t border-border-main"><td colSpan={8} className="px-3 py-2 text-xs text-text-muted">Задач и дефектов нет</td></tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}
