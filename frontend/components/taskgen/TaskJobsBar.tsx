"use client";

import { AlertCircle, CheckCircle2, Clock, Loader2, Play, Send } from "lucide-react";
import type { TaskJob } from "@/lib/taskModel";

/**
 * Очередь генерации по задачам над экраном генерации и результата: что готово, что идёт, что упало. Щелчок по готовой
 * задаче показывает её кейсы. Когда очередь закончилась — переход к выгрузке в модель.
 */
export default function TaskJobsBar({ jobs, current, onOpen, onContinue, onExport }: {
  jobs: TaskJob[];
  /** Сессия на экране — её задача подсвечена. */
  current: string | null;
  onOpen: (job: TaskJob) => void;
  onContinue: () => void;
  onExport: () => void;
}) {
  const running = jobs.some(j => j.status === "run");
  const stuck = !running && jobs.some(j => j.status === "wait" || j.status === "error");
  const done = jobs.filter(j => j.status === "done");
  const total = done.reduce((n, j) => n + (j.caseCount ?? 0), 0);
  return (
    <div className="mx-6 mt-4 rounded-xl border border-border-main bg-bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-text-main">Генерация по задачам</p>
        <span className="text-xs text-text-muted">готово {done.length} из {jobs.length} · кейсов {total}</span>
        <span className="flex-1" />
        {stuck && (
          <button type="button" onClick={onContinue} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
            <Play className="h-4 w-4" /> Продолжить</button>
        )}
        {!running && done.length > 0 && (
          <button type="button" onClick={onExport} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white">
            <Send className="h-4 w-4" /> Выгрузить в модель</button>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {jobs.map(j => {
          const can = !running && j.status === "done" && !!j.sessionId;
          return (
            <li key={j.key}>
              <button type="button" disabled={!can} onClick={() => onOpen(j)} title={j.error || j.summary}
                className={`inline-flex max-w-[320px] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs
                  ${j.sessionId && j.sessionId === current ? "border-primary bg-primary/5" : "border-border-main"} ${can ? "hover:bg-bg-subtle" : "cursor-default"}`}>
                {j.status === "run" ? <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
                  : j.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                  : j.status === "error" ? <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                  : <Clock className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
                <span className="flex-shrink-0 font-mono text-primary">{j.key}</span>
                <span className="truncate text-text-main">{j.summary}</span>
                {j.status === "done" && <span className="flex-shrink-0 tabular-nums text-text-muted">{j.caseCount ?? 0}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
