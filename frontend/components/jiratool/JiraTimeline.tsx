"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Hand, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { IssueTypeIcon, StageBadge } from "./ListCells";
import { PlanDates } from "./IssueModal";
import type { Issue } from "@/lib/jiraModel";
import { NO_FOLDER } from "@/lib/jiraTool";
import { STAGES, STAGE_LABEL, jiraStageOf, stageStyle, stageText, type Stage, type StageInfo } from "@/lib/jiraStages";
import { fmtDate, fmtDateTime, stageValLabel, type ChronoEntry, type StageVal, type TaskTimeline } from "@/lib/jiraTimeline";

/**
 * Масштаб — ширина суток, px. «Часы» — 1 px на 3 минуты: видно, во сколько сменили статус. Ctrl (Cmd) + колесо —
 * плавно от MIN_W до MAX_W (2 px на минуту).
 */
export const TL_ZOOMS = [
  { id: "hours", label: "Часы", w: 480 },
  { id: "day", label: "День", w: 48 },
  { id: "week", label: "Неделя", w: 18 },
  { id: "month", label: "Месяц", w: 6 },
] as const;
const MIN_W = 1, MAX_W = 2880;
// Дорожка задачи, отступы полосы папки, шапка, колонка папок. Подпись — внутри плашки; короче MIN_BAR плашка не бывает:
// значок типа должен поместиться.
const LANE = 30, PAD = 8, MIN_SECTION = 56, HEAD = 46, LEFT = 220, BACK_DAYS = 7, AHEAD_DAYS = 60;
const BAR_H = 20, MIN_BAR = 22, LANE_GAP = 6;
const DAY = 86_400_000;
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const NEUTRAL = "#cbd5e1";

/** Без этапа (не сопоставлен, нет сторей) — светло-серый. */
const noStage = (v: StageVal) => v.startsWith("unmapped:") || v === "no-stories";
const colorOf = (v: StageVal): string => (noStage(v) ? NEUTRAL : String(stageStyle(v).backgroundColor));
const textColorOf = (v: StageVal): string => (noStage(v) ? "#334155" : String(stageStyle(v).color ?? "#fff"));
const midnight = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** Человек команды задачи: направление, ФИО, метка должности. */
export interface TeamMember { dir: string; name: string; role: string; color?: string }

/**
 * Jira tool — вид «График». По оси Y — только папки списка; задачи папки — плашками в её полосе, по дорожкам, чтобы не
 * наезжали друг на друга. Справа от плашки — значок типа (эпик, стори, баг…), ключ и название. По оси X — время.
 * Плашка задачи стоит по датам и окрашена по отрезкам статуса (st): каждый цвет — с момента смены статуса (точность —
 * минуты, на масштабе «Часы» видно время). Пунктир вокруг — плановые даты. Красная отметка — срок нарушен: к концу дня
 * планового окончания задача не «Готово к релизу» и дальше; плашка после неё красится по статусам как обычно.
 * Наведение — подробности и команда задачи (начиная с аналитика); щелчок по плашке — хронология (оттуда — окно задачи).
 */
