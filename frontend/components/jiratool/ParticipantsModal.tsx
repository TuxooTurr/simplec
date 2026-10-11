"use client";

import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { newId, nextColor, type Participant } from "@/lib/jiraTool";

/** Участники инструмента: общие для всех списков, у задачи в списке — один участник. */
export default function ParticipantsModal({ open, participants, usage, onChange, onClose }: {
  open: boolean;
  participants: Participant[];
  /** id участника → сколько задач на нём во всех списках */
  usage: Record<string, number>;
  onChange: (next: Participant[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [asking, setAsking] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    onChange([...participants, { id: newId("ptc"), name: name.trim(), role: role.trim(), color: nextColor(participants) }]);
    setName(""); setRole("");
  };
  const field = "text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={onClose} title="Участники" size="max-w-lg">
      <div className="space-y-4">
        <div className="flex gap-2">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
            placeholder="Имя и фамилия" aria-label="Имя участника" className={`${field} flex-1 min-w-0`} />
          <input value={role} onChange={e => setRole(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
            placeholder="Роль: QA, Back…" aria-label="Роль участника" className={`${field} w-36`} />
          <button type="button" onClick={add} disabled={!name.trim()} aria-label="Добавить участника"
            className="px-3 rounded-lg bg-primary text-white disabled:opacity-40"><UserPlus className="w-4 h-4" /></button>
        </div>
        <ul className="divide-y divide-border-main border border-border-main rounded-xl">
          {participants.length === 0 && <li className="p-3 text-sm text-text-muted">Пока никого. Добавьте участников команды.</li>}
          {participants.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: p.color }}>{initials(p.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-main truncate">{p.name}</p>
                <p className="text-[11px] text-text-muted">{p.role || "без роли"} · задач: {usage[p.id] ?? 0}</p>
              </div>
              {asking === p.id ? (
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="text-text-muted">Снять со всех задач и удалить?</span>
                  <button type="button" onClick={() => { onChange(participants.filter(x => x.id !== p.id)); setAsking(null); }}
                    className="px-2 py-1 rounded-md bg-red-600 text-white font-semibold">Удалить</button>
                  <button type="button" onClick={() => setAsking(null)} className="px-2 py-1 rounded-md border border-border-main text-text-muted">Отмена</button>
                </span>
              ) : (
                <button type="button" onClick={() => setAsking(p.id)} aria-label={`Удалить ${p.name}`}
                  className="p-1.5 rounded-lg text-text-muted hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
}
