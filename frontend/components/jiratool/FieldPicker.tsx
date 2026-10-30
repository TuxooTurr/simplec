"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface PickOption {
  value: string;
  label: string;
  group: string;
  hint?: string;
}

interface PickerProps {
  label: string;
  options: PickOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Сколько можно выбрать (группировка — 3). */
  max?: number;
  /** Порядок выбора важен и показывается номерами: первый выбранный — первый уровень. */
  ordered?: boolean;
  footer?: ReactNode;
}

/** Строка поиска + список с множественным выбором. Используется и во всплывающем окне, и в колонке. */
export function PickerPanel({ label, options, selected, onChange, max, ordered, footer, listHeight = "max-h-72" }:
  PickerProps & { listHeight?: string }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options.filter(o => !s || o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)
      || (o.hint ?? "").toLowerCase().includes(s));
  }, [options, q]);

  const groups = useMemo(() => {
    const m = new Map<string, PickOption[]>();
    for (const o of filtered) { if (!m.has(o.group)) m.set(o.group, []); m.get(o.group)!.push(o); }
    return [...m.entries()];
  }, [filtered]);

  const full = max !== undefined && selected.length >= max;
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else if (!full) onChange([...selected, v]);
  };

  return (
    <div>
      <label className="flex items-center gap-2 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 mb-2
        focus-within:ring-2 focus-within:ring-primary/30">
        <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск поля"
          aria-label={`Поиск: ${label}`} className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Очистить поиск"><X className="w-3.5 h-3.5 text-text-muted" /></button>}
      </label>

      {ordered && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 px-1">
          {selected.map((v, i) => (
            <span key={v} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md bg-primary/10 text-primary text-xs">
              <b>{i + 1}.</b> {options.find(o => o.value === v)?.label ?? v}
              <button type="button" onClick={() => toggle(v)} aria-label="Убрать уровень"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
      {max !== undefined && (
        <p className="text-[11px] text-text-muted px-1 mb-1.5">
          {full ? `Выбрано максимум — ${max}. Уберите уровень, чтобы выбрать другой.` : `Можно выбрать до ${max}.`}
        </p>
      )}

      <div className={`${listHeight} overflow-y-auto scrollbar-thin`} role="listbox" aria-multiselectable="true" aria-label={label}>
        {groups.length === 0 && <p className="text-xs text-text-muted p-2">Ничего не нашлось</p>}
        {groups.map(([group, opts]) => (
          <div key={group} className="mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted px-2 py-1">{group}</p>
            {opts.map(o => {
              const idx = selected.indexOf(o.value);
              const on = idx >= 0;
              return (
                <button key={o.value} type="button" role="option" aria-selected={on} onClick={() => toggle(o.value)}
                  disabled={!on && full}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors
                    ${on ? "bg-primary/10 text-text-main" : "text-text-main hover:bg-bg-subtle"} disabled:opacity-40`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[10px] font-bold
                    ${on ? "bg-primary border-primary text-white" : "border-border-main"}`}>
                    {on && (ordered ? idx + 1 : <Check className="w-3 h-3" />)}
                  </span>
                  <span className="truncate flex-1">{o.label}</span>
                  {o.hint && <span className="text-[10px] text-text-muted flex-shrink-0">{o.hint}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {footer && <div className="border-t border-border-main mt-1 pt-1.5">{footer}</div>}
    </div>
  );
}

/** Кнопка со всплывающим выбором. align — к какому краю кнопки прижать окно; up — раскрыть вверх (кнопка у нижнего края страницы). */
export default function FieldPicker({ align = "left", up = false, ...props }: PickerProps & { icon?: ReactNode; align?: "left" | "right"; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors
          ${open ? "border-primary/50 bg-primary/5 text-text-main" : "border-border-main text-text-main hover:bg-bg-subtle"}`}>
        {props.icon}
        {props.label}
        {props.selected.length > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
            {props.selected.length}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute z-40 ${align === "right" ? "right-0" : "left-0"} ${up ? "bottom-full mb-1.5" : "mt-1.5"} w-80 rounded-xl border border-border-main bg-[var(--color-modal-bg)] shadow-xl p-2 animate-fade-in`}>
          <PickerPanel {...props} />
        </div>
      )}
    </div>
  );
}
