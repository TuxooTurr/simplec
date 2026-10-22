/**
 * Новая модель для Zephyr — черновик раскладки до «Применить».
 *
 * Из XML (выгрузка Zephyr или генерация SimpleTest) все папки становятся НОВЫМИ — даже если в дереве уже есть
 * папка с тем же именем: человек сам решает, переложить кейсы в старые папки или поставить новую папку внутрь
 * папки дерева. «Применить» создаёт в Zephyr только папки, в которых остались кейсы, и сами кейсы.
 *
 * Черновик хранится в localStorage по проекту — раскладка не теряется при перезагрузке.
 */

import { fetchJson } from "./jiraApi";

export type Parent = { kind: "root" } | { kind: "existing"; path: string } | { kind: "new"; id: string };

export interface StagedFolder { id: string; name: string; parent: Parent }

export interface StagedStep { description: string; testData: string; expectedResult: string }

export interface StagedCase {
  id: string;
  name: string;
  objective: string;
  precondition: string;
  priority: string;
  status: string;
  labels: string[];
  /** Связи с задачами Jira (из XML выгрузки). */
  issueLinks?: string[];
  /** Длительность, мс. */
  estimatedTime?: number | null;
  customFields: Record<string, unknown>;
  steps: StagedStep[];
  /** Куда ляжет кейс: папка дерева или новая папка. */
  target: Exclude<Parent, { kind: "root" }>;
  /** Ошибка последнего «Применить» — кейс остаётся в черновике. */
  error?: string;
}

export interface Staging { source: string; createdAt: string; folders: StagedFolder[]; cases: StagedCase[] }

interface ParsedCase extends Omit<StagedCase, "target" | "error"> { folder: string }

const KEY = (project: string) => `st_zephyr_staging:${project}`;

export function loadStaging(project: string): Staging | null {
  try { const s = localStorage.getItem(KEY(project)); return s ? (JSON.parse(s) as Staging) : null; } catch { return null; }
}

export function saveStaging(project: string, s: Staging | null): void {
  try { if (s && s.cases.length + s.folders.length) localStorage.setItem(KEY(project), JSON.stringify(s)); else localStorage.removeItem(KEY(project)); }
  catch { /* переполнено — черновик живёт до перезагрузки */ }
}

