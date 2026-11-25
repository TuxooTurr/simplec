"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ListView } from "@/lib/jiraTool";
import { ViewButtons } from "@/components/ui/ViewButtons";

/**
 * Представления списка кружочками: клик — переключиться (меняются только колонки; папки, порядок
 * задач и группировка общие), клик по действующему — переименовать или удалить, «+» — новое
 * представление с ключом, типом и темой.
 */
export default function ViewSwitcher({ views, active, onSwitch, onAdd, onRename, onDelete }: {
  views: ListView[];
  active: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const save = () => { if (menu && name.trim()) onRename(menu, name.trim()); setMenu(null); };

  return (
    <div ref={box} className="relative flex items-center gap-1" role="toolbar" aria-label="Представления списка">
      <ViewButtons active={active} addLabel="Новое представление"
        addTitle="Новое представление: ключ, тип и тема — дальше выберите любые колонки"
        onAdd={() => { setMenu(null); onAdd(); }} views={views.map(v => {
        const on = v.id === active;
        return {
          id: v.id, name: v.name,
          label: on ? `Представление «${v.name}» — переименовать или удалить` : `Переключить на представление «${v.name}»`,
          title: `${v.name} · колонок: ${v.columns.length}${on ? " — нажмите, чтобы переименовать" : ""}`,
          onSelect: () => {
            if (on) { setName(v.name); setMenu(m => (m === v.id ? null : v.id)); }
            else { setMenu(null); onSwitch(v.id); }
          },
        };
      })} />

      {menu && (
        <div className="absolute z-30 top-full left-0 mt-2 w-64 rounded-xl border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-2 space-y-2 animate-fade-in">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Представление</p>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} aria-label="Название представления"
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setMenu(null); }}
            className="w-full text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { onDelete(menu); setMenu(null); }} disabled={views.length < 2}
              title={views.length < 2 ? "Единственное представление удалить нельзя" : "Удалить представление (задачи и папки не трогаются)"}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-red-500 disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" /> Удалить
            </button>
            <button type="button" onClick={save} disabled={!name.trim()}
              className="ml-auto px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold disabled:opacity-40">Сохранить</button>
          </div>
        </div>
      )}
    </div>
  );
}
