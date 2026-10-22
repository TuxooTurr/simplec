"use client";

import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { msChipStyle, msGroup } from "@/lib/msColor";
import { keKey } from "@/lib/standsApi";

const norm = keKey;   // одно значение — по коду CI, если он есть, иначе по названию
/** Название без кода: «Чат [CI04663753]» → «чат». */
const nameOf = (k: string) => k.replace(/\s*[[(][^\])]*[\])]\s*$/, "").trim().toLowerCase();

/**
 * Несколько сервисов сразу (микросервисы на графике стендов; годится и для КЭ — подпись в noun): выбранные — чипами,
 * ввод фильтрует справочник (выпадающий список). Enter — выбрать подсвеченный (или первый подходящий); совпадений
 * нет — создать: значение сохраняется в справочник (у всех, навсегда) и сразу выбирается. Не сохранилось — всё равно
 * выбрано для этой брони. Вставка «a, b; c» добавляет все. Backspace в пустом поле убирает последний.
 */
export default function ServicePicker({ value, onChange, catalog, onCreate, noun = "микросервис", info = {}, inlineList = false, autoFocus = false, placeholder,
  className = "min-w-[18rem] flex-1" }: {
  value: string[]; onChange: (v: string[]) => void; catalog: string[];
  /** Создать значение в справочнике. */
  onCreate: (names: string[]) => Promise<void>;
  /** Что выбираем — для подписей: «микросервис», «КЭ». */
  noun?: string;
  /** Описания значений (имя → описание): видны в списке, поиск идёт и по ним. */
  info?: Record<string, string>;
  /** Список — под полем в потоке, а не всплывающим (внутри окна с прокруткой всплывающий обрезался бы); виден всегда. */
  inlineList?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);   // -1 — ничего не подсвечено стрелками
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();   // таких полей на форме несколько — у каждого свой список

  const chosen = new Set(value.map(norm));
  const needle = q.trim().toLowerCase();
  // Сначала совпадения по имени, затем по описанию («календарь» найдёт release-calendar-ms).
  const free = catalog.filter(k => !chosen.has(norm(k)));
  const byName = free.filter(k => !needle || k.toLowerCase().includes(needle));
  const byInfo = needle ? free.filter(k => !k.toLowerCase().includes(needle) && (info[k] ?? "").toLowerCase().includes(needle)) : [];
  const matches = [...byName, ...byInfo].slice(0, 80);
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
    if (fresh.length) void onCreate(fresh).catch(() => { /* не сохранилось — значение всё равно в этой брони */ });
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap items-center gap-1 min-h-[34px] px-1.5 py-1 border border-border-main rounded-lg bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30"
        onClick={() => input.current?.focus()}>
        {value.map(k => {
          const chip = msChipStyle(k);
          return (
            <span key={k} title={`группа: ${msGroup(k)}`} style={chip.style}
              className={`${chip.className} flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium`}>
              {k}
              <button type="button" onClick={() => onChange(value.filter(x => x !== k))} aria-label={`Убрать ${k}`} className="opacity-70 hover:opacity-100 hover:text-red-600"><X className="w-3 h-3" /></button>
            </span>
          );
        })}
        <input ref={input} autoFocus={autoFocus} value={q} aria-label={noun} role="combobox" aria-expanded={open && matches.length > 0} aria-controls={listId}
          placeholder={value.length ? "ещё…" : placeholder ?? (catalog.length ? `${noun}: начните вводить или выберите` : `${noun}: notify-service`)}
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
              // Без стрелок Enter берёт первое совпадение (по имени, иначе по описанию); новое создаётся, только если
              // совпадений нет, — иначе «календарь внедрений» + Enter завёл бы микросервис с таким именем.
              const pick = open || inlineList ? (hi >= 0 ? matches[hi] : q.trim() ? matches[0] : undefined) : undefined;
              if (!pick && !q.trim()) return;   // пустое поле без выбора стрелками — Enter отправляет форму
              e.preventDefault();
              add([pick ?? q]);
            } else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
          }}
          className="flex-1 min-w-[8rem] bg-transparent text-sm text-text-main focus:outline-none px-1" />
      </div>
      {(open || inlineList) && (matches.length > 0 || q.trim()) && (
        <ul id={listId} role="listbox"
          className={`${inlineList ? "" : "absolute z-20 shadow-lg"} mt-1 w-full max-h-60 overflow-y-auto scrollbar-thin rounded-lg border border-border-main bg-[var(--color-modal-bg)] text-sm`}>
          {matches.map((k, i) => (
            <li key={k} role="option" aria-selected={i === hi}
              onMouseDown={e => { e.preventDefault(); add([k]); }} onMouseEnter={() => setHi(i)}
              className={`px-2.5 py-1 cursor-pointer ${i === hi ? "bg-primary/10 text-primary" : "text-text-main"}`}>
              <span className="flex items-center gap-1.5 font-medium">
                {/* Цвет группы — тот же, что у лейбла после выбора */}
                <span aria-hidden style={msChipStyle(k).style} className="ms-dot w-2.5 h-2.5 rounded-sm flex-shrink-0" />
                {k}</span>
              {info[k] && <span className="block text-[11px] text-text-muted truncate" title={info[k]}>{info[k]}</span>}
            </li>
          ))}
          {/* Создать — только если такого нет ни по коду, ни по названию (иначе вышел бы дубль) */}
          {q.trim() && !catalog.some(k => norm(k) === norm(q) || nameOf(k) === q.trim().toLowerCase()) && (
            <li role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); add([q]); }}
              className="px-2.5 py-1 cursor-pointer text-text-muted hover:bg-bg-subtle border-t border-border-main">
              + Создать {noun} «{q.trim()}» — добавится в справочник</li>
          )}
        </ul>
      )}
    </div>
  );
}
