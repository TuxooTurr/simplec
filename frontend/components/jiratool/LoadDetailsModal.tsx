"use client";

import { useState } from "react";
import { ChevronRight, Eye, EyeOff, Settings2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import {
  DIRECTIONS, TESTING, calendarDays, defaultLoadRange, directionLoad, fmtMinutes,
  type Issue, type LoadSettings, type LoadSkip, type Participant, type TaskList,
} from "@/lib/jiraTool";
import LoadRowView from "./LoadRowView";

/**
 * Подробная нагрузка списка — по всем направлениям: тестирование (тестировщик + «Траты план») и поля направлений
 * (человек + план в ячейке). У каждого направления свой раздел: итог «план / ёмкость», люди с полосами загрузки
 * (глаз включает и выключает полосы — запоминается в списке), план без исполнителя и спрятанный перечень задач,
 * не учтённых в нагрузке. Здесь же галочки списка: считать ли выходные и не учитывать ли готовые задачи.
 */
export default function LoadDetailsModal({ list, people, settings, issueOf, skip, onClose, onRange, onAuto, onWeekends, onBars, onSettings }: {
  list: TaskList;
  people: Participant[];
  settings: LoadSettings;
  issueOf: (key: string) => Issue | undefined;
  skip: (key: string) => LoadSkip;
  onClose: () => void;
  onRange: (r: { from: string; to: string }) => void;
  onAuto: (on: boolean) => void;
  onWeekends: (on: boolean) => void;
  onBars: (dir: string, on: boolean) => void;
  onSettings: () => void;
}) {
  const range = list.load ?? defaultLoadRange();
  const loads = DIRECTIONS.map(d => directionLoad(list, d, people, range, skip, settings));
  const [open, setOpen] = useState<Set<string>>(() => new Set([TESTING]));
  const [shownSkipped, setShownSkipped] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const { days, weekend } = calendarDays(range.from, range.to, !!list.loadWeekends);
  const dateCls = "text-sm border border-border-main rounded-md px-2 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
  const why = (k: string) => (skip(k) === "manual" ? "снята галочка «Нагрузка»" : "готова к релизу или дальше");

  return (
    <Modal open onClose={onClose} title={`Нагрузка по направлениям · ${list.name}`} size="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && onRange({ ...range, from: e.target.value })}
            aria-label="Нагрузка: с даты" className={dateCls} />
          <span className="text-text-muted">—</span>
          <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && onRange({ ...range, to: e.target.value })}
            aria-label="Нагрузка: по дату" className={dateCls} />
          <span className="text-xs text-text-muted">
            {weekend ? `дней ${days}, из них выходных ${weekend}` : `рабочих дней ${days}`} · в день {fmtMinutes(settings.dayMinutes)}
          </span>
          <button type="button" onClick={onSettings} title="Норма дня и резервы" aria-label="Норма дня и резервы"
            className="ml-auto p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle"><Settings2 className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-col gap-1.5 text-sm text-text-main">
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox" className="mt-1" checked={!!list.loadWeekends} onChange={e => onWeekends(e.target.checked)} />
            <span>Считать выходные <span className="text-text-muted">— переработка: выходные добавляются в ёмкость и в «Траты факт»; план сверх будней показывается отдельно</span></span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox" className="mt-1" checked={list.loadAuto !== false} onChange={e => onAuto(e.target.checked)} />
            <span>Не учитывать задачи в «Готово к релизу» и дальше</span>
          </label>
        </div>

        <ul className="border border-border-main rounded-xl divide-y divide-border-main">
          {loads.map(d => {
            const isOpen = open.has(d.id);
            const bars = list.loadBars?.[d.id] !== false;
            const pct = d.capacity ? Math.min(100, Math.round((d.planned / d.capacity) * 100)) : d.planned ? 100 : 0;
            const over = d.planned > d.capacity;
            const empty = !d.rows.length && !d.unassigned.keys.length && !d.skippedKeys.length;
            return (
              <li key={d.id}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <button type="button" onClick={() => setOpen(s => toggle(s, d.id))} aria-expanded={isOpen}
                    className="min-w-0 flex-1 flex items-center gap-2 text-left">
                    <ChevronRight className={`w-4 h-4 flex-shrink-0 text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <span className="w-44 flex-shrink-0 text-sm font-medium text-text-main">{d.label}</span>
                    {empty ? <span className="text-xs text-text-muted">нет людей и плана</span> : (
                      <>
                        <span className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden" aria-hidden>
                          <span className={`block h-full rounded-full ${over ? "bg-red-500" : "bg-primary/70"}`} style={{ width: `${pct}%` }} />
                        </span>
                        <span className={`text-xs tabular-nums whitespace-nowrap ${over ? "text-red-600 dark:text-red-400 font-semibold" : "text-text-muted"}`}>
                          {fmtMinutes(d.planned)} / {fmtMinutes(d.capacity)}
                        </span>
                      </>
                    )}
                  </button>
                  <button type="button" onClick={() => onBars(d.id, !bars)} aria-pressed={bars}
                    title={bars ? "Скрыть полосы загрузки людей" : "Показать полосы загрузки людей"} aria-label={`${d.label}: полосы загрузки`}
                    className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle">
                    {bars ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
                {isOpen && (
                  <div className="px-9 pb-3 space-y-2">
                    {(() => {
                      const own = settings.reserves.filter(r => r.minutes > 0 && !r.participants.length && (!r.directions?.length || r.directions.includes(d.id)));
                      const left = Math.max(0, settings.dayMinutes - own.reduce((n, r) => n + r.minutes, 0));
                      return own.length > 0 && (
                        <p className="text-[11px] text-text-muted" title="Резервы — шестерёнкой: всем, по направлениям или людям">
                          в день {fmtMinutes(settings.dayMinutes)} − {own.map(r => `${r.name} ${fmtMinutes(r.minutes)}`).join(" − ")} = <b className="font-medium text-text-main">{fmtMinutes(left)}</b> на задачи
                        </p>
                      );
                    })()}
                    {d.rows.length === 0 ? (
                      <p className="text-xs text-text-muted">В справочнике нет людей этого направления — добавьте их в «Справочник» или прямо в ячейке направления.</p>
                    ) : (
                      <ul className="space-y-1.5">{d.rows.map(r => <LoadRowView key={r.participant.id} r={r} bars={bars} />)}</ul>
                    )}
                    {d.unassigned.keys.length > 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-300" title={d.unassigned.keys.join(", ")}>
                        Без исполнителя: задач {d.unassigned.keys.length}, план {fmtMinutes(d.unassigned.plan)} — в итог направления входит, на людей не разложен
                      </p>
                    )}
                    {d.skippedKeys.length > 0 && (
                      <div>
                        <button type="button" onClick={() => setShownSkipped(s => toggle(s, d.id))} aria-expanded={shownSkipped.has(d.id)}
                          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main">
                          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${shownSkipped.has(d.id) ? "rotate-90" : ""}`} />
                          Не учтено задач: {d.skippedKeys.length}
                        </button>
                        {shownSkipped.has(d.id) && (
                          <ul className="mt-1 ml-4 space-y-0.5">
                            {d.skippedKeys.map(k => (
                              <li key={k} className="flex gap-2 text-xs">
                                <span className="font-mono text-text-muted whitespace-nowrap">{k}</span>
                                <span className="min-w-0 truncate text-text-main">{String(issueOf(k)?.fields.summary ?? "")}</span>
                                <span className="ml-auto text-text-muted whitespace-nowrap">{why(k)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
