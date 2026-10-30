"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Flag, Loader2, Plus, X } from "lucide-react";
import {
  daysBetween, fmtDay, isLate, isOverdue, issueSpan, planStartOf, todayIso, type AqaEpic, type AqaIssue, type IssueSpan,
} from "@/lib/aqaApi";

/**
 * Ширина дня по масштабу, px. Ctrl (Cmd) + колесо — плавно до MAX_W и обратно до «3 кварталов» (w = 0): тогда в экран
 * входит неделя до сегодня и три квартала вперёд — дальше не отдаляется.
 */
export const ZOOMS = [
  { id: "day", label: "День", w: 48 },
  { id: "week", label: "Неделя", w: 18 },
  { id: "month", label: "Месяц", w: 6 },
  { id: "fit", label: "3 квартала", w: 0 },
] as const;
export type ColorBy = "status" | "assignee";
const MAX_W = 120;
/** Самое крупное отдаление: неделя до сегодня + три квартала вперёд. Календарь размечен на год вперёд. */
const BACK_DAYS = 7, FIT_DAYS = BACK_DAYS + 274, YEAR_DAYS = 365;
const LANE = 28, PAD = 10, HEAD = 46, LEFT = 300, MIN_SECTION = 64, CHECK = 18;
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const dayNum = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };

/** Открытые: в работе — синий, не начата — серый, дефект — оранжевый. Закрытые — зелёная (в срок) или красная
 *  (позже планового окончания): так при любой раскраске. Красный занят нарушением срока, поэтому дефект — оранжевый. */
export const STATUS_COLORS = [
  { id: "indeterminate", label: "в работе", cls: "bg-blue-500/85 text-white" },
  { id: "new", label: "не начата", cls: "bg-slate-400/80 text-white dark:bg-slate-500/80" },
  { id: "defect", label: "дефект", cls: "bg-orange-500/85 text-white" },
] as const;
export const DONE_CLS = "bg-emerald-500/80 text-white";
export const LATE_CLS = "bg-red-600/85 text-white";
/** Отрезок после планового окончания: не закрыта вовремя. */
const OVERRUN_BG = "repeating-linear-gradient(135deg, rgb(220 38 38 / .85) 0 5px, rgb(220 38 38 / .45) 5px 10px)";
function statusCls(i: Pick<AqaIssue, "defect" | "statusCategory">): string {
  const id = i.defect ? "defect" : i.statusCategory === "indeterminate" ? "indeterminate" : "new";
  return STATUS_COLORS.find(c => c.id === id)!.cls;
}

/** Исполнители — своими цветами по порядку появления; не назначена — серая. */
const PEOPLE_CLS = [
  "bg-violet-500/85", "bg-teal-500/85", "bg-orange-500/85", "bg-pink-500/85", "bg-sky-500/85",
  "bg-lime-600/85", "bg-amber-500/85", "bg-indigo-500/85", "bg-rose-500/85", "bg-cyan-600/85",
];
export function peopleColors(epics: AqaEpic[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of epics) for (const i of e.issues) {
    if (i.assignee && !out.has(i.assignee)) out.set(i.assignee, `${PEOPLE_CLS[out.size % PEOPLE_CLS.length]} text-white`);
  }
  return out;
}
const NOBODY = "bg-slate-400/70 text-white";

type Placed = { issue: AqaIssue; span: IssueSpan; start: number; end: number; planEnd: number | null; lane: number };

