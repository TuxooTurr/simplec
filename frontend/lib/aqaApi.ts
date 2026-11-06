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
  /** Джоб автотестов в Jenkins: ссылка, логин и API-токен (маска, если есть). */
  jenkinsUrl: string;
  jenkinsOk: boolean;
  jenkinsUser: string;
  jenkinsToken: string;
  /** Все эпики роадмапа: закреплённые первыми, дальше свои. */
  epics: string[];
  /** Эпики, которые на роадмапе всегда: убрать их нельзя. */
  pinnedEpics?: string[];
  /** Ссылки по умолчанию: действуют, пока настройку не сохраняли; стёртая ссылка остаётся пустой. */
  defaults?: { bitbucketUrl: string; testopsUrl: string; jenkinsUrl: string };
}

export interface AqaCommit { id: string; hash: string; message: string; author: string; date: string; url: string }

/** Файл коммита: что с ним сделано и сколько строк добавлено и удалено; from — прежний путь у перенесённого. */
export interface AqaCommitFile {
  path: string; from: string; type: "added" | "modified" | "deleted" | "moved" | "copied";
  added: number; removed: number; binary: boolean;
}

/** Коммит подробно: полное сообщение, файлы (больше всего строк — сверху), свод по типам и расширениям. */
export interface AqaCommitDetails extends AqaCommit {
  email: string;
  /** merge-коммит: изменения — относительно первого родителя. */
  merge: boolean;
  files: AqaCommitFile[];
  /** Файлов больше, чем показано (первые 1000). */
  filesMore: boolean;
  /** Bitbucket обрезал большой diff — строки посчитаны не все. */
  truncated: boolean;
  totals: { files: number; added: number; removed: number; byType: Partial<Record<AqaCommitFile["type"], number>> };
  byExt: { ext: string; files: number; added: number; removed: number }[];
}

export interface AqaCommits {
  today: number;
  week: number;
  total: number;
  totalTruncated: boolean;
  last: AqaCommit | null;
  /** Последние коммиты ветки, новые сверху. */
  recent: AqaCommit[];
  /** Коммиты по дням за две недели, сегодня — последним. */
  daily: { date: string; count: number }[];
  /** Авторы за 7 дней, кто больше — выше. */
  authors: { name: string; count: number }[];
  /** Пусто — ветка по умолчанию. */
  branch: string;
  repoUrl: string;
  loadedAt: string;
}

export interface AqaBranches { branches: { name: string; default: boolean }[]; default: string; more: boolean }

/** Статус кейса → сколько: passed, failed, broken, skipped, unknown… */
export type AqaStats = Record<string, number>;

export interface AqaLaunch { id: number; name: string; date: string; closed: boolean; url: string; stats: AqaStats }

export interface AqaTestops {
  todayLaunches: number;
  todayStats: AqaStats;
  todayStatsPartial: boolean;
  last: AqaLaunch | null;
  /** Последние запуски, новые сверху. */
  recent: AqaLaunch[];
  projectUrl: string;
  loadedAt: string;
}

export interface AqaResult {
  id: number;
  name: string;
  /** passed / failed / broken / skipped / unknown */
  status: string;
  /** мс */
  duration: number;
  message: string;
  assignee: string;
  testCaseId: number | null;
  /** Тест-кейс в TestOps; пусто — нет. */
  url: string;
  /** Эпик, фича и стори; null — в списке их нет, спросить через getAqaBehaviors. */
  behavior: AqaBehavior | null;
}

export interface AqaBehavior { epic?: string; feature?: string; story?: string }
export interface AqaAttachment { id: number; name: string; type: string; size: number }
export interface AqaStep {
  name: string; status: string; duration: number; message: string; trace: string; parameters: string[];
  attachments: AqaAttachment[]; steps: AqaStep[];
  /** На этом шаге упало. */
  failed: boolean;
}
export interface AqaResultDetails {
  id: number; name: string; fullName: string; status: string; description: string; descriptionHtml: string;
  message: string; trace: string; parameters: string[]; behavior: AqaBehavior;
  steps: AqaStep[]; failedStep: string; attachments: AqaAttachment[];
  /** Почему шагов нет: сервер не отдал или их и не было. */
  stepsNote: string;
  url: string;
}
export interface AqaAttachmentContent { contentType: string; binary: boolean; text: string; truncated: boolean }

