"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, ChevronDown, ChevronRight, Flag, SquareCheck } from "lucide-react";
import { fmtDay, isOverdue, issueSpan, todayIso, type AqaEpic, type AqaIssue } from "@/lib/aqaApi";

/** Ширина дня по масштабу, px. Ctrl + колесо — плавно между MIN и MAX. */
export const ZOOMS = [
  { id: "day", label: "День", w: 48 },
  { id: "week", label: "Неделя", w: 18 },
  { id: "month", label: "Месяц", w: 6 },
  { id: "quarter", label: "Квартал", w: 2 },
  { id: "year", label: "Год", w: 0.6 },
] as const;
const MIN_W = 0.3, MAX_W = 120;
const ROW = 30, HEAD = 46, LEFT = 320;
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const dayNum = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };

/** Цвет полосы: дефект — красный, решённое — зелёное, в работе — синее, не начато — серое. */
function barCls(i: Pick<AqaIssue, "defect" | "statusCategory">): string {
  if (i.statusCategory === "done") return "bg-emerald-500/80 text-white";
  if (i.defect) return "bg-red-500/85 text-white";
  if (i.statusCategory === "indeterminate") return "bg-blue-500/85 text-white";
  return "bg-slate-400/80 text-white dark:bg-slate-500/80";
}

type Row = { kind: "epic"; epic: AqaEpic; span: { start: string; end: string } | null }
  | { kind: "issue"; issue: AqaIssue; span: { start: string; end: string } | null };

/**
 * Роадмап AQA таймлайном: строки — эпик, под ним его задачи и дефекты; по горизонтали — дни.
 * Полоса задачи — от создания до срока (без срока — до решения, не решена — до сегодня). Полоса эпика — по его датам,
 * а без них — от первой до последней задачи. Масштаб — кнопками снаружи (dayW) или Ctrl + колесо, от дня до года;
 * перетаскивание — прокрутка. Наведение — суть задачи, исполнитель, статус и даты; щелчок — задача в Jira.
 */
