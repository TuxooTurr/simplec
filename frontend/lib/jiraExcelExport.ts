import { sortIssueRows } from "../components/jiratool/IssueTable";
import { authHeaders } from "./authApi";
import { FIELD_BY_ID } from "./jiraModel";
import { stageText, textOn, type StageInfo } from "./jiraStages";
import { BLOCK_COL, DEFECTS_COL, LOAD_COL, PARTICIPANT_COL, REQ_COL, blockersOf, colLabel, colValues, fmtJiraDate,
  isOpenDefect, isRoleCol, jiraDateKind, linkHref, type ColCtx, type ColRef, type Issue } from "./jiraTool";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const KEY = "__key";
const CHIP = "[data-xlsx-chip]";
type RGB = [number, number, number];
type Tone = { fill: string; ink: string };
type Format = "duration" | "date" | "datetime" | "bug";
type Cell = { v: string | number; link?: string; sheetId?: string; format?: Format; bold?: boolean; rowSpan?: number;
  runs?: { text: string; ink?: string }[] } & Partial<Tone>;
type Column = { title: string; width: number; group?: string };

const white: RGB = [255, 255, 255];
const hex = (rgb: RGB) => rgb.map(x => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();

/** CSS rgba превращается в непрозрачный цвет на том же фоне, что у таблицы. */
function rgb(css: string, background: RGB): RGB | undefined {
  if (!/^rgba?\(/.test(css)) return undefined;
  const [r, g, b, opacity = 1] = Array.from(css.matchAll(/[\d.]+/g), m => Number(m[0]));
  if (!opacity || b === undefined) return undefined;
  return [r, g, b].map((x, i) => Math.max(0, Math.min(255, x * opacity + background[i] * (1 - opacity)))) as RGB;
}

function tone(el: Element, background: RGB): Partial<Tone> {
  const css = getComputedStyle(el);
  const fill = rgb(css.backgroundColor, background);
  if (fill && (el as HTMLElement).dataset.xlsxChip === "dot") {
    return { fill: hex(fill), ink: textOn(`#${hex(fill)}`).replace("#", "") };
  }
  const ink = rgb(css.color, fill ?? background);
  return { ...(fill && { fill: hex(fill) }), ...(ink && { ink: hex(ink) }) };
}

/** В Excel заливка общая для всей ячейки, разные цвета меток сохраняем цветом текста. */
function chipsCell(chips: HTMLElement[], background: RGB): Partial<Cell> {
  if (!chips.length) return {};
  if (chips.length === 1) return tone(chips[0], background);
  const light = textOn(`#${hex(background)}`) !== "#ffffff";
  return { runs: chips.flatMap((chip, i) => {
    const { fill, ink } = tone(chip, background);
    const text = chip.textContent?.trim() ?? "";
    const vivid = fill?.match(/../g)?.map(c => parseInt(c, 16));
    const tint = vivid ? hex(vivid.map(x => light ? x * 0.55 : (255 + x) / 2) as RGB) : ink;
    return [...(i ? [{ text: ", " }] : []), { text, ink: tint }];
  }) };
}

function toExcelDate(value: string, format: "date" | "datetime"): Cell {
  if (!value) return { v: "" };
  const shown = fmtJiraDate(value, format === "datetime");
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(shown);
  if (!m || Number(m[3]) < 1900) return { v: shown };
  const d = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  // Excel считает 1900 високосным, серийный номер ранних дат на день меньше.
  const days = d / 86400000 + 25569 - (d < Date.UTC(1900, 2, 1) ? 1 : 0);
  return { v: days, format };
}

function columnsOf(ref: ColRef, ctx: ColCtx, px: number): Column[] {
  const width = Math.max(11, Math.min(110, px / 7));
  if (ref === KEY) return [{ title: "Ключ", width }];
  const title = colLabel(ref, ctx.list);
  if (ref === REQ_COL) return [
    { title: "Документы", group: title, width: Math.max(18, width * 0.62) },
    { title: "Источник", group: title, width: Math.max(16, width * 0.38) },
  ];
  if (ref === PARTICIPANT_COL || isRoleCol(ref)) return [
    { title: "ФИО", group: title, width: Math.max(17, width * 0.65) },
    { title: "Часы", group: title, width: Math.max(12, width * 0.35) },
  ];
  return [{ title, width }];
}

function readCell(ref: ColRef, issue: Issue, td: HTMLTableCellElement, ctx: ColCtx, background: RGB, reqUrls: Record<string, string>): Cell[] {
  const chips = Array.from(td.querySelectorAll<HTMLElement>(CHIP));
  const jiraField = ref.startsWith("jira:") ? ref.slice(5) : "";
  const personField = ["assignee", "reporter", "creator"].includes(jiraField) || FIELD_BY_ID[jiraField]?.kind === "user";
  const style = personField ? {} : chipsCell(chips, background);
  if (ref === KEY) {
    const mark = chips[0]?.textContent?.trim();
    const anchor = td.querySelector("a[href]");
    return [{ v: mark ? `${mark} · ${issue.key}` : issue.key, link: issue.url, ...(anchor && tone(anchor, background)), ...style }];
  }
  if (isRoleCol(ref) || ref === PARTICIPANT_COL) {
    const tester = ref === PARTICIPANT_COL;
    const role = tester ? undefined : ctx.list.roles?.[issue.key]?.[ref.slice(5)];
    const person = ctx.participants.find(p => p.id === (tester ? ctx.list.assignees[issue.key] : role?.pid));
    const duration = tester ? ctx.list.spend?.[issue.key]?.plan : role?.plan;
    const memberColor = person?.color;
    const memberStyle = memberColor && /^#[0-9a-f]{6}$/i.test(memberColor)
      ? { fill: memberColor.slice(1), ink: textOn(memberColor).slice(1) }
      : {};
    return [
      { v: person?.name ?? role?.name ?? "", ...memberStyle },
      { v: duration == null ? "" : duration / 1440, format: "duration" },
    ];
  }
  if (ref === REQ_COL) {
    const documents = colValues(ref, issue, ctx).join(", ");
    const source = reqUrls[issue.key] ?? "";
    const link = chips.length === 1 && chips[0] instanceof HTMLAnchorElement ? chips[0].href : undefined;
    const sourceAnchor = td.querySelector("[data-xlsx-source]");
    return [{ v: documents, link, ...style }, { v: source, link: linkHref(source) ?? undefined, ...(sourceAnchor && tone(sourceAnchor, background)) }];
  }
  if (ref === BLOCK_COL || ref === DEFECTS_COL) {
    const defects = ctx.defectsOf(issue);
    const value = ref === BLOCK_COL ? blockersOf(defects ?? []).length || "" : defects?.filter(isOpenDefect).length ?? "";
    return [{ v: value, ...(defects?.length && (ref === DEFECTS_COL || value) ? { sheetId: issue.key, format: "bug" as const } : {}), ...style }];
  }
  const values = colValues(ref, issue, ctx);
  const own = ref.startsWith("own:") ? ctx.list.ownFields.find(f => f.id === ref.slice(4)) : undefined;
  const dateKind = own?.type === "date" || own?.type === "datetime" ? own.type : jiraDateKind(ref);
  if (dateKind && values.length === 1) return [toExcelDate(values[0], dateKind)];
  const numeric = !!jiraField && FIELD_BY_ID[jiraField]?.kind === "number";
  if (numeric && values.length === 1 && Number.isFinite(Number(values[0]))) return [{ v: Number(values[0]), ...style }];
  const anchor = td.querySelector<HTMLAnchorElement>("a[href]");
  const label = ref === LOAD_COL ? td.textContent?.trim() ?? "" : chips.length && !personField && ref !== "jira:priority"
    ? chips.map(c => c.textContent?.trim() ?? "").join(", ") : values.join(", ");
  return [{ v: label, link: anchor?.href, ...(anchor && tone(anchor, background)), ...style }];
}

/** Снимок текущей таблицы: порядок строк/колонок и CSS берём из того же представления, что видит пользователь. */
export function jiraViewSheet(table: HTMLTableElement, issues: Issue[], ctx: ColCtx, selected: Set<string>, reqUrls: Record<string, string>, name: string, defects: Map<string, Issue[]>) {
  const headers = Array.from(table.tHead?.querySelectorAll<HTMLTableCellElement>("[data-xlsx-col]") ?? []);
  const base = rgb(getComputedStyle(table.parentElement ?? table).backgroundColor, white) ?? white;
  const ink = rgb(getComputedStyle(table).color, base);
  const bodyTone = { fill: hex(base), ...(ink && { ink: hex(ink) }) };
  const header = headers[0] ? tone(headers[0], base) : {};
  const pinned = new Set(ctx.list.pinned ?? []);
  let frozenCols = 0;
  const fields = headers.map(th => {
    const ref = th.dataset.xlsxCol!;
    const columns = columnsOf(ref, ctx, th.getBoundingClientRect().width);
    if (ref === KEY || pinned.has(ref)) frozenCols += columns.length;
    return { index: th.cellIndex, ref, columns };
  });
  const columns = fields.flatMap(f => f.columns);
  const rows: Cell[][] = [];
  const sectionRows: number[] = [];
  const extraLinks: { row: Cell[]; issue: Issue }[] = [];
  const sections: { depth: number; cell: Cell; written: boolean }[] = [];
  const byKey = new Map(issues.map(issue => [issue.key, issue]));
  const exported = new Set<string>();
  const inheritedCells = new Map<string, Map<string, HTMLTableCellElement>>();
  for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
    const section = row.dataset.xlsxSection;
    if (section !== undefined) {
      const depth = Number(row.dataset.xlsxDepth ?? 0);
      while (sections.length && sections[sections.length - 1].depth >= depth) sections.pop();
      sections.push({ depth, written: false,
        cell: { v: `${"  ".repeat(depth)}${section}`, bold: true, ...bodyTone, ...tone(row.querySelector(CHIP) ?? row, base) } });
      continue;
    }
    const key = row.dataset.xlsxIssue;
    const owner = row.dataset.xlsxOwner ?? key;
    const issue = key && owner && selected.has(owner) ? byKey.get(key) : undefined;
    if (!issue) continue;
    const shared = inheritedCells.get(owner!) ?? new Map<string, HTMLTableCellElement>();
    inheritedCells.set(owner!, shared);
    const cells = new Map(Array.from(row.cells).filter(td => td.dataset.xlsxCell)
      .map(td => [td.dataset.xlsxCell!, td]));
    for (const item of sections) {
      if (item.written) continue;
      sectionRows.push(rows.length); rows.push([item.cell]); item.written = true;
    }
    exported.add(issue.key);
    for (const owner of [issue, byKey.get(row.dataset.xlsxOwner ?? "")]) {
      if (!owner || defects.has(owner.key)) continue;
      const entries = ctx.defectsOf(owner);
      if (entries?.length) defects.set(owner.key, entries);
    }
    const exportedRow = fields.flatMap<Cell>(f => {
      const ownCell = cells.get(f.ref);
      if (ownCell && ownCell.rowSpan > 1) shared.set(f.ref, ownCell);
      const td = ownCell ?? shared.get(f.ref) ?? row.cells[f.index];
      if (!ownCell && shared.has(f.ref)) return f.columns.map(() => ({ ...bodyTone, v: "" }));
      const source = td.dataset.xlsxValueKey ? byKey.get(td.dataset.xlsxValueKey) ?? issue : issue;
      return readCell(f.ref, source, td, ctx, base, reqUrls).map(cell => ({
        ...bodyTone, ...cell, ...(td.rowSpan > 1 && { rowSpan: td.rowSpan }),
        ...(cell.link && !cell.ink && { ink: "" }),
      }));
    });
    rows.push(exportedRow);
    if (!fields.some(f => f.ref === DEFECTS_COL)) extraLinks.push({ row: exportedRow, issue });
  }
  if (extraLinks.some(({ issue }) => defects.has(issue.key))) {
    columns.push({ title: "Дефекты", width: 13 });
    for (const { row, issue } of extraLinks) {
      const related = defects.get(issue.key);
      row.push(related ? { v: related.filter(isOpenDefect).length, format: "bug", sheetId: issue.key } : { v: "" });
    }
  }
  return { name, columns, rows, sectionRows, frozenCols, headerFill: header.fill, headerInk: header.ink, count: exported.size };
}

export async function downloadJiraViews(name: string, views: ReturnType<typeof jiraViewSheet>[],
  defects: Map<string, Issue[]>, stageOf: (issue: Issue) => StageInfo): Promise<string> {
  if (!views.some(v => v.count)) throw new Error("Нет отмеченных задач для выгрузки.");
  const bugSheets = Array.from(defects, ([key, issues]) => {
    const open = issues.filter(isOpenDefect);
    const fixed = issues.filter(d => !isOpenDefect(d));
    const columns = ["Тип", "Номер", "Наименование", "Статус", "Статус (st)", "Приоритет", "Исполнитель"]
      .map((title, i) => ({ title, width: [15, 19, 66, 24, 25, 20, 28][i] }));
    const rows: Cell[][] = [];
    const sectionRows: number[] = [];
    for (const [label, group] of [["Неустранённые", open], ["Устранённые", fixed]] as const) {
      if (!group.length) continue;
      sectionRows.push(rows.length);
      rows.push([{ v: `${label} · ${group.length}`, bold: true }]);
      rows.push(...sortIssueRows(group, { col: "priority", dir: 1 }).map(d => [
        { v: String(d.fields.issuetype ?? "") }, { v: d.key, link: d.url }, { v: String(d.fields.summary ?? "") },
        { v: String(d.fields.status ?? "") }, { v: stageText(stageOf(d)) }, { v: String(d.fields.priority ?? "") },
        { v: String(d.fields.assignee ?? "") },
      ]));
    }
    return { id: key, name: `Bug${key.replace(/^.*-/, "")}`, columns, rows, sectionRows, frozenCols: 2 };
  });
  const stamp = new Date().toLocaleDateString("ru-RU");
  const filename = `Jira tool — ${name} — ${stamp}.xlsx`.replace(/[\\/:*?"<>|]+/g, "_");
  const res = await fetch(`${API_BASE}/api/export/xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ filename, sheets: [...views.map(({ count: _count, ...sheet }) => sheet), ...bugSheets] }),
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
