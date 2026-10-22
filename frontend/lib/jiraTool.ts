/**
 * Jira tool — списки задач для планирования и назначения.
 *
 * Задачи, поля и статусы — из настоящей Jira (lib/jiraToolApi.ts, модель — lib/jiraModel.ts),
 * этапы — lib/jiraStages.ts. Списки, свои поля, участники, трудозатраты, сопоставление
 * статусов и черновики задач хранятся в браузере (localStorage).
 *
 * Модель:
 *   список    = проект + задачи (ключи) + колонки + группировка (до 3 уровней) + свои поля;
 *   колонка   = поле Jira («jira:<id>»), своё поле списка («own:<id>»), участник или этап;
 *   участники — общие на весь инструмент, у задачи в списке — один участник.
 */

import {
  DEFAULT_PROJECT, FIELD_BY_ID, PRIORITIES, STATUS_ORDER, SYSTEM_FIELD_IDS, categoryOf, isBlocker, isResolvedDefect,
  projectKeyOfIssue,
  type FieldValue, type Issue, type JiraFieldDef,
} from "./jiraModel";
import type { PersonFieldChange } from "./jiraToolApi";
import { STAGES, STAGE_LABEL, isReleaseOrLater, stageDot, stageText, type CustomStage, type Stage, type StageInfo, type StageMapping, type StageStyles } from "./jiraStages";

export * from "./jiraModel";

/* ── Свои поля, участники, списки ──────────────────────────────────────── */

export type OwnFieldType = "text" | "date" | "datetime" | "select" | "multiselect" | "link" | "rules";

export const OWN_TYPE_LABEL: Record<OwnFieldType, string> = {
  text: "Свободный ввод",
  date: "Дата",
  datetime: "Дата и время",
  select: "Выпадающий список",
  multiselect: "Множественный выбор",
  link: "Ссылка",
  rules: "По правилам",
};

/* ── Поле «По правилам»: значение вычисляется из других полей задачи ─────────────────────────────── */

/** Операторы условий — как в Excel (условное форматирование / фильтр). */
export type RuleOp = "eq" | "ne" | "contains" | "ncontains" | "starts" | "ends" | "gt" | "gte" | "lt" | "lte" | "empty" | "nempty";
export const RULE_OP_LABEL: Record<RuleOp, string> = {
  eq: "равно", ne: "не равно", contains: "содержит", ncontains: "не содержит", starts: "начинается с", ends: "заканчивается на",
  gt: "больше", gte: "больше или равно", lt: "меньше", lte: "меньше или равно", empty: "пусто", nempty: "не пусто",
};
/** Операторы без значения. */
export const RULE_OP_NO_VALUE: RuleOp[] = ["empty", "nempty"];

/** Условие: поле задачи (любая колонка списка), оператор, значение. */
export interface RuleCond { ref: ColRef; op: RuleOp; value: string }
/** Что показать, если правило сработало: текст, символ или эмодзи перед ним, ссылка (текст становится ссылкой). */
export interface RuleResult { text: string; icon?: string; link?: string }
/** Правило: все условия через «И» → результат. */
export interface FieldRule { id: string; conds: RuleCond[]; result: RuleResult }

/** «12,5» / «12.5» → число; «2026-10-22» / «22.10.2026» / «22.10.2026 10:00» → время; иначе null. */
function ruleNumber(s: string): number | null {
  const t = s.trim();
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  return null;
}

/**
 * Условие для значений поля (у поля бывает несколько значений — метки, микросервисы). Положительные операторы —
 * «хотя бы одно значение подходит», «не равно» и «не содержит» — «ни одно не подходит». Текст — без регистра;
 * «больше/меньше» — как числа или даты, если обе стороны похожи на них, иначе по алфавиту.
 */
export function condMatches(values: string[], c: RuleCond): boolean {
  const vals = values.map(v => String(v).trim()).filter(Boolean);
  if (c.op === "empty") return vals.length === 0;
  if (c.op === "nempty") return vals.length > 0;
  const want = c.value.trim().toLowerCase();
  const one = (raw: string): boolean => {
    const v = raw.toLowerCase();
    switch (c.op) {
      case "eq": case "ne": {
        const a = ruleNumber(raw), b = ruleNumber(c.value);
        return a !== null && b !== null ? a === b : v === want;
      }
      case "contains": case "ncontains": return v.includes(want);
      case "starts": return v.startsWith(want);
      case "ends": return v.endsWith(want);
      default: {
        const a = ruleNumber(raw), b = ruleNumber(c.value);
        const d = a !== null && b !== null ? a - b : v.localeCompare(want, "ru");
        return c.op === "gt" ? d > 0 : c.op === "gte" ? d >= 0 : c.op === "lt" ? d < 0 : d <= 0;
      }
    }
  };
  if (c.op === "ne" || c.op === "ncontains") return !vals.some(one);
  return vals.some(one);
}

let ruleDepth = 0;
/** Значение поля «По правилам» для задачи: первое правило, у которого выполнены все условия; иначе — «иначе». */
export function ruleResult(field: OwnField, issue: Issue, ctx: ColCtx): RuleResult | null {
  if (ruleDepth > 3) return null;          // поля по правилам, ссылающиеся друг на друга, — не уходим в цикл
  ruleDepth++;
  try {
    for (const r of field.rules ?? []) {
      if (r.conds.length && r.conds.every(c => c.ref !== `own:${field.id}` && condMatches(colValues(c.ref, issue, ctx), c))) return r.result;
    }
    return field.fallback?.text || field.fallback?.icon ? field.fallback : null;
  } finally { ruleDepth--; }
}

/**
 * Ссылка из поля «Ссылка» → адрес для перехода. Без схемы («jira.sberbank.ru/browse/X») — https://.
 * Открываем только http(s): «javascript:» и прочие схемы из вставленного текста не исполняем.
 * null — не похоже на адрес (пробелы, нет точки в домене).
 */
export function linkHref(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  // Схема — только с «//» («https://…»); иначе «jira.ru:8080/x» приняли бы за схему «jira.ru:».
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch { return null; }
}

export interface OwnField {
  id: string;
  name: string;
  type: OwnFieldType;
  options: string[];
  /** Свободный ввод: true — переносить и показывать весь текст, иначе — обрезать многоточием. */
  wrap?: boolean;
  /** Список и множественный выбор: показывать значения цветными тегами. */
  tags?: boolean;
  /** Цвет тега по варианту («#rrggbb»); нет — цвет из палитры по порядку варианта. */
  colors?: Record<string, string>;
  /** «По правилам»: правила сверху вниз (срабатывает первое) и значение, если ни одно не подошло. */
  rules?: FieldRule[];
  fallback?: RuleResult;
}

/** Палитра тегов по умолчанию — по порядку вариантов. */
export const TAG_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0d9488", "#db2777", "#64748b", "#ea580c", "#0891b2"];

