"use client";

import { AlertCircle, CheckCircle2, Hand, Loader2 } from "lucide-react";
import { XmlButtons, type XmlActions } from "./StagePanel";
import { TM_RUNNING, TM_STATUS_LABEL, type TmSession } from "@/lib/tmApi";

/**
 * Очередь по задачам: у каждой задачи своя сессия. Планы готовятся по очереди, каждая задача ждёт утверждения
 * отдельно (рука), дальше генерируется и проверяется сама. Принятые наборы — одним XML на скачивание или сразу
 * в Zephyr: у каждой задачи свой прогон.
 */
export default function TmBatchBar({ sessions, current, onOpen, xml }: {
  sessions: TmSession[];
  current: string | null;
  onOpen: (id: string) => void;
  xml: XmlActions;
}) {
  const done = sessions.filter(s => s.status === "done");
  const waiting = sessions.filter(s => s.status === "plan_ready" || s.status === "review_ready").length;
  const busy = sessions.some(s => TM_RUNNING.includes(s.status));
  return (
    <div className="mx-6 mt-4 rounded-xl border border-border-main bg-bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-text-main">Тестовая модель по задачам</p>
        <span className="text-xs text-text-muted">
          принято {done.length} из {sessions.length}{waiting ? ` · ждут вас: ${waiting}` : ""} · кейсов {done.reduce((n, s) => n + s.cases.length, 0)}
        </span>
        <span className="flex-1" />
        {!busy && done.length > 0 && (
          <>
            {done.length < sessions.length && <span className="text-xs text-text-muted">в XML — принятые: {done.length}</span>}
            <XmlButtons ids={done.map(s => s.id)} xml={xml} size="sm" />
          </>
        )}
      </div>
      {xml.error && <p className="mb-2 text-xs text-red-500">{xml.error}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {sessions.map(s => (
          <li key={s.id}>
            <button type="button" onClick={() => onOpen(s.id)} title={`${TM_STATUS_LABEL[s.status]}${s.error ? `: ${s.error}` : ""}`}
              className={`inline-flex max-w-[340px] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs hover:bg-bg-subtle
                ${s.id === current ? "border-primary bg-primary/5" : "border-border-main"}`}>
              {TM_RUNNING.includes(s.status) ? <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
                : s.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                : s.status === "error" || s.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                : <Hand className="h-3.5 w-3.5 flex-shrink-0 text-primary" />}
              <span className="flex-shrink-0 font-mono text-primary">{s.task?.key ?? "—"}</span>
              <span className="truncate text-text-main">{s.task?.summary || s.feature}</span>
              <span className="flex-shrink-0 text-text-muted">{TM_STATUS_LABEL[s.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
