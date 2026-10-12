"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Search, Zap } from "lucide-react";

export interface EpicOption { key: string; summary: string }

/**
 * Выбор эпика в стиле платформы: кнопка-поле и всплывающий список со строкой поиска.
 * Поиск — по номеру и названию, без учёта регистра. Клавиатура: ↑/↓ — по списку, Enter — выбрать, Esc — закрыть.
 * Внизу — когда выгружен список и «обновить».
 */
export default function EpicPicker({ id, value, options, loading, loadedAt, canLoad, onChange, onReload }: {
  id?: string;
  value: string;
  options: EpicOption[];
  loading: boolean;
  /** Когда выгружен список (подпись «обновлено …»). */
  loadedAt: string | null;
  /** Jira подключена — можно выгрузить или обновить список. */
  canLoad: boolean;
  onChange: (key: string) => void;
  onReload: () => void;
}) {
  /** Где открыт список (fixed — поверх формы, её прокрутка его не обрежет); null — закрыт. */
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const open = !!pos;
  const btn = useRef<HTMLButtonElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const setOpen = (on: boolean) => {
    if (!on) { setPos(null); return; }
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // Список ~360 px: снизу мало места — открываем вверх.
    const below = window.innerHeight - r.bottom;
    setPos(below < 360 && r.top > below
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
      : { left: r.left, width: r.width, top: r.bottom + 4 });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setPos(null);   // клик мимо или прокрутка формы — список закрывается, а не отстаёт от поля
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); };
  }, [open]);

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter(o => o.key.toLowerCase().includes(s) || o.summary.toLowerCase().includes(s)) : options;
  }, [q, options]);
  // Первая строка — «без эпика», дальше найденные эпики.
  const rows: (EpicOption | null)[] = [null, ...found];
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const current = options.find(o => o.key === value);
  const pick = (key: string) => { onChange(key); setOpen(false); setQ(""); };

  return (
    <div className="relative">
      <button ref={btn} id={id} type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className="w-full flex items-center gap-2 text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)]
          text-left hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30">
        {value ? (
          <>
            <Zap className="w-3.5 h-3.5 text-[#904ee2] flex-shrink-0" />
            <span className="font-mono text-xs text-primary flex-shrink-0">{value}</span>
            <span className="truncate text-text-main">{current?.summary ?? ""}</span>
          </>
        ) : <span className="text-text-muted">— без эпика —</span>}
        <ChevronDown className={`w-4 h-4 ml-auto text-text-muted flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {pos && (
        <div ref={box} style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 70 }}
          className="rounded-xl border border-border-main bg-[var(--color-modal-bg)] shadow-lg animate-fade-in">
          <label className="flex items-center gap-2 px-3 py-2 border-b border-border-main">
            <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Номер или название эпика"
              aria-label="Найти эпик" role="combobox" aria-expanded aria-controls="epic-list"
              onKeyDown={e => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(rows.length - 1, a + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
                if (e.key === "Enter") { e.preventDefault(); pick(rows[active]?.key ?? ""); }
                if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
              }}
              className="flex-1 min-w-0 bg-transparent text-sm text-text-main placeholder:text-text-muted/60 focus:outline-none" />
            {q && <span className="text-[11px] text-text-muted flex-shrink-0">{found.length}</span>}
          </label>

          <ul id="epic-list" ref={listRef} role="listbox" aria-label="Эпики" className="max-h-64 overflow-y-auto scrollbar-thin p-1">
            {rows.map((o, i) => {
              const key = o?.key ?? "";
              const on = key === value;
              return (
                <li key={key || "none"} data-row={i} role="option" aria-selected={on}
                  onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(key); }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-sm
                    ${i === active ? "bg-bg-subtle" : ""} ${on ? "text-primary" : "text-text-main"}`}>
                  {o ? (
                    <>
                      <Zap className="w-3.5 h-3.5 text-[#904ee2] flex-shrink-0" />
                      <span className="font-mono text-xs text-primary flex-shrink-0">{o.key}</span>
                      <span className="truncate">{o.summary}</span>
                    </>
                  ) : <span className="text-text-muted">— без эпика —</span>}
                  {on && <Check className="w-4 h-4 ml-auto flex-shrink-0" />}
                </li>
              );
            })}
            {options.length > 0 && found.length === 0 && (
              <li className="px-2.5 py-2 text-xs text-text-muted">Эпиков по «{q.trim()}» нет.</li>
            )}
            {options.length === 0 && !loading && (
              <li className="px-2.5 py-2 text-xs text-text-muted">
                {canLoad ? "Список эпиков ещё не выгружен." : "Подключите Jira, чтобы выбрать эпик."}
              </li>
            )}
          </ul>

          {canLoad && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border-main text-[11px] text-text-muted">
              <span className="flex-1 min-w-0 truncate">
                {loading ? "Выгружаю эпики из Jira…" : loadedAt ? `Эпиков: ${options.length} · выгружено ${loadedAt}` : "Не выгружено"}
              </span>
              <button type="button" onClick={onReload} disabled={loading}
                className="flex items-center gap-1 text-primary hover:underline disabled:opacity-50">
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {loadedAt ? "обновить" : "выгрузить"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
