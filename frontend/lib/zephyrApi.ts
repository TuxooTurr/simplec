/**
 * Zephyr Tool — клиент к /api/zephyr/* (бэкенд: backend/api/zephyr.py).
 * Этап 1: чтение и проверка API на стенде. Запись — после отчёта проверки.
 */

import { fetchJson } from "./jiraApi";

export interface ZFolder { id?: number; name: string; path: string; count: number; children: ZFolder[] }

export interface ZCase {
  key: string;
  name: string;
  status: string;
  priority: string;
  folder: string;
  labels: string[];
  owner: string;
  updated: string;
  /** Задачи Jira, к которым привязан кейс (отслеживание). */
  issueLinks: string[];
}

export interface ZStep { index: number; description: string; testData: string; expectedResult: string }

export interface ZCaseFull extends ZCase {
  objective: string;
  precondition: string;
  steps: ZStep[];
  estimatedTime?: number | null;
  component: string;
}

export interface ZRun {
  key: string;
  name: string;
  status: string;
  folder: string;
  version: string;
  /** Задача Jira, к которой привязан прогон (отслеживание). */
  issueKey: string;
  owner: string;
  plannedStart: string;
  plannedEnd: string;
  total: number;
  /** Статус результата → сколько кейсов. */
  counts: Record<string, number>;
}

export interface ZResult {
  id?: number;
  testCaseKey: string;
  status: string;
  assignee: string;
  executedBy: string;
  executionDate: string;
  comment: string;
  issueLinks: string[];
}

export interface ZRunFull extends ZRun { items: ZResult[] }

export interface ProbeRow {
  id: string;
  label: string;
  skipped?: boolean;
  reason?: string;
  method?: string;
  path?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  status?: number;
  error?: string;
  shape?: unknown;
  sample?: string;
  ms?: number;
}

export interface ProbeReport { project: string; base_url: string; checkedAt: string; ok: number; total: number; results: ProbeRow[] }

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const getTree = (project: string) =>
  fetchJson<{ source: "foldertree" | "cases"; folders: ZFolder[]; total?: number; truncated?: boolean }>(`/api/zephyr/tree?${q({ project })}`);

export const getCases = (project: string, folder: string, text = "") =>
  fetchJson<{ cases: ZCase[] }>(`/api/zephyr/cases?${q({ project, folder, text })}`);

export const getCase = (key: string) => fetchJson<ZCaseFull>(`/api/zephyr/case/${encodeURIComponent(key)}`);

export const getRuns = (project: string) => fetchJson<{ runs: ZRun[] }>(`/api/zephyr/runs?${q({ project })}`);

export const getRun = (key: string) => fetchJson<ZRunFull>(`/api/zephyr/run/${encodeURIComponent(key)}`);

export const probeZephyr = (project: string, samples: boolean) =>
  fetchJson<ProbeReport>(`/api/zephyr/probe?${q({ project, samples: String(samples) })}`);

/**
 * Текстовые поля Zephyr (цель, предусловие, шаги) хранятся HTML-ом: <p>, <br>, <b>…
 * Для показа — обычный текст с переносами строк; разбор через DOMParser, без вставки HTML в страницу.
 */
export function zText(html: string): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return html;
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<li[^>]*>/gi, "• ");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Цвет статуса результата — по смыслу (названия статусов в проектах настраиваются). */
export function resultTone(status: string): "pass" | "fail" | "blocked" | "progress" | "none" {
  const s = status.toLowerCase();
  if (/pass|пройд|успеш/.test(s)) return "pass";
  if (/fail|провал|ошиб/.test(s)) return "fail";
  if (/block|заблок/.test(s)) return "blocked";
  if (/progress|в работе|выполня/.test(s)) return "progress";
  return "none";
}

/* ── Крит регресс и прохождение ───────────────────────────────────────────── */

export interface ZKe { id: string; name: string; label: string }

export interface ZRelease { key: string; summary: string; status: string; issuetype: string; url: string; ke: ZKe[]; keSources: string[] }

/** Условия отбора крит регресса — названия полей и значения Zephyr (по умолчанию — процесс SBER911). */
export interface CritCriteria {
  status: string;
  crit_field: string;
  crit_value: string;
  type_field: string;
  type_value: string;
  ke_field: string;
}

export const DEFAULT_CRITERIA: CritCriteria = {
  status: "Утверждено", crit_field: "Крит регресс", crit_value: "Да", type_field: "Тип тестирования", type_value: "Регресс", ke_field: "КЭ",
};

export interface CritCase extends ZCase { ke: string[] }

export interface CritStats { checked: number; no_crit: number; no_type: number; no_ke: number }

export const getRelease = (key: string) => fetchJson<ZRelease>(`/api/zephyr/release/${encodeURIComponent(key.trim())}`);

export const findCritCases = (project: string, ke: string[], criteria: CritCriteria) =>
  fetchJson<{ cases: CritCase[]; stats: CritStats; truncated: boolean }>("/api/zephyr/crit-cases", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, ke, criteria }),
  });

export const createRun = (body: { project: string; name: string; issueKey: string; caseKeys: string[]; folder?: string }) =>
  fetchJson<{ key: string; url: string }>("/api/zephyr/runs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

/** Статусы результата Zephyr (названия по умолчанию). */
export type ZStatus = "Pass" | "Fail" | "Blocked" | "Not Executed";

export interface CaseResultIn {
  testCaseKey: string;
  status: ZStatus;
  comment?: string;
  executionTime?: number;
  issueLinks?: string[];
  scriptResults?: { index: number; status: ZStatus; comment?: string }[];
}

export const saveResults = (runKey: string, results: CaseResultIn[]) =>
  fetchJson<{ saved: number; errors: { testCaseKey: string; error: string }[] }>(`/api/zephyr/run/${encodeURIComponent(runKey)}/results`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results }),
  });
