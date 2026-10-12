"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { ReqOption } from "./ListCells";

export type ReqAssignMode = "add" | "replace" | "remove";

/**
 * Требования для выбранных задач: отметьте документы из раздела «Данные» и выберите, что сделать —
 * добавить к уже привязанным, заменить ими или снять. Связь хранится у задачи (общая на все списки).
 */
export default function ReqAssignModal({ open, count, options, onApply, onClose }: {
  open: boolean;
  /** Сколько задач выбрано. */
  count: number;
  options: ReqOption[];
  onApply: (ids: string[], mode: ReqAssignMode) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const shown = options.filter(o => !s || o.name.toLowerCase().includes(s) || (o.feature ?? "").toLowerCase().includes(s));
  const apply = (mode: ReqAssignMode) => { onApply(picked, mode); onClose(); };
  const btn = "px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-40";

  return (
    <Modal open={open} onClose={onClose} title={`Требования для выбранных задач: ${count}`} size="max-w-xl">
      <div className="space-y-3">
        <label className="flex items-center gap-2 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-3 py-2
          focus-within:ring-2 focus-within:ring-primary/30">
          <Search className="w-4 h-4 text-text-muted" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Название требования или фича"
            aria-label="Найти требование" className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
        </label>
        <div className="border border-border-main rounded-xl max-h-72 overflow-y-auto scrollbar-thin divide-y divide-border-main">
          {options.length === 0 && <p className="p-3 text-sm text-text-muted">В разделе «Данные» пока нет требований.</p>}
          {shown.map(o => (
            <label key={o.id} className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-bg-subtle">
              <input type="checkbox" className="mt-0.5" checked={picked.includes(o.id)}
                onChange={() => setPicked(p => (p.includes(o.id) ? p.filter(x => x !== o.id) : [...p, o.id]))} />
              <span className="min-w-0">
                <span className="block text-sm text-text-main">{o.name}</span>
                {o.feature && <span className="block text-[11px] text-text-muted">{o.feature}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Отмечено: {picked.length}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={!picked.length} onClick={() => apply("remove")}
              className={`${btn} border border-border-main text-text-muted hover:text-red-500 font-normal`}>Снять у выбранных</button>
            <button type="button" disabled={!picked.length} onClick={() => apply("replace")}
              className={`${btn} border border-border-main text-text-main font-normal`}>Заменить</button>
            <button type="button" disabled={!picked.length} onClick={() => apply("add")}
              className={`${btn} bg-primary text-white`}>Добавить</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
