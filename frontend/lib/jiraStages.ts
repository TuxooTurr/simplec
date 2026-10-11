/**
 * Этап SimpleTest — общий статус поверх сотен статусов Jira.
 *
 * - Стори, дефекты и прочие задачи: этап по таблице сопоставления «статус Jira → этап»,
 *   у каждой группы своя таблица, у каждого проекта — свой набор таблиц.
 * - Эпик: этап считается по всем сторям, привязанным к нему через Epic Link, —
 *   берётся этап самой отстающей стори. Отменённые стори не учитываются.
 *   Эпик без сторей остаётся без этапа и подсвечивается красным: это нарушение процесса.
 * - Пока таблица группы не сохранена, этап угадывается по названию статуса (guessStage).
 *   В сохранённой таблице статус, которого в ней нет, — «не сопоставлен», а не тихо
 *   «Разработка»: иначе новый статус незаметно испортит расчёт эпиков.
 */

import { categoryOf, epicLinkId, projectKeyOfIssue, type Category, type Issue } from "./jiraModel";

export type Stage = "dev" | "test" | "release" | "done" | "excluded";

export const STAGES: Stage[] = ["dev", "test", "release", "done", "excluded"];

export const STAGE_LABEL: Record<Stage, string> = {
  dev: "Разработка",
  test: "Тестирование",
  release: "Готово к релизу",
  done: "Готово",
  excluded: "Исключено",
};

/** Порядок продвижения: эпик получает минимальный этап из своих сторей. */
const RANK: Record<Exclude<Stage, "excluded">, number> = { dev: 0, test: 1, release: 2, done: 3 };

export const STAGE_CLS: Record<Stage, string> = {
  dev: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  test: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  release: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  done: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  excluded: "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-500 line-through",
};

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
  | { kind: "stage"; stage: Stage }
  | { kind: "unmapped"; status: string }
  | { kind: "no-stories" }
  | { kind: "epic"; stage: Stage; total: number; behind: number; unmapped: number };

export function stageText(info: StageInfo): string {
  switch (info.kind) {
    case "stage": case "epic": return STAGE_LABEL[info.stage];
    case "unmapped": return "Не сопоставлен";
    case "no-stories": return "Нет сторей";
  }
}

/**
 * Считает этапы задач. stories — все стори всех проектов (не только из списка):
 * этап эпика не должен зависеть от того, какие стори человек добавил в список.
 */
export function makeStageResolver(allIssues: Issue[], mapping: StageMapping) {
  const storiesByEpic = new Map<string, Issue[]>();
  const epicField = epicLinkId();
  for (const i of allIssues) {
    const epic = i.fields[epicField];
    if (categoryOf(i) === "story" && typeof epic === "string" && epic) {
      if (!storiesByEpic.has(epic)) storiesByEpic.set(epic, []);
      storiesByEpic.get(epic)!.push(i);
    }
  }

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
      const stories = (storiesByEpic.get(issue.key) ?? []).map(mapped)
        .filter(s => !(s.kind === "stage" && s.stage === "excluded"));
      if (!stories.length) {
        info = { kind: "no-stories" };
      } else {
        // Несопоставленная стори считается отстающей: так эпик не «проскочит» вперёд.
        const ranks = stories.map(s => (s.kind === "stage" ? RANK[s.stage as Exclude<Stage, "excluded">] : 0));
        const min = Math.min(...ranks);
        const stage = (Object.keys(RANK) as (keyof typeof RANK)[]).find(k => RANK[k] === min)!;
        info = { kind: "epic", stage, total: stories.length, behind: ranks.filter(r => r === min).length,
                 unmapped: stories.filter(s => s.kind === "unmapped").length };
      }
    }
    cache.set(issue.key, info);
    return info;
  };
}