/** Цвет тега варианта: свой или из палитры по порядку. */
export function tagColor(field: OwnField, option: string): string {
  const own = field.colors?.[option];
  if (own && /^#[0-9a-f]{6}$/i.test(own)) return own;
  const i = Math.max(0, field.options.indexOf(option));
  return TAG_COLORS[i % TAG_COLORS.length];
}

/**
 * Человек из справочника (хранится на бэкенде: /api/people, data/people.json). Тестировщики — направление «testing»,
 * остальные направления — поля направлений в строке задачи.
 */
export interface Participant {
  id: string;
  name: string;
  /** Должность — аббревиатура до 3 символов (QA, AQA, BE, BA…): видна в цветной метке у ФИО. */
  role: string;
  color: string;
  /** Направления, в которых человек работает (DIRECTIONS). Нет — старая запись участника: это тестировщик. */
  directions?: string[];
  /** Логин в Jira: его пишем в поле Jira направления при назначении. В списках не показывается — только в справочнике. */
  jiraName?: string;
  /** Как человека показывает Jira (из поиска пользователей); для текстового поля Jira пишется оно. */
  jiraDisplay?: string;
}

export const ROLE_SUGGESTIONS = ["QA", "AQA", "LQA", "SQA", "DEV", "BA", "SA", "PM", "TL", "OPS"];

/** Должность → не длиннее 3 символов, заглавными. «Разработка» → «РАЗ». */
export function normRole(role: string): string {
  return role.trim().toUpperCase().slice(0, 3);
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
/** Трудозатраты: план (вводится), начало и конец теста (дата и время), факт = конец − начало. */
export const PLAN_COL: ColRef = "plan";
export const START_COL: ColRef = "test_start";
export const END_COL: ColRef = "test_end";
export const FACT_COL: ColRef = "fact";
export const SPEND_COLS: ColRef[] = [PLAN_COL, START_COL, END_COL, FACT_COL];

/**
 * Поля направлений (st): кто ведёт задачу в аналитике, дизайне, бэке и т.д. и в каком она там состоянии.
 * В ячейке — фамилия (список фамилий у каждого поля свой, общий на все списки) и цвет состояния.
 */
export const ROLE_FIELDS: { id: string; label: string }[] = [
  { id: "analytics", label: "Analytics" },
  { id: "design", label: "Design" },
  { id: "back", label: "Back-end" },
  { id: "front", label: "Front-end" },
  { id: "mobile", label: "Mobile" },
  { id: "dev", label: "DevOps" },
  { id: "sup", label: "Support" },
];

/** Направления нагрузки: тестирование (колонка «Тестировщик» + «Траты план») и поля направлений. */
export const TESTING = "testing";
export const DIRECTIONS: { id: string; label: string }[] = [{ id: TESTING, label: "Testing" }, ...ROLE_FIELDS];
/** Метка по умолчанию для человека, перенесённого из старого списка фамилий направления. */
export const DIRECTION_ROLE: Record<string, string> = {
  testing: "QA", analytics: "BA", design: "DES", back: "BE", front: "FE", mobile: "MOB", dev: "OPS", sup: "SUP",
};

/** Работает ли человек в направлении. Старая запись участника (направления не заданы вовсе) — тестировщик. */
export function inDirection(p: Participant, dir: string): boolean {
  return p.directions ? p.directions.includes(dir) : dir === TESTING;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Перенос в справочник того, что раньше жило в браузере: участники становятся тестировщиками (если направления
 * не заданы), фамилии из списков направлений — людьми этих направлений. Одна фамилия в нескольких направлениях —
 * один человек с несколькими направлениями.
 */
export function migratePeople(participants: Participant[], roleNames: Record<string, string[]>): Participant[] {
  const out: Participant[] = participants.map(p => ({ ...p, directions: p.directions ? [...p.directions] : [TESTING] }));
  for (const [dir, names] of Object.entries(roleNames)) {
    for (const n of names) {
      if (!n.trim()) continue;
      const hit = out.find(p => sameName(p.name, n));
      if (hit) { if (!hit.directions!.includes(dir)) hit.directions!.push(dir); continue; }
      out.push({ id: newId("ptc"), name: n.trim(), role: DIRECTION_ROLE[dir] ?? "", color: nextColor(out), directions: [dir] });
    }
  }
  return out;
}
export const roleCol = (id: string): ColRef => `role:${id}`;
export const ROLE_COLS: ColRef[] = ROLE_FIELDS.map(f => roleCol(f.id));
export const isRoleCol = (ref: ColRef) => ref.startsWith("role:");

/** Состояние работы по направлению: серый — не взят, жёлтый — в работе, зелёный — выполнен. */
export type RoleState = "todo" | "doing" | "done";
export const ROLE_STATES: RoleState[] = ["todo", "doing", "done"];
export const ROLE_STATE_LABEL: Record<RoleState, string> = { todo: "Не взят в работу", doing: "В работе", done: "Выполнен" };
/**
 * Значение поля направления: человек (pid — id из справочника; name — его имя на момент выбора, для старых записей
 * и файлов экспорта), состояние и план трудозатрат в минутах.
 */
export interface RoleValue { name?: string; pid?: string; state?: RoleState; plan?: number }

/** Учитывать ли задачу в нагрузке участника (галочка в строке; авто — по статусу (st)). */
export const LOAD_COL: ColRef = "load";
/** Требования из раздела «Данные», привязанные к задаче (хранятся у SimpleTest, общие на все списки). */
export const REQ_COL: ColRef = "reqs";
/** Микросервисы задачи (справочник микросервисов SimpleTest — тот же, что на графике стендов); общие на все списки. */
export const MS_COL: ColRef = "ms";

export const ST_COLS: ColRef[] = [STAGE_COL, DEFECTS_COL, BLOCK_COL, PARTICIPANT_COL, ...ROLE_COLS, ...SPEND_COLS, LOAD_COL, REQ_COL, MS_COL, FOLDER_COL];

/**
 * Норма по умолчанию для расчёта нагрузки: будни 9:00–18:00 минус час обеда и час утренних встреч —
 * 7 часов в день. Праздники пока не учитываются. Человек меняет норму в настройке нагрузки (LoadSettings).
 */
export const LOAD_DAY_MINUTES = 7 * 60;

/**
 * Резерв — время, которое каждый рабочий день уходит не на задачи списка: например, час на автотесты.
 * Вычитается из нормы дня. Кому: конкретным людям, людям направлений (у каждой команды свои — встречи, автотесты)
 * или всем.
 */
export interface LoadReserve {
  id: string; name: string; minutes: number;
  /** Кому резерв: люди (id). Пусто — по направлениям, а если и они пусты — всем. */
  participants: string[];
  /** Направления (команды), у людей которых резерв: например, у тестирования — встречи и автотесты, у бэкенда — своё. */
  directions?: string[];
}

/** Резерв у всех, без выбора людей и направлений. */
export const isCommonReserve = (r: LoadReserve) => !r.participants.length && !r.directions?.length;

/** Настройка нагрузки — общая для всех списков: норма и резервы относятся к людям, а не к спискам. */
export interface LoadSettings { dayMinutes: number; reserves: LoadReserve[] }

export const DEFAULT_LOAD_SETTINGS: LoadSettings = { dayMinutes: LOAD_DAY_MINUTES, reserves: [] };

/** Резервы человека: общие, его направлений и личные. */
export function reservesOf(settings: LoadSettings, person: Participant): LoadReserve[] {
  return settings.reserves.filter(r => r.minutes > 0 && (
    r.participants.length ? r.participants.includes(person.id)
      : r.directions?.length ? r.directions.some(d => inDirection(person, d))
      : true));
}

/** Сколько минут в день у участника остаётся на задачи: норма минус его резервы (не меньше нуля). */
export function netDayMinutes(settings: LoadSettings, person: Participant): number {
  return Math.max(0, settings.dayMinutes - reservesOf(settings, person).reduce((n, r) => n + r.minutes, 0));
}

/** Рабочие дни (пн–пт) между датами включительно; даты — «ГГГГ-ММ-ДД». */
export function workdaysBetween(from: string, to: string): number {
  return calendarDays(from, to, false).days;
}

/**
 * Дни периода для нагрузки: weekends=false — только будни; true — и выходные (переработка), weekend — сколько из них
 * выходных, чтобы показать переработку отдельно, а не растворить её в ёмкости.
 */
export function calendarDays(from: string, to: string, weekends: boolean): { days: number; weekend: number } {
  const a = Date.parse(`${from}T00:00`), b = Date.parse(`${to}T00:00`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return { days: 0, weekend: 0 };
  let work = 0, off = 0;
  for (const d = new Date(a); d.getTime() <= b; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) off++; else work++;
  }
  return weekends ? { days: work + off, weekend: off } : { days: work, weekend: 0 };
}

/** Период нагрузки по умолчанию: две недели с сегодняшнего дня. */
export function defaultLoadRange(now = new Date()): { from: string; to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const to = new Date(now); to.setDate(to.getDate() + 13);
  return { from: iso(now), to: iso(to) };
}

export interface LoadRow {
  participant: Participant; planned: number; tasks: number; unplanned: number; capacity: number; over: boolean;
  /** Сколько плана приходится на выходные: план сверх ёмкости будней, когда выходные учитываются. */
  overtime: number;
  /** Резервы участника и сколько они забрали за период, мин. */
  reserves: LoadReserve[]; reserved: number;
  /** Задачи участника, не учтённые в нагрузке (вручную или по статусу). */
  skipped: number;
}

/**
 * Почему задача не в нагрузке: «manual» — сняли галочку в строке; «stage» — статус (st)
 * «Готово к релизу» и дальше (правило списка, по умолчанию включено); null — учитывается.
 * Ручная отметка важнее: например, протестировали, а задачу в Jira ещё не перевели.
 */
export type LoadSkip = "manual" | "stage" | null;

export function loadSkip(list: TaskList, issue: Issue | undefined, stageOf: (i: Issue) => StageInfo): LoadSkip {
  if (!issue) return null;
  if (list.noLoad?.[issue.key]) return "manual";
  if (list.loadAuto !== false && isReleaseOrLater(stageOf(issue))) return "stage";
  return null;
}

/**
 * Кто ведёт задачу в направлении и сколько у него плана: тестирование — «Тестировщик» и «Траты план (st)»;
 * остальные — поле направления (человек по id из справочника, у старых записей — по имени).
 */
export function directionAssignment(list: TaskList, dir: string, key: string, people: Participant[]): { pid?: string; plan?: number } {
  if (dir === TESTING) return { pid: list.assignees[key] || undefined, plan: list.spend?.[key]?.plan };
  const v = list.roles?.[key]?.[dir];
  if (!v) return {};
  const pid = v.pid && people.some(p => p.id === v.pid) ? v.pid
    : v.name ? people.find(p => sameName(p.name, v.name!) && inDirection(p, dir))?.id ?? people.find(p => sameName(p.name, v.name!))?.id
    : undefined;
  return { pid, plan: v.plan };
}

/** Нагрузка одного направления по списку. */
export interface DirectionLoad {
  id: string; label: string;
  rows: LoadRow[];
  planned: number; capacity: number;
  /** Задачи с человеком или планом в этом направлении, не учтённые в нагрузке (готовы к релизу и дальше / сняты руками). */
  skippedKeys: string[];
  /** План задач, у которых в направлении нет человека: время есть, повесить не на кого. */
  unassigned: { keys: string[]; plan: number };
  days: number; weekend: number;
}

/**
 * Нагрузка направления: у каждого человека направления (и у тех, кто стоит на задачах направления, хотя в справочнике
 * у него другое направление) — сумма плана учитываемых задач против нормы за период: дни × (норма дня − резервы).
 * Выходные (галочка списка) добавляют дни в ёмкость; план сверх ёмкости будней — переработка.
 */
export function directionLoad(list: TaskList, dir: { id: string; label: string }, people: Participant[], range: { from: string; to: string },
                              skip: (key: string) => LoadSkip = () => null, settings: LoadSettings = DEFAULT_LOAD_SETTINGS): DirectionLoad {
  const { days, weekend } = calendarDays(range.from, range.to, !!list.loadWeekends);
  const byPerson = new Map<string, string[]>();
  const skippedKeys: string[] = [];
  const unassigned = { keys: [] as string[], plan: 0 };
  for (const k of list.keys) {
    const a = directionAssignment(list, dir.id, k, people);
    if (!a.pid && a.plan == null) continue;
    if (skip(k)) { skippedKeys.push(k); continue; }
    if (!a.pid) { unassigned.keys.push(k); unassigned.plan += a.plan ?? 0; continue; }
    byPerson.set(a.pid, [...(byPerson.get(a.pid) ?? []), k]);
  }
  const members = people.filter(p => inDirection(p, dir.id) || byPerson.has(p.id));
  const rows = members.map(p => {
    const net = netDayMinutes(settings, p);
    const capacity = days * net;
    const keys = byPerson.get(p.id) ?? [];
    const plans = keys.map(k => directionAssignment(list, dir.id, k, people).plan);
    const planned = plans.reduce<number>((n, m) => n + (m ?? 0), 0);
    const all = list.keys.filter(k => directionAssignment(list, dir.id, k, people).pid === p.id);
    return {
      participant: p, planned, tasks: keys.length, capacity, over: planned > capacity, skipped: all.length - keys.length,
      overtime: weekend ? Math.max(0, Math.min(planned, capacity) - (days - weekend) * net) : 0,
      reserves: reservesOf(settings, p), reserved: days * settings.dayMinutes - capacity,
      unplanned: plans.filter(m => m == null).length,
    };
  }).sort((a, b) => (b.capacity ? b.planned / b.capacity : 0) - (a.capacity ? a.planned / a.capacity : 0) || b.planned - a.planned);
  return {
    id: dir.id, label: dir.label, rows, skippedKeys, unassigned, days, weekend,
    planned: rows.reduce((n, r) => n + r.planned, 0) + unassigned.plan,
    capacity: rows.reduce((n, r) => n + r.capacity, 0),
  };
}

/** Нагрузка тестировщиков по списку (виджет «Нагрузка по списку»). */
export function listLoad(list: TaskList, participants: Participant[], range: { from: string; to: string },
                         skip: (key: string) => LoadSkip = () => null, settings: LoadSettings = DEFAULT_LOAD_SETTINGS): LoadRow[] {
  return directionLoad(list, DIRECTIONS[0], participants, range, skip, settings).rows;
}

/** Трудозатраты задачи в списке: план в минутах, начало и конец теста — «ГГГГ-ММ-ДДTчч:мм». */
export interface Spend { plan?: number; start?: string; end?: string }

/**
 * Как показывать трудозатраты: «ч · мин» (100 → «1 ч 40 мин») или «д · ч · мин» (по норме рабочего дня из настроек
 * нагрузки: при 7 ч в дне 600 мин → «1 д 3 ч»). Переключатель — в Jira tool, выбор запоминается в браузере.
 */
export type TimeFmt = "hm" | "dhm";
const TIME_FMT_KEY = "st_time_fmt";
let timeFmt: TimeFmt = "hm";
let timeDay = LOAD_DAY_MINUTES;
try { if (localStorage.getItem(TIME_FMT_KEY) === "dhm") timeFmt = "dhm"; } catch { /* сервер или нет хранилища — ч · мин */ }

export const getTimeFmt = (): TimeFmt => timeFmt;
export function setTimeFmt(f: TimeFmt): void {
  timeFmt = f;
  try { localStorage.setItem(TIME_FMT_KEY, f); } catch { /* не запомнится */ }
}
/** Сколько минут в «дне» для «д · ч · мин» — норма дня из настроек нагрузки. */
export function setTimeDay(min: number): void { if (min > 0) timeDay = min; }
export const getTimeDay = (): number => timeDay;

/** Минуты → текст в выбранном формате; fmt "hm" — всегда часы и минуты (нормы и резервы «в день»). */
export function fmtMinutes(min: number, fmt: TimeFmt = timeFmt, day: number = timeDay): string {
  let m = Math.round(Math.abs(min));
  const parts: string[] = [];
  if (fmt === "dhm" && day > 0 && m >= day) {
    parts.push(`${Math.floor(m / day)} д`);
    m %= day;
  }
  const h = Math.floor(m / 60), r = m % 60;
  if (h) parts.push(`${h} ч`);
  if (r || !parts.length) parts.push(`${r} мин`);
  const text = parts.join(" ");
  return min < 0 ? `−${text}` : text;
}

/**
 * Ввод времени → минуты. Часы: «1.5», «1,5», «1:40», «1 ч 40 мин»; минуты: «100»; дни: «1 д 2 ч 30 мин»,
 * а в единице «д» — «1.5» (дни считаются по норме дня). null — не разобрать.
 */
export function parseDuration(text: string, unit: "h" | "m" | "d", day: number = timeDay): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const hm = /^(\d+):(\d{1,2})$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  // \w в JS не ловит кириллицу — поэтому явный набор букв («д», «дн», «ч», «час», «мин», «d», «h», «m»).
  const words = /^(?:(\d+(?:\.\d+)?)\s*(?:д[а-яё]*|d\w*))?\s*(?:(\d+(?:\.\d+)?)\s*(?:ч[а-яё]*|h\w*))?\s*(?:(\d+)\s*(?:м[а-яё]*|m\w*))?$/.exec(t);
  if (words && (words[1] || words[2] || words[3])) {
    return Math.round(Number(words[1] ?? 0) * day + Number(words[2] ?? 0) * 60 + Number(words[3] ?? 0));
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(unit === "d" ? n * day : unit === "h" ? n * 60 : n);
}

/**
 * Рабочее время для «Траты факт»: пн–пт, 9:00–18:00, обед 13:00–14:00 не считается
 * (8 рабочих часов в день). Праздники пока не учитываются. Меняется здесь.
 */
export const WORK_DAY = { start: 9 * 60, end: 18 * 60, lunch: [13 * 60, 14 * 60] as [number, number], days: [1, 2, 3, 4, 5] };

/** Рабочие минуты между двумя моментами (по местному времени). weekends — считать и субботу с воскресеньем. */
export function workingMinutes(fromMs: number, toMs: number, weekends = false): number {
  if (toMs <= fromMs) return 0;
  const intervals: [number, number][] = [[WORK_DAY.start, WORK_DAY.lunch[0]], [WORK_DAY.lunch[1], WORK_DAY.end]];
  let total = 0;
  const day = new Date(fromMs); day.setHours(0, 0, 0, 0);
  for (; day.getTime() < toMs; day.setDate(day.getDate() + 1)) {
    if (!weekends && !WORK_DAY.days.includes(day.getDay())) continue;
    const base = day.getTime();
    for (const [a, b] of intervals) {
      const s = Math.max(fromMs, base + a * 60000), e = Math.min(toMs, base + b * 60000);
      if (e > s) total += (e - s) / 60000;
    }
  }
  return Math.round(total);
}

/**
 * Факт = рабочие минуты между началом и концом теста. Не заполнено хоть одно — не считаем (null).
 * Конец раньше начала — отрицательное значение (показываем как ошибку ввода).
 */
export function factMinutes(s: Spend | undefined, weekends = false): number | null {
  if (!s?.start || !s?.end) return null;
  const a = Date.parse(s.start), b = Date.parse(s.end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b < a ? -workingMinutes(b, a, weekends) || -1 : workingMinutes(a, b, weekends);
}

/**
 * Дата из Jira → «дд.мм.гггг чч:мм» (поле только с датой — «дд.мм.гггг»).
 * Понимает «2026-10-08», «2026-10-08 14:35» и ISO Jira «2026-10-08T14:35:00.000+0300»
 * (с часовым поясом — переводим в местное время). Непонятное — как есть.
 */
export function fmtJiraDate(value: string, withTime = true): string {
  const v = value.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(v) && v.includes("T")) {
    const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (!m) return value;
  const date = `${m[3]}.${m[2]}.${m[1]}`;
  return withTime && m[4] ? `${date} ${m[4]}:${m[5]}` : date;
}

/** Поле Jira с датой: «date» — только дата, «datetime» — дата и время. */
export function jiraDateKind(ref: ColRef): "date" | "datetime" | null {
  if (!ref.startsWith("jira:")) return null;
  const k = FIELD_BY_ID[ref.slice(5)]?.kind;
  return k === "date" || k === "datetime" ? k : null;
}

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
  /** ярлычки ячеек своих текстовых полей (иконка с цветом или эмодзи, см. lib/cellIcon.ts): ключ → id поля → код */
  icons?: Record<string, Record<string, string>>;
  /** папка задачи из импортированной структуры: ключ → путь */
  folders?: Record<string, string>;
  /**
   * Папки списка в порядке показа. Папка — уровень выше группировки: таблица делится
   * на папки, группировка идёт внутри каждой. Задача без папки — в «Без папки».
   */
  folderList?: string[];
  /** ширина колонок, px (перетаскиванием края заголовка) */
  widths?: Record<string, number>;
  /** закреплённые колонки: при прокрутке вбок остаются на месте (идут первыми) */
  pinned?: ColRef[];
  /** трудозатраты по задачам: план, начало и конец теста */
  spend?: Record<string, Spend>;
  /** поля направлений (st): ключ задачи → поле → фамилия и состояние */
  roles?: Record<string, Record<string, RoleValue>>;
  /** период для расчёта нагрузки, «ГГГГ-ММ-ДД» */
  load?: { from: string; to: string };
  /** задачи, вручную исключённые из нагрузки: ключ → true */
  noLoad?: Record<string, boolean>;
  /** false — не исключать автоматически задачи в «Готово к релизу» и дальше (по умолчанию исключаем) */
  loadAuto?: boolean;
  /** true — выходные считаются рабочими: и в ёмкости нагрузки, и в «Траты факт» (переработка). */
  loadWeekends?: boolean;
  /** Подробная нагрузка: у каких направлений показывать полосы загрузки людей (id направления → да/нет). */
  loadBars?: Record<string, boolean>;
  /**
   * Источники задач — JQL-фильтр или релиз, из которых задачи добавлены в список. При обновлении кэша
   * их состав сверяется со снимком: новые задачи встают в список с отметкой «n», выпавшие — помечаются «У».
   */
  sources?: ListSource[];
  /** Отметки состава: «new» — пришла из источника (снимается переносом в папку), «removed» — выпала из источника. */
  marks?: Record<string, "new" | "removed">;
  /**
   * Представления — разные наборы колонок одного списка. Действующее хранится в самих полях списка
   * (columns, pinned, widths); остальные — здесь. Папки, порядок задач, группировка и данные — общие.
   */
  views?: ListView[];
  /** id действующего представления (если представлений больше одного). */
  activeView?: string;
  /** откуда импортирована структура */
  structure?: { id: number; name: string; importedAt: string };
  createdAt: string;
}

export interface ToolState {
  version: 3;
  lists: TaskList[];
  participants: Participant[];
  /** Черновики задач SimpleTest: ещё не отправлены в Jira. */
  created: Issue[];
  /** Счётчик номеров черновиков («SBER911-ЧЕРНОВИК-3»). */
  nextKey: number;
  /** Сопоставление статусов с этапами; пусто — черновик по названиям статусов. */
  mapping: StageMapping;
  /** Фамилии для полей направлений (st): поле → список. Общие на все списки. */
  roleNames: Record<string, string[]>;
  /** Свои названия и цвета статусов (st); пусто — по умолчанию. */
  stageStyles: StageStyles;
  /** Свои статусы (st), добавленные к встроенным. */
  customStages: CustomStage[];
  /** Шаблоны списков: только структура — порядок колонок, свои поля и папки. */
  templates: ListTemplate[];
  /**
   * Требования (раздел «Данные») по задачам: ключ Jira → id документов. На уровне SimpleTest, а не списка:
   * одна фича бывает в нескольких списках, требования у неё одни.
   */
  reqLinks: Record<string, string[]>;
  /** Исходник требований по задаче (Confluence, Figma, Google Docs…): ключ → ссылка. Рядом с документами из «Данных». */
  reqUrls: Record<string, string>;
  /**
   * Микросервисы по задачам: ключ → имена из справочника микросервисов. На уровне SimpleTest, как требования:
   * задача в нескольких списках трогает одни и те же сервисы. Из них подставляются микросервисы в бронь стенда.
   */
  msLinks: Record<string, string[]>;
  /**
   * Статус (st), выставленный руками: ключ → этап. Нижняя планка — действует, пока Jira не покажет
   * этап выше (см. makeStageResolver). На уровне SimpleTest: реальность у задачи одна во всех списках.
   */
  stageManual: Record<string, Stage>;
  /** Норма дня и резервы для нагрузки — общие для всех списков. */
  loadSettings: LoadSettings;
  /**
   * Люди, назначенные в списках, которых ещё надо записать в поля Jira (lib/jiraPeopleSync.ts).
   * Уходят при обновлении из Jira — ручном и фоновом раз в 30 минут; не ушло (Jira недоступна) — ждут следующего.
   */
  jiraPending?: PersonFieldChange[];
}

/**
 * Шаблон списка — структура без данных: колонки по порядку, свои поля (с вариантами, тегами
 * и цветами) и папки. Задачи, значения полей, участники, трудозатраты, группировка и проект
 * в шаблон не входят.
 */
export interface ListTemplate {
  id: string;
  name: string;
  columns: ColRef[];
  ownFields: OwnField[];
  folderList: string[];
  createdAt: string;
}

export function templateOf(list: TaskList, name: string): ListTemplate {
  return {
    id: newId("tpl"), name, createdAt: new Date().toISOString(),
    columns: [...list.columns],
    ownFields: list.ownFields.map(f => ({ ...f, options: [...f.options], colors: f.colors ? { ...f.colors } : undefined })),
    folderList: [...(list.folderList ?? [])],
  };
}

/** Новый пустой список по шаблону: структура из шаблона, задач нет. */
export function listFromTemplate(name: string, project: string, tpl: ListTemplate): TaskList {
  const ownIds = new Set(tpl.ownFields.map(f => f.id));
  return {
    ...emptyList(name, project),
    // Колонка своего поля, которого в шаблоне нет, — мусор; колонка папки без папок не нужна.
    columns: tpl.columns.filter(c => (!c.startsWith("own:") || ownIds.has(c.slice(4))) && (c !== FOLDER_COL || tpl.folderList.length > 0)),
    ownFields: tpl.ownFields.map(f => ({ ...f, options: [...f.options], colors: f.colors ? { ...f.colors } : undefined })),
    folderList: tpl.folderList.length ? [...tpl.folderList] : undefined,
  };
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

/** Стартовое состояние: пусто — списки человек собирает сам из задач Jira. */
function initialState(): ToolState {
  return { version: 3, lists: [], participants: [], created: [], nextKey: 1, mapping: {}, roleNames: {}, stageStyles: {}, customStages: [], templates: [], reqLinks: {}, reqUrls: {}, msLinks: {}, stageManual: {}, loadSettings: DEFAULT_LOAD_SETTINGS };
}

/** Ключ черновика: с проектом (по нему берутся поля), но не похож на ключ Jira — не спутать и не столкнуться. */
export function draftKey(project: string, n: number): string {
  return `${project}-ЧЕРНОВИК-${n}`;
}

const STORAGE_KEY = "st_jira_tool";

export function loadState(): ToolState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<ToolState> & { version: number };
      if (s && s.version === 3 && Array.isArray(s.lists)) {
        return {
          version: 3,
          lists: s.lists.map(migrateList),
          participants: (s.participants ?? []).map(p => ({ ...p, role: normRole(p.role ?? "") })),
          created: s.created ?? [],
          nextKey: s.nextKey ?? 1,
          mapping: s.mapping ?? {},
          roleNames: s.roleNames ?? {},
          stageStyles: s.stageStyles ?? {},
          customStages: s.customStages ?? [],
          templates: s.templates ?? [],
          reqLinks: s.reqLinks ?? {},
          reqUrls: s.reqUrls ?? {},
          msLinks: s.msLinks ?? {},
          stageManual: s.stageManual ?? {},
          loadSettings: normLoadSettings(s.loadSettings),
          jiraPending: Array.isArray(s.jiraPending) ? s.jiraPending : [],
        };
      }
      if (s && Array.isArray(s.lists)) return fromDemo(s);
    }
  } catch { /* приватный режим или битые данные — начинаем заново */ }
  return initialState();
}

/** Настройка нагрузки из хранилища или файла: битые значения — к умолчаниям. */
export function normLoadSettings(raw: Partial<LoadSettings> | undefined): LoadSettings {
  const day = Number(raw?.dayMinutes);
  return {
    dayMinutes: Number.isFinite(day) && day > 0 && day <= 24 * 60 ? Math.round(day) : LOAD_DAY_MINUTES,
    reserves: (raw?.reserves ?? []).filter(r => r && typeof r.name === "string" && Number(r.minutes) >= 0)
      .map(r => ({
        id: r.id || newId("rsv"), name: r.name, minutes: Math.round(Number(r.minutes)),
        participants: Array.isArray(r.participants) ? r.participants : [],
        ...(Array.isArray(r.directions) && r.directions.length ? { directions: r.directions } : {}),
      })),
  };
}

/** Демо-участники из итерации на моках — при переходе на настоящую Jira убираем. */
const DEMO_PARTICIPANTS = new Set(["ptc-1:Иванов Илья", "ptc-2:Петрова Анна", "ptc-3:Сидоров Кирилл"]);

/**
 * v1–v2 — итерация на мок-Jira: в списках ключи выдуманных задач, в черновиках — мок-нумерация,
 * статусы менялись только в браузере. На настоящей Jira это мусор (а ключ вроде SBER911-29210
 * может оказаться чужой настоящей задачей), поэтому списки не переносим. Переносим то, что
 * человек вводил сам и что от моков не зависит: участников и сопоставление статусов.
 */
function fromDemo(s: Partial<ToolState>): ToolState {
  return {
    ...initialState(),
    participants: (s.participants ?? [])
      .filter(p => !DEMO_PARTICIPANTS.has(`${p.id}:${p.name}`))
      .map(p => ({ ...p, role: normRole(p.role ?? "") })),
    mapping: s.mapping ?? {},
  };
}

/**
 * Старые списки: проект по умолчанию; «Папка структуры» была уровнем группировки —
 * теперь папки — отдельный уровень над группировкой, переносим их в folderList.
 */
function migrateList(l: TaskList): TaskList {
  const out: TaskList = { ...l, project: l.project ?? DEFAULT_PROJECT };
  if (out.groupBy.includes(FOLDER_COL)) out.groupBy = out.groupBy.filter(g => g !== FOLDER_COL);
  if (!out.folderList && out.folders && Object.keys(out.folders).length) {
    out.folderList = Array.from(new Set(out.keys.map(k => out.folders![k]).filter(Boolean)));
  }
  return out;
}

export function saveState(s: ToolState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* нет места — живём в памяти */ }
}

