/**
 * Мок-Jira для Jira tool: проекты, их поля, workflow (переходы статусов) и задачи.
 *
 * Повторяет устройство настоящей Jira Server 9.12 Сбера:
 * - поля общие на весь сервер, но у проекта используется только часть — её и показываем;
 * - статус меняется только переходом workflow, переходы зависят от типа задачи;
 * - сторя привязана к эпику полем Epic Link (customfield_10006).
 * Имена статусов и типов — из реальной выгрузки Jira (Json Jira.json).
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
  /** Задача создана в SimpleTest (в мок-режиме — только в этом браузере). */
  local?: boolean;
}

/* ── Поля ──────────────────────────────────────────────────────────────── */

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

const CF: Record<string, JiraFieldDef> = Object.fromEntries(([
  ["customfield_10006", "Epic Link", "text"],
  ["customfield_10007", "Epic Name", "text"],
  ["customfield_11600", "Тип Дефекта", "option"],
  ["customfield_11507", "Этап обнаружения", "option"],
  ["customfield_22400", "ИТ-услуга", "option"],
  ["customfield_18300", "КЭ", "text"],
  ["customfield_24500", "Роль", "option"],
  ["customfield_10002", "Story Points", "number"],
  ["customfield_30100", "Система-источник", "option"],
  ["customfield_30101", "Канал", "option"],
  ["customfield_30200", "Критичность услуги", "option"],
  ["customfield_30201", "Команда сопровождения", "option"],
] as const).map(([id, name, kind]) => [id, { id, name, kind, custom: true } as JiraFieldDef]));

/* ── Проекты ───────────────────────────────────────────────────────────── */

export interface ProjectDef {
  key: string;
  name: string;
  /** Пользовательские поля, которые реально заполнены в задачах проекта. */
  customFields: string[];
  components: string[];
  versions: string[];
}

export const PROJECTS: ProjectDef[] = [
  {
    key: "SBER911", name: "Sber911",
    customFields: ["customfield_10006", "customfield_10007", "customfield_11600", "customfield_11507", "customfield_22400",
                   "customfield_18300", "customfield_24500", "customfield_10002"],
    components: ["Back-end", "Front-end", "Android", "iOS", "QA", "Analytics", "devops"],
    versions: ["Релиз 16/10. БС", "Релиз 16/10. Агенты", "Релиз 30/10. БС", "Релиз 30/10. Агенты"],
  },
  {
    key: "PKAP", name: "ПКАП",
    customFields: ["customfield_10006", "customfield_10007", "customfield_11600", "customfield_30100", "customfield_30101",
                   "customfield_10002"],
    components: ["Интеграция", "Ядро", "Отчёты", "QA"],
    versions: ["ПКАП 2.14", "ПКАП 2.15"],
  },
  {
    key: "MONIT", name: "Мониторинг ИТ-услуг",
    customFields: ["customfield_10006", "customfield_10007", "customfield_22400", "customfield_30200", "customfield_30201"],
    components: ["Сбор метрик", "Алертинг", "Дашборды"],
    versions: ["Мониторинг Q4"],
  },
];

export const DEFAULT_PROJECT = "SBER911";
export const projectOf = (key: string) => PROJECTS.find(p => p.key === key) ?? PROJECTS[0];
export const projectKeyOfIssue = (issueKey: string) => issueKey.split("-")[0];

/** Поля проекта: системные + используемые в проекте пользовательские. */
export function projectFields(project: string): JiraFieldDef[] {
  return [...SYSTEM_FIELDS, ...projectOf(project).customFields.map(id => CF[id]).filter(Boolean)];
}

/** Все поля всех проектов — для подписей колонок и разбора JQL. */
export const ALL_FIELDS: JiraFieldDef[] = [...SYSTEM_FIELDS, ...Object.values(CF)];
export const FIELD_BY_ID: Record<string, JiraFieldDef> = Object.fromEntries(ALL_FIELDS.map(f => [f.id, f]));

export const PRIORITIES = ["Блокирующий", "Критичный", "Высокий", "Средний", "Низкий"];

/**
 * Устранённый дефект — только «Подтверждено исправление» и «Закрыт» (и английские варианты).
 * «Выполнен» и «Отклонен» устранёнными не считаются — так задумано (решение Стефана, 11.10.2026):
 * исправление должен подтвердить тестировщик, а отклонение — инициатор, переведя дефект в «Закрыт».
 * До этого дефект висит в «Дефекты (st)», а блокирующий — ещё и в «Блок (st)».
 */
