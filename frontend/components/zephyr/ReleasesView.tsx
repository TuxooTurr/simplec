"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleDashed, Copy, ExternalLink, ListChecks, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import {
  addRelease, addReleaseRuns, getReleaseBoard, getReleases, getRuns, removeRelease, removeReleaseRun, runKind,
  type ReleaseBoard, type ZLinked, type ZRun,
} from "@/lib/zephyrApi";
import CritRegressView from "./CritRegressView";

const INPUT = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

type BoardState = { data?: ReleaseBoard; err?: string; busy?: boolean };

/* ── Что «светится» в строке релиза ───────────────────────────────────────── */

/** Стори релиза — связанные задачи с типом «История» / Story (дефекты, эпики и прочее в расчёт не идут). */
const isStory = (i: ZLinked) => /истори|стори|story/i.test(i.issuetype);
const storiesOf = (b: ReleaseBoard) => b.release.stories.filter(isStory);
/** Прогоны НФ стори: стори в отслеживании прогона, «Вид тестирования» = Новый функционал. */
const nfRunsOf = (b: ReleaseBoard, key: string) => (b.storyRuns[key] ?? []).filter(r => runKind(r.type) === "nf");
const regressRuns = (b: ReleaseBoard) => b.runs.filter(r => runKind(r.type) === "regress");
/** Прогоны НФ самого релиза (релиз в отслеживании в Zephyr или добавлены к релизу в SimpleTest). */
const releaseNf = (b: ReleaseBoard) => b.runs.filter(r => runKind(r.type) === "nf");
/** Стори: in — её прогон НФ есть и в релизе; out — прогон НФ есть, но к релизу не добавлен; none — прогона НФ нет. */
function storyState(b: ReleaseBoard, key: string): "in" | "out" | "none" {
  const runs = nfRunsOf(b, key);
  if (!runs.length) return "none";
  const rel = new Set(releaseNf(b).map(r => r.key));
  return runs.some(r => rel.has(r.key)) ? "in" : "out";
}
const storiesWithoutNf = (b: ReleaseBoard) => storiesOf(b).filter(s => storyState(b, s.key) === "none");
/** НФ-прогоны стори, которые ещё не добавлены к релизу. */
function storyNfNotInRelease(b: ReleaseBoard): { run: ZRun; story: string }[] {
  const rel = new Set(b.runs.map(r => r.key));
  const out: { run: ZRun; story: string }[] = [];
  const seen = new Set<string>();
  for (const s of storiesOf(b)) for (const r of nfRunsOf(b, s.key)) if (!rel.has(r.key) && !seen.has(r.key)) { seen.add(r.key); out.push({ run: r, story: s.key }); }
  return out;
}
/** НФ релиза: стори есть, у каждой — прогон НФ, и он же добавлен к релизу. */
const nfDone = (b: ReleaseBoard) => storiesOf(b).length > 0 && storiesOf(b).every(s => storyState(b, s.key) === "in");

