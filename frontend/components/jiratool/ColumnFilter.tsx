"use client";

import { useRef, useState } from "react";
import { ListFilter } from "lucide-react";
import Floating from "./Floating";

/** Вариант фильтра колонки: значение (как в ячейке), подпись и сколько задач с ним. Пустое значение — "". */
export interface FilterOption { value: string; label: string; count: number }

/**
 * Фильтр в заголовке колонки, как в Excel: галочки по значениям колонки с числом задач и поиском.
 * Нет фильтра — отмечено всё; сняли галочку — колонка показывает только отмеченное.
 * Отметили всё снова — фильтр снимается сам.
 */
export default function ColumnFilter({ label, active, selected, options, onChange }: {
  label: string;
  /** Есть ли фильтр по колонке. */
  active: boolean;
  /** Отмеченные значения (если фильтра нет — не важно). */
  selected: string[];
  /** Варианты: считаются по задачам с учётом остальных фильтров. */
  options: () => FilterOption[];
  /** null — снять фильтр. */
  onChange: (values: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const all = open ? options() : [];
  const s = q.trim().toLowerCase();
  const shown = all.filter(o => !s || o.label.toLowerCase().includes(s));
  const isOn = (v: string) => !active || selected.includes(v);
  const apply = (values: string[]) => onChange(all.every(o => values.includes(o.value)) ? null : values);
  const toggle = (v: string) => {
    const now = all.filter(o => isOn(o.value)).map(o => o.value);
    apply(now.includes(v) ? now.filter(x => x !== v) : [...now, v]);
  };

  return (
    <>
      <button ref={btn} type="button" onClick={() => { setQ(""); setOpen(o => !o); }} aria-expanded={open} aria-haspopup="dialog"
        aria-label={active ? `Фильтр по колонке ${label}: включён` : `Фильтр по колонке ${label}`}
        title={active ? "Фильтр включён — нажмите, чтобы изменить" : "Фильтр по значениям колонки"}
        className={`ml-0.5 p-0.5 rounded flex-shrink-0 ${active ? "text-primary bg-primary/10" : "text-text-muted opacity-0 group-hover/th:opacity-100 hover:text-text-main"}
          ${open ? "opacity-100" : ""}`}>
        <ListFilter className="w-3.5 h-3.5" />
      </button>
      {open && (
        // Заголовок колонки перетаскивается — клики внутри окна не должны начинать перенос.
        <Floating anchor={btn} onClose={() => setOpen(false)} width={260} role="dialog" ariaLabel={`Фильтр: ${label}`}
          className="p-1.5 normal-case tracking-normal font-normal">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Найти значение" aria-label="Найти значение"
            className="w-full mb-1 text-sm px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="flex items-center gap-3 px-1 pb-1 text-xs">
            <button type="button" onClick={() => onChange(null)} className="text-primary hover:underline">Выбрать все</button>
            <button type="button" onClick={() => onChange(s ? shown.map(o => o.value) : [])} className="text-text-muted hover:text-text-main">
              {s ? "Только найденные" : "Снять все"}
            </button>
          </div>
          <div role="group" aria-label={`Значения: ${label}`} className="max-h-64 overflow-y-auto scrollbar-thin border-t border-border-main pt-1">
            {all.length === 0 && <p className="px-2 py-1.5 text-xs text-text-muted">Нет значений.</p>}
            {all.length > 0 && shown.length === 0 && <p className="px-2 py-1.5 text-xs text-text-muted">Ничего не нашлось.</p>}
            {shown.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-subtle cursor-pointer text-sm">
                <input type="checkbox" checked={isOn(o.value)} onChange={() => toggle(o.value)} />
                <span className={`min-w-0 flex-1 truncate ${o.value ? "text-text-main" : "text-text-muted italic"}`}>{o.label}</span>
                <span className="text-[11px] text-text-muted tabular-nums">{o.count}</span>
              </label>
            ))}
          </div>
        </Floating>
      )}
    </>
  );
}
