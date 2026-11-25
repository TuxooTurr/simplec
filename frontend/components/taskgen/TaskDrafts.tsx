"use client";

import { useState } from "react";
import { AlertTriangle, ChevronRight, X } from "lucide-react";
import { Select } from "@/components/ui";
import { featureOf, type TaskDoc, type TaskDraft } from "@/lib/taskModel";

/**
 * Выбранные задачи в форме генерации: всё предзаполнено из задачи и её требований, у каждой можно поправить название
 * фичи и текст. Не из чего генерировать (нет ни требований, ни описания) — задача подсвечена и пропускается.
 */
export default function TaskDrafts({ tasks, available, onChange }: { tasks: TaskDraft[]; available: TaskDoc[]; onChange: (tasks: TaskDraft[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const patch = (key: string, p: Partial<TaskDraft>) => onChange(tasks.map(t => (t.key === key ? { ...t, ...p } : t)));
  return (
    <ul className="divide-y divide-border-main rounded-lg border border-border-main">
      {tasks.map(t => {
        const on = open === t.key;
        const empty = !t.docs.some(d => d.text.trim());
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
                {empty ? "нет приложенных требований" : `требований: ${t.docs.length}`}
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
                <div>
                  <p className="mb-1 text-xs text-text-muted">Приложенные требования</p>
                  <ul className="mb-2 space-y-1">
                    {t.docs.map(d => <li key={d.id} className="flex items-center gap-1.5 text-xs">
                      <span className="min-w-0 flex-1 break-words">{d.name}</span>
                      <button type="button" className="p-0.5 hover:text-red-500" aria-label={"Убрать " + d.name} onClick={() => {
                        const docs = t.docs.filter(doc => doc.id !== d.id);
                        const dataPath = docs.find(doc => doc.dataPath.length)?.dataPath ?? [];
                        patch(t.key, { docs, dataPath, feature: featureOf({ ...t, docs, dataPath }) });
                      }}><X className="w-3.5 h-3.5" /></button>
                    </li>)}
                  </ul>
                  <Select searchable aria-label="Добавить требование из Данных" value="" onChange={id => {
                    const item = available.find(d => d.id === id);
                    if (!item) return;
                    const docs = [...t.docs, item];
                    const dataPath = docs.find(doc => doc.dataPath.length)?.dataPath ?? [];
                    patch(t.key, { docs, dataPath, feature: featureOf({ ...t, docs, dataPath }) });
                  }}>
                    <option value="">Добавить из «Данных»</option>
                    {available.filter(d => d.text.trim() && !t.docs.some(doc => doc.id === d.id)).map(d =>
                      <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </div>
                {t.docs.filter(d => d.versions?.length).map(d => <div key={d.id}>
                  <p className="text-xs text-text-muted mb-1">{d.name}</p>
                  <Select aria-label={`Версия требования ${d.name}`} value={t.docVersions?.[d.id] ?? d.version ?? 1}
                    onChange={value => patch(t.key, { docVersions: { ...t.docVersions, [d.id]: Number(value) } })}>
                    <option value={d.version ?? 1}>Текущая · V{d.version ?? 1}</option>
                    {d.versions?.map(v => <option key={v.n} value={v.n}>V{v.n}</option>)}
                  </Select>
                </div>)}
                {t.docs.filter(d => d.releases?.length).map(d => <div key={"release-" + d.id}>
                  <p className="text-xs text-text-muted mb-1">{d.name} · версия содержания</p>
                  <Select aria-label={"Версия содержания " + d.name} value={t.contentVersions?.[d.id] ?? ""}
                    onChange={id => patch(t.key, { contentVersions: { ...t.contentVersions, [d.id]: id } })}>
                    <option value="">Все версии</option>
                    {d.releases?.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}
                  </Select>
                </div>)}
                <label className="block text-xs text-text-muted">Версия или область проверок
                  <input maxLength={300} value={t.versionHint ?? ""} onChange={e => patch(t.key, { versionHint: e.target.value })}
                    placeholder="Например, только V2 и инструмент поиска"
                    className="mt-1 w-full rounded-lg border border-border-main bg-bg-card px-2.5 py-1.5 text-sm" />
                </label>
                <label className="block text-xs text-text-muted">Дополнение к требованиям
                  <textarea value={t.text} onChange={e => patch(t.key, { text: e.target.value })} rows={8}
                    className="mt-1 w-full resize-y rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 font-mono text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
                <p className="text-[11px] text-text-muted">
                  {t.dataPath.length ? `Папка в «Данных»: ${t.dataPath.join(" / ")}` : "Требование не в папке «Данных» — папку в модели выберете в предпросмотре"}
                </p>
                {empty && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Чтобы начать планирование, добавьте непустое требование из «Данных».
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
