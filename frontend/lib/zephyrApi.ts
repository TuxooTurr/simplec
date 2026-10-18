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
  /** Длительность кейса (расчётное время Zephyr), мс. */
  estimatedTime?: number | null;
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
  /** Вид тестирования прогона (поле прогона): «Регресс», «Новый функционал»… */
  type: string;
  owner: string;
  /** Дата создания прогона (ISO). */
  created: string;
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
  /** Время прохождения кейса, мс. */
  executionTime?: number | null;
  /** Название кейса — из модели проекта. */
  name?: string;
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
  /** Пояснение к результату (страница модели: сколько кейсов отдал сервер, пришли ли шаги). */
  note?: string;
}

export interface ProbeReport { project: string; base_url: string; checkedAt: string; ok: number; total: number; results: ProbeRow[] }

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const getTree = (project: string) =>
  fetchJson<{ source: string; folders: ZFolder[]; total?: number; loadedAt?: number }>(`/api/zephyr/tree?${q({ project })}`);

/** Модель проекта (все кейсы без шагов) — кэш на сервере. refresh — перечитать целиком из Jira. */
export const getIndex = (project: string, refresh = false) =>
  fetchJson<{ total: number; loadedAt: number }>(`/api/zephyr/index?${q({ project, refresh: String(refresh) })}`);

/** Перечитать из Jira только одну папку — без полной перезагрузки модели. */
export const refreshFolder = (project: string, folder: string) =>
  fetchJson<{ folder: string; total: number }>("/api/zephyr/index/folder", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, folder }),
  });

export const getCases = (project: string, folder: string, text = "") =>
  fetchJson<{ cases: ZCase[] }>(`/api/zephyr/cases?${q({ project, folder, text })}`);

/** Кейс целиком; с project — заодно освежает его запись в модели на сервере. */
export const getCase = (key: string, project = "") =>
  fetchJson<ZCaseFull>(`/api/zephyr/case/${encodeURIComponent(key)}${project ? `?${q({ project })}` : ""}`);

/** Все прогоны проекта — из индекса на сервере; refresh — перечитать из Jira. */
export const getRuns = (project: string, refresh = false) =>
  fetchJson<{ runs: ZRun[]; loadedAt: number }>(`/api/zephyr/runs?${q({ project, refresh: String(refresh) })}`);

export const getRun = (key: string) => fetchJson<ZRunFull>(`/api/zephyr/run/${encodeURIComponent(key)}`);

/** Проверка API; run/issue — проверить конкретный прогон (с релизом и стори в отслеживании) и задачу. */
export const probeZephyr = (project: string, samples: boolean, run = "", issue = "") =>
  fetchJson<ProbeReport>(`/api/zephyr/probe?${q({ project, samples: String(samples), run, issue })}`);

/** «Пройти прогон»: всем кейсам без Pass — Pass в Jira. */
export const passRun = (key: string) =>
  fetchJson<{ saved: number; skipped: number; total: number; errors: { testCaseKey: string; error: string }[] }>(
    `/api/zephyr/run/${encodeURIComponent(key)}/pass`, { method: "POST" });

