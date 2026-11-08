"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, ChevronRight, ExternalLink, Layers, List, Loader2, Search } from "lucide-react";
import AqaNewIssue from "@/components/aqa/AqaNewIssue";
import TestResultDetail from "@/components/aqa/TestResultDetail";
import Modal from "@/components/ui/Modal";
import { LaunchDot } from "@/components/aqa/LaunchesCard";
import { StatsBar, ago, fmtDur, fmtWhen, passRate, statusItems, statusOf } from "@/components/aqa/widgets";
import { getAqaBehaviors, getAqaLaunch, getAqaResult, type AqaBehavior, type AqaLaunch, type AqaLaunchDetails, type AqaResult } from "@/lib/aqaApi";
import { openForm } from "@/lib/backgroundForms";
import { RefreshIcon } from "@/components/ui/RefreshButton";

const VIEW_KEY = "st_aqa_launch_view";
const NONE = "Без поведения";

/** Дефекты, заведённые из этого окна за сессию: результат → номер в Jira. Окно можно закрыть, память останется. */
const defects = new Map<number, string>();

interface Group { name: string; rows: AqaResult[]; groups: Group[] }

/** Группировка как Behaviors в Allure: эпик › фича › стори. */
function behaviorTree(rows: AqaResult[], of: (r: AqaResult) => AqaBehavior): Group[] {
  const root: Group = { name: "", rows: [], groups: [] };
  for (const r of rows) {
    const b = of(r);
    const path = [b.epic, b.feature, b.story].filter((x): x is string => !!x);
    let g = root;
    for (const name of path.length ? path : [NONE]) {
      let next = g.groups.find(x => x.name === name);
      if (!next) { next = { name, rows: [], groups: [] }; g.groups.push(next); }
      g = next;
    }
    g.rows.push(r);
  }
  return root.groups;
}
const rowsOf = (g: Group): AqaResult[] => [...g.rows, ...g.groups.flatMap(rowsOf)];

/**
 * Запуски Allure TestOps подробно. Слева — последние запуски (переключаются), справа — выбранный: когда, кто,
 * длительность, теги и окружение, кейсы по статусам и результаты кейсов (упавшие сверху) с фильтром по статусу
 * и поиском. Щелчок по кейсу — описание, шаг, на котором упало, ошибка, шаги и вложения (запрос и ответ). Кейсы — списком
 * или деревом как Behaviors в Allure. Напротив кейса — дефект: только к эпикам роадмапа, поэтому он сразу виден на роадмапе.
 */