/** Маркер: зелёный — есть, янтарный — частично, тусклый — нет. */
function Marker({ on, part, children, title }: { on: boolean; part?: boolean; children: React.ReactNode; title: string }) {
  const cls = on ? "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/40"
    : part ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40"
    : "bg-bg-subtle text-text-muted border-border-main opacity-70";
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${cls}`}>
      {on ? <Check className="w-3 h-3" /> : <CircleDashed className="w-3 h-3" />}{children}
    </span>
  );
}

/** Строка прогона в окне НФ: ключ (переход к прогону), название, статус и действие справа. */
function RunLine({ run, note, onOpenRun, action }: { run: ZRun; note?: string; onOpenRun: (key: string) => void; action?: React.ReactNode }) {
  return (
    <tr className="border-t border-border-main">
      <td className="px-3 py-1.5">
        <button type="button" onClick={() => onOpenRun(run.key)} title="Открыть на вкладке «Прогоны»"
          className="font-mono text-xs text-primary hover:underline whitespace-nowrap">{run.key}</button></td>
      <td className="px-3 py-1.5 text-text-main">{run.name || "—"}</td>
      <td className="px-3 py-1.5 text-text-main whitespace-nowrap">{run.status || "—"}</td>
      <td className="px-3 py-1.5 text-[11px] text-text-muted whitespace-nowrap">{note}</td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">{action}</td>
    </tr>
  );
}

const TABLE_HEAD = (
  <thead className="bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
    <tr><th className="text-left px-3 py-2 w-32">Прогон</th><th className="text-left px-3 py-2">Название</th>
      <th className="text-left px-3 py-2 w-28">Статус</th><th className="text-left px-3 py-2 w-36" /><th className="w-24" /></tr>
  </thead>
);

/**
 * Окно маркера НФ: прогоны «Новый функционал» релиза (имя и статус), НФ-прогоны стори, ещё не добавленные к релизу,
 * и любой другой прогон из списка. У релиза прогонов сколько угодно, у прогона релизов — тоже.
 */
function NfRunsModal({ project, board, onOpenRun, onChanged, onClose }: {
  project: string; board: ReleaseBoard; onOpenRun: (key: string) => void; onChanged: () => void; onClose: () => void;
}) {
  const relKey = board.release.key;
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [all, setAll] = useState<ZRun[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("nf");
  useEffect(() => { if (picking && !all) getRuns(project).then(r => setAll(r.runs)).catch(e => setErr((e as Error).message)); }, [picking, all, project]);

  const relNf = releaseNf(board);
  const pending = storyNfNotInRelease(board);
  const inRelease = new Set(board.runs.map(r => r.key));
  const total = storiesOf(board).length;
  const done = storiesOf(board).filter(s => storyState(board, s.key) === "in").length;
  const types = useMemo(() => [...new Set((all ?? []).map(r => r.type).filter(Boolean))].sort(), [all]);
  const s = q.trim().toLowerCase();
  const found = (all ?? []).filter(r => !inRelease.has(r.key) && (typeF === "" || (typeF === "nf" ? runKind(r.type) === "nf" : r.type === typeF))
    && (!s || r.key.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)));

  const act = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id); setErr("");
    try { await f(); onChanged(); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const add = (keys: string[], id: string) => act(id, () => addReleaseRuns(project, relKey, keys));
  const addBtn = (k: string) => (
    <button type="button" onClick={() => add([k], k)} disabled={!!busy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-main text-xs text-text-main hover:border-primary hover:text-primary disabled:opacity-40">
      {busy === k ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} В релиз</button>
  );

  return (
    <Modal open onClose={onClose} title={`Прогоны НФ · ${relKey}`} size="max-w-4xl">
      <div className="space-y-4 text-sm">
        <p className="text-text-muted">Стори, чей прогон НФ есть в релизе: <b className="text-text-main">{done} из {total}</b>.</p>
        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold text-text-main">В релизе · {relNf.length}</h3>
          {relNf.length === 0 ? <p className="text-text-muted text-xs">У релиза нет прогонов «Новый функционал».</p> : (
            <table className="w-full border border-border-main rounded-xl overflow-hidden">{TABLE_HEAD}<tbody>
              {relNf.map(r => (
                <RunLine key={r.key} run={r} onOpenRun={k => { onClose(); onOpenRun(k); }}
                  note={r.missing ? "нет в списке прогонов — обновите прогоны" : r.source === "zephyr" ? "в отслеживании Zephyr" : "добавлен в SimpleTest"}
                  action={r.source === "simpletest" && (
                    <button type="button" onClick={() => act(`rm:${r.key}`, () => removeReleaseRun(project, relKey, r.key))} disabled={!!busy}
                      title="Убрать из релиза" aria-label={`Убрать ${r.key} из релиза`} className="p-1 rounded text-text-muted hover:text-red-500 disabled:opacity-40">
                      {busy === `rm:${r.key}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}</button>
                  )} />
              ))}
            </tbody></table>
          )}
        </section>

        {pending.length > 0 && (
          <section className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-text-main">НФ стори, ещё не в релизе · {pending.length}</h3>
              <button type="button" onClick={() => add(pending.map(p => p.run.key), "all")} disabled={!!busy}
                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold disabled:opacity-40">
                {busy === "all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Добавить все в релиз</button>
            </div>
            <table className="w-full border border-border-main rounded-xl overflow-hidden">{TABLE_HEAD}<tbody>
              {pending.map(p => <RunLine key={p.run.key} run={p.run} note={`стори ${p.story}`} onOpenRun={k => { onClose(); onOpenRun(k); }} action={addBtn(p.run.key)} />)}
            </tbody></table>
          </section>
        )}

        <section className="space-y-1.5">
          {!picking ? (
            <button type="button" onClick={() => setPicking(true)} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
              <Plus className="w-3.5 h-3.5" /> Добавить другой прогон из списка</button>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <label className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border-main bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30">
                  <Search className="w-3.5 h-3.5 text-text-muted" />
                  <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Ключ или название прогона" aria-label="Найти прогон"
                    className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
                </label>
                <select value={typeF} onChange={e => setTypeF(e.target.value)} aria-label="Вид тестирования" className={`${INPUT} py-1`}>
                  <option value="nf">Новый функционал</option>
                  <option value="">Все виды</option>
                  {types.filter(t => runKind(t) !== "nf").map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {!all && !err && <p className="flex items-center gap-2 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загружаю прогоны…</p>}
              {all && (found.length === 0 ? <p className="text-xs text-text-muted">Ничего не найдено.</p> : (
                <div className="max-h-64 overflow-y-auto scrollbar-thin">
                  <table className="w-full border border-border-main rounded-xl overflow-hidden">{TABLE_HEAD}<tbody>
                    {found.slice(0, 50).map(r => <RunLine key={r.key} run={r} note={r.issueKey ? `отслеживание: ${r.issueKey}` : ""} onOpenRun={k => { onClose(); onOpenRun(k); }} action={addBtn(r.key)} />)}
                  </tbody></table>
                  {found.length > 50 && <p className="mt-1 text-[11px] text-text-muted">Показаны первые 50 — уточните поиск.</p>}
                </div>
              ))}
            </>
          )}
        </section>
        <p className="text-[11px] text-text-muted border-t border-border-main pt-2">
          Прогоны, у которых релиз в отслеживании Zephyr, видны сами. Добавленные здесь связи хранятся в SimpleTest:
          публичный API Zephyr не даёт менять отслеживание готового прогона.
        </p>
      </div>
    </Modal>
  );
}

/** JQL по стори без прогона НФ — чтобы руками добавить связь в Jira. */
function MissingNfJql({ board, baseUrl }: { board: ReleaseBoard; baseUrl: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const missing = storiesWithoutNf(board);
  if (!storiesOf(board).length) return null;
  if (!missing.length) return <p className="px-4 py-2 text-xs text-green-700 dark:text-green-400">У всех стори релиза есть прогон НФ.</p>;
  const jql = `issuekey in (${missing.map(s => s.key).join(", ")}) ORDER BY key`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(jql); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* выделите и скопируйте вручную */ }
  };
  return (
    <div className="px-4 py-2 space-y-2">
      <button type="button" onClick={() => setShown(v => !v)} aria-expanded={shown}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
        <ListChecks className="w-4 h-4" /> Собрать список · без НФ: {missing.length}</button>
      {shown && (
        <div className="rounded-lg border border-border-main bg-bg-subtle p-2 space-y-1.5">
          <p className="text-[11px] text-text-muted">JQL стори без прогона НФ — откройте в Jira и привяжите прогоны:</p>
          <code className="block select-all break-all font-mono text-xs text-text-main">{jql}</code>
          <div className="flex items-center gap-2">
            <button type="button" onClick={copy} className="flex items-center gap-1 px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-card">
              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Скопировано" : "Скопировать"}</button>
            {baseUrl && (
              <a href={`${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-card">
                <ExternalLink className="w-3.5 h-3.5" /> Открыть в Jira</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReleaseRow({ project, baseUrl, relKey, st, open, onToggle, onReload, onRemove, onOpenRun }: {
  project: string; baseUrl: string; relKey: string; st: BoardState; open: boolean;
  onToggle: () => void; onReload: () => void; onRemove: () => Promise<void>; onOpenRun: (key: string) => void;
}) {
  const b = st.data;
  const [regressOpen, setRegressOpen] = useState(false);
  const [nfOpen, setNfOpen] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }[]>([]);

  const regress = b ? regressRuns(b) : [];
  const nf = b ? nfDone(b) : false;
  const stories = b ? storiesOf(b) : [];
  const withNf = b ? stories.filter(s => storyState(b, s.key) === "in").length : 0;
  const pending = b ? storyNfNotInRelease(b) : [];
  const [adding, setAdding] = useState(false);
  const addPending = async () => {
    if (!b) return;
    setAdding(true);
    try { await addReleaseRuns(project, relKey, pending.map(p => p.run.key)); onReload(); }
    catch (e) { setNote([{ ok: false, text: `Прогоны не добавились: ${(e as Error).message}` }]); }
    setAdding(false);
  };
  const covered = regress.length > 0 && nf;

  return (
    <li className={`rounded-xl border bg-bg-card ${open ? "border-primary/40 shadow-sm" : "border-border-main"}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} title={open ? "Скрыть стори" : "Показать стори релиза"}
          className="min-w-0 flex-1 flex items-center gap-3 text-left">
          <ChevronRight className={`w-4 h-4 flex-shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="font-mono text-sm text-primary whitespace-nowrap">{relKey}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-main">{b?.release.summary ?? ""}</span>
          {b?.release.status && <span className="text-xs text-text-muted whitespace-nowrap">{b.release.status}</span>}
        </button>
        {st.busy && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
        {st.err && <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-xs" title={st.err}>Не загрузился: {st.err}</span>}
        {b && (
          <>
            <Marker on={regress.length > 0} title={regress.length ? `Прогон регресса: ${regress.map(r => r.key).join(", ")}` : "Прогона регресса с релизом в отслеживании нет"}>Регресс</Marker>
            <button type="button" onClick={() => setNfOpen(true)} aria-label="Прогоны НФ релиза" className="rounded-full hover:ring-2 hover:ring-primary/30">
              <Marker on={nf} part={!nf && withNf > 0}
                title={stories.length ? `Стори, чей прогон НФ есть в релизе: ${withNf} из ${stories.length} — нажмите: прогоны НФ релиза` : "К релизу не привязаны стори — нажмите: прогоны НФ релиза"}>
                НФ{!nf && stories.length > 0 && <span className="font-normal"> {withNf}/{stories.length}</span>}</Marker>
            </button>
            <button type="button" onClick={() => setRegressOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap">
              <ShieldCheck className="w-3.5 h-3.5" /> Собрать регресс</button>
            <span title={covered ? "Есть прогон регресса и у всех стори — прогон НФ" : "Нужны прогон регресса и прогоны НФ у всех стори"}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap
                ${covered ? "bg-green-600 text-white" : "border border-dashed border-border-main text-text-muted"}`}>
              {covered ? <Check className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />} Регресс покрыт</span>
          </>
        )}
        <button type="button" onClick={onReload} disabled={st.busy} title="Обновить строку" aria-label={`Обновить ${relKey}`}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-40"><RefreshCw className="w-3.5 h-3.5" /></button>
        {!askRemove ? (
          <button type="button" onClick={() => setAskRemove(true)} title="Убрать строку из SimpleTest (в Jira ничего не меняется)" aria-label={`Убрать ${relKey}`}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-bg-subtle"><Trash2 className="w-3.5 h-3.5" /></button>
        ) : (
          <span className="flex items-center gap-1 text-xs">
            Убрать из списка?
            <button type="button" onClick={onRemove} className="px-2 py-0.5 rounded bg-red-600 text-white">Да</button>
            <button type="button" onClick={() => setAskRemove(false)} className="px-2 py-0.5 rounded border border-border-main">Нет</button>
          </span>
        )}
      </div>

      {note.length > 0 && (
        <div className="px-4 pb-2 space-y-1">
          {note.map(n => (
            <p key={n.text} className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm ${n.ok ? "bg-green-600/10 text-green-800 dark:text-green-300" : "border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"}`}>
              <span className="min-w-0 flex-1">{n.text}</span>
              <button type="button" onClick={() => setNote(x => x.filter(y => y !== n))} aria-label="Скрыть"><X className="w-3.5 h-3.5" /></button>
            </p>
          ))}
        </div>
      )}

      {open && b && (
        <div className="border-t border-border-main">
          {stories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-muted">К задаче релиза не привязаны стори (связи Jira с типом «История»).</p>
          ) : (
            <ul className="divide-y divide-border-main">
              {stories.map(s => {
                const runs = nfRunsOf(b, s.key);
                const stt = storyState(b, s.key);
                const list = runs.map(r => `${r.key} — ${r.name}`).join("; ");
                return (
                  <li key={s.key} className="flex items-center gap-3 px-4 py-2">
                    <Marker on={stt === "in"} part={stt === "out"}
                      title={stt === "in" ? `Прогон НФ в релизе: ${list}` : stt === "out" ? `Прогон НФ есть, но не добавлен к релизу: ${list}` : "Прогона НФ у стори нет"}>
                      НФ{stt === "out" && <span className="font-normal"> · не в релизе</span>}</Marker>
                    <a href={`${baseUrl}/browse/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline whitespace-nowrap">{s.key}</a>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-main" title={s.summary}>{s.summary}</span>
                    <span className="text-xs text-text-muted whitespace-nowrap">{s.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {pending.length > 0 && (
            <div className="border-t border-border-main px-4 py-2 flex items-center gap-2">
              <span className="text-xs text-text-muted">Прогоны НФ стори, ещё не добавленные к релизу: {pending.length}</span>
              <button type="button" onClick={addPending} disabled={adding}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold disabled:opacity-40">
                {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Добавить в релиз</button>
            </div>
          )}
          <div className="border-t border-border-main"><MissingNfJql board={b} baseUrl={baseUrl} /></div>
        </div>
      )}
      {open && !b && !st.err && <p className="flex items-center gap-2 border-t border-border-main px-4 py-3 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю релиз…</p>}

      {regressOpen && (
        <Modal open onClose={() => setRegressOpen(false)} title={`Собрать регресс · ${relKey}`} size="max-w-5xl">
          <CritRegressView project={project} baseUrl={baseUrl} releaseKey={relKey} modal
            onRunCreated={(key, warnings) => {
              setRegressOpen(false);
              setNote([{ ok: true, text: `Прогон ${key} создан, в отслеживании — ${relKey}.` }, ...warnings.map(w => ({ ok: false, text: w }))]);
              onReload();
            }} />
        </Modal>
      )}
      {nfOpen && b && <NfRunsModal project={project} board={b} onOpenRun={onOpenRun} onChanged={onReload} onClose={() => setNfOpen(false)} />}
    </li>
  );
}

/**
 * Релизы строками: «Регресс» — есть прогон регресса с релизом в отслеживании; «НФ» — у каждой стори релиза есть
 * прогон «Новый функционал», и он же — в релизе (клик — прогоны НФ релиза и их добавление); «Регресс покрыт» — оба. «Собрать регресс» —
 * окно: КЭ релиза → кейсы по полю «АС» → прогон в Zephyr с релизом в отслеживании. Раскрытая строка — стори
 * с маркером НФ и «Собрать список» — JQL стори без НФ. Список релизов общий — хранится в SimpleTest.
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
      setKeys(r.releases); setDraft("");
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
        </div>
        {addErr && <p className="text-sm text-red-600 dark:text-red-400">{addErr}</p>}
        {err && <p className="text-sm text-red-600 dark:text-red-400">Релизы не загрузились: {err}</p>}
        {!keys && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
        {keys && keys.length === 0 && (
          <p className="rounded-xl border border-dashed border-border-main px-4 py-8 text-center text-sm text-text-muted">
            Добавьте релиз по номеру задачи — появится строка с маркерами «Регресс» и «НФ» и кнопкой «Собрать регресс».
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
