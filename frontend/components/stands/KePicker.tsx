"use client";

import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { keKey } from "@/lib/standsApi";

const norm = keKey;   // один КЭ — по коду CI, без кода — по названию
/** Название КЭ без кода: «Чат [CI04663753]» → «чат». */
const nameOf = (k: string) => k.replace(/\s*[[(][^\])]*[\])]\s*$/, "").trim().toLowerCase();

/**
 * Несколько КЭ сразу: выбранные — чипами, ввод фильтрует справочник КЭ (выпадающий список).
 * Enter — выбрать подсвеченный (или первый подходящий) из списка; совпадений нет — создать КЭ: он сохраняется
 * в справочник (у всех, навсегда) и сразу выбирается. Не сохранился — всё равно выбран для этой брони.
 * Вставка «a, b; c» добавляет все. Backspace в пустом поле убирает последний.
 */
export default function KePicker({ value, onChange, catalog, onCreate, autoFocus = false, placeholder, className = "min-w-[18rem] flex-1" }: {
  value: string[]; onChange: (v: string[]) => void; catalog: string[];
  /** Создать КЭ в справочнике. */
  onCreate: (names: string[]) => Promise<void>;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);   // -1 — ничего не подсвечено стрелками
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();   // полей КЭ на форме несколько — у каждого свой список

  const chosen = new Set(value.map(norm));
  const needle = q.trim().toLowerCase();
  const matches = catalog.filter(k => !chosen.has(norm(k)) && (!needle || k.toLowerCase().includes(needle))).slice(0, 60);
  const add = (raw: string[]) => {
    const next = [...value];
    const fresh: string[] = [];
    for (const r of raw) {
      const x = r.trim().replace(/\s+/g, " ");
      if (!x || next.some(y => norm(y) === norm(x))) continue;
      const known = catalog.find(k => norm(k) === norm(x));   // написание из справочника
      next.push(known ?? x);
      if (!known) fresh.push(x);
    }
    onChange(next);
    setQ(""); setHi(-1);
    if (fresh.length) void onCreate(fresh).catch(() => { /* не сохранился — КЭ всё равно в этой брони */ });
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap items-center gap-1 min-h-[34px] px-1.5 py-1 border border-border-main rounded-lg bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30"
        onClick={() => input.current?.focus()}>
        {value.map(k => (
          <span key={k} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">
            {k}
            <button type="button" onClick={() => onChange(value.filter(x => x !== k))} aria-label={`Убрать ${k}`} className="hover:text-red-600"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input ref={input} autoFocus={autoFocus} value={q} aria-label="КЭ" role="combobox" aria-expanded={open && matches.length > 0} aria-controls={listId}
          placeholder={value.length ? "ещё КЭ…" : placeholder ?? (catalog.length ? "КЭ: начните вводить или выберите" : "КЭ (сервис): notify")}
          onChange={e => {
            const t = e.target.value;
            if (/[,;\n]/.test(t)) add(t.split(/[,;\n]/)); else { setQ(t); setHi(-1); }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
            else if (e.key === "Enter") {
              const pick = open ? matches[hi >= 0 ? hi : q.trim() ? 0 : -1] : undefined;
              if (!pick && !q.trim()) return;   // пустое поле без выбора стрелками — Enter отправляет форму
              e.preventDefault();
              add([pick ?? q]);
            } else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
          }}
          className="flex-1 min-w-[8rem] bg-transparent text-sm text-text-main focus:outline-none px-1" />
      </div>
      {open && (matches.length > 0 || q.trim()) && (
        <ul id={listId} role="listbox"
          className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto scrollbar-thin rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg text-sm">
          {matches.map((k, i) => (
            <li key={k} role="option" aria-selected={i === hi}
              onMouseDown={e => { e.preventDefault(); add([k]); }} onMouseEnter={() => setHi(i)}
              className={`px-2.5 py-1 cursor-pointer ${i === hi ? "bg-primary/10 text-primary" : "text-text-main"}`}>{k}</li>
          ))}
          {/* Создать — только если такого КЭ нет ни по коду, ни по названию (иначе вышел бы дубль без кода) */}
          {q.trim() && !catalog.some(k => norm(k) === norm(q) || nameOf(k) === q.trim().toLowerCase()) && (
            <li role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); add([q]); }}
              className="px-2.5 py-1 cursor-pointer text-text-muted hover:bg-bg-subtle border-t border-border-main">
              + Создать КЭ «{q.trim()}» — добавится в справочник</li>
          )}
        </ul>
      )}
    </div>
  );
}