/**
 * Черновик ушёл в Jira: заменяем его на настоящую задачу и переносим всё, что
 * SimpleTest хранит по ключу, — участника, значения своих полей, папку, — во всех списках.
 */
export function replaceDraft(s: ToolState, draftKey: string, issue: Issue): ToolState {
  const remap = <T,>(m: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!m || !(draftKey in m)) return m;
    const { [draftKey]: v, ...rest } = m;
    return { ...rest, [issue.key]: v };
  };
  return {
    ...s,
    reqLinks: remap(s.reqLinks) ?? {},
    reqUrls: remap(s.reqUrls) ?? {},
    msLinks: remap(s.msLinks) ?? {},
    stageManual: remap(s.stageManual) ?? {},
    created: s.created.map(i => (i.key === draftKey ? issue : i)),
    lists: s.lists.map(l => ({
      ...l,
      keys: l.keys.map(k => (k === draftKey ? issue.key : k)),
      assignees: remap(l.assignees) ?? {},
      values: remap(l.values) ?? {},
      icons: remap(l.icons),
      folders: remap(l.folders),
      spend: remap(l.spend),
      roles: remap(l.roles),
      noLoad: remap(l.noLoad),
    })),
  };
}

/* ── Колонки ───────────────────────────────────────────────────────────── */

