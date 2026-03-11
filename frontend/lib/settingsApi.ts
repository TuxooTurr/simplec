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

export async function getSettings(): Promise<SettingsMap> {
  const r = await fetch(BASE, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveSettings(data: Record<string, string>): Promise<void> {
  const r = await fetch(BASE, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: data }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { detail?: string }).detail ?? "Ошибка сохранения настроек");
  }
}
