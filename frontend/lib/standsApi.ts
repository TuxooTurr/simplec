/**
 * График стендов — клиент к /api/stands/* (бэкенд: backend/api/stands.py).
 * Оригинал графика — свойство страницы стенда в Confluence; заявки коллеги оставляют комментариями к странице.
 */

import { fetchJson } from "./jiraApi";

export interface StandBooking {
  id: string; date: string; team: string; service: string; features: string; task: string; by: string;
  source: "simpletest" | "comment"; createdAt: string;
  /** Тот же КЭ в этот день ставит и другая команда. */
  conflict: boolean;
}
export interface StandFreeze { id: string; from: string; to: string; reason: string }
export interface StandRelease { id: string; name: string; date: string }
export interface StandPending { cid: string; text: string; author: string; reason: string; service: string; team: string; task: string; features?: string; date: string }
export interface StandDay {
  date: string; weekday: string; weekend: boolean; today: boolean;
  status: "МОЖНО" | "КОНФЛИКТ" | "ЛИМИТ" | "ЗАМОРОЗКА" | "ПРОШЁЛ" | "ВЫХОДНОЙ"; colour: string; freeze: StandFreeze | null;
  bookings: StandBooking[]; conflicts: { service: string; teams: string[] }[];
}
export interface StandView {
  stand: string; pageId: string; url: string; limit: number; window: { from: string; to: string }; releases: StandRelease[]; teams: string[];
  /** Справочник КЭ для выпадающего списка (файл на сервере, один на оба стенда). */
  keCatalog: string[];
  today: { date: string; status: string; colour: string; count: number };
  days: StandDay[]; freezes: StandFreeze[]; pending: StandPending[];
  /** Данные сохранены, но текст страницы не пересобрался — причина. */
  publishError?: string;
  pulled?: { accepted: number; pending: number; replyErrors: string[] };
  replyErrors?: string[];
}
export interface StandsConfig { stands: string[]; pages: Record<string, string>; urls: Record<string, string> }
export interface StandSettings { windowFrom: string; windowTo: string; releases: { name: string; date: string }[]; teams: string[]; limit: number }
export interface NewBooking { date: string; team: string; service: string; features: string; task: string; hotfix: boolean }

const enc = encodeURIComponent;
const send = <T,>(path: string, method: string, body?: unknown) =>
  fetchJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const getStandsConfig = () => fetchJson<StandsConfig>("/api/stands/config");
export const saveStandsConfig = (pages: Record<string, string>) => send<StandsConfig>("/api/stands/config", "PUT", { pages });
export const createStandPage = (stand: string, parent: string) => send<StandView>(`/api/stands/${enc(stand)}/create-page`, "POST", { parent });
export const getStand = (stand: string) => fetchJson<StandView>(`/api/stands/${enc(stand)}`);
export const saveStandSettings = (stand: string, s: StandSettings) => send<StandView>(`/api/stands/${enc(stand)}/settings`, "PUT", s);
export const addStandBooking = (stand: string, b: NewBooking) => send<StandView>(`/api/stands/${enc(stand)}/bookings`, "POST", b);
/** Пачка броней одной записью (импорт задач из списка Jira tool); не прошедшие правила — с причиной. */
export const addStandBookings = (stand: string, items: NewBooking[]) =>
  send<StandView & { added: number; rejected: { service: string; task: string; reason: string }[] }>(`/api/stands/${enc(stand)}/bookings/bulk`, "POST", { items });
export const deleteStandBooking = (stand: string, id: string) => send<StandView>(`/api/stands/${enc(stand)}/bookings/${enc(id)}`, "DELETE");
export const addStandFreeze = (stand: string, f: { start: string; end: string; reason: string }) => send<StandView>(`/api/stands/${enc(stand)}/freezes`, "POST", f);
export const deleteStandFreeze = (stand: string, id: string) => send<StandView>(`/api/stands/${enc(stand)}/freezes/${enc(id)}`, "DELETE");
export const pullStandRequests = (stand: string) => send<StandView>(`/api/stands/${enc(stand)}/pull`, "POST");
/** Справочник КЭ: создать (дописать новые) и сохранить целиком. */
export const addKe = (ke: string[]) => send<{ ke: string[] }>("/api/ke-catalog", "POST", { ke });
export const saveKeCatalog = (ke: string[]) => send<{ ke: string[] }>("/api/ke-catalog", "PUT", { ke });
export const decideStandPending = (stand: string, cid: string, d: { accept: boolean; date?: string; team?: string; service?: string; features?: string; task?: string; note?: string }) =>
  send<StandView>(`/api/stands/${enc(stand)}/pending/${enc(cid)}`, "POST", d);
