const BASE = "/api/revisor";

export interface PodInfo {
  version: string;   // Docker image tag; "" if not deployed
  total:   number;   // total replicas configured
  running: number;   // replicas currently Running
}

export type PodStatus = "green" | "yellow" | "red" | "grey";

export function podStatus(p: PodInfo): PodStatus {
  if (p.total === 0) return "grey";
  if (p.running === 0) return "red";
  if (p.running === p.total) return "green";
  return "yellow";
}

export type RowStatus = "green" | "yellow" | "grey";

export function rowMatchStatus(row: ServiceRow, stands: string[]): RowStatus {
  const versions = stands
    .map(s => row.stands[s]?.version ?? "")
    .filter(Boolean);
  if (versions.length === 0) return "grey";
  return new Set(versions).size === 1 ? "green" : "yellow";
}

export interface ServiceRow {
  name:   string;
  stands: Record<string, PodInfo>;
}

export interface StandConfig {
  name:      string;
  url:       string;
  namespace: string;
  connected: boolean;
}

export interface RevisorData {
  stands:   string[];
  services: ServiceRow[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getRevisorData(): Promise<RevisorData> {
  return fetchJson<RevisorData>(`${BASE}/data`);
}

export async function getStands(): Promise<{ stands: StandConfig[] }> {
  return fetchJson<{ stands: StandConfig[] }>(`${BASE}/stands`);
}
