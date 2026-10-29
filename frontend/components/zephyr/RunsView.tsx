"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderTree as FolderTreeIcon, Loader2, PlayCircle, RefreshCw, Search, X } from "lucide-react";
import { fmtDate, fmtDuration, getRun, getRuns, zephyrRunUrl, type ZFolder, type ZRun, type ZRunFull } from "@/lib/zephyrApi";
import FolderTree from "./FolderTree";
import { CaseCard, IssueLinks, ResultBar, ResultPill } from "./parts";
import Player from "./Player";
import CaseDialog from "./CaseDialog";
import RunCard, { RunTypeChip } from "./RunCard";
import { Resizer, usePaneSize } from "./Resizer";

/** Кейсы открытых прогонов — в памяти до перезагрузки страницы: повторный клик не ходит в Jira, «Обновить» — ходит. */
const runCache = new Map<string, ZRunFull>();

type Sort = "new" | "old";
const SORT_KEY = "st_zephyr_runs_sort";
/** Дерево папок прогонов — из путей прогонов (папки прогонов API отдельно не отдаёт); count — с вложенными. */
export function runFolderTree(runs: ZRun[]): ZFolder[] {
  type Node = { name: string; path: string; count: number; children: Map<string, Node> };
  const root: Node = { name: "", path: "", count: 0, children: new Map() };
  for (const r of runs) {
    let node = root, acc = "";
    for (const part of (r.folder || "").split("/").filter(Boolean)) {
      acc += "/" + part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path: acc, count: 0, children: new Map() });
      node = node.children.get(part)!;
      node.count += 1;
    }
  }
  const out = (n: Node): ZFolder[] => [...n.children.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map(c => ({ name: c.name, path: c.path, count: c.count, children: out(c) }));
  return out(root);
}

/** Время создания прогона для сортировки; нет даты — по номеру прогона. */
const created = (r: ZRun) => Date.parse(r.created || "") || Number(r.key.replace(/\D/g, "")) || 0;

/**
 * Прогоны: слева — карточки (номер, название, прогресс, дата создания, «Пройти»), фильтр по виду тестирования
 * и сортировка по дате; справа — выбранный прогон: кейсы с номером, статусом, названием и временем прохождения.
 */