let seq = 0;
const nid = () => `nf${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Разбор XML на бэкенде → черновик: каждая папка пути — новая, кейс — в своей новой папке. */
export async function stagingFromXml(xml: string, source: string): Promise<Staging> {
  const r = await fetchJson<{ folders: string[]; cases: ParsedCase[] }>("/api/zephyr/parse-xml", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml }),
  });
  const byPath = new Map<string, string>();
  const folders: StagedFolder[] = [];
  const ensure = (path: string): string | null => {
    const parts = path.split("/").filter(Boolean);
    let parent: Parent = { kind: "root" };
    let acc = "";
    let id: string | null = null;
    for (const p of parts) {
      acc += "/" + p;
      id = byPath.get(acc) ?? null;
      if (!id) { id = nid(); byPath.set(acc, id); folders.push({ id, name: p, parent }); }
      parent = { kind: "new", id };
    }
    return id;
  };
  r.folders.forEach(ensure);
  const fallback = () => ensure("/Новая модель")!;
  const cases: StagedCase[] = r.cases.map(({ folder, ...c }) => ({ ...c, target: { kind: "new", id: (folder && ensure(folder)) || fallback() } }));
  return { source, createdAt: new Date().toISOString(), folders, cases };
}

/** Полный путь новой папки в дереве Zephyr. */
export function folderPath(s: Staging, id: string, guard = 0): string {
  const f = s.folders.find(x => x.id === id);
  if (!f || guard > 50) return "";
  const base = f.parent.kind === "root" ? "" : f.parent.kind === "existing" ? f.parent.path : folderPath(s, f.parent.id, guard + 1);
  return `${base}/${f.name}`;
}

export const targetPath = (s: Staging, c: StagedCase) => (c.target.kind === "existing" ? c.target.path : folderPath(s, c.target.id));

/** Новая папка — внутри другой новой (чтобы не положить папку в саму себя). */
export function isInside(s: Staging, id: string, ancestor: string): boolean {
  let cur = s.folders.find(f => f.id === id);
  for (let g = 0; cur && g < 50; g++) {
    if (cur.parent.kind !== "new") return false;
    if (cur.parent.id === ancestor) return true;
    const pid: string = cur.parent.id;
    cur = s.folders.find(f => f.id === pid);
  }
  return false;
}

/** Новые папки, в которых (с вложенными) есть кейсы — только их создаём при «Применить». */
export function usedFolders(s: Staging): Set<string> {
  const used = new Set<string>();
  for (const c of s.cases) {
    let id: string | null = c.target.kind === "new" ? c.target.id : null;
    for (let g = 0; id && g < 50; g++) {
      used.add(id);
      const f: StagedFolder | undefined = s.folders.find(x => x.id === id);
      id = f && f.parent.kind === "new" ? f.parent.id : null;
    }
  }
  return used;
}

export interface ApplyResult {
  createdFolders: string[];
  folderErrors: Record<string, string>;
  results: { id: string; name: string; key?: string; error?: string; warning?: string }[];
  created: number;
  failed: number;
}

/** Кейсов в одном запросе «Применить»: большая модель уходит пачками — с прогрессом и без потерь при обрыве. */
export const APPLY_CHUNK = 50;

const caseBody = (s: Staging, c: StagedCase) => ({
  id: c.id, name: c.name, folder: targetPath(s, c), objective: c.objective, precondition: c.precondition,
  priority: c.priority, status: c.status, labels: c.labels, issueLinks: c.issueLinks ?? [], estimatedTime: c.estimatedTime ?? null,
  customFields: c.customFields, steps: c.steps,
});

const sendApply = (body: unknown) => fetchJson<ApplyResult>("/api/zephyr/apply", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

/**
 * «Применить» пачками. Сначала — все папки одним запросом (родители раньше детей), потом кейсы по APPLY_CHUNK без
 * повторного создания папок. После каждой пачки onChunk — раздел сразу убирает созданное из черновика: оборвалось
 * посередине (сеть, перезапуск) — повтор не создаст кейсы второй раз. Кейс в несозданной папке не отправляется.
 */
export async function applyStaging(project: string, s: Staging, onChunk: (r: ApplyResult, done: number, total: number) => void,
                                   cancelled: () => boolean = () => false): Promise<ApplyResult> {
  const used = usedFolders(s);
  const folders = s.folders.filter(f => used.has(f.id)).map(f => folderPath(s, f.id));
  const total: ApplyResult = { createdFolders: [], folderErrors: {}, results: [], created: 0, failed: 0 };
  const head = await sendApply({ project, folders, cases: [] });
  total.createdFolders = head.createdFolders; total.folderErrors = head.folderErrors;
  const badFolder = (path: string) => Object.keys(head.folderErrors).find(f => path === f || path.startsWith(f + "/"));
  const rows = s.cases.map(c => caseBody(s, c));
  const blocked = rows.filter(c => badFolder(c.folder));
  if (blocked.length) {
    const r: ApplyResult = { createdFolders: [], folderErrors: {}, created: 0, failed: blocked.length,
      results: blocked.map(c => ({ id: c.id, name: c.name, error: `папка ${badFolder(c.folder)} не создалась: ${head.folderErrors[badFolder(c.folder)!]}` })) };
    total.results.push(...r.results); total.failed += r.failed;
    onChunk(r, 0, rows.length);
  }
  const todo = rows.filter(c => !badFolder(c.folder));
  for (let i = 0; i < todo.length && !cancelled(); i += APPLY_CHUNK) {
    const r = await sendApply({ project, skipFolders: true, cases: todo.slice(i, i + APPLY_CHUNK) });
    total.results.push(...r.results); total.created += r.created; total.failed += r.failed;
    onChunk(r, blocked.length + Math.min(i + APPLY_CHUNK, todo.length), rows.length);
  }
  return total;
}

/** Убрать из черновика новую папку со всеми вложенными новыми папками и их кейсами. */
export function dropStagedFolder(s: Staging, id: string): Staging {
  const gone = new Set(s.folders.filter(f => f.id === id || isInside(s, f.id, id)).map(f => f.id));
  return {
    ...s, folders: s.folders.filter(f => !gone.has(f.id)),
    cases: s.cases.filter(c => !(c.target.kind === "new" && gone.has(c.target.id))),
  };
}

/** Сколько кейсов и вложенных папок уйдёт вместе с новой папкой черновика. */
export function stagedFolderSize(s: Staging, id: string): { cases: number; folders: number } {
  const gone = new Set(s.folders.filter(f => f.id === id || isInside(s, f.id, id)).map(f => f.id));
  return { cases: s.cases.filter(c => c.target.kind === "new" && gone.has(c.target.id)).length, folders: gone.size - 1 };
}

/** Передача XML из генерации SimpleTest в Zephyr Tool (между разделами — через sessionStorage). */
export const HANDOFF_KEY = "st_zephyr_import";

export function handoffXml(xml: string, source: string): void {
  try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ xml, source })); } catch { /* слишком большой — откроют файлом */ }
}

export function takeHandoff(): { xml: string; source: string } | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}
