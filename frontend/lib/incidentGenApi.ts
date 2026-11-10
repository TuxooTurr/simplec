import { authHeaders } from "./authApi";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers = new Headers(authHeaders());
  const init: RequestInit = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { headers.set("Content-Type", "application/json"); init.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const d = (JSON.parse(text) as { detail?: unknown }).detail;
      message = typeof d === "string" ? d : Array.isArray(d) ? d.map(x => (x as { msg?: string }).msg ?? "").join("; ") : text;
    } catch { /* как есть */ }
    throw new Error(message || `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface IncCi { code: string; name: string }

/** Что и как отправить — то же, что модель Spec в backend/api/incident_gen.py. */
export interface IncSpec {
  cis: IncCi[];
  main_count: number;
  extra_min: number;
  extra_max: number;
  description_mode: "template" | "library";
  description: string;
  title: string;
  inc_type: string;
  priority: string;
  state: string;
  creation_type: string;
  potential_vpi: boolean;
  large_scale: boolean;
  impact_custom_service: boolean;
  created_ago_min: number;
  start_ago_min: number;
  fact_start_ago_min: number;
  target_days: number;
  extra_spread_min: number;
  instruction_mode: "none" | "library" | "text";
  instruction: string;
}

export const DEFAULT_SPEC: IncSpec = {
  cis: [], main_count: 1, extra_min: 0, extra_max: 0,
  description_mode: "template", description: "ТЕСТОВЫЙ ИНЦИДЕНТ {n} · {system} ({ci})", title: "",
  inc_type: "AVAILABILITY_INC", priority: "MEDIUM", state: "REGISTERED", creation_type: "MONITORING_SYSTEM",
  potential_vpi: false, large_scale: false, impact_custom_service: false,
  created_ago_min: 2, start_ago_min: 3, fact_start_ago_min: 10, target_days: 2, extra_spread_min: 10,
  instruction_mode: "none", instruction: "",
};

export interface IncSettings {
  kafka_connection_id: string;
  topic: string;
  partition: number | null;
  system_created_by: string;
  monitoring_system_name: string;
  assignee_id_bhb: string;
  assignee_personal_number: string;
  db_connection_id: string;
  instruction_sql: string;
  instruction_wait_sec: number;
  instruction_user_id: string;
  instruction_user_name: string;
  instruction_user_number: string;
}

export interface IncLibItem { id: string; system: string; description: string; summary: string; instruction: string }
export interface IncPreset { id: string; name: string; spec: IncSpec }

export interface IncState {
  settings: IncSettings;
  library: IncLibItem[];
  presets: IncPreset[];
  /** Почему инструкции записать нельзя; пусто — можно. */
  instructionsBlocked: string;
}

export interface IncResult {
  ci: string;
  main: boolean;
  inc: string;
  title: string;
  offset?: number | null;
  partition?: number | null;
  error?: string | null;
  hasInstruction: boolean;
  instruction_id?: string | null;
  instruction_error?: string | null;
}

export interface IncRun { id: string; at: string; preset: string; scenario?: string; topic: string; cis: string[]; results: IncResult[] }

export interface IncPreviewItem { ci: string; main: boolean; message: Record<string, unknown>; instruction: string }

export const getIncState = () => call<IncState>("/api/incident-gen/state");
export const saveIncSettings = (s: IncSettings) => call<{ settings: IncSettings; instructionsBlocked: string }>("/api/incident-gen/settings", "PUT", s);
export const previewIncidents = (spec: IncSpec) => call<{ total: number; main: number; items: IncPreviewItem[] }>("/api/incident-gen/preview", "POST", spec);
export const sendIncidents = (spec: IncSpec, preset: string) => call<IncRun>("/api/incident-gen/send", "POST", { spec, preset });
export const getIncHistory = () => call<{ history: IncRun[] }>("/api/incident-gen/history");
export const clearIncHistory = () => call<{ history: IncRun[] }>("/api/incident-gen/history", "DELETE");
export const saveIncPreset = (name: string, spec: IncSpec) => call<{ presets: IncPreset[] }>("/api/incident-gen/presets", "POST", { name, spec });
export const deleteIncPreset = (id: string) => call<{ presets: IncPreset[] }>(`/api/incident-gen/presets/${id}`, "DELETE");
export const addIncLib = (item: Omit<IncLibItem, "id">) => call<{ library: IncLibItem[] }>("/api/incident-gen/library", "POST", item);
export const editIncLib = (id: string, item: Omit<IncLibItem, "id">) => call<{ library: IncLibItem[] }>(`/api/incident-gen/library/${id}`, "PUT", item);
export const deleteIncLib = (id: string) => call<{ library: IncLibItem[] }>(`/api/incident-gen/library/${id}`, "DELETE");
export function importIncFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return call<{ kind: "library" | "presets" | "sql"; added: number }>("/api/incident-gen/import", "POST", fd);
}
export const getKeCatalog = () => call<{ ke: string[] }>("/api/ke-catalog");

// ── Пакет по сценарию: сценарий × КЭ × количество ──
// Сценарий задаёт виды событий, приоритет, инструкцию и другие инциденты на АС; текст события сервер выбирает случайно
// из событий сценария, время — момент отправки.

export type IncPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface IncService {
  ci: string; name: string; crit: string; hosts: string[]; app: string; db: string; topic: string;
  /** Есть ли на стенде логи / метрики по КЭ; null — не отмечено. */
  logs: boolean | null; metrics: boolean | null;
  custom: boolean;
}
export type IncServiceBody = Omit<IncService, "custom">;

export interface IncScenario {
  id: string; name: string; icon: string; short: string; events: string[];
  priority: IncPriority; instruction: boolean; extra: [number, number];
  large_scale: boolean; potential_vpi: boolean;
  /** Сценарий test_sc.json, который покрывает этот. */
  notebook?: string | null;
}

export interface IncCatalog {
  services: IncService[];
  scenarios: IncScenario[];
  /** Сколько разных событий (текстов) под капотом. */
  events: number;
  priorities: IncPriority[];
  crits: string[];
}

/** Строка КЭ: count 0 — КЭ не участвует; priority и instruction пустые — из сценария. */
export interface IncPackageItem { ci: string; count: number; priority?: IncPriority | null; instruction?: boolean | null }

export interface IncPackage {
  scenario: string;
  items: IncPackageItem[];
  /** Другие инциденты на АС; пусто — из сценария. */
  extra_min?: number | null;
  extra_max?: number | null;
}

export const getIncCatalog = () => call<IncCatalog>("/api/incident-gen/catalog");
export const previewIncPackage = (p: IncPackage) => call<{ total: number; main: number; items: IncPreviewItem[] }>("/api/incident-gen/package/preview", "POST", p);
export const sendIncPackage = (p: IncPackage) => call<IncRun>("/api/incident-gen/package/send", "POST", p);
export const addIncService = (s: IncServiceBody) => call<{ services: IncService[] }>("/api/incident-gen/services", "POST", s);
export const editIncService = (ci: string, s: IncServiceBody) => call<{ services: IncService[] }>(`/api/incident-gen/services/${encodeURIComponent(ci)}`, "PUT", s);
export const deleteIncService = (ci: string) => call<{ services: IncService[] }>(`/api/incident-gen/services/${encodeURIComponent(ci)}`, "DELETE");
