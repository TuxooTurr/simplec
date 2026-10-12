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
  DEFAULT_PROJECT, FIELD_BY_ID, PRIORITIES, STATUS_ORDER, SYSTEM_FIELD_IDS, categoryOf, isBlocker, isClosedDefect, isResolvedDefect,
  type FieldValue, type Issue, type JiraFieldDef,
} from "./jiraModel";
import { STAGES, STAGE_LABEL, isReleaseOrLater, stageText, type StageInfo, type StageMapping, type StageStyles } from "./jiraStages";

export * from "./jiraModel";

/* ── Свои поля, участники, списки ──────────────────────────────────────── */

export type OwnFieldType = "text" | "date" | "datetime" | "select" | "multiselect" | "link";

export const OWN_TYPE_LABEL: Record<OwnFieldType, string> = {
  text: "Свободный ввод",
  date: "Дата",
  datetime: "Дата и время",
  select: "Выпадающий список",
  multiselect: "Множественный выбор",
  link: "Ссылка",
};

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

export interface Participant {
  id: string;
  name: string;
  /** Должность — аббревиатура до 3 символов (QA, AQA, LQA, SQA…): видна в цветной метке у ФИО. */
  role: string;
  color: string;
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
  { id: "back", label: "Back" },
  { id: "front", label: "Front" },
  { id: "mobile", label: "Mobile" },
  { id: "dev", label: "Dev" },
  { id: "sup", label: "Sup" },
];
export const roleCol = (id: string): ColRef => `role:${id}`;
export const ROLE_COLS: ColRef[] = ROLE_FIELDS.map(f => roleCol(f.id));
export const isRoleCol = (ref: ColRef) => ref.startsWith("role:");

/** Состояние работы по направлению: серый — не взят, жёлтый — в работе, зелёный — выполнен. */
export type RoleState = "todo" | "doing" | "done";
export const ROLE_STATES: RoleState[] = ["todo", "doing", "done"];
export const ROLE_STATE_LABEL: Record<RoleState, string> = { todo: "Не взят в работу", doing: "В работе", done: "Выполнен" };
export interface RoleValue { name?: string; state?: RoleState }

/** Учитывать ли задачу в нагрузке участника (галочка в строке; авто — по статусу (st)). */
export const LOAD_COL: ColRef = "load";
/** Требования из раздела «Данные», привязанные к задаче (хранятся у SimpleTest, общие на все списки). */
export const REQ_COL: ColRef = "reqs";

export const ST_COLS: ColRef[] = [STAGE_COL, DEFECTS_COL, BLOCK_COL, PARTICIPANT_COL, ...ROLE_COLS, ...SPEND_COLS, LOAD_COL, REQ_COL, FOLDER_COL];

/**
 * Норма для расчёта нагрузки: будни 9:00–18:00 минус час обеда и час утренних встреч — 7 часов в день.
 * Праздники пока не учитываются. Меняется здесь.
 */
export const LOAD_DAY_MINUTES = 7 * 60;