const RESOLVED_DEFECT_STATUSES = new Set([
  "подтверждено исправление", "исправление подтверждено", "закрыт", "закрыто",
  "fix confirmed", "fix verified", "verified", "closed",
]);

export function isResolvedDefect(d: Issue): boolean {
  return RESOLVED_DEFECT_STATUSES.has(String(d.fields.status ?? "").toLowerCase().trim());
}

/** Блокирующий приоритет (русский и английский вариант). */
export function isBlocker(d: Issue): boolean {
  return ["блокирующий", "blocker"].includes(String(d.fields.priority ?? "").toLowerCase());
}
export const RESOLUTIONS = ["Исправлен", "Выполнен", "Не будет исправлен", "Дубликат", "Не воспроизводится"];

/* ── Типы задач и workflow ─────────────────────────────────────────────── */

/** Группы типов: у каждой свой workflow и своё сопоставление статусов с этапами. */
export type Category = "epic" | "story" | "defect" | "other";

export const CATEGORY_LABEL: Record<Category, string> = {
  epic: "Эпики", story: "Стори", defect: "Дефекты", other: "Прочие задачи",
};

/** «История» — это системный тип Story в русской Jira. Sub-Story в расчёт эпика не входит. */
export const STORY_TYPES = ["История", "Story", "User Story", "Enabler Story"];
export const DEFECT_TYPES = ["Дефект", "BUG SBERBANK", "Vendor Bug", "Дефект документации"];

export function categoryOf(issue: Issue): Category {
  const t = String(issue.fields.issuetype ?? "");
  if (t === "Epic") return "epic";
  if (STORY_TYPES.includes(t)) return "story";
  if (DEFECT_TYPES.includes(t)) return "defect";
  return "other";
}

interface Workflow {
  /** Статусы в порядке движения задачи — для сортировки и группировки. */
  order: string[];
  next: Record<string, string[]>;
  /** На переходе в эти статусы Jira требует «Решение». */
  needResolution: string[];
}

export const WORKFLOWS: Record<Category, Workflow> = {
  defect: {
    order: ["Открыт", "В работе", "Готов к тестированию", "Переоткрыт", "Выполнен", "Подтверждено исправление", "Закрыт", "Отклонен"],
    next: {
      "Открыт": ["В работе", "Отклонен"],
      "В работе": ["Готов к тестированию", "Отклонен"],
      "Готов к тестированию": ["Выполнен", "Переоткрыт"],
      "Переоткрыт": ["В работе"],
      "Выполнен": ["Подтверждено исправление", "Переоткрыт"],
      "Подтверждено исправление": ["Закрыт", "Переоткрыт"],
      "Закрыт": ["Переоткрыт"],
      "Отклонен": ["Открыт"],
    },
    needResolution: ["Выполнен", "Отклонен"],
  },
  story: {
    order: ["Анализ", "Разработка", "Готово к тестированию", "Ready for IFT", "IFT", "Ready for ST", "ST", "Готово к ПСИ",
            "ПСИ", "Выполнено", "Отменено"],
    next: {
      "Анализ": ["Разработка", "Отменено"],
      "Разработка": ["Готово к тестированию", "Отменено"],
      "Готово к тестированию": ["Ready for IFT", "Разработка"],
      "Ready for IFT": ["IFT"],
      "IFT": ["Ready for ST", "Разработка"],
      "Ready for ST": ["ST"],
      "ST": ["Готово к ПСИ", "Разработка"],
      "Готово к ПСИ": ["ПСИ"],
      "ПСИ": ["Выполнено", "Разработка"],
      "Выполнено": [],
      "Отменено": ["Анализ"],
    },
    needResolution: ["Выполнено", "Отменено"],
  },
  epic: {
    order: ["Открыт", "В работе", "Закрыт"],
    next: { "Открыт": ["В работе"], "В работе": ["Закрыт"], "Закрыт": ["В работе"] },
    needResolution: ["Закрыт"],
  },
  other: {
    order: ["Открыт", "В работе", "Выполнен"],
    next: { "Открыт": ["В работе"], "В работе": ["Выполнен", "Открыт"], "Выполнен": ["Открыт"] },
    needResolution: ["Выполнен"],
  },
};

/** Порядок статусов для сортировки: по workflow сторей, затем дефектов и остальных. */
export const STATUS_ORDER: string[] = Array.from(new Set([
  ...WORKFLOWS.story.order, ...WORKFLOWS.defect.order, ...WORKFLOWS.other.order, ...WORKFLOWS.epic.order,
]));

