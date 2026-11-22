"use client";

import { useEffect, useMemo, useState } from "react";
import { Columns3, Loader2, Plus, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import FieldPicker from "@/components/jiratool/FieldPicker";
import { editCasesEach, getFieldValues, deleteCasesChunked, type ZCase, type ZFieldKind, type ZFieldValues } from "@/lib/zephyrApi";
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
export function useCaseCols(): [CaseColId[], (next: CaseColId[]) => void] {
  const [cols, setCols] = useState<CaseColId[]>(DEFAULT_COLS);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
      if (Array.isArray(v)) setCols(v.filter((x: unknown): x is string => typeof x === "string" && (isCfCol(x) || STD_COLS.some(c => c.id === x))));
    } catch { /* по умолчанию */ }
  }, []);
  const set = (n: CaseColId[]) => {
    setCols(n);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(n)); } catch { /* не запомнится */ }
  };
  return [cols, set];
}

/** «Колонки» — значок, как в Jira tool: стандартные поля и все пользовательские поля кейсов списка, порядок — по выбору. */
export function ColumnsMenu({ cols, custom, onChange }: { cols: CaseColId[]; custom: string[]; onChange: (next: CaseColId[]) => void }) {
  const options = [
    ...STD_COLS.map(c => ({ value: c.id, label: c.label, group: "Поля кейса" })),
    ...custom.map(n => ({ value: cfCol(n), label: n, group: "Пользовательские поля" })),
  ];
  return <FieldPicker iconOnly label="Колонки" icon={<Columns3 className="w-4 h-4" />} align="right" options={options} selected={cols} onChange={onChange} />;
}

/* ── Несколько кейсов: правка и удаление (сразу в Jira) ───────────────── */

type BulkResult = { ok: number; errors: { key: string; error: string }[] };

/** Как менять поле: переписать всем, заполнить только пустые, заменить фрагмент текста. */
type Mode = "set" | "fill" | "replace";
const MODE_LABEL: Record<Mode, string> = { set: "Переписать", fill: "Заполнить пустые", replace: "Заменить" };

/** Поле массовой правки: стандартное (std:…) или пользовательское (cf:…). */
type EditRow = { id: number; field: string; value: string; values: string[]; other?: boolean; mode: Mode; find: string };
const newRow = (id: number): EditRow => ({ id, field: "", value: "", values: [], mode: "set", find: "" });

const OTHER = "__other__";
const STD_EDIT: { id: string; label: string; hint?: string }[] = [
  { id: "std:name", label: "Название" },
  { id: "std:status", label: "Статус" }, { id: "std:priority", label: "Приоритет" }, { id: "std:owner", label: "Владелец" },
  { id: "std:labelsAdd", label: "Метки — добавить" }, { id: "std:labelsRemove", label: "Метки — убрать" },
  { id: "std:labels", label: "Метки — заменить текст" },
  { id: "std:issueLinksAdd", label: "Связи с задачами — добавить", hint: "SBER911-123, SBER911-124" },
  { id: "std:estimatedTime", label: "Длительность, мин" }, { id: "std:objective", label: "Цель" }, { id: "std:precondition", label: "Предусловие" },
];
const MULTI_STD = new Set(["std:labelsAdd", "std:labelsRemove", "std:issueLinksAdd"]);
/** Текста цели и предусловия в списке нет (шаги и тексты — только в кейсе целиком): для них только «Переписать». */
const NO_BEFORE = new Set(["std:objective", "std:precondition"]);

