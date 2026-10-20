"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import {
  DIRECTIONS, LOAD_DAY_MINUTES, fmtMinutes, inDirection, netDayMinutes, newId, parseDuration,
  type LoadReserve, type LoadSettings, type Participant,
} from "@/lib/jiraTool";

/** Минуты → поле ввода в часах: 60 → «1», 90 → «1.5». */
const toHours = (min: number) => String(Math.round((min / 60) * 100) / 100);

/**
 * Настройка нагрузки (общая для всех списков): сколько длится рабочий день и какие резервы забирают
 * из него время — например, у тестирования час на встречи и час на автотесты, у бэкенда — своё.
 * Резерв — всем, людям выбранных направлений или конкретным людям.
 */
export default function LoadSettingsModal({ open, settings, participants, onSave, onClose }: {
  open: boolean;
  settings: LoadSettings;
  participants: Participant[];
  onSave: (s: LoadSettings) => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState(toHours(settings.dayMinutes));
  const [reserves, setReserves] = useState<(LoadReserve & { text: string })[]>(
    settings.reserves.map(r => ({ ...r, text: toHours(r.minutes) })));

  const dayMin = parseDuration(day, "h");
  const parsed = reserves.map(r => ({ ...r, minutes: parseDuration(r.text, "h") }));
  const badDay = dayMin === null || dayMin <= 0 || dayMin > 24 * 60;
  const badReserve = parsed.some(r => r.minutes === null || !r.name.trim());
  const draft: LoadSettings = {
    dayMinutes: badDay ? LOAD_DAY_MINUTES : dayMin!,
    reserves: parsed.filter(r => r.minutes !== null).map(({ text: _t, ...r }) => ({ ...r, name: r.name.trim(), minutes: r.minutes! })),
  };

  const patch = (id: string, p: Partial<LoadReserve & { text: string }>) => setReserves(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)));
  // Направления и люди — взаимоисключающие: «у тестирования» или «у этих людей», иначе непонятно, кому резерв.
  const toggle = (r: LoadReserve, pid: string) =>
    patch(r.id, { directions: [], participants: r.participants.includes(pid) ? r.participants.filter(x => x !== pid) : [...r.participants, pid] });
  const toggleDir = (r: LoadReserve, d: string) => {
    const cur = r.directions ?? [];
    patch(r.id, { participants: [], directions: cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d] });
  };
  const add = () => setReserves(rs => [...rs, { id: newId("rsv"), name: rs.length ? "" : "Автотесты", minutes: 60, text: "1", participants: [] }]);

  const field = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs transition-colors ${on
    ? "border-primary bg-primary/10 text-primary font-medium" : "border-border-main text-text-muted hover:text-text-main"}`;

  return (
    <Modal open={open} onClose={onClose} title="Настройка нагрузки" size="max-w-2xl">
      <div className="space-y-5">
        <p className="text-xs text-text-muted">Общая для всех списков: норма и резервы относятся к людям, а не к спискам.</p>

        <section className="space-y-1.5">
          <label htmlFor="load-day" className="block text-xs font-semibold text-text-muted">Рабочий день на задачи, часов</label>
          <div className="flex items-center gap-2">
            <input id="load-day" value={day} onChange={e => setDay(e.target.value)} inputMode="decimal" aria-invalid={badDay}
              className={`${field} w-24 ${badDay ? "border-red-400" : ""}`} />
            <span className="text-xs text-text-muted">
              {badDay ? "Введите часы: 7, 6.5 или 6:30" : `${fmtMinutes(dayMin!)} в будний день — до вычета резервов`}
            </span>
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-text-muted">Резервы — время каждый день не на задачи списка</p>
            <button type="button" onClick={add} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus className="w-3.5 h-3.5" /> резерв
            </button>
          </div>
          {reserves.length === 0 && (
            <p className="text-sm text-text-muted p-3 border border-dashed border-border-main rounded-xl text-center">
              Резервов нет. Например: у тестирования «Встречи — 1 ч» и «Автотесты — 1 ч» в день.
            </p>
          )}
          {reserves.map(r => {
            const min = parseDuration(r.text, "h");
            return (
              <div key={r.id} className="border border-border-main rounded-xl p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <input value={r.name} onChange={e => patch(r.id, { name: e.target.value })} placeholder="Название: автотесты, дежурство…"
                    aria-label="Название резерва" aria-invalid={!r.name.trim()} className={`${field} min-w-0 flex-1`} />
                  <input value={r.text} onChange={e => patch(r.id, { text: e.target.value })} inputMode="decimal" aria-label="Часов в день"
                    aria-invalid={min === null} className={`${field} w-20 ${min === null ? "border-red-400" : ""}`} />
                  <span className="text-xs text-text-muted whitespace-nowrap">ч в день</span>
                  <button type="button" onClick={() => setReserves(rs => rs.filter(x => x.id !== r.id))} aria-label={`Удалить резерв ${r.name}`}
                    className="p-1.5 rounded-md text-text-muted hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-muted mr-0.5">Кому:</span>
                  <button type="button" onClick={() => patch(r.id, { participants: [], directions: [] })}
                    aria-pressed={!r.participants.length && !r.directions?.length}
                    className={chip(!r.participants.length && !r.directions?.length)}>Всем</button>
                  {DIRECTIONS.map(d => (
                    <button key={d.id} type="button" onClick={() => toggleDir(r, d.id)} aria-pressed={!!r.directions?.includes(d.id)}
                      title={`Всем людям направления «${d.label}»`} className={chip(!!r.directions?.includes(d.id))}>{d.label}</button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-muted mr-0.5">или людям:</span>
                  {participants.map(p => (
                    <button key={p.id} type="button" onClick={() => toggle(r, p.id)} aria-pressed={r.participants.includes(p.id)}
                      className={chip(r.participants.includes(p.id))}>{p.name}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {participants.length > 0 && !badDay && (
          <section className="rounded-lg bg-bg-subtle px-3 py-2 text-xs space-y-0.5">
            <p className="font-semibold text-text-main">На задачи в день останется:</p>
            {DIRECTIONS.map(d => {
              const members = participants.filter(p => inDirection(p, d.id));
              if (!members.length) return null;
              return (
                <div key={d.id}>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">{d.label}</p>
                  {members.map(p => (
                    <p key={p.id} className="flex justify-between gap-2 text-text-muted">
                      <span className="truncate">{p.name}</span><span className="tabular-nums text-text-main">{fmtMinutes(netDayMinutes(draft, p))}</span>
                    </p>
                  ))}
                </div>
              );
            })}
          </section>
        )}

        <div className="flex items-center gap-2 pt-1">
          {(badDay || badReserve) && <p className="text-xs text-red-600 dark:text-red-400">Заполните часы и названия резервов</p>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={badDay || badReserve} onClick={() => { onSave(draft); onClose(); }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">Сохранить</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
