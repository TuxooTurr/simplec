"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink, GitMerge, Loader2, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import FileDiff from "@/components/aqa/FileDiff";
import { Kpi, fmtWhen } from "@/components/aqa/widgets";
import { getAqaCommit, type AqaCommitDetails, type AqaCommitFile } from "@/lib/aqaApi";

/** Что сделано с файлом: подпись и цвет метки. */
const TYPES: Record<AqaCommitFile["type"], { label: string; many: string; cls: string }> = {
  added: { label: "добавлен", many: "добавлено", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  modified: { label: "изменён", many: "изменено", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  deleted: { label: "удалён", many: "удалено", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  moved: { label: "перенесён", many: "перенесено", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  copied: { label: "скопирован", many: "скопировано", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
};
const TYPE_ORDER: AqaCommitFile["type"][] = ["added", "modified", "deleted", "moved", "copied"];

const n = (v: number) => v.toLocaleString("ru-RU");

/** Доля добавленных и удалённых строк полоской: зелёное — добавлено, красное — удалено. */
function Churn({ added, removed, max, className = "h-1.5" }: { added: number; removed: number; max: number; className?: string }) {
  const w = (v: number) => `${max ? (v / max) * 100 : 0}%`;
  return (
    <div className={`flex overflow-hidden rounded-full bg-bg-subtle ${className}`}>
      <div className="bg-emerald-500" style={{ width: w(added) }} />
      <div className="bg-red-500" style={{ width: w(removed) }} />
    </div>
  );
}

/**
 * Коммит подробно: сообщение, автор, свод (файлов, строк добавлено и удалено, итог), файлы по типам изменений,
 * свод по расширениям и список файлов — больше всего строк сверху, с поиском по пути. Щелчок по файлу — «было / стало»
 * рядом (FileDiff). Коммит — ссылкой в Bitbucket.
 */
export default function CommitModal({ hash, onClose }: { hash: string | null; onClose: () => void }) {
  const [data, setData] = useState<AqaCommitDetails | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  /** Раскрытые файлы — под ними «было / стало». */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (path: string) => setOpen(o => { const n = new Set(o); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const seq = useRef(0);

  useEffect(() => {
    if (!hash) return;
    const s = ++seq.current;
    setData(null); setErr(""); setQ(""); setOpen(new Set());
    getAqaCommit(hash).then(r => { if (s === seq.current) setData(r); }, e => { if (s === seq.current) setErr((e as Error).message); });
  }, [hash]);

  const files = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.files ?? []).filter(f => !needle || f.path.toLowerCase().includes(needle) || f.from.toLowerCase().includes(needle));
  }, [data, q]);
  const maxFile = Math.max(1, ...(data?.files ?? []).map(f => f.added + f.removed));
  const maxExt = Math.max(1, ...(data?.byExt ?? []).map(e => e.added + e.removed));
  const [title, ...body] = (data?.message ?? "").split("\n");
  const t = data?.totals;
  const net = t ? t.added - t.removed : 0;

  return (
    <Modal open={!!hash} onClose={onClose} title="Коммит" size="max-w-7xl">
      {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
        : !data || !t ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Считаю изменения…</p>
        : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold text-text-main">{title || "—"}</h4>
                {body.join("\n").trim() && <p className="mt-1 whitespace-pre-wrap text-xs text-text-muted">{body.join("\n").trim()}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-text-muted">
                  <span className="rounded bg-bg-subtle px-1.5 py-px font-mono text-primary">{data.id}</span>
                  <span>{data.author || "—"}</span>
                  <span>{fmtWhen(data.date)}</span>
                  {data.merge && <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400" title="Изменения — относительно первого родителя">
                    <GitMerge className="h-3.5 w-3.5" /> merge-коммит</span>}
                </p>
              </div>
              {data.url && (
                <a href={data.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-border-main px-2.5 py-1 text-xs text-text-main hover:bg-bg-subtle">
                  <ExternalLink className="h-3.5 w-3.5" /> В Bitbucket</a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi value={`${n(t.files)}${data.filesMore ? "+" : ""}`} label="файлов изменено" />
              <Kpi value={`+${n(t.added)}`} label="строк добавлено" tone="text-emerald-600 dark:text-emerald-400" />
              <Kpi value={`−${n(t.removed)}`} label="строк удалено" tone="text-red-600 dark:text-red-400" />
              <Kpi value={`${net > 0 ? "+" : net < 0 ? "−" : ""}${n(Math.abs(net))}`} label="итог по строкам" hint={`всего затронуто ${n(t.added + t.removed)}`} />
            </div>
            <div className="space-y-1.5">
              <Churn added={t.added} removed={t.removed} max={t.added + t.removed} className="h-2.5" />
              <p className="flex flex-wrap gap-1.5 text-[11px]">
                {TYPE_ORDER.filter(k => t.byType[k]).map(k => (
                  <span key={k} className={`rounded px-1.5 py-0.5 ${TYPES[k].cls}`}>{TYPES[k].many} файлов: <b className="tabular-nums">{t.byType[k]}</b></span>
                ))}
              </p>
              {(data.truncated || data.filesMore) && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {data.truncated && "Bitbucket обрезал большой diff — строки посчитаны не все. "}
                  {data.filesMore && "Показаны первые 1000 файлов."}
                </p>
              )}
            </div>

            {data.byExt.length > 1 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">По типам файлов</p>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {data.byExt.slice(0, 10).map(e => (
                    <li key={e.ext} className="flex items-center gap-2 text-xs">
                      <span className="w-24 flex-shrink-0 truncate font-mono text-text-main" title={e.ext}>{e.ext}</span>
                      <span className="w-14 flex-shrink-0 text-text-muted">{e.files} ф.</span>
                      <span className="flex-1"><Churn added={e.added} removed={e.removed} max={maxExt} /></span>
                      <span className="w-24 flex-shrink-0 text-right tabular-nums">
                        <span className="text-emerald-600 dark:text-emerald-400">+{n(e.added)}</span>{" "}
                        <span className="text-red-600 dark:text-red-400">−{n(e.removed)}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Файлы</p>
                {data.files.length > 8 && (
                  <div className="relative ml-auto w-56">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Путь к файлу" aria-label="Поиск по файлам коммита"
                      className="w-full rounded-md border border-border-main bg-[var(--color-input-bg)] py-1 pl-7 pr-2 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                )}
              </div>
              {!files.length ? <p className="text-xs text-text-muted">{data.files.length ? "Ничего не найдено" : "Файлы не изменены"}</p> : (
                <ul className="divide-y divide-border-main overflow-hidden rounded-lg border border-border-main">
                  {files.map(f => {
                    const on = open.has(f.path);
                    return (
                      <li key={f.path}>
                        <button type="button" onClick={() => toggle(f.path)} aria-expanded={on} disabled={f.binary}
                          title={f.binary ? "Двоичный файл" : on ? "Свернуть" : "Показать, что изменено: было / стало"}
                          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs ${f.binary ? "cursor-default" : "hover:bg-bg-subtle"} ${on ? "bg-bg-subtle/60" : ""}`}>
                          <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${on ? "rotate-90" : ""} ${f.binary ? "invisible" : ""}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-text-main" title={f.path}>{f.path}</span>
                            {f.from && <span className="block truncate text-[11px] text-text-muted" title={f.from}>из {f.from}</span>}
                          </span>
                          <span className={`flex-shrink-0 rounded px-1.5 py-px text-[10px] ${TYPES[f.type].cls}`}>{TYPES[f.type].label}</span>
                          {f.binary ? <span className="w-40 flex-shrink-0 text-right text-text-muted">двоичный файл</span> : (
                            <>
                              <span className="w-16 flex-shrink-0"><Churn added={f.added} removed={f.removed} max={maxFile} /></span>
                              <span className="w-24 flex-shrink-0 text-right tabular-nums">
                                <span className="text-emerald-600 dark:text-emerald-400">+{n(f.added)}</span>{" "}
                                <span className="text-red-600 dark:text-red-400">−{n(f.removed)}</span></span>
                            </>
                          )}
                        </button>
                        {on && <FileDiff hash={data.hash || data.id} path={f.path} src={f.from} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
    </Modal>
  );
}