/** Всё, что нужно колонкам помимо самой задачи. */
export interface ColCtx {
  list: TaskList;
  participants: Participant[];
  stageOf: (issue: Issue) => StageInfo;
  /** Дефекты задачи; null — у дефекта такого поля нет. */
  defectsOf: (issue: Issue) => Issue[] | null;
  /** Названия требований задачи (поле «Требования (st)»). */
  reqsOf?: (key: string) => string[];
  /** Микросервисы задачи (поле «Микросервисы (st)»). */
  msOf?: (key: string) => string[];
}

/** Дефекты задачи по индексу из defectIndex(); у самих дефектов — null. */
export function makeDefectsOf(index: Map<string, Issue[]>) {
  return (issue: Issue): Issue[] | null => (categoryOf(issue) === "defect" ? null : index.get(issue.key) ?? []);
}

/**
 * Активный (неустранённый) дефект: всё, кроме «Подтверждение исправления», «Исключено», «Отложен» и «Закрыт».
 * Правило одно для «Дефекты (st)», «Блок (st)» и блокировки стори и эпика в статусе (st) — что не блокирует, то и
 * не висит в «Блок (st)».
 */
export function isOpenDefect(d: Issue): boolean {
  return !isResolvedDefect(d);
}

/** Неустранённые блокирующие дефекты задачи. */
export function blockersOf(defects: Issue[]): Issue[] {
  return defects.filter(d => isOpenDefect(d) && isBlocker(d));
}

