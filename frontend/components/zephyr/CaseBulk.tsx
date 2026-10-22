"use client";

import { useEffect, useRef, useState } from "react";
import { Columns3, Loader2, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Floating from "@/components/jiratool/Floating";
import { editCases, getFieldValues, type CasesEditIn, deleteCasesChunked } from "@/lib/zephyrApi";

const INPUT = "w-full text-sm px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const LBL = "block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1";

/** Статус кейса меткой: утверждён — зелёный, черновик — жёлтый, устарел — серый (API отдаёт английские названия). */
export function CaseStatus({ status }: { status: string }) {
  if (!status) return <span className="text-text-muted">—</span>;
  const s = status.toLowerCase();
  const cls = /approved|утвержд/.test(s) ? "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/30"
    : /draft|черновик/.test(s) ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
    : /deprecat|устар/.test(s) ? "bg-bg-subtle text-text-muted border-border-main line-through"
    : "bg-primary/10 text-primary border-primary/30";
  const ru: Record<string, string> = { approved: "Утверждено", draft: "Черновик", deprecated: "Устарел" };
  return <span title={status} className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${cls}`}>{ru[s] ?? status}</span>;
}

/* ── Колонки списка кейсов ─────────────────────────────────────────────── */

export type CaseCol = "status" | "priority" | "owner" | "duration" | "folder" | "updated" | "labels";
export const CASE_COLS: { id: CaseCol; label: string }[] = [
  { id: "status", label: "Статус" }, { id: "priority", label: "Приоритет" }, { id: "duration", label: "Длительность" },
  { id: "owner", label: "Владелец" }, { id: "folder", label: "Папка" }, { id: "labels", label: "Метки" }, { id: "updated", label: "Изменён" },
];
const DEFAULT_COLS: CaseCol[] = ["status", "priority", "duration", "owner"];
const COLS_KEY = "st_zephyr_case_cols";

/** Какие колонки показывать — запоминается в браузере. Ключ и название видны всегда. */
export function useCaseCols(): [Set<CaseCol>, (c: CaseCol) => void] {
  const [cols, setCols] = useState<Set<CaseCol>>(new Set(DEFAULT_COLS));
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
      if (Array.isArray(v)) setCols(new Set(v.filter((x: string) => CASE_COLS.some(c => c.id === x)) as CaseCol[]));
    } catch { /* по умолчанию */ }
  }, []);
  const toggle = (c: CaseCol) => setCols(o => {
    const n = new Set(o);
    if (n.has(c)) n.delete(c); else n.add(c);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(CASE_COLS.map(x => x.id).filter(x => n.has(x)))); } catch { /* не запомнится */ }
    return n;
  });
  return [cols, toggle];
}

/** Кнопка «Колонки»: показать или скрыть поля списка кейсов. */
export function ColumnsMenu({ cols, onToggle }: { cols: Set<CaseCol>; onToggle: (c: CaseCol) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Показать или скрыть поля"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle whitespace-nowrap">
        <Columns3 className="w-3.5 h-3.5" /> Колонки</button>
      {open && (
        <Floating anchor={btn} onClose={() => setOpen(false)} width={200} role="menu" ariaLabel="Колонки списка кейсов">
          <div className="p-1">
            {CASE_COLS.map(c => (
              <label key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-text-main hover:bg-bg-subtle cursor-pointer select-none">
                <input type="checkbox" checked={cols.has(c.id)} onChange={() => onToggle(c.id)} /> {c.label}
              </label>
            ))}
          </div>
        </Floating>
      )}
    </>
  );
}

/* ── Несколько кейсов: правка и удаление (сразу в Jira) ───────────────── */

type BulkResult = { ok: number; errors: { key: string; error: string }[] };

/** Правка нескольких кейсов: статус, приоритет, добавить метки, пользовательское поле. Пустое поле — не трогаем. */
export function BulkEditModal({ project, keys, onDone, onClose }: {
  project: string; keys: string[]; onDone: (r: BulkResult) => void; onClose: () => void;
}) {
  const [values, setValues] = useState<{ statuses: string[]; fields: Record<string, string[]> } | null>(null);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [labels, setLabels] = useState("");
  const [field, setField] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { getFieldValues(project).then(setValues).catch(e => setErr((e as Error).message)); }, [project]);

  const edit: CasesEditIn = {};
  if (status) edit.status = status;
  if (priority) edit.priority = priority;
  const add = labels.split(",").map(x => x.trim()).filter(Boolean);
  if (add.length) edit.labelsAdd = add;
  if (field && fieldValue) edit.customFields = { [field]: fieldValue === "Да" ? true : fieldValue === "Нет" ? false : fieldValue };
  const empty = !Object.keys(edit).length;

  const save = async () => {
    setBusy(true); setErr("");
    try { const r = await editCases(project, keys, edit); onDone({ ok: r.updated.length, errors: r.errors }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const boolField = (f: string) => (values?.fields[f] ?? []).every(v => v === "Да" || v === "Нет");

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Изменить кейсы · ${keys.length}`} size="max-w-lg">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-text-muted">Пустые поля не меняются. Изменения сразу уходят в Jira.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LBL} htmlFor="be-status">Статус</label>
            <select id="be-status" value={status} onChange={e => setStatus(e.target.value)} className={INPUT}>
              <option value="">Не менять</option>
              {(values?.statuses ?? ["Approved", "Draft", "Deprecated"]).map(x => <option key={x} value={x}>{x}</option>)}
            </select></div>
          <div><label className={LBL} htmlFor="be-prio">Приоритет</label>
            <select id="be-prio" value={priority} onChange={e => setPriority(e.target.value)} className={INPUT}>
              <option value="">Не менять</option>
              {["High", "Normal", "Low"].map(x => <option key={x} value={x}>{x}</option>)}
            </select></div>
        </div>
        <div><label className={LBL} htmlFor="be-labels">Добавить метки — через запятую</label>
          <input id="be-labels" value={labels} onChange={e => setLabels(e.target.value)} className={INPUT} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LBL} htmlFor="be-field">Поле Zephyr</label>
            <select id="be-field" value={field} onChange={e => { setField(e.target.value); setFieldValue(""); }} className={INPUT}>
              <option value="">Не менять</option>
              {Object.keys(values?.fields ?? {}).map(f => <option key={f} value={f}>{f}</option>)}
            </select></div>
          <div><label className={LBL} htmlFor="be-value">Значение</label>
            {field && boolField(field) ? (
              <select id="be-value" value={fieldValue} onChange={e => setFieldValue(e.target.value)} className={INPUT}>
                <option value="">—</option><option value="Да">Да</option><option value="Нет">Нет</option>
              </select>
            ) : (
              <input id="be-value" list="be-values" value={fieldValue} onChange={e => setFieldValue(e.target.value)} disabled={!field} className={INPUT} />
            )}
            <datalist id="be-values">{(values?.fields[field] ?? []).map(v => <option key={v} value={v} />)}</datalist>
          </div>
        </div>
        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отмена</button>
          <button type="button" onClick={save} disabled={busy || empty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-40">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Сохранить в Jira ({keys.length})</button>
        </div>
      </div>
    </Modal>
  );
}

