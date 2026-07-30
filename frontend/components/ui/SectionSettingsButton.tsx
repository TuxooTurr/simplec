"use client";

import { Settings2 } from "lucide-react";

export interface SectionSettingsButtonProps {
  onClick:   () => void;
  /** Подпись рядом с шестерёнкой. По умолчанию — «Настройки». */
  label?:    string;
  title?:    string;
  className?: string;
}

/**
 * Кнопка настроек раздела — всегда вверху справа и выглядит одинаково везде.
 *
 * Раньше подключения каждого раздела жили на общей странице настроек, и попасть
 * в них из самого раздела было нельзя. Теперь настройки раздела открываются
 * модальным окном прямо из его шапки.
 */
export function SectionSettingsButton({
  onClick, label = "Настройки", title, className = "",
}: SectionSettingsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1.5
        text-xs font-semibold text-text-muted hover:bg-bg-subtle hover:text-text-main
        transition-colors ${className}`}
    >
      <Settings2 className="h-3.5 w-3.5 shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export default SectionSettingsButton;