export function colLabel(ref: ColRef, list: TaskList): string {
  if (ref === PARTICIPANT_COL) return "Тестировщик (st)";
  if (ref === STAGE_COL) return "Статус (st)";
  if (ref === FOLDER_COL) return "Папка (st)";
  if (ref === DEFECTS_COL) return "Дефекты (st)";
  if (ref === BLOCK_COL) return "Блок (st)";
  if (ref === PLAN_COL) return "Траты план (st)";
  if (ref === START_COL) return "Начало теста (st)";
  if (ref === END_COL) return "Конец теста (st)";
  if (ref === FACT_COL) return "Траты факт (st)";
  if (ref === LOAD_COL) return "Нагрузка (st)";
  if (ref === REQ_COL) return "Требования (st)";
  if (ref === MS_COL) return "Микросервисы (st)";
  if (isRoleCol(ref)) return `${ROLE_FIELDS.find(f => roleCol(f.id) === ref)?.label ?? ref.slice(5)} (st)`;
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
  } else if (ref === PLAN_COL) {
    const p = ctx.list.spend?.[issue.key]?.plan;
    v = p == null ? null : String(p);
  } else if (ref === FACT_COL) {
    const f = factMinutes(ctx.list.spend?.[issue.key], !!ctx.list.loadWeekends);
    v = f == null ? null : String(f);
  } else if (ref === START_COL || ref === END_COL) {
    v = ctx.list.spend?.[issue.key]?.[ref === START_COL ? "start" : "end"] ?? null;
  } else if (ref === REQ_COL) {
    v = ctx.reqsOf?.(issue.key) ?? null;
  } else if (ref === MS_COL) {
    v = ctx.msOf?.(issue.key) ?? null;
  } else if (ref === LOAD_COL) {
    const why = loadSkip(ctx.list, issue, ctx.stageOf);
    v = why === "manual" ? "Не учитывается (вручную)" : why === "stage" ? "Не учитывается (статус)" : "Учитывается";
  } else if (isRoleCol(ref)) {
    v = ctx.list.roles?.[issue.key]?.[ref.slice(5)]?.name ?? null;
  } else if (ref.startsWith("jira:")) {
    v = issue.fields[ref.slice(5)];
  } else if (ref.startsWith("own:")) {
    const f = ctx.list.ownFields.find(x => x.id === ref.slice(4));
    // «По правилам» — вычисленный текст (по нему сортировка, фильтр и группировка), иначе — введённое значение.
    v = f?.type === "rules" ? ruleResult(f, issue, ctx)?.text ?? null : ctx.list.values[issue.key]?.[ref.slice(4)] ?? null;
  }
  if (v === null || v === undefined || v === "") return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

/** Микросервис, который в списке трогают несколько задач: имя и ключи задач (в порядке списка). */
export interface MsOverlap { service: string; keys: string[] }

/**
 * Пересечения по микросервисам в списке: микросервисы, указанные у двух и более задач (поле «Микросервисы (st)»).
 * Имена сравниваются без регистра и лишних пробелов. Порядок — сначала самые общие, затем по имени.
 */
export function msOverlaps(keys: string[], msLinks: Record<string, string[]>): MsOverlap[] {
  const by = new Map<string, MsOverlap>();
  for (const k of keys) {
    for (const name of msLinks[k] ?? []) {
      const n = name.trim().replace(/\s+/g, " ").toLowerCase();
      if (!n) continue;
      const cur = by.get(n) ?? { service: name.trim(), keys: [] };
      if (!cur.keys.includes(k)) cur.keys.push(k);
      by.set(n, cur);
    }
  }
  return [...by.values()].filter(o => o.keys.length > 1)
    .sort((a, b) => b.keys.length - a.keys.length || a.service.localeCompare(b.service));
}

/** Порядок значений для сортировки и групп: статусы и этапы — по ходу процесса. */
export function orderIndex(ref: ColRef, value: string): number {
  if (ref === "jira:status") return STATUS_ORDER.indexOf(value);
  if (ref === "jira:priority") return PRIORITIES.indexOf(value);
  if (ref === STAGE_COL) {
    const i = STAGES.findIndex(s => STAGE_LABEL[s] === value);
    // «Заблокирован» и «Нет сторей» — первыми: это то, что требует внимания.
    return i >= 0 ? i : value === STAGE_LABEL.blocked ? -3 : value === "Нет сторей" ? -2 : -1;
  }
  return -1;
}

/**
 * Поля для выбора колонок: системные + те, что заполнены в задачах проекта списка
 * (used — с сервера; null — ещё не загружены, тогда все известные поля).
 * Поля, уже выбранные в колонки, остаются в выборе всегда — иначе их не снять.
 */
