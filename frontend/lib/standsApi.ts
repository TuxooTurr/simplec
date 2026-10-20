/**
 * График стендов — клиент к /api/stands/* (бэкенд: backend/api/stands.py).
 * Оригинал графика — свойство страницы стенда в Confluence; заявки коллеги оставляют комментариями к странице.
 */

import { fetchJson } from "./jiraApi";

export interface StandBooking { id: string; date: string; team: string; service: string; task: string; by: string; source: "simpletest" | "comment"; createdAt: string }
export interface StandFreeze { id: string; from: string; to: string; reason: string }
export interface StandPending { cid: string; text: string; author: string; reason: string; service: string; team: string; task: string; date: string }
export interface StandDay {
  date: string; weekday: string; sprint: number; today: boolean;
  status: "МОЖНО" | "ЛИМИТ" | "ЗАМОРОЗКА" | "ПРОШЁЛ"; colour: string; freeze: StandFreeze | null; bookings: StandBooking[];
}
export interface StandView {
  stand: string; pageId: string; url: string; limit: number; sprintStart: string; sprintDays: number; teams: string[];
  today: { date: string; status: string; colour: string; count: number };
  days: StandDay[]; freezes: StandFreeze[]; pending: StandPending[];
  /** Данные сохранены, но текст страницы не пересобрался — причина. */
  publishError?: string;
  pulled?: { accepted: number; pending: number; replyErrors: string[] };
  replyErrors?: string[];
}
export interface StandsConfig { stands: string[]; pages: Record<string, string>; urls: Record<string, string> }

const enc = encodeURIComponent;
const send = <T,>(path: string, method: string, body?: unknown) =>
  fetchJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const getStandsConfig = () => fetchJson<StandsConfig>("/api/stands/config");
export const saveStandsConfig = (pages: Record<string, string>) => send<StandsConfig>("/api/stands/config", "PUT", { pages });
export const createStandPage = (stand: string, parent: string) => send<StandView>(`/api/stands/${enc(stand)}/create-page`, "POST", { parent });
export const getStand = (stand: string) => fetchJson<StandView>(`/api/stands/${enc(stand)}`);
export const saveStandSettings = (stand: string, s: { limit: number; sprintStart: string; sprintDays: number; teams: string[] }) =>
  send<StandView>(`/api/stands/${enc(stand)}/settings`, "PUT", s);
export const addStandBooking = (stand: string, b: { date: string; team: string; service: string; task: string; hotfix: boolean }) =>
  send<StandView>(`/api/stands/${enc(stand)}/bookings`, "POST", b);
export const deleteStandBooking = (stand: string, id: string) => send<StandView>(`/api/stands/${enc(stand)}/bookings/${enc(id)}`, "DELETE");
export const addStandFreeze = (stand: string, f: { start: string; end: string; reason: string }) => send<StandView>(`/api/stands/${enc(stand)}/freezes`, "POST", f);
export const deleteStandFreeze = (stand: string, id: string) => send<StandView>(`/api/stands/${enc(stand)}/freezes/${enc(id)}`, "DELETE");
export const pullStandRequests = (stand: string) => send<StandView>(`/api/stands/${enc(stand)}/pull`, "POST");
export const decideStandPending = (stand: string, cid: string, d: { accept: boolean; date?: string; team?: string; service?: string; task?: string; note?: string }) =>
  send<StandView>(`/api/stands/${enc(stand)}/pending/${enc(cid)}`, "POST", d);