/** Время в мс → «1 ч 05 мин», «3 мин 20 с», «45 с». */
export function fmtDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} ч ${String(m).padStart(2, "0")} мин`;
  if (m) return `${m} мин${sec ? ` ${sec} с` : ""}`;
  return `${sec} с`;
}

/** ISO → «01.10.2026». */
export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");

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

/** Задача, связанная с релизом (стори релиза — связи задачи релиза). */
export interface ZLinked { key: string; summary: string; status: string; issuetype: string; link: string }

export interface ZRelease {
  key: string; summary: string; status: string; issuetype: string; url: string; ke: ZKe[]; keSources: string[]; stories: ZLinked[];
}

/** Условия отбора крит регресса — названия полей и значения Zephyr (по умолчанию — процесс SBER911). */
export interface CritCriteria {
  status: string;
  crit_field: string;
  crit_value: string;
  type_field: string;
  type_value: string;
  ke_field: string;
  /** true — только кейсы с признаком «Крит. регресс»; false — весь регресс по КЭ релиза. */
  only_crit: boolean;
}

export const DEFAULT_CRITERIA: CritCriteria = {
  // Статус «Утверждено» = Approved в API; имена полей — как в выгрузках Zephyr SBER911 (точки и пробелы не важны).
  status: "Утверждено", crit_field: "Крит. регресс", crit_value: "Да", type_field: "Вид тестирования", type_value: "Регресс", ke_field: "АС", only_crit: true,
};

/** Значения для выпадающих списков «Условий» — по модели проекта. */
export const getFieldValues = (project: string) =>
  fetchJson<{ statuses: string[]; fields: Record<string, string[]> }>(`/api/zephyr/field-values?${q({ project })}`);

/* ── Релизы: строки с маркерами ───────────────────────────────────────────── */

/** Релизы, которые ведём в SimpleTest (строки вкладки «Релиз»). */
export interface ReleaseList { releases: string[] }

/**
 * Строка релиза: прогоны с релизом в отслеживании; для стори — прогоны релиза, где она тоже в отслеживании.
 * traceSource: tql — по всему отслеживанию; issueKey — стенд отдаёт только основную задачу прогона.
 */
export interface ReleaseBoard { release: ZRelease; runs: ZRun[]; storyRuns: Record<string, ZRun[]>; traceSource: "tql" | "issueKey" }

export const getReleases = (project: string) => fetchJson<ReleaseList>(`/api/zephyr/releases?${q({ project })}`);

export const addRelease = (project: string, key: string) =>
  fetchJson<ReleaseList>("/api/zephyr/releases", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, key }),
  });

export const removeRelease = (project: string, key: string) =>
  fetchJson<ReleaseList>(`/api/zephyr/releases/${encodeURIComponent(key)}?${q({ project })}`, { method: "DELETE" });

export const getReleaseBoard = (project: string, key: string) =>
  fetchJson<ReleaseBoard>(`/api/zephyr/release/${encodeURIComponent(key)}/board?${q({ project })}`);

/** Вид прогона по полю «Вид тестирования»: НФ (новый функционал), регресс или как есть. */
export function runKind(type: string): "nf" | "regress" | "other" {
  const t = type.trim().toLowerCase();
  // \b в JS не видит границ кириллических слов — поэтому «нф» без буквы следом, а не ^нф\b.
  if (/^нф(?![а-яё])|нов\S*\s+функц/.test(t)) return "nf";
  if (/регресс|regress/.test(t)) return "regress";
  return "other";
}

/** Короткая подпись вида прогона: «Новый функционал» → «НФ». */
export const runKindLabel = (type: string) => (runKind(type) === "nf" ? "НФ" : type || "—");

export interface CritCase extends ZCase { ke: string[] }

export interface CritStats { checked: number; no_status: number; no_crit: number; no_type: number; no_ke: number; fields: string[] }

export const getRelease = (key: string) => fetchJson<ZRelease>(`/api/zephyr/release/${encodeURIComponent(key.trim())}`);

export const findCritCases = (project: string, ke: string[], criteria: CritCriteria) =>
  fetchJson<{ cases: CritCase[]; stats: CritStats; loadedAt: number }>("/api/zephyr/crit-cases", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, ke, criteria }),
  });

/** Новый прогон: задача релиза — в отслеживании (API принимает её только при создании), type — «Вид тестирования». */
export const createRun = (body: { project: string; name: string; issueKey: string; caseKeys: string[]; folder?: string; type?: string }) =>
  fetchJson<{ key: string; url: string; issueKey: string; warnings: string[] }>("/api/zephyr/runs", {
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

/* ── Правка структуры: папки и кейсы (запись в Jira сразу) ────────────────── */

const post = <T,>(url: string, body: unknown, method = "POST") =>
  fetchJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const createFolder = (project: string, path: string) => post<{ path: string }>("/api/zephyr/folder", { project, path });

/** Переименовать/переместить папку — переносом всех её кейсов в новый путь (id папок публичный API не отдаёт). */
export const moveFolder = (project: string, source: string, target: string) =>
  post<{ moved: number; errors: { key: string; error: string }[]; target: string }>("/api/zephyr/folder/move", { project, source, target });

export const moveCases = (project: string, keys: string[], folder: string) =>
  post<{ moved: number; errors: { key: string; error: string }[] }>("/api/zephyr/cases/move", { project, keys, folder });

export interface CaseEditIn {
  name?: string; folder?: string; objective?: string; precondition?: string; priority?: string; status?: string;
  labels?: string[]; issueLinks?: string[]; steps?: { description: string; testData: string; expectedResult: string }[];
}

export const updateCase = (key: string, project: string, edit: CaseEditIn) =>
  post<ZCaseFull>(`/api/zephyr/case/${encodeURIComponent(key)}`, { project, ...edit }, "PUT");

export const createCase = (project: string, edit: CaseEditIn & { name: string }) => post<ZCaseFull>("/api/zephyr/case", { project, ...edit });

/** Несколько кейсов: удалить / изменить статус, приоритет, метки (добавляются), пользовательские поля. */
export const deleteCases = (project: string, keys: string[]) =>
  post<{ deleted: string[]; errors: { key: string; error: string }[] }>("/api/zephyr/cases/delete", { project, keys });

export interface CasesEditIn { status?: string; priority?: string; labelsAdd?: string[]; customFields?: Record<string, unknown> }

export const editCases = (project: string, keys: string[], edit: CasesEditIn) =>
  post<{ updated: string[]; errors: { key: string; error: string }[] }>("/api/zephyr/cases/edit", { project, keys, ...edit });

export const deleteCase = (key: string, project: string) =>
  fetchJson<{ deleted: string }>(`/api/zephyr/case/${encodeURIComponent(key)}?${q({ project })}`, { method: "DELETE" });

/** Тип данных при перетаскивании кейсов из списка в дерево. */
export const DRAG_CASES = "application/x-zephyr-cases";