export function listFields(list: TaskList, used: string[] | null): JiraFieldDef[] {
  const keep = new Set([...(used ?? []), ...list.columns.filter(c => c.startsWith("jira:")).map(c => c.slice(5)),
                        ...list.groupBy.filter(c => c.startsWith("jira:")).map(c => c.slice(5))]);
  return Object.values(FIELD_BY_ID)
    .filter(f => f.id !== "issuelinks" && (used === null || SYSTEM_FIELD_IDS.has(f.id) || keep.has(f.id)))
    .sort((a, b) => Number(a.custom) - Number(b.custom) || a.name.localeCompare(b.name, "ru"));
}

/** Переставить item перед/после target (порядок строк и колонок при перетаскивании). */
export function moveItem<T>(arr: T[], item: T, target: T, place: "before" | "after"): T[] {
  if (item === target || !arr.includes(item) || !arr.includes(target)) return arr;
  const rest = arr.filter(x => x !== item);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/* ── Папки списка ──────────────────────────────────────────────────────── */

export const NO_FOLDER = "Без папки";

/** Разделы таблицы: папки по порядку + «Без папки» для остальных задач. */
export function folderSections(list: TaskList, issues: Issue[]): { name: string | null; issues: Issue[] }[] {
  const folders = list.folderList ?? [];
  const known = new Set(folders);
  return [
    ...folders.map(name => ({ name, issues: issues.filter(i => list.folders?.[i.key] === name) })),
    { name: null, issues: issues.filter(i => !known.has(list.folders?.[i.key] ?? "")) },
  ];
}

/** Положить задачу в папку (null — вынуть из папки). Новая задача из источника, положенная в папку, — уже разобрана: «n» снимается. */
export function setFolder(list: TaskList, key: string, folder: string | null): TaskList {
  const f = { ...list.folders };
  if (folder) f[key] = folder; else delete f[key];
  const out: TaskList = { ...list, folders: f };
  if (folder && list.marks?.[key] === "new") out.marks = withoutMark(list.marks, key);
  return out;
}

export function withoutMark(marks: TaskList["marks"], key: string): TaskList["marks"] {
  if (!marks || !(key in marks)) return marks;
  const { [key]: _drop, ...rest } = marks;
  return rest;
}

/* ── Перенос задач между списками ──────────────────────────────────────── */

/** Тип данных при перетаскивании строк таблицы на список в колонке «Списки»: JSON-массив ключей. */
export const DRAG_ISSUES = "application/x-simpletest-issues";

/**
 * Перенести задачи из списка в список. Вместе с задачей едет то, что имеет смысл в другом списке: участник,
 * направления (st), трудозатраты, исключение из нагрузки, значения своих полей и их ярлычки — в поле целевого
 * списка с тем же id (списки из одного шаблона) или с тем же названием и типом; поля без пары не переносятся.
 * Папка — только если в целевом списке есть папка с тем же названием, иначе задача встаёт в «Без папки».
 * Задача уже есть в целевом списке — его данные главнее: из исходного она просто уходит.
 * Из исходного задача убирается так же, как «Убрать из списка»: ключ и отметка «n»/«У».
 */
export function moveIssues(s: ToolState, fromId: string, toId: string, keys: string[]): ToolState {
  const from = s.lists.find(l => l.id === fromId), to = s.lists.find(l => l.id === toId);
  if (!from || !to || fromId === toId) return s;
  const moving = new Set(keys.filter(k => from.keys.includes(k)));
  if (!moving.size) return s;
  const fresh = [...moving].filter(k => !to.keys.includes(k));

  const pair = new Map<string, string>();      // id своего поля исходного списка → id в целевом
  const norm = (n: string) => n.trim().toLowerCase();
  for (const f of from.ownFields) {
    const t = to.ownFields.find(x => x.id === f.id && x.type === f.type)
      ?? to.ownFields.find(x => x.type === f.type && norm(x.name) === norm(f.name));
    if (t) pair.set(f.id, t.id);
  }
  const byField = <T,>(rec: Record<string, T> | undefined): Record<string, T> | null => {
    const out: Record<string, T> = {};
    for (const [fid, v] of Object.entries(rec ?? {})) { const t = pair.get(fid); if (t) out[t] = v; }
    return Object.keys(out).length ? out : null;
  };

  const target: TaskList = { ...to, keys: [...to.keys, ...fresh], values: { ...to.values }, assignees: { ...to.assignees } };
  for (const k of fresh) {
    const vals = byField(from.values[k]);
    if (vals) target.values[k] = vals;
    const icons = byField(from.icons?.[k]);
    if (icons) target.icons = { ...target.icons, [k]: icons };
    if (from.assignees[k]) target.assignees[k] = from.assignees[k];
    if (from.roles?.[k]) target.roles = { ...target.roles, [k]: from.roles[k] };
    if (from.spend?.[k]) target.spend = { ...target.spend, [k]: from.spend[k] };
    if (from.noLoad?.[k]) target.noLoad = { ...target.noLoad, [k]: true };
    const folder = from.folders?.[k];
    if (folder && to.folderList?.includes(folder)) target.folders = { ...target.folders, [k]: folder };
  }
  const source: TaskList = {
    ...from,
    keys: from.keys.filter(k => !moving.has(k)),
    marks: [...moving].reduce((m, k) => withoutMark(m, k), from.marks),
  };
  return { ...s, lists: s.lists.map(l => (l.id === fromId ? source : l.id === toId ? target : l)) };
}

/* ── Источники задач: JQL и релиз ──────────────────────────────────────── */

export interface ListSource {
  id: string;
  kind: "jql" | "release";
  /** JQL-запрос или ключ релиза. */
  query: string;
  /** Подпись: запрос или «SBER911-100 · Релиз 16/10». */
  name: string;
  /** Состав на момент последней сверки: ключи, которые источник отдавал (для релиза — эпики и задачи без эпика). */
  keys: string[];
  checkedAt: string;
}

/** Источник с тем же запросом уже есть — объединяем снимки, а не заводим второй. */
export function upsertSource(list: TaskList, src: ListSource): TaskList {
  const cur = list.sources ?? [];
  const same = cur.find(x => x.kind === src.kind && x.query.trim() === src.query.trim());
  return {
    ...list,
    sources: same
      ? cur.map(x => (x === same ? { ...x, name: src.name, keys: Array.from(new Set([...x.keys, ...src.keys])), checkedAt: src.checkedAt } : x))
      : [...cur, src],
  };
}

/**
 * Сверка источника с новым составом. Новые задачи (не было в снимке) встают в список с «n» — в «Без папки»;
 * задачи списка, выпавшие из источника, помечаются «У»; вернувшиеся — отметка снимается.
 * truncated — Jira отдала не всё (потолок выборки): выпавшими тогда никого не считаем, нельзя быть уверенными.
 */
export function applySourceCheck(list: TaskList, sourceId: string, fresh: string[], truncated: boolean, now: string): TaskList {
  const src = list.sources?.find(x => x.id === sourceId);
  if (!src) return list;
  const old = new Set(src.keys), cur = new Set(fresh), inList = new Set(list.keys);
  const added = fresh.filter(k => !old.has(k) && !inList.has(k));
  const marks = { ...list.marks };
  for (const k of added) marks[k] = "new";
  if (!truncated) for (const k of src.keys) if (!cur.has(k) && inList.has(k)) marks[k] = "removed";
  for (const k of fresh) if (marks[k] === "removed") delete marks[k];
  return {
    ...list,
    keys: [...list.keys, ...added],
    marks,
    sources: (list.sources ?? []).map(x => (x.id === sourceId ? { ...x, keys: fresh, checkedAt: now } : x)),
  };
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
  // «По правилам» вычисляется — перенос задачи в другую группу его не меняет.
  return ref.startsWith("own:") && list.ownFields.some(f => f.id === ref.slice(4) && f.type !== "rules");
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
  // Группы — только по значениям, у которых в списке есть задачи: участник без задач группой не показывается.
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

/**
 * «SBER911-29210, 29211 pkap-1500» или ссылки на задачи → ключи задач.
 * Ссылка: …/browse/SBER911-29210 или …?selectedIssue=SBER911-29210; голый номер — из проекта списка.
 */
export function parseKeys(text: string, project = DEFAULT_PROJECT): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) { out.push(`${project}-${t}`); continue; }
    const keys = t.toUpperCase().match(/[A-Z][A-Z0-9_]*-\d+/g);
    if (keys) out.push(...keys);
  }
  return Array.from(new Set(out));
}

/** Примеры JQL для проекта — запрос уходит в Jira как есть. */
export function jqlExamples(project: string): string[] {
  return [
    `project = ${project} AND issuetype = Дефект AND resolution = Unresolved`,
    `project = ${project} AND issuetype = Epic AND resolution = Unresolved`,
    `project = ${project} AND assignee = currentUser() AND resolution = Unresolved`,
    `project = ${project} AND fixVersion in unreleasedVersions() ORDER BY priority`,
    `project = ${project} AND created >= -14d`,
  ];
}

/* ── Отчёт в чат и чек-лист (Сберчат: *жирный*, _курсив_) ──────────────── */

/** Задачи для отчёта: по папкам (если есть) в порядке таблицы; folder — заголовок раздела или null. */
export type ReportSection = { folder: string | null; issues: Issue[] };

