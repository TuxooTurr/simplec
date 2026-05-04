"use client";

import React from "react";

// ── Inline formatting: **bold**, *italic*, `code` ─────────────────────────────
function renderInline(text: string): React.ReactNode {
  const re = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<React.Fragment key={k++}>{text.slice(last, m.index)}</React.Fragment>);
    if (m[2] !== undefined)
      parts.push(<strong key={k++} className="font-semibold text-gray-900">{m[2]}</strong>);
    else if (m[3] !== undefined)
      parts.push(<em key={k++} className="italic text-gray-700">{m[3]}</em>);
    else if (m[4] !== undefined)
      parts.push(
        <code key={k++} className="px-1.5 py-0.5 rounded text-[11px] bg-gray-100 font-mono text-gray-700 border border-gray-200">
          {m[4]}
        </code>
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

// ── NotionRenderer ────────────────────────────────────────────────────────────
export default function NotionRenderer({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

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
        <div key={k++} className="my-3 rounded-xl overflow-hidden border border-gray-200">
          {lang && (
            <div className="px-4 py-1.5 bg-gray-900 text-gray-400 text-[10px] font-mono uppercase tracking-widest">
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
        <div key={k++} className="my-3 overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full border-separate border-spacing-0 bg-white text-xs">
            <thead className="bg-gray-50">
              <tr>
                {headers.map((cell, idx) => (
                  <th
                    key={idx}
                    className={`border-b border-gray-200 px-3 py-2 font-semibold text-gray-700 ${alignments[idx] ?? "text-left"}`}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className={rowIdx % 2 === 1 ? "bg-gray-50/40" : "bg-white"}>
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className={`border-b border-gray-100 px-3 py-2 align-top text-gray-700 last:border-r-0 ${alignments[cellIdx] ?? "text-left"}`}
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
      nodes.push(<hr key={k++} className="my-4 border-gray-100" />);
      i++; continue;
    }

    // ── H1 ──────────────────────────────────────────────────────────
    if (/^# /.test(raw)) {
      nodes.push(
        <h1 key={k++} className="text-base font-bold text-gray-900 mt-6 mb-2 first:mt-0 pb-2 border-b border-gray-100">
          {renderInline(raw.slice(2))}
        </h1>
      );
      i++; continue;
    }

    // ── H2 ──────────────────────────────────────────────────────────
    if (/^## /.test(raw)) {
      nodes.push(
        <h2 key={k++} className="text-sm font-semibold text-gray-800 mt-5 mb-1.5 first:mt-0 uppercase tracking-wide text-[11px]">
          {renderInline(raw.slice(3))}
        </h2>
      );
      i++; continue;
    }

    // ── H3 ──────────────────────────────────────────────────────────
    if (/^### /.test(raw)) {
      nodes.push(
        <h3 key={k++} className="text-sm font-semibold text-gray-700 mt-4 mb-1 first:mt-0">
          {renderInline(raw.slice(4))}
        </h3>
      );
      i++; continue;
    }

    // ── Bullet list (collect consecutive lines) ──────────────────────
    if (/^[*\-+] /.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^[*\-+] /.test(lines[i])) {
        items.push(lines[i].replace(/^[*\-+] /, ""));
        i++;
      }
      nodes.push(
        <ul key={k++} className="my-2 space-y-1.5">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-sm bg-gray-400 flex-shrink-0" />
              <span>{renderInline(item)}</span>
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
            <li key={idx} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed">
              <span className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold text-gray-500 bg-gray-100 mt-0.5">
                {idx + 1}
              </span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
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
      <p key={k++} className="text-sm text-gray-700 leading-relaxed">
        {renderInline(raw)}
      </p>
    );
    i++;
  }

  return <div className={`space-y-0.5 ${className}`}>{nodes}</div>;
}
