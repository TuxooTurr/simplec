"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, GitBranch, GitCommitHorizontal, Loader2, Search } from "lucide-react";
import { Card, Kpi, Problem, ago, fmtWhen } from "@/components/aqa/widgets";
import { getAqaBranches, type AqaBranches, type AqaCommits } from "@/lib/aqaApi";

type Load<T> = { data: T | null; err: string; busy: boolean };

/**
 * Выбор ветки: недавно изменённые сверху, поиск по части имени (на сервере Bitbucket — веток бывают тысячи).
 * Пустое значение — ветка по умолчанию репозитория.
 */
function BranchPicker({ value, onChange, disabled }: { value: string; onChange: (b: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<AqaBranches | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [defName, setDefName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    setBusy(true); setErr("");
    const t = window.setTimeout(() => {
      getAqaBranches(q).then(r => {
        if (n !== seq.current) return;
        setList(r); if (r.default) setDefName(r.default);
      }, e => { if (n === seq.current) setErr((e as Error).message); }).finally(() => { if (n === seq.current) setBusy(false); });
    }, q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [open, q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pick = (b: string) => { onChange(b === defName ? "" : b); setOpen(false); setQ(""); };
  const current = value || defName;

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        title="Ветка, по которой считаются коммиты"
        className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border-main px-2 py-0.5 text-xs text-text-main hover:bg-bg-subtle disabled:opacity-50">
        <GitBranch className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <span className="truncate font-mono">{current || "по умолчанию"}</span>
        <ChevronDown className="h-3 w-3 flex-shrink-0 text-text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-xl">
          <div className="relative border-b border-border-main p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Найти ветку" aria-label="Найти ветку"
              className="w-full rounded-md border border-border-main bg-[var(--color-input-bg)] py-1 pl-7 pr-2 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div role="listbox" aria-label="Ветки" className="max-h-72 overflow-y-auto py-1 scrollbar-thin">
            {err ? <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{err}</p>
              : busy && !list ? <p className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю ветки…</p>
              : !list?.branches.length ? <p className="px-3 py-2 text-xs text-text-muted">Веток не найдено</p>
              : list.branches.map(b => (
                <button key={b.name} type="button" role="option" aria-selected={b.name === current} onClick={() => pick(b.name)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-main hover:bg-bg-subtle">
                  <Check className={`h-3.5 w-3.5 flex-shrink-0 ${b.name === current ? "text-primary" : "invisible"}`} />
                  <span className="truncate font-mono">{b.name}</span>
                  {b.default && <span className="ml-auto flex-shrink-0 rounded bg-primary/10 px-1.5 text-[10px] text-primary">по умолчанию</span>}
                </button>
              ))}
            {list?.more && <p className="px-3 py-1.5 text-[11px] text-text-muted">Показаны первые 100 — уточните поиск</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Столбики коммитов по дням за две недели; сегодня — ярче. */
function Daily({ daily }: { daily: AqaCommits["daily"] }) {
  const max = Math.max(1, ...daily.map(d => d.count));
  const label = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return (
    <div>
      <div className="flex h-14 items-end gap-1" role="img" aria-label="Коммиты по дням за две недели">
        {daily.map((d, n) => {
          const last = n === daily.length - 1;
          return (
            <div key={d.date} className="group relative flex h-full flex-1 items-end" title={`${label(d.date)}: ${d.count}`}>
              <div style={{ height: d.count ? `${Math.max(8, (d.count / max) * 100)}%` : 2 }}
                className={`w-full rounded-sm ${d.count ? (last ? "bg-primary" : "bg-primary/45 group-hover:bg-primary/70") : "bg-border-main"}`} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-text-muted">
        <span>{daily.length ? label(daily[0].date) : ""}</span><span>сегодня</span>
      </div>
    </div>
  );
}

/**
 * Виджет коммитов репозитория автотестов: ветка, сегодня / 7 дней / всего, столбики по дням, авторы недели
 * и последние коммиты (щелчок — окно коммита: файлы и строки, onOpen).
 */
export default function CommitsCard({ ok, state, branch, onBranch, onRefresh, onSettings, onOpen }: {
  ok: boolean; state: Load<AqaCommits>; branch: string; onBranch: (b: string) => void; onRefresh: () => void; onSettings: () => void;
  onOpen: (hash: string) => void;
}) {
  const d = state.data;
  return (
    <Card icon={<GitCommitHorizontal className="h-4 w-4 text-primary" />} title="Коммиты автотестов" link={d?.repoUrl}
      extra={ok && <BranchPicker value={branch} onChange={onBranch} disabled={!!state.err && !d} />} onRefresh={onRefresh} busy={state.busy}>
      {!ok ? <Problem err="Репозиторий Bitbucket не подключён." onSettings={onSettings} />
        : state.err ? <Problem err={state.err} onSettings={onSettings} />
        : !d ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Считаю коммиты…</p>
        : (
          <div className={`flex min-h-0 flex-1 flex-col gap-4 transition-opacity ${state.busy ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-3 gap-2">
              <Kpi value={d.today} label="сегодня" tone={d.today ? "text-primary" : undefined} />
              <Kpi value={d.week} label="за 7 дней" />
              <Kpi value={`${d.total}${d.totalTruncated ? "+" : ""}`} label="всего в ветке" />
            </div>
            {d.daily?.length > 0 && <Daily daily={d.daily} />}
            {d.authors?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-text-muted">Авторы за 7 дней:</span>
                {d.authors.slice(0, 6).map(a => (
                  <span key={a.name} className="rounded-full bg-bg-subtle px-2 py-0.5 text-text-main">{a.name} <b className="tabular-nums">{a.count}</b></span>
                ))}
                {d.authors.length > 6 && <span className="text-text-muted">ещё {d.authors.length - 6}</span>}
              </div>
            )}
            {/* Список занимает всё, что осталось до низа карточки: обе карточки одной высоты, без пустоты внизу */}
            <div className="flex min-h-[120px] flex-1 flex-col">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Последние коммиты</p>
              {!(d.recent ?? []).length ? <p className="text-xs text-text-muted">В ветке нет коммитов</p> : (
                <ul className="min-h-0 flex-1 divide-y divide-border-main overflow-y-auto rounded-lg border border-border-main scrollbar-thin">
                  {(d.recent ?? []).map(c => (
                    <li key={c.url}>
                      <button type="button" onClick={() => onOpen(c.hash || c.id)} title={`${c.message}\n${c.author} · ${fmtWhen(c.date)}\nЩелчок — что изменено`}
                        className="group flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-bg-subtle">
                        <span className="flex-shrink-0 rounded bg-bg-subtle px-1.5 py-px font-mono text-[11px] text-primary">{c.id}</span>
                        <span className="min-w-0 flex-1 truncate text-text-main">{c.message || "—"}</span>
                        <span className="flex-shrink-0 text-text-muted">{c.author ? `${c.author} · ` : ""}{ago(c.date)}</span>
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-muted group-hover:text-primary" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
    </Card>
  );
}