/** Удаление нескольких кейсов — с подтверждением: отменить нельзя. */
export function DeleteCasesModal({ project, keys, onDone, onClose }: {
  project: string; keys: string[]; onDone: (r: BulkResult) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const go = async () => {
    setBusy(true); setErr("");
    // Пачками: выбрать можно тысячи кейсов, сервер за раз берёт до 500, а ждать без прогресса долго.
    try { const r = await deleteCasesChunked(project, keys, (done, total) => setProg({ done, total })); onDone({ ok: r.deleted.length, errors: r.errors }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal open onClose={() => !busy && onClose()} title={`Удалить кейсы · ${keys.length}`} size="max-w-md">
      <div className="space-y-3 text-sm">
        <p className="text-text-main">Удалить из Zephyr {keys.length === 1 ? `кейс ${keys[0]}` : `${keys.length} кейсов`}? Отменить будет нельзя.</p>
        {keys.length > 1 && <p className="max-h-32 overflow-y-auto scrollbar-thin rounded-lg bg-bg-subtle p-2 font-mono text-xs text-text-muted">{keys.join(", ")}</p>}
        {prog && keys.length > 100 && <p className="text-xs text-text-muted tabular-nums">Удалено пачками: {prog.done} из {prog.total}</p>}
        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отмена</button>
          <button type="button" onClick={go} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Удалить</button>
        </div>
      </div>
    </Modal>
  );
}
