/**
 * API-клиент интеграции с Jira (регистрация дефектов).
 */

import { authHeaders } from "./authApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(authHeaders())) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* keep */ }
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
  ke_by_component: Record<string, string>;
  mobile_components: string[];
}

export interface JiraEpic { key: string; summary: string; status?: string }

export function getJiraSettings(): Promise<JiraSettings> {
  return fetchJson("/api/jira/settings");
}

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
  stand: string;
}

export function createJiraDefect(body: CreateJiraDefect): Promise<{ status: string; key: string; url: string; warnings: string[] }> {
  return fetchJson("/api/jira/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
