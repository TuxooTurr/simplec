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
 */

import {
  Children, Fragment, isValidElement, useCallback, useEffect, useRef, useState,
  type ReactNode,
} from "react";
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

function labelToText(label: ReactNode): string {
  if (typeof label === "string" || typeof label === "number") return String(label);
  const acc: string[] = [];
  Children.forEach(label, (c) => { if (typeof c === "string" || typeof c === "number") acc.push(String(c)); });
  return acc.join("");
}

export interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  children?: ReactNode;
  className?: string;
  sm?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  title?: string;
  "aria-label"?: string;
}

export function Select({
  value, onChange, children, className = "", sm = false, disabled = false,
  placeholder, id, title, "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options: Opt[] = [];
  collectOptions(children, options);

  const current = value != null ? String(value) : "";
  const selected = options.find((o) => o.value === current);
  const selectedLabel = selected ? selected.label : (placeholder ?? "");

  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);

  // click-outside + Escape
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
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

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        className={`${base} flex w-full items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`truncate ${selected ? "text-text-main" : "text-text-muted/60"}`}>
          {selectedLabel || " "}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border-main bg-bg-card py-1 shadow-lg animate-fade-in"
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
        </div>
      )}
    </div>
  );
}

export default Select;