export default function RunsView({ project, baseUrl, reloadKey, openKey }: {
  project: string; baseUrl: string; reloadKey: number;
  /** Сразу открыть этот прогон (переход из строки релиза). */
  openKey?: string | null;
}) {
  const [runs, setRuns] = useState<ZRun[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  /** Папка прогонов: "" — все; выбранная — с вложенными. */
  const [folder, setFolder] = useState("");
  const [treeOpen, setTreeOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sel, setSel] = useState<string | null>(openKey ?? null);
  const [run, setRun] = useState<ZRunFull | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runErr, setRunErr] = useState("");
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [playing, setPlaying] = useState(false);
  const listPane = usePaneSize("runs", 460, 300, 900);
  useEffect(() => { if (openKey) setSel(openKey); }, [openKey]);
  useEffect(() => { try { const v = localStorage.getItem(SORT_KEY); if (v === "old" || v === "new") setSort(v); } catch { /* по умолчанию */ } }, []);
  const changeSort = (v: Sort) => { setSort(v); try { localStorage.setItem(SORT_KEY, v); } catch { /* не запомнится */ } };

  const loadRuns = useCallback(async (refresh = false) => {
    setErr("");
    try { setRuns((await getRuns(project, refresh)).runs); } catch (e) { setErr((e as Error).message); }
  }, [project]);
  useEffect(() => { setRuns(null); void loadRuns(); }, [loadRuns, reloadKey]);
  const refreshList = async () => { setRefreshing(true); await loadRuns(true); setRefreshing(false); };

  /** Кейсы прогона: из кеша, если уже открывали; force — перечитать из Jira. */
  const openRun = useCallback(async (key: string, force = false) => {
    setRunErr(""); setCaseKey(null);
    const hit = runCache.get(key);
    if (hit && !force) { setRun(hit); return; }
    if (!hit) setRun(null);
    setRunBusy(true);
    try {
      const r = await getRun(key);
      runCache.set(key, r);
      setRun(cur => (cur === null || cur.key === key ? r : cur));
      setRuns(list => list?.map(x => (x.key === key ? { ...x, counts: r.counts, total: r.total } : x)) ?? list);
    } catch (e) { setRunErr((e as Error).message); }
    setRunBusy(false);
  }, []);
  useEffect(() => { if (sel) void openRun(sel); }, [sel, openRun]);

  const types = useMemo(() => [...new Set((runs ?? []).map(r => r.type).filter(Boolean))].sort(), [runs]);
  const s = q.trim().toLowerCase();
  const tree = useMemo(() => runFolderTree(runs ?? []), [runs]);
  const inFolder = (r: ZRun) => !folder || r.folder === folder || (r.folder || "").startsWith(folder + "/");
  const shown = useMemo(() => (runs ?? [])
    .filter(r => inFolder(r) && (!typeF || r.type === typeF) && (!s || r.name.toLowerCase().includes(s) || r.key.toLowerCase().includes(s)))
    .sort((a, b) => (sort === "new" ? created(b) - created(a) : created(a) - created(b))), [runs, s, typeF, sort, folder]);   // eslint-disable-line react-hooks/exhaustive-deps

  const SELECT = "text-sm border border-border-main rounded-lg px-2 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="flex h-full min-h-0">
      <div style={{ width: listPane.size }} className="flex-shrink-0 flex flex-col min-h-0 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <label className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30">
            <Search className="w-3.5 h-3.5 text-text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти прогон" aria-label="Найти прогон"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Очистить"><X className="w-3.5 h-3.5 text-text-muted" /></button>}
          </label>
          <button type="button" onClick={refreshList} disabled={refreshing} title="Перечитать список прогонов из Jira" aria-label="Обновить прогоны"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /></button>
        </div>
        <div className="flex items-center gap-1.5 mb-2">
          <select value={typeF} onChange={e => setTypeF(e.target.value)} aria-label="Вид тестирования прогона" className={`${SELECT} min-w-0 flex-1`}>
            <option value="">Все виды тестирования</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={sort} onChange={e => changeSort(e.target.value as Sort)} aria-label="Сортировка по дате создания" className={SELECT}>
            <option value="new">Сначала новые</option>
            <option value="old">Сначала старые</option>
          </select>
        </div>
        {runs && tree.length > 0 && (
          // Папки прогонов — как дерево кейсов: выбор папки показывает её прогоны вместе с вложенными.
          <div className="mb-2 rounded-lg border border-border-main">
            <button type="button" onClick={() => setTreeOpen(o => !o)} aria-expanded={treeOpen}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm">
              <FolderTreeIcon className="w-4 h-4 text-text-muted" />
              <span className="font-medium text-text-main">Папки прогонов</span>
              <span className="min-w-0 flex-1 truncate text-right text-[11px] text-text-muted">{folder || "все"}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${treeOpen ? "rotate-180" : ""}`} />
            </button>
            {treeOpen && (
              <div className="px-1.5 pb-1.5 max-h-72 overflow-hidden flex flex-col">
                <FolderTree folders={tree} total={runs.length} selected={folder} onSelect={setFolder} rootLabel="Все прогоны" />
              </div>
            )}
          </div>
        )}
        {err && <p className="text-sm text-red-600 dark:text-red-400">Прогоны не загрузились: {err}</p>}
        {!runs && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
        {runs && shown.length === 0 && <p className="text-sm text-text-muted">{runs.length ? (folder ? "В этой папке прогонов нет." : "Ничего не найдено.") : "Прогонов в проекте нет."}</p>}
        <ul className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1.5" aria-label="Прогоны">
          {shown.map(r => (
            <li key={r.key}>
              <RunCard run={r} baseUrl={baseUrl} active={sel === r.key} onOpen={() => setSel(r.key)}
                onPassed={() => { void loadRuns(); if (sel === r.key) void openRun(r.key, true); else runCache.delete(r.key); }} />
            </li>
          ))}
        </ul>
      </div>
      <Resizer pane={listPane} label="Ширина списка прогонов" />

      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-4">
        {!sel && <p className="text-sm text-text-muted">Выберите прогон слева.</p>}
        {runErr && <p className="text-sm text-red-600 dark:text-red-400">Прогон не загрузился: {runErr}</p>}
        {sel && !run && !runErr && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю кейсы прогона…</p>}
        {run && (
          <div className="space-y-4">
            <div>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-mono text-xs text-primary">
                    {baseUrl
                      ? <a href={zephyrRunUrl(baseUrl, run.key)} target="_blank" rel="noopener noreferrer" title="Открыть прогон в Jira (страница прогона)"
                          className="hover:underline">{run.key} ↗</a>
                      : run.key}
                    <RunTypeChip type={run.type} /></p>
                  <h2 className="text-base font-semibold text-text-main">{run.name}</h2>
                </div>
                <button type="button" onClick={() => openRun(run.key, true)} disabled={runBusy} title="Перечитать кейсы прогона из Jira"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${runBusy ? "animate-spin" : ""}`} /> Обновить</button>
                <button type="button" onClick={() => setPlaying(true)} disabled={!run.items.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                  <PlayCircle className="w-4 h-4" /> Плеер</button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>Создан: {fmtDate(run.created)}</span>
                {run.status && <span>Статус: {run.status}</span>}
                {run.version && <span>Версия: {run.version}</span>}
                <span className="flex items-center gap-1">Отслеживание: <IssueLinks keys={run.issueKey ? [run.issueKey] : []} baseUrl={baseUrl} /></span>
              </div>
            </div>
            <div className="max-w-md"><ResultBar counts={run.counts} total={run.total || run.items.length} /></div>
            <table className="w-full text-sm border border-border-main rounded-xl overflow-hidden">
              <thead className="bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
                <tr><th className="text-left px-3 py-2 w-32">Кейс</th><th className="text-left px-3 py-2 w-32">Статус</th>
                  <th className="text-left px-3 py-2">Название</th><th className="text-left px-3 py-2 w-32">Время прохождения</th>
                  <th className="text-left px-3 py-2 w-28">Дата</th></tr>
              </thead>
              <tbody>
                {run.items.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-text-muted">В прогоне нет кейсов.</td></tr>}
                {run.items.map((it, i) => (
                  <tr key={`${it.testCaseKey}-${i}`} onClick={() => { setCaseKey(it.testCaseKey); setMinimized(false); }}
                    className={`border-t border-border-main hover:bg-bg-subtle/60 cursor-pointer ${caseKey === it.testCaseKey ? "bg-primary/5" : ""}`}>
                    <td className="px-3 py-1.5 font-mono text-xs text-primary whitespace-nowrap">{it.testCaseKey}</td>
                    <td className="px-3 py-1.5"><ResultPill status={it.status} /></td>
                    <td className="px-3 py-1.5 text-text-main"><span className="block truncate max-w-[520px]" title={it.name}>{it.name || "—"}</span></td>
                    <td className="px-3 py-1.5 text-text-main whitespace-nowrap tabular-nums">{fmtDuration(it.executionTime)}</td>
                    <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{it.executionDate ? fmtDate(it.executionDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {caseKey && (
        <CaseDialog label={`Кейс ${caseKey}`} title={caseKey} minimized={minimized}
          onMinimize={() => setMinimized(true)} onRestore={() => setMinimized(false)} onClose={() => setCaseKey(null)}>
          <CaseCard caseKey={caseKey} baseUrl={baseUrl} onClose={() => setCaseKey(null)} onMinimize={() => setMinimized(true)} />
        </CaseDialog>
      )}
      {playing && run && (
        <Player runKey={run.key} project={project} baseUrl={baseUrl} items={run.items}
          onClose={changed => { setPlaying(false); if (changed) void openRun(run.key, true); }} />
      )}
    </div>
  );
}
