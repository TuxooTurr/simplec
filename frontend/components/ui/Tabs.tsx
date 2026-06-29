"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  /** "line" (default) or "pills" */
  variant?: "line" | "pills";
}

export function Tabs({ tabs, active, onChange, className = "", variant = "line" }: TabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const animate = useRef(false); // first paint snaps; subsequent moves glide

  useLayoutEffect(() => {
    const el = btnRefs.current[active];
    const container = containerRef.current;
    if (!el || !container) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, tabs]);

  // recompute on resize (font load, container resize) without animating
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      animate.current = false;
      const el = btnRefs.current[active];
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [active]);

  const isPills = variant === "pills";

  return (
    <div
      ref={containerRef}
      className={`relative flex ${isPills ? "gap-1" : "border-b border-border-main"} ${className}`}
    >
      {/* sliding indicator */}
      {indicator && (
        <span
          aria-hidden
          className={
            isPills
              ? "absolute top-0 bottom-0 rounded-lg bg-primary z-0"
              : "absolute bottom-0 h-0.5 bg-primary rounded-t-full"
          }
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: indicator.width,
            transition: animate.current
              ? "transform var(--dur-fast) var(--ease-smooth), width var(--dur-fast) var(--ease-smooth)"
              : "none",
            ...(isPills ? {} : { left: 0 }),
          }}
        />
      )}

      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => { btnRefs.current[t.id] = el; }}
            onClick={() => { animate.current = true; onChange(t.id); }}
            aria-current={isActive ? "page" : undefined}
            className={
              isPills
                ? `relative z-10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    isActive ? "text-white" : "text-text-muted hover:text-text-main"
                  }`
                : `relative px-4 py-2 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    isActive ? "text-primary" : "text-text-muted hover:text-text-main"
                  }`
            }
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
