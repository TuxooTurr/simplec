/**
 * График Jira tool: хронология статуса (st) задачи по времени.
 *
 * - Статус по Jira в каждый момент — из changelog задачи (смены статуса с точностью до минут), переведённый в этап
 *   по таблице сопоставления (stageForStatus). Эпик — минимальный этап его сторей в каждый момент, как в списке.
 * - Ручные смены статуса (st) — из журнала Shark (ToolState.stageLog): ручной держится, пока этап по Jira тот же,
 *   что был при установке; Jira сдвинулась — ручной снят. Правило то же, что в makeStageResolver.
 * - Плашка — от планового начала (нет или раньше создания — от создания; работа началась раньше плана — от первой
 *   смены статуса) до
 *   момента, когда задача стала «Готово к релизу» и дальше (или «Исключено»), а не стала — до сейчас.
 * - Срок нарушен: к концу дня планового окончания задача не «Готово к релизу» / «Готово» (и не «Исключено») — красная
 *   отметка в этот момент и запись «Срок нарушен» в хронологии; дальше плашка красится по статусам как обычно.
 */

import { categoryOf, type Issue } from "./jiraModel";
import {
  STAGES, STAGE_LABEL, stageForStatus, stageKeyOf, stageRankOf, type ManualMark, type StageMapping,
} from "./jiraStages";
import type { IssueHistory } from "./jiraToolApi";

/** Значение на отрезке: этап, «unmapped:<статус>», «no-stories» (как stageKeyOf). */
export type StageVal = string;

export interface Segment { from: number; to: number; stage: StageVal }

export type ChronoKind = "created" | "jira" | "manual" | "reset" | "dropped" | "overdue";
export interface ChronoEntry {
  at: number;
  kind: ChronoKind;
  /** Что случилось: «Jira: В работе → Тестирование», «Вручную», «Срок нарушен». */
  text: string;
  /** Статус (st) после события (у «Срок нарушен» — какой был в этот момент). */
  stage: StageVal;
  author?: string;
}

export interface TaskTimeline {
  key: string;
  /** Начало и конец плашки, мс. end ≤ start — фактической плашки нет (план в будущем). */
  start: number;
  end: number;
  planStart: number | null;
  /** Конец дня планового окончания, мс. */
  deadline: number | null;
  segments: Segment[];
  /** Момент нарушения срока (= deadline) или null. */
  overdueAt: number | null;
  chrono: ChronoEntry[];
  /** Сейчас «Готово к релизу» и дальше или «Исключено». */
  final: boolean;
}

/** Точка смены значения: с момента at действует stage. */
type Point = { at: number; stage: StageVal; chrono?: ChronoEntry[] };

const parseAt = (s: string): number => {
  // Jira: 2026-11-11T11:15:00.000+0300 — Date понимает смещение только с двоеточием.
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(t) ? t : NaN;
};
/** «ГГГГ-ММ-ДД» → начало (или конец) этого дня по местному времени. */
const dayAt = (iso: string, endOfDay = false): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  return endOfDay ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59).getTime() : new Date(+m[1], +m[2] - 1, +m[3]).getTime();
};

export const isFinalStage = (v: StageVal) =>
  v === "excluded" || (STAGES.includes(v) && stageRankOf(v) >= stageRankOf("release"));

export function stageValLabel(v: StageVal): string {
  if (STAGE_LABEL[v]) return STAGE_LABEL[v];
  if (v.startsWith("unmapped:")) return `Не сопоставлен (${v.slice(9) || "без статуса"})`;
  return v === "no-stories" ? "Нет сторей" : v;
}

const two = (n: number) => String(n).padStart(2, "0");
/** 11.11.2026 11:15 */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Значение по Jira во времени для задачи (не эпика): начальный статус и смены из changelog. */
function jiraPoints(issue: Issue, h: IssueHistory | undefined, mapping: StageMapping): Point[] {
  const created = parseAt(h?.created ?? String(issue.fields.created ?? ""));
  const changes = (h?.history ?? []).map(c => ({ ...c, t: parseAt(c.at) })).filter(c => Number.isFinite(c.t));
  const first = changes.length ? changes[0].from : (h?.status ?? String(issue.fields.status ?? ""));
  const val = (status: string) => stageKeyOf(stageForStatus(issue, status, mapping));
  const t0 = Number.isFinite(created) ? created : changes.length ? changes[0].t : Date.now();
  const pts: Point[] = [{
    at: t0, stage: val(first),
    chrono: [{ at: t0, kind: "created", text: `Создана · статус «${first || "—"}»`, stage: val(first) }],
  }];
  for (const c of changes) {
    const v = val(c.to);
    pts.push({ at: c.t, stage: v, chrono: [{ at: c.t, kind: "jira", text: `Jira: ${c.from || "—"} → ${c.to}`, stage: v, author: c.author }] });
  }
  return pts;
}

/** Значение в момент t по точкам (до первой точки — undefined). */
function valueAt(pts: Point[], t: number): StageVal | undefined {
  let v: StageVal | undefined;
  for (const p of pts) { if (p.at <= t) v = p.stage; else break; }
  return v;
}

/** Эпик: в каждый момент — минимальный этап сторей, созданных к этому моменту (отменённые не считаются). */
function epicPoints(stories: Point[][], created: number): Point[] {
  const times = Array.from(new Set([created, ...stories.flatMap(s => s.map(p => p.at))])).filter(t => t >= created).sort((a, b) => a - b);
  const out: Point[] = [];
  for (const t of times) {
    const vals = stories.map(s => valueAt(s, t)).filter((v): v is StageVal => v !== undefined && v !== "excluded");
    let v: StageVal;
    if (!vals.length) v = "no-stories";
    else {
      const ranks = vals.map(x => (STAGES.includes(x) ? Math.max(0, stageRankOf(x)) : 0));
      v = STAGES[Math.min(...ranks)];
    }
    if (!out.length || out[out.length - 1].stage !== v) out.push({ at: t, stage: v });
  }
  if (out.length) {
    out[0].chrono = [{ at: out[0].at, kind: "created", text: "Создан · статус (st) по сторям", stage: out[0].stage }];
    for (const p of out.slice(1)) p.chrono = [{ at: p.at, kind: "jira", text: "По сторям эпика", stage: p.stage }];
  }
  return out;
}

