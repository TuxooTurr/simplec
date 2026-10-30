"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, CalendarRange, List, Loader2, RefreshCw, Settings2 } from "lucide-react";
import AqaSettingsModal from "@/components/aqa/AqaSettingsModal";
import CommitModal from "@/components/aqa/CommitModal";
import CommitsCard from "@/components/aqa/CommitsCard";
import LaunchesCard from "@/components/aqa/LaunchesCard";
import LaunchModal from "@/components/aqa/LaunchModal";
import RoadmapList from "@/components/aqa/RoadmapList";
import RoadmapTimeline, { DONE_CLS, LATE_CLS, STATUS_COLORS, ZOOMS, peopleColors, type ColorBy } from "@/components/aqa/RoadmapTimeline";
import { Problem, fmtWhen } from "@/components/aqa/widgets";
import {
  getAqaCommits, getAqaRoadmap, getAqaSettings, getAqaTestops, saveAqaSettings,
  type AqaCommits, type AqaRoadmap, type AqaSettings, type AqaTestops, type PlanFields,
} from "@/lib/aqaApi";
import { AQA_REFRESH_MS, aqaCache, isFresh, persistAqaCache, putCommits, sameSource, type Entry } from "@/lib/aqaCache";

const VIEW_KEY = "st_aqa_view";
const ZOOM_KEY = "st_aqa_zoom";
const COLOR_KEY = "st_aqa_color";
const BRANCH_KEY = "st_aqa_branch";

type Load<T> = { data: T | null; err: string; busy: boolean };
const EMPTY = { data: null, err: "", busy: false };

function readLs(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeLs(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* только на этот раз */ }
}

/**
 * «Трекинг AQA» — развитие автотестов: коммиты выбранной ветки репозитория (Bitbucket), запуски Allure TestOps
 * (щелчок по запуску — окно с подробностями) и роадмап эпиков AQA из Jira таймлайном (масштаб от дня до года)
 * или списком. Источники — в «Подключениях» (ссылками, как в браузере).
 * Данные — из кэша сессии (lib/aqaCache.ts, как у Jira tool): видны сразу, фоном обновляются раз в 30 минут;
 * сервер дополнительно держит ответы 5 минут. «Обновить» — заново, мимо кэшей.
 */
