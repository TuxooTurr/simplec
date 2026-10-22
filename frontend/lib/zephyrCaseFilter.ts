/**
 * Список кейсов Zephyr Tool: колонки, сортировка и фильтры по всем полям (как в Jira tool) и шаблоны фильтров.
 *
 * Колонка — стандартное поле кейса («status», «priority»…) или пользовательское («cf:Крит. регресс»).
 * Фильтр — как в Excel: колонка → отмеченные значения ("" — пусто). Работает на уровне выбранной папки: фильтруются
 * кейсы, которые сейчас в списке (папка, с тумблером — и вложенные). Шаблон фильтра — набор фильтров и сортировка
 * под именем; применяется к любой папке. Шаблоны — в localStorage (st_zephyr_filter_tpls, входят в резервную копию).
 */

import { fmtDuration, type ZCase } from "./zephyrApi";

export type CaseColId = string;
export type CaseSort = { col: CaseColId; dir: 1 | -1 } | null;
export type CaseFilters = Record<CaseColId, string[]>;

export interface FilterTemplate { id: string; name: string; filters: CaseFilters; sort: CaseSort }

/** Стандартные поля кейса: ключ и название видны всегда, остальные — по «Колонкам». */
export const STD_COLS: { id: CaseColId; label: string }[] = [
  { id: "status", label: "Статус" }, { id: "priority", label: "Приоритет" }, { id: "duration", label: "Длительность" },
  { id: "owner", label: "Владелец" }, { id: "folder", label: "Папка" }, { id: "labels", label: "Метки" },
  { id: "issueLinks", label: "Связи" }, { id: "updated", label: "Изменён" },
];
const STATUS_RU: Record<string, string> = { approved: "Утверждено", draft: "Черновик", deprecated: "Устарел" };

export const cfCol = (name: string) => `cf:${name}`;
export const isCfCol = (c: CaseColId) => c.startsWith("cf:");

export function colLabel(c: CaseColId): string {
  if (c === "key") return "Ключ";
  if (c === "name") return "Название";
  if (isCfCol(c)) return c.slice(3);
  return STD_COLS.find(x => x.id === c)?.label ?? c;
}

/** Значения кейса в колонке (для фильтра — каждое отдельно; пусто — []). */
export function caseValues(c: ZCase, col: CaseColId): string[] {
  if (isCfCol(col)) {
    const v = c.customFields?.[col.slice(3)];
    return v == null ? [] : Array.isArray(v) ? v : [v];
  }
  switch (col) {
    case "key": return [c.key];
    case "name": return c.name ? [c.name] : [];
    case "status": return c.status ? [STATUS_RU[c.status.toLowerCase()] ?? c.status] : [];
    case "priority": return c.priority ? [c.priority] : [];
    case "owner": return c.owner ? [c.owner] : [];
    case "folder": return c.folder ? [c.folder] : [];
    case "labels": return c.labels ?? [];
    case "issueLinks": return c.issueLinks ?? [];
    case "duration": return c.estimatedTime ? [fmtDuration(c.estimatedTime)] : [];
    case "updated": return c.updated ? [c.updated.slice(0, 10)] : [];
    default: return [];
  }
}

/** Приоритет по смыслу, а не по алфавиту: High → Normal → Low (и русские названия). */
const PRIORITY_RANK: Record<string, number> = {
  blocker: 0, critical: 1, highest: 1, high: 2, "высокий": 2, normal: 3, medium: 3, "средний": 3, "нормальный": 3,
  low: 4, "низкий": 4, lowest: 5,
};

/** Ключ сортировки: числа и даты — как числа (длительность — в мс, ключ — по номеру), приоритет — по смыслу,
 * текст — без регистра. */
function sortKey(c: ZCase, col: CaseColId): string | number {
  if (col === "duration") return c.estimatedTime ?? -1;
  if (col === "priority") return c.priority ? PRIORITY_RANK[c.priority.toLowerCase()] ?? 9 : -1;
  if (col === "key") { const m = /(\d+)$/.exec(c.key); return m ? Number(m[1]) : c.key; }
  if (col === "updated") return c.updated ?? "";
  return caseValues(c, col).join(", ").toLowerCase();
}

export function sortCases(cases: ZCase[], sort: CaseSort): ZCase[] {
  if (!sort) return cases;
  const empty = (v: string | number) => v === "" || v === -1;
  return [...cases].sort((a, b) => {
    const x = sortKey(a, sort.col), y = sortKey(b, sort.col);
    if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;        // пустые — всегда внизу
    const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru", { numeric: true });
    return d * sort.dir;
  });
}

/** Кейс проходит фильтры: по каждой колонке хотя бы одно его значение отмечено ("" — пусто). */
export function passes(c: ZCase, filters: CaseFilters, except?: CaseColId): boolean {
  for (const [col, allowed] of Object.entries(filters)) {
    if (col === except) continue;
    const vals = caseValues(c, col);
    if (vals.length ? !vals.some(v => allowed.includes(v)) : !allowed.includes("")) return false;
  }
  return true;
}

/** Варианты фильтра колонки с числом кейсов — с учётом остальных фильтров (как в Jira tool). */
export function filterOptions(cases: ZCase[], col: CaseColId, filters: CaseFilters): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    if (!passes(c, filters, col)) continue;
    const vals = caseValues(c, col);
    for (const v of vals.length ? vals : [""]) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0], "ru", { numeric: true })))
    .map(([value, count]) => ({ value, label: value || "(пусто)", count }));
}

/** Пользовательские поля, которые встречаются у кейсов списка, — для «Колонок». */
export function customFieldNames(cases: ZCase[]): string[] {
  const names = new Set<string>();
  for (const c of cases) for (const n of Object.keys(c.customFields ?? {})) names.add(n);
  return [...names].sort((a, b) => a.localeCompare(b, "ru"));
}

/* ── Шаблоны фильтров ── */

const TPL_KEY = "st_zephyr_filter_tpls";

export function loadTemplates(): FilterTemplate[] {
  try { const v = JSON.parse(localStorage.getItem(TPL_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function saveTemplates(t: FilterTemplate[]): void {
  try { localStorage.setItem(TPL_KEY, JSON.stringify(t)); } catch { /* не сохранится — живут до перезагрузки */ }
}

/** Коротко, что в шаблоне: «Статус: Черновик · Крит. регресс: Да, Нет». */
export function describeFilters(filters: CaseFilters): string {
  return Object.entries(filters).map(([c, v]) => `${colLabel(c)}: ${v.map(x => x || "(пусто)").join(", ")}`).join(" · ");
}
