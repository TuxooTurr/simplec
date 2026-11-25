"use client";

import { Plus } from "lucide-react";

function initials(name: string) {
  const [first = "?", second] = name.trim().split(/\s+/).filter(Boolean);
  return (second ? first[0] + second[0] : first.slice(0, 2)).toUpperCase();
}

export function ViewButtons({ views, active, onAdd, addLabel, addTitle = addLabel, disabled, addDisabled }: {
  views: { id: string; name: string; label: string; title: string; onSelect: () => void }[];
  active: string;
  onAdd: () => void;
  addLabel: string;
  addTitle?: string;
  disabled?: boolean;
  addDisabled?: boolean;
}) {
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed";
  return <>
    {views.map(view => {
      const selected = view.id === active;
      return <button key={view.id} type="button" aria-pressed={selected} aria-label={view.label} title={view.title}
        disabled={disabled} onClick={view.onSelect}
        className={`w-7 h-7 flex-shrink-0 rounded-full text-[10px] font-bold transition-colors ${focus}
          ${selected ? "bg-primary text-white ring-2 ring-primary/30" : "bg-bg-subtle text-text-muted hover:text-primary border border-border-main"}`}>
        {initials(view.name)}
      </button>;
    })}
    <button type="button" aria-label={addLabel} title={addTitle} onClick={onAdd} disabled={disabled || addDisabled}
      className={`w-7 h-7 flex-shrink-0 rounded-full border border-dashed border-border-main text-text-muted hover:text-primary hover:border-primary/40 flex items-center justify-center ${focus}`}>
      <Plus className="w-3.5 h-3.5" />
    </button>
  </>;
}
