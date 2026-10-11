/**
 * Jira tool — списки задач для планирования и назначения.
 *
 * Итерация на моках: задачи и проекты — из мок-Jira (lib/jiraMock.ts), этапы —
 * lib/jiraStages.ts. Списки, свои поля, участники, сопоставление статусов,
 * созданные дефекты и сменённые статусы хранятся в браузере (localStorage).
 *
 * Модель:
 *   список    = проект + задачи (ключи) + колонки + группировка (до 3 уровней) + свои поля;
 *   колонка   = поле Jira («jira:<id>»), своё поле списка («own:<id>»), участник или этап;
 *   участники — общие на весь инструмент, у задачи в списке — один участник.
 */

import {
  ALL_FIELDS, DEFAULT_PROJECT, FIELD_BY_ID, MOCK_ISSUES, PRIORITIES, STATUS_ORDER, categoryOf, isBlocker, isResolvedDefect,
  projectFields, projectOf, type FieldValue, type Issue,
} from "./jiraMock";
import { STAGES, STAGE_LABEL, stageText, type StageInfo, type StageMapping } from "./jiraStages";

export * from "./jiraMock";

/* ── Свои поля, участники, списки ──────────────────────────────────────── */

export type OwnFieldType = "text" | "date" | "datetime" | "select" | "multiselect";

export const OWN_TYPE_LABEL: Record<OwnFieldType, string> = {
  text: "Свободный ввод",
  date: "Дата",
  datetime: "Дата и время",
  select: "Выпадающий список",
  multiselect: "Множественный выбор",
};

export interface OwnField {
  id: string;
  name: string;
  type: OwnFieldType;
  options: string[];
}

export interface Participant {
  id: string;
  name: string;
  role: string;
  color: string;
}

/** «jira:<id>» | «own:<id>» | «participant» | «stage» | «folder» | «defects» */
export type ColRef = string;
export const PARTICIPANT_COL: ColRef = "participant";
export const STAGE_COL: ColRef = "stage";
/** Папка из импортированной структуры (путь «Дефекты / Android»). */
export const FOLDER_COL: ColRef = "folder";
/** Сколько дефектов у эпика/стори/задачи — через Epic Link или связь. */
export const DEFECTS_COL: ColRef = "defects";
/** Есть ли среди неустранённых дефектов задачи блокирующие. */
export const BLOCK_COL: ColRef = "block";

/** Поля, которые считает SimpleTest: в списке полей у них пометка «st». */
export const ST_COLS: ColRef[] = [STAGE_COL, DEFECTS_COL, BLOCK_COL, PARTICIPANT_COL, FOLDER_COL];

export interface TaskList {
  id: string;
  name: string;
  /** Проект списка: от него зависят поля, поиск и создание дефекта. */
  project: string;
  keys: string[];
  columns: ColRef[];
  groupBy: ColRef[];
  ownFields: OwnField[];
  /** значения своих полей: ключ задачи → id поля → значение */
  values: Record<string, Record<string, string | string[]>>;
  /** участник задачи в этом списке: ключ задачи → id участника */
  assignees: Record<string, string>;
  /** папка задачи из импортированной структуры: ключ → путь */
  folders?: Record<string, string>;
  /** откуда импортирована структура */
  structure?: { id: number; name: string; importedAt: string };
  createdAt: string;
}

export interface ToolState {
  version: 2;
  lists: TaskList[];
  participants: Participant[];
  /** Дефекты, созданные в SimpleTest (в мок-режиме не уходят в Jira). */
  created: Issue[];
  nextKey: number;
  /** Сопоставление статусов с этапами; пусто — черновик по названиям статусов. */
  mapping: StageMapping;
  /** Статусы, сменённые в SimpleTest (мок-переходы): ключ → поля. */
  changed: Record<string, { status: string; resolution?: string | null; updated: string }>;
}

export const DEFAULT_COLUMNS: ColRef[] = ["jira:summary", "jira:issuetype", "jira:status", STAGE_COL, "jira:priority", PARTICIPANT_COL];

const PARTICIPANT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nextColor(participants: Participant[]): string {
  return PARTICIPANT_COLORS[participants.length % PARTICIPANT_COLORS.length];
}

