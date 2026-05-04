const BASE = "/api/revisor";

export interface PodInfo {
  version?: string;       // Docker image tag / build / version; "" if not deployed
  total?:   number;       // total replicas configured
  running?: number;       // replicas currently Running
  status_value?: string;
  compare_value?: string;
  methods?: RevisorMethodResult[];
}

export type PodStatus = "green" | "yellow" | "red" | "grey";

export function podStatus(p: PodInfo): PodStatus {
  const total = p.total ?? 0;
  const running = p.running ?? 0;
  if (total > 0) {
    if (running === 0) return "red";
    if (running === total) return "green";
    return "yellow";
  }
  const status = (p.status_value ?? "").toLowerCase();
  if (/(error|fail|failed|down|red|critical|crash|not ready)/.test(status)) return "red";
  if (/(warn|degraded|pending|yellow|partial|unknown)/.test(status)) return "yellow";
  if (/(ok|green|ready|running|healthy|success|up)/.test(status)) return "green";
  return "grey";
}

export type RowStatus = "green" | "yellow" | "grey";

export function rowMatchStatus(row: ServiceRow, stands: string[]): RowStatus {
  const values = stands
    .map(s => row.stands[s]?.compare_value || row.stands[s]?.version || "")
    .filter(Boolean);
  if (values.length === 0) return "grey";
  return new Set(values).size === 1 ? "green" : "yellow";
}

export interface RevisorMethodResult {
  key: string;
  label: string;
  value: string;
  status?: PodStatus;
  error?: boolean;
}

export interface RevisorMethodDef {
  key: string;
  label: string;
}

export interface ServiceRow {
  name:   string;
  stands: Record<string, PodInfo>;
}

export interface StandConfig {
  id?:       string;
  name:      string;
  url?:      string;
  base_url?: string;
  namespace: string;
  enabled?: boolean;
  connected: boolean;
  methods?: RevisorMethodDef[];
}

export interface RevisorData {
  stands:   string[];
  methods?: RevisorMethodDef[];
  services: ServiceRow[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getRevisorData(): Promise<RevisorData> {
  return fetchJson<RevisorData>(`${BASE}/data`);
}

export async function getStands(): Promise<{ stands: StandConfig[] }> {
  return fetchJson<{ stands: StandConfig[] }>(`${BASE}/stands`);
}