/** Задачи эпика по дорожкам: полосы не наезжают друг на друга (с местом под отметку закрытой). */
function lanesOf(issues: AqaIssue[], dayW: number): { placed: Placed[]; lanes: number } {
  const gap = Math.ceil((CHECK + 4) / Math.max(dayW, 0.01));
  const items = issues.flatMap(i => {
    const s = issueSpan(i);
    return s ? [{ issue: i, span: s, start: dayNum(s.start), end: dayNum(s.end), planEnd: s.planEnd ? dayNum(s.planEnd) : null }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnd: number[] = [];
  const placed = items.map(it => {
    let lane = laneEnd.findIndex(e => e < it.start);
    if (lane < 0) lane = laneEnd.length;
    laneEnd[lane] = it.end + gap;
    return { ...it, lane };
  });
  return { placed, lanes: Math.max(1, laneEnd.length) };
}

/**
 * Роадмап AQA таймлайном. Ось слева — только разделы эпиков (и «+ Добавить эпик»); в разделе — все задачи и дефекты
 * эпика полосами по дорожкам. Полоса — от планового начала до планового окончания (полей нет — создание и срок).
 * Не закрыта к плановому окончанию — там точка, дальше полоса штрихом до фактического закрытия (не закрыта — до сегодня).
 * Цвет открытой — по статусу или по исполнителю (colorBy); закрытая — зелёная с галочкой (в срок) или красная
 * с «!» (нарушение срока). Масштаб — кнопками снаружи
 * (dayW) или Ctrl (Cmd) + колесо, от дня до трёх кварталов вперёд от сегодня; календарь — на год вперёд; перетаскивание — прокрутка. Наведение — суть задачи, исполнитель,
 * статус и даты; щелчок — задача в Jira.
 */
export default function RoadmapTimeline({ epics, dayW: zoom, onDayW, colorBy, onAddEpic, onRemoveEpic }: {
  epics: AqaEpic[]; dayW: number; onDayW: (w: number) => void; colorBy: ColorBy;
  /** Добавить эпик в роадмап (сохраняется в настройках вкладки); ошибка — текстом. */
  onAddEpic: (key: string) => Promise<void>;
  onRemoveEpic: (key: string) => Promise<void>;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Ширина видимой части — от неё самый мелкий масштаб (три квартала на экран).
  const [viewW, setViewW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const minW = viewW ? viewW / FIT_DAYS : 3;
  const dayW = zoom <= 0 ? minW : Math.max(minW, Math.min(MAX_W, zoom));
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ i: AqaIssue | AqaEpic; x: number; y: number } | null>(null);
  /** Прокрутка по горизонтали — месяц (год) дня у левого края держится подписью, пока не придёт следующий. */
  const [scrollX, setScrollX] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");
  const people = useMemo(() => peopleColors(epics), [epics]);
  const barCls = (i: AqaIssue, s: IssueSpan) =>
    s.done ? (s.late ? LATE_CLS : DONE_CLS) : colorBy === "assignee" ? (i.assignee ? people.get(i.assignee)! : NOBODY) : statusCls(i);

  const sections = useMemo(() => {
    let y = HEAD;
    return epics.map(e => {
      const { placed, lanes } = lanesOf(e.issues, dayW);
      const height = Math.max(MIN_SECTION, lanes * LANE + PAD * 2);
      const s = { epic: e, placed, top: y, height };
      y += height;
      return s;
    });
  }, [epics, dayW]);
  const bodyBottom = sections.length ? sections[sections.length - 1].top + sections[sections.length - 1].height : HEAD;

  // Период: от первой полосы (или недели до сегодня) до года вперёд от сегодня — или до последней полосы, если она дальше.
  const today = dayNum(todayIso());
  const all = sections.flatMap(s => s.placed);
  const from = Math.min(today, ...all.map(p => p.start)) - BACK_DAYS;
  const to = Math.max(today + YEAR_DAYS, ...all.map(p => p.end + 14));
  const days = to - from + 1;
  const W = Math.max(1, days * dayW);

  // Ctrl + колесо — масштаб вокруг курсора.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left + el.scrollLeft;
      const want = Math.min(MAX_W, +(dayW * (e.deltaY < 0 ? 1.2 : 1 / 1.2)).toFixed(2));
      if (want <= minW) {                       // дальше не отдаляем: три квартала от сегодня на экран
        if (zoom > 0) onDayW(0);
        return;
      }
      onDayW(want);
      requestAnimationFrame(() => { el.scrollLeft = px * (want / dayW) - (e.clientX - r.left); });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dayW, minW, zoom, onDayW]);

  // Сегодня — в видимой части при открытии и смене масштаба; на «3 кварталах» — неделя до сегодня у левого края.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollLeft = zoom <= 0 ? Math.max(0, (today - BACK_DAYS - from) * dayW)
      : Math.max(0, (today - from) * dayW - el.clientWidth / 3);
  }, [zoom <= 0 ? -1 : zoom, from, viewW > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Шкала: верхний ряд — месяцы (мелко — годы), нижний — дни, недели, месяцы или кварталы — что помещается.
  const ticks = useMemo(() => {
    const top: { left: number; label: string }[] = [];
    const bottom: { left: number; label: string; major?: boolean }[] = [];
    const weekend: number[] = [];
    for (let n = from; n <= to; n++) {
      const d = new Date(n * 86_400_000);
      const day = d.getUTCDate(), mon = d.getUTCMonth(), year = d.getUTCFullYear(), wd = d.getUTCDay();
      const left = (n - from) * dayW;
      if (dayW >= 2 ? day === 1 : day === 1 && mon === 0) top.push({ left, label: dayW >= 2 ? `${MONTHS[mon]} ${year}` : String(year) });
      if (dayW >= 22) bottom.push({ left, label: String(day), major: wd === 1 });
      else if (dayW >= 6 && wd === 1) bottom.push({ left, label: `${String(day).padStart(2, "0")}.${String(mon + 1).padStart(2, "0")}` });
      else if (dayW >= 1.2 && dayW < 6 && day === 1) bottom.push({ left, label: MONTHS[mon] });
      else if (dayW < 1.2 && day === 1 && mon % 3 === 0) bottom.push({ left, label: `Q${mon / 3 + 1}` });
      if (dayW >= 6 && (wd === 0 || wd === 6)) weekend.push(left);
    }
    return { top, bottom, weekend };
  }, [from, to, dayW]);

  // Подпись у левого края: месяц (мелко — год) первого видимого дня; прячется, когда подпирает следующая.
  const leftDay = new Date((from + Math.floor(scrollX / dayW)) * 86_400_000);
  const pinned = dayW >= 2 ? `${MONTHS[leftDay.getUTCMonth()]} ${leftDay.getUTCFullYear()}` : String(leftDay.getUTCFullYear());
  const nextTop = ticks.top.find(t => t.left > scrollX);
  const showPinned = !nextTop || nextTop.left - scrollX > 70;

  const tip = (i: AqaIssue | AqaEpic, e: React.MouseEvent) => setHover({ i, x: e.clientX, y: e.clientY });

  const add = async () => {
    const key = (adding ?? "").trim();
    if (!key) return;
    setAddBusy(true); setAddErr("");
    try { await onAddEpic(key); setAdding(null); } catch (e) { setAddErr((e as Error).message); }
    setAddBusy(false);
  };

  return (
    <div className="relative grid border border-border-main rounded-xl overflow-hidden bg-bg-card select-none"
      style={{ gridTemplateColumns: `${LEFT}px minmax(0,1fr)` }}>
      {/* Ось — только разделы эпиков */}
      <div className="border-r border-border-main bg-bg-subtle/40 text-sm">
        <div style={{ height: HEAD }} className="flex items-end px-3 pb-1.5 border-b border-border-main text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Эпики
        </div>
        {sections.map(({ epic: e, height }) => {
          const done = e.issues.filter(i => i.statusCategory === "done").length;
          const late = e.issues.filter(i => isLate(i) || isOverdue(i)).length;
          return (
            <div key={e.key} style={{ height }} className="group/ep relative flex flex-col justify-center gap-1 px-3 border-b border-border-main"
              onMouseEnter={ev => !e.missing && tip(e, ev)} onMouseLeave={() => setHover(null)}>
              <span className="flex items-center gap-1.5 min-w-0">
                <Flag className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-primary hover:underline flex-shrink-0">{e.key}</a>
                  : <span className="font-mono text-[11px] text-primary flex-shrink-0">{e.key}</span>}
              </span>
              <span className={`line-clamp-2 leading-snug ${e.missing ? "text-red-600 dark:text-red-400" : "font-semibold text-text-main"}`}>
                {e.missing ? "не найден в Jira" : e.summary}</span>
              {!e.missing && (
                <span className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-subtle">
                    <span className="block h-full bg-emerald-500" style={{ width: `${e.issues.length ? (done / e.issues.length) * 100 : 0}%` }} />
                  </span>
                  выполнено {done} из {e.issues.length}
                  {late > 0 && <span className="font-semibold text-red-600 dark:text-red-400" title="Закрыты позже планового окончания или просрочены">· срок нарушен: {late}</span>}
                </span>
              )}
              <button type="button" onClick={() => void onRemoveEpic(e.key)} aria-label={`Убрать эпик ${e.key} из роадмапа`}
                title="Убрать эпик из роадмапа (в Jira ничего не меняется)"
                className="absolute top-1.5 right-1.5 p-0.5 rounded text-text-muted opacity-0 group-hover/ep:opacity-100 focus-visible:opacity-100 hover:text-red-500">
                <X className="w-3.5 h-3.5" /></button>
            </div>
          );
        })}
        <div className="px-3 py-2.5">
          {adding === null ? (
            <button type="button" onClick={() => { setAdding(""); setAddErr(""); }} disabled={epics.length >= 5}
              title={epics.length >= 5 ? "Эпиков не больше пяти" : "Добавить эпик в роадмап"}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline disabled:opacity-40 disabled:no-underline">
              <Plus className="w-4 h-4" /> Добавить эпик</button>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <input autoFocus value={adding} onChange={e => setAdding(e.target.value)} placeholder="SBER911-… или ссылка"
                  onKeyDown={e => { if (e.key === "Enter") void add(); if (e.key === "Escape") setAdding(null); }}
                  aria-label="Номер эпика" className="min-w-0 flex-1 rounded-md border border-border-main bg-[var(--color-input-bg)] px-2 py-1 font-mono text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <button type="button" onClick={() => void add()} disabled={addBusy || !adding.trim()} aria-label="Добавить"
                  className="rounded-md bg-primary p-1 text-white disabled:opacity-40">
                  {addBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}</button>
                <button type="button" onClick={() => setAdding(null)} aria-label="Отмена" className="p-1 text-text-muted hover:text-text-main"><X className="w-3.5 h-3.5" /></button>
              </div>
              {addErr && <p className="text-[11px] text-red-600 dark:text-red-400">{addErr}</p>}
            </div>
          )}
        </div>
      </div>

      <div ref={box} className="overflow-x-auto scrollbar-thin cursor-grab active:cursor-grabbing"
        onScroll={e => setScrollX((e.currentTarget as HTMLDivElement).scrollLeft)}
        onMouseDown={e => { const el = box.current; if (el && e.button === 0) drag.current = { x: e.clientX, left: el.scrollLeft, moved: false }; }}
        onMouseMove={e => {
          const d = drag.current, el = box.current;
          if (!d || !el) return;
          if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
          el.scrollLeft = d.left - (e.clientX - d.x);
        }}
        onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}>
        <div style={{ width: W, height: bodyBottom }} className="relative">
          {/* Шкала */}
          <div style={{ height: HEAD }} className="sticky top-0 z-10 border-b border-border-main bg-bg-card">
            {showPinned && (
              <span style={{ left: scrollX }} className="absolute top-1 z-10 bg-bg-card pl-1 pr-2 text-[11px] font-semibold text-text-main whitespace-nowrap">{pinned}</span>
            )}
            {ticks.top.map(t => (
              <span key={`t${t.left}`} style={{ left: t.left }} className="absolute top-1 pl-1 border-l border-border-main text-[11px] font-semibold text-text-main whitespace-nowrap">{t.label}</span>
            ))}
            {ticks.bottom.map(t => (
              <span key={`b${t.left}`} style={{ left: t.left }}
                className={`absolute bottom-1 pl-1 text-[10px] whitespace-nowrap ${t.major ? "text-text-main font-semibold" : "text-text-muted"}`}>{t.label}</span>
            ))}
          </div>
          {/* Выходные и сетка */}
          {ticks.weekend.map(l => <div key={`w${l}`} style={{ left: l, width: dayW, top: HEAD, bottom: 0 }} className="absolute bg-bg-subtle/60" />)}
          {ticks.bottom.map(t => <div key={`g${t.left}`} style={{ left: t.left, top: HEAD, bottom: 0 }} className="absolute w-px bg-border-main/50" />)}
          {/* Разделы эпиков: граница снизу и полосы задач по дорожкам */}
          {sections.map(({ epic: e, placed, top, height }) => (
            <div key={e.key}>
              <div style={{ top: top + height - 1 }} className="absolute inset-x-0 h-px bg-border-main" />
              {placed.length === 0 && (
                <span style={{ top: top + height / 2 - 8, left: Math.max(8, scrollX + 8) }} className="absolute text-xs text-text-muted">
                  {e.missing ? "" : "Задач и дефектов нет"}</span>
              )}
              {placed.map(p => {
                const i = p.issue, s = p.span;
                const left = (p.start - from) * dayW;
                const width = Math.max(4, (p.end - p.start + 1) * dayW);
                // Плановая часть — до планового окончания; опоздание — штрихом после точки.
                const planW = s.late && p.planEnd !== null ? Math.max(2, (p.planEnd - p.start + 1) * dayW) : width;
                const barTop = top + PAD + p.lane * LANE, barH = LANE - 6;
                return (
                  <div key={i.key}>
                    <a href={i.url} target="_blank" rel="noopener noreferrer" draggable={false}
                      onClick={ev => { if (drag.current?.moved) ev.preventDefault(); }}
                      style={{ left, width, top: barTop, height: barH }}
                      className="absolute flex items-center overflow-hidden rounded-md px-1.5 text-[10px] font-medium text-white whitespace-nowrap"
                      onMouseEnter={ev => tip(i, ev)} onMouseMove={ev => tip(i, ev)} onMouseLeave={() => setHover(null)}>
                      <span aria-hidden style={{ width: planW }} className={`absolute inset-y-0 left-0 ${barCls(i, s)}`} />
                      {planW < width && <span aria-hidden style={{ left: planW, background: OVERRUN_BG }} className="absolute inset-y-0 right-0" />}
                      {width > 60 && <span className="relative truncate drop-shadow-sm">{i.key}{width > 170 ? ` · ${i.summary}` : ""}</span>}
                    </a>
                    {planW < width && (
                      <span style={{ left: left + planW - 4, top: barTop + barH / 2 - 4 }} title={`Плановое окончание ${fmtDay(s.planEnd)}`}
                        className="absolute z-[1] h-2 w-2 rounded-full bg-white ring-2 ring-red-700 pointer-events-none" />
                    )}
                    {s.done && (
                      <span style={{ left: left + width + 3, top: barTop + (barH - CHECK + 2) / 2, width: CHECK - 2, height: CHECK - 2 }}
                        title={s.late ? "Закрыта с нарушением срока" : "Выполнена в срок"}
                        className={`absolute flex items-center justify-center rounded-full text-white pointer-events-none ${s.late ? "bg-red-600" : "bg-emerald-500"}`}>
                        {s.late ? <span className="text-[11px] font-bold leading-none">!</span> : <Check className="w-3 h-3" strokeWidth={3} />}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {/* Сегодня */}
          <div style={{ left: (today - from) * dayW + dayW / 2, top: 0, bottom: 0 }} className="absolute w-0.5 bg-red-500/80 z-20 pointer-events-none">
            <span className="absolute top-0 -translate-x-1/2 rounded bg-red-500 px-1 text-[9px] font-semibold text-white">сегодня</span>
          </div>
        </div>
      </div>

      {hover && <Tip i={hover.i} x={hover.x} y={hover.y} />}
    </div>
  );
}

/** Подсказка у курсора: суть, исполнитель, статус, плановые даты, закрытие и срок. */
function Tip({ i, x, y }: { i: AqaIssue | AqaEpic; x: number; y: number }) {
  const span = i.created || i.planStart ? issueSpan(i as AqaIssue) : null;
  const plan = span ? `${i.planStart ? "План" : "Создана"} ${fmtDay(planStartOf(i as AqaIssue))} → ${span.planEnd ? fmtDay(span.planEnd) : "без планового окончания"}` : "";
  const verdict = !span ? null
    : span.done ? (span.late
      ? { cls: "text-red-600 dark:text-red-400", text: `Закрыта ${fmtDay(span.closed)} — нарушение срока на ${daysBetween(span.planEnd, span.closed)} дн.` }
      : { cls: "text-emerald-600 dark:text-emerald-400", text: span.closed ? `Закрыта ${fmtDay(span.closed)} — в срок` : "Выполнена" })
    : span.late ? { cls: "text-red-600 dark:text-red-400", text: `Не закрыта — просрочена на ${daysBetween(span.planEnd, todayIso())} дн.` }
    : null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(x + 14, vw - 340);
  // У нижнего края — над курсором, чтобы подсказка не уходила за экран.
  const pos = y > vh - 200 ? { bottom: vh - y + 14 } : { top: y + 14 };
  return (
    <div role="tooltip" style={{ position: "fixed", left, ...pos, zIndex: 60, width: 320 }}
      className="pointer-events-none rounded-lg border border-border-main bg-[var(--color-modal-bg)] p-3 text-xs shadow-lg">
      <p className="flex items-center gap-1.5 text-text-muted">
        <span className="font-mono text-primary">{i.key}</span>{i.type && <span>· {i.type}</span>}
        {i.status && <span className="ml-auto rounded bg-bg-subtle px-1.5 py-px text-text-main">{i.status}</span>}
      </p>
      <p className="mt-1 text-sm font-medium text-text-main leading-snug">{i.summary || "—"}</p>
      <p className="mt-1.5 text-text-muted">Исполнитель: <span className="text-text-main">{i.assignee || "не назначен"}</span></p>
      {span && <p className="text-text-muted">{plan}</p>}
      {"issues" in i && <p className="text-text-muted">Задач и дефектов: {i.issues.length}</p>}
      {verdict && <p className={`mt-1 font-semibold ${verdict.cls}`}>{verdict.text}</p>}
    </div>
  );
}
