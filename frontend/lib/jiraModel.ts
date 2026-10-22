/**
 * Модель Jira для Jira tool: типы задач, справочники сервера и правила SimpleTest.
 *
 * Данные — из настоящей Jira (бэкенд /api/jira/tool/*, подключение из Настройки → Jira).
 * Справочники (поля, статусы, приоритеты, решения) общие на весь сервер Jira, поэтому
 * живут здесь одним экземпляром и заполняются из каталога (setCatalog) при открытии
 * раздела. До загрузки каталога известны только системные поля Jira.
 */

export type JiraKind = "text" | "longtext" | "user" | "option" | "multi" | "date" | "datetime" | "number";

export interface JiraFieldDef {
  id: string;
  name: string;
  kind: JiraKind;
  custom: boolean;
}

export type FieldValue = string | string[] | null;

export interface Issue {
  key: string;
  fields: Record<string, FieldValue>;
  /** Черновик SimpleTest: в Jira ещё не отправлялся, хранится в этом браузере. */
  local?: boolean;
  /** Ссылка на задачу в Jira. */
  url?: string;
}

/* ── Справочники сервера Jira ──────────────────────────────────────────── */

/** Системные поля Jira — есть на любом сервере; каталог уточнит их названия. */
const SYSTEM_FIELDS: JiraFieldDef[] = [
  { id: "summary",     name: "Тема",                kind: "text",     custom: false },
  { id: "issuetype",   name: "Тип задачи",          kind: "option",   custom: false },
  { id: "status",      name: "Статус",              kind: "option",   custom: false },
  { id: "priority",    name: "Приоритет",           kind: "option",   custom: false },
  { id: "assignee",    name: "Исполнитель",         kind: "user",     custom: false },
  { id: "reporter",    name: "Автор",               kind: "user",     custom: false },
  { id: "components",  name: "Компоненты",          kind: "multi",    custom: false },
  { id: "fixVersions", name: "Исправить в версиях", kind: "multi",    custom: false },
  { id: "labels",      name: "Метки",               kind: "multi",    custom: false },
  { id: "resolution",  name: "Решение",             kind: "option",   custom: false },
  { id: "created",     name: "Создано",             kind: "datetime", custom: false },
  { id: "updated",     name: "Обновлено",           kind: "datetime", custom: false },
  { id: "duedate",     name: "Срок исполнения",     kind: "date",     custom: false },
  { id: "description", name: "Описание",            kind: "longtext", custom: false },
  { id: "environment", name: "Окружение",           kind: "longtext", custom: false },
  { id: "issuelinks",  name: "Связанные задачи",    kind: "multi",    custom: false },
];
export const SYSTEM_FIELD_IDS = new Set(SYSTEM_FIELDS.map(f => f.id));

export interface JiraCatalog {
  base_url: string;
  fields: JiraFieldDef[];
  /** id поля Epic Link на этом сервере (определяется по типу поля). */
  epic_link: string;
  /** Статусы сервера: «к выполнению» → «в работе» → «готово». */
  statuses: { name: string; category: string }[];
  priorities: string[];
  resolutions: string[];
}

/** Все известные поля по id — для подписей колонок, типов ячеек и форматов дат. */
export const FIELD_BY_ID: Record<string, JiraFieldDef> = Object.fromEntries(SYSTEM_FIELDS.map(f => [f.id, f]));
/** Порядок статусов для сортировки и групп — по категориям статусов Jira. */
export const STATUS_ORDER: string[] = [];
/** Приоритеты в порядке Jira: от самого высокого. */
export const PRIORITIES: string[] = [];
export const RESOLUTIONS: string[] = [];
const EPIC = { link: "customfield_10006" };

/** id поля Epic Link (у Jira Сбера — customfield_10006, уточняется каталогом). */
export const epicLinkId = () => EPIC.link;

/**
 * Каталог сервера → общие справочники. Меняем на месте: на эти объекты ссылаются
 * функции сортировки и подписей, так они сразу видят данные настоящей Jira.
 */
export function setCatalog(c: JiraCatalog): void {
  for (const f of c.fields) FIELD_BY_ID[f.id] = f;
  STATUS_ORDER.splice(0, STATUS_ORDER.length, ...c.statuses.map(s => s.name));
  PRIORITIES.splice(0, PRIORITIES.length, ...c.priorities);
  RESOLUTIONS.splice(0, RESOLUTIONS.length, ...c.resolutions);
  if (c.epic_link) EPIC.link = c.epic_link;
}

/** Проект по умолчанию для новых списков. */
export const DEFAULT_PROJECT = "SBER911";
export const projectKeyOfIssue = (issueKey: string) => issueKey.split("-")[0];

/* ── Дефекты: устранён ли, блокирует ли ────────────────────────────────── */

