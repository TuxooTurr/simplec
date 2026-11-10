"use client";

import type { ComponentType } from "react";
import { gradientOf, parseIcon, useLucideIcons, type TileColor } from "@/lib/tileStyle";

type IconCmp = ComponentType<{ className?: string; strokeWidth?: number }>;

/**
 * Иконка плитки: своя (Lucide или эмодзи) или стандартная.
 * size="tile" — квадрат 36×36 на плитке, size="inline" — квадрат 20×20 в заголовке. Размер не зависит от вида иконки.
 */
export default function TileGlyph({ icon, color, fallbackIcon, fallbackColor, size = "tile" }: {
  icon?: string;
  color?: string;
  fallbackIcon: IconCmp;
  fallbackColor: TileColor;
  size?: "tile" | "inline";
}) {
  const parsed = parseIcon(icon);
  const icons = useLucideIcons(parsed?.kind === "lucide");
  const Icon: IconCmp = (parsed?.kind === "lucide" && icons?.[parsed.name]) || fallbackIcon;

  // Один квадрат на все случаи: эмодзи и иконка Lucide — одного размера, не сжимаются и не растягиваются.
  if (size === "inline") {
    return (
      <span aria-hidden className="inline-flex h-5 w-5 flex-none items-center justify-center">
        {parsed?.kind === "emoji"
          ? <span className="text-base leading-none">{parsed.value}</span>
          : <Icon className="h-5 w-5 text-primary" />}
      </span>
    );
  }
  const box = "flex h-9 w-9 flex-none items-center justify-center rounded-lg mb-3";
  if (parsed?.kind === "emoji") {
    return (
      <div aria-hidden className={`${box} bg-bg-subtle border border-border-main`}>
        <span className="text-lg leading-none">{parsed.value}</span>
      </div>
    );
  }
  return (
    <div aria-hidden className={`${box} bg-gradient-to-br ${gradientOf(color, fallbackColor)} shadow-sm`}>
      <Icon className="h-[18px] w-[18px] text-white" strokeWidth={2} />
    </div>
  );
}
