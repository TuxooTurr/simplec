"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDashed, Copy, ExternalLink, Link2, ListChecks, Loader2, Plus, RefreshCw, Rocket, Search, ShieldCheck, Tags, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import {
  addRelease, attachRun, createStoryRuns, detachRegress, detachRun, editNfRuns, getReleaseBoard, getReleases, getRuns, getStoryCases, removeRelease, runKind,
  type ReleaseBoard, type ZLinked, type ZRun,
} from "@/lib/zephyrApi";
import RunCard, { RunTypeChip } from "./RunCard";
import CritRegressView from "./CritRegressView";
import KeAlignModal from "./KeAlignModal";

const INPUT = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
/** Кнопки как во всём SimpleTest: основная — заливка, второстепенная — рамка; одна высота и отступы. */
const BTN_PRIMARY = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 whitespace-nowrap";
const BTN = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40 whitespace-nowrap";

type BoardState = { data?: ReleaseBoard; err?: string; busy?: boolean };

/* ── Что «светится» в строке релиза ───────────────────────────────────────── */

/** Стори релиза — связанные задачи с типом «История» / Story (дефекты, эпики и прочее в расчёт не идут). */
const isStory = (i: ZLinked) => /истори|стори|story/i.test(i.issuetype);
const storiesOf = (b: ReleaseBoard) => b.release.stories.filter(isStory);
/** Прогоны стори: из Zephyr (стори в отслеживании) и прикреплённые в SimpleTest. */
const storyRunsOf = (b: ReleaseBoard, key: string) => b.storyRuns[key] ?? [];
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