export function emptyList(name: string, project = DEFAULT_PROJECT): TaskList {
  return {
    id: newId("lst"), name, project, keys: [], columns: [...DEFAULT_COLUMNS], groupBy: [],
    ownFields: [], values: {}, assignees: {}, createdAt: new Date().toISOString(),
  };
}

/** Стартовое состояние: два примера списков, чтобы сразу было что смотреть. */
function initialState(): ToolState {
  const participants: Participant[] = [
    { id: "ptc-1", name: "Иванов Илья", role: "QA", color: PARTICIPANT_COLORS[0] },
    { id: "ptc-2", name: "Петрова Анна", role: "QA", color: PARTICIPANT_COLORS[1] },
    { id: "ptc-3", name: "Сидоров Кирилл", role: "Разработка", color: PARTICIPANT_COLORS[2] },
  ];
  const defects = emptyList("Дефекты релиза 16/10");
  defects.keys = MOCK_ISSUES.filter(i => i.key.startsWith("SBER911-") && i.fields.issuetype === "Дефект"
    && String(i.fields.fixVersions ?? "").includes("16/10")).map(i => i.key);
  defects.groupBy = ["jira:status"];
  defects.ownFields = [
    { id: "own-retest", name: "Дата ретеста", type: "date", options: [] },
    { id: "own-env", name: "Стенд проверки", type: "select", options: ["ИФТ", "ПСИ", "Нагрузка"] },
  ];
  defects.columns = [...DEFAULT_COLUMNS, "own:own-retest", "own:own-env"];
  defects.keys.forEach((k, i) => { if (i % 3 !== 2) defects.assignees[k] = participants[i % participants.length].id; });

  const epics = emptyList("Эпики Sber911 — готовность");
  epics.keys = MOCK_ISSUES.filter(i => i.key.startsWith("SBER911-") && i.fields.issuetype === "Epic").map(i => i.key);
  epics.columns = ["jira:summary", "jira:status", STAGE_COL, DEFECTS_COL, BLOCK_COL, "jira:assignee", PARTICIPANT_COL];

  return { version: 2, lists: [defects, epics], participants, created: [], nextKey: 30001, mapping: {}, changed: {} };
}

const STORAGE_KEY = "st_jira_tool";

export function loadState(): ToolState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<ToolState> & { version: number };
      if (s && Array.isArray(s.lists)) {
        // v1 → v2: у списков появился проект, добавились сопоставление и сменённые статусы.
        return {
          version: 2,
          lists: s.lists.map(l => ({ ...l, project: l.project ?? DEFAULT_PROJECT })),
          participants: s.participants ?? [],
          created: s.created ?? [],
          nextKey: s.nextKey ?? 30001,
          mapping: s.mapping ?? {},
          changed: s.changed ?? {},
        };
      }
    }
  } catch { /* приватный режим или битые данные — начинаем заново */ }
  return initialState();
}

export function saveState(s: ToolState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* нет места — живём в памяти */ }
}

export function resetState(): ToolState {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return initialState();
}

/** Все задачи с учётом созданных в SimpleTest и сменённых статусов. */
export function effectiveIssues(s: ToolState): Issue[] {
  return [...MOCK_ISSUES, ...s.created].map(i => {
    const c = s.changed[i.key];
    return c ? { ...i, fields: { ...i.fields, status: c.status, resolution: c.resolution ?? i.fields.resolution, updated: c.updated } } : i;
  });
}

/* ── Колонки ───────────────────────────────────────────────────────────── */

/** Всё, что нужно колонкам помимо самой задачи. */
export interface ColCtx {
  list: TaskList;
  participants: Participant[];
  stageOf: (issue: Issue) => StageInfo;
  /** Дефекты задачи; null — у дефекта такого поля нет. */
  defectsOf: (issue: Issue) => Issue[] | null;
}

/** Дефекты задачи по индексу из defectIndex(); у самих дефектов — null. */
export function makeDefectsOf(index: Map<string, Issue[]>) {
  return (issue: Issue): Issue[] | null => (categoryOf(issue) === "defect" ? null : index.get(issue.key) ?? []);
}

