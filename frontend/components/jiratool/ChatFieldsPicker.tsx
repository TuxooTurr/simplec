"use client";

import { ListPlus, MessageSquareShare } from "lucide-react";
import FieldPicker, { type PickOption } from "./FieldPicker";
import type { ChatFields } from "@/lib/jiraTool";

/** «Поля в чат»: выбор (общий на список) и строки выбранных полей задачи — для всех кнопок «Скопировать в чат». */
export interface ChatFieldsCfg {
  options: PickOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  lines: ChatFields;
}

/**
 * Какие поля писать под задачей в «Скопировать в чат»: любые и сколько угодно, по порядку выбора.
 * По умолчанию — никаких; пустое у задачи поле не пишется вовсе, вместе с названием.
 */
export default function ChatFieldsPicker({ cfg, align, up }: { cfg: ChatFieldsCfg; align?: "left" | "right"; up?: boolean }) {
  return (
    <FieldPicker label="Поля в чат" iconOnly icon={<ListPlus className="w-4 h-4" />} align={align} up={up} ordered
      options={cfg.options} selected={cfg.selected} onChange={cfg.onChange}
      footer={<p className="px-1 text-[11px] text-text-muted">
        Под задачей — «Поле: значение» в порядке выбора. Пустое поле не пишется. Выбор общий для всего списка.</p>} />
  );
}

/**
 * «Скопировать в чат» и «Поля в чат» — два значка рядом, одинаково на экране списков и в окнах задач/дефектов
 * (внизу слева). Подпись и счётчик — в подсказке, для чтения с экрана — aria-label.
 */
export function ChatCopyControls({ cfg, onCopy, disabled, title, count }: {
  cfg?: ChatFieldsCfg | null; onCopy: () => void; disabled?: boolean; title: string; count?: string;
}) {
  const label = `Скопировать в чат${count ? ` (${count})` : ""}`;
  return (
    <span className="flex items-center gap-1.5">
      <button type="button" onClick={onCopy} disabled={disabled} aria-label={label} title={`${label}. ${title}`}
        className="flex items-center px-2 py-1.5 rounded-lg border border-border-main text-text-main hover:bg-bg-subtle hover:text-primary disabled:opacity-40 disabled:hover:text-text-main">
        <MessageSquareShare className="w-4 h-4" />
      </button>
      {cfg && <ChatFieldsPicker cfg={cfg} up />}
    </span>
  );
}
