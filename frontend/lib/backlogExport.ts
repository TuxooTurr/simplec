/**
 * «Выгрузить в Excel» в Jira tool: выбранные задачи списка — таблицей в формате «Бэклога Платформы», который
 * ведут коллеги: Релиз · Команда · Источник · Jira · Название · Дизайн · Аналитика · Бэк · Фронт · Тест.
 *
 * Два листа одной структуры: «Фамилии» — люди направлений, «Нагрузка» — их план трудозатрат в выбранном формате
 * («ч · мин» или «д · ч · мин», переключатель в Jira tool).
 *
 * Откуда берётся значение колонки:
 *  - «Команда» — папка задачи в списке; задача без папки — своё поле списка «Команда» или поле Jira с таким названием;
 *  - «Релиз» — своё поле списка «Релиз», иначе поле Jira с таким названием, иначе «Исправить в версиях» (fixVersions);
 *  - «Источник» — пусто (заполняют руками);
 *  - Дизайн / Аналитика / Бэк / Фронт — человек из полей направлений (st); состояние — только цветом ячейки:
 *    серая — «Не взят в работу», жёлтая — «В работе», зелёная — «Выполнен» (отдельной колонки «готова» нет);
 *  - «Тест» — тестировщик (st) задачи; на листе «Нагрузка» — его план трудозатрат.
 * Файл собирает бэкенд (POST /api/export/xlsx), отсюда — только колонки и строки.
 */

import { authHeaders } from "./authApi";
import { FIELD_BY_ID } from "./jiraModel";
import { PARTICIPANT_COL, colValues, fmtMinutes, roleCol, type ColCtx, type Issue } from "./jiraTool";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface XCell { v: string; link?: string; fill?: string }

/** Цвет ячейки направления по состоянию: не взят — серый, в работе — жёлтый, выполнен — зелёный. */
const FILL = { todo: "D9D9D9", doing: "FFE699", done: "C6E0B4" };

export const BACKLOG_COLUMNS: { title: string; width: number }[] = [
  { title: "Релиз", width: 12 }, { title: "Команда", width: 16 }, { title: "Источник", width: 16 }, { title: "Jira", width: 16 },
  { title: "Название", width: 70 }, { title: "Дизайн", width: 18 }, { title: "Аналитика", width: 20 },
  { title: "Бэк", width: 18 }, { title: "Фронт", width: 18 }, { title: "Тест", width: 18 },
];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Значение по названию колонки: своё поле списка, иначе поле Jira с тем же названием. */
function byName(name: string, issue: Issue, ctx: ColCtx): string {
  const own = ctx.list.ownFields.find(f => same(f.name, name));
  if (own) return colValues(`own:${own.id}`, issue, ctx).join(", ");
  const jira = Object.values(FIELD_BY_ID).find(f => same(f.name, name));
  return jira ? colValues(`jira:${jira.id}`, issue, ctx).join(", ") : "";
}

export type BacklogMode = "people" | "load";

/** Человек направления («people») или его план трудозатрат («load»); заливка — по состоянию направления. */
function role(dir: string, issue: Issue, ctx: ColCtx, mode: BacklogMode): XCell {
  const r = ctx.list.roles?.[issue.key]?.[dir];
  const v = mode === "load" ? (r?.plan != null ? fmtMinutes(r.plan) : "") : colValues(roleCol(dir), issue, ctx).join(", ");
  // Состояние не выбрано — значит, не взят в работу (серый), как и «Не взят в работу».
  return { v, fill: !v ? undefined : FILL[r?.state ?? "todo"] };
}

export function backlogRows(issues: Issue[], ctx: ColCtx, mode: BacklogMode = "people"): XCell[][] {
  return issues.map(i => {
    const testPlan = ctx.list.spend?.[i.key]?.plan;
    return [
      { v: byName("Релиз", i, ctx) || colValues("jira:fixVersions", i, ctx).join(", ") },
      { v: ctx.list.folders?.[i.key] || byName("Команда", i, ctx) },
      { v: "" },
      { v: i.key, link: i.url && /^https?:\/\//.test(i.url) ? i.url : undefined },
      { v: String(i.fields.summary ?? "") },
      role("design", i, ctx, mode),
      role("analytics", i, ctx, mode),
      role("back", i, ctx, mode),
      role("front", i, ctx, mode),
      { v: mode === "load" ? (testPlan != null ? fmtMinutes(testPlan) : "") : colValues(PARTICIPANT_COL, i, ctx).join(", ") },
    ];
  });
}

/** Собрать файл на бэкенде и скачать. Возвращает имя файла. */
export async function downloadBacklog(listName: string, issues: Issue[], ctx: ColCtx): Promise<string> {
  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const filename = `Бэклог — ${listName} — ${stamp}.xlsx`.replace(/[\\/:*?"<>|]+/g, "_");
  const res = await fetch(`${API_BASE}/api/export/xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ filename, sheets: [
      { name: "Фамилии", columns: BACKLOG_COLUMNS, rows: backlogRows(issues, ctx, "people") },
      { name: "Нагрузка", columns: BACKLOG_COLUMNS, rows: backlogRows(issues, ctx, "load") },
    ] }),
  });
  if (!res.ok) throw new Error(`Excel не собрался: ${(await res.text()).slice(0, 200)}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return filename;
}