/** Неустранённый дефект: всё, кроме «Подтверждено исправление» и «Закрыт». */
export function isOpenDefect(d: Issue): boolean {
  return !isResolvedDefect(d);
}

/** Неустранённые блокирующие дефекты задачи. */
export function blockersOf(defects: Issue[]): Issue[] {
  return defects.filter(d => isOpenDefect(d) && isBlocker(d));
}

export function colLabel(ref: ColRef, list: TaskList): string {
  if (ref === PARTICIPANT_COL) return "Участник (st)";
  if (ref === STAGE_COL) return "Статус (st)";
  if (ref === FOLDER_COL) return "Папка (st)";
  if (ref === DEFECTS_COL) return "Дефекты (st)";
  if (ref === BLOCK_COL) return "Блок (st)";
  if (ref.startsWith("jira:")) return FIELD_BY_ID[ref.slice(5)]?.name ?? ref.slice(5);
  if (ref.startsWith("own:")) return list.ownFields.find(f => f.id === ref.slice(4))?.name ?? "Удалённое поле";
  return ref;
}

/** Значение колонки задачи в виде списка строк (для группировки, сортировки и поиска). */
export function colValues(ref: ColRef, issue: Issue, ctx: ColCtx): string[] {
  let v: FieldValue | undefined;
  if (ref === PARTICIPANT_COL) {
    const p = ctx.participants.find(x => x.id === ctx.list.assignees[issue.key]);
    v = p ? p.name : null;
  } else if (ref === STAGE_COL) {
    v = stageText(ctx.stageOf(issue));
  } else if (ref === FOLDER_COL) {
    v = ctx.list.folders?.[issue.key] ?? null;
  } else if (ref === DEFECTS_COL) {
    // Сумма — неустранённые дефекты: ровно те, что видны в окне по умолчанию.
    const d = ctx.defectsOf(issue);
    v = d === null ? null : String(d.filter(isOpenDefect).length);
  } else if (ref === BLOCK_COL) {
    const d = ctx.defectsOf(issue);
    v = d === null ? null : blockersOf(d).length ? "Есть блокирующие" : "Нет";
  } else if (ref.startsWith("jira:")) {
    v = issue.fields[ref.slice(5)];
  } else if (ref.startsWith("own:")) {
    v = ctx.list.values[issue.key]?.[ref.slice(4)] ?? null;
  }
  if (v === null || v === undefined || v === "") return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

/** Порядок значений для сортировки и групп: статусы и этапы — по ходу процесса. */
export function orderIndex(ref: ColRef, value: string): number {
  if (ref === "jira:status") return STATUS_ORDER.indexOf(value);
  if (ref === "jira:priority") return PRIORITIES.indexOf(value);
  if (ref === STAGE_COL) {
    const i = STAGES.findIndex(s => STAGE_LABEL[s] === value);
    return i >= 0 ? i : value === "Нет сторей" ? -2 : -1;
  }
  return -1;
}

/** Поля для выбора колонок: только поля проекта списка («используются в проекте»). */
export function listFields(list: TaskList) {
  return projectFields(list.project);
}

/** Переставить item перед/после target (порядок строк и колонок при перетаскивании). */
export function moveItem<T>(arr: T[], item: T, target: T, place: "before" | "after"): T[] {
  if (item === target || !arr.includes(item) || !arr.includes(target)) return arr;
  const rest = arr.filter(x => x !== item);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/* ── Группировка до 3 уровней ──────────────────────────────────────────── */

export const EMPTY_GROUP = "— не задано";

/** Уровень группы, в которой лежит строка: по какому полю и какое значение. */
export interface GroupLevel { ref: ColRef; label: string }

/**
 * Можно ли менять значение поля переносом задачи между группами: только поля SimpleTest,
 * которые хранятся у нас, — участник, папка и свои поля списка. Вычисляемые (статус, дефекты,
 * блок) и поля Jira так не меняются.
 */
export function isWritableGroupRef(ref: ColRef, list: TaskList): boolean {
  if (ref === PARTICIPANT_COL || ref === FOLDER_COL) return true;
  return ref.startsWith("own:") && list.ownFields.some(f => f.id === ref.slice(4));
}

/** Применить перенос задачи в другую группу: записать новые значения полей. */
export function applyGroupMove(list: TaskList, participants: Participant[], key: string,
                               changes: { ref: ColRef; from: string; to: string }[]): TaskList {
  let l = list;
  for (const { ref, from, to } of changes) {
    const empty = to === EMPTY_GROUP;
    if (ref === PARTICIPANT_COL) {
      const a = { ...l.assignees };
      const p = participants.find(x => x.name === to);
      if (empty || !p) delete a[key]; else a[key] = p.id;
      l = { ...l, assignees: a };
    } else if (ref === FOLDER_COL) {
      const f = { ...l.folders };
      if (empty) delete f[key]; else f[key] = to;
      l = { ...l, folders: f };
    } else if (ref.startsWith("own:")) {
      const id = ref.slice(4);
      const field = l.ownFields.find(x => x.id === id);
      if (!field) continue;
      const cur = l.values[key]?.[id];
      let next: string | string[];
      if (field.type === "multiselect") {
        // Задача лежит в группе каждого значения: убираем то, откуда тянули, и добавляем, куда бросили.
        const arr = (Array.isArray(cur) ? cur : []).filter(x => x !== from);
        next = empty ? arr : Array.from(new Set([...arr, to]));
      } else {
        next = empty ? "" : to;
      }
      l = { ...l, values: { ...l.values, [key]: { ...l.values[key], [id]: next } } };
    }
  }
  return l;
}

export interface GroupNode {
  label: string;
  field: string;
  ref: ColRef;
  path: string;
  issues: Issue[];
  children: GroupNode[];
}

/**
 * Задача с несколькими значениями (компоненты, метки) попадает в группу
 * каждого значения — как в доске Jira «по компонентам».
 */
export function groupIssues(issues: Issue[], levels: ColRef[], ctx: ColCtx, parentPath = ""): GroupNode[] {
  if (!levels.length) return [];
  const [ref, ...rest] = levels;
  const buckets = new Map<string, Issue[]>();
  for (const issue of issues) {
    const vals = colValues(ref, issue, ctx);
    for (const v of vals.length ? vals : [EMPTY_GROUP]) {
      if (!buckets.has(v)) buckets.set(v, []);
      buckets.get(v)!.push(issue);
    }
  }
  // Первый уровень по участнику или своему списку — показываем и пустые группы:
  // иначе задачу не перетащить на участника, у которого ещё нет задач.
  if (!parentPath) {
    const known = ref === PARTICIPANT_COL ? ctx.participants.map(p => p.name)
      : ref.startsWith("own:") ? (ctx.list.ownFields.find(f => f.id === ref.slice(4))?.options ?? []) : [];
    for (const v of known) if (!buckets.has(v)) buckets.set(v, []);
  }
  const order = (a: string, b: string) => {
    if (a === EMPTY_GROUP) return 1;
    if (b === EMPTY_GROUP) return -1;
    const ia = orderIndex(ref, a), ib = orderIndex(ref, b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b, "ru");
  };
  return [...buckets.keys()].sort(order).map(label => {
    const path = `${parentPath}/${ref}=${label}`;
    const items = buckets.get(label)!;
    return { label, field: colLabel(ref, ctx.list), ref, path, issues: items, children: groupIssues(items, rest, ctx, path) };
  });
}

/* ── Поиск: по номеру и JQL ────────────────────────────────────────────── */

/** «SBER911-29210, 29211 pkap-1500» → ключи задач; голый номер — из проекта списка. */
export function parseKeys(text: string, project = DEFAULT_PROJECT): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim().toUpperCase();
    if (!t) continue;
    if (/^\d+$/.test(t)) out.push(`${project}-${t}`);
    else if (/^[A-Z][A-Z0-9_]*-\d+$/.test(t)) out.push(t);
  }
  return Array.from(new Set(out));
}

