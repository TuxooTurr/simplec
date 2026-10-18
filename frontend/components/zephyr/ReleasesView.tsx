"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleDashed, ExternalLink, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import {
  addRelease, addReleaseRun, getReleaseBoard, getReleases, getRuns, removeRelease, removeReleaseRun, runKind,
  type BoardRun, type ReleaseBoard, type ZLinked, type ZRun,
} from "@/lib/zephyrApi";
import { ResultBar } from "./parts";
import { RunTypeChip } from "./RunsView";
import CritRegressView from "./CritRegressView";

const INPUT = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

type BoardState = { data?: ReleaseBoard; err?: string; busy?: boolean };

/** Стори — по типу задачи; если связанных стори нет совсем, считаем по всем связанным задачам. */
const isStory = (i: ZLinked) => /истори|стори|story/i.test(i.issuetype);
const storiesOf = (b: ReleaseBoard) => (b.release.stories.some(isStory) ? b.release.stories.filter(isStory) : b.release.stories);
const hasNf = (b: ReleaseBoard, key: string) => (b.storyRuns[key] ?? []).some(r => runKind(r.type) === "nf");

/** Маркер строки релиза: зелёный — есть, янтарный — частично, серый — нет. */
function Marker({ tone, children, title }: { tone: "ok" | "part" | "none"; children: React.ReactNode; title: string }) {
  const cls = tone === "ok" ? "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/30"
    : tone === "part" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
    : "bg-bg-subtle text-text-muted border-border-main";
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

function Markers({ b }: { b: ReleaseBoard }) {
  const regress = b.runs.filter(r => runKind(r.type) === "regress");
  const st = storiesOf(b);
  const nf = st.filter(s => hasNf(b, s.key)).length;
  return (
    <span className="flex items-center gap-1.5">
      <Marker tone={regress.length ? "ok" : "none"} title={regress.length ? `Прогоны регресса: ${regress.map(r => r.key).join(", ")}` : "У релиза нет прогона регресса"}>
        {regress.length ? <Check className="w-3 h-3" /> : <CircleDashed className="w-3 h-3" />} Регресс</Marker>
      <Marker tone={!st.length ? "none" : nf === st.length ? "ok" : nf ? "part" : "none"}
        title={st.length ? `Стори с прогоном НФ: ${nf} из ${st.length}` : "К релизу не привязаны стори"}>
        НФ {nf}/{st.length}</Marker>
      <Marker tone="none" title="Прогоны релиза: с релизом в отслеживании и добавленные в SimpleTest">Прогонов: {b.runs.length}</Marker>
    </span>
  );
}

/** Выбор прогона для релиза: сначала прогоны стори релиза, затем все — поиск и вид тестирования. */
function RunPicker({ project, board, onAdd, onClose }: {
  project: string; board: ReleaseBoard; onAdd: (key: string) => Promise<void>; onClose: () => void;
}) {
  const [runs, setRuns] = useState<ZRun[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => { getRuns(project).then(r => setRuns(r.runs)).catch(e => setErr((e as Error).message)); }, [project]);

  const inRelease = new Set(board.runs.map(r => r.key));
  const storyKeys = new Set(Object.values(board.storyRuns).flat().map(r => r.key));
  const types = useMemo(() => [...new Set((runs ?? []).map(r => r.type).filter(Boolean))].sort(), [runs]);
  const s = q.trim().toLowerCase();
  const match = (r: ZRun) => !inRelease.has(r.key) && (!typeF || r.type === typeF) && (!s || r.key.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
  const suggested = (runs ?? []).filter(r => storyKeys.has(r.key) && match(r));
  const rest = (runs ?? []).filter(r => !storyKeys.has(r.key) && match(r));

  const add = async (k: string) => { setBusy(k); setErr(""); try { await onAdd(k); } catch (e) { setErr((e as Error).message); } setBusy(""); };
  const row = (r: ZRun) => (
    <li key={r.key} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-bg-subtle/60">
      <span className="font-mono text-[11px] text-primary whitespace-nowrap">{r.key}</span>
      <RunTypeChip type={r.type} />
      <span className="min-w-0 flex-1 truncate text-sm text-text-main" title={r.name}>{r.name}</span>
      {r.issueKey && <span className="text-[11px] text-text-muted font-mono whitespace-nowrap" title="Задача в отслеживании прогона">{r.issueKey}</span>}
      <button type="button" onClick={() => add(r.key)} disabled={!!busy}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-main text-xs text-text-main hover:border-primary hover:text-primary disabled:opacity-40">
        {busy === r.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Добавить</button>
    </li>
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-bg-card shadow-sm">
      <div className="flex items-center gap-2 p-2 border-b border-border-main">
        <label className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border-main bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30">
          <Search className="w-3.5 h-3.5 text-text-muted" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Ключ или название прогона" aria-label="Найти прогон"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
        </label>
        <select value={typeF} onChange={e => setTypeF(e.target.value)} aria-label="Вид тестирования" className={`${INPUT} py-1`}>
          <option value="">Все виды</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" onClick={onClose} aria-label="Закрыть выбор прогона" className="p-1 rounded text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
      </div>
      {err && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{err}</p>}
      {!runs && !err && <p className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загружаю прогоны…</p>}
      {runs && (
        <div className="max-h-72 overflow-y-auto scrollbar-thin text-sm">
          {suggested.length > 0 && (
            <>
              <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Прогоны стори релиза</p>
              <ul>{suggested.map(row)}</ul>
            </>
          )}
          <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Все прогоны{rest.length > 50 ? " · первые 50 — уточните поиск" : ""}</p>
          {rest.length ? <ul>{rest.slice(0, 50).map(row)}</ul> : <p className="px-2.5 pb-2 text-xs text-text-muted">Ничего не найдено.</p>}
        </div>
      )}
      <p className="px-3 py-1.5 border-t border-border-main text-[11px] text-text-muted">
        Связь сохраняется в SimpleTest: API Zephyr не даёт менять отслеживание готового прогона. Прогоны, у которых релиз уже в отслеживании, появляются сами.
      </p>
    </div>
  );
}

function ReleaseRow({ project, baseUrl, relKey, st, open, onToggle, onReload, onRemove, onOpenRun }: {
  project: string; baseUrl: string; relKey: string; st: BoardState; open: boolean;
  onToggle: () => void; onReload: () => void; onRemove: () => Promise<void>; onOpenRun: (key: string) => void;
}) {
  const b = st.data;
  const [picker, setPicker] = useState(false);
  const [crit, setCrit] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [rowErr, setRowErr] = useState("");

  const addRun = async (k: string) => { await addReleaseRun(project, relKey, k); onReload(); };
  const dropRun = async (k: string) => {
    setRowErr("");
    try { await removeReleaseRun(project, relKey, k); onReload(); } catch (e) { setRowErr((e as Error).message); }
  };
  const runLink = (r: { key: string }) => (
    <button type="button" onClick={() => onOpenRun(r.key)} title="Открыть на вкладке «Прогоны»" className="font-mono text-[11px] text-primary hover:underline whitespace-nowrap">{r.key}</button>
  );
  const stories = b ? b.release.stories : [];

  return (
    <li className={`rounded-xl border bg-bg-card ${open ? "border-primary/40 shadow-sm" : "border-border-main"}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 flex items-center gap-3 text-left">
          <ChevronRight className={`w-4 h-4 flex-shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="font-mono text-sm text-primary whitespace-nowrap">{relKey}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-main">{b?.release.summary ?? (st.err ? "" : " ")}</span>
          {b?.release.status && <span className="text-xs text-text-muted whitespace-nowrap">{b.release.status}</span>}
        </button>
        {st.busy && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
        {b && <Markers b={b} />}
        {st.err && <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-xs" title={st.err}>Не загрузился: {st.err}</span>}
        <button type="button" onClick={onReload} disabled={st.busy} title="Обновить строку" aria-label={`Обновить ${relKey}`}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-40"><RefreshCw className="w-3.5 h-3.5" /></button>
        {!askRemove ? (
          <button type="button" onClick={() => setAskRemove(true)} title="Убрать строку из SimpleTest" aria-label={`Убрать ${relKey}`}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-bg-subtle"><Trash2 className="w-3.5 h-3.5" /></button>
        ) : (
          <span className="flex items-center gap-1 text-xs">
            Убрать из списка?
            <button type="button" onClick={onRemove} className="px-2 py-0.5 rounded bg-red-600 text-white">Да</button>
            <button type="button" onClick={() => setAskRemove(false)} className="px-2 py-0.5 rounded border border-border-main">Нет</button>
          </span>
        )}
      </div>

      {open && b && (
        <div className="border-t border-border-main p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <a href={b.release.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary">Открыть в Jira <ExternalLink className="w-3 h-3" /></a>
            <span>КЭ: {b.release.ke.map(k => k.label).join(", ") || "не указаны"}</span>
          </div>
          {rowErr && <p className="text-xs text-red-600 dark:text-red-400">{rowErr}</p>}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <section className="rounded-lg border border-border-main">
              <h3 className="px-3 py-2 border-b border-border-main text-xs font-semibold text-text-main">Задачи релиза · {stories.length}</h3>
              {stories.length === 0 ? <p className="px-3 py-3 text-xs text-text-muted">К задаче релиза не привязаны задачи (связи Jira).</p> : (
                <ul className="divide-y divide-border-main">
                  {stories.map(s => {
                    const runs = b.storyRuns[s.key] ?? [];
                    const nf = runs.filter(r => runKind(r.type) === "nf");
                    return (
                      <li key={s.key} className="flex items-start gap-2 px-3 py-2">
                        <span className="mt-0.5" title={nf.length ? "Есть прогон НФ" : "Нет прогона НФ"}>
                          {nf.length ? <Check className="w-4 h-4 text-green-600" /> : <CircleDashed className="w-4 h-4 text-text-muted" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 min-w-0">
                            <a href={`${baseUrl}/browse/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-primary hover:underline whitespace-nowrap">{s.key}</a>
                            <span className="truncate text-sm text-text-main" title={s.summary}>{s.summary}</span>
                          </p>
                          <p className="text-[11px] text-text-muted">{[s.issuetype, s.status].filter(Boolean).join(" · ")}</p>
                        </div>
                        <span className="flex flex-wrap justify-end gap-1 max-w-[45%]">
                          {runs.length === 0 && <span className="text-[11px] text-text-muted whitespace-nowrap">нет прогона</span>}
                          {runs.map(r => <span key={r.key} className="flex items-center gap-1">{runLink(r)}<RunTypeChip type={r.type} /></span>)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-border-main">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-main">
                <h3 className="text-xs font-semibold text-text-main">Прогоны релиза · {b.runs.length}</h3>
                <button type="button" onClick={() => setPicker(p => !p)} aria-expanded={picker}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90">
                  <Plus className="w-3.5 h-3.5" /> Добавить прогон</button>
              </div>
              {picker && <div className="p-2"><RunPicker project={project} board={b} onAdd={addRun} onClose={() => setPicker(false)} /></div>}
              {b.runs.length === 0 ? <p className="px-3 py-3 text-xs text-text-muted">Прогонов нет. Добавьте готовый (например, НФ стори) или соберите крит регресс ниже.</p> : (
                <ul className="divide-y divide-border-main">
                  {b.runs.map((r: BoardRun) => (
                    <li key={r.key} className="px-3 py-2">
                      <p className="flex items-center gap-2 min-w-0">
                        {runLink(r)}<RunTypeChip type={r.type} />
                        <span className="min-w-0 flex-1 truncate text-sm text-text-main" title={r.name}>{r.missing ? "нет в списке прогонов — обновите прогоны" : r.name}</span>
                        {r.source === "issue"
                          ? <span className="text-[10px] text-text-muted whitespace-nowrap" title="Релиз в отслеживании прогона (Jira)">в отслеживании</span>
                          : <>
                              <span className="text-[10px] text-text-muted whitespace-nowrap" title="Связь хранится в SimpleTest">добавлен в SimpleTest</span>
                              <button type="button" onClick={() => dropRun(r.key)} aria-label={`Убрать ${r.key} из релиза`} title="Убрать из релиза"
                                className="p-0.5 rounded text-text-muted hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                            </>}
                      </p>
                      {!r.missing && <div className="mt-1"><ResultBar counts={r.counts} total={r.total} /></div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-border-main">
            <button type="button" onClick={() => setCrit(c => !c)} aria-expanded={crit}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-text-main hover:bg-bg-subtle/60">
              <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition-transform ${crit ? "rotate-90" : ""}`} />
              <ShieldCheck className="w-4 h-4 text-primary" /> Крит регресс: собрать прогон по КЭ релиза
            </button>
            {crit && <div className="border-t border-border-main p-3"><CritRegressView project={project} baseUrl={baseUrl} releaseKey={relKey} onRunCreated={onReload} /></div>}
          </section>
        </div>
      )}
      {open && !b && !st.err && <p className="flex items-center gap-2 border-t border-border-main px-4 py-3 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю релиз…</p>}
    </li>
  );
}

/**
 * Релизы строками: у каждой — маркеры (есть прогон регресса, сколько стори с прогоном НФ, сколько прогонов),
 * в раскрытой — задачи релиза (связи Jira) с индикатором прогона НФ, прогоны релиза с добавлением из списка
 * и сборка крит регресса по КЭ релиза. Список релизов общий — хранится в SimpleTest.
 */
export default function ReleasesView({ project, baseUrl, onOpenRun }: { project: string; baseUrl: string; onOpenRun: (key: string) => void }) {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [boards, setBoards] = useState<Record<string, BoardState>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");

  const loadBoard = useCallback(async (k: string) => {
    setBoards(b => ({ ...b, [k]: { ...b[k], busy: true, err: undefined } }));
    try {
      const data = await getReleaseBoard(project, k);
      setBoards(b => ({ ...b, [k]: { data } }));
    } catch (e) {
      setBoards(b => ({ ...b, [k]: { ...b[k], busy: false, err: (e as Error).message } }));
    }
  }, [project]);

  useEffect(() => {
    let live = true;
    getReleases(project).then(async r => {
      if (!live) return;
      setKeys(r.releases);
      // Строки грузятся по две за раз — первая загрузка прогонов на сервере одна на всех.
      for (let i = 0; i < r.releases.length && live; i += 2) await Promise.all(r.releases.slice(i, i + 2).map(loadBoard));
    }).catch(e => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [project, loadBoard]);

  const add = async () => {
    const k = draft.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(k)) { setAddErr("Номер релиза — в формате SBER911-12345"); return; }
    setAdding(true); setAddErr("");
    try {
      const r = await addRelease(project, k);
      setKeys(r.releases); setDraft(""); setOpen(o => new Set(o).add(k));
      void loadBoard(k);
    } catch (e) { setAddErr((e as Error).message); }
    setAdding(false);
  };
  const remove = async (k: string) => {
    try { setKeys((await removeRelease(project, k)).releases); } catch (e) { setErr((e as Error).message); }
  };
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
            placeholder="SBER911-12345" aria-label="Номер задачи релиза" className={`${INPUT} w-48 font-mono`} />
          <button type="button" onClick={add} disabled={adding || !draft.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Добавить релиз</button>
          <span className="text-xs text-text-muted">Маркеры: прогон регресса · стори с прогоном НФ · всего прогонов.</span>
        </div>
        {addErr && <p className="text-sm text-red-600 dark:text-red-400">{addErr}</p>}
        {err && <p className="text-sm text-red-600 dark:text-red-400">Релизы не загрузились: {err}</p>}
        {!keys && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
        {keys && keys.length === 0 && (
          <p className="rounded-xl border border-dashed border-border-main px-4 py-8 text-center text-sm text-text-muted">
            Добавьте релиз по номеру задачи — строка покажет его стори, прогоны и маркеры готовности.
          </p>
        )}
        <ul className="space-y-2">
          {(keys ?? []).map(k => (
            <ReleaseRow key={k} project={project} baseUrl={baseUrl} relKey={k} st={boards[k] ?? { busy: true }} open={open.has(k)}
              onToggle={() => toggle(k)} onReload={() => loadBoard(k)} onRemove={() => remove(k)} onOpenRun={onOpenRun} />
          ))}
        </ul>
      </div>
    </div>
  );
}
