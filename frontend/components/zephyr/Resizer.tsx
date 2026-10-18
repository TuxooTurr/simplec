"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PANES_KEY = "st_zephyr_panes";

function readPanes(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PANES_KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}

/** Ширина зоны, которую тянут мышью; запоминается в браузере по id. */
export function usePaneSize(id: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  const clamp = useCallback((n: number) => Math.round(Math.min(max, Math.max(min, n))), [min, max]);
  useEffect(() => { const v = readPanes()[id]; if (typeof v === "number") setSize(clamp(v)); }, [id, clamp]);
  const set = useCallback((n: number, save = false) => {
    const v = clamp(n);
    setSize(v);
    if (save) try { localStorage.setItem(PANES_KEY, JSON.stringify({ ...readPanes(), [id]: v })); } catch { /* не запомнится */ }
  }, [id, clamp]);
  return { size, set, reset: () => set(initial, true), min, max };
}

/**
 * Разделитель между зонами: тянуть мышью, стрелки с клавиатуры, двойной клик — ширина по умолчанию.
 * side="left" — зона слева от разделителя (растёт вправо), "right" — справа (растёт влево).
 */
export function Resizer({ pane, side = "left", label }: {
  pane: ReturnType<typeof usePaneSize>;
  side?: "left" | "right";
  label: string;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const dir = side === "left" ? 1 : -1;
  const [active, setActive] = useState(false);
  // Обработчики окна живут всё перетаскивание — берут свежую зону из ref, а не из замыкания первого рендера.
  const paneRef = useRef(pane);
  paneRef.current = pane;

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: pane.size }; setActive(true);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    const width = (ev: PointerEvent) => drag.current ? drag.current.w + (ev.clientX - drag.current.x) * dir : paneRef.current.size;
    const move = (ev: PointerEvent) => paneRef.current.set(width(ev));
    const up = (ev: PointerEvent) => {
      paneRef.current.set(width(ev), true);
      drag.current = null; setActive(false);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0}
      aria-valuenow={pane.size} aria-valuemin={pane.min} aria-valuemax={pane.max}
      title="Потяните, чтобы изменить ширину; двойной клик — как было"
      onPointerDown={start}
      onDoubleClick={pane.reset}
      onKeyDown={e => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          pane.set(pane.size + (e.key === "ArrowRight" ? 24 : -24) * dir, true);
        }
      }}
      className="group relative w-1 flex-shrink-0 cursor-col-resize focus:outline-none">
      <span className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors
        ${active ? "bg-primary w-0.5" : "bg-border-main group-hover:bg-primary/60 group-focus-visible:bg-primary"}`} />
    </div>
  );
}