/** Папки прогонов списком — для выбора папки нового прогона и фильтра «Прикрепить имеющийся». */
const runFolders = (runs: ZRun[]) => [...new Set(runs.map(r => r.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));

/**
 * Прогон для выбранных стори. API Zephyr не дописывает отслеживание в готовый прогон, поэтому два пути:
 *  • «Создать НФ-прогоны» — на каждую стори свой прогон: стори в отслеживании (ставится при создании), кейсы —
 *    привязанные к стори, вид — НФ, папка — на выбор; прогон сразу в НФ релиза и у стори;
 *  • «Прикрепить имеющийся» — выбрать прогон из списка (по папкам); связь хранится в SimpleTest, красит маркеры.
 */
function StoryRunsModal({ board, project, stories, onChanged, onClose }: {
  board: ReleaseBoard; project: string; stories: ZLinked[]; onChanged: () => void; onClose: () => void;
}) {
  const rel = board.release.key;
  const [tab, setTab] = useState<"create" | "attach">("create");
  const [runs, setRuns] = useState<ZRun[] | null>(null);
  const [cases, setCases] = useState<Record<string, string[]> | null>(null);
  const [type, setType] = useState("");
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [folderF, setFolderF] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ ok: boolean; text: string }[] | null>(null);
  const storyKeys = stories.map(s => s.key).join(",");
  useEffect(() => {
    getRuns(project).then(r => setRuns(r.runs)).catch(e => setErr((e as Error).message));
    getStoryCases(rel, project, storyKeys.split(",")).then(r => { setCases(r.cases); setType(r.type); }).catch(e => setErr((e as Error).message));
  }, [project, rel, storyKeys]);
  const folders = runFolders(runs ?? []);
  const withCases = stories.filter(s => (cases?.[s.key] ?? []).length > 0);
  const sq = q.trim().toLowerCase();
  const shown = (runs ?? []).filter(r => (!folderF || r.folder === folderF || r.folder.startsWith(folderF + "/"))
    && (!sq || r.key.toLowerCase().includes(sq) || r.name.toLowerCase().includes(sq))).slice(0, 300);

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const r = await createStoryRuns(rel, project, withCases.map(s => ({ key: s.key, summary: s.summary })), folder, type);
      setDone(r.results.map(x => (x.run
        ? { ok: true, text: `${x.story} → прогон ${x.run} (кейсов ${x.cases})${x.warnings?.length ? `. ${x.warnings.join(" ")}` : ""}` }
        : { ok: false, text: `${x.story}: ${x.error}` })));
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const attach = async () => {
    setBusy(true); setErr("");
    try {
      await attachRun(rel, project, stories.map(s => s.key), pick);
      setDone([{ ok: true, text: `Прогон ${pick} прикреплён к стори: ${stories.map(s => s.key).join(", ")}. В Zephyr отслеживание этого прогона не меняется — API не умеет.` }]);
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const tabCls = (on: boolean) => `px-3 py-1.5 rounded-lg text-sm ${on ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main hover:bg-bg-subtle"}`;

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Прогон для стори · ${stories.length}`} size="max-w-3xl">
      <div className="space-y-3 text-sm">
        <div className="flex gap-1" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")} className={tabCls(tab === "create")}>
            <span className="flex items-center gap-1.5"><Rocket className="w-4 h-4" /> Создать НФ-прогоны</span></button>
          <button type="button" role="tab" aria-selected={tab === "attach"} onClick={() => setTab("attach")} className={tabCls(tab === "attach")}>
            <span className="flex items-center gap-1.5"><Link2 className="w-4 h-4" /> Прикрепить имеющийся</span></button>
        </div>
        {done ? (
          <>
            <ul className="space-y-1">
              {done.map(d => <li key={d.text} className={`rounded-lg px-3 py-1.5 ${d.ok ? "bg-green-600/10 text-green-800 dark:text-green-300" : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"}`}>{d.text}</li>)}
            </ul>
            <div className="flex justify-end"><button type="button" onClick={onClose} className={BTN_PRIMARY}>Готово</button></div>
          </>
        ) : tab === "create" ? (
          <>
            <p className="text-xs text-text-muted">На каждую стори — свой прогон: стори в отслеживании, кейсы — привязанные к стори в Zephyr,
              «Вид тестирования» — НФ. Прогон сразу появится в НФ релиза и у стори. Стори без кейсов не создаются — им прикрепите имеющийся прогон.</p>
            <ul className="max-h-56 overflow-y-auto scrollbar-thin divide-y divide-border-main border border-border-main rounded-lg">
              {stories.map(s => {
                const n = cases?.[s.key]?.length;
                return (
                  <li key={s.key} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="font-mono text-xs text-primary whitespace-nowrap">{s.key}</span>
                    <span className="min-w-0 flex-1 truncate text-text-main" title={s.summary}>{s.summary}</span>
                    <span className={`text-xs whitespace-nowrap ${n ? "text-text-muted" : "text-amber-700 dark:text-amber-300"}`}>
                      {cases ? (n ? `кейсов: ${n}` : "нет кейсов") : <Loader2 className="w-3.5 h-3.5 animate-spin" />}</span>
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="block text-xs text-text-muted">Папка прогонов</span>
                <select value={folder} onChange={e => setFolder(e.target.value)} className={`${INPUT} w-full`}>
                  <option value="">— корень —</option>
                  {folders.map(f => <option key={f} value={f}>{f}</option>)}
                </select></label>
              <label className="space-y-1"><span className="block text-xs text-text-muted">Вид тестирования</span>
                <input value={type} onChange={e => setType(e.target.value)} className={`${INPUT} w-full`} /></label>
            </div>
            {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={BTN}>Отмена</button>
              <button type="button" onClick={create} disabled={busy || !withCases.length} className={BTN_PRIMARY}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} Создать прогоны ({withCases.length})</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-text-muted">Выберите прогон — он прикрепится ко всем выбранным стори и встанет в НФ релиза. Связь хранится в SimpleTest:
              в Zephyr отслеживание готового прогона через API не меняется.</p>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)]">
                <Search className="w-3.5 h-3.5 text-text-muted" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Номер или название прогона" aria-label="Найти прогон"
                  className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" /></label>
              <select value={folderF} onChange={e => setFolderF(e.target.value)} aria-label="Папка прогонов" className={`${INPUT} w-64`}>
                <option value="">Все папки</option>
                {folders.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <ul role="radiogroup" aria-label="Прогон" className="max-h-72 overflow-y-auto scrollbar-thin divide-y divide-border-main border border-border-main rounded-lg">
              {!runs && <li className="px-3 py-2 text-text-muted"><Loader2 className="inline w-4 h-4 animate-spin" /> Загружаю прогоны…</li>}
              {runs && !shown.length && <li className="px-3 py-2 text-text-muted">Ничего не найдено.</li>}
              {shown.map(r => (
                <li key={r.key}>
                  <label className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${pick === r.key ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                    <input type="radio" name="attach-run" checked={pick === r.key} onChange={() => setPick(r.key)} />
                    <span className="font-mono text-xs text-primary whitespace-nowrap">{r.key}</span>
                    <span className="min-w-0 flex-1 truncate text-text-main" title={r.name}>{r.name}</span>
                    <RunTypeChip type={r.type} />
                    <span className="max-w-[160px] truncate text-[11px] text-text-muted" title={r.folder}>{r.folder}</span>
                  </label>
                </li>
              ))}
            </ul>
            {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={BTN}>Отмена</button>
              <button type="button" onClick={attach} disabled={busy || !pick} className={BTN_PRIMARY}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Прикрепить к {stories.length} стори</button>
            </div>
          </>
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
  if (!missing.length) return <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="w-3.5 h-3.5" /> Все стори в прогонах</span>;
  const jql = `issuekey in (${missing.map(s => s.key).join(", ")}) ORDER BY key`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(jql); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* выделите и скопируйте вручную */ }
  };
  return (
    <>
      <button type="button" onClick={() => setShown(v => !v)} aria-expanded={shown} title="JQL стори без прогона — открыть в Jira или скопировать"
        className={BTN}>
        <ListChecks className="w-4 h-4" /> Собрать список прогона · без прогона: {missing.length}</button>
      {shown && (
        <div className="basis-full order-last rounded-lg border border-border-main bg-bg-subtle p-2 space-y-1.5">
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
    </>
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
  /** Стори, отмеченные для «Прогон для выбранных», и открыто ли это окно. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [runsOpen, setRunsOpen] = useState(false);
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
          {b.traceSource === "issueKey" && (
            <p className="flex items-start gap-2 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Стенд отдаёт у прогона одну задачу отслеживания: «Прогон есть» — если стори в отслеживании прогона или прогон
                прикреплён к ней здесь. Отметьте стори без прогона и нажмите «Прогон для выбранных» — создать НФ-прогоны или прикрепить имеющийся.</span>
            </p>
          )}
          {stories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-muted">К задаче релиза не привязаны стори (связи Jira с типом «История»).</p>
          ) : (
            <ul className="divide-y divide-border-main">
              {stories.map(s => {
                const runs = storyRunsOf(b, s.key);
                return (
                  <li key={s.key} className={`flex items-center gap-3 px-4 py-2 ${picked.has(s.key) ? "bg-primary/5" : ""}`}>
                    <input type="checkbox" aria-label={`Выбрать ${s.key}`} checked={picked.has(s.key)}
                      onChange={() => setPicked(o => { const n = new Set(o); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })} />
                    <Marker on={runs.length > 0} title={runs.length ? `Стори в отслеживании прогонов релиза: ${runs.map(r => `${r.key} — ${r.name}`).join("; ")}` : "Стори нет в отслеживании прогонов релиза"}>
                      {runs.length ? "Прогон есть" : "Прогона нет"}</Marker>
                    <a href={`${baseUrl}/browse/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline whitespace-nowrap">{s.key}</a>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-main" title={s.summary}>{s.summary}</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {runs.map(r => (
                        <span key={r.key} className="flex items-center gap-0.5">
                          <button type="button" onClick={() => onOpenRun(r.key)}
                            title={`${r.name} — открыть на вкладке «Прогоны»${r.attached ? " · прикреплён в SimpleTest" : " · стори в отслеживании прогона"}`}
                            className="flex items-center gap-1 font-mono text-[11px] text-primary hover:underline">{r.key}{r.attached && <Link2 className="w-3 h-3" />}<RunTypeChip type={r.type} /></button>
                          {r.attached && (
                            <button type="button" aria-label={`Открепить ${r.key} от ${s.key}`} title="Открепить (связь SimpleTest; в Zephyr ничего не меняется)"
                              onClick={() => void detachRun(relKey, project, s.key, r.key).then(onReload, e => setNote([{ ok: false, text: (e as Error).message }]))}
                              className="p-0.5 rounded text-text-muted hover:text-red-500"><X className="w-3 h-3" /></button>
                          )}
                        </span>
                      ))}
                    </span>
                    <span className="text-xs text-text-muted whitespace-nowrap">{s.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {stories.length > 0 && (
            <div className="border-t border-border-main px-4 py-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none" title="Отметить все стори без прогона">
                <input type="checkbox" checked={storiesWithoutRun(b).length > 0 && storiesWithoutRun(b).every(x => picked.has(x.key))}
                  onChange={e => setPicked(e.target.checked ? new Set(storiesWithoutRun(b).map(x => x.key)) : new Set())} /> без прогона</label>
              <button type="button" onClick={() => setRunsOpen(true)} disabled={!picked.size} className={BTN_PRIMARY}
                title="Создать НФ-прогоны на выбранные стори или прикрепить к ним имеющийся прогон">
                <Rocket className="w-4 h-4" /> Прогон для выбранных{picked.size ? ` (${picked.size})` : ""}</button>
              <MissingNfJql board={b} baseUrl={baseUrl} />
              <button type="button" onClick={() => setKeOpen(true)} className={BTN}
                title={`Выравнивание: всем стори — все КЭ релиза${b.release.ke.length ? ` (${b.release.ke.map(k => k.label).join(", ")})` : ""}. Сначала покажет, что изменится`}>
                <Tags className="w-4 h-4" /> КЭ релиза → на все стори</button>
            </div>
          )}
        </div>
      )}
      {open && !b && !st.err && <p className="flex items-center gap-2 border-t border-border-main px-4 py-3 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю релиз…</p>}

      {regressOpen && (
        <Modal open onClose={() => setRegressOpen(false)} title={`${regress.length ? "Ревизия регресса" : "Собрать регресс"} · ${relKey}`} size="max-w-5xl">
          <CritRegressView project={project} baseUrl={baseUrl} releaseKey={relKey} modal
            existingRuns={regress.map(r => ({ key: r.key, name: r.name }))}
            onDetach={async run => { await detachRegress(relKey, project, run); onReload(); }}
            onRunCreated={(key, warnings) => {
              setRegressOpen(false);
              setNote([{ ok: true, text: `Прогон ${key} создан, в отслеживании — ${relKey}.` }, ...warnings.map(w => ({ ok: false, text: w }))]);
              onReload();
            }} />
        </Modal>
      )}
      {keOpen && <KeAlignModal releaseKey={relKey} baseUrl={baseUrl} onClose={() => setKeOpen(false)} />}
      {nfOpen && b && <NfRunsModal board={b} project={project} onOpenRun={onOpenRun} onChanged={onReload} onClose={() => setNfOpen(false)} />}
      {runsOpen && b && (
        <StoryRunsModal board={b} project={project} stories={stories.filter(x => picked.has(x.key))}
          onChanged={() => { setPicked(new Set()); onReload(); }} onClose={() => setRunsOpen(false)} />
      )}
    </li>
  );
}

/**
 * Релизы строками. Прогоны к релизу прикрепляют в Zephyr (номер релиза — в отслеживании прогона). «Регресс» — у релиза
 * есть прогон регресса; «НФ» — каждая стори релиза есть в отслеживании прогона релиза (клик — прогоны НФ релиза);
 * «Регресс покрыт» — оба. «Собрать регресс» —
 * окно: КЭ релиза → кейсы по полю «АС» → прогон в Zephyr с релизом в отслеживании. Раскрытая строка — стори
 * с маркером «Прогон есть», галочками и «Прогон для выбранных» (создать НФ-прогоны или прикрепить имеющийся),
 * «Собрать список прогона» — JQL стори без прогона. Список релизов общий — хранится в SimpleTest.
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