export class JqlError extends Error {}

type Tok = { t: "word" | "str" | "op" | "lp" | "rp" | "comma"; v: string };

function tokenize(q: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { toks.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", v: c }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma", v: c }); i++; continue; }
    if (c === '"' || c === "'") {
      const end = q.indexOf(c, i + 1);
      if (end < 0) throw new JqlError("Не закрыта кавычка");
      toks.push({ t: "str", v: q.slice(i + 1, end) }); i = end + 1; continue;
    }
    const op = /^(!=|!~|>=|<=|=|~|>|<)/.exec(q.slice(i));
    if (op) { toks.push({ t: "op", v: op[1] }); i += op[1].length; continue; }
    const w = /^[^\s()",'=!~<>]+/.exec(q.slice(i));
    if (!w) throw new JqlError(`Непонятный символ «${c}»`);
    toks.push({ t: "word", v: w[0] }); i += w[0].length;
  }
  return toks;
}

const ALIASES: Record<string, string> = {
  type: "issuetype", component: "components", fixversion: "fixVersions", label: "labels",
  "epic link": "customfield_10006", due: "duedate", text: "text", key: "key", issuekey: "key", project: "project",
};

function resolveField(name: string): string {
  const n = name.trim();
  const low = n.toLowerCase();
  if (ALIASES[low]) return ALIASES[low];
  const cf = /^cf\[(\d+)\]$/i.exec(n);
  if (cf) return `customfield_${cf[1]}`;
  const f = ALL_FIELDS.find(x => x.id.toLowerCase() === low || x.name.toLowerCase() === low);
  if (f) return f.id;
  throw new JqlError(`Поле «${n}» не найдено. В моке есть: ${ALL_FIELDS.map(x => x.name).slice(0, 8).join(", ")}…`);
}

