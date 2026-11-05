/**
 * Генерация по задачам Jira tool: задача → требования из «Данных» → тесты в модели → прогон.
 *
 * Здесь чистая логика: источник генерации по задаче, путь в тестовой модели по дереву «Данных» и раскладка кейсов
 * для предпросмотра. Модель SBER911 устроена как дерево «Данных»: Блок → Раздел → Фича, внутри — папка типа сценария.
 */

import type { Parent, StagedCase, StagedFolder, Staging } from "./zephyrStaging";

/** Требование задачи: документ «Данных» и его папки от корня. */
export interface TaskDoc { id: string; name: string; feature: string; text: string; dataPath: string[] }

/** Задача, выбранная перед генерацией. */
export interface TaskPick {
  key: string;
  summary: string;
  type: string;
  project: string;
  description: string;
  docs: TaskDoc[];
  /** Папки «Данных» первого требования — по ним строится папка в модели. */
  dataPath: string[];
}

/** Выбранная задача в форме: предзаполнено из задачи и требований, можно поправить. */
export interface TaskDraft extends TaskPick { feature: string; text: string }

/** Задача в очереди генерации. */
export interface TaskJob {
  key: string;
  summary: string;
  project: string;
  feature: string;
  requirement: string;
  reqNames: string[];
  dataPath: string[];
  status: "wait" | "run" | "done" | "error";
  sessionId?: string;
  caseCount?: number;
  error?: string;
}

/** Выгрузка одной задачи: файлы её кейсов. */
export interface TaskFile { job: TaskJob; xml: string; csv: string; md: string }

/** Папки «Данных» от корня до папки folderId; неизвестная или цикл — что удалось пройти. */
export function dataFolderPath(folders: { id: string; name: string; parent_id: string }[], folderId: string | undefined): string[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(folderId ?? ""); cur && !seen.has(cur.id); cur = byId.get(cur.parent_id)) {
    seen.add(cur.id);
    out.unshift(cur.name);
  }
  return out;
}

/** Название фичи для имён кейсов: из документа, иначе последняя папка «Данных», иначе тема задачи. */
export const featureOf = (t: Pick<TaskPick, "summary" | "docs" | "dataPath">): string =>
  (t.docs.find(d => d.feature.trim())?.feature ?? t.dataPath[t.dataPath.length - 1] ?? t.summary).trim();

/** Источник генерации: задача (что именно делаем) и её требования целиком. Пусто — генерировать не из чего. */
export function taskSource(t: Pick<TaskPick, "key" | "summary" | "description" | "docs">): string {
  const docs = t.docs.filter(d => d.text.trim());
  const description = t.description.trim();
  if (!docs.length && !description) return "";
  const parts = [`Задача ${t.key}: ${t.summary}`.trim()];
  if (description) parts.push(`Описание задачи:\n${description}`);
  for (const d of docs) parts.push(`=== Требование: ${d.name} ===\n${d.text.trim()}`);
  return parts.join("\n\n");
}

/** Папка типа сценария в модели; незнакомый тип — позитивные. */
const SCENARIO: Record<string, string> = {
  positive: "Позитивные сценарии", negative: "Негативные сценарии", boundary: "Граничные сценарии",
  integration: "E2E", e2e: "E2E", security: "Негативные сценарии",
};
export const scenarioFolder = (type: string | undefined) => SCENARIO[(type ?? "").trim().toLowerCase()] ?? SCENARIO.positive;

/** Путь в дереве Zephyr: лишние слэши и пробелы убираются, начинается с «/». */
export function cleanPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").map(x => x.trim()).filter(Boolean);
  return parts.length ? `/${parts.join("/")}` : "";
}

export const modelFolder = (root: string, dataPath: string[]) => cleanPath([root, ...dataPath].join("/"));

/** Кейс предпросмотра: разобранный из XML, тип сценария — из генерации. */
export type ModelCase = Omit<StagedCase, "target" | "error"> & {
  /** Папка из XML (генерация без задачи) — кейс ложится в неё как есть. */
  folder: string;
  caseType?: string;
  on: boolean;
};

/** Группа кейсов одной задачи (или одна группа без задачи). */
export interface ModelGroup {
  id: string;
  task?: { key: string; summary: string };
  reqNames: string[];
  /** Папка фичи в модели; у группы без задачи не используется. */
  folder: string;
  run: boolean;
  cases: ModelCase[];
}

/** Итоговая папка кейса. */
export const casePath = (g: ModelGroup, c: ModelCase) => (g.task ? cleanPath(`${g.folder}/${scenarioFolder(c.caseType)}`) : cleanPath(c.folder));

/** Задача и требования — в цель кейса: из кейса видно, откуда он. */
export function linkedObjective(g: ModelGroup, objective: string): string {
  if (!g.task) return objective;
  const lines = [`Задача: ${g.task.key}`, ...(g.reqNames.length ? [`Требования: ${g.reqNames.join("; ")}`] : [])];
  return [objective, ...lines].filter(Boolean).join("<br/>");
}

/** Что отправить: отмеченные и ещё не созданные кейсы — черновик Zephyr Tool, папки по путям. */
export function stagingOf(groups: ModelGroup[], sent: Record<string, string>): Staging {
  const byPath = new Map<string, string>();
  const folders: StagedFolder[] = [];
  const ensure = (path: string): string => {
    let parent: Parent = { kind: "root" };
    let acc = "";
    let id = "";
    for (const name of path.split("/").filter(Boolean)) {
      acc += `/${name}`;
      id = byPath.get(acc) ?? "";
      if (!id) { id = `m${folders.length}`; byPath.set(acc, id); folders.push({ id, name, parent }); }
      parent = { kind: "new", id };
    }
    return id;
  };
  const cases: StagedCase[] = [];
  for (const g of groups) for (const c of g.cases) {
    if (!c.on || sent[c.id]) continue;
    const { folder: _f, caseType: _t, on: _o, ...rest } = c;
    cases.push({
      ...rest, objective: linkedObjective(g, c.objective), issueLinks: g.task ? [g.task.key] : c.issueLinks ?? [],
      target: { kind: "new", id: ensure(casePath(g, c)) },
    });
  }
  return { source: "Генерация по задачам", createdAt: new Date().toISOString(), folders, cases };
}

/** Узел дерева предпросмотра. */
export interface ModelNode {
  name: string;
  path: string;
  isNew: boolean;
  count: number;
  children: ModelNode[];
  cases: { group: ModelGroup; c: ModelCase }[];
}

/** Дерево раскладки; existing — папки модели, null — сверить не удалось (тогда новых не помечаем). */
export function modelTree(groups: ModelGroup[], existing: Set<string> | null): ModelNode[] {
  const root: ModelNode = { name: "", path: "", isNew: false, count: 0, children: [], cases: [] };
  for (const group of groups) for (const c of group.cases) {
    let node = root;
    const n = c.on ? 1 : 0;                      // снятый кейс остаётся в дереве — галочку можно вернуть
    for (const name of casePath(group, c).split("/").filter(Boolean)) {
      const path = `${node.path}/${name}`;
      let next = node.children.find(n => n.name === name);
      if (!next) {
        next = { name, path, isNew: !!existing && !existing.has(path), count: 0, children: [], cases: [] };
        node.children.push(next);
      }
      next.count += n;
      node = next;
    }
    node.cases.push({ group, c });
  }
  return root.children;
}

/** Новых папок в раскладке: папка только со снятыми кейсами создана не будет. */
export const newFolders = (nodes: ModelNode[]): number => nodes.reduce((n, x) => n + (x.isNew && x.count > 0 ? 1 : 0) + newFolders(x.children), 0);
