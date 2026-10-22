"use client";

import { useEffect, useRef, useState } from "react";
import { keKey, type StandBooking, type StandView } from "@/lib/standsApi";

/** Установка на графике: команда + день + микросервис; внутри — фичи (брони), ради которых его ставят. */
export interface StandBlock { key: string; date: string; team: string; service: string; conflict: boolean; items: StandBooking[] }

/** Статус (st) фичи из Jira tool: кружок и подпись; null — задачи нет в Jira tool. */
export type FeatureStage = (taskKey: string) => { dot: string; text: string } | null;


/** Брони дня одной команды → установки по микросервису (порядок — по названию). */
export function blocksOf(bookings: StandBooking[], team: string, date: string): StandBlock[] {
  const by = new Map<string, StandBlock>();
  for (const b of bookings.filter(x => x.team === team)) {
    const k = keKey(b.service);
    const cur = by.get(k) ?? { key: `${date}|${team}|${k}`, date, team, service: b.service.trim(), conflict: false, items: [] };
    cur.items.push(b);
    cur.conflict = cur.conflict || b.conflict;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => a.service.localeCompare(b.service, "ru"));
}

/** «ЧЧ:ММ» → минуты от начала дня; не время — null. */
export const toMin = (t?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const DAY = 24 * 60;

/** Время установки блока: от самого раннего начала до самого позднего конца; есть бронь без времени — весь день. */
export function spanOf(items: StandBooking[]): [number, number] {
  let a = DAY, z = 0;
  for (const it of items) {
    const f = toMin(it.timeFrom), t = toMin(it.timeTo);
    if (f == null || t == null || f >= t) return [0, DAY];
    a = Math.min(a, f); z = Math.max(z, t);
  }
  return a < z ? [a, z] : [0, DAY];
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Ширина дня по масштабу, px. Ctrl + колесо — плавно между MIN и MAX. С HOURS_FROM px день делится на часы:
 * сетка по часам, бронь со временем стоит на своих часах; «Часы» — 40 px на час.
 */
export const ZOOM = { hours: 960, day: 120, week: 44 } as const;
const MIN_W = 6, MAX_W = 1440, HOURS_FROM = 192;
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
 * График стенда: строки — команды, по горизонтали — дни показанного периода (окно планирования или, например,
 * последние 3 месяца; дни вне окна заштрихованы — только просмотр). Блок — установка: команда + день + микросервис
 * (один микросервис по нескольким фичам — один блок со счётчиком фич; разные — друг под другом). При наведении —
 * фичи: номер, название, период, время и статус (st) из Jira tool.
 * Масштаб — от часов внутри дня (сетка по часам, бронь со временем стоит на своих часах, линия «сейчас») до
 * квартала: кнопками снаружи (width) или Ctrl + колесо; перетаскивание — прокрутка.
 * Конфликт (тот же микросервис у двух команд в пересекающееся время) — красный; заморозка — жёлтая полоса;
 * дата релиза — пунктир; выходные — серые. Щелчок по пустому месту строки — новая бронь этой команде на этот день
 * (в часах — с этого часа), по брони — она сама.
 */
export default function StandTimeline({ v, width, onWidth, selected, onPickCell, onPickBlock, featureStage }: {
  v: StandView; width: number; onWidth: (w: number) => void; selected: string | null;
  /** Щелчок по пустому месту: день, команда и (в часовом масштабе) час, на который пришёлся щелчок, в минутах. */
  onPickCell: (date: string, team: string, minute: number | null) => void; onPickBlock: (b: StandBlock) => void; featureStage: FeatureStage;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ b: StandBlock; x: number; y: number } | null>(null);
  /** Прокрутка по горизонтали — в часах подпись дня, видимого слева, держится у левого края. */
  const [scrollX, setScrollX] = useState(0);

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

  const hourMode = width >= HOURS_FROM;
  // Сегодня — в видимую часть при открытии, смене периода и переходе в часы (там — с 8 утра).
  useEffect(() => {
    const el = box.current;
    const i = v.days.findIndex(d => d.today);
    if (!el || i < 0) return;
    el.scrollLeft = hourMode ? Math.max(0, i * width + (8 / 24) * width - 40) : Math.max(0, i * width - 2 * width);
  }, [v.stand, v.range.from, v.range.to, hourMode]);   // eslint-disable-line react-hooks/exhaustive-deps

  const idx = new Map(v.days.map((d, i) => [d.date, i]));
  // Раскладка: у команды в каждый день установки (микросервисы) — друг под другом; высота строки — по самому загруженному дню.
  const blocks = v.days.map(d => v.teams.map(t => blocksOf(d.bookings, t, d.date)));
  const lanes = v.teams.map((_, ti) => Math.max(1, ...blocks.map(day => day[ti].length)));
  const tops: number[] = [];
  lanes.reduce((y, n, i) => { tops[i] = y; return y + n * LANE + 10; }, HEAD);
  const bodyH = tops.length ? tops[tops.length - 1] + lanes[lanes.length - 1] * LANE + 10 : HEAD;
  const W = v.days.length * width;
  const teamCls = (t: string) => TEAM_CLS[Math.max(0, v.teams.indexOf(t)) % TEAM_CLS.length];
  const labelEvery = width >= 34 ? 1 : width >= 18 ? 7 : 14;
  const pxHour = width / 24;
  const hourStep = pxHour >= 36 ? 1 : pxHour >= 18 ? 2 : pxHour >= 12 ? 3 : 6;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

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
        onScroll={e => { if (hourMode) setScrollX((e.currentTarget as HTMLDivElement).scrollLeft); }}
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
              <div key={d.date} className={`absolute top-0 bottom-0 border-l ${hourMode ? "border-border-main" : "border-border-main/60"}
                ${d.weekend ? "bg-bg-subtle/70" : ""} ${!d.inWindow ? "bg-bg-subtle/50 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_6px,rgba(127,127,127,.08)_6px,rgba(127,127,127,.08)_12px)]" : ""}
                ${d.today ? "bg-primary/5" : ""}`}
                style={{ left: i * width, width }} title={d.inWindow ? undefined : "Вне окна планирования — только просмотр"}>
                {hourMode ? (
                  <div className="h-[44px] border-b border-border-main leading-tight overflow-hidden">
                    <div className={`text-[11px] px-1 pt-0.5 whitespace-nowrap ${d.today ? "text-primary font-bold" : d.weekend ? "text-text-muted" : "text-text-main"}`}>
                      {d.weekday} {dt.getDate()} {MONTHS[dt.getMonth()]}</div>
                    <div className="relative h-4">
                      {Array.from({ length: 24 / hourStep }, (_, k) => k * hourStep).map(h => (
                        <span key={h} className="absolute text-[9px] text-text-muted tabular-nums" style={{ left: h * pxHour + 2 }}>{String(h).padStart(2, "0")}</span>
                      ))}
                    </div>
                  </div>
                ) : width < 34 ? (
                  // Узко (месяц, квартал): подписи выходят за границу дня вправо, иначе от «сен» осталась бы «с».
                  <div className="relative h-[44px] border-b border-border-main">
                    {first && <span className="absolute z-10 left-0.5 top-1 text-[10px] text-text-muted whitespace-nowrap">
                      {MONTHS[dt.getMonth()]}{dt.getMonth() === 0 || i === 0 ? ` ${dt.getFullYear()}` : ""}</span>}
                    {(i % labelEvery === 0 || d.today) && (
                      <span className={`absolute z-10 left-0.5 top-[22px] text-[11px] whitespace-nowrap ${d.today ? "text-primary font-bold" : "text-text-main"}`}>
                        {dt.getDate()}</span>
                    )}
                  </div>
                ) : (
                  <div className="h-[44px] border-b border-border-main text-center leading-tight pt-1 overflow-hidden">
                    <div className="text-[10px] text-text-muted h-3.5">{first ? `${MONTHS[dt.getMonth()]}` : ""}</div>
                    {(i % labelEvery === 0 || d.today) && (
                      <div className={`text-[11px] whitespace-nowrap ${d.today ? "text-primary font-bold" : d.weekend ? "text-text-muted" : "text-text-main"}`}>
                        {width >= 60 ? `${d.weekday} ` : ""}{dt.getDate()}
                      </div>
                    )}
                  </div>
                )}
                {/* Часовая сетка */}
                {hourMode && Array.from({ length: 24 / hourStep - 1 }, (_, k) => (k + 1) * hourStep).map(h => (
                  <div key={h} className="absolute top-[28px] bottom-0 border-l border-border-main/30 pointer-events-none" style={{ left: h * pxHour }} />
                ))}
              </div>
            );
          })}
          {/* Часы: подпись дня, который виден слева, — у левого края (день шире экрана, его начало уходит за край) */}
          {hourMode && (() => {
            const i = Math.min(v.days.length - 1, Math.max(0, Math.floor(scrollX / width)));
            const d = v.days[i];
            if (!d || scrollX - i * width < 60) return null;     // начало дня и так видно
            const dt = new Date(`${d.date}T00:00`);
            return (
              <div className="absolute z-10 top-0 px-1.5 pt-0.5 text-[11px] whitespace-nowrap bg-bg-card border-r border-b border-border-main rounded-br pointer-events-none"
                style={{ left: scrollX }}>
                <span className={d.today ? "text-primary font-bold" : "text-text-main"}>{d.weekday} {dt.getDate()} {MONTHS[dt.getMonth()]}</span>
              </div>
            );
          })()}
          {/* Сегодня — линия */}
          {v.days.some(d => d.today) && (
            <div className="absolute top-0 border-l-2 border-primary pointer-events-none" title={hourMode ? `Сейчас ${hhmm(nowMin)}` : undefined}
              style={{ left: (idx.get(v.today.date) ?? 0) * width + (hourMode ? (nowMin / DAY) * width : width / 2), height: bodyH }} />
          )}
          {/* Заморозки */}
          {v.freezes.map(f => {
            const a = idx.get(f.from) ?? (f.from < v.range.from ? 0 : -1);
            const b = idx.get(f.to) ?? (f.to > v.range.to ? v.days.length - 1 : -1);
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
                const x = e.clientX - r.left;
                const day = v.days[Math.floor(x / width)];
                // В часовом масштабе — ещё и час под курсором (бронь с этого часа).
                const minute = hourMode ? Math.floor(((x % width) / width) * 24) * 60 : null;
                if (day && !day.weekend && day.inWindow && day.status !== "ПРОШЁЛ") onPickCell(day.date, t, minute);
              }} />
          ))}
          {/* Установки: команда + день + микросервис; в часовом масштабе — на своих часах */}
          {blocks.flatMap((day, di) => day.flatMap((list, ti) => list.map((b, k) => {
            const [a, z] = spanOf(b.items);
            const timed = z - a < DAY;
            const left = hourMode ? di * width + (a / DAY) * width + 1 : di * width + 2;
            const w = hourMode ? Math.max(14, ((z - a) / DAY) * width - 2) : width - 4;
            return (
              <button key={b.key} type="button"
                onClick={() => { if (!drag.current?.moved) onPickBlock(b); }}
                onMouseEnter={e => setHover({ b, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}
                aria-label={`${b.team}: ${b.service}, ${b.date}${timed ? ` ${hhmm(a)}–${hhmm(z)}` : ""}, фич ${b.items.length}${b.conflict ? ", конфликт" : ""}`}
                className={`absolute rounded-md px-1 text-left text-[11px] font-medium flex items-center gap-1 overflow-hidden ${b.conflict ? CONFLICT_CLS : teamCls(b.team)}
                  ${selected === b.key ? "outline outline-2 outline-primary" : ""}`}
                style={{ left, width: w, top: tops[ti] + 5 + k * LANE, height: LANE - 4 }}>
                {w >= 30 && <span className="truncate">{b.service}</span>}
                {timed && w >= 110 && <span className="flex-shrink-0 text-[10px] opacity-75 tabular-nums">{hhmm(a)}–{hhmm(z)}</span>}
                {b.items.length > 1 && w >= 52 && <span className="ml-auto flex-shrink-0 px-1 rounded bg-black/10 dark:bg-white/15 text-[10px]">×{b.items.length}</span>}
              </button>
            );
          })))}
          {/* Установок за день; конфликт — красным */}
          {v.days.map((d, i) => blocks[i].some(x => x.length) && (
            <div key={d.date} className={`absolute text-center text-[11px] tabular-nums ${d.conflicts.length ? "text-red-600 dark:text-red-400 font-bold" : "text-text-muted"}`}
              style={{ left: i * width, width, top: bodyH, height: FOOT, lineHeight: `${FOOT}px` }}
              title={`Установок ${blocks[i].reduce((n, x) => n + x.length, 0)}${d.conflicts.length ? `. Конфликт: ${d.conflicts.map(c => `${c.service} — ${c.teams.join(", ")}`).join("; ")}` : ""}`}>
              {/* Узко — точка (число в подсказке), иначе числа соседних дней слипаются */}
              {width < 16 ? "•" : <>{blocks[i].reduce((n, x) => n + x.length, 0)}{v.limit ? `/${v.limit}` : ""}{d.conflicts.length ? "!" : ""}</>}
            </div>
          ))}
        </div>
      </div>

      {hover && (
        <div className="fixed z-[120] max-w-sm rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-2.5 text-xs pointer-events-none"
          style={{ left: Math.min(hover.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1600) - 400), top: hover.y + 12 }}>
          <p className="font-semibold text-text-main">{hover.b.service} · {hover.b.team} · {hover.b.date.split("-").reverse().join(".")}</p>
          {hover.b.conflict && <p className="text-red-600 dark:text-red-400 font-semibold">Конфликт: этот микросервис в это время ставит другая команда</p>}
          <p className="mt-1 text-text-muted">Фичи ({hover.b.items.length}):</p>
          <ul className="mt-0.5 space-y-0.5">
            {hover.b.items.map(it => {
              const st = it.task ? featureStage(it.task) : null;
              return (
                <li key={it.id} className="flex gap-1.5 text-text-main">
                  <span className="font-mono text-primary whitespace-nowrap">{it.task || "—"}</span>
                  <span className="min-w-0 flex-1">{it.features || <span className="text-text-muted">без названия</span>}
                    {it.dateTo && <span className="text-text-muted"> · {it.date.slice(8, 10)}.{it.date.slice(5, 7)}–{it.dateTo.slice(8, 10)}.{it.dateTo.slice(5, 7)}</span>}
                    {it.timeFrom && it.timeTo && <span className="text-text-muted"> · {it.timeFrom}–{it.timeTo}</span>}</span>
                  <span className="whitespace-nowrap text-text-muted">{st ? `${st.dot} ${st.text}` : ""}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
