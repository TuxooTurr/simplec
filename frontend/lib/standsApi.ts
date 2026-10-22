/**
 * График стендов — клиент к /api/stands/* (бэкенд: backend/api/stands.py).
 * Оригинал графика — свойство страницы стенда в Confluence; заявки коллеги оставляют комментариями к странице.
 */

import { fetchJson } from "./jiraApi";

export interface StandBooking {
  /** dateTo — конец периода (включительно); нет — один день. timeFrom/timeTo — время установки каждый день; нет — весь день. */
  id: string; date: string; dateTo?: string; timeFrom?: string; timeTo?: string; team: string; service: string; features: string; task: string; by: string;
  source: "simpletest" | "comment"; createdAt: string;
  /** Тот же микросервис в это время ставит и другая команда. */
  conflict: boolean;
}
export interface StandFreeze { id: string; from: string; to: string; reason: string }
export interface StandRelease { id: string; name: string; date: string }
export interface StandPending {
  cid: string; text: string; author: string; reason: string; service: string; team: string; task: string; features?: string;
  date: string; dateTo?: string; timeFrom?: string; timeTo?: string;
}
export interface StandDay {
  date: string; weekday: string; weekend: boolean; today: boolean;
  /** День входит в окно планирования (вне окна — только просмотр, например при «3 месяца»). */
  inWindow: boolean;
  status: "МОЖНО" | "КОНФЛИКТ" | "ЛИМИТ" | "ЗАМОРОЗКА" | "ПРОШЁЛ" | "ВЫХОДНОЙ"; colour: string; freeze: StandFreeze | null;
  bookings: StandBooking[]; conflicts: { service: string; teams: string[] }[];
}
export interface StandView {
  stand: string; pageId: string; url: string; limit: number; window: { from: string; to: string }; releases: StandRelease[]; teams: string[];
  /** Справочник микросервисов для выпадающего списка (файл на сервере, один на оба стенда). */
  msCatalog: string[];
  /** Описания микросервисов (имя → описание репозитория). */
  msInfo: Record<string, string>;
  /** Показанный период: окно планирования или запрошенный (start/end). */
  range: { from: string; to: string };
  today: { date: string; status: string; colour: string; count: number };
  days: StandDay[]; freezes: StandFreeze[]; pending: StandPending[];
  /** Данные сохранены, но текст страницы не пересобрался — причина. */
  publishError?: string;
  pulled?: { accepted: number; pending: number; replyErrors: string[] };
  replyErrors?: string[];
}
export interface StandsConfig { stands: string[]; pages: Record<string, string>; urls: Record<string, string> }
export interface StandSettings { windowFrom: string; windowTo: string; releases: { name: string; date: string }[]; teams: string[]; limit: number }
export interface NewBooking { date: string; dateTo?: string; timeFrom?: string; timeTo?: string; team: string; service: string; features: string; task: string; hotfix: boolean }

/**
 * Ключ сравнения сервиса (микросервиса или КЭ) — как ke_key на бэкенде (db/ke_store.py): по коду CI, если он есть
 * («Чат [CI04663753]» = «ci04663753»), иначе по названию без регистра и лишних пробелов.
 */
export function keKey(s: string): string {
  const m = /(?:\bci0*(\d{5,})\b|[(\[]\s*(?:ci)?0*(\d{5,})\s*[)\]])/i.exec(s ?? "");
  return m ? `ci${m[1] ?? m[2]}` : (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** КЭ в написании справочника (из Jira он может прийти «Название (3521751)»); нет в справочнике — как есть. */
export function canonKe(s: string, catalog: string[]): string {
  const k = keKey(s);
  return catalog.find(c => keKey(c) === k) ?? s.trim();
}

const enc = encodeURIComponent;
const send = <T,>(path: string, method: string, body?: unknown) =>
  fetchJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const getStandsConfig = () => fetchJson<StandsConfig>("/api/stands/config");
export const saveStandsConfig = (pages: Record<string, string>) => send<StandsConfig>("/api/stands/config", "PUT", { pages });
export const createStandPage = (stand: string, parent: string) => send<StandView>(`/api/stands/${enc(stand)}/create-page`, "POST", { parent });
/** График стенда: окно планирования или период range (например, последние 3 месяца). */
export const getStand = (stand: string, range?: { from: string; to: string } | null) =>
  fetchJson<StandView>(`/api/stands/${enc(stand)}${range ? `?start=${range.from}&end=${range.to}` : ""}`);
export const saveStandSettings = (stand: string, s: StandSettings) => send<StandView>(`/api/stands/${enc(stand)}/settings`, "PUT", s);
export const addStandBooking = (stand: string, b: NewBooking) => send<StandView>(`/api/stands/${enc(stand)}/bookings`, "POST", b);
/** Пачка броней одной записью (импорт задач из списка Jira tool); не прошедшие правила — с причиной. */
export const addStandBookings = (stand: string, items: NewBooking[]) =>
  send<StandView & { added: number; rejected: { service: string; task: string; reason: string }[] }>(`/api/stands/${enc(stand)}/bookings/bulk`, "POST", { items });
export const deleteStandBooking = (stand: string, id: string) => send<StandView>(`/api/stands/${enc(stand)}/bookings/${enc(id)}`, "DELETE");
export const addStandFreeze = (stand: string, f: { start: string; end: string; reason: string }) => send<StandView>(`/api/stands/${enc(stand)}/freezes`, "POST", f);
export const deleteStandFreeze = (stand: string, id: string) => send<StandView>(`/api/stands/${enc(stand)}/freezes/${enc(id)}`, "DELETE");
export const pullStandRequests = (stand: string) => send<StandView>(`/api/stands/${enc(stand)}/pull`, "POST");
/** Справочник КЭ (графиком сейчас не используется, остаётся для другого): создать и сохранить целиком. */
export const addKe = (ke: string[]) => send<{ ke: string[] }>("/api/ke-catalog", "POST", { ke });
export const saveKeCatalog = (ke: string[]) => send<{ ke: string[] }>("/api/ke-catalog", "PUT", { ke });
/** Справочник микросервисов с описаниями — для поля «Микросервисы» Jira tool (на графике он приходит в StandView). */
export const getMsCatalog = () => fetchJson<{ ms: string[]; info: Record<string, string> }>("/api/ms-catalog");
/** Справочник микросервисов — то, что бронируют на графике: создать (дописать новые) и сохранить целиком. */
export const addMs = (ms: string[]) => send<{ ms: string[] }>("/api/ms-catalog", "POST", { ke: ms });
export const saveMsCatalog = (ms: string[]) => send<{ ms: string[] }>("/api/ms-catalog", "PUT", { ke: ms });
export const decideStandPending = (stand: string, cid: string, d: {
  accept: boolean; date?: string; dateTo?: string; timeFrom?: string; timeTo?: string; team?: string; service?: string;
  features?: string; task?: string; note?: string;
}) =>
  send<StandView>(`/api/stands/${enc(stand)}/pending/${enc(cid)}`, "POST", d);
