"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { zText, type CaseEditIn, type ZCaseFull } from "@/lib/zephyrApi";

/** Текст из поля ввода → HTML для Zephyr: спецсимволы экранируем, переносы строк — <br>. */
const toHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const list = (t: string) => t.split(/[,\n]/).map(x => x.trim()).filter(Boolean);

type Step = { description: string; testData: string; expectedResult: string };

const INPUT = "w-full text-sm px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const LBL = "block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1";

/**
 * Редактор кейса (и форма нового). В Jira уходят только изменённые поля: тексты Zephyr хранит HTML-ом, а здесь
 * правятся как обычный текст — непереданные поля сохраняют своё форматирование. Шаги уходят целиком, если менялись.
 */
export default function CaseEditor({ initial, folder, busy, error, onSave, onCancel }: {
  /** Кейс для правки; нет — новый кейс. */
  initial?: ZCaseFull;
  /** Папка нового кейса. */
  folder?: string;
  busy: boolean;
  error: string;
  onSave: (edit: CaseEditIn) => void;
  onCancel: () => void;
}) {
  const start = {
    name: initial?.name ?? "",
    status: initial?.status ?? "Draft",
    priority: initial?.priority ?? "Normal",
    labels: (initial?.labels ?? []).join(", "),
    issueLinks: (initial?.issueLinks ?? []).join(", "),
    objective: zText(initial?.objective ?? ""),
    precondition: zText(initial?.precondition ?? ""),
  };
  const startSteps: Step[] = (initial?.steps ?? []).map(s => ({ description: zText(s.description), testData: zText(s.testData), expectedResult: zText(s.expectedResult) }));
  const [f, setF] = useState(start);
  const [steps, setSteps] = useState<Step[]>(startSteps.length ? startSteps : initial ? [] : [{ description: "", testData: "", expectedResult: "" }]);
  const set = (k: keyof typeof start, v: string) => setF(x => ({ ...x, [k]: v }));
  const stepsChanged = JSON.stringify(steps) !== JSON.stringify(startSteps);

  const save = () => {
    const e: CaseEditIn = {};
    const isNew = !initial;
    if (isNew || f.name !== start.name) e.name = f.name.trim();
    if (isNew || f.status !== start.status) e.status = f.status.trim();
    if (isNew || f.priority !== start.priority) e.priority = f.priority.trim();
    if (isNew || f.labels !== start.labels) e.labels = list(f.labels);
    if (isNew || f.issueLinks !== start.issueLinks) e.issueLinks = list(f.issueLinks).map(x => x.toUpperCase());
    if (f.objective !== start.objective) e.objective = toHtml(f.objective);
    if (f.precondition !== start.precondition) e.precondition = toHtml(f.precondition);
    if (stepsChanged) e.steps = steps.filter(s => s.description.trim() || s.expectedResult.trim())
      .map(s => ({ description: toHtml(s.description), testData: toHtml(s.testData), expectedResult: toHtml(s.expectedResult) }));
    if (isNew && folder) e.folder = folder;
    onSave(e);
  };
  const dirty = !initial || stepsChanged || (Object.keys(start) as (keyof typeof start)[]).some(k => f[k] !== start[k]);
  const moveStep = (i: number, d: -1 | 1) => setSteps(s => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const setStep = (i: number, k: keyof Step, v: string) => setSteps(s => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div className="space-y-3">
      {!initial && folder && <p className="text-xs text-text-muted">Новый кейс в папке <b className="text-text-main font-medium">{folder}</b></p>}
      <div><label className={LBL} htmlFor="ce-name">Название</label>
        <input id="ce-name" value={f.name} onChange={e => set("name", e.target.value)} className={INPUT} autoFocus={!initial} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={LBL} htmlFor="ce-status">Статус</label>
          <input id="ce-status" list="ce-statuses" value={f.status} onChange={e => set("status", e.target.value)} className={INPUT} />
          <datalist id="ce-statuses"><option value="Draft" /><option value="Approved" /><option value="Deprecated" /></datalist></div>
        <div><label className={LBL} htmlFor="ce-prio">Приоритет</label>
          <input id="ce-prio" list="ce-prios" value={f.priority} onChange={e => set("priority", e.target.value)} className={INPUT} />
          <datalist id="ce-prios"><option value="High" /><option value="Normal" /><option value="Low" /></datalist></div>
      </div>
      <div><label className={LBL} htmlFor="ce-labels">Метки — через запятую</label>
        <input id="ce-labels" value={f.labels} onChange={e => set("labels", e.target.value)} className={INPUT} /></div>
      <div><label className={LBL} htmlFor="ce-links">Связи с Jira — ключи через запятую</label>
        <input id="ce-links" value={f.issueLinks} onChange={e => set("issueLinks", e.target.value)} placeholder="SBER911-12345" className={`${INPUT} font-mono`} /></div>
      <div><label className={LBL} htmlFor="ce-obj">Цель</label>
        <textarea id="ce-obj" rows={2} value={f.objective} onChange={e => set("objective", e.target.value)} className={`${INPUT} resize-y`} /></div>
      <div><label className={LBL} htmlFor="ce-pre">Предусловие</label>
        <textarea id="ce-pre" rows={2} value={f.precondition} onChange={e => set("precondition", e.target.value)} className={`${INPUT} resize-y`} /></div>
      <div>
        <p className={LBL}>Шаги · {steps.length}</p>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="rounded-lg border border-border-main p-2 space-y-1.5">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-text-muted">Шаг {i + 1}</span>
                <span className="ml-auto flex gap-0.5">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label={`Шаг ${i + 1} выше`} className="p-1 rounded text-text-muted hover:text-text-main disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} aria-label={`Шаг ${i + 1} ниже`} className="p-1 rounded text-text-muted hover:text-text-main disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setSteps(x => x.filter((_, j) => j !== i))} aria-label={`Удалить шаг ${i + 1}`} className="p-1 rounded text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              </div>
              <textarea rows={2} value={s.description} onChange={e => setStep(i, "description", e.target.value)} placeholder="Действие" aria-label={`Действие шага ${i + 1}`} className={`${INPUT} resize-y`} />
              <textarea rows={1} value={s.testData} onChange={e => setStep(i, "testData", e.target.value)} placeholder="Тестовые данные" aria-label={`Данные шага ${i + 1}`} className={`${INPUT} resize-y`} />
              <textarea rows={2} value={s.expectedResult} onChange={e => setStep(i, "expectedResult", e.target.value)} placeholder="Ожидаемый результат" aria-label={`Ожидаемый результат шага ${i + 1}`} className={`${INPUT} resize-y`} />
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setSteps(s => [...s, { description: "", testData: "", expectedResult: "" }])}
          className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="w-3.5 h-3.5" /> шаг</button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">Не сохранилось: {error}</p>}
      <div className="flex justify-end gap-2 pt-1 sticky bottom-0 bg-bg-card py-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
        <button type="button" onClick={save} disabled={busy || !f.name.trim() || !dirty}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {initial ? "Сохранить в Jira" : "Создать в Jira"}</button>
      </div>
    </div>
  );
}
