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

export function applyStaging(project: string, s: Staging): Promise<ApplyResult> {
  const used = usedFolders(s);
  return fetchJson<ApplyResult>("/api/zephyr/apply", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project,
      folders: s.folders.filter(f => used.has(f.id)).map(f => folderPath(s, f.id)),
      cases: s.cases.map(c => ({
        id: c.id, name: c.name, folder: targetPath(s, c), objective: c.objective, precondition: c.precondition,
        priority: c.priority, status: c.status, labels: c.labels, customFields: c.customFields, steps: c.steps,
      })),
    }),
  });
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