/** Рабочие дни (пн–пт) между датами включительно; даты — «ГГГГ-ММ-ДД». */
export function workdaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00`), b = Date.parse(`${to}T00:00`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d.getTime() <= b; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** Период нагрузки по умолчанию: две недели с сегодняшнего дня. */
export function defaultLoadRange(now = new Date()): { from: string; to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const to = new Date(now); to.setDate(to.getDate() + 13);
  return { from: iso(now), to: iso(to) };
}

export interface LoadRow {
  participant: Participant; planned: number; tasks: number; unplanned: number; capacity: number; over: boolean;
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

/** Нагрузка участников по списку: сумма «Траты план (st)» их учитываемых задач против нормы за период. */
export function listLoad(list: TaskList, participants: Participant[], range: { from: string; to: string },
                         skip: (key: string) => LoadSkip = () => null): LoadRow[] {
  const capacity = workdaysBetween(range.from, range.to) * LOAD_DAY_MINUTES;
  return participants.map(p => {
    const all = list.keys.filter(k => list.assignees[k] === p.id);
    const keys = all.filter(k => !skip(k));
    const planned = keys.reduce((n, k) => n + (list.spend?.[k]?.plan ?? 0), 0);
    return {
      participant: p, planned, tasks: keys.length, capacity, over: planned > capacity, skipped: all.length - keys.length,
      unplanned: keys.filter(k => list.spend?.[k]?.plan == null).length,
    };
  }).sort((a, b) => (b.capacity ? b.planned / b.capacity : 0) - (a.capacity ? a.planned / a.capacity : 0) || b.planned - a.planned);
}

/** Трудозатраты задачи в списке: план в минутах, начало и конец теста — «ГГГГ-ММ-ДДTчч:мм». */
export interface Spend { plan?: number; start?: string; end?: string }

/** 100 → «1 ч 40 мин», 40 → «40 мин», 120 → «2 ч». */
export function fmtMinutes(min: number): string {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60), r = m % 60;
  const text = h ? (r ? `${h} ч ${r} мин` : `${h} ч`) : `${r} мин`;
  return min < 0 ? `−${text}` : text;
}

/**
 * Ввод времени → минуты. Часы: «1.5», «1,5», «1:40», «1 ч 40 мин»; минуты: «100».
 * null — не разобрать.
 */
export function parseDuration(text: string, unit: "h" | "m"): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const hm = /^(\d+):(\d{1,2})$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  // \w в JS не ловит кириллицу — поэтому явный набор букв («ч», «час», «мин», «h», «m»).
  const words = /^(?:(\d+(?:\.\d+)?)\s*(?:ч[а-яё]*|h\w*))?\s*(?:(\d+)\s*(?:м[а-яё]*|m\w*))?$/.exec(t);
  if (words && (words[1] || words[2])) return Math.round(Number(words[1] ?? 0) * 60 + Number(words[2] ?? 0));
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(unit === "h" ? n * 60 : n);
}

/**
 * Рабочее время для «Траты факт»: пн–пт, 9:00–18:00, обед 13:00–14:00 не считается
 * (8 рабочих часов в день). Праздники пока не учитываются. Меняется здесь.
 */
export const WORK_DAY = { start: 9 * 60, end: 18 * 60, lunch: [13 * 60, 14 * 60] as [number, number], days: [1, 2, 3, 4, 5] };

/** Рабочие минуты между двумя моментами (по местному времени). */
export function workingMinutes(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  const intervals: [number, number][] = [[WORK_DAY.start, WORK_DAY.lunch[0]], [WORK_DAY.lunch[1], WORK_DAY.end]];
  let total = 0;
  const day = new Date(fromMs); day.setHours(0, 0, 0, 0);
  for (; day.getTime() < toMs; day.setDate(day.getDate() + 1)) {
    if (!WORK_DAY.days.includes(day.getDay())) continue;
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
export function factMinutes(s: Spend | undefined): number | null {
  if (!s?.start || !s?.end) return null;
  const a = Date.parse(s.start), b = Date.parse(s.end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b < a ? -workingMinutes(b, a) || -1 : workingMinutes(a, b);
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
  /**
   * Источники задач — JQL-фильтр или релиз, из которых задачи добавлены в список. При обновлении кэша
   * их состав сверяется со снимком: новые задачи встают в список с отметкой «n», выпавшие — помечаются «У».
   */
  sources?: ListSource[];
  /** Отметки состава: «new» — пришла из источника (снимается переносом в папку), «removed» — выпала из источника. */
  marks?: Record<string, "new" | "removed">;
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
  /** Шаблоны списков: только структура — порядок колонок, свои поля и папки. */
  templates: ListTemplate[];
  /**
   * Требования (раздел «Данные») по задачам: ключ Jira → id документов. На уровне SimpleTest, а не списка:
   * одна фича бывает в нескольких списках, требования у неё одни.
   */
  reqLinks: Record<string, string[]>;
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
  return { version: 3, lists: [], participants: [], created: [], nextKey: 1, mapping: {}, roleNames: {}, stageStyles: {}, templates: [], reqLinks: {} };
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
          templates: s.templates ?? [],
          reqLinks: s.reqLinks ?? {},
        };
      }
      if (s && Array.isArray(s.lists)) return fromDemo(s);
    }
  } catch { /* приватный режим или битые данные — начинаем заново */ }
  return initialState();
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
    created: s.created.map(i => (i.key === draftKey ? issue : i)),
    lists: s.lists.map(l => ({
      ...l,
      keys: l.keys.map(k => (k === draftKey ? issue.key : k)),
      assignees: remap(l.assignees) ?? {},
      values: remap(l.values) ?? {},
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
}

/** Дефекты задачи по индексу из defectIndex(); у самих дефектов — null. */
export function makeDefectsOf(index: Map<string, Issue[]>) {
  return (issue: Issue): Issue[] | null => (categoryOf(issue) === "defect" ? null : index.get(issue.key) ?? []);
}

/**
 * Неустранённый дефект: всё, кроме «Подтверждено исправление» и «Закрыт». Блокирующий — строже:
 * неустранён, пока не «Закрыт» (как и «Заблокирован» в статусе (st)), чтобы дефект, который держит
 * задачу заблокированной, всегда был виден в «Дефекты (st)» и «Блок (st)».
 */
export function isOpenDefect(d: Issue): boolean {
  return !isResolvedDefect(d) || (isBlocker(d) && !isClosedDefect(d));
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
  if (ref === PLAN_COL) return "Траты план (st)";
  if (ref === START_COL) return "Начало теста (st)";
  if (ref === END_COL) return "Конец теста (st)";
  if (ref === FACT_COL) return "Траты факт (st)";
  if (ref === LOAD_COL) return "Нагрузка (st)";
  if (ref === REQ_COL) return "Требования (st)";
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
    const f = factMinutes(ctx.list.spend?.[issue.key]);
    v = f == null ? null : String(f);
  } else if (ref === START_COL || ref === END_COL) {
    v = ctx.list.spend?.[issue.key]?.[ref === START_COL ? "start" : "end"] ?? null;
  } else if (ref === REQ_COL) {
    v = ctx.reqsOf?.(issue.key) ?? null;
  } else if (ref === LOAD_COL) {
    const why = loadSkip(ctx.list, issue, ctx.stageOf);
    v = why === "manual" ? "Не учитывается (вручную)" : why === "stage" ? "Не учитывается (статус)" : "Учитывается";
  } else if (isRoleCol(ref)) {
    v = ctx.list.roles?.[issue.key]?.[ref.slice(5)]?.name ?? null;
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
export function groupIssues(issues: Issue[], levels: ColRef[], ctx: ColCtx, parentPath = "", top = true): GroupNode[] {
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
  if (top) {
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
    return { label, field: colLabel(ref, ctx.list), ref, path, issues: items, children: groupIssues(items, rest, ctx, path, false) };
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
 * «Скопировать в чат»: по фиче — код, наименование, статус (st), дефекты, участник; под фичей —
 * её неустранённые дефекты (номер, наименование, статус, приоритет); между фичами — пустая строка.
 */
export function chatReport(sections: ReportSection[], ctx: ColCtx): string {
  const out: string[] = [];
  for (const sec of sections) {
    if (!sec.issues.length) continue;
    if (sec.folder !== null) out.push(`*${sec.folder}*`);
    for (const i of sec.issues) {
      const defects = ctx.defectsOf(i);
      const open = defects?.filter(isOpenDefect) ?? [];
      const p = ctx.participants.find(x => x.id === ctx.list.assignees[i.key]);
      const parts = [`*${i.key}*`, String(i.fields.summary ?? ""), stageText(ctx.stageOf(i))];
      if (defects !== null) parts.push(open.length ? `дефектов: ${open.length}` : "дефектов нет");
      parts.push(p ? p.name : "участник не назначен");
      out.push(parts.join(" — "));
      for (const d of open) {
        out.push(`    • ${d.key} ${String(d.fields.summary ?? "")} — ${String(d.fields.status ?? "—")} — ${String(d.fields.priority ?? "—")}`);
      }
      out.push("");
    }
  }
  return out.join("\n").trimEnd();
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
