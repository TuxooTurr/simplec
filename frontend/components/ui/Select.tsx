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
import { ChevronDown, Check } from "lucide-react";
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
}

export function Select({
  value, onChange, children, className = "", sm = false, bare = false, disabled = false,
  placeholder, id, title, "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options: Opt[] = [];
  collectOptions(children, options);

  const current = value != null ? String(value) : "";
  const selected = options.find((o) => o.value === current);
  const selectedLabel = selected ? selected.label : (placeholder ?? "");

  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);

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

  // при открытии — подсветить текущий и проскроллить к нему
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === current);
      setActive(idx);
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(o: Opt) {
    if (o.disabled) return;
    onChange(o.value);
    close();
  }

  function moveActive(dir: 1 | -1) {
    setActive((prev) => {
      let i = prev;
      for (let n = 0; n < options.length; n++) {
        i = (i + dir + options.length) % options.length;
        if (!options[i].disabled) break;
      }
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
      });
      return i;
    });
  }

  function onButtonKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && options[active]) pick(options[active]); }
    else if (e.key === "Tab") { close(); }
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
          className="z-[9999] max-h-60 overflow-auto rounded-lg border border-border-main bg-bg-card py-1 shadow-lg animate-fade-in"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted">Нет вариантов</div>
          ) : options.map((o, i) => {
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
