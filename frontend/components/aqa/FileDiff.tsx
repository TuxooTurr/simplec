"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getAqaCommitDiff, type AqaFileDiff, type DiffLine } from "@/lib/aqaApi";

const SIDE: Record<DiffLine["type"], string> = {
  removed: "bg-red-500/10 text-red-900 dark:text-red-200",
  added: "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
  context: "text-text-main",
};
const NUM: Record<DiffLine["type"], string> = {
  removed: "bg-red-500/15 text-red-700/80 dark:text-red-300/80",
  added: "bg-emerald-500/15 text-emerald-700/80 dark:text-emerald-300/80",
  context: "text-text-muted",
};

/** Одна сторона строки: номер и текст; пустая сторона (строки нет) — штриховка. */
function Cell({ ln, edge = "" }: { ln: DiffLine | null; edge?: string }) {
  if (!ln) {
    return <><td className={`w-10 bg-bg-subtle/60 ${edge}`} /><td className="bg-bg-subtle/60 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_4px,rgba(127,127,127,.08)_4px,rgba(127,127,127,.08)_8px)]" /></>;
  }
  return (
    <>
      <td className={`w-10 select-none px-1.5 text-right align-top tabular-nums ${NUM[ln.type]} ${edge}`}>{ln.n ?? ""}</td>
      <td className={`whitespace-pre-wrap break-all px-2 align-top ${SIDE[ln.type]}`}>
        <span className="select-none opacity-60">{ln.type === "removed" ? "−" : ln.type === "added" ? "+" : " "}</span>{ln.text || " "}
      </td>
    </>
  );
}

/**
 * Файл коммита «было / стало»: слева строки до коммита, справа — после; удалённое красным, добавленное зелёным,
 * вокруг изменений — по 3 строки без изменений. Грузится при раскрытии файла (большие коммиты не тянут всё сразу).
 */
export default function FileDiff({ hash, path, src }: { hash: string; path: string; src: string }) {
  const [data, setData] = useState<AqaFileDiff | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    getAqaCommitDiff(hash, path, src).then(r => { if (live) setData(r); }, e => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [hash, path, src]);

  if (err) return <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{err}</p>;
  if (!data) return <p className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю изменения…</p>;
  if (data.binary) return <p className="px-3 py-2 text-xs text-text-muted">Двоичный файл — построчно не показать.</p>;
  if (!data.hunks.length) return <p className="px-3 py-2 text-xs text-text-muted">Строки не менялись (перенос или смена прав).</p>;

  return (
    <div className="border-t border-border-main bg-bg-card">
      <div className="max-h-[480px] overflow-auto scrollbar-thin">
        <table className="w-full table-fixed border-collapse font-mono text-[11px] leading-[18px]">
          <colgroup><col className="w-10" /><col /><col className="w-10" /><col /></colgroup>
          <thead className="sticky top-0 z-10 bg-bg-card text-left font-sans text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            <tr className="border-b border-border-main">
              <th colSpan={2} className="px-2 py-1">Было</th>
              <th colSpan={2} className="border-l border-border-main px-2 py-1">Стало</th>
            </tr>
          </thead>
          {data.hunks.map((rows, k) => (
            <tbody key={k}>
              {k > 0 && <tr><td colSpan={4} className="border-y border-border-main bg-bg-subtle/60 px-2 text-center font-sans text-[10px] text-text-muted">⋯</td></tr>}
              {rows.map((r, i) => (
                <tr key={i}>
                  <Cell ln={r.l} />
                  <Cell ln={r.r} edge="border-l border-border-main" />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {data.truncated && <p className="border-t border-border-main px-3 py-1 text-[11px] text-amber-700 dark:text-amber-400">Изменений много — показана часть, целиком — в Bitbucket.</p>}
    </div>
  );
}
