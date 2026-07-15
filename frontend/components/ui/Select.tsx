"use client";

/**
 * Брендированный выпадающий список.
 *
 * Нативный <select> открывает список средствами ОС — его нельзя покрасить в стиль
 * продукта. Этот компонент рисует свой список (кнопка + панель) в цветах и шрифте
 * проекта, но принимает те же <option>-дети, что и <select>, — поэтому замена
 * почти механическая:
 *
 *   <select value={v} onChange={e => setV(e.target.value)}>...</select>
 *   →
 *   <Select value={v} onChange={setV}>...</Select>
 *
 * Панель списка рендерится в портал (position: fixed по координатам кнопки), чтобы
 * её не обрезали родители с overflow: hidden/auto (карточки, модалки).
 */

import {
  Children, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";
import { INPUT_CLS, INPUT_SM } from "./Input";

interface Opt { value: string; label: ReactNode; disabled: boolean }

function collectOptions(children: ReactNode, acc: Opt[]) {
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return;
    if (ch.type === Fragment) { collectOptions((ch.props as { children?: ReactNode }).children, acc); return; }
    if (ch.type === "option") {
      const p = ch.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
      acc.push({ value: String(p.value ?? ""), label: p.children ?? "", disabled: !!p.disabled });
    }
  });
}

export interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  children?: ReactNode;
  className?: string;
  sm?: boolean;
  /** Без базовой input-обводки: минимальная inline-кнопка (для «текстовых» селектов). */
  bare?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  title?: string;
  "aria-label"?: string;
  /** Показывать строку поиска вверху панели — фильтрует опции по тексту. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function Select({
  value, onChange, children, className = "", sm = false, bare = false, disabled = false,
  placeholder, id, title, "aria-label": ariaLabel, searchable = false, searchPlaceholder = "Поиск…",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options: Opt[] = [];
  collectOptions(children, options);

  const filtered = searchable && query.trim()
    ? options.filter((o) => typeof o.label === "string" && o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const current = value != null ? String(value) : "";
  const selected = options.find((o) => o.value === current);
  const selectedLabel = selected ? selected.label : (placeholder ?? "");

  const close = useCallback(() => { setOpen(false); setActive(-1); setQuery(""); }, []);

  const reposition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  // позиционируем панель под кнопкой; репозиция на скролл/resize пока открыто
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open, reposition]);

  // click-outside (учитывая портал) + Escape
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      close();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, close]);

  // при открытии — подсветить текущий и проскроллить к нему; для поиска — сфокусировать инпут
  useEffect(() => {
    if (open) {
      const idx = filtered.findIndex((o) => o.value === current);
      setActive(idx);
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
        if (searchable) searchRef.current?.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // при вводе в поиск — подсветить первый результат
  useEffect(() => {
    if (open && searchable) setActive(filtered.length > 0 ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function pick(o: Opt) {
    if (o.disabled) return;
    onChange(o.value);
    close();
  }

  function moveActive(dir: 1 | -1) {
    setActive((prev) => {
      let i = prev;
      for (let n = 0; n < filtered.length; n++) {
        i = (i + dir + filtered.length) % filtered.length;
        if (!filtered[i].disabled) break;
      }
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
      });
      return i;
    });
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && filtered[active]) pick(filtered[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { close(); }
  }

  function onButtonKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      return;
    }
    onListKey(e);
  }

  const base = sm ? INPUT_SM : INPUT_CLS;
  // bare: минимальная inline-кнопка (className уходит на кнопку). Обычный режим:
  // input-обводка на кнопке, className — на обёртку (layout: flex-1/w-56/…).
  const wrapperCls = bare ? "relative inline-flex max-w-full" : `relative ${className}`;
  const buttonCls = bare
    ? `inline-flex items-center gap-1 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${className}`
    : `${base} flex w-full items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`;

  const panel = open && coords && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{ position: "fixed", top: coords.top, left: coords.left, width: bare ? undefined : coords.width, minWidth: bare ? coords.width : undefined }}
          className="z-[9999] flex max-h-72 flex-col overflow-hidden rounded-lg border border-border-main bg-bg-card shadow-lg animate-fade-in"
        >
          {searchable && (
            <div className="relative shrink-0 border-b border-border-main p-1.5">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-border-main bg-[var(--color-input-bg)] py-1 pl-7 pr-2 text-sm text-text-main placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted">{searchable && query.trim() ? "Ничего не найдено" : "Нет вариантов"}</div>
          ) : filtered.map((o, i) => {
            const isSel = o.value === current;
            const isActive = i === active;
            return (
              <button
                key={`${o.value}-${i}`}
                type="button"
                role="option"
                aria-selected={isSel}
                data-idx={i}
                disabled={o.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isActive ? "bg-primary/10" : ""
                } ${isSel ? "font-medium text-primary" : "text-text-main"}`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {isSel && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={wrapperCls}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        className={buttonCls}
      >
        <span className={`truncate ${bare ? "" : selected ? "text-text-main" : "text-text-muted/60"}`}>
          {selectedLabel || " "}
        </span>
        <ChevronDown className={`${bare ? "h-3 w-3" : "h-4 w-4"} shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {panel}
    </div>
  );
}

export default Select;
