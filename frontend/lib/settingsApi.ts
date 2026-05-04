/**
 * API-хелперы для страницы настроек приложения.
 * LLM API ключи + Kafka для алертов + Kafka для метрик.
 */

const BASE = "/api/settings";

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
  const r = await fetch(BASE);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveSettings(data: Record<string, string>): Promise<void> {
  const r = await fetch(BASE, {
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
  const r = await fetch(`${BASE}/llm-providers`);
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return (d as { providers: CustomLlmProvider[] }).providers;
}

export async function saveCustomLlmProvider(provider: CustomLlmProvider): Promise<CustomLlmProvider> {
  const r = await fetch(`${BASE}/llm-providers`, {
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
  const r = await fetch(`${BASE}/llm-providers/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export async function getRevisorStands(): Promise<{ methods: RevisorMethodDef[]; stands: RevisorStandConfig[] }> {
  const r = await fetch(`${BASE}/revisor-stands`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveRevisorStand(stand: RevisorStandConfig): Promise<RevisorStandConfig> {
  const r = await fetch(`${BASE}/revisor-stands`, {
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
  const r = await fetch(`${BASE}/revisor-stands/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}