export default function LaunchModal({ open, launches, launchId, onClose, epics, onDefect }: {
  open: boolean; launches: AqaLaunch[]; launchId: number | null; onClose: () => void;
  /** Эпики роадмапа — единственные, к которым вяжется дефект. */
  epics: { key: string; summary: string }[];
  onDefect: () => void;
}) {
  const [id, setId] = useState<number | null>(launchId);
  const [data, setData] = useState<AqaLaunchDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const seq = useRef(0);
  const [view, setView] = useState<"list" | "behaviors">("list");
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [behaviors, setBehaviors] = useState<Record<string, AqaBehavior>>({});
  const [behaviorNote, setBehaviorNote] = useState("");
  const [behaviorBusy, setBehaviorBusy] = useState(false);
  const [defectBusy, setDefectBusy] = useState<number | null>(null);
  const [, redraw] = useState(0);

  useEffect(() => { if (open) setId(launchId); }, [open, launchId]);
  useEffect(() => {
    try { if (localStorage.getItem(VIEW_KEY) === "behaviors") setView("behaviors"); } catch { /* список по умолчанию */ }
  }, []);
  const pickView = (v: "list" | "behaviors") => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* только на этот раз */ }
  };

  const load = (lid: number, refresh = false) => {
    const n = ++seq.current;
    setBusy(true); setErr("");
    if (!refresh) setData(null);
    getAqaLaunch(lid, refresh).then(r => { if (n === seq.current) setData(r); }, e => { if (n === seq.current) setErr((e as Error).message); })
      .finally(() => { if (n === seq.current) setBusy(false); });
  };
  useEffect(() => {
    if (open && id !== null) { setStatus("all"); setQ(""); setOpenRow(null); setBehaviors({}); setBehaviorNote(""); load(id); }
  }, [open, id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Behaviors: у кого в списке нет эпика, фичи и стори — спрашиваем поштучно, один раз на запуск.
  useEffect(() => {
    if (view !== "behaviors" || !data) return;
    const ids = data.results.filter(r => r.behavior === null && !(r.id in behaviors)).map(r => r.id);
    if (!ids.length) return;
    let alive = true;
    setBehaviorBusy(true); setBehaviorNote("");
    getAqaBehaviors(ids).then(r => {
      if (!alive) return;
      setBehaviors(b => ({ ...b, ...Object.fromEntries(ids.map(i => [String(i), r.behaviors[String(i)] ?? {}])) }));
      if (r.partial) setBehaviorNote(`Поведения получены для первых ${Object.keys(r.behaviors).length} кейсов, остальные — в группе «${NONE}»`);
    }, e => { if (alive) setBehaviorNote(`Поведения не загрузились: ${(e as Error).message}`); })
      .finally(() => { if (alive) setBehaviorBusy(false); });
    return () => { alive = false; };
  }, [view, data]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Дефект из кейса: шаг и ошибку берём из подробностей, не загрузились — заводим по тому, что есть в списке. */
  const reportDefect = async (r: AqaResult) => {
    setDefectBusy(r.id);
    const d = await getAqaResult(r.id).catch(() => null);
    setDefectBusy(null);
    const message = d?.message || r.message;
    const description = [
      `**Автотест:** ${r.name}`,
      data ? `**Запуск:** #${data.id} ${data.name}${data.url ? ` ${data.url}` : ""}` : "",
      d?.failedStep ? `**Шаг с ошибкой:** ${d.failedStep}` : "",
      message ? `**Ошибка:**\n\n\`\`\`\n${message}\n\`\`\`` : "",
      r.url ? `**Тест-кейс в TestOps:** ${r.url}` : "",
    ].filter(Boolean).join("\n\n");
    openForm(control => (
      <AqaNewIssue epic="" epicChoices={epics} control={control} defect={{ summary: `[AQA] ${r.name}`.slice(0, 250), description }}
        onCreated={key => { if (key) { defects.set(r.id, key); redraw(n => n + 1); } onDefect(); }} />
    ));
  };

  const behaviorOf = (r: AqaResult): AqaBehavior => r.behavior ?? behaviors[String(r.id)] ?? {};

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
    <Modal open={open} onClose={onClose} title="Запуски Allure TestOps" size="max-w-7xl">
      <div className="grid h-[76vh] grid-cols-[240px_minmax(0,1fr)] gap-4">
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
                      <RefreshIcon busy={busy} className="h-4 w-4" /></button>
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
                    <div role="group" aria-label="Вид кейсов" className="ml-auto flex rounded-lg border border-border-main p-0.5">
                      <button type="button" onClick={() => pickView("list")} aria-pressed={view === "list"}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${view === "list" ? "bg-primary/10 font-semibold text-primary" : "text-text-muted hover:text-text-main"}`}>
                        <List className="h-3.5 w-3.5" /> Списком</button>
                      <button type="button" onClick={() => pickView("behaviors")} aria-pressed={view === "behaviors"}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${view === "behaviors" ? "bg-primary/10 font-semibold text-primary" : "text-text-muted hover:text-text-main"}`}>
                        <Layers className="h-3.5 w-3.5" /> Behaviors</button>
                    </div>
                    <div className="relative w-56">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Кейс или текст ошибки" aria-label="Поиск по кейсам запуска"
                        className="w-full rounded-md border border-border-main bg-[var(--color-input-bg)] py-1 pl-7 pr-2 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                  </div>
                </div>

                <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-main scrollbar-thin">
                  {!data.results.length ? <p className="p-3 text-sm text-text-muted">Результатов кейсов нет{!data.closed && " — запуск ещё идёт"}</p>
                    : !shown.length ? <p className="p-3 text-sm text-text-muted">Ничего не найдено</p>
                    : view === "list"
                      ? <div>{shown.map(r => <Row key={r.id} r={r} open={openRow === r.id} onToggle={() => setOpenRow(o => (o === r.id ? null : r.id))}
                          onDefect={() => void reportDefect(r)} defectBusy={defectBusy === r.id} />)}</div>
                      : (
                        <div>
                          {behaviorBusy && <p className="flex items-center gap-2 border-b border-border-main p-2 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю эпики, фичи и стори из TestOps…</p>}
                          {behaviorNote && <p className="border-b border-border-main p-2 text-xs text-amber-700 dark:text-amber-400">{behaviorNote}</p>}
                          {behaviorTree(shown, behaviorOf).map(g => (
                            <GroupView key={g.name} g={g} depth={0} renderRow={r => (
                              <Row key={r.id} r={r} open={openRow === r.id} onToggle={() => setOpenRow(o => (o === r.id ? null : r.id))}
                                onDefect={() => void reportDefect(r)} defectBusy={defectBusy === r.id} />
                            )} />
                          ))}
                        </div>
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

/** Кейс: статус, название, время, дефект. Щелчок раскрывает подробности прямо здесь. */
function Row({ r, open, onToggle, onDefect, defectBusy }: { r: AqaResult; open: boolean; onToggle: () => void; onDefect: () => void; defectBusy: boolean }) {
  const s = statusOf(r.status);
  const key = defects.get(r.id);
  return (
    <div className="border-b border-border-main text-xs last:border-b-0">
      <div className="flex items-start gap-2 px-2 py-1.5 hover:bg-bg-subtle/60">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronRight className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
          <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${s.cls}`} title={s.label} />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-text-main">{r.name || `#${r.id}`}</span>
            {r.message && !open && <span className="mt-0.5 line-clamp-2 block font-mono text-[11px] text-text-muted">{r.message}</span>}
          </span>
        </button>
        <span className="flex-shrink-0 tabular-nums text-text-muted">{fmtDur(r.duration)}</span>
        {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" title="Кейс в TestOps" aria-label="Кейс в TestOps" className="flex-shrink-0 text-text-muted hover:text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}
        {key
          ? <span className="flex-shrink-0 font-mono text-[11px] text-orange-600 dark:text-orange-400" title="Дефект заведён">{key}</span>
          : (
            <button type="button" onClick={onDefect} disabled={defectBusy} title="Завести дефект к эпику AQA" aria-label={`Завести дефект: ${r.name}`}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-border-main px-1.5 py-0.5 text-[11px] text-text-main hover:border-red-300 hover:text-red-600 disabled:opacity-50">
              {defectBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bug className="h-3 w-3" />} Дефект</button>
          )}
      </div>
      {open && <TestResultDetail id={r.id} />}
    </div>
  );
}

/** Узел дерева Behaviors: название, сводка по статусам, вложенные группы и кейсы. */
function GroupView({ g, depth, renderRow }: { g: Group; depth: number; renderRow: (r: AqaResult) => React.ReactNode }) {
  const all = rowsOf(g);
  const bad = all.some(r => r.status === "failed" || r.status === "broken");
  // Сразу раскрыто то, где есть падения: ради них и открывают дерево.
  const [open, setOpen] = useState(bad);
  const stats: Record<string, number> = {};
  for (const r of all) stats[r.status] = (stats[r.status] ?? 0) + 1;
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ paddingLeft: depth * 16 + 8 }}
        className="flex w-full items-center gap-2 border-b border-border-main bg-bg-subtle/40 py-1.5 pr-2 text-left text-xs hover:bg-bg-subtle">
        <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1 truncate font-semibold text-text-main" title={g.name}>{g.name}</span>
        {statusItems(stats).map(s => (
          <span key={s.id} className={`inline-flex flex-shrink-0 items-center gap-1 tabular-nums ${s.text}`}><span className={`h-2 w-2 rounded-full ${s.cls}`} />{stats[s.id]}</span>
        ))}
      </button>
      {open && g.groups.map(c => <GroupView key={c.name} g={c} depth={depth + 1} renderRow={renderRow} />)}
      {open && g.rows.length > 0 && <div style={{ paddingLeft: (depth + 1) * 16 }}>{g.rows.map(renderRow)}</div>}
    </div>
  );
}