export default function AqaTrackingSection() {
  const [settings, setSettings] = useState<AqaSettings | null>(null);
  const [commits, setCommits] = useState<Load<AqaCommits>>(EMPTY);
  const [testops, setTestops] = useState<Load<AqaTestops>>(EMPTY);
  const [road, setRoad] = useState<Load<AqaRoadmap>>(EMPTY);
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [launch, setLaunch] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [commit, setCommit] = useState<string | null>(null);
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [dayW, setDayW] = useState<number>(ZOOMS[1].w);
  const [colorBy, setColorBy] = useState<ColorBy>("status");

  useEffect(() => {
    setView(readLs(VIEW_KEY, "timeline") === "list" ? "list" : "timeline");
    setColorBy(readLs(COLOR_KEY, "status") === "assignee" ? "assignee" : "status");
    setBranch(readLs(BRANCH_KEY, ""));
    const raw = readLs(ZOOM_KEY, "");
    const z = Number(raw);
    if (raw !== "" && Number.isFinite(z) && z >= 0) setDayW(z);     // 0 — «3 квартала»
  }, []);

  /**
   * Загрузка через кэш сессии (lib/aqaCache.ts): запись того же источника видна сразу; свежая (до 30 минут) —
   * запроса нет; устарела или «Обновить» — грузим, старые данные остаются на экране. Сбой при данных на экране —
   * данные остаются, причина — строкой в шапке; без данных — в карточке. Ответ, пришедший после более нового
   * запроса (сменили ветку), отбрасывается.
   */
  const settingsRef = useRef<AqaSettings | null>(null);
  settingsRef.current = settings;
  const seqs = useRef({ commits: 0, testops: 0, road: 0 });
  const [stale, setStale] = useState<Record<string, string>>({});
  const loadVia = useCallback(<T,>(slot: "commits" | "testops" | "road", label: string, set: (f: (p: Load<T>) => Load<T>) => void,
                                   hit: Entry<T> | null, key: string, force: boolean, fetch: () => Promise<T>, put: (d: T) => void) => {
    if (hit) set(() => ({ data: hit.data, err: "", busy: false }));
    if (!force && hit && isFresh(hit, key)) return;
    const n = ++seqs.current[slot];
    set(p => ({ ...p, busy: true, err: "" }));
    fetch().then(data => {
      if (n !== seqs.current[slot]) return;
      put(data);
      set(() => ({ data, err: "", busy: false }));
      setStale(st => { const { [slot]: _, ...rest } = st; return rest; });
    }, e => {
      if (n !== seqs.current[slot]) return;
      const msg = (e as Error).message;
      set(p => (p.data ? { ...p, busy: false } : { data: null, err: msg, busy: false }));
      if (hit) setStale(st => ({ ...st, [slot]: `${label}: ${msg}` }));
    });
  }, []);

  const loadCommits = useCallback((r = false, b = "") => {
    const key = `${settingsRef.current?.bitbucketUrl ?? ""}|${b}`;
    const hit = sameSource(aqaCache().commits[key], key);
    loadVia("commits", "Коммиты", setCommits, hit, key, r, () => getAqaCommits(b, r), d => putCommits(key, d));
  }, [loadVia]);
  const loadTestops = useCallback((r = false) => {
    const key = settingsRef.current?.testopsUrl ?? "";
    loadVia("testops", "Запуски", setTestops, sameSource(aqaCache().testops, key), key, r, () => getAqaTestops(r),
      d => { aqaCache().testops = { key, data: d, at: Date.now() }; persistAqaCache(); });
  }, [loadVia]);
  const loadRoad = useCallback((r = false) => {
    const key = (settingsRef.current?.epics ?? []).join(",");
    loadVia("road", "Роадмап", setRoad, sameSource(aqaCache().roadmap, key), key, r, () => getAqaRoadmap(r),
      d => { aqaCache().roadmap = { key, data: d, at: Date.now() }; persistAqaCache(); });
  }, [loadVia]);

  const loadAll = useCallback((refresh = false) => {
    if (branch === null) return;                     // ветка ещё не прочитана из браузера
    const apply = (s: AqaSettings) => {
      setSettings(s); settingsRef.current = s;
      if (s.bitbucketOk) loadCommits(refresh, branch); else setCommits(EMPTY);
      if (s.testopsOk) loadTestops(refresh); else setTestops(EMPTY);
      if (s.epics.length) loadRoad(refresh); else setRoad(EMPTY);
    };
    getAqaSettings().then(s => { aqaCache().settings = s; persistAqaCache(); apply(s); },
      e => {
        const cached = aqaCache().settings;           // бэкенд недоступен — показываем, что было в кэше
        if (cached && !refresh) apply(cached);
        else setCommits({ data: null, err: (e as Error).message, busy: false });
      });
  }, [loadCommits, loadTestops, loadRoad, branch]);
  // Сразу — из кэша (без ожидания настроек), потом проверка свежести; пока раздел открыт — фоном раз в 30 минут.
  useEffect(() => {
    if (branch === null) return;
    const s = aqaCache().settings;
    if (s) {
      setSettings(s); settingsRef.current = s;
      const c = sameSource(aqaCache().commits[`${s.bitbucketUrl}|${branch}`], `${s.bitbucketUrl}|${branch}`);
      if (c) setCommits({ data: c.data, err: "", busy: false });
      const t = sameSource(aqaCache().testops, s.testopsUrl);
      if (t) setTestops({ data: t.data, err: "", busy: false });
      const rm = sameSource(aqaCache().roadmap, s.epics.join(","));
      if (rm) setRoad({ data: rm.data, err: "", busy: false });
    }
    loadAll();
    const id = window.setInterval(() => loadAll(), AQA_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [branch === null]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pickView = (v: "timeline" | "list") => { setView(v); writeLs(VIEW_KEY, v); };
  const pickZoom = (w: number) => { setDayW(w); writeLs(ZOOM_KEY, String(w)); };
  const pickColor = (c: ColorBy) => { setColorBy(c); writeLs(COLOR_KEY, c); };
  const pickBranch = (b: string) => { setBranch(b); writeLs(BRANCH_KEY, b); loadCommits(false, b); };

  /** Эпики роадмапа меняются прямо с графика: сохраняем в настройках (маркеры — масками, они не меняются) и перечитываем. */
  const setEpics = async (next: string[]) => {
    const cur = settings ?? await getAqaSettings();
    const saved = await saveAqaSettings({ bitbucketUrl: cur.bitbucketUrl, bitbucketToken: cur.bitbucketToken, testopsUrl: cur.testopsUrl,
      testopsToken: cur.testopsToken, epics: next });
    setSettings(saved);
    if (saved.epics.length) loadRoad(true); else setRoad(EMPTY);
  };
  const addEpic = (key: string) => setEpics([...(settings?.epics ?? []), key]);
  const removeEpic = (key: string) => setEpics((settings?.epics ?? []).filter(k => k !== key));
  const people = peopleColors(road.data?.epics ?? []);
  const epics = road.data?.epics ?? [];
  const issuesTotal = epics.reduce((n, e) => n + e.issues.length, 0);
  const ZBTN = "px-2.5 py-1 text-xs rounded-md transition-colors";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border-main bg-bg-card px-6 py-3">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Трекинг AQA</h1>
        <span className="text-xs text-text-muted">коммиты, запуски автотестов и роадмап</span>
        {Object.keys(stale).length > 0 && (
          <span className="truncate text-xs text-amber-700 dark:text-amber-400" title={Object.values(stale).join("\n")}>
            Не обновилось — показано из кэша: {Object.values(stale).map(m => m.split(":")[0]).join(", ")}</span>
        )}
        <button type="button" onClick={() => loadAll(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
          <RefreshCw className="h-4 w-4" /> Обновить всё</button>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
          <Settings2 className="h-4 w-4" /> Подключения</button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6 scrollbar-thin">
        {/* Одинаковая высота виджетов: списки внутри дотягиваются до низа и прокручиваются */}
        <div className="grid grid-cols-1 gap-4 lg:h-[540px] lg:grid-cols-2">
          <CommitsCard ok={!!settings?.bitbucketOk} state={commits} branch={branch ?? ""} onBranch={pickBranch}
            onRefresh={() => loadCommits(true, branch ?? "")} onSettings={() => setOpen(true)} onOpen={setCommit} />
          <LaunchesCard ok={!!settings?.testopsOk} state={testops} onRefresh={() => loadTestops(true)} onSettings={() => setOpen(true)}
            onOpen={id => setLaunch({ open: true, id })} />
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
              <div role="group" aria-label="Цвет полос" className="flex rounded-lg border border-border-main p-0.5">
                {([["status", "По статусу"], ["assignee", "По исполнителю"]] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => pickColor(id)} aria-pressed={colorBy === id}
                    className={`${ZBTN} ${colorBy === id ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main"}`}>{label}</button>
                ))}
              </div>
            )}
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
          {road.data?.snapshot && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400" title={road.data.snapshot.reason}>
              Jira недоступна — показан снимок от {fmtWhen(road.data.snapshot.savedAt)}: он сохраняется при каждой загрузке
              и входит в резервную копию. Причина — в подсказке.
            </p>
          )}
          {road.data?.planFields && <PlanFieldsNote pf={road.data.planFields} />}
          {settings && !settings.epics.length
            ? (view === "timeline"
              ? <RoadmapTimeline epics={[]} dayW={dayW} onDayW={pickZoom} colorBy={colorBy} onAddEpic={addEpic} onRemoveEpic={removeEpic} />
              : <Problem err="Эпики роадмапа не заданы — добавьте их на таймлайне или в «Подключениях»." onSettings={() => setOpen(true)} />)
            : road.err ? <Problem err={road.err} onSettings={() => setOpen(true)} />
            : !road.data ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю эпики из Jira…</p>
            : view === "timeline" ? <RoadmapTimeline epics={epics} dayW={dayW} onDayW={pickZoom} colorBy={colorBy} onAddEpic={addEpic} onRemoveEpic={removeEpic} />
            : <RoadmapList epics={epics} />}
          {/* Легенда — под графиком */}
          {view === "timeline" && (road.data || (settings && !settings.epics.length)) && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-text-muted">
              {colorBy === "status"
                ? STATUS_COLORS.map(c => <span key={c.id} className="inline-flex items-center gap-1"><span className={`h-2.5 w-4 rounded ${c.cls}`} /> {c.label}</span>)
                : <>
                  {[...people.entries()].map(([name, cls]) => <span key={name} className="inline-flex items-center gap-1"><span className={`h-2.5 w-4 rounded ${cls}`} /> {name}</span>)}
                  {epics.some(e => e.issues.some(i => !i.assignee)) && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-slate-400/70" /> не назначен</span>}
                </>}
              <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-4 rounded ${DONE_CLS}`} />
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] text-white">✓</span> выполнена в срок</span>
              <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-4 rounded ${LATE_CLS}`} />
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">!</span> нарушение срока</span>
              <span className="inline-flex items-center gap-1">
                <span className="relative h-2.5 w-7 overflow-hidden rounded">
                  <span className="absolute inset-y-0 left-0 w-3 bg-blue-500/85" />
                  <span className="absolute inset-y-0 left-3 right-0" style={{ background: "repeating-linear-gradient(135deg, rgb(220 38 38 / .85) 0 3px, rgb(220 38 38 / .45) 3px 6px)" }} />
                </span> после точки — сверх планового окончания</span>
              <span>Полоса — от планового начала до планового окончания; календарь — на год вперёд; Ctrl (Cmd) + колесо — масштаб, дальше всего — три квартала от сегодня; перетаскивание — прокрутка</span>
            </p>
          )}
        </section>
      </div>

      <AqaSettingsModal open={open} onClose={() => setOpen(false)} onSaved={() => loadAll(true)} />
      <CommitModal hash={commit} onClose={() => setCommit(null)} />
      <LaunchModal open={launch.open} launchId={launch.id} launches={testops.data?.recent ?? []} onClose={() => setLaunch(l => ({ ...l, open: false }))} />
    </div>
  );
}


