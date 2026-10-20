"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDashed, Copy, ExternalLink, ListChecks, Loader2, Plus, RefreshCw, ShieldCheck, Tags, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { addRelease, analyzeCoverage, editNfRuns, getReleaseBoard, getReleases, removeRelease, runKind, setCoverageLink, type ReleaseBoard, type ZLinked } from "@/lib/zephyrApi";
import RunCard, { RunTypeChip } from "./RunCard";
import CritRegressView from "./CritRegressView";
import KeAlignModal from "./KeAlignModal";

const INPUT = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

type BoardState = { data?: ReleaseBoard; err?: string; busy?: boolean };

/* ── Что «светится» в строке релиза ───────────────────────────────────────── */

/** Стори релиза — связанные задачи с типом «История» / Story (дефекты, эпики и прочее в расчёт не идут). */
const isStory = (i: ZLinked) => /истори|стори|story/i.test(i.issuetype);
const storiesOf = (b: ReleaseBoard) => b.release.stories.filter(isStory);
/** Прогоны релиза, в отслеживании которых есть стори (стори и релиз — в одном прогоне). */
/** Прогоны стори: после анализа покрытия — по нему (расчёт SimpleTest с ручной правкой), до — по issueKey прогонов. */
const storyRunsOf = (b: ReleaseBoard, key: string) => {
  if (!b.coverage) return b.storyRuns[key] ?? [];
  const keys = new Set((b.coverage.stories[key] ?? []).map(x => x.run));
  return b.nfRuns.filter(r => keys.has(r.key));
};
const regressRuns = (b: ReleaseBoard) => b.runs.filter(r => runKind(r.type) === "regress");
/** НФ-прогоны релиза — сохранённый список SimpleTest (сверка по issueKey + добавленные руками). */
const nfRuns = (b: ReleaseBoard) => b.nfRuns ?? b.runs.filter(r => runKind(r.type) === "nf");
const storiesWithoutRun = (b: ReleaseBoard) => storiesOf(b).filter(s => !storyRunsOf(b, s.key).length);
/** НФ релиза: стори есть, и каждая — в отслеживании прогона релиза. */
const nfDone = (b: ReleaseBoard) => storiesOf(b).length > 0 && storiesWithoutRun(b).length === 0;

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

/**
 * Окно маркера НФ: сохранённый список НФ-прогонов релиза — карточки (прогресс, «Пройти» = Pass в Jira).
 * API показывает у прогона одну задачу отслеживания, поэтому прогон, где релиз не основная задача, сверка не найдёт —
 * его добавляют по номеру; лишний — убирают (сверка его больше не вернёт).
 */