function issueValues(issue: Issue, field: string): string[] {
  if (field === "key") return [issue.key];
  if (field === "project") return [issue.key.split("-")[0], projectOf(issue.key.split("-")[0]).name];
  if (field === "text") return [String(issue.fields.summary ?? ""), String(issue.fields.description ?? "")];
  const v = issue.fields[field];
  if (v === null || v === undefined || v === "") return [];
  return Array.isArray(v) ? v : [v];
}

/** «-7d», «-2w», «2026-10-01» → время в мс. */
function dateArg(v: string): number {
  const rel = /^-?(\d+)([dwh])$/.exec(v.trim());
  if (rel) {
    const mult = rel[2] === "w" ? 7 * 86400000 : rel[2] === "h" ? 3600000 : 86400000;
    return Date.now() - Number(rel[1]) * mult;
  }
  const t = Date.parse(v.replace(" ", "T"));
  if (Number.isNaN(t)) throw new JqlError(`Не дата: «${v}». Пример: -7d или 2026-10-01`);
  return t;
}

type Pred = (issue: Issue) => boolean;

/**
 * Небольшой разбор JQL для мок-режима: = != ~ !~ > < >= <=, in / not in,
 * is EMPTY / is not EMPTY, AND / OR / NOT, скобки, ORDER BY (игнорируется).
 * Значения: currentUser(), EMPTY. На реальной Jira запрос уйдёт как есть.
 */
