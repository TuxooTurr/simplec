/**
 * HTTP API клиент для REST эндпоинтов.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── System ────────────────────────────────────────────────────────────────

export interface ProviderStatus {
  id: string;
  name: string;
  status: "green" | "yellow" | "red";
  message: string;
}

export async function getProviders(): Promise<ProviderStatus[]> {
  return fetchJson("/api/system/providers");
}

export async function getStats(): Promise<Record<string, number>> {
  return fetchJson("/api/system/stats");
}

// ─── Generation ────────────────────────────────────────────────────────────

export async function parseFile(file: File): Promise<{ text: string; filename: string }> {
  const body = new FormData();
  body.append("file", file);
  return fetchJson("/api/generation/parse-file", { method: "POST", body });
}

// ─── Etalons ───────────────────────────────────────────────────────────────

export interface Etalon {
  id: string;
  req_text: string;
  tc_text: string;
  platform: string;
  feature: string;
}

export async function listEtalons(params?: {
  platform?: string;
  feature?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Etalon[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.platform) qs.set("platform", params.platform);
  if (params?.feature) qs.set("feature", params.feature);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  return fetchJson(`/api/etalons?${qs.toString()}`);
}

export async function addEtalon(data: {
  req_text: string;
  tc_text: string;
  platform?: string;
  feature?: string;
}): Promise<{ id: string; status: string }> {
  const body = new FormData();
  body.append("req_text", data.req_text);
  body.append("tc_text", data.tc_text);
  if (data.platform) body.append("platform", data.platform);
  if (data.feature) body.append("feature", data.feature);
  return fetchJson("/api/etalons", { method: "POST", body });
}

export async function deleteEtalon(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/etalons/${id}`, { method: "DELETE" });
}

export async function getEtalonStats(): Promise<Record<string, number>> {
  return fetchJson("/api/etalons/stats");
}

// ─── Bugs ──────────────────────────────────────────────────────────────────

export async function formatBug(params: {
  platform: string;
  feature: string;
  description: string;
  provider?: string;
}): Promise<{ report: string }> {
  return fetchJson("/api/bugs/format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gigachat", ...params }),
  });
}