function NfRunsModal({ board, project, onOpenRun, onChanged, onClose }: {
  board: ReleaseBoard; project: string; onOpenRun: (key: string) => void; onChanged: () => void; onClose: () => void;
}) {
  const runs = nfRuns(board);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const edit = async (e: { add?: string; remove?: string }) => {
    setBusy(true); setErr("");
    try { await editNfRuns(board.release.key, project, e); setDraft(""); onChanged(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={`Прогоны НФ · ${board.release.key}`} size="max-w-3xl">
      <div className="space-y-3 text-sm">
        <p className="text-text-muted">
          НФ-прогонов релиза: <b className="text-text-main">{runs.length}</b>. Список хранится в SimpleTest: сверка добавляет прогоны,
          где релиз — основная задача отслеживания; остальные добавьте по номеру.
        </p>
        <div className="flex items-center gap-2">
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && draft.trim() && edit({ add: draft })}
            placeholder="Номер прогона: SBER911-C710" aria-label="Добавить прогон в НФ релиза" className={`${INPUT} w-56 font-mono`} />
          <button type="button" onClick={() => edit({ add: draft })} disabled={busy || !draft.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Добавить</button>
          {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
        </div>
        {runs.length === 0 ? <p className="text-text-muted">Пока нет НФ-прогонов. Добавьте номер прогона выше или поставьте релиз в отслеживание прогона в Zephyr и обновите строку.</p> : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {runs.map(r => (
              <li key={r.key} className="relative group/nf">
                <RunCard run={r} onOpen={() => { onClose(); onOpenRun(r.key); }} onPassed={onChanged} />
                <button type="button" onClick={() => edit({ remove: r.key })} disabled={busy} aria-label={`Убрать ${r.key} из НФ релиза`}
                  title="Убрать из списка НФ релиза (в Zephyr ничего не меняется)"
                  className="absolute top-1.5 right-1.5 p-1 rounded-md text-text-muted opacity-0 group-hover/nf:opacity-100 focus-visible:opacity-100 hover:text-red-500 hover:bg-bg-subtle">
                  <X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 * Покрытие стори релиза НФ-прогонами — расчёт SimpleTest: авто (номер стори в названии прогона или его issueKey)
 * и ручная правка галочками. В Jira ничего не пишется; результат хранится и красит строки стори.
 */
function CoverageModal({ board, project, onChanged, onClose }: {
  board: ReleaseBoard; project: string; onChanged: () => void; onClose: () => void;
}) {
  const [cov, setCov] = useState(board.coverage ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const runs = nfRuns(board);
  const stories = storiesOf(board);
  const run = async (fn: () => Promise<typeof cov>) => {
    setBusy(true); setErr("");
    try { setCov(await fn()); onChanged(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const toggle = (story: string, r: string) => {
    const link = cov?.stories[story]?.find(x => x.run === r);
    const auto = link ? link.auto : false;
    const next = !link;
    // Совпало с авто — снимаем ручную правку, иначе запоминаем руками.
    void run(() => setCoverageLink(board.release.key, project, story, r, next === auto ? null : next));
  };
  return (
    <Modal open onClose={onClose} title={`Покрытие стори · ${board.release.key}`} size="max-w-4xl">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => run(() => analyzeCoverage(board.release.key, project))} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {cov ? "Пересчитать" : "Проанализировать"}</button>
          {cov && <span className="text-text-main">Покрыто стори: <b>{cov.covered} из {cov.total}</b> <span className="text-xs text-text-muted">· {cov.analyzedAt}</span></span>}
          {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
        </div>
        <p className="text-xs text-text-muted">
          Авто — номер стори в названии прогона или в его основной задаче отслеживания. Галочкой можно поправить связь руками
          (рамка — правка руками). В Jira ничего не меняется.
        </p>
        {!cov ? <p className="text-text-muted">Нажмите «Проанализировать» — стори релиза сопоставятся с его НФ-прогонами ({runs.length}).</p>
          : runs.length === 0 ? <p className="text-text-muted">У релиза нет НФ-прогонов — добавьте их в окне маркера «НФ».</p> : (
          <ul className="border border-border-main rounded-xl divide-y divide-border-main max-h-[60vh] overflow-y-auto scrollbar-thin">
            {stories.map(st => {
              const links = cov.stories[st.key] ?? [];
              return (
                <li key={st.key} className="px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Marker on={links.length > 0} title={links.length ? "Стори покрыта" : "Ни одного прогона"}>{links.length ? "есть" : "нет"}</Marker>
                    <span className="font-mono text-xs text-primary">{st.key}</span>
                    <span className="min-w-0 flex-1 truncate text-text-main" title={st.summary}>{st.summary}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {runs.map(r => {
                      const link = links.find(x => x.run === r.key);
                      return (
                        <button key={r.key} type="button" disabled={busy} onClick={() => toggle(st.key, r.key)} aria-pressed={!!link}
                          title={`${r.key} — ${r.name}${link ? (link.manual !== undefined ? " · связь руками" : " · авто") : ""}`}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono border
                            ${link ? "bg-primary/10 text-primary border-primary/50" : "text-text-muted border-border-main hover:text-text-main"}
                            ${link?.manual !== undefined ? "ring-1 ring-amber-400" : ""}`}>
                          {link ? <Check className="w-3 h-3" /> : <CircleDashed className="w-3 h-3" />}{r.key}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** JQL по стори, которых нет в прогонах релиза, — чтобы руками добавить их в отслеживание прогона. */
function MissingNfJql({ board, baseUrl }: { board: ReleaseBoard; baseUrl: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const missing = storiesWithoutRun(board);
  if (!storiesOf(board).length) return null;
  if (!missing.length) return <p className="px-4 py-2 text-xs text-green-700 dark:text-green-400">Все стори релиза есть в прогонах релиза.</p>;
  const jql = `issuekey in (${missing.map(s => s.key).join(", ")}) ORDER BY key`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(jql); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* выделите и скопируйте вручную */ }
  };
  return (
    <div className="px-4 py-2 space-y-2">
      <button type="button" onClick={() => setShown(v => !v)} aria-expanded={shown}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
        <ListChecks className="w-4 h-4" /> Собрать список · без прогона: {missing.length}</button>
      {shown && (
        <div className="rounded-lg border border-border-main bg-bg-subtle p-2 space-y-1.5">
          <p className="text-[11px] text-text-muted">JQL стори без прогона — добавьте их в отслеживание прогонов релиза в Zephyr:</p>
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
  const [keOpen, setKeOpen] = useState(false);
  const [covOpen, setCovOpen] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }[]>([]);

  const regress = b ? regressRuns(b) : [];
  const nf = b ? nfDone(b) : false;
  const stories = b ? storiesOf(b) : [];
  const withRun = b ? stories.length - storiesWithoutRun(b).length : 0;
  const nfCount = b ? nfRuns(b).length : 0;
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
              {/* Счётчик — НФ-прогоны релиза (вид «Новый функционал», релиз в отслеживании); цвет — покрыты ли стори. */}
              <Marker on={nf} part={!nf && withRun > 0}
                title={`НФ-прогонов релиза: ${nfCount} (видны прогоны, где релиз — основная задача отслеживания). `
                  + (stories.length ? `Стори в прогонах: ${withRun} из ${stories.length}.` : "К релизу не привязаны стори.") + " Нажмите — прогоны НФ релиза"}>
                НФ <span className="font-normal tabular-nums">{nfCount}</span></Marker>
            </button>
            <button type="button" onClick={() => setRegressOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap">
              <ShieldCheck className="w-3.5 h-3.5" /> Собрать регресс</button>
            <span title={covered ? "Есть прогон регресса, и все стори — в прогонах релиза" : "Нужны прогон регресса и все стори в прогонах релиза"}
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
          {b.traceSource === "issueKey" && !b.coverage && (
            <p className="flex items-start gap-2 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Стенд отдаёт у прогона только одну задачу отслеживания, поэтому стори ниже — по ней. Точнее: «Проанализировать
                покрытие» — SimpleTest сопоставит стори с НФ-прогонами релиза сам (по номеру стори), связи можно поправить руками.</span>
            </p>
          )}
          {stories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-muted">К задаче релиза не привязаны стори (связи Jira с типом «История»).</p>
          ) : (
            <ul className="divide-y divide-border-main">
              {stories.map(s => {
                const runs = storyRunsOf(b, s.key);
                return (
                  <li key={s.key} className="flex items-center gap-3 px-4 py-2">
                    <Marker on={runs.length > 0} title={runs.length ? `Стори в отслеживании прогонов релиза: ${runs.map(r => `${r.key} — ${r.name}`).join("; ")}` : "Стори нет в отслеживании прогонов релиза"}>
                      {runs.length ? "Прогон есть" : "Прогона нет"}</Marker>
                    <a href={`${baseUrl}/browse/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline whitespace-nowrap">{s.key}</a>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-main" title={s.summary}>{s.summary}</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {runs.map(r => (
                        <button key={r.key} type="button" onClick={() => onOpenRun(r.key)} title={`${r.name} — открыть на вкладке «Прогоны»`}
                          className="flex items-center gap-1 font-mono text-[11px] text-primary hover:underline">{r.key}<RunTypeChip type={r.type} /></button>
                      ))}
                    </span>
                    <span className="text-xs text-text-muted whitespace-nowrap">{s.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-border-main"><MissingNfJql board={b} baseUrl={baseUrl} /></div>
          {stories.length > 0 && (
            <div className="border-t border-border-main px-4 py-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => setCovOpen(true)}
                title="Сопоставить стори релиза с его НФ-прогонами: авто по номеру стори + правка руками. Считает SimpleTest, в Jira ничего не пишется"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
                <ListChecks className="w-4 h-4" /> Проанализировать покрытие
                {b.coverage && <span className="text-xs text-text-muted">· {b.coverage.covered}/{b.coverage.total}</span>}</button>
              <button type="button" onClick={() => setKeOpen(true)}
                title={`Выравнивание: всем стори — все КЭ релиза${b.release.ke.length ? ` (${b.release.ke.map(k => k.label).join(", ")})` : ""}. Сначала покажет, что изменится`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
                <Tags className="w-4 h-4" /> КЭ релиза → на все стори</button>
            </div>
          )}
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
      {keOpen && <KeAlignModal releaseKey={relKey} baseUrl={baseUrl} onClose={() => setKeOpen(false)} />}
      {nfOpen && b && <NfRunsModal board={b} project={project} onOpenRun={onOpenRun} onChanged={onReload} onClose={() => setNfOpen(false)} />}
      {covOpen && b && <CoverageModal board={b} project={project} onChanged={onReload} onClose={() => setCovOpen(false)} />}
    </li>
  );
}

/**
 * Релизы строками. Прогоны к релизу прикрепляют в Zephyr (номер релиза — в отслеживании прогона). «Регресс» — у релиза
 * есть прогон регресса; «НФ» — каждая стори релиза есть в отслеживании прогона релиза (клик — прогоны НФ релиза);
 * «Регресс покрыт» — оба. «Собрать регресс» —
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
