/**
 * API-хелперы для страницы настроек приложения.
 * LLM API ключи + Kafka для алертов + Kafka для метрик.
 */

import { authHeaders } from "./authApi";

const BASE = "/api/settings";

function af(url: string, init?: RequestInit): Promise<Response> {
  const ah = authHeaders();
  const h = new Headers(init?.headers);
  for (const [k, v] of Object.entries(ah)) if (!h.has(k)) h.set(k, v);
  return fetch(url, { ...init, headers: h });
}

export interface SettingEntry {
  value:       string;
  description: string;
  group:       string;
  updatedAt:   string | null;
}

export type SettingsMap = Record<string, SettingEntry>;

export interface CustomLlmProvider {
  id?: string;
  name: string;
  base_url: string;
  model: string;
  auth_type: "api_key" | "certificate";
  api_key?: string;
  ca_cert_path?: string;
  client_cert_path?: string;
  client_key_path?: string;
}

export interface RevisorMethodConfig {
  enabled: boolean;
  path: string;
  label?: string;
}

export interface RevisorMethodDef {
  key: string;
  label: string;
}

export interface RevisorStandConfig {
  id?: string;
  name: string;
  base_url: string;
  auth_type: "none" | "bearer" | "api_key";
  token?: string;
  api_key_header?: string;
  namespace?: string;
  enabled?: boolean;
  methods: Record<string, RevisorMethodConfig>;
}

export async function getSettings(): Promise<SettingsMap> {
  const r = await af(BASE);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveSettings(data: Record<string, string>): Promise<void> {
  const r = await af(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: data }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { detail?: string }).detail ?? "Ошибка сохранения настроек");
  }
}

export async function getCustomLlmProviders(): Promise<CustomLlmProvider[]> {
  const r = await af(`${BASE}/llm-providers`);
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return (d as { providers: CustomLlmProvider[] }).providers;
}

export async function saveCustomLlmProvider(provider: CustomLlmProvider): Promise<CustomLlmProvider> {
  const r = await af(`${BASE}/llm-providers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(provider),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { detail?: string; error?: string }).detail ?? (d as { error?: string }).error ?? "Ошибка сохранения LLM");
  }
  const d = await r.json();
  return (d as { provider: CustomLlmProvider }).provider;
}

export async function deleteCustomLlmProvider(id: string): Promise<void> {
  const r = await af(`${BASE}/llm-providers/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export async function getRevisorStands(): Promise<{ methods: RevisorMethodDef[]; stands: RevisorStandConfig[] }> {
  const r = await af(`${BASE}/revisor-stands`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveRevisorStand(stand: RevisorStandConfig): Promise<RevisorStandConfig> {
  const r = await af(`${BASE}/revisor-stands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stand),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { detail?: string; error?: string }).detail ?? (d as { error?: string }).error ?? "Ошибка сохранения стенда");
  }
  const d = await r.json();
  return (d as { stand: RevisorStandConfig }).stand;
}

export async function deleteRevisorStand(id: string): Promise<void> {
  const r = await af(`${BASE}/revisor-stands/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

// ─── Connection tests ─────────────────────────────────────────────────────

export interface TestResult {
  status: "green" | "yellow" | "red";
  message: string;
}

export async function testLlmConnection(providerId: string): Promise<TestResult> {
  const r = await af(`${BASE}/test/llm/${encodeURIComponent(providerId)}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testKafkaAlerts(): Promise<TestResult> {
  const r = await af(`${BASE}/test/kafka-alerts`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testKafkaMetrics(): Promise<TestResult> {
  const r = await af(`${BASE}/test/kafka-metrics`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testChromaDb(): Promise<TestResult> {
  const r = await af(`${BASE}/test/chromadb`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testPostgres(): Promise<TestResult> {
  const r = await af(`${BASE}/test/postgres`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testRevisorStand(standId: string): Promise<TestResult> {
  const r = await af(`${BASE}/test/revisor/${encodeURIComponent(standId)}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Logs VPS ────────────────────────────────────────────────────────────────

export interface LogsVpsConnection {
  id?:             string;
  name:            string;
  vps_type:        "graylog" | "elastic" | "loki" | "generic";
  base_url:        string;
  auth_type:       "none" | "bearer" | "basic" | "api_key";
  token:           string;
  username:        string;
  password:        string;
  api_key_header:  string;
  ssl_verify:      boolean;
  ca_cert_path:    string;
  default_index:   string;
  enabled:         boolean;
}

export async function getLogsVpsConnections(): Promise<{ connections: LogsVpsConnection[] }> {
  const r = await af(`${BASE}/logs-vps`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveLogsVpsConnection(data: Partial<LogsVpsConnection> & { name: string; base_url: string }): Promise<{ ok: boolean; connection: LogsVpsConnection }> {
  const r = await af(`${BASE}/logs-vps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteLogsVpsConnection(connId: string): Promise<{ ok: boolean }> {
  const r = await af(`${BASE}/logs-vps/${encodeURIComponent(connId)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testLogsVpsConnection(connId: string): Promise<TestResult> {
  const r = await af(`${BASE}/test/logs-vps/${encodeURIComponent(connId)}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Ферма устройств ───────────────────────────────────────────────────────────

export async function testFarm(): Promise<TestResult> {
  const r = await af(`${BASE}/test/farm`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