export function compileJql(query: string, me = "Иванов Илья"): Pred {
  const q = query.replace(/\border\s+by\b[\s\S]*$/i, "").trim();
  if (!q) return () => true;
  const toks = tokenize(q);
  let pos = 0;
  const peek = () => toks[pos];
  const word = (w: string) => peek()?.t === "word" && peek()!.v.toLowerCase() === w;
  const value = (): string => {
    const t = toks[pos++];
    if (!t || (t.t !== "word" && t.t !== "str")) throw new JqlError("Ожидалось значение");
    if (t.t === "word" && t.v.toLowerCase() === "currentuser()") return me;
    return t.v;
  };

  const cond = (): Pred => {
    if (peek()?.t === "lp") {
      pos++;
      const inner = orExpr();
      if (toks[pos++]?.t !== "rp") throw new JqlError("Не закрыта скобка");
      return inner;
    }
    if (word("not")) { pos++; const p = cond(); return i => !p(i); }
    const fTok = toks[pos++];
    if (!fTok || (fTok.t !== "word" && fTok.t !== "str")) throw new JqlError("Ожидалось имя поля");
    const field = resolveField(fTok.v);
    const isDate = ["date", "datetime"].includes(FIELD_BY_ID[field]?.kind ?? "");

    if (word("is")) {
      pos++;
      const neg = word("not") ? (pos++, true) : false;
      const v = value().toLowerCase();
      if (v !== "empty" && v !== "null") throw new JqlError("После is — EMPTY или NULL");
      return i => (issueValues(i, field).length === 0) !== neg;
    }
    if (word("in") || word("not")) {
      const neg = word("not") ? (pos++, true) : false;
      if (!word("in")) throw new JqlError("Ожидалось in");
      pos++;
      if (toks[pos++]?.t !== "lp") throw new JqlError("После in — список в скобках");
      const vals: string[] = [];
      while (peek() && peek()!.t !== "rp") {
        vals.push(value().toLowerCase());
        if (peek()?.t === "comma") pos++;
      }
      pos++;
      return i => issueValues(i, field).some(x => vals.includes(x.toLowerCase())) !== neg;
    }
    const opTok = toks[pos++];
    if (!opTok || opTok.t !== "op") throw new JqlError(`После «${fTok.v}» ожидалось = != ~ in is`);
    const raw = value();
    const v = raw.toLowerCase();
    switch (opTok.v) {
      case "=":  return v === "empty" ? i => !issueValues(i, field).length : i => issueValues(i, field).some(x => x.toLowerCase() === v);
      case "!=": return i => !issueValues(i, field).some(x => x.toLowerCase() === v);
      case "~":  return i => issueValues(i, field).some(x => x.toLowerCase().includes(v));
      case "!~": return i => !issueValues(i, field).some(x => x.toLowerCase().includes(v));
      default: {
        if (!isDate) throw new JqlError(`Сравнение ${opTok.v} в моке работает только для дат`);
        const t = dateArg(raw);
        const cmp = { ">": (a: number) => a > t, "<": (a: number) => a < t, ">=": (a: number) => a >= t, "<=": (a: number) => a <= t }[opTok.v]!;
        return i => issueValues(i, field).some(x => cmp(Date.parse(x.replace(" ", "T"))));
      }
    }
  };
  const andExpr = (): Pred => {
    let left = cond();
    while (word("and")) { pos++; const l = left, r = cond(); left = i => l(i) && r(i); }
    return left;
  };
  const orExpr = (): Pred => {
    let left = andExpr();
    while (word("or")) { pos++; const l = left, r = andExpr(); left = i => l(i) || r(i); }
    return left;
  };
  const pred = orExpr();
  if (pos < toks.length) throw new JqlError(`Лишнее в запросе: «${toks[pos].v}»`);
  return pred;
}

export function jqlExamples(project: string): string[] {
  const p = projectOf(project);
  return [
    `project = ${p.key} AND issuetype = Дефект AND status in ("Открыт", "Переоткрыт")`,
    `project = ${p.key} AND issuetype = Epic`,
    `"Epic Link" = ${p.key === "SBER911" ? "SBER911-28044" : p.key === "PKAP" ? "PKAP-1200" : "MONIT-310"}`,
    `project = ${p.key} AND fixVersion = "${p.versions[0]}" ORDER BY priority`,
    `project = ${p.key} AND assignee is EMPTY AND created >= -14d`,
  ];
}

/* ── Генерация, если LLM недоступна ────────────────────────────────────── */

/** Пример результата генерации для демо: структура как у настоящего баг-репорта. */
export function mockGenerated(text: string, platform: string): { title: string; description: string; priority: string } {
  const first = text.trim().split(/[.\n!?]/)[0].trim() || "Ошибка без описания";
  const title = `[${platform}] ${first.charAt(0).toUpperCase()}${first.slice(1)}`.slice(0, 120);
  const description = [
    "## Предусловия", "Пользователь авторизован, открыт нужный раздел.", "",
    "## Шаги воспроизведения", "1. Выполнить действие, описанное ниже", "2. Посмотреть результат", "",
    "## Фактический результат", text.trim(), "",
    "## Ожидаемый результат", "Система работает по требованиям, ошибки нет.", "",
    "## Окружение", "ИФТ",
  ].join("\n");
  return { title, description, priority: "Средний" };
}
