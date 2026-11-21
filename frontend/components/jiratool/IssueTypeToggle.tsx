"use client";
import { ALargeSmall, Shapes } from "lucide-react";
export default function IssueTypeToggle({ iconOnly, onToggle }: { iconOnly: boolean; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} aria-pressed={iconOnly}
    aria-label="Только значок типа задачи"
    title={iconOnly ? "Тип: только значок. Показать значок и название" : "Тип: значок и название. Показать только значок"}
    className="ml-1 p-0.5 rounded shrink-0 text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary">
    {iconOnly ? <Shapes className="w-3.5 h-3.5" /> : <ALargeSmall className="w-3.5 h-3.5" />}
  </button>;
}
