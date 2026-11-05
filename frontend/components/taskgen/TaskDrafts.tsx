"use client";

import { useState } from "react";
import { AlertTriangle, ChevronRight, X } from "lucide-react";
import type { TaskDraft } from "@/lib/taskModel";

/**
 * Выбранные задачи в форме генерации: всё предзаполнено из задачи и её требований, у каждой можно поправить название
 * фичи и текст. Не из чего генерировать (нет ни требований, ни описания) — задача подсвечена и пропускается.
 */
export default function TaskDrafts({ tasks, onChange }: { tasks: TaskDraft[]; onChange: (tasks: TaskDraft[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const patch = (key: string, p: Partial<TaskDraft>) => onChange(tasks.map(t => (t.key === key ? { ...t, ...p } : t)));
  return (
    <ul className="divide-y divide-border-main rounded-lg border border-border-main">
      {tasks.map(t => {
        const on = open === t.key;
        const empty = !t.text.trim();
        return (
          <li key={t.key} className="text-sm">
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => setOpen(on ? null : t.key)} aria-expanded={on} aria-label={`Что пойдёт в генерацию: ${t.key}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${on ? "rotate-90" : ""}`} />
                <span className="flex-shrink-0 font-mono text-xs text-primary">{t.key}</span>
                <span className="truncate text-text-main">{t.summary}</span>
              </button>
              <span className={`flex-shrink-0 text-[11px] ${empty || !t.docs.length ? "text-amber-700 dark:text-amber-400" : "text-text-muted"}`}>
                {t.docs.length ? `требований: ${t.docs.length}` : empty ? "не из чего генерировать" : "по описанию задачи"}
              </span>
              <button type="button" onClick={() => onChange(tasks.filter(x => x.key !== t.key))} aria-label={`Убрать ${t.key}`} title="Убрать из генерации"
                className="flex-shrink-0 rounded p-0.5 text-text-muted hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
            </div>
            {on && (
              <div className="space-y-2 border-t border-border-main bg-bg-subtle/40 px-3 py-2.5">
                <label className="block text-xs text-text-muted">Название фичи — пойдёт в имена кейсов
                  <input value={t.feature} onChange={e => patch(t.key, { feature: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
                <label className="block text-xs text-text-muted">Что получит модель
                  <textarea value={t.text} onChange={e => patch(t.key, { text: e.target.value })} rows={8}
                    className="mt-1 w-full resize-y rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 font-mono text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
                <p className="text-[11px] text-text-muted">
                  {t.dataPath.length ? `Папка в «Данных»: ${t.dataPath.join(" / ")}` : "Требование не в папке «Данных» — папку в модели выберете в предпросмотре"}
                </p>
                {empty && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Привяжите требование в Jira tool или впишите текст сюда
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
