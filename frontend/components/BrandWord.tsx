"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Шрифт надписи экрана входа — тот же в шапке меню. */
export const BRAND_FONT = "Impact, Haettenschweiler, 'Arial Narrow Bold', 'Franklin Gothic Bold', sans-serif";
const SPACING = 0.04;   // разрядка экрана входа, em

/**
 * «SHARK» шрифтом экрана входа: размер шрифта подбирается по ширине контейнера (замер на canvas, пересчёт при
 * изменении ширины). scale — какую долю ширины занять, spacing — разрядка в em. Отступ от краёв задаёт контейнер.
 */
export default function BrandWord({ text = "SHARK", className = "", scale = 1, spacing = SPACING }: {
  text?: string; className?: string; scale?: number; spacing?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ctx = document.createElement("canvas").getContext("2d");
    const fit = () => {
      if (!ctx) return;
      ctx.font = `100px ${BRAND_FONT}`;
      const per100 = ctx.measureText(text).width;
      // ширина = глифы + разрядка между буквами (после последней разрядку снимаем отрицательным отступом)
      const k = per100 / 100 + spacing * (text.length - 1);
      setSize(Math.max(10, Math.floor(((el.clientWidth * scale) / k) * 10) / 10));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, scale, spacing]);

  return (
    <div ref={box} className={`min-w-0 ${className}`}>
      <span aria-label="Shark" className="block select-none whitespace-nowrap leading-[0.9] text-indigo-950 dark:text-indigo-100"
        style={{ fontFamily: BRAND_FONT, fontSize: size || undefined, letterSpacing: `${spacing}em`, marginRight: `${-spacing}em`,
          visibility: size ? "visible" : "hidden" }}>
        {text}
      </span>
    </div>
  );
}