/**
 * «Скопировать в чат» (Сберчат: *жирный*). Сверху «Статус — <название списка>», дальше разделы по папкам через пустую строку:
 *   *Папка*
 *   • [*SBER911-1*] Тема — 🟢 Готово к релизу
 *   Дефекты:
 *   SBER911-2 Тема дефекта. Приоритет: Высокий
 * Жирным — только номер фичи; точка «•» — перечисление фич. Под фичей — только её неустранённые дефекты, без точек и скобок.
 */
export function chatReport(sections: ReportSection[], ctx: ColCtx): string {
  const name = ctx.list.name.trim();
  const out: string[] = [name ? `*Статус — ${name}*` : "*Статус*"];
  for (const sec of sections) {
    if (!sec.issues.length) continue;
    out.push("");
    if (sec.folder !== null) out.push(`*${sec.folder}*`);
    for (const i of sec.issues) {
      const info = ctx.stageOf(i);
      out.push(`• [*${i.key}*] ${String(i.fields.summary ?? "").trim()} — ${stageDot(info)} ${stageText(info)}`);
      const open = ctx.defectsOf(i)?.filter(isOpenDefect) ?? [];
      if (open.length) {
        out.push("Дефекты:");
        for (const d of open) {
          out.push(`${d.key} ${String(d.fields.summary ?? "").trim().replace(/\.$/, "")}. Приоритет: ${String(d.fields.priority ?? "—")}`);
        }
      }
    }
  }
  return out.join("\n").trimEnd();
}

/**
 * Собственный статус (st) задачи — без блокировки, которую она унаследовала: у стори — от блокирующих дефектов
 * эпика, у эпика — от дефектов сторей. Блокировка остаётся, только если блокирующий дефект её собственный.
 * Нужен там, где задачи эпика показываются рядом с ним: иначе при заблокированном эпике «Заблокирован» у всех.
 */
export function ownStageInfo(info: StageInfo, ownDefects: Issue[] | undefined): StageInfo {
  if (info.kind !== "blocked") return info;
  const mine = new Set((ownDefects ?? []).map(d => d.key));
  const by = info.by.filter(d => mine.has(d.key));
  return by.length ? { ...info, by } : info.base;
}

/** Дефекты задачи для чата: номер, название, приоритет и статус (st) каждого дефекта — в формате «Скопировать в чат». */
/**
 * «Скопировать в чат» в окне сторей эпика — как отчёт общего списка: стори с её статусом (st), под ней активные
 * дефекты (номер, название, приоритет). Заголовок — эпик и его статус (st).
 */
export function storiesChatReport(epic: Issue, stories: Issue[], epicStage: StageInfo, stageOf: (i: Issue) => StageInfo,
                                  defectsOf: (i: Issue) => Issue[] | null): string {
  const out = [`*Стори эпика ${epic.key}* ${String(epic.fields.summary ?? "").trim()} — ${stageDot(epicStage)} ${stageText(epicStage)}`, ""];
  for (const i of stories) {
    const info = stageOf(i);
    out.push(`• [*${i.key}*] ${String(i.fields.summary ?? "").trim()} — ${stageDot(info)} ${stageText(info)}`);
    const open = defectsOf(i)?.filter(isOpenDefect) ?? [];
    if (open.length) {
      out.push("Дефекты:");
      for (const d of open) {
        out.push(`${d.key} ${String(d.fields.summary ?? "").trim().replace(/\.$/, "")}. Приоритет: ${String(d.fields.priority ?? "—")}`);
      }
    }
  }
  return out.join("\n").trimEnd();
}

export function defectsChatReport(issue: Issue, defects: Issue[], stageOf: (i: Issue) => StageInfo): string {
  const out = [`*Дефекты ${issue.key}* ${String(issue.fields.summary ?? "").trim()}`];
  for (const d of defects) {
    const info = stageOf(d);
    out.push(`• [*${d.key}*] ${String(d.fields.summary ?? "").trim().replace(/\.$/, "")}. Приоритет: ${String(d.fields.priority ?? "—")} — ${stageDot(info)} ${stageText(info)}`);
  }
  return out.join("\n");
}

/**
 * «Чек-лист»: по фиче — код и наименование, затем критически важные проверки (если сгенерированы
 * по требованиям) и «Результат проверок:» — его заполняет тестировщик.
 */
export function checklistReport(sections: ReportSection[], checks: Record<string, string[]>): string {
  const out: string[] = [];
  for (const sec of sections) {
    if (!sec.issues.length) continue;
    if (sec.folder !== null) out.push(`*${sec.folder}*`);
    for (const i of sec.issues) {
      out.push(`*${i.key}* ${String(i.fields.summary ?? "")}`);
      const c = checks[i.key];
      if (c?.length) {
        out.push("_Критически важные базовые проверки:_");
        c.forEach((x, n) => out.push(`${n + 1}. ${x}`));
      }
      out.push("_Результат проверок:_", "");
    }
  }
  return out.join("\n").trimEnd();
}

/* ── Состав релиза → задачи списка ─────────────────────────────────────── */

export interface ReleaseGroup {
  /** Эпик — если задачи привязаны к нему (Epic Link) или он сам в составе релиза. */
  epic?: Issue;
  /** Задачи релиза под эпиком; у задачи без эпика — она сама, одна. */
  members: Issue[];
}

/**
 * Состав релиза → что ставить в список. Задача с эпиком (стори, дефект и т.д.) — показываем эпик,
 * несколько задач одного эпика собираются под ним; задача без эпика — сама; эпик из состава — сам эпик
 * (с задачами релиза под ним, если они есть). Порядок — как в составе релиза.
 */
export function composeRelease(issues: Issue[], epics: Issue[], epicField: string): ReleaseGroup[] {
  const epicByKey = new Map<string, Issue>([...epics, ...issues.filter(i => categoryOf(i) === "epic")].map(e => [e.key, e]));
  const groups: ReleaseGroup[] = [];
  const byEpic = new Map<string, ReleaseGroup>();
  const epicGroup = (key: string) => {
    let g = byEpic.get(key);
    if (!g) {
      // Эпика нет в ответе Jira (нет прав) — всё равно группируем по ключу, список попробует его загрузить.
      g = { epic: epicByKey.get(key) ?? { key, fields: {} }, members: [] };
      byEpic.set(key, g);
      groups.push(g);
    }
    return g;
  };
  for (const i of issues) {
    if (categoryOf(i) === "epic") { epicGroup(i.key); continue; }
    const e = i.fields[epicField];
    if (typeof e === "string" && e) epicGroup(e).members.push(i);
    else groups.push({ members: [i] });
  }
  return groups;
}

/** Ключи, которые попадут в список: эпик группы или сама задача без эпика. */
export function releaseKeys(groups: ReleaseGroup[]): string[] {
  return groups.map(g => g.epic?.key ?? g.members[0]?.key).filter((k): k is string => !!k);
}

/* ── Представления списка: наборы колонок ──────────────────────────────── */

export interface ListView {
  id: string;
  name: string;
  columns: ColRef[];
  pinned?: ColRef[];
  widths?: Record<string, number>;
}

/** Колонки нового представления: ключ виден всегда, плюс тип и тема. */
export const VIEW_BASE_COLUMNS: ColRef[] = ["jira:issuetype", "jira:summary"];

/** Представления списка с учётом действующего (его колонки — из полей списка). Без представлений — одно «Основное». */
export function listViews(list: TaskList): ListView[] {
  const live = (v: ListView): ListView => ({ ...v, columns: list.columns, pinned: list.pinned, widths: list.widths });
  if (!list.views?.length) return [live({ id: "main", name: "Основное", columns: [] })];
  return list.views.map(v => (v.id === list.activeView ? live(v) : v));
}

/** Переключить представление: колонки действующего — в его запись, колонки выбранного — в поля списка. */
export function switchView(list: TaskList, id: string): TaskList {
  const views = listViews(list);
  const target = views.find(v => v.id === id);
  if (!target || id === (list.activeView ?? views[0].id)) return list;
  return { ...list, views, activeView: id, columns: [...target.columns], pinned: target.pinned, widths: target.widths };
}

/** Новое представление: только ключ, тип и тема — дальше набираются любые поля. Сразу становится действующим. */
export function addView(list: TaskList, name: string): TaskList {
  const view: ListView = { id: newId("view"), name, columns: [...VIEW_BASE_COLUMNS] };
  return switchView({ ...list, views: [...listViews(list), view], activeView: list.activeView ?? "main" }, view.id);
}

export function renameView(list: TaskList, id: string, name: string): TaskList {
  return { ...list, views: listViews(list).map(v => (v.id === id ? { ...v, name } : v)), activeView: list.activeView ?? "main" };
}

/** Удалить представление (последнее не удаляется); удалили действующее — переключаемся на первое. */
export function deleteView(list: TaskList, id: string): TaskList {
  const views = listViews(list);
  if (views.length < 2) return list;
  const active = list.activeView ?? views[0].id;
  const rest = views.filter(v => v.id !== id);
  if (id !== active) return { ...list, views: rest };
  const next = rest[0];
  return { ...list, views: rest, activeView: next.id, columns: [...next.columns], pinned: next.pinned, widths: next.widths };
}

