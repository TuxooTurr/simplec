/**
 * API-клиент Jira tool: задачи, переходы и структуры из настоящей Jira
 * (бэкенд backend/api/jira_tool.py, подключение — Настройки → Jira).
 */

import { fetchJson } from "./jiraApi";
import type { Issue, JiraCatalog, StructNode, StructureInfo } from "./jiraModel";

const post = <T,>(path: string, body: unknown) => fetchJson<T>(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function getCatalog(refresh = false): Promise<JiraCatalog> {
  return fetchJson(`/api/jira/tool/catalog${refresh ? "?refresh=true" : ""}`);
}

export function getProjects(): Promise<{ projects: { key: string; name: string }[] }> {
  return fetchJson("/api/jira/tool/projects");
}

export function getProjectFields(project: string): Promise<{ project: string; fields: string[] }> {
  return fetchJson(`/api/jira/tool/project-fields?project=${encodeURIComponent(project)}`);
}

/** Сервер берёт до 1000 ключей за раз — длинные списки режем на пачки. */
export async function issuesByKeys(keys: string[]): Promise<{ issues: Issue[]; missing: string[] }> {
  const issues: Issue[] = [];
  const missing: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const r = await post<{ issues: Issue[]; missing: string[] }>("/api/jira/tool/issues", { keys: keys.slice(i, i + 1000) });
    issues.push(...r.issues);
    missing.push(...r.missing);
  }
  return { issues, missing };
}

export function searchIssues(jql: string, limit = 200): Promise<{ issues: Issue[]; total: number; truncated: boolean }> {
  return post("/api/jira/tool/search", { jql, limit });
}

export function relatedIssues(epics: string[], linked: string[]): Promise<{ issues: Issue[]; truncated: boolean }> {
  return post("/api/jira/tool/related", { epics, linked });
}

export function getProjectStatuses(project: string): Promise<{ project: string; types: Record<string, string[]> }> {
  return fetchJson(`/api/jira/tool/statuses?project=${encodeURIComponent(project)}`);
}

export interface Transition {
  id: string; name: string; to: string; resolution_required: boolean;
  /** Решения, которые Jira разрешает на этом переходе (id + название). */
  resolutions?: { id: string; name: string }[];
}

/** Сервер берёт до 200 задач за раз (эпик со всеми сторями бывает больше) — режем на пачки. */
export async function getTransitions(keys: string[]): Promise<{ issues: Record<string, { transitions?: Transition[]; error?: string }> }> {
  const issues: Record<string, { transitions?: Transition[]; error?: string }> = {};
  for (let i = 0; i < keys.length; i += 200) {
    Object.assign(issues, (await post<{ issues: typeof issues }>("/api/jira/tool/transitions", { keys: keys.slice(i, i + 200) })).issues);
  }
  return { issues };
}

export async function applyTransitions(changes: { key: string; transition_id: string; resolution?: string }[]):
  Promise<{ results: { key: string; ok: boolean; error?: string }[]; done: number }> {
  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < changes.length; i += 200) {
    results.push(...(await post<{ results: typeof results }>("/api/jira/tool/transition", { changes: changes.slice(i, i + 200) })).results);
  }
  return { results, done: results.filter(r => r.ok).length };
}

export function getStructures(): Promise<{ structures: StructureInfo[] }> {
  return fetchJson("/api/jira/tool/structures");
}

export function getStructureTree(id: number): Promise<{ id: number; root: StructNode[] }> {
  return fetchJson(`/api/jira/tool/structures/${id}`);
}

/** Чек-лист фичи по требованиям (LLM): критически важные базовые проверки. */
export function taskChecklist(body: { key: string; summary: string; requirement_ids: string[]; provider: string }):
  Promise<{ key: string; checks: string[] }> {
  return fetchJson("/api/tasks/checklist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface ReleaseData {
  /** Релиз — версия Jira: задачи привязаны к ней полем «Исправить в версиях» (fixVersion). */
  release: { id: string; name: string; released: boolean; release_date: string; project: string; url: string };
  issues: Issue[];
  /** Эпики, к которым привязаны задачи релиза (через Epic Link), если их самих нет в релизе. */
  epics: Issue[];
  epic_link: string;
  /** В релизе больше 1000 задач — отдана только часть. */
  truncated: boolean;
}

/** Состав релиза: ссылка на версию (…/projects/SBER911/versions/2568004), её id или название (тогда нужен проект). */
export function getRelease(version: string, project = ""): Promise<ReleaseData> {
  return fetchJson(`/api/jira/tool/release?version=${encodeURIComponent(version)}&project=${encodeURIComponent(project)}`);
}
