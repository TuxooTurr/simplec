"use client";

import { useEffect, useRef, useState } from "react";
import { Columns3, Loader2, Plus, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Floating from "@/components/jiratool/Floating";
import { editCases, getFieldValues, type CasesEditIn, deleteCasesChunked, type ZFieldKind, type ZFieldValues } from "@/lib/zephyrApi";
import { STD_COLS, cfCol, isCfCol, type CaseColId } from "@/lib/zephyrCaseFilter";

const INPUT = "w-full text-sm px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

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

const DEFAULT_COLS: CaseColId[] = ["status", "priority", "duration", "owner"];
const COLS_KEY = "st_zephyr_case_cols";

/**
 * Какие колонки показывать — по порядку, запоминается в браузере. Ключ и название видны всегда.
 * Колонка — стандартное поле или пользовательское («cf:Имя»): по каждой видимой — сортировка и фильтр.
 */
export function useCaseCols(): [CaseColId[], (c: CaseColId) => void] {
  const [cols, setCols] = useState<CaseColId[]>(DEFAULT_COLS);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
      if (Array.isArray(v)) setCols(v.filter((x: unknown): x is string => typeof x === "string" && (isCfCol(x) || STD_COLS.some(c => c.id === x))));
    } catch { /* по умолчанию */ }
  }, []);
  const toggle = (c: CaseColId) => setCols(o => {
    const n = o.includes(c) ? o.filter(x => x !== c) : [...o, c];
    try { localStorage.setItem(COLS_KEY, JSON.stringify(n)); } catch { /* не запомнится */ }
    return n;
  });
  return [cols, toggle];
}

/** Кнопка «Колонки»: стандартные поля и все пользовательские поля, что есть у кейсов списка. */
export function ColumnsMenu({ cols, custom, onToggle }: { cols: CaseColId[]; custom: string[]; onToggle: (c: CaseColId) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const item = (id: CaseColId, label: string) => (
    <label key={id} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-text-main hover:bg-bg-subtle cursor-pointer select-none">
      <input type="checkbox" checked={cols.includes(id)} onChange={() => onToggle(id)} /> <span className="truncate">{label}</span>
    </label>
  );
  const std = STD_COLS.filter(c => !s || c.label.toLowerCase().includes(s));
  const cf = custom.filter(n => !s || n.toLowerCase().includes(s));
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Показать или скрыть поля: по видимым — сортировка и фильтр"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle whitespace-nowrap">
        <Columns3 className="w-3.5 h-3.5" /> Колонки</button>
      {open && (
        <Floating anchor={btn} onClose={() => setOpen(false)} width={260} role="menu" ariaLabel="Колонки списка кейсов">
          <div className="p-1">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Найти поле" aria-label="Найти поле"
              className="w-full mb-1 text-sm px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {std.map(c => item(c.id, c.label))}
              {cf.length > 0 && <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Пользовательские поля</p>}
              {cf.map(n => item(cfCol(n), n))}
              {!std.length && !cf.length && <p className="px-2.5 py-1.5 text-xs text-text-muted">Ничего не нашлось</p>}
            </div>
          </div>
        </Floating>
      )}
    </>
  );
}

/* ── Несколько кейсов: правка и удаление (сразу в Jira) ───────────────── */

type BulkResult = { ok: number; errors: { key: string; error: string }[] };

/** Поле массовой правки: стандартное (std:…) или пользовательское (cf:…). */
type EditRow = { id: number; field: string; value: string; values: string[]; other?: boolean };
/** Пункт выпадающего списка: вписать значение, которого нет среди встречающихся в модели. */
const OTHER = "\u0000other";

const STD_EDIT: { id: string; label: string; hint?: string }[] = [
  { id: "std:status", label: "Статус" }, { id: "std:priority", label: "Приоритет" }, { id: "std:owner", label: "Владелец" },
  { id: "std:labelsAdd", label: "Метки — добавить" }, { id: "std:labelsRemove", label: "Метки — убрать" },
  { id: "std:issueLinksAdd", label: "Связи с задачами — добавить", hint: "SBER911-123, SBER911-124" },
  { id: "std:estimatedTime", label: "Длительность, мин" }, { id: "std:objective", label: "Цель" }, { id: "std:precondition", label: "Предусловие" },
];
const MULTI_STD = new Set(["std:labelsAdd", "std:labelsRemove", "std:issueLinksAdd"]);