/* ── Экспорт и импорт списков (файл .json) ─────────────────────────────── */

export const EXPORT_FORMAT = "simpletest.jira-tool";
export const EXPORT_VERSION = 1;

/**
 * Файл обмена списками: сами списки (задачи, папки, колонки, представления, значения своих полей,
 * трудозатраты, отметки источников) и всё, на что они ссылаются, — участники, фамилии направлений,
 * привязки требований, черновики, свои статусы (st). Получатель видит список так же, как автор.
 */
export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  lists: TaskList[];
  participants: Participant[];
  roleNames: Record<string, string[]>;
  reqLinks: Record<string, string[]>;
  /** Ссылки на исходники требований; в старых файлах нет. */
  reqUrls?: Record<string, string>;
  /** Микросервисы задач файла; в старых файлах нет. */
  msLinks?: Record<string, string[]>;
  /** Ручные статусы (st) задач файла; в старых файлах нет. */
  stageManual?: Record<string, Stage>;
  /** Резервы нагрузки участников файла; в старых файлах нет. */
  loadReserves?: LoadReserve[];
  drafts: Issue[];
  customStages: CustomStage[];
  stageStyles: StageStyles;
}

/**
 * Списки → файл. Справочник людей общий на все списки, поэтому уходит целиком (с направлениями) вместе с резервами
 * нагрузки — у получателя нагрузка посчитается так же. listIds пустой — файл только со справочником людей.
 */
export function exportLists(s: ToolState, listIds: string[]): ExportFile {
  const lists = s.lists.filter(l => listIds.includes(l.id));
  const keys = new Set(lists.flatMap(l => l.keys));
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    lists,
    participants: s.participants,
    roleNames: s.roleNames,
    reqLinks: Object.fromEntries(Object.entries(s.reqLinks).filter(([k]) => keys.has(k))),
    reqUrls: Object.fromEntries(Object.entries(s.reqUrls).filter(([k]) => keys.has(k))),
    msLinks: Object.fromEntries(Object.entries(s.msLinks).filter(([k]) => keys.has(k))),
    stageManual: Object.fromEntries(Object.entries(s.stageManual).filter(([k]) => keys.has(k))),
    loadReserves: s.loadSettings.reserves,
    drafts: s.created.filter(i => keys.has(i.key)),
    customStages: s.customStages,
    stageStyles: s.stageStyles,
  };
}

export class ImportError extends Error {}

/** Разбор файла: это наш формат и его версию мы понимаем — иначе понятная ошибка, а не тихий мусор. */
export function parseExportFile(text: string): ExportFile {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ImportError("Это не файл списков SimpleTest: внутри не JSON"); }
  const f = raw as Partial<ExportFile>;
  if (!f || f.format !== EXPORT_FORMAT) throw new ImportError("Это не файл списков SimpleTest (нет отметки формата)");
  if (typeof f.version !== "number" || f.version > EXPORT_VERSION) {
    throw new ImportError("Файл создан более новой версией SimpleTest — обновите проект и повторите");
  }
  if (!Array.isArray(f.lists) || !f.lists.every(l => l && typeof l.name === "string" && Array.isArray(l.keys) && Array.isArray(l.columns))) {
    throw new ImportError("В файле повреждён список задач");
  }
  return {
    format: EXPORT_FORMAT, version: f.version, exportedAt: f.exportedAt ?? "",
    lists: f.lists, participants: f.participants ?? [], roleNames: f.roleNames ?? {}, reqLinks: f.reqLinks ?? {},
    reqUrls: f.reqUrls ?? {},
    msLinks: f.msLinks ?? {},
    stageManual: f.stageManual ?? {},
    loadReserves: f.loadReserves ?? [],
    drafts: f.drafts ?? [], customStages: f.customStages ?? [], stageStyles: f.stageStyles ?? {},
  };
}

/**
 * Импорт: списки добавляются новыми (свой id; одноимённый — с пометкой «(импорт)»), чужое ничего не затирает.
 * Человек с тем же ФИО — тот же человек: не дублируем, его направления дополняются направлениями из файла; новый —
 * добавляется в справочник. Ссылки на людей в списках (тестировщик, поля направлений) переводятся на людей
 * получателя. Фамилии направлений и свои статусы — объединяются; привязки требований и черновики — только те,
 * которых у получателя ещё нет.
 */
export function importLists(s: ToolState, f: ExportFile): { state: ToolState; names: string[]; peopleAdded: number } {
  const participants = [...s.participants];
  const pidMap: Record<string, string> = {};
  let peopleAdded = 0;
  for (const p of f.participants) {
    const dirs = p.directions ?? [TESTING];          // старый файл: участник без направлений — тестировщик
    const at = participants.findIndex(x => sameName(x.name, p.name));
    if (at >= 0) {
      const same = participants[at];
      pidMap[p.id] = same.id;
      const merged = Array.from(new Set([...(same.directions ?? [TESTING]), ...dirs]));
      if (merged.length !== (same.directions ?? [TESTING]).length) participants[at] = { ...same, directions: merged };
    } else {
      const id = participants.some(x => x.id === p.id) ? newId("ptc") : p.id;
      participants.push({ ...p, id, role: normRole(p.role ?? ""), directions: dirs });
      pidMap[p.id] = id;
      peopleAdded++;
    }
  }
  // Черновик с таким же ключом у получателя уже есть (своя нумерация) — даём импортированному новый номер.
  const draftKeys = new Set(s.created.map(i => i.key));
  let nextKey = s.nextKey;
  const keyMap: Record<string, string> = {};
  const drafts = f.drafts.map(d => {
    if (!draftKeys.has(d.key)) return d;
    const nk = draftKey(projectKeyOfIssue(d.key), nextKey++);
    keyMap[d.key] = nk;
    return { ...d, key: nk };
  });
  const rk = (k: string) => keyMap[k] ?? k;
  const remapKeys = <T,>(m: Record<string, T> | undefined) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [rk(k), v])) : m);

  const taken = new Set(s.lists.map(l => l.name));
  const names: string[] = [];
  const lists = f.lists.map(l0 => {
    const l: TaskList = {
      ...l0, keys: l0.keys.map(rk), assignees: remapKeys(l0.assignees) ?? {}, values: remapKeys(l0.values) ?? {},
      icons: remapKeys(l0.icons), folders: remapKeys(l0.folders), spend: remapKeys(l0.spend), roles: remapKeys(l0.roles),
      noLoad: remapKeys(l0.noLoad), marks: remapKeys(l0.marks),
    };
    const name = taken.has(l.name) ? `${l.name} (импорт)` : l.name;
    taken.add(name); names.push(name);
    const assignees = Object.fromEntries(Object.entries(l.assignees ?? {})
      .map(([k, pid]) => [k, pidMap[pid] ?? ""]).filter(([, pid]) => pid));
    // Люди в полях направлений — на людей получателя; не нашёлся — остаётся имя (найдётся по нему).
    const roles = l.roles && Object.fromEntries(Object.entries(l.roles).map(([k, byDir]) => [k, Object.fromEntries(
      Object.entries(byDir).map(([dir, v]) => [dir, v.pid ? { ...v, pid: pidMap[v.pid] } : v]))]));
    return migrateList({ ...l, id: newId("lst"), name, assignees, roles, values: l.values ?? {}, ownFields: l.ownFields ?? [], groupBy: l.groupBy ?? [] });
  });
  const roleNames = { ...s.roleNames };
  for (const [fid, ns] of Object.entries(f.roleNames)) roleNames[fid] = Array.from(new Set([...(roleNames[fid] ?? []), ...ns]));
  return {
    names,
    peopleAdded,
    state: {
      ...s,
      lists: [...s.lists, ...lists],
      participants,
      roleNames,
      reqLinks: { ...remapKeys(f.reqLinks), ...s.reqLinks },
      reqUrls: { ...remapKeys(f.reqUrls), ...s.reqUrls },
      msLinks: { ...remapKeys(f.msLinks), ...s.msLinks },
      // Свой ручной статус важнее чужого: у себя человек видит задачу ближе.
      stageManual: { ...remapKeys(f.stageManual), ...s.stageManual },
      // Резервы файла, которых у нас нет (по id), — с участниками, переведёнными на наших. Норму дня не трогаем.
      loadSettings: {
        ...s.loadSettings,
        reserves: [
          ...s.loadSettings.reserves,
          ...normLoadSettings({ reserves: f.loadReserves ?? [] }).reserves
            .filter(r => !s.loadSettings.reserves.some(x => x.id === r.id))
            .map(r => ({ ...r, participants: r.participants.map(id => pidMap[id]).filter(Boolean) as string[], had: r.participants.length }))
            // Личный резерв, чьих участников у нас нет, не должен стать общим («пусто — всем»).
            .filter(r => !r.had || r.participants.length).map(({ had: _had, ...r }) => r),
        ],
      },
      created: [...s.created, ...drafts],
      nextKey,
      customStages: [...s.customStages, ...f.customStages.filter(c => !s.customStages.some(x => x.id === c.id))],
      stageStyles: { ...f.stageStyles, ...s.stageStyles },
    },
  };
}
