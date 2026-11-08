/**
 * Тестовая модель по этапам (методика Sber911-QA): планирование → утверждение → генерация → проверка → правки.
 * Бэкенд — backend/api/tm_gen.py, промты — agents/tm_pipeline.py.
 */

import { fetchJson } from "./api";

export type TmStatus = "planning" | "plan_ready" | "writing" | "reviewing" | "review_ready" | "fixing" | "done" | "error" | "cancelled";
export const TM_RUNNING: TmStatus[] = ["planning", "writing", "reviewing", "fixing"];

export const SCENARIO_TYPES = ["Позитивные сценарии", "Негативные сценарии", "Граничные сценарии", "E2E"] as const;

export interface TmRow {
  id: string;
  scenario: string;
  type: string;
  name: string;
  platform: "W" | "M";
  checks: string;
  steps: number;
  critical: boolean;
}

export interface TmPlan {
  place: string[];
  place_note: string;
  scenarios: TmRow[];
  coverage: { item: string; cases: string[] }[];
  questions: { id: string; unknown: string; where: string; question: string }[];
  contradictions: { requirement: string; design: string; resolution: string }[];
}

export interface TmRemark { id: string; what: string; where: string; fix: string; case: string; status: "open" | "picked" | "fixed" }

export interface TmReview {
  verdict: "ready" | "fixes";
  remarks: TmRemark[];
  questions: { question: string; priority: string }[];
}

export interface TmTask { key: string; summary: string; project: string; reqNames: string[]; dataPath: string[] }

export interface TmCase {
  name: string;
  priority: string;
  case_type: string;
  steps: { action: string; test_data: string; ui: string; api: string; db: string }[];
  estimated_minutes?: number;
  plan_id?: string;
  scenario?: string;
  scenario_type?: string;
  folder?: string;
  platform?: string;
  critical?: boolean;
  system?: string;
  labels?: string[];
}

export interface TmSession {
  id: string;
  kind: "tm";
  status: TmStatus;
  feature: string;
  requirement: string;
  provider: string;
  platforms: string;
  source: "free" | "data" | "task";
  place: string[];
  task: TmTask | null;
  batch: string;
  plan: TmPlan | null;
  answers: Record<string, string>;
  cases: TmCase[];
  qa_doc: string;
  review: (TmReview & { fixed?: TmRemark[] }) | null;
  progress: { current: number; total: number; name: string } | null;
  error: string | null;
  failed_stage: string | null;
  elapsed: number;
  created_at: string;
}

export interface TmStart {
  requirement: string;
  feature: string;
  provider: string;
  platforms: string;
  source: "free" | "data" | "task";
  place: string[];
  task?: TmTask;
  batch?: string;
}

const post = <T,>(path: string, body: unknown = {}) =>
  fetchJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const tmStart = (b: TmStart) => post<TmSession>("/api/tm/sessions", b);
export const tmGet = (id: string) => fetchJson<TmSession>(`/api/tm/sessions/${id}`);
export const tmApprove = (id: string, plan: TmPlan, answers: Record<string, string>) => post<TmSession>(`/api/tm/sessions/${id}/approve`, { plan, answers });
export const tmFix = (id: string, remark_ids: string[]) => post<TmSession>(`/api/tm/sessions/${id}/fix`, { remark_ids });
export const tmRecheck = (id: string) => post<TmSession>(`/api/tm/sessions/${id}/recheck`);
export const tmAccept = (id: string) => post<TmSession>(`/api/tm/sessions/${id}/accept`);
export const tmRetry = (id: string) => post<TmSession>(`/api/tm/sessions/${id}/retry`);
export const tmCancel = (id: string) => post<TmSession>(`/api/tm/sessions/${id}/cancel`);

export interface TmXml { files: { id: string; feature: string; task: string; xml: string }[]; xml: string }
/** Готовый XML принятых наборов: файл на сессию и общий. Проект — тот же, что в Zephyr Tool. */
export const tmXml = (ids: string[], project: string, only?: Record<string, number[]>) => post<TmXml>("/api/tm/xml", { ids, project, only: only ?? {} });

/** Проект Zephyr Tool (st_zephyr_project), по умолчанию SBER911. */
export function zephyrProject(): string {
  try { return (localStorage.getItem("st_zephyr_project") || "SBER911").trim().toUpperCase() || "SBER911"; } catch { return "SBER911"; }
}

export const TM_STATUS_LABEL: Record<TmStatus, string> = {
  planning: "Планирование…",
  plan_ready: "Ждёт утверждения",
  writing: "Генерация…",
  reviewing: "Проверка…",
  review_ready: "Замечания арбитра",
  fixing: "Исправление…",
  done: "Готово",
  error: "Ошибка",
  cancelled: "Остановлено",
};

/** Этап на шкале «Планирование · Генерация · Проверка». */
export function tmStep(s: TmStatus, failed?: string | null): 0 | 1 | 2 | 3 {
  const st = s === "error" || s === "cancelled" ? (failed as TmStatus | null) ?? "planning" : s;
  if (st === "planning" || st === "plan_ready") return 0;
  if (st === "writing") return 1;
  if (st === "done") return 3;
  return 2;
}
