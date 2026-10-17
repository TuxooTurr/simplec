"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const GAP = 4;
const MARGIN = 8;

/**
 * Всплывающее окно у ячейки таблицы (выпадающий список, меню). Рисуется в body (fixed), поэтому
 * прокрутка таблицы и анимации окон его не обрезают. Само выбирает сторону: под ячейкой, а если внизу
 * экрана места не хватает — над ней; по горизонтали не выходит за край; высота — не больше места на экране
 * (дальше прокрутка внутри). При прокрутке страницы или таблицы едет за ячейкой. Закрывается щелчком
 * мимо (кроме самой ячейки — её кнопка переключает окно сама) и клавишей Esc.
 */
export default function Floating({ anchor, onClose, width, className = "", style, role, ariaLabel, children }: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Ширина, px — по ней окно не вылезает за правый край. */
  width: number;
  className?: string;
  style?: CSSProperties;
  role?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const place = () => {
    const a = anchor.current?.getBoundingClientRect();
    const el = box.current;
    if (!a || !el) return;
    const h = el.scrollHeight;
    const below = window.innerHeight - a.bottom - GAP - MARGIN;
    const above = a.top - GAP - MARGIN;
    // Вниз, если влезает целиком или снизу места не меньше, чем сверху; иначе — вверх.
    const down = h <= below || below >= above;
    const room = Math.max(120, down ? below : above);
    const height = Math.min(h, room);
    const next = {
      left: Math.round(Math.max(MARGIN, Math.min(a.left, window.innerWidth - width - MARGIN))),
      top: Math.round(down ? a.bottom + GAP : a.top - GAP - height),
      maxHeight: Math.round(room),
    };
    // Пересчёт идёт после каждой отрисовки — обновляем, только если место изменилось (иначе бесконечный цикл).
    setPos(p => (p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight ? p : next));
  };

  // До отрисовки — чтобы окно не мигнуло в неверном месте; высота содержимого известна только после рендера.
  useLayoutEffect(place);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      closeRef.current();
    };
    const onScroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) place(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div ref={box} role={role} aria-label={ariaLabel}
      style={{ position: "fixed", zIndex: 60, width, left: pos?.left ?? -9999, top: pos?.top ?? -9999,
               maxHeight: pos?.maxHeight,
               // До расчёта места — прозрачно (не visibility: hidden: поле с autoFocus внутри не получило бы фокус).
               opacity: pos ? undefined : 0, pointerEvents: pos ? undefined : "none", ...style }}
      className={`overflow-y-auto scrollbar-thin rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg animate-fade-in ${className}`}>
      {children}
    </div>,
    document.body,
  );
}