export interface AqaLaunchDetails extends AqaLaunch {
  createdBy: string;
  tags: string[];
  env: string[];
  /** мс от начала первого кейса до конца последнего; 0 — неизвестно. */
  duration: number;
  /** Упавшие и сломанные сверху. */
  results: AqaResult[];
  resultsTotal: number;
  resultsPartial: boolean;
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
  /** Плановое начало и окончание — поля Jira; пусто — поля нет или не заполнено. */
  planStart: string;
  planEnd: string;
  /** Фактическое закрытие (дата решения или переход в «готово»); пусто — не закрыта. */
  closed: string;
}

export type PlanField = { id: string; name: string } | null;
/**
 * Поля плановых дат: start / end — откуда взято больше всего дат; candidates — все подошедшие по названию
 * (дата берётся из первого непустого); filled — у скольких задач из total дата нашлась.
 */
export interface PlanFields {
  start: PlanField; end: PlanField;
  candidates?: { start: { id: string; name: string }[]; end: { id: string; name: string }[] };
  filled?: { start: number; end: number };
  total?: number;
}
export interface AqaRoadmap {
  epics: AqaEpic[]; planFields?: PlanFields; loadedAt: string;
  /** Jira недоступна — показан последний сохранённый снимок (в том числе из резервной копии). */
  snapshot?: { savedAt: string; reason: string };
}

export interface AqaEpic extends Partial<AqaIssue> {
  key: string;
  missing?: boolean;
  issues: AqaIssue[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export const getAqaSettings = () => fetchJson<AqaSettings>("/api/aqa/settings");
/** Поля Jenkins необязательны: с графика роадмапа сохраняются только эпики, Jenkins при этом не меняется. */
export const saveAqaSettings = (s: Omit<AqaSettings, "bitbucketOk" | "testopsOk" | "jenkinsOk" | "defaults" | "pinnedEpics" | "jenkinsUrl" | "jenkinsUser" | "jenkinsToken">
  & Partial<Pick<AqaSettings, "jenkinsUrl" | "jenkinsUser" | "jenkinsToken">>) =>
  fetchJson<AqaSettings>("/api/aqa/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(s) });
export const bitbucketTokenFromLogin = (login: string, password: string) =>
  fetchJson<{ status: string }>("/api/aqa/bitbucket/token-from-login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ login, password }) });
const qs = (p: Record<string, string | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, String(v));
  const t = q.toString();
  return t ? `?${t}` : "";
};

export const getAqaBranches = (filter = "", refresh = false) => fetchJson<AqaBranches>(`/api/aqa/branches${qs({ filter, refresh })}`);
export const getAqaCommits = (branch = "", refresh = false) => fetchJson<AqaCommits>(`/api/aqa/commits${qs({ branch, refresh })}`);
export const getAqaTestops = (refresh = false) => fetchJson<AqaTestops>(`/api/aqa/testops${qs({ refresh })}`);
export const getAqaResult = (id: number) => fetchJson<AqaResultDetails>(`/api/aqa/testops/result/${id}`);
export const getAqaAttachment = (id: number) => fetchJson<AqaAttachmentContent>(`/api/aqa/testops/attachment/${id}`);
export const getAqaBehaviors = (ids: number[]) =>
  fetchJson<{ behaviors: Record<string, AqaBehavior>; partial: boolean }>("/api/aqa/testops/behaviors", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ids }) });
export const getAqaLaunch = (id: number, refresh = false) => fetchJson<AqaLaunchDetails>(`/api/aqa/testops/launch/${id}${qs({ refresh })}`);
/** Строка diff с одной стороны: номер строки, текст, что с ней (удалена слева, добавлена справа, без изменений). */
export interface DiffLine { n: number | null; text: string; type: "removed" | "added" | "context" }
/** Файл коммита построчно: куски строк «было» (l) и «стало» (r) рядом; null — пустая сторона. */
export interface AqaFileDiff { path: string; binary: boolean; truncated: boolean; hunks: { l: DiffLine | null; r: DiffLine | null }[][] }
export const getAqaCommitDiff = (hash: string, path: string, src = "") =>
  fetchJson<AqaFileDiff>(`/api/aqa/commit/${encodeURIComponent(hash)}/diff${qs({ path, src: src || undefined })}`);
export const getAqaCommit = (hash: string) => fetchJson<AqaCommitDetails>(`/api/aqa/commit/${encodeURIComponent(hash)}`);
export const getAqaRoadmap = (refresh = false) => fetchJson<AqaRoadmap>(`/api/aqa/roadmap${qs({ refresh })}`);

