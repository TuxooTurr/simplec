"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, Search, X } from "lucide-react";
import { getRun, getRuns, runKind, runKindLabel, type ZRun, type ZRunFull } from "@/lib/zephyrApi";
import { CaseCard, IssueLinks, ResultBar, ResultPill } from "./parts";
import Player from "./Player";
import CaseDialog from "./CaseDialog";
import { Resizer, usePaneSize } from "./Resizer";

/** Плашка вида прогона: НФ — фиолетовая, регресс — синяя, прочее — нейтральная. */
export function RunTypeChip({ type }: { type: string }) {
  if (!type) return null;
  const k = runKind(type);
  const cls = k === "nf" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : k === "regress" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-bg-subtle text-text-muted";
  return <span title={type} className={`inline-block px-1.5 py-px rounded text-[10px] font-semibold whitespace-nowrap ${cls}`}>{runKindLabel(type)}</span>;
}

/**
 * Прогоны (тест-циклы): слева — список с прогрессом прохождения, справа — выбранный прогон:
 * задача Jira, к которой он привязан, и его кейсы со статусами. Клик по кейсу — карточка.
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
  const [refreshing, setRefreshing] = useState(false);
  const [sel, setSel] = useState<string | null>(openKey ?? null);
  const [minimized, setMinimized] = useState(false);
  const listPane = usePaneSize("runs", 320, 240, 640);
  useEffect(() => { if (openKey) setSel(openKey); }, [openKey]);
  const [run, setRun] = useState<ZRunFull | null>(null);
  const [runErr, setRunErr] = useState("");
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    let live = true;
    setRuns(null); setErr("");
    getRuns(project).then(r => live && setRuns(r.runs)).catch(e => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [project, reloadKey]);
  const refresh = async () => {
    setRefreshing(true); setErr("");
    try { setRuns((await getRuns(project, true)).runs); } catch (e) { setErr((e as Error).message); }
    setRefreshing(false);
  };

  useEffect(() => {
    if (!sel) return;
    let live = true;
    setRun(null); setRunErr(""); setCaseKey(null);
    getRun(sel).then(r => live && setRun(r)).catch(e => live && setRunErr((e as Error).message));
    return () => { live = false; };
  }, [sel, reloadKey, localReload]);

  const s = q.trim().toLowerCase();
  const types = useMemo(() => [...new Set((runs ?? []).map(r => r.type).filter(Boolean))].sort(), [runs]);
  const shown = useMemo(() => (runs ?? []).filter(r => (!typeF || r.type === typeF) && (!s || r.name.toLowerCase().includes(s) || r.key.toLowerCase().includes(s))), [runs, s, typeF]);

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
          <button type="button" onClick={refresh} disabled={refreshing} title="Перечитать прогоны из Jira" aria-label="Обновить прогоны"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /></button>
        </div>
        {types.length > 0 && (
          <select value={typeF} onChange={e => setTypeF(e.target.value)} aria-label="Вид тестирования прогона"
            className="mb-2 text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">Все виды тестирования</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {err && <p className="text-sm text-red-600 dark:text-red-400">Прогоны не загрузились: {err}</p>}
        {!runs && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
        {runs && shown.length === 0 && <p className="text-sm text-text-muted">{runs.length ? "Ничего не найдено." : "Прогонов в проекте нет."}</p>}
        <ul className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1" aria-label="Прогоны">
          {shown.map(r => (
            <li key={r.key}>
              <button type="button" onClick={() => setSel(r.key)} aria-pressed={sel === r.key}
                className={`w-full text-left rounded-lg px-2.5 py-2 border ${sel === r.key ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-bg-subtle"}`}>
                <span className="flex items-center gap-1.5">
                  <PlayCircle className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <span className="font-mono text-[11px] text-primary">{r.key}</span>
                  <RunTypeChip type={r.type} />
                  {r.version && <span className="ml-auto text-[10px] text-text-muted truncate max-w-[110px]">{r.version}</span>}
                </span>
                <span className="block text-sm text-text-main truncate mt-0.5">{r.name}</span>
                <span className="block mt-1.5"><ResultBar counts={r.counts} total={r.total} /></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Resizer pane={listPane} label="Ширина списка прогонов" />

      <div className="flex-1 min-w-0 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-4">
          {!sel && <p className="text-sm text-text-muted">Выберите прогон слева.</p>}
          {runErr && <p className="text-sm text-red-600 dark:text-red-400">Прогон не загрузился: {runErr}</p>}
          {sel && !run && !runErr && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
          {run && (
            <div className="space-y-4">
              <div>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-primary">{run.key}</p>
                    <h2 className="text-base font-semibold text-text-main">{run.name}</h2>
                  </div>
                  <button type="button" onClick={() => setPlaying(true)} disabled={!run.items.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                    <PlayCircle className="w-4 h-4" /> Пройти</button>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                  {run.type && <span>Вид тестирования: {run.type}</span>}
                  {run.status && <span>Статус: {run.status}</span>}
                  {run.version && <span>Версия: {run.version}</span>}
                  {run.owner && <span>Владелец: {run.owner}</span>}
                  {(run.plannedStart || run.plannedEnd) && <span>План: {run.plannedStart.slice(0, 10)} — {run.plannedEnd.slice(0, 10)}</span>}
                </div>
              </div>
              <div className="max-w-md"><ResultBar counts={run.counts} total={run.total || run.items.length} /></div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-muted">Отслеживание (задача Jira):</span>
                <IssueLinks keys={run.issueKey ? [run.issueKey] : []} baseUrl={baseUrl} />
              </div>
              <table className="w-full text-sm border border-border-main rounded-xl overflow-hidden">
                <thead className="bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
                  <tr><th className="text-left px-3 py-2">Кейс</th><th className="text-left px-3 py-2">Статус</th><th className="text-left px-3 py-2">Исполнитель</th>
                    <th className="text-left px-3 py-2">Дата</th><th className="text-left px-3 py-2">Дефекты / связи</th></tr>
                </thead>
                <tbody>
                  {run.items.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-text-muted">В прогоне нет кейсов.</td></tr>}
                  {run.items.map((it, i) => (
                    <tr key={`${it.testCaseKey}-${i}`} className={`border-t border-border-main hover:bg-bg-subtle/60 cursor-pointer ${caseKey === it.testCaseKey ? "bg-primary/5" : ""}`}
                      onClick={() => { setCaseKey(it.testCaseKey); setMinimized(false); }}>
                      <td className="px-3 py-1.5 font-mono text-xs text-primary whitespace-nowrap">{it.testCaseKey}</td>
                      <td className="px-3 py-1.5"><ResultPill status={it.status} /></td>
                      <td className="px-3 py-1.5 text-text-main">{it.executedBy || it.assignee || "—"}</td>
                      <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{it.executionDate ? it.executionDate.slice(0, 10) : "—"}</td>
                      <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}><IssueLinks keys={it.issueLinks} baseUrl={baseUrl} /></td>
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
      </div>
      {playing && run && (
        <Player runKey={run.key} project={project} baseUrl={baseUrl} items={run.items}
          onClose={changed => { setPlaying(false); if (changed) setLocalReload(n => n + 1); }} />
      )}
    </div>
  );
}
