"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity, CalendarRange, ExternalLink, GitCommitHorizontal, List, Loader2, RefreshCw, Rocket, Settings2,
} from "lucide-react";
import AqaSettingsModal from "@/components/aqa/AqaSettingsModal";
import RoadmapList from "@/components/aqa/RoadmapList";
import RoadmapTimeline, { ZOOMS } from "@/components/aqa/RoadmapTimeline";
import {
  getAqaCommits, getAqaRoadmap, getAqaSettings, getAqaTestops,
  type AqaCommits, type AqaEpic, type AqaSettings, type AqaStats, type AqaTestops,
} from "@/lib/aqaApi";

const VIEW_KEY = "st_aqa_view";
const ZOOM_KEY = "st_aqa_zoom";

type Load<T> = { data: T | null; err: string; busy: boolean };
const EMPTY = { data: null, err: "", busy: false };

/** Порядок и цвета статусов кейсов TestOps. */
const STATUS: { id: string; label: string; cls: string }[] = [
  { id: "passed", label: "успешно", cls: "bg-emerald-500" },
  { id: "failed", label: "упало", cls: "bg-red-500" },
  { id: "broken", label: "сломано", cls: "bg-amber-500" },
  { id: "skipped", label: "пропущено", cls: "bg-slate-400" },
  { id: "unknown", label: "неизвестно", cls: "bg-violet-400" },
];

const fmtWhen = (iso: string) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function readLs(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeLs(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* только на этот раз */ }
}

