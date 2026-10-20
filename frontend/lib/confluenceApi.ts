/**
 * Confluence — клиент к /api/confluence/* (бэкенд: backend/api/confluence.py).
 * Нужен разделу «График стендов»: оригинал графика будет жить на странице Confluence.
 */

import { fetchJson } from "./jiraApi";

export interface ConfluenceSettings { base_url: string; token: string; token_path: string; ssl_verify: boolean; space: string }

/** Строка отчёта проверки API: что сработало, код ответа, каркас ответа (ключи и типы, без данных). */
export interface ConfProbeRow {
  id: string; label: string; method?: string; path?: string;
  ok?: boolean; status?: number; ms?: number; note?: string; error?: string; shape?: unknown;
  skipped?: boolean; reason?: string;
}

export interface ConfProbeReport { base_url: string; checkedAt: string; ok: number; total: number; results: ConfProbeRow[]; space: string; page?: string }

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getConfluenceSettings = () => fetchJson<ConfluenceSettings>("/api/confluence/settings");
export const saveConfluenceSettings = (s: ConfluenceSettings) => fetchJson<ConfluenceSettings>("/api/confluence/settings", json("PUT", s));
export const testConfluence = () => fetchJson<{ status: string; user: string; name: string }>("/api/confluence/test");
export const probeConfluenceRead = (space: string, page: string) => fetchJson<ConfProbeReport>(`/api/confluence/probe?${q({ space, page })}`);
export const probeConfluenceWrite = (space: string, parent: string) => fetchJson<ConfProbeReport>("/api/confluence/probe/write", json("POST", { space, parent }));