/** Задача для окна правки. editable.planStart/planEnd — название поля Jira, куда уйдёт дата; null — поля нет на экране. */
export interface AqaIssueDetails extends AqaIssue {
  description: string;
  assigneeLogin: string;
  priorityId: string;
  priorities: { id: string; name: string }[];
  editable: { summary: boolean; description: boolean; priority: boolean; planStart: string | null; planEnd: string | null };
}
/** Что поменять. Нет поля — не трогать; пустая строка — очистить (дату, исполнителя). priority — id. */
export type AqaIssueChange = Partial<Record<"summary" | "description" | "priority" | "assignee" | "planStart" | "planEnd", string>>;

export const getAqaIssue = (key: string) => fetchJson<AqaIssueDetails>(`/api/aqa/issue/${encodeURIComponent(key)}`);
export const updateAqaIssue = (key: string, change: AqaIssueChange) =>
  fetchJson<{ status: string; warnings: string[] }>(`/api/aqa/issue/${encodeURIComponent(key)}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(change) });

/* ── Запуск автотестов (Jenkins) ──────────────────────────────────────────── */

/** Параметр джоба: вид поля строится по нему. password и file — без значения по умолчанию. */
export interface JenkinsParam {
  name: string; kind: "string" | "multiline" | "boolean" | "choice" | "password" | "file";
  description: string; default: string | boolean; choices: string[];
}
/** result: RUNNING, SUCCESS, FAILURE, UNSTABLE, ABORTED. */
export interface JenkinsBuild { number: number; url: string; title: string; result: string; started: string; duration: number }
export interface JenkinsJob { name: string; url: string; buildable: boolean; params: JenkinsParam[]; builds: JenkinsBuild[] }
/** Запуск в очереди. slow — окно перестало ждать; gone — Jenkins уже забыл запись или не дал её номер. */
export interface JenkinsQueue { state: "queued" | "started" | "cancelled" | "gone" | "slow"; why?: string; number?: number; url?: string }

export const getJenkinsJob = () => fetchJson<JenkinsJob>("/api/aqa/jenkins/job");
export const runJenkins = (params: Record<string, string | boolean>) =>
  fetchJson<{ status: string; queueId: number | null }>("/api/aqa/jenkins/run", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ params }) });
export const getJenkinsQueue = (id: number) => fetchJson<JenkinsQueue>(`/api/aqa/jenkins/queue/${id}`);

/* ── Даты задачи на таймлайне ─────────────────────────────────────────────
   Полоса — от планового начала до планового окончания (нет полей — создание и срок). Не закрыта к плановому
   окончанию — там точка, а полоса тянется дальше: до фактического закрытия, не закрыта — до сегодня. */

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type SpanFields = Pick<AqaIssue, "created" | "due" | "resolved" | "statusCategory"> & Partial<Pick<AqaIssue, "planStart" | "planEnd" | "closed">>;

export interface IssueSpan {
  start: string;
  /** Плановое окончание (или срок); пусто — плана нет, полоса до закрытия или сегодня. */
  planEnd: string;
  /** Конец полосы: плановое окончание, а при опоздании — фактическое закрытие или сегодня. */
  end: string;
  done: boolean;
  /** Фактическое закрытие; пусто — не закрыта. */
  closed: string;
  /** Плановое окончание прошло без закрытия: закрыта позже — нарушение срока, не закрыта — просрочена. */
  late: boolean;
}

export const planStartOf = (i: SpanFields) => i.planStart || i.created;
export const planEndOf = (i: SpanFields) => i.planEnd || i.due;
export const closedOf = (i: SpanFields) => (i.statusCategory === "done" ? i.closed || i.resolved : "");

export function issueSpan(i: SpanFields): IssueSpan | null {
  const start = planStartOf(i);
  if (!start) return null;
  const done = i.statusCategory === "done";
  const closed = closedOf(i);
  const planEnd = planEndOf(i) ? (planEndOf(i) < start ? start : planEndOf(i)) : "";
  const actual = done ? closed || planEnd || start : todayIso();
  const late = !!planEnd && actual > planEnd;
  const end = planEnd && !late ? planEnd : actual;
  return { start, planEnd, end: end < start ? start : end, done, closed, late };
}

/** Плановое окончание прошло, а задача не закрыта. */
export const isOverdue = (i: SpanFields) => i.statusCategory !== "done" && !!planEndOf(i) && planEndOf(i) < todayIso();
/** Закрыта позже планового окончания — нарушение срока. */
export const isLate = (i: SpanFields) => { const c = closedOf(i), e = planEndOf(i); return !!c && !!e && c > e; };
/** Дней между датами ГГГГ-ММ-ДД. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const fmtDay = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