function Card({ icon, title, link, onRefresh, busy, children }: {
  icon: ReactNode; title: string; link?: string; onRefresh: () => void; busy: boolean; children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-main bg-bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-text-main">{title}</h2>
        {link && <a href={link} target="_blank" rel="noopener noreferrer" title="Открыть" className="text-text-muted hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>}
        <button type="button" onClick={onRefresh} disabled={busy} title="Обновить" aria-label={`Обновить: ${title}`}
          className="ml-auto p-1 rounded-md text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /></button>
      </div>
      {children}
    </section>
  );
}

function Big({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <p className="text-2xl font-bold tabular-nums text-text-main">{value}</p>
      <p className="text-[11px] text-text-muted">{label}</p>
    </div>
  );
}

function StatsBar({ stats }: { stats: AqaStats }) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-xs text-text-muted">Кейсов нет</p>;
  const known = new Set(STATUS.map(s => s.id));
  const items = [...STATUS.filter(s => stats[s.id]), ...Object.keys(stats).filter(k => !known.has(k)).map(k => ({ id: k, label: k, cls: "bg-slate-300" }))];
  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-bg-subtle">
        {items.map(s => <div key={s.id} className={s.cls} style={{ width: `${(stats[s.id] / total) * 100}%` }} title={`${s.label}: ${stats[s.id]}`} />)}
      </div>
      <p className="flex flex-wrap gap-x-3 text-[11px] text-text-muted">
        {items.map(s => (
          <span key={s.id} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${s.cls}`} />{s.label} <b className="text-text-main tabular-nums">{stats[s.id]}</b></span>
        ))}
      </p>
    </div>
  );
}

function Problem({ err, onSettings }: { err: string; onSettings: () => void }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-red-600 dark:text-red-400">{err}</p>
      <button type="button" onClick={onSettings} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
        <Settings2 className="w-3.5 h-3.5" /> Подключения</button>
    </div>
  );
}

/**
 * «Трекинг AQA» — развитие автотестов: коммиты репозитория (Bitbucket), запуски Allure TestOps и роадмап эпиков AQA
 * из Jira таймлайном (масштаб от дня до года) или списком. Источники — в «Подключениях» (ссылками, как в браузере).
 * Данные кэшируются на сервере 5 минут; «Обновить» — заново.
 */
export default function AqaTrackingSection() {
  const [settings, setSettings] = useState<AqaSettings | null>(null);
  const [commits, setCommits] = useState<Load<AqaCommits>>(EMPTY);
  const [testops, setTestops] = useState<Load<AqaTestops>>(EMPTY);
  const [road, setRoad] = useState<Load<{ epics: AqaEpic[]; loadedAt: string }>>(EMPTY);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [dayW, setDayW] = useState<number>(ZOOMS[1].w);

  useEffect(() => {
    setView(readLs(VIEW_KEY, "timeline") === "list" ? "list" : "timeline");
    const z = Number(readLs(ZOOM_KEY, ""));
    if (z > 0) setDayW(z);
  }, []);

  const run = <T,>(set: (f: (p: Load<T>) => Load<T>) => void, fn: () => Promise<T>) => {
    set(p => ({ ...p, busy: true, err: "" }));
    fn().then(data => set(() => ({ data, err: "", busy: false })), e => set(() => ({ data: null, err: (e as Error).message, busy: false })));
  };
  const loadCommits = useCallback((r = false) => run(setCommits, () => getAqaCommits(r)), []);
  const loadTestops = useCallback((r = false) => run(setTestops, () => getAqaTestops(r)), []);
  const loadRoad = useCallback((r = false) => run(setRoad, () => getAqaRoadmap(r)), []);

  const loadAll = useCallback((refresh = false) => {
    getAqaSettings().then(s => {
      setSettings(s);
      if (s.bitbucketOk) loadCommits(refresh); else setCommits(EMPTY);
      if (s.testopsOk) loadTestops(refresh); else setTestops(EMPTY);
      if (s.epics.length) loadRoad(refresh); else setRoad(EMPTY);
    }, e => setCommits({ data: null, err: (e as Error).message, busy: false }));
  }, [loadCommits, loadTestops, loadRoad]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const pickView = (v: "timeline" | "list") => { setView(v); writeLs(VIEW_KEY, v); };
  const pickZoom = (w: number) => { setDayW(w); writeLs(ZOOM_KEY, String(w)); };
  const epics = road.data?.epics ?? [];
  const issuesTotal = epics.reduce((n, e) => n + e.issues.length, 0);
  const ZBTN = "px-2.5 py-1 text-xs rounded-md transition-colors";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border-main bg-bg-card px-6 py-3">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Трекинг AQA</h1>
        <span className="text-xs text-text-muted">коммиты, запуски автотестов и роадмап</span>
        <button type="button" onClick={() => loadAll(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
          <RefreshCw className="h-4 w-4" /> Обновить всё</button>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
          <Settings2 className="h-4 w-4" /> Подключения</button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6 scrollbar-thin">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card icon={<GitCommitHorizontal className="h-4 w-4 text-primary" />} title="Коммиты автотестов" link={commits.data?.repoUrl}
            onRefresh={() => loadCommits(true)} busy={commits.busy}>
            {!settings?.bitbucketOk ? <Problem err="Репозиторий Bitbucket не подключён." onSettings={() => setOpen(true)} />
              : commits.err ? <Problem err={commits.err} onSettings={() => setOpen(true)} />
              : !commits.data ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Считаю коммиты…</p>
              : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Big value={commits.data.today} label="сегодня" />
                    <Big value={commits.data.week} label="за 7 дней" />
                    <Big value={`${commits.data.total}${commits.data.totalTruncated ? "+" : ""}`} label="всего" />
                  </div>
                  {commits.data.last && (
                    <p className="text-xs text-text-muted">
                      Последний: <a href={commits.data.last.url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">{commits.data.last.id}</a>
                      {" "}· {commits.data.last.author} · {fmtWhen(commits.data.last.date)}
                      <span className="block truncate text-text-main" title={commits.data.last.message}>{commits.data.last.message}</span>
                    </p>
                  )}
                </div>
              )}
          </Card>

          <Card icon={<Rocket className="h-4 w-4 text-primary" />} title="Запуски Allure TestOps" link={testops.data?.projectUrl}
            onRefresh={() => loadTestops(true)} busy={testops.busy}>
            {!settings?.testopsOk ? <Problem err="Проект Allure TestOps не подключён." onSettings={() => setOpen(true)} />
              : testops.err ? <Problem err={testops.err} onSettings={() => setOpen(true)} />
              : !testops.data ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю запуски…</p>
              : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Big value={testops.data.todayLaunches} label="запусков сегодня" />
                    <Big value={testops.data.last ? fmtWhen(testops.data.last.date) : "—"} label="последний запуск" />
                  </div>
                  {testops.data.last && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted">
                        Последний: <a href={testops.data.last.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{testops.data.last.name || `#${testops.data.last.id}`}</a>
                        {!testops.data.last.closed && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">идёт</span>}
                      </p>
                      <StatsBar stats={testops.data.last.stats} />
                    </div>
                  )}
                  {testops.data.todayLaunches > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted">Все запуски за сегодня{testops.data.todayStatsPartial ? " (первые 30)" : ""}:</p>
                      <StatsBar stats={testops.data.todayStats} />
                    </div>
                  )}
                </div>
              )}
          </Card>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-text-main">Роадмап</h2>
            {road.data && <span className="text-xs text-text-muted">эпиков {epics.length} · задач и дефектов {issuesTotal}</span>}
            <button type="button" onClick={() => loadRoad(true)} disabled={road.busy || !settings?.epics.length} title="Обновить роадмап" aria-label="Обновить роадмап"
              className="p-1 rounded-md text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-40">
              <RefreshCw className={`h-3.5 w-3.5 ${road.busy ? "animate-spin" : ""}`} /></button>
            <span className="flex-1" />
            {view === "timeline" && (
              <div role="group" aria-label="Масштаб" className="flex rounded-lg border border-border-main p-0.5">
                {ZOOMS.map(z => (
                  <button key={z.id} type="button" onClick={() => pickZoom(z.w)} aria-pressed={dayW === z.w}
                    className={`${ZBTN} ${dayW === z.w ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main"}`}>{z.label}</button>
                ))}
              </div>
            )}
            <div role="group" aria-label="Вид роадмапа" className="flex rounded-lg border border-border-main p-0.5">
              <button type="button" onClick={() => pickView("timeline")} aria-pressed={view === "timeline"}
                className={`${ZBTN} inline-flex items-center gap-1 ${view === "timeline" ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main"}`}>
                <CalendarRange className="h-3.5 w-3.5" /> Таймлайн</button>
              <button type="button" onClick={() => pickView("list")} aria-pressed={view === "list"}
                className={`${ZBTN} inline-flex items-center gap-1 ${view === "list" ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main"}`}>
                <List className="h-3.5 w-3.5" /> Список</button>
            </div>
          </div>
          {view === "timeline" && road.data && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-blue-500/85" /> в работе</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-slate-400/80" /> не начата</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-red-500/85" /> дефект</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-emerald-500/80" /> решена</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded ring-2 ring-red-600" /> просрочена</span>
              <span>Полоса — от создания до срока; Ctrl + колесо — масштаб, перетаскивание — прокрутка</span>
            </p>
          )}
          {!settings?.epics.length ? <Problem err="Эпики роадмапа не заданы." onSettings={() => setOpen(true)} />
            : road.err ? <Problem err={road.err} onSettings={() => setOpen(true)} />
            : !road.data ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю эпики из Jira…</p>
            : view === "timeline" ? <RoadmapTimeline epics={epics} dayW={dayW} onDayW={pickZoom} />
            : <RoadmapList epics={epics} />}
        </section>
      </div>

      <AqaSettingsModal open={open} onClose={() => setOpen(false)} onSaved={() => loadAll(true)} />
    </div>
  );
}
