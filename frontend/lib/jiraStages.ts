/**
 * Этап SimpleTest — общий статус поверх сотен статусов Jira.
 *
 * - Стори, дефекты и прочие задачи: этап по таблице сопоставления «статус Jira → этап»,
 *   у каждой группы своя таблица, у каждого проекта — свой набор таблиц.
 * - Эпик: этап считается по всем сторям, привязанным к нему через Epic Link, —
 *   берётся этап самой отстающей стори. Отменённые стори не учитываются.
 *   Эпик без сторей остаётся без этапа и подсвечивается красным: это нарушение процесса.
 * - Заблокирован: у задачи есть блокирующий дефект, который ещё не закрыт. Дефект считается,
 *   если он связан с задачей, с эпиком стори (стори привязана к эпику) или — для эпика — с любой
 *   его сторей. Статус держится, пока дефект не перейдёт в «Закрыт».
 * - Пока таблица группы не сохранена, этап угадывается по названию статуса (guessStage).
 *   В сохранённой таблице статус, которого в ней нет, — «не сопоставлен», а не тихо
 *   «Разработка»: иначе новый статус незаметно испортит расчёт эпиков.
 */

import type React from "react";
import { categoryOf, epicLinkId, isBlocker, isClosedDefect, projectKeyOfIssue, type Category, type Issue } from "./jiraModel";

/**
 * Этап (st): встроенные dev / test / release / done / excluded и свои, добавленные человеком
 * (id вида «custom-…»). Свои встают в порядок продвижения после выбранного этапа.
 */
export type Stage = string;
export type BuiltinStage = "dev" | "test" | "release" | "done" | "excluded";
export const BUILTIN_PROGRESS: BuiltinStage[] = ["dev", "test", "release", "done"];

/** Свой статус (st): название, цвет и после какого этапа он стоит в продвижении («start» — первым). */
export interface CustomStage { id: string; label: string; color: string; after: string }

/** Порядок продвижения со своими статусами: каждый свой — сразу после своего «after», по порядку добавления. */
export function stageOrder(custom: CustomStage[]): Stage[] {
  const out: Stage[] = [];
  const place = (anchor: string) => custom.filter(c => c.after === anchor).forEach(c => { out.push(c.id); place(c.id); });
  place("start");
  for (const b of BUILTIN_PROGRESS) { out.push(b); place(b); }
  // «after» указывает на удалённый статус — такие в конец продвижения, чтобы не потерялись.
  custom.filter(c => !out.includes(c.id)).forEach(c => out.push(c.id));
  return out;
}

/** Действующий порядок: этапы продвижения (со своими) и «Исключено» последним. Меняется на месте. */
export const STAGES: Stage[] = [...BUILTIN_PROGRESS, "excluded"];

/** Статус (st) с оформлением: этапы + «Заблокирован». */
export type StageKey = Stage | "blocked";
export const STAGE_KEYS: StageKey[] = [...STAGES, "blocked"];

/** Названия и цвета по умолчанию. Человек меняет их в «Статус (st)» — см. applyStageStyles. */
export const DEFAULT_STAGE_STYLE: Record<string, { label: string; color: string }> = {
  dev:      { label: "Разработка",      color: "#0284c7" },
  test:     { label: "Тестирование",    color: "#7c3aed" },
  release:  { label: "Готово к релизу", color: "#0d9488" },
  done:     { label: "Готово",          color: "#16a34a" },
  excluded: { label: "Исключено",       color: "#94a3b8" },
  blocked:  { label: "Заблокирован",    color: "#7f1d1d" },
};

/** Свои названия и цвета встроенных статусов (st); пусто — по умолчанию. Хранятся в ToolState. */
export type StageStyles = Partial<Record<StageKey, { label?: string; color?: string }>>;

/**
 * Действующие названия и цвета. Меняются на месте (applyStageStyles): на них ссылаются расчёт
 * этапов, сортировка и группировка — так новое название сразу везде.
 */
