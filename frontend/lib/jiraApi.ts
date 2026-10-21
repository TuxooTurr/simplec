/**
 * API-клиент интеграции с Jira (регистрация дефектов).
 */

import { authHeaders } from "./authApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(authHeaders())) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      // detail бывает строкой или объектом {message} (ошибки LLM) — иначе в тексте было бы «[object Object]».
      const d = (JSON.parse(text) as { detail?: string | { message?: string } }).detail;
      msg = typeof d === "string" ? d : d?.message ?? text;
    } catch { /* keep */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface JiraSettings {
  base_url: string;
  token: string;        // маска, если задан
  token_path: string;
  ssl_verify: boolean;
  labels: string[];
  issuetype: string;
}

export interface JiraProjectMeta {
  priorities: string[];
  components: string[];
  issuetype: string;
  fields: Record<string, { name: string; allowed: string[] }>;
  labels_presets: string[];
  warnings: string[];
  mobile_components: string[];
  stand_types: string[];
  default_stand_type: string;
}

export interface JiraEpic { key: string; summary: string; status?: string }

export function getJiraSettings(): Promise<JiraSettings> {
  return fetchJson("/api/jira/settings");
}

/** Добавить лейблы в общий список пресетов — навсегда (убрать можно в настройках Jira). Возвращает весь список. */
export function addLabelPresets(labels: string[]): Promise<{ labels: string[] }> {
  return fetchJson("/api/jira/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labels }),
  });
}

/** Лейбл как его примет Jira: пробелы внутри — «_» (так он уходит в задачу и хранится в пресетах). */
export const labelName = (l: string) => l.trim().replace(/ /g, "_");

export function saveJiraSettings(body: JiraSettings): Promise<JiraSettings> {
  return fetchJson("/api/jira/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function jiraTokenFromLogin(login: string, password: string, baseUrl?: string): Promise<{ status: string }> {
  return fetchJson("/api/jira/token-from-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password, base_url: baseUrl ?? "" }),
  });
}

export function testJira(): Promise<{ status: string; user: string; name: string }> {
  return fetchJson("/api/jira/test");
}

export function getJiraMeta(project: string): Promise<JiraProjectMeta> {
  return fetchJson(`/api/jira/meta?project=${encodeURIComponent(project)}`);
}

export function loadJiraEpics(project: string): Promise<{ epics: JiraEpic[] }> {
  return fetchJson(`/api/jira/epics?project=${encodeURIComponent(project)}`);
}

export interface CreateJiraDefect {
  project: string;
  summary: string;
  description: string;
  priority: string;
  labels: string[];
  epic_key: string;
  components: string[];
  assignee: string;
  ke: string;
  environment: string;
  stand_type: string;
  /** Тип задачи; пусто — из настроек (Дефект). Для «Задачи» поля дефекта не уходят. */
  issuetype?: string;
  /** Связать созданную задачу с этой (дефект к стори — для «Дефекты (st)»). */
  link_key?: string;
}

export function createJiraDefect(body: CreateJiraDefect): Promise<{ status: string; key: string; url: string; warnings: string[] }> {
  return fetchJson("/api/jira/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Прикладывает файлы к созданному дефекту.
 *
 *  Имена передаются отдельно и намеренно: описание ссылается на скриншоты
 *  разметкой !имя!, которую подставил бэкенд при форматировании. Если приложить
 *  файл под исходным именем, Jira не свяжет его с разметкой. */
export function attachJiraFiles(
  key: string, files: File[], names: string[],
): Promise<{ attached: string[]; warnings: string[] }> {
  const body = new FormData();
  files.forEach((f, i) => {
    body.append("files", f);
    body.append("names", names[i] ?? f.name);
  });
  return fetchJson(`/api/jira/attach/${encodeURIComponent(key)}`, { method: "POST", body });
}

/* ── Jira-аналитика: представления (выборка + группировка + колонки) ──────── */

export interface JiraField { id: string; name: string; custom: boolean; type: string }

export interface JiraView {
  id?: string;
  name: string;
  description?: string;
  jql: string;
  columns: string[];
  group_by: string[];
  created_at?: string;
  updated_at?: string;
}

export interface JiraViewRow { key: string; url: string; values: Record<string, string> }

export interface JiraViewGroup {
  field: string;
  value: string;
  count: number;
  groups?: JiraViewGroup[];
  issues?: JiraViewRow[];
}

export interface JiraViewResult {
  total: number;
  loaded: number;
  truncated: boolean;
  columns: { id: string; name: string }[];
  group_by: { id: string; name: string }[];
  fetched_at: number;
  groups?: JiraViewGroup[];
  issues?: JiraViewRow[];
}

export function getJiraFields(): Promise<{ fields: JiraField[] }> {
  return fetchJson("/api/jira/fields");
}

export function listJiraViews(): Promise<{ views: JiraView[] }> {
  return fetchJson("/api/jira/views");
}

export function saveJiraView(view: JiraView): Promise<JiraView> {
  return fetchJson("/api/jira/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(view),
  });
}

export function deleteJiraView(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/jira/views/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Выполняет представление. Передаём его содержимое, а не id: так можно
 *  посмотреть результат несохранённых правок. refresh — мимо кэша бэкенда. */
export function runJiraView(
  view: Pick<JiraView, "jql" | "columns" | "group_by">, refresh = false,
): Promise<JiraViewResult> {
  return fetchJson("/api/jira/views/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...view, refresh }),
  });
}
