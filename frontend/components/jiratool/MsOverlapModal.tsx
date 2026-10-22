"use client";

import Modal from "@/components/ui/Modal";
import type { Issue, MsOverlap } from "@/lib/jiraTool";
import type { StageInfo } from "@/lib/jiraStages";
import { StageBadge } from "./ListCells";

/**
 * Пересечения по микросервисам в списке: по каждому микросервису, который указан у нескольких задач, — его задачи
 * с названием и статусом (st). Чтобы увидеть, какие фичи трогают один сервис (одна установка, общие риски).
 */
export default function MsOverlapModal({ open, overlaps, issueOf, stageOf, info, onClose }: {
  open: boolean;
  overlaps: MsOverlap[];
  issueOf: (key: string) => Issue | undefined;
  stageOf: (i: Issue) => StageInfo;
  /** Описания микросервисов из справочника. */
  info: Record<string, string>;
  onClose: () => void;
}) {
  const features = new Set(overlaps.flatMap(o => o.keys)).size;
  return (
    <Modal open={open} onClose={onClose} title={`Пересечения по микросервисам: ${overlaps.length}`} size="max-w-3xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Микросервисы, указанные у нескольких задач списка (поле «Микросервисы (st)»): {overlaps.length}, задач в них — {features}.
        </p>
        {overlaps.length === 0 && (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
            Пересечений нет: каждый микросервис указан не больше чем у одной задачи.</p>
        )}
        {overlaps.map(o => (
          <section key={o.service} className="rounded-xl border border-border-main overflow-hidden">
            <header className="flex flex-wrap items-baseline gap-2 px-3 py-2 bg-amber-500/10 border-b border-border-main">
              <span className="font-mono text-sm font-semibold text-amber-800 dark:text-amber-300">{o.service}</span>
              <span className="text-xs text-text-muted">задач: {o.keys.length}</span>
              {info[o.service] && <span className="text-xs text-text-muted truncate min-w-0 flex-1" title={info[o.service]}>· {info[o.service]}</span>}
            </header>
            <ul className="divide-y divide-border-main">
              {o.keys.map(k => {
                const i = issueOf(k);
                return (
                  <li key={k} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    {i?.url && /^https?:/.test(i.url)
                      ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline whitespace-nowrap">{k}</a>
                      : <span className="font-mono text-primary whitespace-nowrap">{k}</span>}
                    <span className="min-w-0 flex-1 truncate text-text-main" title={String(i?.fields.summary ?? "")}>
                      {i ? String(i.fields.summary ?? "") : <span className="text-text-muted">задача не загружена</span>}</span>
                    {i && <StageBadge info={stageOf(i)} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