export default function JiraTimeline({ sections, timelines, stageOf, teamOf, dayW: zoom, onDayW, onOpenIssue, onStageManual, onPlanSaved, loading, error }: {
  sections: { name: string | null; issues: Issue[] }[];
  timelines: Map<string, TaskTimeline>;
  stageOf: (i: Issue) => StageInfo;
  teamOf: (i: Issue) => TeamMember[];
  dayW: number;
  onDayW: (w: number) => void;
  onOpenIssue: (i: Issue) => void;
  /** Статус (st) руками — в любую сторону; null — вернуть расчёт по Jira. */
  onStageManual: (key: string, stage: Stage | null) => void;
  /** Плановые даты записаны в Jira — перечитать историю задачи. */
  onPlanSaved: (key: string) => void;
  loading: boolean;
  error: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const dayW = Math.max(MIN_W, Math.min(MAX_W, zoom || 18));
  const [hover, setHover] = useState<{ issue: Issue; x: number; y: number } | null>(null);
  const [chrono, setChrono] = useState<Issue | null>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const now = Date.now();

  // Период: неделя до самой ранней плашки (или сегодня) — 60 дней вперёд от сегодня или до самой поздней даты.
  const { from, to } = useMemo(() => {
    let lo = now, hi = now;
    for (const t of timelines.values()) {
      lo = Math.min(lo, t.start, t.planStart ?? lo);
      hi = Math.max(hi, t.end, t.deadline ?? hi);
    }
    return { from: midnight(lo) - BACK_DAYS * DAY, to: Math.max(midnight(now) + AHEAD_DAYS * DAY, midnight(hi) + 14 * DAY) };
  }, [timelines]);   // eslint-disable-line react-hooks/exhaustive-deps
  const W = Math.max(1, ((to - from) / DAY) * dayW);
  const x = (ms: number) => ((ms - from) / DAY) * dayW;

  // Полосы папок: задачи по дорожкам. Место задачи — от начала плашки (или плана) до конца плашки или плана.
  const sectionsLaid = useMemo(() => {
    let top = HEAD;
    return sections.filter(sec => sec.issues.length).map(sec => {
      const items = sec.issues.map(issue => {
        const t = timelines.get(issue.key);
        const hasBar = !!t && t.end > t.start;
        const a = t ? (hasBar ? t.start : t.planStart ?? t.start) : now;
        const b = t ? Math.max(hasBar ? t.end : a, t.deadline ?? a) : now;
        return { issue, t, hasBar, left: x(a), right: Math.max(x(b), x(a) + MIN_BAR) };
      }).sort((p, q) => p.left - q.left || p.right - q.right);
      const laneEnd: number[] = [];
      const placed = items.map(it => {
        let lane = laneEnd.findIndex(e => e + LANE_GAP < it.left);
        if (lane < 0) lane = laneEnd.length;
        laneEnd[lane] = it.right;
        return { ...it, lane };
      });
      const height = Math.max(MIN_SECTION, laneEnd.length * LANE + PAD * 2);
      const out = { name: sec.name ?? NO_FOLDER, placed, top, height,
                    overdue: placed.filter(p => p.t?.overdueAt != null).length };
      top += height;
      return out;
    });
  }, [sections, timelines, dayW, from]);   // eslint-disable-line react-hooks/exhaustive-deps
  const bodyH = sectionsLaid.reduce((h, s) => h + s.height, 0);

  // Ctrl (Cmd) + колесо — масштаб вокруг курсора.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left - LEFT + el.scrollLeft;
      const want = Math.max(MIN_W, Math.min(MAX_W, +(dayW * (e.deltaY < 0 ? 1.25 : 1 / 1.25)).toFixed(2)));
      onDayW(want);
      requestAnimationFrame(() => { el.scrollLeft = px * (want / dayW) - (e.clientX - r.left - LEFT); });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dayW, onDayW]);

  // Сейчас — в видимой части при открытии и смене масштаба кнопками.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(now) - (el.clientWidth - LEFT) * 0.6);
  }, [zoom, from]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Шкала: крупно — дни сверху и часы снизу; мельче — месяцы сверху и дни / недели / месяцы снизу.
  const ticks = useMemo(() => {
    const top: { left: number; label: string }[] = [];
    const bottom: { left: number; label: string; major?: boolean }[] = [];
    const weekend: number[] = [];
    const hourStep = dayW >= 960 ? 1 : dayW >= 480 ? 2 : dayW >= 240 ? 3 : dayW >= 120 ? 6 : 0;
    for (let d = new Date(from); d.getTime() <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const t = d.getTime(), left = x(t);
      const day = d.getDate(), mon = d.getMonth(), wd = d.getDay();
      if (hourStep) {
        top.push({ left, label: `${String(day).padStart(2, "0")} ${MONTHS[mon]}${wd === 1 ? " · пн" : ""}` });
        for (let h = 0; h < 24; h += hourStep) bottom.push({ left: left + (h / 24) * dayW, label: `${String(h).padStart(2, "0")}:00`, major: h === 0 });
      } else {
        if (day === 1) top.push({ left, label: `${MONTHS[mon]} ${d.getFullYear()}` });
        if (dayW >= 22) bottom.push({ left, label: String(day), major: wd === 1 });
        else if (dayW >= 6 && wd === 1) bottom.push({ left, label: `${String(day).padStart(2, "0")}.${String(mon + 1).padStart(2, "0")}` });
        else if (dayW < 6 && day === 1) bottom.push({ left, label: MONTHS[mon] });
      }
      if (dayW >= 6 && (wd === 0 || wd === 6)) weekend.push(left);
    }
    return { top, bottom, weekend };
  }, [from, to, dayW]);   // eslint-disable-line react-hooks/exhaustive-deps

  const leftAt = new Date(from + (scrollX / dayW) * DAY);
  const pinnedLabel = dayW >= 120 ? `${String(leftAt.getDate()).padStart(2, "0")} ${MONTHS[leftAt.getMonth()]}` : `${MONTHS[leftAt.getMonth()]} ${leftAt.getFullYear()}`;
  const nextTop = ticks.top.find(t => t.left > scrollX);
  const showPinned = !nextTop || nextTop.left - scrollX > 80;

  const tip = (issue: Issue, e: React.MouseEvent) => setHover({ issue, x: e.clientX, y: e.clientY });

  if (!sectionsLaid.length) {
    return <p className="text-sm text-text-muted p-4">В списке нет задач для графика.</p>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-1.5">
      {(loading || error) && (
        <p className={`text-[11px] flex items-center gap-1.5 ${error ? "text-amber-700 dark:text-amber-300" : "text-text-muted"}`}>
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          {error ? `История статусов не загрузилась: ${error}. Плашки — по текущему статусу.` : "Загружаю историю статусов из Jira…"}
        </p>
      )}
      <div ref={box} onScroll={e => setScrollX((e.target as HTMLDivElement).scrollLeft)}
        onMouseDown={e => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("button,a")) return;
          drag.current = { x: e.clientX, left: box.current!.scrollLeft };
        }}
        onMouseMove={e => { if (drag.current && box.current) box.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x); }}
        onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; setHover(null); }}
        className="flex-1 min-h-0 overflow-auto rounded-xl border border-border-main bg-[var(--color-card-bg,transparent)] select-none relative">
        <div className="relative" style={{ width: LEFT + W, height: HEAD + bodyH }}>
          {/* Шкала */}
          <div className="sticky top-0 z-20 flex" style={{ height: HEAD }}>
            <div className="sticky left-0 z-30 flex-shrink-0 border-b border-r border-border-main bg-bg-main px-3 flex items-end pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted"
              style={{ width: LEFT }}>Папки</div>
            <div className="relative flex-shrink-0 border-b border-border-main bg-bg-main" style={{ width: W }}>
              {ticks.top.map(t => (
                <span key={`t${t.left}`} className="absolute top-1 text-[11px] font-semibold text-text-main whitespace-nowrap pl-1 border-l border-border-main"
                  style={{ left: t.left }}>{t.label}</span>
              ))}
              {showPinned && <span className="absolute top-1 text-[11px] font-semibold text-text-main whitespace-nowrap pl-1 bg-bg-main" style={{ left: scrollX }}>{pinnedLabel}</span>}
              {ticks.bottom.map(t => (
                <span key={`b${t.left}`} className={`absolute bottom-1 text-[10px] whitespace-nowrap pl-0.5 ${t.major ? "text-text-main font-medium" : "text-text-muted"}`}
                  style={{ left: t.left }}>{t.label}</span>
              ))}
            </div>
          </div>

          {/* Фон: выходные и «сейчас» */}
          <div className="absolute pointer-events-none" style={{ left: LEFT, top: HEAD, width: W, height: bodyH }}>
            {ticks.weekend.map(l => <div key={l} className="absolute top-0 bottom-0 bg-bg-subtle/60" style={{ left: l, width: dayW }} />)}
            <div className="absolute top-0 bottom-0 w-px bg-primary/70" style={{ left: x(now) }} title="Сейчас" />
          </div>

          {/* Полосы папок: слева — только папка, задачи — плашками */}
          {sectionsLaid.map(sec => (
            <div key={`f:${sec.name}`} className="relative flex border-b border-border-main" style={{ height: sec.height }}>
              <div className="sticky left-0 z-10 flex-shrink-0 flex flex-col justify-center gap-0.5 px-3 bg-bg-main border-r border-border-main"
                style={{ width: LEFT }}>
                <span className="text-sm font-semibold text-text-main leading-snug line-clamp-2" title={sec.name}>{sec.name}</span>
                <span className="text-[11px] text-text-muted">
                  задач: {sec.placed.length}
                  {sec.overdue > 0 && <span className="text-red-600 dark:text-red-400"> · срок нарушен: {sec.overdue}</span>}
                </span>
              </div>
              <div className="relative flex-shrink-0" style={{ width: W }}>
                {sec.placed.map(p => (
                  <TaskBar key={p.issue.key} issue={p.issue} t={p.t} hasBar={p.hasBar} top={PAD + p.lane * LANE} x={x} viewLeft={scrollX}
                    onTip={tip} onLeave={() => setHover(null)} onChrono={() => { setHover(null); setChrono(p.issue); }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Legend />

      {hover && <HoverCard issue={hover.issue} at={hover} t={timelines.get(hover.issue.key)} info={stageOf(hover.issue)} />}
      {chrono && (
        <ChronoModal issue={chrono} t={timelines.get(chrono.key)} info={stageOf(chrono)} team={teamOf(chrono)} onClose={() => setChrono(null)}
          onOpenIssue={() => { const i = chrono; setChrono(null); onOpenIssue(i); }}
          onStage={st => onStageManual(chrono.key, st)} onPlanSaved={() => onPlanSaved(chrono.key)} />
      )}
    </div>
  );
}

/**
 * Задача в полосе папки: план пунктиром, плашка по отрезкам статуса, отметка срока. Подпись — внутри плашки: значок типа
 * всегда, ключ и название — сколько поместится (шире плашка или крупнее масштаб — видно целиком).
 */
function TaskBar({ issue, t, hasBar, top, x, viewLeft, onTip, onLeave, onChrono }: {
  issue: Issue; t: TaskTimeline | undefined; hasBar: boolean; top: number; x: (ms: number) => number;
  /** Левый край видимой части графика, px: подпись длинной плашки держится у него, а не уезжает за экран. */
  viewLeft: number;
  onTip: (i: Issue, e: React.MouseEvent) => void; onLeave: () => void; onChrono: () => void;
}) {
  const type = String(issue.fields.issuetype ?? "");
  const summary = String(issue.fields.summary ?? "");
  const now = Date.now();
  const a = t ? (hasBar ? t.start : t.planStart ?? t.start) : now;
  const b = t ? (hasBar ? t.end : t.deadline ?? a) : now;
  const left = x(a), width = Math.max(MIN_BAR, x(b) - left);
  const barTop = top + (LANE - BAR_H) / 2;
  const shift = Math.max(0, Math.min(viewLeft - left, width - MIN_BAR));
  return (
    <>
      {t && t.planStart != null && t.deadline != null && (
        <div className="absolute rounded-md border border-dashed border-text-muted/60 pointer-events-none"
          style={{ left: x(t.planStart), width: Math.max(2, x(t.deadline) - x(t.planStart)), top: barTop - 3, height: BAR_H + 6 }} />
      )}
      <button type="button" onClick={onChrono} onMouseMove={e => onTip(issue, e)} onMouseLeave={onLeave}
        aria-label={`${issue.key} ${summary}: хронология, статус и даты`}
        className="absolute rounded-md overflow-hidden focus-visible:ring-2 focus-visible:ring-primary/50 hover:ring-2 hover:ring-primary/40"
        style={{ left, width, top: barTop, height: BAR_H }}>
        <span className="absolute inset-0 flex">
          {hasBar && t ? t.segments.map((sg, i) => (
            <span key={i} className="h-full flex-shrink-0" style={{ width: Math.max(0, x(sg.to) - x(sg.from)), backgroundColor: colorOf(sg.stage) }} />
          )) : <span className="h-full w-full bg-text-muted/25" />}
        </span>
        <span style={{ paddingLeft: shift + 3 }} className={`relative flex h-full items-center gap-1 pr-[3px] min-w-0 text-[11px] leading-none whitespace-nowrap
          ${hasBar ? "text-white [text-shadow:0_0_3px_rgb(0_0_0/.55)]" : "text-text-main"}`}>
          <IssueTypeIcon type={type} />
          <span className="font-mono text-[10px] opacity-90 flex-shrink-0">{issue.key}</span>
          <span className="truncate min-w-0">{summary || "без названия"}</span>
        </span>
      </button>
      {t?.overdueAt != null && (
        <span className="absolute w-0.5 bg-red-600 pointer-events-none" style={{ left: x(t.overdueAt) - 1, top: barTop - 5, height: BAR_H + 10 }}>
          <span className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-red-600" />
        </span>
      )}
    </>
  );
}

/** Последняя смена статуса (st): время последнего события хронологии, кроме «срок нарушен». */
const lastChangeOf = (t: TaskTimeline | undefined) => {
  const e = (t?.chrono ?? []).filter(c => c.kind !== "overdue");
  return e.length ? e[e.length - 1].at : null;
};

/** Наведение: название, текущий статус (st) и когда он последний раз менялся. */
function HoverCard({ issue, at, t, info }: { issue: Issue; at: { x: number; y: number }; t: TaskTimeline | undefined; info: StageInfo }) {
  const W = 300;
  const left = Math.min(at.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1600) - W - 8);
  const top = Math.min(at.y + 16, (typeof window !== "undefined" ? window.innerHeight : 900) - 140);
  const manual = (info.kind === "stage" || info.kind === "epic") && info.manual;
  const last = lastChangeOf(t);
  return (
    <div role="tooltip" className="fixed z-50 rounded-xl border border-border-main bg-[var(--color-modal-bg)] shadow-xl p-3 text-xs space-y-1.5 pointer-events-none"
      style={{ left, top, width: W }}>
      <div className="flex items-center gap-2">
        <IssueTypeIcon type={String(issue.fields.issuetype ?? "")} />
        <span className="font-mono text-text-muted">{issue.key}</span>
      </div>
      <p className="text-sm font-medium text-text-main leading-snug">{String(issue.fields.summary ?? "")}</p>
      <div className="flex items-center gap-1.5">
        <StageBadge info={info} />{manual && <Hand className="w-3 h-3 text-text-muted" aria-label="вручную" />}
        <span className="text-text-muted">{last != null ? `с ${fmtDateTime(last)}` : ""}</span>
      </div>
      {t?.overdueAt != null && <p className="text-red-600 font-medium">Срок нарушен {fmtDate(t.overdueAt)}</p>}
    </div>
  );
}

/**
 * Окно задачи на графике: смена статуса (st) — в любую сторону, плановые даты (те же поля Jira, что в окне задачи
 * и «Трекинге AQA»), команда и хронология. Описание — по ссылке «Описание».
 */
function ChronoModal({ issue, t, info, team, onClose, onOpenIssue, onStage, onPlanSaved }: {
  issue: Issue; t: TaskTimeline | undefined; info: StageInfo; team: TeamMember[]; onClose: () => void; onOpenIssue: () => void;
  onStage: (st: Stage | null) => void; onPlanSaved: () => void;
}) {
  const entries: ChronoEntry[] = t?.chrono ?? [];
  const base = info.kind === "blocked" ? info.base : info;
  const current = base.kind === "stage" || base.kind === "epic" ? base.stage : null;
  const manualActive = (base.kind === "stage" || base.kind === "epic") && !!base.manual;
  const last = lastChangeOf(t);
  return (
    <Modal open onClose={onClose} title={`${issue.key} · ${String(issue.fields.summary ?? "")}`} size="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          <IssueTypeIcon type={String(issue.fields.issuetype ?? "")} />
          <span>{String(issue.fields.issuetype ?? "")}</span>
          <span>Статус Jira: <b className="font-medium text-text-main">{String(issue.fields.status ?? "—")}</b></span>
          {last != null && <span>Статус (st) обновлён: {fmtDateTime(last)}</span>}
          <span className="ml-auto flex items-center gap-3">
            <button type="button" onClick={onOpenIssue} className="text-primary hover:underline">Описание</button>
            {issue.url && <a href={issue.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Открыть в Jira ↗</a>}
          </span>
        </div>

        <section className="space-y-1.5 pb-3 border-b border-border-main">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Статус (st)</p>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Статус (st)">
            {STAGES.map(st => (
              <button key={st} type="button" role="radio" aria-checked={st === current} disabled={st === current} onClick={() => onStage(st)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-opacity ${st === current ? "ring-2 ring-offset-1 ring-primary/60" : "opacity-60 hover:opacity-100"}`}
                style={stageStyle(st)}>{STAGE_LABEL[st]}</button>
            ))}
            {info.kind === "blocked" && <StageBadge info={info} />}
            {manualActive && (
              <button type="button" onClick={() => onStage(null)} className="ml-1 text-xs text-text-muted hover:text-text-main underline">
                Сбросить — как в Jira</button>
            )}
          </div>
          <p className="text-[11px] text-text-muted">
            По Jira: «{stageText(jiraStageOf(info))}». Можно в любую сторону — ручной держится, пока статус по Jira не сменится.
          </p>
        </section>

        {!issue.local && <PlanDates issueKey={issue.key} onSaved={onPlanSaved} />}

        {team.length > 0 && (
          <section className="flex flex-wrap gap-x-4 gap-y-1 text-xs pb-3 border-b border-border-main">
            <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-text-muted">Команда</span>
            {team.map(m => (
              <span key={`${m.dir}:${m.name}`} className="inline-flex items-center gap-1.5">
                <span className="text-text-muted">{m.dir}</span><span className="text-text-main">{m.name}</span>
                {m.role && <span className="px-1 rounded text-[10px] font-semibold text-white" style={{ backgroundColor: m.color || "#64748b" }}>{m.role}</span>}
              </span>
            ))}
          </section>
        )}

        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Хронология</p>
        {entries.length ? (
          <ol className="max-h-[40vh] overflow-y-auto divide-y divide-border-main border border-border-main rounded-xl">
            {entries.map((e, i) => (
              <li key={i} className={`flex items-start gap-3 px-3 py-2 text-sm ${e.kind === "overdue" ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                <span className="w-32 flex-shrink-0 font-mono text-xs text-text-muted pt-0.5">{fmtDateTime(e.at)}</span>
                <span className="min-w-0 flex-1">
                  {e.kind === "overdue" ? (
                    <span className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300"><AlertTriangle className="w-4 h-4" /> {e.text}</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ backgroundColor: colorOf(e.stage), color: textColorOf(e.stage) }}>
                        {stageValLabel(e.stage)}</span>
                      <span className="text-text-main">{e.text}</span>
                      {e.kind === "manual" && <Hand className="w-3.5 h-3.5 text-text-muted" aria-label="вручную" />}
                    </span>
                  )}
                  {e.author && <span className="block text-[11px] text-text-muted">{e.author}</span>}
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-text-muted">Истории нет: задача ещё не загружена из Jira.</p>}
        <p className="text-[11px] text-text-muted">
          Смены статуса — из истории Jira (changelog), ручные — из Shark. Статус (st) по Jira переводится по таблице «Статус (st)»;
          у эпика — по самой отстающей стори. Срок нарушен — к концу дня планового окончания не «Готово к релизу» и дальше.
        </p>
      </div>
    </Modal>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="w-5 h-2.5 rounded-sm border border-dashed border-text-muted/70" /> плановые даты</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-0.5 h-3 bg-red-600" /> срок нарушен</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-px h-3 bg-primary" /> сейчас</span>
      <span>Цвет — статус (st) с момента смены · щелчок по задаче — статус, даты и хронология · Ctrl/Cmd + колесо — масштаб · перетаскивание — прокрутка</span>
    </p>
  );
}