/**
 * Откуда роадмап берёт плановые даты: поле Jira и у скольких задач оно заполнено. Поле не нашлось или пусто у всех —
 * жёлтым: полоса тогда идёт от даты создания до срока (duedate). Все подошедшие по названию поля — в подсказке.
 */
function PlanFieldsNote({ pf }: { pf: PlanFields }) {
  const total = pf.total ?? 0;
  const part = (k: "start" | "end", label: string, fallback: string) => {
    const f = pf[k];
    const n = pf.filled?.[k];
    const all = pf.candidates?.[k] ?? [];
    const tip = all.length ? `Подошли по названию: ${all.map(c => `«${c.name}» (${c.id})`).join(", ")}` : "Подходящих по названию полей нет";
    const bad = !f || (n !== undefined && total > 0 && n === 0);
    return {
      bad,
      node: (
        <span key={k} title={tip} className={bad ? "text-amber-700 dark:text-amber-400" : undefined}>
          {label}: {!f ? `поле не найдено — берётся ${fallback}`
            : <>«{f.name}» <span className="font-mono">{f.id}</span>{n !== undefined && total > 0 && ` — заполнено у ${n} из ${total}`}
              {n === 0 && total > 0 && `, берётся ${fallback}`}</>}
          {all.length > 1 && ` · полей с таким названием: ${all.length}`}
        </span>
      ),
    };
  };
  const s = part("start", "Плановое начало", "дата создания");
  const e = part("end", "Плановое окончание", "срок (duedate)");
  return (
    <p className={`flex flex-wrap gap-x-4 text-[11px] ${s.bad || e.bad ? "" : "text-text-muted"}`}>
      {s.node}{e.node}
    </p>
  );
}