export const STAGE_LABEL: Record<StageKey, string> = Object.fromEntries(
  STAGE_KEYS.map(k => [k, DEFAULT_STAGE_STYLE[k].label])) as Record<StageKey, string>;
const STAGE_COLOR: Record<StageKey, string> = Object.fromEntries(
  STAGE_KEYS.map(k => [k, DEFAULT_STAGE_STYLE[k].color])) as Record<StageKey, string>;

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function applyStageStyles(styles: StageStyles, custom: CustomStage[] = []): void {
  for (const k of Object.keys(DEFAULT_STAGE_STYLE)) {
    STAGE_LABEL[k] = styles[k]?.label?.trim() || DEFAULT_STAGE_STYLE[k].label;
    const c = styles[k]?.color ?? "";
    STAGE_COLOR[k] = HEX_RE.test(c) ? c : DEFAULT_STAGE_STYLE[k].color;
  }
  for (const c of custom) {
    STAGE_LABEL[c.id] = c.label.trim() || "Без названия";
    STAGE_COLOR[c.id] = HEX_RE.test(c.color) ? c.color : "#64748b";
  }
  STAGES.splice(0, STAGES.length, ...stageOrder(custom), "excluded");
  STAGE_KEYS.splice(0, STAGE_KEYS.length, ...STAGES, "blocked");
}

/** Место в продвижении (0 — самый ранний); «Исключено» и неизвестные — -1. */
export function stageRankOf(stage: Stage): number {
  return stage === "excluded" ? -1 : STAGES.indexOf(stage);
}

/** Цвет текста на заливке: белый на тёмном, почти чёрный на светлом (по яркости цвета). */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111827" : "#ffffff";
}

/** Оформление метки статуса (st): заливка цветом статуса, «Исключено» — зачёркнуто. */
export function stageStyle(k: StageKey, color = STAGE_COLOR[k] ?? "#64748b"): React.CSSProperties {
  return { backgroundColor: color, color: textOn(color), textDecoration: k === "excluded" ? "line-through" : undefined };
}

/** Сопоставление: проект → группа → статус Jira → этап. */
export type StageMapping = Record<string, Partial<Record<Exclude<Category, "epic">, Record<string, Stage>>>>;

/** Черновик сопоставления по названию статуса — дальше человек правит руками. */
export function guessStage(status: string): Stage {
  const s = status.toLowerCase().trim();
  if (/отклон|отмен|reject|cancel|дубл/.test(s)) return "excluded";
  if (/^(выполнен[аоы]?|закрыт[оа]?|внедрено|done|closed|resolved)$/.test(s) || /подтвержден|fix confirmed|verified/.test(s)) return "done";
  if (/пси|psi|внедрени|в релиз|релиз.?кандидат|release candidate|пром|prom/.test(s)) return "release";
  if (/тест|test|qa|\bift\b|ифт|\bst\b|e2e|протестир/.test(s)) return "test";
  return "dev";
}

/** Черновик таблицы для статусов группы (статусы — из workflow проекта в Jira). */
export function defaultMapping(statuses: string[]): Record<string, Stage> {
  return Object.fromEntries(statuses.map(s => [s, guessStage(s)]));
}

export type StageInfo =
  | { kind: "blocked"; by: Issue[]; base: StageInfo }
  | { kind: "stage"; stage: Stage }
  | { kind: "unmapped"; status: string }
  | { kind: "no-stories" }
  | { kind: "epic"; stage: Stage; total: number; behind: number; unmapped: number };

/** Задача на этапе «Готово к релизу» или дальше (готово, исключено); у заблокированной — по этапу без блокировки. */
export function isReleaseOrLater(info: StageInfo): boolean {
  const base = info.kind === "blocked" ? info.base : info;
  if (base.kind !== "stage" && base.kind !== "epic") return false;
  return base.stage === "excluded" || stageRankOf(base.stage) >= stageRankOf("release");
}

