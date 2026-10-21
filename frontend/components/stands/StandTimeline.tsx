"use client";

import { useEffect, useRef, useState } from "react";
import type { StandBooking, StandView } from "@/lib/standsApi";

/** Ширина дня по масштабу, px. Ctrl + колесо — плавно между MIN и MAX. */
export const ZOOM = { day: 120, week: 44 } as const;
const MIN_W = 10, MAX_W = 160;
const LANE = 26;          // высота одной брони в строке команды
const HEAD = 44;          // шапка: месяц + число
const FOOT = 26;          // строка «установок за день»

/** Цвета команд — по порядку в настройках стенда. */
export const TEAM_CLS = [
  "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-100",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-100",
  "bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-100",
  "bg-pink-100 text-pink-800 dark:bg-pink-900/60 dark:text-pink-100",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100",
  "bg-lime-100 text-lime-800 dark:bg-lime-900/60 dark:text-lime-100",
];
const CONFLICT_CLS = "bg-red-100 text-red-800 ring-2 ring-red-500 dark:bg-red-950/70 dark:text-red-200";
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/**
 * График стенда: строки — команды, по горизонтали — дни окна планирования. Бронь — блок в строке своей команды
 * (несколько броней одной команды в день — друг под другом), на блоке КЭ, при наведении — фичи и задача.
 * Конфликт (тот же КЭ в этот день у двух команд) — красный; заморозка — жёлтая полоса; дата релиза — пунктир;
 * выходные — серые; сегодня — рамка. Масштаб — кнопками снаружи (width) или Ctrl + колесо; перетаскивание —
 * прокрутка. Щелчок по пустому месту строки — новая бронь этой команде на этот день, по брони — она сама.
 */
