/**
 * «Трекинг AQA» — клиент к /api/aqa/* (бэкенд: backend/api/aqa_tracking.py):
 * коммиты репозитория автотестов (Bitbucket), запуски Allure TestOps и роадмап эпиков AQA из Jira.
 */

import { fetchJson } from "./jiraApi";

export interface AqaSettings {
  bitbucketUrl: string;
  /** Ссылка разобралась как репозиторий Bitbucket. */
  bitbucketOk: boolean;
  /** Маска, если маркер есть; пусто — нет. */
  bitbucketToken: string;
  testopsUrl: string;
  testopsOk: boolean;
  testopsToken: string;
  epics: string[];
}

export interface AqaCommits {
  today: number;
  week: number;
  total: number;
  totalTruncated: boolean;
  last: { id: string; message: string; author: string; date: string; url: string } | null;
  repoUrl: string;
  loadedAt: string;
}

/** Статус кейса → сколько: passed, failed, broken, skipped, unknown… */
export type AqaStats = Record<string, number>;

export interface AqaTestops {
  todayLaunches: number;
  todayStats: AqaStats;
  todayStatsPartial: boolean;
  last: { id: number; name: string; date: string; closed: boolean; url: string; stats: AqaStats } | null;
  projectUrl: string;
  loadedAt: string;
}

export interface AqaIssue {
  key: string;
  url: string;
  epic: string;
  type: string;
  defect: boolean;
  summary: string;
  status: string;
  /** new / indeterminate / done */
  statusCategory: string;
  assignee: string;
  priority: string;
  /** ГГГГ-ММ-ДД; пусто — нет. */
  created: string;
  due: string;
  resolved: string;
}

export interface AqaEpic extends Partial<AqaIssue> {
  key: string;
  missing?: boolean;
  issues: AqaIssue[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export const getAqaSettings = () => fetchJson<AqaSettings>("/api/aqa/settings");
export const saveAqaSettings = (s: Omit<AqaSettings, "bitbucketOk" | "testopsOk">) =>
  fetchJson<AqaSettings>("/api/aqa/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(s) });
export const bitbucketTokenFromLogin = (login: string, password: string) =>
  fetchJson<{ status: string }>("/api/aqa/bitbucket/token-from-login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ login, password }) });
export const getAqaCommits = (refresh = false) => fetchJson<AqaCommits>(`/api/aqa/commits${refresh ? "?refresh=true" : ""}`);
export const getAqaTestops = (refresh = false) => fetchJson<AqaTestops>(`/api/aqa/testops${refresh ? "?refresh=true" : ""}`);
export const getAqaRoadmap = (refresh = false) =>
  fetchJson<{ epics: AqaEpic[]; loadedAt: string }>(`/api/aqa/roadmap${refresh ? "?refresh=true" : ""}`);

/* ── Даты задачи на таймлайне ─────────────────────────────────────────────
   Начало — создание; конец — срок, без срока — дата решения, не решена — сегодня. */

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function issueSpan(i: Pick<AqaIssue, "created" | "due" | "resolved">): { start: string; end: string } | null {
  if (!i.created) return null;
  const end = i.due || i.resolved || todayIso();
  return { start: i.created, end: end < i.created ? i.created : end };
}

/** Срок прошёл, а задача не решена. */
export const isOverdue = (i: Pick<AqaIssue, "due" | "statusCategory">) => !!i.due && i.statusCategory !== "done" && i.due < todayIso();

export const fmtDay = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