export function stageText(info: StageInfo): string {
  switch (info.kind) {
    case "blocked": return STAGE_LABEL.blocked;
    case "stage": case "epic": return STAGE_LABEL[info.stage];
    case "unmapped": return "Не сопоставлен";
    case "no-stories": return "Нет сторей";
  }
}

/** Стори по эпикам (через Epic Link) — из всех загруженных задач, не только из списка. */
export function storiesByEpic(allIssues: Issue[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  const epicField = epicLinkId();
  for (const i of allIssues) {
    const epic = i.fields[epicField];
    if (categoryOf(i) === "story" && typeof epic === "string" && epic) {
      if (!out.has(epic)) out.set(epic, []);
      out.get(epic)!.push(i);
    }
  }
  return out;
}

/** Блокирующие незакрытые дефекты из списка дефектов. */
const activeBlockers = (defects: Issue[] | undefined) => (defects ?? []).filter(d => isBlocker(d) && !isClosedDefect(d));

/**
 * Блокирующие дефекты задачи с учётом связей: свои; у стори — ещё дефекты её эпика;
 * у эпика — ещё дефекты всех его сторей. defects — индекс «ключ → дефекты» (defectIndex).
 */
export function blockingDefects(issue: Issue, defects: Map<string, Issue[]>, stories: Map<string, Issue[]>): Issue[] {
  const cat = categoryOf(issue);
  if (cat === "defect") return [];
  const keys = [issue.key];
  if (cat === "story") {
    const epic = issue.fields[epicLinkId()];
    if (typeof epic === "string" && epic) keys.push(epic);
  }
  if (cat === "epic") keys.push(...(stories.get(issue.key) ?? []).map(s => s.key));
  const seen = new Set<string>();
  return keys.flatMap(k => activeBlockers(defects.get(k))).filter(d => !seen.has(d.key) && !!seen.add(d.key));
}

/**
 * Считает этапы задач. Стори — все загруженные (не только из списка):
 * этап эпика не должен зависеть от того, какие стори человек добавил в список.
 */
export function makeStageResolver(allIssues: Issue[], mapping: StageMapping, defects: Map<string, Issue[]> = new Map()) {
  const byEpic = storiesByEpic(allIssues);

  const mapped = (issue: Issue): StageInfo => {
    const cat = categoryOf(issue) as Exclude<Category, "epic">;
    const status = String(issue.fields.status ?? "");
    const table = mapping[projectKeyOfIssue(issue.key)]?.[cat];
    if (!status) return { kind: "unmapped", status };
    const st = table ? table[status] : guessStage(status);
    return st ? { kind: "stage", stage: st } : { kind: "unmapped", status };
  };

  const cache = new Map<string, StageInfo>();
  return (issue: Issue): StageInfo => {
    const hit = cache.get(issue.key);
    if (hit) return hit;
    let info: StageInfo;
    if (categoryOf(issue) !== "epic") {
      info = mapped(issue);
    } else {
      const stories = (byEpic.get(issue.key) ?? []).map(mapped)
        .filter(s => !(s.kind === "stage" && s.stage === "excluded"));
      if (!stories.length) {
        info = { kind: "no-stories" };
      } else {
        // Несопоставленная стори считается отстающей: так эпик не «проскочит» вперёд.
        // Эпик получает минимальный этап своих сторей по порядку продвижения (свои статусы — тоже).
        const ranks = stories.map(s => (s.kind === "stage" ? Math.max(0, stageRankOf(s.stage)) : 0));
        const min = Math.min(...ranks);
        const stage = STAGES[min];
        info = { kind: "epic", stage, total: stories.length, behind: ranks.filter(r => r === min).length,
                 unmapped: stories.filter(s => s.kind === "unmapped").length };
      }
    }
    const by = blockingDefects(issue, defects, byEpic);
    if (by.length) info = { kind: "blocked", by, base: info };
    cache.set(issue.key, info);
    return info;
  };
}
