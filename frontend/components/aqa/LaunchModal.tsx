"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { LaunchDot } from "@/components/aqa/LaunchesCard";
import { StatsBar, ago, fmtDur, fmtWhen, passRate, statusItems, statusOf } from "@/components/aqa/widgets";
import { getAqaLaunch, type AqaLaunch, type AqaLaunchDetails } from "@/lib/aqaApi";

/**
 * Запуски Allure TestOps подробно. Слева — последние запуски (переключаются), справа — выбранный: когда, кто,
 * длительность, теги и окружение, кейсы по статусам и результаты кейсов (упавшие сверху) с фильтром по статусу
 * и поиском; кейс — ссылкой в TestOps.
 */
export default function LaunchModal({ open, launches, launchId, onClose }: {
  open: boolean; launches: AqaLaunch[]; launchId: number | null; onClose: () => void;
}) {
  const [id, setId] = useState<number | null>(launchId);
  const [data, setData] = useState<AqaLaunchDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const seq = useRef(0);

  useEffect(() => { if (open) setId(launchId); }, [open, launchId]);

  const load = (lid: number, refresh = false) => {
    const n = ++seq.current;
    setBusy(true); setErr("");
    if (!refresh) setData(null);
    getAqaLaunch(lid, refresh).then(r => { if (n === seq.current) setData(r); }, e => { if (n === seq.current) setErr((e as Error).message); })
      .finally(() => { if (n === seq.current) setBusy(false); });
  };
  useEffect(() => {
    if (open && id !== null) { setStatus("all"); setQ(""); load(id); }
  }, [open, id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of data?.results ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [data]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.results ?? []).filter(r => (status === "all" || r.status === status) && (!needle || r.name.toLowerCase().includes(needle)
      || r.message.toLowerCase().includes(needle)));
  }, [data, status, q]);

  const list = launches.some(l => l.id === id) || id === null ? launches : [...launches, { id, name: "", date: "", closed: true, url: "", stats: {} }];
  const rate = data ? passRate(data.stats) : null;
  const CHIP = "rounded-full border px-2.5 py-0.5 text-xs transition-colors";

  return (
    <Modal open={open} onClose={onClose} title="Запуски Allure TestOps" size="max-w-6xl">
      <div className="grid h-[70vh] grid-cols-[260px_minmax(0,1fr)] gap-4">
        {/* Запуски */}
        <ul aria-label="Последние запуски" className="overflow-y-auto rounded-lg border border-border-main scrollbar-thin">
          {list.map(l => {
            const r = passRate(l.stats);
            return (
              <li key={l.id}>
                <button type="button" onClick={() => setId(l.id)} aria-current={l.id === id}
                  className={`flex w-full items-start gap-2 border-b border-border-main px-3 py-2 text-left text-xs transition-colors
                    ${l.id === id ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                  <span className="mt-1"><LaunchDot l={l} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${l.id === id ? "font-semibold text-primary" : "text-text-main"}`}>{l.name || `Запуск #${l.id}`}</span>
                    <span className="block text-[11px] text-text-muted">#{l.id}{l.date && ` · ${ago(l.date)}`}{r !== null && ` · ${r}%`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Выбранный запуск */}
        <div className="flex min-h-0 flex-col">
          {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
            : !data ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю запуск…</p>
            : (
              <>
                <div className="flex-shrink-0 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-base font-semibold text-text-main" title={data.name}>{data.name || `Запуск #${data.id}`}</h4>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-text-muted">
                        <span>#{data.id}</span>
                        <span>{fmtWhen(data.date)}</span>
                        <span className={data.closed ? "" : "font-semibold text-blue-600 dark:text-blue-400"}>{data.closed ? "завершён" : "идёт"}</span>
                        {data.duration > 0 && <span>длительность {fmtDur(data.duration)}</span>}
                        {data.createdBy && <span>запустил {data.createdBy}</span>}
                      </p>
                    </div>
                    <button type="button" onClick={() => id !== null && load(id, true)} disabled={busy} title="Обновить запуск" aria-label="Обновить запуск"
                      className="p-1.5 rounded-md text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-50">
                      <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /></button>
                    {data.url && (
                      <a href={data.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-border-main px-2.5 py-1 text-xs text-text-main hover:bg-bg-subtle">
                        <ExternalLink className="h-3.5 w-3.5" /> В TestOps</a>
                    )}
                  </div>
                  {(data.tags.length > 0 || data.env.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {data.tags.map(t => <span key={`t${t}`} className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{t}</span>)}
                      {data.env.map(t => <span key={`e${t}`} className="rounded bg-bg-subtle px-1.5 py-0.5 text-text-main">{t}</span>)}
                    </div>
                  )}
                  <div className="flex items-center gap-4 rounded-lg bg-bg-subtle/60 px-3 py-2.5">
                    <div className="flex-shrink-0">
                      <p className="text-2xl font-bold leading-tight tabular-nums text-text-main">{rate === null ? "—" : `${rate}%`}</p>
                      <p className="text-[11px] text-text-muted">успешно из {data.resultsTotal}</p>
                    </div>
                    <div className="flex-1"><StatsBar stats={data.stats} className="h-2.5" /></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => setStatus("all")} aria-pressed={status === "all"}
                      className={`${CHIP} ${status === "all" ? "border-primary bg-primary/10 text-primary" : "border-border-main text-text-muted hover:text-text-main"}`}>
                      Все <b className="tabular-nums">{data.results.length}</b></button>
                    {statusItems(counts).map(s => (
                      <button key={s.id} type="button" onClick={() => setStatus(s.id)} aria-pressed={status === s.id}
                        className={`${CHIP} inline-flex items-center gap-1 ${status === s.id ? "border-primary bg-primary/10 text-primary" : "border-border-main text-text-muted hover:text-text-main"}`}>
                        <span className={`h-2 w-2 rounded-full ${s.cls}`} />{s.label} <b className="tabular-nums">{counts[s.id]}</b></button>
                    ))}
                    <div className="relative ml-auto w-56">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Кейс или текст ошибки" aria-label="Поиск по кейсам запуска"
                        className="w-full rounded-md border border-border-main bg-[var(--color-input-bg)] py-1 pl-7 pr-2 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                  </div>
                </div>

                <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-main scrollbar-thin">
                  {!data.results.length ? <p className="p-3 text-sm text-text-muted">Результатов кейсов нет{!data.closed && " — запуск ещё идёт"}</p>
                    : !shown.length ? <p className="p-3 text-sm text-text-muted">Ничего не найдено</p>
                    : (
                      <table className="w-full border-collapse text-xs">
                        <thead className="sticky top-0 z-10 bg-bg-card text-left text-[11px] uppercase tracking-wide text-text-muted">
                          <tr><th className="px-3 py-2 font-semibold">Статус</th><th className="px-3 py-2 font-semibold">Кейс</th>
                            <th className="px-3 py-2 text-right font-semibold">Время</th></tr>
                        </thead>
                        <tbody>
                          {shown.map(r => {
                            const s = statusOf(r.status);
                            return (
                              <tr key={r.id} className="border-t border-border-main align-top hover:bg-bg-subtle/60">
                                <td className="whitespace-nowrap px-3 py-1.5">
                                  <span className={`inline-flex items-center gap-1.5 font-medium ${s.text}`}><span className={`h-2 w-2 rounded-full ${s.cls}`} />{s.label}</span>
                                </td>
                                <td className="px-3 py-1.5">
                                  {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-text-main hover:text-primary hover:underline">{r.name || `#${r.id}`}</a>
                                    : <span className="text-text-main">{r.name || `#${r.id}`}</span>}
                                  {r.message && <p className="mt-0.5 line-clamp-2 font-mono text-[11px] text-text-muted" title={r.message}>{r.message}</p>}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-text-muted">{fmtDur(r.duration)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                </div>
                {data.resultsPartial && <p className="mt-1 text-[11px] text-text-muted">Показаны первые {data.results.length} из {data.resultsTotal} — остальные в TestOps</p>}
              </>
            )}
        </div>
      </div>
    </Modal>
  );
}