export default function RoadmapTimeline({ epics, dayW, onDayW }: {
  epics: AqaEpic[]; dayW: number; onDayW: (w: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ i: AqaIssue | AqaEpic; x: number; y: number } | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  /** Прокрутка по горизонтали — месяц (год) дня у левого края держится подписью, пока не придёт следующий. */
  const [scrollX, setScrollX] = useState(0);

  const rows: Row[] = useMemo(() => epics.flatMap(e => {
    const spans = e.issues.map(issueSpan).filter((s): s is { start: string; end: string } => !!s);
    const own = e.created ? issueSpan(e as AqaIssue) : null;
    const span = own ?? (spans.length ? { start: spans.map(s => s.start).sort()[0], end: spans.map(s => s.end).sort().at(-1)! } : null);
    const head: Row = { kind: "epic", epic: e, span };
    return closed.has(e.key) ? [head] : [head, ...e.issues.map(i => ({ kind: "issue" as const, issue: i, span: issueSpan(i) }))];
  }), [epics, closed]);

  // Период: от первой полосы минус неделя до последней (или сегодня) плюс две недели.
  const today = dayNum(todayIso());
  const starts = rows.flatMap(r => (r.span ? [dayNum(r.span.start)] : []));
  const ends = rows.flatMap(r => (r.span ? [dayNum(r.span.end)] : []));
  const from = Math.min(today, ...starts) - 7;
  const to = Math.max(today, ...ends) + 14;
  const days = to - from + 1;
  const W = Math.max(1, days * dayW);
  const x = (iso: string) => (dayNum(iso) - from) * dayW;

  // Ctrl + колесо — масштаб вокруг курсора.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left + el.scrollLeft;
      const next = Math.max(MIN_W, Math.min(MAX_W, +(dayW * (e.deltaY < 0 ? 1.2 : 1 / 1.2)).toFixed(2)));
      onDayW(next);
      requestAnimationFrame(() => { el.scrollLeft = px * (next / dayW) - (e.clientX - r.left); });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dayW, onDayW]);

  // Сегодня — в видимой части при открытии и смене масштаба.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = Math.max(0, (today - from) * dayW - el.clientWidth / 3);
  }, [dayW, from]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggle = (k: string) => setClosed(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const bodyH = rows.length * ROW;

  const tip = (i: AqaIssue | AqaEpic, e: React.MouseEvent) => setHover({ i, x: e.clientX, y: e.clientY });

  return (
    <div className="relative grid border border-border-main rounded-xl overflow-hidden bg-bg-card select-none"
      style={{ gridTemplateColumns: `${LEFT}px minmax(0,1fr)` }}>
      {/* Эпики и задачи — неподвижная колонка */}
      <div className="border-r border-border-main bg-bg-subtle/40 text-sm">
        <div style={{ height: HEAD }} className="flex items-end px-3 pb-1.5 border-b border-border-main text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Эпик · задача
        </div>
        {rows.map(r => r.kind === "epic" ? (
          <button key={`e-${r.epic.key}`} type="button" onClick={() => toggle(r.epic.key)} aria-expanded={!closed.has(r.epic.key)}
            style={{ height: ROW }} className="w-full flex items-center gap-1.5 px-2 border-b border-border-main bg-bg-subtle/70 text-left hover:bg-bg-subtle">
            {closed.has(r.epic.key) ? <ChevronRight className="w-3.5 h-3.5 text-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
            <Flag className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
            <span className="font-mono text-[11px] text-primary flex-shrink-0">{r.epic.key}</span>
            <span className="min-w-0 truncate font-semibold text-text-main" title={r.epic.summary}>{r.epic.missing ? "не найден в Jira" : r.epic.summary}</span>
            <span className="ml-auto text-[11px] text-text-muted tabular-nums">{r.epic.issues.length}</span>
          </button>
        ) : (
          <div key={`i-${r.issue.key}`} style={{ height: ROW }} className="flex items-center gap-1.5 pl-7 pr-2 border-b border-border-main"
            onMouseEnter={e => tip(r.issue, e)} onMouseLeave={() => setHover(null)}>
            {r.issue.defect ? <Bug className="w-3.5 h-3.5 text-red-500 flex-shrink-0" /> : <SquareCheck className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
            <a href={r.issue.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-primary hover:underline flex-shrink-0">{r.issue.key}</a>
            <span className={`min-w-0 truncate ${r.issue.statusCategory === "done" ? "text-text-muted line-through" : "text-text-main"}`}>{r.issue.summary}</span>
          </div>
        ))}
        {rows.length === 0 && <div style={{ height: ROW * 2 }} />}
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
        <div style={{ width: W, height: HEAD + Math.max(bodyH, ROW * 2) }} className="relative">
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
          {/* Строки */}
          {rows.map((r, n) => {
            const top = HEAD + n * ROW;
            const line = <div key={`l${n}`} style={{ top: top + ROW - 1 }} className="absolute inset-x-0 h-px bg-border-main/70" />;
            if (!r.span) return line;
            const left = x(r.span.start);
            const width = Math.max(dayW, x(r.span.end) + dayW - left, 4);
            if (r.kind === "epic") {
              return [line, (
                <div key={`eb${n}`} style={{ left, width, top: top + 9, height: ROW - 18 }}
                  className="absolute rounded-full bg-violet-500/30 border border-violet-500/60"
                  onMouseEnter={e => tip(r.epic, e)} onMouseMove={e => tip(r.epic, e)} onMouseLeave={() => setHover(null)} />
              )];
            }
            const i = r.issue;
            return [line, (
              <a key={`ib${n}`} href={i.url} target="_blank" rel="noopener noreferrer" draggable={false}
                onClick={e => { if (drag.current?.moved) e.preventDefault(); }}
                style={{ left, width, top: top + 5, height: ROW - 10 }}
                className={`absolute flex items-center rounded-md px-1.5 text-[10px] font-medium overflow-hidden whitespace-nowrap ${barCls(i)}
                  ${isOverdue(i) ? "ring-2 ring-red-600 ring-offset-1 ring-offset-bg-card" : ""}`}
                onMouseEnter={e => tip(i, e)} onMouseMove={e => tip(i, e)} onMouseLeave={() => setHover(null)}>
                {width > 70 && <span className="truncate">{i.key}{width > 180 ? ` · ${i.summary}` : ""}</span>}
              </a>
            )];
          })}
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

/** Подсказка у курсора: суть, исполнитель, статус, даты. */
function Tip({ i, x, y }: { i: AqaIssue | AqaEpic; x: number; y: number }) {
  const span = i.created ? issueSpan(i as AqaIssue) : null;
  const end = i.due ? `срок ${fmtDay(i.due)}` : i.resolved ? `решена ${fmtDay(i.resolved)}` : "не решена — до сегодня";
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
      {span && <p className="text-text-muted">Создана {fmtDay(i.created ?? "")} → {end}</p>}
      {"issues" in i && <p className="text-text-muted">Задач и дефектов: {i.issues.length}</p>}
      {i.due && isOverdue(i as AqaIssue) && <p className="mt-1 font-semibold text-red-600 dark:text-red-400">Просрочена</p>}
    </div>
  );
}
