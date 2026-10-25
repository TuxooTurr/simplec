"use client";

import React from "react";
import AuthImage from "@/components/AuthImage";

// ── Inline formatting: **bold**, *italic*, ~~зачёркнутый~~, `code`, [ссылка](https://…), ![картинка](адрес) ──
function renderInline(text: string): React.ReactNode {
  const re = /(!\[([^\]\n]*)\]\(((?:https?:\/\/|\/api\/)[^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<React.Fragment key={k++}>{text.slice(last, m.index)}</React.Fragment>);
    if (m[3] !== undefined)
      parts.push(<AuthImage key={k++} src={m[3]} alt={m[2] ?? ""} />);
    else if (m[4] !== undefined)
      parts.push(<strong key={k++} className="font-semibold text-text-main">{m[4]}</strong>);
    else if (m[5] !== undefined)
      parts.push(<em key={k++} className="italic text-text-main">{m[5]}</em>);
    else if (m[6] !== undefined)
      parts.push(<s key={k++} className="text-text-muted">{m[6]}</s>);
    else if (m[7] !== undefined)
      parts.push(
        <code key={k++} className="px-1.5 py-0.5 rounded text-[11px] bg-bg-muted font-mono text-text-main border border-border-main">
          {m[7]}
        </code>
      );
    else if (m[8] !== undefined)
      parts.push(
        <a key={k++} href={m[9]} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{m[8]}</a>
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<React.Fragment key={k++}>{text.slice(last)}</React.Fragment>);
  return parts.length === 0 ? text : <>{parts}</>;
}

// ── Markdown tables ───────────────────────────────────────────────────────────
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const ch of trimmed) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isTableRow(line: string): boolean {
  return splitTableRow(line).length > 1;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeTableRow(cells: string[], columns: number): string[] {
  if (cells.length > columns) {
    return [...cells.slice(0, columns - 1), cells.slice(columns - 1).join(" | ")];
  }
  return [...cells, ...Array(Math.max(0, columns - cells.length)).fill("")];
}

function alignClass(separatorCell: string): string {
  const value = separatorCell.trim();
  if (value.startsWith(":") && value.endsWith(":")) return "text-center";
  if (value.endsWith(":")) return "text-right";
  return "text-left";
}

/**
 * Похож ли текст на Markdown: заголовки, списки, таблица, блок кода, цитата, жирный или ссылка.
 * Нужен там, где текст бывает и обычным (вытащен из PDF/DOCX), и размеченным (.md, вставка из редактора):
 * обычный лучше показать как есть — с переносами строк, а размеченный — отрисовать.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split("\n");
  const marks = lines.filter(l => /^\s{0,3}(#{1,6} |[*\-+] |\d+\. |> |```|\|.*\||!\[|:::columns)/.test(l)).length;
  const inline = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|`[^`\n]+`/.test(text);
  return /^\s{0,3}#{1,6} /m.test(text) || /^```/m.test(text) || marks >= 2 || (marks >= 1 && inline);
}

/** Якорь заголовка: тот же текст → тот же id (по нему «Данные» ведут на место изменения в документе). */
export function headingSlug(text: string): string {
  return "h-" + text.replace(/[*_`~[\]()]/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Пункт списка: «[x] …» / «[ ] …» — задача с отметкой (списки задач Confluence). */
function listItemBody(item: string): React.ReactNode {
  const m = item.match(/^\[( |x|X)\]\s+(.*)$/);
  if (!m) return renderInline(item);
  const done = m[1] !== " ";
  return (
    <span className="inline-flex items-start gap-1.5">
      <span className={`mt-[3px] w-3.5 h-3.5 flex-shrink-0 rounded border text-[10px] leading-none flex items-center justify-center ${done ? "bg-primary border-primary text-white" : "border-border-main"}`}>{done ? "✓" : ""}</span>
      <span className={done ? "text-text-muted line-through" : ""}>{renderInline(m[2])}</span>
    </span>
  );
}

// ── NotionRenderer ────────────────────────────────────────────────────────────
/** anchors — у заголовков id (headingSlug), чтобы на них можно было сослаться. */
export default function NotionRenderer({ text, className = "", anchors = false }: { text: string; className?: string; anchors?: boolean }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  const used = new Set<string>();
  const hid = (t: string): string | undefined => {
    if (!anchors) return undefined;
    const base = headingSlug(t);
    if (!used.has(base)) { used.add(base); return base; }
    let n = 2;
    while (used.has(`${base}-${n}`)) n++;
    used.add(`${base}-${n}`);
    return `${base}-${n}`;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // ── Колонки (:::columns … :::col … :::) — как колонки в Notion ─────
    if (trimmed === ":::columns") {
      const cols: string[][] = [[]];
      i++;
      let depth = 0;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === ":::columns") depth++;
        if (t === ":::" && depth === 0) break;
        if (t === ":::" && depth > 0) depth--;
        if (t === ":::col" && depth === 0) cols.push([]);
        else cols[cols.length - 1].push(lines[i]);
        i++;
      }
      i++; // закрывающее :::
      nodes.push(
        <div key={k++} className="my-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c, ci) => <div key={ci} className="min-w-0"><NotionRenderer text={c.join("\n")} anchors={anchors} /></div>)}
        </div>
      );
      continue;
    }

    // ── Fenced code block ───────────────────────────────────────────
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      nodes.push(
        <div key={k++} className="my-3 rounded-xl overflow-hidden border border-border-main">
          {lang && (
            <div className="px-4 py-1.5 bg-gray-900 text-text-muted text-[10px] font-mono uppercase tracking-widest">
              {lang}
            </div>
          )}
          <pre className="px-4 py-3 bg-gray-950 text-green-300 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre">
            {code.join("\n")}
          </pre>
        </div>
      );
      i++; // пропускаем закрывающий ```
      continue;
    }

    // ── Markdown table ────────────────────────────────────────────────
    if (
      i + 1 < lines.length &&
      isTableRow(raw) &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(raw);
      const separators = splitTableRow(lines[i + 1]);
      const columns = headers.length;
      const alignments = normalizeTableRow(separators, columns).map(alignClass);
      const rows: string[][] = [];
      i += 2;

      while (i < lines.length && lines[i].trim() !== "" && isTableRow(lines[i])) {
        rows.push(normalizeTableRow(splitTableRow(lines[i]), columns));
        i++;
      }

      nodes.push(
        <div key={k++} className="my-3 overflow-x-auto rounded-xl border border-border-main">
          <table className="min-w-full border-separate border-spacing-0 bg-bg-card text-xs">
            <thead className="bg-bg-subtle">
              <tr>
                {headers.map((cell, idx) => (
                  <th
                    key={idx}
                    className={`border-b border-border-main px-3 py-2 font-semibold text-text-main ${alignments[idx] ?? "text-left"}`}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className={rowIdx % 2 === 1 ? "bg-bg-subtle/40" : "bg-bg-card"}>
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={`border-b border-border-main px-3 py-2 align-top text-text-main last:border-r-0 ${alignments[cellIdx] ?? "text-left"}`}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── Divider ─────────────────────────────────────────────────────
    if (/^-{3,}$/.test(trimmed) || /^={3,}$/.test(trimmed)) {
      nodes.push(<hr key={k++} className="my-4 border-border-main" />);
      i++; continue;
    }

    // ── H1 ──────────────────────────────────────────────────────────
    if (/^# /.test(raw)) {
      nodes.push(
        <h1 key={k++} id={hid(raw.slice(2))} className="text-base font-bold text-text-main mt-6 mb-2 first:mt-0 pb-2 border-b border-border-main scroll-mt-4">
          {renderInline(raw.slice(2))}
        </h1>
      );
      i++; continue;
    }

    // ── H2 ──────────────────────────────────────────────────────────
    if (/^## /.test(raw)) {
      nodes.push(
        <h2 key={k++} id={hid(raw.slice(3))} className="text-sm font-semibold text-text-main mt-5 mb-1.5 first:mt-0 uppercase tracking-wide text-[11px] scroll-mt-4">
          {renderInline(raw.slice(3))}
        </h2>
      );
      i++; continue;
    }

    // ── H3 ──────────────────────────────────────────────────────────
    if (/^### /.test(raw)) {
      nodes.push(
        <h3 key={k++} id={hid(raw.slice(4))} className="text-sm font-semibold text-text-main mt-4 mb-1 first:mt-0 scroll-mt-4">
          {renderInline(raw.slice(4))}
        </h3>
      );
      i++; continue;
    }

    // ── H4-H6 (не различаем визуально дальше H3 — падать в абзац с "####"
    // как текстом было хуже, чем чуть менее выраженный подзаголовок) ──
    if (/^#{4,6} /.test(raw)) {
      const level = raw.match(/^#+/)![0].length;
      nodes.push(
        <h4 key={k++} id={hid(raw.slice(level + 1))} className="text-sm font-semibold text-text-muted mt-3 mb-1 first:mt-0 scroll-mt-4">
          {renderInline(raw.slice(level + 1))}
        </h4>
      );
      i++; continue;
    }

    // ── Bullet list (collect consecutive lines) ──────────────────────
    // Вложенные пункты (отступ по 2 пробела) — в том же списке со сдвигом.
    if (/^[*\-+] /.test(raw)) {
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length && (/^[*\-+] /.test(lines[i]) || (items.length > 0 && /^ {2,}[*\-+] /.test(lines[i])))) {
        const m = lines[i].match(/^( *)[*\-+] (.*)$/)!;
        items.push({ text: m[2], depth: Math.min(4, Math.floor(m[1].length / 2)) });
        i++;
      }
      nodes.push(
        <ul key={k++} className="my-2 space-y-1.5">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm text-text-main leading-relaxed" style={item.depth ? { marginLeft: item.depth * 18 } : undefined}>
              <span className={`mt-[7px] w-1.5 h-1.5 flex-shrink-0 ${item.depth ? "rounded-full border border-gray-400" : "rounded-sm bg-gray-400"}`} />
              <span>{listItemBody(item.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Numbered list (collect consecutive lines) ────────────────────
    if (/^\d+\. /.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={k++} className="my-2 space-y-1.5 list-none">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm text-text-main leading-relaxed">
              <span className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold text-text-muted bg-bg-muted mt-0.5">
                {idx + 1}
              </span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // ── Quote ────────────────────────────────────────────────────────
    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      nodes.push(
        <blockquote key={k++} className="border-l-2 border-primary/40 pl-3 my-1 text-sm text-text-muted leading-relaxed">
          {quote.map((q, n) => <p key={n}>{renderInline(q)}</p>)}
        </blockquote>
      );
      continue;
    }

    // ── Empty line ───────────────────────────────────────────────────
    if (trimmed === "") {
      nodes.push(<div key={k++} className="h-1.5" />);
      i++; continue;
    }

    // ── Paragraph ────────────────────────────────────────────────────
    nodes.push(
      <p key={k++} className="text-sm text-text-main leading-relaxed">
        {renderInline(raw)}
      </p>
    );
    i++;
  }

  return <div className={`space-y-0.5 ${className}`}>{nodes}</div>;
}
