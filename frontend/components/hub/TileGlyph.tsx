"use client";

import type { ComponentType } from "react";
import { gradientOf, parseIcon, useLucideIcons, type TileColor } from "@/lib/tileStyle";

type IconCmp = ComponentType<{ className?: string; strokeWidth?: number }>;

/**
 * Иконка плитки: своя (Lucide или эмодзи) или стандартная.
 * size="tile" — цветной квадрат на плитке, size="inline" — значок в заголовке.
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

  if (size === "inline") {
    return parsed?.kind === "emoji"
      ? <span className="text-lg leading-none" aria-hidden>{parsed.value}</span>
      : <Icon className="w-5 h-5 text-primary" />;
  }
  if (parsed?.kind === "emoji") {
    return (
      <div className="w-10 h-10 rounded-xl bg-bg-subtle border border-border-main flex items-center justify-center mb-3">
        <span className="text-2xl leading-none" aria-hidden>{parsed.value}</span>
      </div>
    );
  }
  return (
    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradientOf(color, fallbackColor)} flex items-center justify-center shadow-sm mb-3`}>
      <Icon className="w-5 h-5 text-white" strokeWidth={2} />
    </div>
  );
}
