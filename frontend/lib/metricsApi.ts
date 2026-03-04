/**
 * API-хелперы для Генератора метрик.
 * Вынесены отдельно от api.ts чтобы не раздувать общий файл.
 */

const BASE = "/api/metrics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface System {
  id:            number;
  itServiceCi:   string;
  name:          string;
  monSystemCi:   string;
  isActive:      boolean;
  metricsTotal:  number;
  metricsActive: number;
  lastSentAt:    string | null;
  createdAt:     string;
}

export interface SystemsResponse {
  systems:       System[];
  totalSystems:  number;
  activeSystems: number;
  totalMetrics:  number;
  activeMetrics: number;
}

export interface Metric {
  id:                 number;
  testSystemId:       number;
  metricHash:         string;
  metricName:         string;
  metricDescription:  string;
  metricType:         string;
  metricGroup:        string;
  metricUnit:         string;
  metricPeriodSec:    number;
  objectCi:           string | null;
  objectId:           string;
  objectName:         string;
  objectType:         string | null;
  monSystemMetricId:  string;
  purposeTypeHint:    number | null;
  specVersion:        string;
  isActive:           boolean;
  lastSentAt:         string | null;
  createdAt:          string;
}

export interface MetricCreate {
  metricName:         string;
  metricDescription:  string;
  metricType:         string;
  metricGroup:        string;
  metricUnit:         string;
  metricPeriodSec:    number;
  objectCi?:          string;
  objectId:           string;
  objectName:         string;
  objectType?:        string;
  monSystemMetricId:  string;
  purposeTypeHint?:   number;
  specVersion?:       string;
}

export interface KafkaSetting {
  value:       string;
  description: string;
  updatedAt:   string | null;
}

export type SettingsMap = Record<string, KafkaSetting>;

// ── Systems ───────────────────────────────────────────────────────────────────

export async function getSystems(): Promise<SystemsResponse> {
  const r = await fetch(`${BASE}/systems`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createSystem(body: { itServiceCi: string; name: string; monSystemCi: string }): Promise<System> {
  const r = await fetch(`${BASE}/systems`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.detail ?? "Ошибка создания услуги");
  }
  return r.json();
}

export async function updateSystem(id: number, body: { name?: string; monSystemCi?: string }): Promise<System> {
  const r = await fetch(`${BASE}/systems/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.detail ?? "Ошибка обновления");
  }
  return r.json();
}

export async function deleteSystem(id: number): Promise<void> {
  const r = await fetch(`${BASE}/systems/${id}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
}

export async function toggleSystem(id: number): Promise<{ id: number; isActive: boolean }> {
  const r = await fetch(`${BASE}/systems/${id}/toggle`, { method: "POST", credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function toggleAll(action: "start" | "stop"): Promise<void> {
  const r = await fetch(`${BASE}/toggle-all?action=${action}`, { method: "POST", credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export async function getSystemMetrics(systemId: number): Promise<Metric[]> {
  const r = await fetch(`${BASE}/systems/${systemId}/metrics`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return d.metrics;
}

export async function createMetric(systemId: number, body: MetricCreate): Promise<Metric> {
  const r = await fetch(`${BASE}/systems/${systemId}/metrics`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.detail ?? "Ошибка создания метрики");
  }
  return r.json();
}

export async function deleteMetric(id: number): Promise<void> {
  const r = await fetch(`${BASE}/metrics/${id}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
}

export async function toggleMetric(id: number): Promise<{ id: number; isActive: boolean }> {
  const r = await fetch(`${BASE}/metrics/${id}/toggle`, { method: "POST", credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getMetricsSettings(): Promise<SettingsMap> {
  const r = await fetch(`${BASE}/settings`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveMetricsSettings(settings: Record<string, string>): Promise<void> {
  const r = await fetch(`${BASE}/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  if (!r.ok) throw new Error(await r.text());
}