type Val = string | string[] | number | null;
const SAME = Symbol("same");
const isEmpty = (v: Val | undefined) => v == null || v === "" || (Array.isArray(v) && !v.length);
const show = (v: Val | undefined) => (isEmpty(v) ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

/**
 * Правка нескольких кейсов: любое поле, полей сколько угодно («+ поле»). Для каждого поля — режим:
 * «Переписать» (одно значение всем), «Заполнить пустые» (только где поле пустое), «Заменить» (фрагмент текста на другой
 * в названии, метках и текстовых пользовательских полях). Ниже — предпросмотр «было → стало» по каждому кейсу, он
 * пересчитывается на каждое изменение. В Jira уходят только изменившиеся кейсы, у каждого — свои значения.
 */
export function BulkEditModal({ project, keys, cases, onDone, onClose }: {
  project: string; keys: string[]; cases: ZCase[]; onDone: (r: BulkResult) => void; onClose: () => void;
}) {
  const [fv, setFv] = useState<ZFieldValues | null>(null);
  const [rows, setRows] = useState<EditRow[]>([newRow(1)]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
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
  const modesOf = (field: string): Mode[] => {
    if (!field || MULTI_STD.has(field) || NO_BEFORE.has(field)) return ["set"];
    if (field === "std:labels") return ["replace"];
    if (field === "std:name") return ["set", "replace"];
    if (field.startsWith("std:")) return ["set", "fill"];
    return kindOf(field) === "text" ? ["set", "fill", "replace"] : ["set", "fill"];
  };
  const setRow = (id: number, patch: Partial<EditRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const used = new Set(rows.map(r => r.field).filter(Boolean));
  const labelOf = (field: string) => STD_EDIT.find(x => x.id === field)?.label ?? field.slice(3);

  /** Значение поля у кейса из списка; undefined — в списке его нет (цель, предусловие). */
  const before = (c: ZCase, field: string): Val | undefined => {
    if (field.startsWith("cf:")) return c.customFields?.[field.slice(3)] ?? null;
    switch (field) {
      case "std:name": return c.name;
      case "std:status": return c.status;
      case "std:priority": return c.priority;
      case "std:owner": return c.owner;
      case "std:estimatedTime": return c.estimatedTime != null ? Math.round(c.estimatedTime / 60000) : null;
      case "std:labels": case "std:labelsAdd": case "std:labelsRemove": return c.labels ?? [];
      case "std:issueLinksAdd": return c.issueLinks ?? [];
      default: return undefined;
    }
  };
  /** Целевое значение строки: число для длительности, список для полей на несколько значений, иначе текст. */
  const target = (r: EditRow): Val => {
    const list = r.values.length ? r.values : r.value.split(",").map(x => x.trim()).filter(Boolean);
    if (isMulti(r.field)) return list;
    if (r.field === "std:estimatedTime" || kindOf(r.field) === "number") {
      const n = Number(r.value.replace(",", "."));
      return r.value.trim() && Number.isFinite(n) && n >= 0 ? n : null;
    }
    return r.value.trim() || null;
  };
  /** Ready — у строки есть всё, чтобы что-то поменять. */
  const ready = (r: EditRow) => !!r.field && (r.mode === "replace" ? !!r.find : !isEmpty(target(r)));
  const after = (r: EditRow, b: Val | undefined): Val | typeof SAME => {
    if (r.field === "std:labelsAdd") return Array.from(new Set([...((b as string[]) ?? []), ...(target(r) as string[])]));
    if (r.field === "std:labelsRemove") { const drop = new Set((target(r) as string[]).map(x => x.toLowerCase())); return ((b as string[]) ?? []).filter(l => !drop.has(l.toLowerCase())); }
    if (r.field === "std:issueLinksAdd") return Array.from(new Set([...((b as string[]) ?? []), ...(target(r) as string[]).map(x => x.toUpperCase())]));
    if (r.mode === "fill") return isEmpty(b) ? target(r) : SAME;
    if (r.mode === "replace") {
      if (b == null) return SAME;
      const swap = (t: string) => t.split(r.find).join(r.value);
      return Array.isArray(b) ? Array.from(new Set(b.map(swap).filter(Boolean))) : swap(String(b));
    }
    return target(r);
  };

  const selected = useMemo(() => { const k = new Set(keys); return cases.filter(c => k.has(c.key)); }, [cases, keys]);
  const active = rows.filter(ready);
  /** Предпросмотр: по каждому кейсу — изменившиеся поля «было → стало». Считается заново на каждое изменение. */
  const preview = useMemo(() => selected.map(c => {
    const changes: { row: EditRow; before: Val | undefined; after: Val }[] = [];
    for (const r of active) {
      const b = before(c, r.field);
      const a = after(r, b);
      if (a === SAME || (b !== undefined && JSON.stringify(a) === JSON.stringify(b))) continue;
      changes.push({ row: r, before: b, after: a });
    }
    return { c, changes };
  }).filter(x => x.changes.length), [selected, active]);   // eslint-disable-line react-hooks/exhaustive-deps

  const payload = (changes: { row: EditRow; after: Val }[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const custom: Record<string, unknown> = {};
    for (const { row, after: a } of changes) {
      if (row.field.startsWith("cf:")) {
        const k = kindOf(row.field), name = row.field.slice(3);
        custom[name] = k === "bool" ? a === "Да" : k === "number" ? Number(a) : a;
        continue;
      }
      const f = row.field.slice(4);
      if (f === "estimatedTime") out.estimatedTime = Math.round(Number(a) * 60000);
      else if (f === "labels" || f === "labelsAdd" || f === "labelsRemove") out.labels = a;
      else if (f === "issueLinksAdd") out.issueLinks = a;
      else out[f] = a;
    }
    if (Object.keys(custom).length) out.customFields = custom;
    return out;
  };

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const items = preview.map(({ c, changes }) => ({ key: c.key, fields: payload(changes) }));
      const r = await editCasesEach(project, items, (done, total) => setProg({ done, total }));
      onDone({ ok: r.updated.length, errors: r.errors });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const valueInput = (r: EditRow) => {
    if (!r.field) return <input disabled value="" readOnly placeholder="сначала поле" aria-label="Значение" className={INPUT} />;
    if (r.mode === "replace") {
      return (
        <div className="grid grid-cols-2 gap-2">
          <input value={r.find} onChange={e => setRow(r.id, { find: e.target.value })} placeholder="что заменить" aria-label="Что заменить" className={INPUT} />
          <input value={r.value} onChange={e => setRow(r.id, { value: e.target.value })} placeholder="на что (пусто — удалить)" aria-label="На что заменить" className={INPUT} />
        </div>
      );
    }
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
    <Modal open onClose={() => !busy && onClose()} title={`Изменить кейсы · ${keys.length}`} size="max-w-4xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          {prog && keys.length > 500 && <span className="mr-auto text-xs text-text-muted tabular-nums">Записано пачками: {prog.done} из {prog.total}</span>}
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отмена</button>
          <button type="button" onClick={save} disabled={busy || !preview.length}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-40">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Сохранить в Jira ({preview.length})</button>
        </div>
      }>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-text-muted">Поле, режим и значение: «Переписать» — одно значение всем, «Заполнить пустые» — только где поле пустое,
          «Заменить» — фрагмент текста на другой. «+ поле» — ещё одно. Ниже видно, что получится; в Jira уходят только изменившиеся кейсы.</p>
        {rows.map(r => {
          const modes = modesOf(r.field);
          return (
            <div key={r.id} className="grid grid-cols-[minmax(0,13rem)_minmax(0,10rem)_minmax(0,1fr)_auto] gap-2 items-start">
              <select value={r.field} aria-label="Поле" className={INPUT}
                onChange={e => setRow(r.id, { field: e.target.value, value: "", values: [], other: false, find: "", mode: modesOf(e.target.value)[0] })}>
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
              <select value={r.mode} aria-label="Режим" disabled={modes.length < 2} className={INPUT}
                onChange={e => setRow(r.id, { mode: e.target.value as Mode, find: "", value: "", values: [], other: false })}>
                {modes.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
              <div className="min-w-0">{valueInput(r)}</div>
              <button type="button" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(x => x.id !== r.id) : [newRow(r.id)]))}
                aria-label="Убрать поле" className="p-2 rounded-lg text-text-muted hover:text-red-500"><X className="w-4 h-4" /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => setRows(rs => [...rs, newRow(Math.max(...rs.map(x => x.id)) + 1)])}
          className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="w-3.5 h-3.5" /> поле</button>
        {!fv && !err && <p className="flex items-center gap-1.5 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загружаю поля и значения модели…</p>}

        <section aria-label="Предпросмотр изменений" className="rounded-xl border border-border-main">
          <p className="px-3 py-2 text-xs text-text-muted border-b border-border-main" role="status">
            {active.length ? <>Изменятся <b className="text-text-main">{preview.length}</b> из {selected.length} кейсов{selected.length < keys.length ? ` (в списке ${selected.length} из ${keys.length} выбранных)` : ""}</>
              : "Задайте поле и значение — здесь появится «было → стало»."}
          </p>
          {preview.length > 0 && (
            <div className="max-h-72 overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <tbody>
                  {preview.slice(0, 300).map(({ c, changes }) => changes.map((ch, i) => (
                    <tr key={c.key + ch.row.id} className={i === 0 ? "border-t border-border-main" : ""}>
                      <td className="px-3 py-1 align-top font-mono text-primary whitespace-nowrap">{i === 0 ? c.key : ""}</td>
                      <td className="px-2 py-1 align-top text-text-muted whitespace-nowrap">{labelOf(ch.row.field)}</td>
                      <td className="px-2 py-1 align-top text-text-muted line-through break-words">{ch.before === undefined ? "не загружено в список" : show(ch.before)}</td>
                      <td className="px-2 py-1 align-top text-text-main font-medium break-words">{show(ch.after)}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
              {preview.length > 300 && <p className="px-3 py-1.5 text-[11px] text-text-muted">Показаны первые 300 кейсов из {preview.length} — сохранятся все.</p>}
            </div>
          )}
        </section>
        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
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
