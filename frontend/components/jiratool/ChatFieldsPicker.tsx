"use client";

import { ListPlus } from "lucide-react";
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
    <FieldPicker label="Поля в чат" icon={<ListPlus className="w-4 h-4" />} align={align} up={up} ordered
      options={cfg.options} selected={cfg.selected} onChange={cfg.onChange}
      footer={<p className="px-1 text-[11px] text-text-muted">
        Под задачей — «Поле: значение» в порядке выбора. Пустое поле не пишется. Выбор общий для всего списка.</p>} />
  );
}
