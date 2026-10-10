/**
 * API веб-коннекторов и анализатора логов (backend/api/webconnect.py).
 */

import { authHeaders } from "./authApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Ошибка API: need_login — сессия ресурса истекла, нужно войти заново. */
export class WebApiError extends Error {
  needLogin: boolean;
  constructor(message: string, needLogin = false) {
    super(message);
    this.needLogin = needLogin;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(authHeaders())) if (!headers.has(k)) headers.set(k, v);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let message = text, needLogin = false;
    try {
      const detail = (JSON.parse(text) as { detail?: unknown }).detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object") {
        const d = detail as { message?: string; need_login?: boolean };
        message = d.message ?? text;
        needLogin = !!d.need_login;
      }
    } catch { /* текст как есть */ }
    throw new WebApiError(message, needLogin);
  }
  return res.json() as Promise<T>;
}

export interface LoginRecipe {
  user_selector: string;
  password_selector: string;
  submit: { type: "click" | "press"; selector: string; key?: string } | null;
  login_url: string;
}

export interface Connector {
  id: string;
  name: string;
  base_url: string;
  notes?: string;
  auth?: { mode: "manual" | "password"; login?: string; has_password?: boolean; recipe?: LoginRecipe };
  window?: { open: boolean; mode: string };
}

/** Для сохранения: пароль только записывается, пустой — оставить сохранённый. */
export interface ConnectorInput {
  id?: string;
  name: string;
  base_url: string;
  notes?: string;
  auth_mode: "manual" | "password";
  login?: string;
  password?: string;
}

export interface ParamDef { name: string; label: string; default: string }
export type OpOutput = "logs" | "data" | "text";

export interface RequestTemplate {
  kind: "request" | "k8s_logs" | "steps";
  start_url?: string;
  steps?: RecStep[];
  method?: string;
  url?: string;
  body?: string | null;
  headers?: Record<string, string>;
  namespace?: string;
  container?: string;
  pod_example?: string;
  found: Record<string, string[]>;
}

export interface Scenario {
  id: string;
  connector_id: string;
  name: string;
  kind: "request" | "k8s_logs" | "steps";
  output?: OpOutput;
  params?: ParamDef[];
  window?: boolean;
  log_source?: boolean;
  namespace?: string;
  container?: string;
  request?: { method: string; url: string; body?: string | null; headers?: Record<string, string> };
  start_url?: string;
  steps?: RecStep[];
  recorded_steps?: RecStep[];
  extract_selector?: string;
}

export interface RecStep {
  type: "goto" | "click" | "fill" | "press";
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  secret?: boolean;
  key?: string;
  t?: number;
}

export interface RecResponse {
  id: number;
  kind: "response" | "download";
  method: string;
  url: string;
  status: number;
  content_type: string;
  size: number;
  likeness: number;
  filename?: string;
  preview?: string;
  t?: number;
}

export interface WindowState {
  mode: string;
  open: boolean;
  seconds: number;
  steps: RecStep[];
  responses: RecResponse[];
}

export interface ErrorGroupView {
  fingerprint: string;
  message: string;
  exception: string;
  level: string;
  count: number;
  first_ts: string | null;
  last_ts: string | null;
  pods: string[];
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  sample_stack: string[];
}

export interface RunResult {
  output?: OpOutput;
  service: string;
  values?: Record<string, string>;
  minutes: number;
  source: string;
  seconds: number;
  relogged?: boolean;
  scenario: { id: string; name: string; connector: string };
  // output = logs
  lines: number;
  events: number;
  errors: number;
  groups: ErrorGroupView[];
  sample: string[];
  // output = data
  data?: unknown;
  content_type?: string;
  size?: number;
  // output = text
  text?: string;
  url?: string;
  screenshot?: string;
}

export const listWeb = () => call<{ connectors: Connector[]; scenarios: Scenario[] }>("/api/webconnect");

export const saveConnector = (c: ConnectorInput) =>
  call<Connector>("/api/webconnect/connectors", { method: "POST", body: JSON.stringify(c) });

export const deleteConnector = (id: string) =>
  call<{ status: string }>(`/api/webconnect/connectors/${id}`, { method: "DELETE" });

export const openWindow = (id: string, mode: "login" | "record") =>
  call<WindowState>(`/api/webconnect/connectors/${id}/window`, { method: "POST", body: JSON.stringify({ mode }) });

export const windowState = (id: string) => call<WindowState>(`/api/webconnect/connectors/${id}/window`);

export const closeWindow = (id: string) =>
  call<{ saved: boolean; login_detected?: boolean; login_end?: number; steps?: RecStep[]; responses?: RecResponse[] }>(
    `/api/webconnect/connectors/${id}/window/close`, { method: "POST" });

export const lastRecording = (id: string) =>
  call<{ started_at: string; login_end: number; steps: RecStep[]; responses: RecResponse[] }>(
    `/api/webconnect/connectors/${id}/recording`);

export interface DraftParam { name: string; label: string; value: string }

export const makeDraft = (id: string, req: { mode: "request" | "steps"; response_id?: number | null;
                                             params: DraftParam[]; start_index?: number }) =>
  call<{ template: RequestTemplate; note: string; warnings: string[]; steps: RecStep[]; start_index?: number }>(
    `/api/webconnect/connectors/${id}/draft`, { method: "POST", body: JSON.stringify(req) });

export const saveScenario = (s: { id?: string; connector_id: string; name: string; template: RequestTemplate;
                                  params?: ParamDef[]; output?: OpOutput; extract_selector?: string;
                                  steps: RecStep[]; log_source: boolean }) =>
  call<Scenario>("/api/webconnect/scenarios", { method: "POST", body: JSON.stringify(s) });

export const deleteScenario = (id: string) =>
  call<{ status: string }>(`/api/webconnect/scenarios/${id}`, { method: "DELETE" });

export const runScenario = (id: string, values: Record<string, string>, minutes: number) =>
  call<RunResult>(`/api/webconnect/scenarios/${id}/run`, { method: "POST", body: JSON.stringify({ values, minutes }) });

export const analyzerState = () =>
  call<{ services: { name: string; note: string }[];
         source: { id: string; name: string; kind: string; connector: string } | null }>("/api/log-analyzer");

export const saveService = (name: string, note = "") =>
  call<{ services: { name: string; note: string }[] }>("/api/log-analyzer/services",
    { method: "POST", body: JSON.stringify({ name, note }) });

export const deleteService = (name: string) =>
  call<{ services: { name: string; note: string }[] }>(`/api/log-analyzer/services/${encodeURIComponent(name)}`,
    { method: "DELETE" });

export const analyzeLogs = (service: string, minutes: number) =>
  call<RunResult>("/api/log-analyzer/run", { method: "POST", body: JSON.stringify({ service, minutes }) });