/**
 * Неактивный (устранённый) дефект: «Подтверждение исправления» / «Подтверждено исправление», «Исключено», «Отложен»,
 * «Отклонен исполнителем» (23.10.2026), «Закрыт» (и английские варианты). Такой дефект не считается ни в «Дефекты (st)», ни в «Блок (st)», и блокирующий
 * не делает стори и эпик «Заблокирован» (решение Стефана, 22.10.2026; раньше блокирующий держал блокировку до
 * «Закрыт»). Остальные статусы дефекта — активные.
 */
const RESOLVED_DEFECT_STATUSES = new Set([
  "подтверждение исправления", "подтверждено исправление", "исправление подтверждено", "закрыт", "закрыто",
  "исключено", "исключен", "исключён", "отложен", "отложено", "отклонен исполнителем", "отклонён исполнителем",
  "fix confirmed", "fix verified", "verified", "closed", "deferred", "postponed", "excluded",
]);

export function isResolvedDefect(d: Issue): boolean {
  return RESOLVED_DEFECT_STATUSES.has(String(d.fields.status ?? "").toLowerCase().trim().replace(/\s+/g, " "));
}

/** Блокирующий приоритет (русский и английский вариант). */
export function isBlocker(d: Issue): boolean {
  return ["блокирующий", "blocker"].includes(String(d.fields.priority ?? "").toLowerCase());
}

/* ── Типы задач ────────────────────────────────────────────────────────── */

/** Группы типов: у каждой своё сопоставление статусов со статусом (st). */
export type Category = "epic" | "story" | "defect" | "other";

export const CATEGORY_LABEL: Record<Category, string> = {
  epic: "Эпики", story: "Стори", defect: "Дефекты", other: "Прочие задачи",
};

/** Имена типов из Jira Сбера. «История» — системный Story в русской Jira; Sub-Story в расчёт эпика не входит. */
export const EPIC_TYPES = ["Epic", "Эпик"];
export const STORY_TYPES = ["История", "Story", "User Story", "Enabler Story"];
export const DEFECT_TYPES = ["Дефект", "Bug", "BUG SBERBANK", "Vendor Bug", "Дефект документации"];

export function typeCategory(type: string): Category {
  if (EPIC_TYPES.includes(type)) return "epic";
  if (STORY_TYPES.includes(type)) return "story";
  if (DEFECT_TYPES.includes(type)) return "defect";
  return "other";
}

export function categoryOf(issue: Issue): Category {
  return typeCategory(String(issue.fields.issuetype ?? ""));
}

/** Типы, которые создаются из списка (эпики и стори здесь не заводят). */
export const CREATE_TYPES: { type: string; hint: string }[] = [
  { type: "Дефект", hint: "Регистрация дефекта: генерация описания, поля Jira, вложения" },
  { type: "Задача", hint: "Техническая или организационная задача" },
];

/* ── Structure (ALM Works) ─────────────────────────────────────────────── */

/** Дерево структуры: папки и задачи; под задачей могут лежать задачи (эпик → стори). */
export interface StructNode { folder?: string; key?: string; children?: StructNode[] }
export interface StructureInfo { id: number; name: string; owner: string; description?: string }

/** Дерево → ключ задачи и путь папок («Дефекты / Android»). Задача под задачей наследует папку родителя. */
export function flattenStructure(root: StructNode[]): { key: string; folder: string; parent?: string }[] {
  const out: { key: string; folder: string; parent?: string }[] = [];
  const seen = new Set<string>();
  const walk = (nodes: StructNode[], path: string[], parent?: string) => {
    for (const n of nodes) {
      if (n.folder) walk(n.children ?? [], [...path, n.folder], parent);
      else if (n.key) {
        // Одна задача может стоять в структуре дважды — в список она попадает один раз, в первую папку.
        if (!seen.has(n.key)) {
          seen.add(n.key);
          out.push({ key: n.key, folder: path.join(" / ") || "Без папки", parent });
        }
        walk(n.children ?? [], path, n.key);
      }
    }
  };
  walk(root, []);
  return out;
}

/* ── Дефекты задачи ────────────────────────────────────────────────────── */

/**
 * Дефекты, относящиеся к задаче: привязанные к ней через Epic Link (для эпика)
 * или связанные с ней (issuelinks — связь видна с обеих сторон, учитываем обе).
 */
export function defectIndex(issues: Issue[]): Map<string, Issue[]> {
  const idx = new Map<string, Issue[]>();
  const byKey = new Map(issues.map(i => [i.key, i]));
  const add = (k: string, d: Issue) => {
    const arr = idx.get(k) ?? [];
    if (!arr.includes(d)) arr.push(d);
    idx.set(k, arr);
  };
  const epic = epicLinkId();
  for (const i of issues) {
    const links = Array.isArray(i.fields.issuelinks) ? i.fields.issuelinks : [];
    if (categoryOf(i) === "defect") {
      const e = i.fields[epic];
      if (typeof e === "string" && e) add(e, i);
      links.forEach(k => add(k, i));
    } else {
      for (const k of links) {
        const d = byKey.get(k);
        if (d && categoryOf(d) === "defect") add(i.key, d);
      }
    }
  }
  return idx;
}