/**
 * Ручные отметки поверх расчёта: ручной держится, пока расчёт тот же, что при установке (mark.base).
 * Возвращает итоговые точки с записями хронологии.
 */
function withMarks(base: Point[], marks: ManualMark[]): Point[] {
  type Ev = { at: number; base?: Point; mark?: ManualMark };
  const evs: Ev[] = [
    ...base.map((p): Ev => ({ at: p.at, base: p })),
    ...marks.map((m): Ev => ({ at: Date.parse(m.at), mark: m })).filter(e => Number.isFinite(e.at)),
  ].sort((a, b) => a.at - b.at || (a.base ? -1 : 1));
  let cur: StageVal | undefined;
  let manual: { stage: StageVal; base: string } | null = null;
  const out: Point[] = [];
  const push = (at: number, chrono: ChronoEntry[]) => {
    const v = manual?.stage ?? cur ?? "no-stories";
    const last = out[out.length - 1];
    if (last && last.at === at) { last.stage = v; last.chrono = [...(last.chrono ?? []), ...chrono]; return; }
    out.push({ at, stage: v, chrono });
  };
  for (const e of evs) {
    if (e.base) {
      cur = e.base.stage;
      const extra: ChronoEntry[] = [];
      if (manual && manual.base !== cur) {
        extra.push({ at: e.at, kind: "dropped", text: `Ручной «${stageValLabel(manual.stage)}» снят — Jira сменила статус`, stage: cur });
        manual = null;
      }
      push(e.at, [...(e.base.chrono ?? []).map(c => ({ ...c, stage: manual?.stage ?? cur! })), ...extra]);
    } else if (e.mark) {
      const m = e.mark;
      if (m.stage) {
        manual = { stage: m.stage, base: m.base || cur || "" };
        push(e.at, [{ at: e.at, kind: "manual", text: "Вручную в Shark", stage: m.stage }]);
      } else {
        manual = null;
        push(e.at, [{ at: e.at, kind: "reset", text: "Ручной статус сброшен — как в Jira", stage: cur ?? "no-stories" }]);
      }
    }
  }
  return out;
}

export interface TimelineInput {
  issue: Issue;
  history: Record<string, IssueHistory>;
  mapping: StageMapping;
  log: Record<string, ManualMark[]>;
  /** Стори эпика (для эпика). */
  stories: Issue[];
  now?: number;
}

/** Хронология и плашка задачи. Без истории (не загружена, черновик) — по текущему статусу с момента создания. */
export function taskTimeline({ issue, history, mapping, log, stories, now = Date.now() }: TimelineInput): TaskTimeline {
  const h = history[issue.key];
  let base: Point[];
  const createdAt = parseAt(h?.created ?? String(issue.fields.created ?? ""));
  if (categoryOf(issue) === "epic") {
    const sp = stories.map(s => withMarks(jiraPoints(s, history[s.key], mapping), log[s.key] ?? []));
    base = epicPoints(sp, Number.isFinite(createdAt) ? createdAt : Math.min(now, ...sp.map(p => p[0]?.at ?? now)));
    if (!base.length) base = [{ at: Number.isFinite(createdAt) ? createdAt : now, stage: "no-stories" }];
  } else {
    base = jiraPoints(issue, h, mapping);
  }
  const pts = withMarks(base, log[issue.key] ?? []);

  const planStart = dayAt(h?.planStart ?? "");
  const deadline = dayAt(h?.planEnd ?? "", true);
  const created = pts[0]?.at ?? now;
  const firstChange = pts.length > 1 ? pts[1].at : null;
  // До создания задачи работы не было: плановое начало раньше создания — плашка с создания.
  let start = Math.max(planStart ?? created, created);
  if (firstChange !== null && firstChange < start) start = firstChange;

  const current = pts[pts.length - 1]?.stage ?? "no-stories";
  const final = isFinalStage(current);
  let end = now;
  if (final) {
    // Момент, с которого задача непрерывно «финальная».
    let i = pts.length - 1;
    while (i > 0 && isFinalStage(pts[i - 1].stage)) i--;
    end = pts[i].at;
  }

  const segments: Segment[] = [];
  for (let i = 0; i < pts.length; i++) {
    const from = Math.max(pts[i].at, start);
    const to = Math.min(i + 1 < pts.length ? pts[i + 1].at : end, end);
    if (to > from) segments.push({ from, to, stage: pts[i].stage });
  }

  const chrono: ChronoEntry[] = pts.flatMap(p => p.chrono ?? []);
  let overdueAt: number | null = null;
  if (deadline !== null && deadline <= now) {
    const at = valueAt(pts, deadline) ?? pts[0]?.stage ?? "no-stories";
    if (!isFinalStage(at)) {
      overdueAt = deadline;
      chrono.push({ at: deadline, kind: "overdue", text: `Срок нарушен — к плановому окончанию ${fmtDate(deadline)} не «${STAGE_LABEL.release}»`, stage: at });
    }
  }
  chrono.sort((a, b) => a.at - b.at || (a.kind === "overdue" ? 1 : b.kind === "overdue" ? -1 : 0));
  return { key: issue.key, start, end, planStart, deadline, segments, overdueAt, chrono, final };
}