/** Переходы, доступные задаче из её текущего статуса. */
export function transitionsOf(issue: Issue): string[] {
  return WORKFLOWS[categoryOf(issue)].next[String(issue.fields.status ?? "")] ?? [];
}

/** Статусы, которые встречаются у задач этой группы в проекте (для настройки сопоставления). */
export function statusesOf(category: Category): string[] {
  return WORKFLOWS[category].order;
}

/* ── Мок-задачи ────────────────────────────────────────────────────────── */

const PEOPLE = ["Иванов Илья", "Петрова Анна", "Сидоров Кирилл", "Кузнецова Мария", "Смирнов Денис", "Орлова Вера"];

const DEFECT_TITLES = [
  "Не обновляется счётчик участников ТКС после удаления",
  "Фильтр по услугам сбрасывается при переходе между вкладками",
  "Виджет «Инциденты на моих услугах» показывает закрытые инциденты",
  "Дублируются уведомления о новом инциденте в мобильном приложении",
  "Неверный часовой пояс в карточке инцидента",
  "Пустой экран после авторизации по СберID на iOS 17",
  "Таймаут ответа сервиса метрик при выборке за 30 дней",
  "Кнопка «Взять в работу» неактивна для роли дежурного",
  "Ошибка 500 при сохранении избранных ТКС",
  "Не применяется сортировка по приоритету в списке инцидентов",
  "Глобальный поиск не находит услугу по КЭ",
  "Скачивание отчёта в Excel обрезает длинные названия",
  "Нет push-уведомления о смене статуса инцидента на Android",
  "Алерт из Kafka не создаёт инцидент при пустом поле recipients",
  "Ранбук не подтягивает шаги для инцидентов с типом «Деградация»",
  "Дашборд ИТ-услуг падает при отсутствии метрик за период",
  "Смещена вёрстка карточки инцидента на ширине 1280",
  "Не сохраняется комментарий длиннее 4000 символов",
  "Неверно считается SLA при переоткрытии инцидента",
  "Эндпоинт /incidents/search игнорирует параметр limit",
];

/**
 * Эпики подобраны так, чтобы показать все варианты расчёта этапа:
 * все стори готовы к ПСИ → «Готово к релизу», часть в тестировании → «Тестирование»,
 * хоть одна в разработке → «Разработка», сторей нет → красный, без этапа.
 */
const EPICS: { project: string; key: string; name: string; stories: [string, string][] }[] = [
  { project: "SBER911", key: "SBER911-28010", name: "Глобальный фильтр по услугам", stories: [
    ["Фильтр по услугам в шапке РМС", "Готово к ПСИ"], ["Сохранение выбранных услуг", "ПСИ"],
    ["Фильтр в мобильном приложении", "Выполнено"], ["Фильтр по КЭ (отказались)", "Отменено"],
  ] },
  { project: "SBER911", key: "SBER911-28044", name: "Избранные ТКС на виджете «ТКС и Jazz»", stories: [
    ["Отметка ТКС избранной", "IFT"], ["Избранные сверху списка", "Готово к ПСИ"], ["Синхронизация избранного", "ST"],
  ] },
  { project: "SBER911", key: "SBER911-28102", name: "Подключение ранбука к инцидентам", stories: [
    ["Привязка ранбука к типу инцидента", "Готово к тестированию"], ["Шаги ранбука в карточке", "Разработка"],
    ["Отметка выполнения шага", "Анализ"],
  ] },
  { project: "SBER911", key: "SBER911-28150", name: "Сценарий алерт → инцидент для Kafka", stories: [] },
  { project: "PKAP", key: "PKAP-1200", name: "Выгрузка отчётов ПКАП в новый формат", stories: [
    ["Формат отчёта v2", "Ready for ST"], ["Миграция старых отчётов", "Готово к ПСИ"],
  ] },
  { project: "MONIT", key: "MONIT-310", name: "Алертинг по деградации услуг", stories: [
    ["Порог деградации на услугу", "Разработка"], ["Уведомление дежурному", "Готово к тестированию"],
  ] },
];

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

