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

// ── Builder types ─────────────────────────────────────────────────────────────

export interface ValuesConfig {
  pattern:            "constant" | "random" | "sine" | "spike";
  value_min:          number;
  value_max:          number;
  sine_period_min:    number | null;
  spike_interval_min: number | null;
}

export interface BaselineConfig {
  enabled:      boolean;
  calc_method:  "fixed" | "offset";
  fixed_value:  number | null;
  offset_value: number | null;
}

export interface ThresholdRow {
  id?:         number;
  health_type: number;
  min_value:   number | null;
  max_value:   number | null;
  is_percent:  boolean;
}

export interface ThresholdsConfig {
  enabled:              boolean;
  combination_selector: "best" | "worst";
  threshold_type:       "threshold" | "baseline";
  exceed_enabled:       boolean;
  exceed_level:         number | null;
  exceed_mode:          string | null;
  exceed_interval_min:  number | null;
  rows:                 ThresholdRow[];
}

export interface HealthConfig {
  enabled:           boolean;
  calc_method:       "auto" | "fixed" | "pattern";
  fixed_status:      number | null;
  health_pattern:    "stable_ok" | "degrading" | "flapping" | null;
  flap_interval_min: number | null;
  degrade_hours:     number | null;
}

export interface BuilderConfig {
  metricId:          number;
  metricName:        string;
  metricPeriodSec:   number;
  isActive:          boolean;
  valuesConfig:      ValuesConfig;
  baselineConfig:    BaselineConfig;
  thresholdsConfig:  ThresholdsConfig;
  healthConfig:      HealthConfig;
}

export interface LogEntry {
  id:             number;
  sentAt:         string | null;
  valueSent:      number | null;
  baselineSent:   number | null;
  healthSent:     number | null;
  thresholdsSent: boolean;
  kafkaOffset:    number | null;
  status:         "success" | "error";
  errorMessage:   string | null;
  messageJson:    string | null;
}

export interface SendNowResult {
  ok:           boolean;
  value?:       number;
  baseline?:    number | null;
  health?:      number | null;
  offset?:      number | null;
  partition?:   number | null;
  topic?:       string;
  messageJson?: string;
  error?:       string;
}

export interface PreviewResult {
  value:               number;
  baseline:            number | null;
  health:              number | null;
  thresholds_included: boolean;
  message_json:        string;
}

// ── Builder API functions ─────────────────────────────────────────────────────

export async function getMetricBuilder(id: number): Promise<BuilderConfig> {
  const r = await fetch(`${BASE}/metrics/${id}/builder`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveValuesConfig(id: number, data: ValuesConfig): Promise<ValuesConfig> {
  const r = await fetch(`${BASE}/metrics/${id}/values-config`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as {detail?: string}).detail ?? "Ошибка"); }
  return r.json();
}

export async function saveBaselineConfig(id: number, data: BaselineConfig): Promise<BaselineConfig> {
  const r = await fetch(`${BASE}/metrics/${id}/baseline-config`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as {detail?: string}).detail ?? "Ошибка"); }
  return r.json();
}

export async function saveThresholdsConfig(id: number, data: ThresholdsConfig): Promise<ThresholdsConfig> {
  const r = await fetch(`${BASE}/metrics/${id}/thresholds-config`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as {detail?: string}).detail ?? "Ошибка"); }
  return r.json();
}

export async function saveHealthConfig(id: number, data: HealthConfig): Promise<HealthConfig> {
  const r = await fetch(`${BASE}/metrics/${id}/health-config`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as {detail?: string}).detail ?? "Ошибка"); }
  return r.json();
}

export async function sendNow(id: number): Promise<SendNowResult> {
  const r = await fetch(`${BASE}/metrics/${id}/send-now`, {
    method: "POST", credentials: "include",
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function previewMessage(id: number): Promise<PreviewResult> {
  const r = await fetch(`${BASE}/metrics/${id}/preview`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getMetricLogs(id: number, limit = 20): Promise<LogEntry[]> {
  const r = await fetch(`${BASE}/metrics/${id}/logs?limit=${limit}`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return (d as { logs: LogEntry[] }).logs;
}
