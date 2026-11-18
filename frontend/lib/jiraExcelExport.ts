import { authHeaders } from "./authApi";
import { FIELD_BY_ID } from "./jiraModel";
import { textOn } from "./jiraStages";
import { BLOCK_COL, DEFECTS_COL, LOAD_COL, PARTICIPANT_COL, REQ_COL, blockersOf, colLabel, colValues, fmtJiraDate,
  isRoleCol, jiraDateKind, linkHref, type ColCtx, type ColRef, type Issue } from "./jiraTool";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const KEY = "__key";
const CHIP = "[data-xlsx-chip]";
type RGB = [number, number, number];
type Tone = { fill: string; ink: string };
type Format = "duration" | "date" | "datetime";
type Cell = { v: string | number; link?: string; format?: Format; bold?: boolean;
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
  const style = chipsCell(chips, background);
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
    return [
      { v: person?.name ?? role?.name ?? "", ...style },
      { v: duration == null ? "" : duration / 1440, format: "duration", ...(!tester && style) },
    ];
  }
  if (ref === REQ_COL) {
    const documents = colValues(ref, issue, ctx).join(", ");
    const source = reqUrls[issue.key] ?? "";
    const link = chips.length === 1 && chips[0] instanceof HTMLAnchorElement ? chips[0].href : undefined;
    const sourceAnchor = td.querySelector("[data-xlsx-source]");
    return [{ v: documents, link, ...style }, { v: source, link: linkHref(source) ?? undefined, ...(sourceAnchor && tone(sourceAnchor, background)) }];
  }
  if (ref === BLOCK_COL) {
    const defects = ctx.defectsOf(issue);
    return [{ v: defects ? blockersOf(defects).length || "" : "", ...style }];
  }
  const values = colValues(ref, issue, ctx);
  const own = ref.startsWith("own:") ? ctx.list.ownFields.find(f => f.id === ref.slice(4)) : undefined;
  const dateKind = own?.type === "date" || own?.type === "datetime" ? own.type : jiraDateKind(ref);
  if (dateKind && values.length === 1) return [toExcelDate(values[0], dateKind)];
  const numeric = ref === DEFECTS_COL || (ref.startsWith("jira:") && FIELD_BY_ID[ref.slice(5)]?.kind === "number");
  if (numeric && values.length === 1 && Number.isFinite(Number(values[0]))) return [{ v: Number(values[0]), ...style }];
  const anchor = td.querySelector<HTMLAnchorElement>("a[href]");
  const label = ref === LOAD_COL ? td.textContent?.trim() ?? "" : chips.length && ref !== "jira:priority"
    ? chips.map(c => c.textContent?.trim() ?? "").join(", ") : values.join(", ");
  return [{ v: label, link: anchor?.href, ...(anchor && tone(anchor, background)), ...style }];
}

/** Снимок текущей таблицы: порядок строк/колонок и CSS берём из того же представления, что видит пользователь. */
export function jiraViewSheet(table: HTMLTableElement, issues: Issue[], ctx: ColCtx, selected: Set<string>, reqUrls: Record<string, string>) {
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
  const sections: { depth: number; cell: Cell; written: boolean }[] = [];
  const byKey = new Map(issues.map(issue => [issue.key, issue]));
  const exported = new Set<string>();
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
    const issue = key && selected.has(key) ? byKey.get(key) : undefined;
    if (!issue) continue;
    for (const item of sections) {
      if (item.written) continue;
      sectionRows.push(rows.length); rows.push([item.cell]); item.written = true;
    }
    exported.add(issue.key);
    rows.push(fields.flatMap(f => readCell(f.ref, issue, row.cells[f.index], ctx, base, reqUrls)
      .map(cell => ({ ...bodyTone, ...cell, ...(cell.link && !cell.ink && { ink: "" }) }))));
  }
  return { name: ctx.list.name, columns, rows, sectionRows, frozenCols, headerFill: header.fill, headerInk: header.ink, count: exported.size };
}

export async function downloadJiraView(sheet: ReturnType<typeof jiraViewSheet>): Promise<string> {
  const { count, ...data } = sheet;
  if (!count) throw new Error("Нет видимых отмеченных задач. Раскройте нужную папку или группу.");
  const stamp = new Date().toLocaleDateString("ru-RU");
  const filename = `Jira tool — ${sheet.name} — ${stamp}.xlsx`.replace(/[\\/:*?"<>|]+/g, "_");
  const res = await fetch(`${API_BASE}/api/export/xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ filename, sheets: [data] }),
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