function buildMockIssues(): Issue[] {
  const r = rng(911);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const base = Date.UTC(2026, 9, 11, 9, 0);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  const out: Issue[] = [];

  const common = (project: ProjectDef, created: number) => ({
    assignee: r() < 0.15 ? null : pick(PEOPLE),
    reporter: pick(PEOPLE),
    components: [pick(project.components)],
    fixVersions: r() < 0.2 ? [] : [pick(project.versions)],
    labels: r() < 0.5 ? [] : [pick(["regress", "smoke", "ift", "prod", "mobile"])],
    created: iso(created),
    updated: iso(created + Math.floor(r() * 5 * 86400000)),
    duedate: r() < 0.5 ? iso(created + 10 * 86400000).slice(0, 10) : null,
    customfield_22400: project.customFields.includes("customfield_22400") ? pick(["Sber911", "ПКАП", "Мониторинг ИТ-услуг"]) : null,
    customfield_18300: project.customFields.includes("customfield_18300") ? `CI0${2260000 + Math.floor(r() * 9000)}` : null,
    customfield_30100: project.customFields.includes("customfield_30100") ? pick(["АС Инциденты", "АС Метрики", "ЕФС"]) : null,
    customfield_30101: project.customFields.includes("customfield_30101") ? pick(["Web", "Мобильный", "API"]) : null,
    customfield_30200: project.customFields.includes("customfield_30200") ? pick(["Mission critical", "Business critical", "Office"]) : null,
    customfield_30201: project.customFields.includes("customfield_30201") ? pick(["ДИТ 1", "ДИТ 2"]) : null,
  });

  // Эпики и их стори.
  for (const e of EPICS) {
    const project = projectOf(e.project);
    const created = base - Math.floor(r() * 40 * 86400000);
    out.push({ key: e.key, fields: {
      ...common(project, created), summary: e.name, issuetype: "Epic", priority: "Высокий",
      status: e.stories.length && e.stories.every(([, s]) => s === "Выполнено" || s === "Отменено") ? "Закрыт" : "В работе",
      resolution: null, description: `Эпик «${e.name}».`, customfield_10007: e.name,
    } });
    const num = Number(e.key.split("-")[1]);
    e.stories.forEach(([title, status], i) => {
      const c2 = created + (i + 1) * 86400000;
      out.push({ key: `${e.project}-${num + i + 1}`, fields: {
        ...common(project, c2), summary: title, issuetype: i === 1 && e.project === "SBER911" ? "User Story" : "История",
        status, priority: pick(PRIORITIES.slice(2)), resolution: status === "Выполнено" ? "Выполнен" : status === "Отменено" ? "Не будет исправлен" : null,
        description: `Стори эпика ${e.key}.`, customfield_10006: e.key, customfield_10002: String(pick([1, 2, 3, 5, 8])),
      } });
    });
  }

  // Дефекты и задачи по проектам.
  const storiesOf = (pk: string) => out.filter(i => i.key.startsWith(`${pk}-`) && STORY_TYPES.includes(String(i.fields.issuetype)))
    .map(i => i.key);
  const plan: [string, number, number][] = [["SBER911", 29200, 40], ["PKAP", 1500, 12], ["MONIT", 400, 8]];
  for (const [pk, start, count] of plan) {
    const project = projectOf(pk);
    const epics = EPICS.filter(e => e.project === pk).map(e => e.key);
    for (let i = 0; i < count; i++) {
      const isTask = i % 7 === 3;
      const wf = WORKFLOWS[isTask ? "other" : "defect"];
      const status = pick(wf.order);
      const created = base - Math.floor(r() * 30 * 86400000);
      const title = DEFECT_TITLES[(i + start) % DEFECT_TITLES.length];
      out.push({ key: `${pk}-${start + i}`, fields: {
        ...common(project, created),
        summary: i >= DEFECT_TITLES.length ? `${title} (повтор)` : title,
        issuetype: isTask ? "Задача" : "Дефект",
        status, priority: pick(isTask ? PRIORITIES.slice(2) : PRIORITIES),
        resolution: ["Выполнен", "Подтверждено исправление", "Закрыт"].includes(status) ? "Исправлен" : status === "Отклонен" ? "Не воспроизводится" : null,
        description: `Шаги воспроизведения и ожидаемый результат — в задаче ${pk}-${start + i}.`,
        environment: isTask ? null : pick(["ИФТ", "ПСИ", "Пром"]),
        customfield_11600: !isTask && project.customFields.includes("customfield_11600")
          ? pick(["Функциональный", "UI/UX", "Производительность", "Интеграция", "Данные"]) : null,
        customfield_11507: !isTask && project.customFields.includes("customfield_11507") ? pick(["Разработка", "ИФТ", "ПСИ", "Пром"]) : null,
        customfield_10006: epics.length && r() < 0.6 ? pick(epics) : null,
        // Связь «relates to» со сторей проекта — так дефекты считаются у стори.
        issuelinks: !isTask && storiesOf(pk).length && r() < 0.45 ? [pick(storiesOf(pk))] : [],
        customfield_24500: project.customFields.includes("customfield_24500") ? pick(["Back", "Front", "Mobile", "QA"]) : null,
      } });
    }
  }
  return out;
}

