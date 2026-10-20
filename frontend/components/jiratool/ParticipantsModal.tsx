"use client";

import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { DIRECTIONS, DIRECTION_ROLE, ROLE_SUGGESTIONS, TESTING, inDirection, newId, nextColor, normRole, type Participant } from "@/lib/jiraTool";
import { RoleBadge } from "./ListCells";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6", "#64748b"];

/**
 * Справочник людей: общий для всех списков, хранится на бэкенде. У человека — метка до 3 символов
 * (QA, BE, BA…; видна в цветной метке у ФИО) и направления: тестировщики стоят в колонке «Тестировщик»,
 * люди направлений — в полях направлений. Один человек может работать в нескольких направлениях.
 */
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
  const [palette, setPalette] = useState<string | null>(null);
  const [dir, setDir] = useState(TESTING);         // направление нового человека и фильтр списка
  const [all, setAll] = useState(false);

  const add = () => {
    if (!name.trim()) return;
    onChange([...participants, { id: newId("ptc"), name: name.trim(), role: normRole(role) || DIRECTION_ROLE[dir] || "", color: nextColor(participants), directions: [dir] }]);
    setName(""); setRole("");
  };
  const toggleDir = (p: Participant, d: string) => {
    const cur = p.directions ?? [TESTING];
    patch(p.id, { directions: cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d] });
  };
  const shown = all ? participants : participants.filter(p => inDirection(p, dir));
  const count = (d: string) => participants.filter(p => inDirection(p, d)).length;
  const patch = (id: string, p: Partial<Participant>) => onChange(participants.map(x => (x.id === id ? { ...x, ...p } : x)));
  const field = "text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={onClose} title="Справочник людей" size="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Направление">
          {DIRECTIONS.map(d => (
            <button key={d.id} type="button" role="tab" aria-selected={!all && dir === d.id} onClick={() => { setDir(d.id); setAll(false); }}
              className={`px-2.5 py-1 rounded-full text-xs border ${!all && dir === d.id ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>
              {d.label} <span className="opacity-60">{count(d.id)}</span></button>
          ))}
          <button type="button" role="tab" aria-selected={all} onClick={() => setAll(true)}
            className={`px-2.5 py-1 rounded-full text-xs border ${all ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>
            Все <span className="opacity-60">{participants.length}</span></button>
        </div>
        <datalist id="role-suggestions">{ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}</datalist>
        <div className="flex gap-2">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
            placeholder={`Имя и фамилия · ${DIRECTIONS.find(d => d.id === dir)?.label ?? ""}`} aria-label="Имя человека" className={`${field} flex-1 min-w-0`} />
          <input value={role} onChange={e => setRole(normRole(e.target.value))} onKeyDown={e => { if (e.key === "Enter") add(); }}
            list="role-suggestions" maxLength={3} placeholder="QA" aria-label="Должность, до 3 символов"
            title="Должность — до 3 символов: QA, AQA, LQA, SQA…" className={`${field} w-20 uppercase text-center font-semibold`} />
          <button type="button" onClick={add} disabled={!name.trim()} aria-label="Добавить человека"
            className="px-3 rounded-lg bg-primary text-white disabled:opacity-40"><UserPlus className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-1">
          {ROLE_SUGGESTIONS.map(r => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors
                ${role === r ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>{r}</button>
          ))}
        </div>

        <ul className="divide-y divide-border-main border border-border-main rounded-xl">
          {shown.length === 0 && <li className="p-3 text-sm text-text-muted">Пока никого в этом направлении.</li>}
          {shown.map(p => (
            <li key={p.id} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setPalette(c => (c === p.id ? null : p.id))} aria-label={`Цвет: ${p.name}`}
                  title="Сменить цвет"><RoleBadge participant={p} size="md" /></button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-main truncate">{p.name}</p>
                  <p className="text-[11px] text-text-muted">задач: {usage[p.id] ?? 0}</p>
                </div>
                <input value={p.role} onChange={e => patch(p.id, { role: normRole(e.target.value) })} list="role-suggestions" maxLength={3}
                  aria-label={`Должность: ${p.name}`} placeholder="—"
                  className="w-14 text-center text-xs font-semibold uppercase border border-border-main rounded-md px-1 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                {asking === p.id ? (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-text-muted">Снять со всех задач?</span>
                    <button type="button" onClick={() => { onChange(participants.filter(x => x.id !== p.id)); setAsking(null); }}
                      className="px-2 py-1 rounded-md bg-red-600 text-white font-semibold">Удалить</button>
                    <button type="button" onClick={() => setAsking(null)} className="px-2 py-1 rounded-md border border-border-main text-text-muted">Нет</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setAsking(p.id)} aria-label={`Удалить ${p.name}`}
                    className="p-1.5 rounded-lg text-text-muted hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5 pl-10" role="group" aria-label={`Направления: ${p.name}`}>
                {DIRECTIONS.map(d => {
                  const on = inDirection(p, d.id);
                  return (
                    <button key={d.id} type="button" aria-pressed={on} onClick={() => toggleDir(p, d.id)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${on ? "border-primary/50 text-primary bg-primary/10" : "border-border-main text-text-muted/70 hover:text-text-main"}`}>
                      {d.label}</button>
                  );
                })}
              </div>
              {palette === p.id && (
                <div className="flex gap-1.5 mt-2 pl-1" role="radiogroup" aria-label="Цвет участника">
                  {COLORS.map(c => (
                    <button key={c} type="button" role="radio" aria-checked={p.color === c} onClick={() => { patch(p.id, { color: c }); setPalette(null); }}
                      className={`w-5 h-5 rounded-full ${p.color === c ? "ring-2 ring-offset-2 ring-primary" : ""}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
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
