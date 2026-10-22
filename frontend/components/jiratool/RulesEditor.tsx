"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { RULE_OP_LABEL, RULE_OP_NO_VALUE, newId, type FieldRule, type RuleCond, type RuleOp, type RuleResult } from "@/lib/jiraTool";
import type { PickOption } from "./FieldPicker";

const INPUT = "text-sm border border-border-main rounded-lg px-2 py-1.5 bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

/** Поле задачи → группы (optgroup) для выбора. */
function FieldSelect({ value, sources, onChange }: { value: string; sources: PickOption[]; onChange: (v: string) => void }) {
  const groups = Array.from(new Set(sources.map(s => s.group)));
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label="Поле" className={`${INPUT} min-w-0 w-44`}>
      {!sources.some(s => s.value === value) && <option value={value}>{value ? "удалённое поле" : "поле…"}</option>}
      {groups.map(g => (
        <optgroup key={g} label={g}>
          {sources.filter(s => s.group === g).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Результат правила: символ (эмодзи или знак), текст, ссылка. */
function ResultInputs({ value, onChange, label }: { value: RuleResult; onChange: (r: RuleResult) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-text-muted w-12">{label}</span>
      <input value={value.icon ?? ""} onChange={e => onChange({ ...value, icon: e.target.value.slice(0, 4) || undefined })}
        placeholder="знак" aria-label={`${label}: символ`} title="Символ или эмодзи перед текстом (необязательно)" className={`${INPUT} w-16 text-center placeholder:text-xs`} />
      <input value={value.text} onChange={e => onChange({ ...value, text: e.target.value })}
        placeholder="текст в ячейке" aria-label={`${label}: текст`} className={`${INPUT} flex-1 min-w-[8rem]`} />
      <input value={value.link ?? ""} onChange={e => onChange({ ...value, link: e.target.value.trim() || undefined })}
        placeholder="ссылка (необязательно)" aria-label={`${label}: ссылка`} className={`${INPUT} flex-1 min-w-[8rem]`} />
    </div>
  );
}

/**
 * Правила поля «По правилам»: каждое — условия через «И» (поле задачи, оператор как в Excel, значение) и результат
 * (символ, текст, ссылка). Срабатывает первое правило сверху; ни одно не подошло — «Иначе». Значения для подсказки —
 * то, что встречается в списке у выбранного поля.
 */
export default function RulesEditor({ rules, fallback, sources, valuesOf, onRules, onFallback }: {
  rules: FieldRule[];
  fallback: RuleResult;
  /** Поля задачи, по которым можно строить условия. */
  sources: PickOption[];
  /** Значения поля, которые встречаются в задачах списка, — подсказка для ввода. */
  valuesOf: (ref: string) => string[];
  onRules: (r: FieldRule[]) => void;
  onFallback: (r: RuleResult) => void;
}) {
  const first = sources[0]?.value ?? "";
  const setRule = (id: string, patch: Partial<FieldRule>) => onRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const setCond = (r: FieldRule, i: number, patch: Partial<RuleCond>) =>
    setRule(r.id, { conds: r.conds.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, d: -1 | 1) => {
    const n = [...rules];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onRules(n);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-muted">Правила проверяются сверху вниз — в ячейке результат первого подошедшего. Условия в правиле — через «И».</p>
      {rules.map((r, n) => (
        <div key={r.id} className="rounded-lg border border-border-main bg-bg-subtle/40 p-2 space-y-1.5">
          {r.conds.map((c, i) => {
            const listId = `rv-${r.id}-${i}`;
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-text-muted w-12">{i === 0 ? "Если" : "и"}</span>
                <FieldSelect value={c.ref} sources={sources} onChange={v => setCond(r, i, { ref: v })} />
                <select value={c.op} onChange={e => setCond(r, i, { op: e.target.value as RuleOp })} aria-label="Оператор" className={`${INPUT} w-40`}>
                  {(Object.keys(RULE_OP_LABEL) as RuleOp[]).map(op => <option key={op} value={op}>{RULE_OP_LABEL[op]}</option>)}
                </select>
                {!RULE_OP_NO_VALUE.includes(c.op) && (
                  <>
                    <input value={c.value} onChange={e => setCond(r, i, { value: e.target.value })} list={listId}
                      placeholder="значение" aria-label="Значение" className={`${INPUT} flex-1 min-w-[8rem]`} />
                    <datalist id={listId}>{valuesOf(c.ref).slice(0, 200).map(v => <option key={v} value={v} />)}</datalist>
                  </>
                )}
                {r.conds.length > 1 && (
                  <button type="button" onClick={() => setRule(r.id, { conds: r.conds.filter((_, j) => j !== i) })} aria-label="Убрать условие"
                    className="p-1 text-text-muted hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            );
          })}
          <button type="button" onClick={() => setRule(r.id, { conds: [...r.conds, { ref: first, op: "eq", value: "" }] })}
            className="ml-12 flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="w-3 h-3" /> условие (И)</button>
          <ResultInputs label="То" value={r.result} onChange={res => setRule(r.id, { result: res })} />
          <div className="flex justify-end gap-1 text-text-muted">
            <button type="button" onClick={() => move(n, -1)} disabled={n === 0} aria-label="Выше" title="Выше" className="p-1 hover:text-text-main disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => move(n, 1)} disabled={n === rules.length - 1} aria-label="Ниже" title="Ниже" className="p-1 hover:text-text-main disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onRules(rules.filter(x => x.id !== r.id))} aria-label="Удалить правило" title="Удалить правило"
              className="p-1 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onRules([...rules, { id: newId("rule"), conds: [{ ref: first, op: "eq", value: "" }], result: { text: "" } }])}
        className="flex items-center gap-1 text-sm text-primary hover:underline"><Plus className="w-3.5 h-3.5" /> правило</button>
      <div className="rounded-lg border border-dashed border-border-main p-2">
        <ResultInputs label="Иначе" value={fallback} onChange={onFallback} />
      </div>
    </div>
  );
}