/**
 * Правка нескольких кейсов: любое поле — стандартное или пользовательское, полей сколько угодно («+ поле»).
 * У выпадающих полей — значения, что встречаются в модели (статусы, приоритеты, владельцы, метки, значения
 * пользовательских полей); флажок — Да/Нет; поле на несколько значений — галочками. Сразу уходит в Jira.
 */
export function BulkEditModal({ project, keys, onDone, onClose }: {
  project: string; keys: string[]; onDone: (r: BulkResult) => void; onClose: () => void;
}) {
  const [fv, setFv] = useState<ZFieldValues | null>(null);
  const [rows, setRows] = useState<EditRow[]>([{ id: 1, field: "", value: "", values: [] }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { getFieldValues(project).then(setFv).catch(e => setErr((e as Error).message)); }, [project]);

  const kindOf = (field: string): ZFieldKind | "std" => (field.startsWith("cf:") ? fv?.kinds?.[field.slice(3)] ?? "text" : "std");
  const optionsOf = (field: string): string[] => {
    if (field.startsWith("cf:")) return fv?.fields[field.slice(3)] ?? [];
    if (field === "std:status") return fv?.statuses?.length ? fv.statuses : ["Approved", "Draft", "Deprecated"];
    if (field === "std:priority") return Array.from(new Set([...(fv?.priorities ?? []), "High", "Normal", "Low"]));
    if (field === "std:owner") return fv?.owners ?? [];
    if (field === "std:labelsAdd" || field === "std:labelsRemove") return fv?.labels ?? [];
    return [];
  };
  const isMulti = (field: string) => MULTI_STD.has(field) || kindOf(field) === "multi";
  const setRow = (id: number, patch: Partial<EditRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const used = new Set(rows.map(r => r.field).filter(Boolean));

  const edit: CasesEditIn = {};
  const custom: Record<string, unknown> = {};
  for (const r of rows) {
    if (!r.field) continue;
    const list = r.values.length ? r.values : r.value.split(",").map(x => x.trim()).filter(Boolean);
    if (r.field.startsWith("cf:")) {
      const k = kindOf(r.field), name = r.field.slice(3);
      if (k === "multi") { if (list.length) custom[name] = list; }
      else if (k === "bool") { if (r.value) custom[name] = r.value === "Да"; }
      else if (k === "number") { if (r.value.trim() && !Number.isNaN(Number(r.value))) custom[name] = Number(r.value); }
      else if (r.value.trim()) custom[name] = r.value.trim();
      continue;
    }
    const f = r.field.slice(4);
    if (MULTI_STD.has(r.field)) { if (list.length) Object.assign(edit, { [f]: list }); }
    else if (f === "estimatedTime") { const m = Number(r.value.replace(",", ".")); if (r.value.trim() && m >= 0) edit.estimatedTime = Math.round(m * 60000); }
    else if (r.value.trim()) Object.assign(edit, { [f]: r.value.trim() });
  }
  if (Object.keys(custom).length) edit.customFields = custom;
  const empty = !Object.keys(edit).length;

  const save = async () => {
    setBusy(true); setErr("");
    try { const r = await editCases(project, keys, edit); onDone({ ok: r.updated.length, errors: r.errors }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const valueInput = (r: EditRow) => {
    if (!r.field) return <input disabled value="" readOnly placeholder="сначала поле" aria-label="Значение" className={INPUT} />;
    const opts = optionsOf(r.field);
    const k = kindOf(r.field);
    if (k === "bool") {
      return (
        <select value={r.value} onChange={e => setRow(r.id, { value: e.target.value })} aria-label="Значение" className={INPUT}>
          <option value="">—</option><option value="Да">Да</option><option value="Нет">Нет</option>
        </select>
      );
    }
    if (isMulti(r.field) && opts.length) {
      return <MultiPick options={opts} value={r.values} onChange={values => setRow(r.id, { values })} placeholder={STD_EDIT.find(x => x.id === r.field)?.hint} />;
    }
    // Поле с вариантами (статус, приоритет, владелец, список выбора) — выпадающий список; своё значение — «Другое…».
    const listLike = r.field === "std:status" || r.field === "std:priority" || r.field === "std:owner" || (r.field.startsWith("cf:") && k === "text");
    if (listLike && opts.length && !r.other) {
      return (
        <select value={r.value} aria-label="Значение" className={INPUT}
          onChange={e => (e.target.value === OTHER ? setRow(r.id, { other: true, value: "" }) : setRow(r.id, { value: e.target.value }))}>
          <option value="">—</option>
          {opts.map(x => <option key={x} value={x}>{x}</option>)}
          <option value={OTHER}>Другое значение…</option>
        </select>
      );
    }
    const long = r.field === "std:objective" || r.field === "std:precondition";
    const listId = `be-${r.id}`;
    return (
      <>
        {long
          ? <textarea value={r.value} onChange={e => setRow(r.id, { value: e.target.value })} rows={2} aria-label="Значение" className={INPUT} />
          : <input value={r.value} onChange={e => setRow(r.id, { value: e.target.value })} list={opts.length ? listId : undefined} aria-label="Значение"
              inputMode={k === "number" || r.field === "std:estimatedTime" ? "decimal" : undefined}
              placeholder={opts.length ? "выберите или впишите" : STD_EDIT.find(x => x.id === r.field)?.hint ?? ""} className={INPUT} />}
        {opts.length > 0 && <datalist id={listId}>{opts.map(v => <option key={v} value={v} />)}</datalist>}
      </>
    );
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Изменить кейсы · ${keys.length}`} size="max-w-2xl">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-text-muted">Выберите поле и значение — любое поле кейса, в том числе пользовательское; «+ поле» — ещё одно.
          Поля без значения не меняются. Изменения сразу уходят в Jira.</p>
        {rows.map(r => (
          <div key={r.id} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] gap-2 items-start">
            <select value={r.field} aria-label="Поле" onChange={e => setRow(r.id, { field: e.target.value, value: "", values: [], other: false })} className={INPUT}>
              <option value="">Поле…</option>
              <optgroup label="Поля кейса">
                {STD_EDIT.map(f => <option key={f.id} value={f.id} disabled={used.has(f.id) && r.field !== f.id}>{f.label}</option>)}
              </optgroup>
              {Object.keys(fv?.fields ?? {}).length > 0 && (
                <optgroup label="Пользовательские поля">
                  {Object.keys(fv?.fields ?? {}).sort((a, b) => a.localeCompare(b, "ru")).map(n => (
                    <option key={n} value={`cf:${n}`} disabled={used.has(`cf:${n}`) && r.field !== `cf:${n}`}>{n}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="min-w-0">{valueInput(r)}</div>
            <button type="button" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(x => x.id !== r.id) : [{ id: r.id, field: "", value: "", values: [] }]))}
              aria-label="Убрать поле" className="p-2 rounded-lg text-text-muted hover:text-red-500"><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRows(rs => [...rs, { id: Math.max(...rs.map(x => x.id)) + 1, field: "", value: "", values: [] }])}
          className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="w-3.5 h-3.5" /> поле</button>
        {!fv && !err && <p className="flex items-center gap-1.5 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загружаю поля и значения модели…</p>}
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

/** Несколько значений галочками с поиском; можно вписать своё (Enter). */
function MultiPick({ options, value, onChange, placeholder }: { options: string[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const shown = [...value.filter(v => !options.includes(v)), ...options].filter(o => !s || o.toLowerCase().includes(s));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return (
    <div className="rounded-lg border border-border-main bg-[var(--color-input-bg)]">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder || "найти или вписать, Enter — добавить"} aria-label="Найти значение"
        onKeyDown={e => { if (e.key === "Enter" && q.trim()) { e.preventDefault(); if (!value.includes(q.trim())) onChange([...value, q.trim()]); setQ(""); } }}
        className="w-full text-sm px-2.5 py-1.5 bg-transparent text-text-main border-b border-border-main focus:outline-none" />
      <div className="max-h-36 overflow-y-auto scrollbar-thin p-1">
        {shown.map(o => (
          <label key={o} className="flex items-center gap-2 px-1.5 py-0.5 rounded hover:bg-bg-subtle cursor-pointer text-sm text-text-main">
            <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> <span className="truncate">{o}</span>
          </label>
        ))}
        {!shown.length && <p className="px-1.5 py-1 text-xs text-text-muted">Нет значений — впишите и Enter</p>}
      </div>
      {value.length > 0 && <p className="px-2.5 py-1 text-[11px] text-text-muted border-t border-border-main truncate" title={value.join(", ")}>Выбрано: {value.join(", ")}</p>}
    </div>
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