export default function StandTimeline({ v, width, onWidth, selected, onPickCell, onPickBooking }: {
  v: StandView; width: number; onWidth: (w: number) => void; selected: string | null;
  onPickCell: (date: string, team: string) => void; onPickBooking: (b: StandBooking) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ b: StandBooking; x: number; y: number } | null>(null);

  // Ctrl + колесо — масштаб вокруг курсора (обычное колесо — прокрутка страницы, как везде).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left + el.scrollLeft;
      const next = Math.max(MIN_W, Math.min(MAX_W, Math.round(width * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
      onWidth(next);
      requestAnimationFrame(() => { el.scrollLeft = x * (next / width) - (e.clientX - r.left); });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width, onWidth]);

  // Сегодня — в видимую часть при открытии.
  useEffect(() => {
    const el = box.current;
    const i = v.days.findIndex(d => d.today);
    if (el && i >= 0) el.scrollLeft = Math.max(0, i * width - 2 * width);
  }, [v.stand]);   // eslint-disable-line react-hooks/exhaustive-deps

  const idx = new Map(v.days.map((d, i) => [d.date, i]));
  // Раскладка: у команды в каждый день брони — друг под другом; высота строки — по самому загруженному дню.
  const lanes = v.teams.map(t => Math.max(1, ...v.days.map(d => d.bookings.filter(b => b.team === t).length)));
  const tops: number[] = [];
  lanes.reduce((y, n, i) => { tops[i] = y; return y + n * LANE + 10; }, HEAD);
  const bodyH = tops.length ? tops[tops.length - 1] + lanes[lanes.length - 1] * LANE + 10 : HEAD;
  const W = v.days.length * width;
  const teamCls = (t: string) => TEAM_CLS[Math.max(0, v.teams.indexOf(t)) % TEAM_CLS.length];
  const labelEvery = width >= 34 ? 1 : width >= 18 ? 7 : 14;

  return (
    <div className="relative grid grid-cols-[170px_minmax(0,1fr)] border border-border-main rounded-xl overflow-hidden bg-bg-card select-none">
      {/* Команды — неподвижная колонка */}
      <div className="border-r border-border-main bg-bg-subtle/40 text-sm">
        <div style={{ height: HEAD }} className="border-b border-border-main" />
        {v.teams.map((t, i) => (
          <div key={t} style={{ height: lanes[i] * LANE + 10 }} className="flex items-center gap-2 px-3 border-b border-border-main">
            <span className={`w-2.5 h-2.5 rounded-full ${teamCls(t)}`} /><span className="truncate text-text-main">{t}</span>
          </div>
        ))}
        <div style={{ height: FOOT }} className="flex items-center px-3 text-xs text-text-muted">Установок</div>
      </div>

      <div ref={box} className="overflow-x-auto scrollbar-thin cursor-grab active:cursor-grabbing"
        onMouseDown={e => { const el = box.current; if (el && e.button === 0) drag.current = { x: e.clientX, left: el.scrollLeft, moved: false }; }}
        onMouseMove={e => {
          const d = drag.current, el = box.current;
          if (!d || !el) return;
          if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
          if (d.moved) el.scrollLeft = d.left - (e.clientX - d.x);
        }}
        onMouseUp={() => setTimeout(() => { drag.current = null; }, 0)} onMouseLeave={() => { drag.current = null; setHover(null); }}>
        <div className="relative" style={{ width: W, height: bodyH + FOOT }}>
          {/* Дни: фон выходных, сегодня, подписи */}
          {v.days.map((d, i) => {
            const dt = new Date(`${d.date}T00:00`);
            const first = i === 0 || dt.getDate() === 1;
            return (
              <div key={d.date} className={`absolute top-0 bottom-0 border-l border-border-main/60 ${d.weekend ? "bg-bg-subtle/70" : ""} ${d.today ? "bg-primary/5" : ""}`}
                style={{ left: i * width, width }}>
                <div className="h-[44px] border-b border-border-main text-center leading-tight pt-1 overflow-hidden">
                  <div className="text-[10px] text-text-muted h-3.5">{first ? `${MONTHS[dt.getMonth()]}` : ""}</div>
                  {(i % labelEvery === 0 || d.today) && (
                    <div className={`text-[11px] whitespace-nowrap ${d.today ? "text-primary font-bold" : d.weekend ? "text-text-muted" : "text-text-main"}`}>
                      {width >= 60 ? `${d.weekday} ` : ""}{dt.getDate()}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Сегодня — линия */}
          {v.days.some(d => d.today) && (
            <div className="absolute top-0 border-l-2 border-primary pointer-events-none" style={{ left: (idx.get(v.today.date) ?? 0) * width + width / 2, height: bodyH }} />
          )}
          {/* Заморозки */}
          {v.freezes.map(f => {
            const a = idx.get(f.from) ?? (f.from < v.window.from ? 0 : -1);
            const b = idx.get(f.to) ?? (f.to > v.window.to ? v.days.length - 1 : -1);
            if (a < 0 || b < 0) return null;
            return <div key={f.id} title={`Заморозка ${f.from} — ${f.to}${f.reason ? `: ${f.reason}` : ""}`}
              className="absolute bg-amber-400/25 border-x border-amber-500/50 pointer-events-none" style={{ left: a * width, width: (b - a + 1) * width, top: HEAD, height: bodyH - HEAD }} />;
          })}
          {/* Релизы */}
          {v.releases.map(r => idx.has(r.date) && (
            <div key={r.id} className="absolute top-0 pointer-events-none" style={{ left: idx.get(r.date)! * width + width / 2, height: bodyH }}>
              <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-red-500" />
              <span className="absolute top-0.5 left-1 px-1 rounded bg-red-500 text-white text-[10px] whitespace-nowrap">{r.name}</span>
            </div>
          ))}
          {/* Строки команд: щелчок по пустому месту — бронь этой команде на этот день */}
          {v.teams.map((t, ti) => (
            <div key={t} className="absolute left-0 right-0 border-b border-border-main/60" style={{ top: tops[ti], height: lanes[ti] * LANE + 10 }}
              onClick={e => {
                if (drag.current?.moved) return;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const day = v.days[Math.floor((e.clientX - r.left) / width)];
                if (day && !day.weekend && day.status !== "ПРОШЁЛ") onPickCell(day.date, t);
              }} />
          ))}
          {/* Брони */}
          {v.days.flatMap((d, di) => v.teams.flatMap((t, ti) => d.bookings.filter(b => b.team === t).map((b, k) => (
            <button key={b.id} type="button"
              onClick={() => { if (!drag.current?.moved) onPickBooking(b); }}
              onMouseEnter={e => setHover({ b, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}
              aria-label={`${b.team}: ${b.service}, ${d.date}${b.conflict ? ", конфликт" : ""}`}
              className={`absolute rounded-md px-1 text-left text-[11px] font-medium truncate ${b.conflict ? CONFLICT_CLS : teamCls(b.team)}
                ${selected === b.id ? "outline outline-2 outline-primary" : ""}`}
              style={{ left: di * width + 2, width: width - 4, top: tops[ti] + 5 + k * LANE, height: LANE - 4 }}>
              {width >= 30 ? b.service : ""}
            </button>
          ))))}
          {/* Установок за день; конфликт — красным */}
          {v.days.map((d, i) => d.bookings.length > 0 && (
            <div key={d.date} className={`absolute text-center text-[11px] tabular-nums ${d.conflicts.length ? "text-red-600 dark:text-red-400 font-bold" : "text-text-muted"}`}
              style={{ left: i * width, width, top: bodyH, height: FOOT, lineHeight: `${FOOT}px` }}
              title={d.conflicts.length ? `Конфликт: ${d.conflicts.map(c => `${c.service} — ${c.teams.join(", ")}`).join("; ")}` : undefined}>
              {d.bookings.length}{v.limit ? `/${v.limit}` : ""}{d.conflicts.length ? "!" : ""}
            </div>
          ))}
        </div>
      </div>

      {hover && (
        <div className="fixed z-50 max-w-xs rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-2.5 text-xs pointer-events-none"
          style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <p className="font-semibold text-text-main">{hover.b.service} · {hover.b.team}</p>
          {hover.b.conflict && <p className="text-red-600 dark:text-red-400 font-semibold">Конфликт: этот КЭ в этот день ставит другая команда</p>}
          <p className="text-text-muted">{hover.b.date.split("-").reverse().join(".")}{hover.b.task && ` · ${hover.b.task}`}</p>
          {hover.b.features ? (
            <ul className="mt-1 list-disc pl-4 text-text-main">
              {hover.b.features.split(/[;\n]/).map(x => x.trim()).filter(Boolean).map(x => <li key={x}>{x}</li>)}
            </ul>
          ) : <p className="mt-1 text-text-muted">фичи не указаны</p>}
          <p className="mt-1 text-text-muted">{hover.b.source === "comment" ? `заявка: ${hover.b.by}` : "из SimpleTest"}</p>
        </div>
      )}
    </div>
  );
}
