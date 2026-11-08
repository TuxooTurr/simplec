"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

/*
 * «Обновить» во всём приложении: в покое — стрелки, во время загрузки — пиксельная акула (как в видео экрана входа),
 * которая плывёт по кругу. Без рамки. Кнопка раздела стоит в одном месте — в шапке панели рядом с названием:
 * раздел передаёт её через usePanelRefresh, шапка (ResizablePanels → PanelChrome) рисует.
 */

/** Акула вправо: 11×6 «пикселей». # — закрашено. */
const SHARK = [
  "     #     ",
  "#   ##     ",
  "## ######  ",
  " #########.",
  "## ####### ",
  "#    #     ",
];

const PIXELS = SHARK.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? [x, y] : null)).filter(Boolean) as number[][]);

/** Пиксельная акула, плывущая по кругу. size — сторона в px; currentColor. */
export function SharkSpinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden shapeRendering="crispEdges">
      <g className="shark-orbit">
        {/* сверху круга, нос — по ходу движения (по часовой) */}
        <g transform="translate(6.5 1)">
          {PIXELS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />)}
        </g>
      </g>
    </svg>
  );
}

/** Значок «Обновить»: стрелки в покое, акула — пока идёт загрузка. */
export function RefreshIcon({ busy, className = "w-4 h-4" }: { busy?: boolean; className?: string }) {
  if (busy) {
    // Размер берём из классов w-N: акула той же величины, что и стрелки.
    const m = /\bw-(\d+(?:\.\d+)?)\b/.exec(className);
    const px = m ? Number(m[1]) * 4 : 16;
    return <SharkSpinner size={Math.max(px, 14)} className={className.replace(/\banimate-spin\b/g, "")} />;
  }
  return <RefreshCw className={className} />;
}

export interface RefreshButtonProps {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  /** Число в уголке — например, сколько изменений уйдёт при обновлении. */
  badge?: number;
  className?: string;
}

export function RefreshButton({ onClick, busy, disabled, title = "Обновить", badge, className = "" }: RefreshButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title} aria-busy={busy || undefined}
      className={`relative grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-text-muted transition-colors
        hover:bg-bg-subtle hover:text-text-main disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}>
      <RefreshIcon busy={busy} className="w-4 h-4" />
      {!!badge && (
        <span className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Слот в шапке панели ──────────────────────────────────────────────────────

export interface PanelRefresh {
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  badge?: number;
}

type Slot = { set: (r: (PanelRefresh & { run: () => void }) | null) => void };

const PanelRefreshContext = createContext<Slot | null>(null);

/** Шапка панели: держит «Обновить» текущего раздела и рисует кнопку. */
export function usePanelRefreshSlot(): [ReactNode, (children: ReactNode) => ReactNode] {
  const [entry, setEntry] = useState<(PanelRefresh & { run: () => void }) | null>(null);
  const slot = useRef<Slot>({ set: setEntry }).current;
  const button = entry ? (
    <RefreshButton onClick={entry.run} busy={entry.busy} disabled={entry.disabled} title={entry.title} badge={entry.badge} />
  ) : null;
  const provide = (children: ReactNode) => <PanelRefreshContext.Provider value={slot}>{children}</PanelRefreshContext.Provider>;
  return [button, provide];
}

/**
 * Раздел передаёт «Обновить» в шапку своей панели. onRefresh можно не мемоизировать — берётся последний.
 * Вне панели (например, в тесте) ничего не делает.
 */
export function usePanelRefresh(onRefresh: (() => void) | null, opts: PanelRefresh = {}) {
  const slot = useContext(PanelRefreshContext);
  const fn = useRef(onRefresh);
  fn.current = onRefresh;
  const { busy, disabled, title, badge } = opts;
  const active = !!onRefresh;
  useEffect(() => {
    if (!slot) return;
    slot.set(active ? { run: () => fn.current?.(), busy, disabled, title, badge } : null);
  }, [slot, active, busy, disabled, title, badge]);
  useEffect(() => () => slot?.set(null), [slot]);
}