export const MOCK_ISSUES: Issue[] = buildMockIssues();

/* ── Создание задач ────────────────────────────────────────────────────── */

/** Типы, которые можно создать из списка. Дефект открывает форму с генерацией. */
export const CREATE_TYPES: { type: string; hint: string }[] = [
  { type: "Дефект", hint: "Форма с генерацией описания" },
  { type: "История", hint: "Стори — можно привязать к эпику" },
  { type: "Задача", hint: "Техническая или организационная" },
  { type: "Epic", hint: "Этап посчитается по его сторям" },
];

/** Начальный статус задачи нового типа — первый в его workflow. */
export function initialStatus(type: string): string {
  const cat = type === "Epic" ? "epic" : STORY_TYPES.includes(type) ? "story" : DEFECT_TYPES.includes(type) ? "defect" : "other";
  return WORKFLOWS[cat].order[0];
}

/* ── Structure (ALM Works) ─────────────────────────────────────────────── */

/**
 * Структура — дерево из папок и задач (плагин Structure стоит в Jira Сбера:
 * поле com.almworks.jira.structure). Под задачей могут лежать задачи (эпик → стори).
 * В настоящей Jira: GET /rest/structure/2.0/structure и /rest/structure/2.0/forest/latest.
 */
export interface StructNode { folder?: string; key?: string; children?: StructNode[] }
export interface StructureDef { id: number; name: string; owner: string; root: StructNode[] }

function epicNode(epicKey: string): StructNode {
  return {
    key: epicKey,
    children: MOCK_ISSUES.filter(i => i.fields.customfield_10006 === epicKey && STORY_TYPES.includes(String(i.fields.issuetype)))
      .map(i => ({ key: i.key })),
  };
}

function defectsBy(project: string, by: (i: Issue) => string): StructNode[] {
  const groups = new Map<string, string[]>();
  for (const i of MOCK_ISSUES) {
    if (!i.key.startsWith(`${project}-`) || !DEFECT_TYPES.includes(String(i.fields.issuetype))) continue;
    const g = by(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(i.key);
  }
  return [...groups.entries()].sort().map(([folder, keys]) => ({ folder, children: keys.map(key => ({ key })) }));
}

export const STRUCTURES: StructureDef[] = [
  { id: 1201, name: "Sber911 · Релиз 16/10", owner: "Застылов С.", root: [
    { folder: "Эпики и стори", children: EPICS.filter(e => e.project === "SBER911").map(e => epicNode(e.key)) },
    { folder: "Дефекты", children: defectsBy("SBER911", i => String((i.fields.components as string[])?.[0] ?? "Без компонента")) },
  ] },
  { id: 1305, name: "ПКАП · Регресс 2.15", owner: "Петрова А.", root: [
    { folder: "Эпики и стори", children: [epicNode("PKAP-1200")] },
    { folder: "Дефекты по приоритету", children: defectsBy("PKAP", i => String(i.fields.priority)) },
  ] },
  { id: 1410, name: "Мониторинг · Q4", owner: "Смирнов Д.", root: [
    { folder: "Алертинг", children: [epicNode("MONIT-310")] },
    { folder: "Дефекты", children: defectsBy("MONIT", () => "Все") },
  ] },
];

/** Дерево → ключ задачи и путь папок («Дефекты / Android»). Задача под задачей наследует папку родителя. */
export function flattenStructure(root: StructNode[]): { key: string; folder: string; parent?: string }[] {
  const out: { key: string; folder: string; parent?: string }[] = [];
  const walk = (nodes: StructNode[], path: string[], parent?: string) => {
    for (const n of nodes) {
      if (n.folder) walk(n.children ?? [], [...path, n.folder], parent);
      else if (n.key) {
        out.push({ key: n.key, folder: path.join(" / ") || "Без папки", parent });
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
 * или через связь (issuelinks). У самих дефектов этого поля нет.
 */
export function defectIndex(issues: Issue[]): Map<string, Issue[]> {
  const idx = new Map<string, Issue[]>();
  const add = (k: string, d: Issue) => {
    const arr = idx.get(k) ?? [];
    if (!arr.includes(d)) arr.push(d);
    idx.set(k, arr);
  };
  for (const d of issues) {
    if (categoryOf(d) !== "defect") continue;
    const epic = d.fields.customfield_10006;
    if (typeof epic === "string" && epic) add(epic, d);
    const links = d.fields.issuelinks;
    if (Array.isArray(links)) links.forEach(k => add(k, d));
  }
  return idx;
}
