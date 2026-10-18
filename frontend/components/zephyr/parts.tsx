"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2, Loader2, Minus, Pencil, Trash2, X } from "lucide-react";
import { createCase, deleteCase, getCase, resultTone, updateCase, zText, type CaseEditIn, type ZCaseFull } from "@/lib/zephyrApi";
import CaseEditor from "./CaseEditor";

const TONE_CLS = {
  pass: "bg-green-600 text-white",
  fail: "bg-red-600 text-white",
  blocked: "bg-amber-500 text-amber-950",
  progress: "bg-blue-600 text-white",
  none: "bg-bg-subtle text-text-muted border border-border-main",
} as const;
const TONE_BAR = { pass: "bg-green-600", fail: "bg-red-600", blocked: "bg-amber-500", progress: "bg-blue-600", none: "bg-text-muted/25" } as const;
const TONE_ORDER = ["pass", "fail", "blocked", "progress", "none"] as const;

/** Статус результата прохождения цветом по смыслу. */
export function ResultPill({ status }: { status: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${TONE_CLS[resultTone(status)]}`}>{status || "Not Executed"}</span>;
}

/** Полоса прогресса прогона: доли статусов, слева направо — пройдено, провалено, заблокировано, в работе, не начато. */
export function ResultBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const sum = Math.max(total, Object.values(counts).reduce((a, b) => a + b, 0));
  const byTone = new Map<string, number>();
  for (const [st, n] of Object.entries(counts)) byTone.set(resultTone(st), (byTone.get(resultTone(st)) ?? 0) + n);
  const done = sum - (byTone.get("none") ?? 0) - (byTone.get("progress") ?? 0);
  const title = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Нет данных о прохождении";
  return (
    <div className="flex items-center gap-2 min-w-0" title={title}>
      <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden flex">
        {sum > 0 && TONE_ORDER.map(t => (byTone.get(t) ? <span key={t} className={TONE_BAR[t]} style={{ width: `${((byTone.get(t) ?? 0) / sum) * 100}%` }} /> : null))}
      </div>
      <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">{done}/{sum}</span>
    </div>
  );
}

/** Ссылки на задачи Jira (отслеживание): кейс или прогон ↔ стори, эпик, дефект. */
export function IssueLinks({ keys, baseUrl }: { keys: string[]; baseUrl: string }) {
  if (!keys.length) return <span className="text-xs text-text-muted">нет связей</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {keys.map(k => (
        <a key={k} href={baseUrl ? `${baseUrl}/browse/${k}` : undefined} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-mono hover:underline">
          <Link2 className="w-3 h-3" />{k}
        </a>
      ))}
    </span>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  const t = zText(text);
  if (!t) return null;
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">{title}</p>
      <p className="text-sm text-text-main whitespace-pre-wrap leading-relaxed">{t}</p>
    </section>
  );
}

/**
 * Карточка кейса: цель, предусловие, шаги, метки, связи с Jira. С editable — «Изменить» (редактор, в Jira уходят
 * только изменённые поля) и «Удалить» (с подтверждением). onChanged — раздел обновляет дерево и список по модели.
 */
export function CaseCard({ caseKey, baseUrl, project = "", editable, startEditing, onChanged, onClose, onMinimize, onTitle }: {
  caseKey: string;
  /** Открыть сразу в режиме правки («Изменить» из списка). */
  startEditing?: boolean;
  baseUrl: string;
  project?: string;
  editable?: boolean;
  onChanged?: () => void;
  onClose: () => void;
  /** Окно кейса: свернуть в плашку, не закрывая. */
  onMinimize?: () => void;
  /** Название загрузилось — для плашки свёрнутого окна. */
  onTitle?: (name: string) => void;
}) {
  const [c, setC] = useState<ZCaseFull | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [askDel, setAskDel] = useState(false);
  const save = async (e: CaseEditIn) => {
    setBusy(true); setSaveErr("");
    try { setC(await updateCase(caseKey, project, e)); setEditing(false); onChanged?.(); } catch (x) { setSaveErr((x as Error).message); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true); setSaveErr("");
    try { await deleteCase(caseKey, project); onChanged?.(); onClose(); } catch (x) { setSaveErr((x as Error).message); setBusy(false); }
  };
  useEffect(() => {
    let live = true;
    setC(null); setErr(""); setEditing(!!startEditing && !!editable); setAskDel(false); setSaveErr("");
    getCase(caseKey, project).then(x => { if (live) { setC(x); onTitle?.(x.name); } }).catch(e => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [caseKey, project, startEditing, editable]);

  return (
    <aside className="flex flex-col min-h-0 h-full border-l border-border-main bg-bg-card" aria-label={`Кейс ${caseKey}`}>
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border-main">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-primary">{caseKey}</p>
          <p className="text-sm font-semibold text-text-main break-words">{c?.name ?? " "}</p>
        </div>
        {editable && c && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)} title="Изменить кейс" aria-label="Изменить кейс"
              className="p-1 rounded text-text-muted hover:text-primary"><Pencil className="w-4 h-4" /></button>
            <button type="button" onClick={() => setAskDel(true)} title="Удалить кейс" aria-label="Удалить кейс"
              className="p-1 rounded text-text-muted hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
          </>
        )}
        {baseUrl && (
          <a href={`${baseUrl}/secure/Tests.jspa#/testCase/${caseKey}`} target="_blank" rel="noopener noreferrer" title="Открыть в Zephyr"
            className="p-1 rounded text-text-muted hover:text-primary"><ExternalLink className="w-4 h-4" /></a>
        )}
        {onMinimize && <MinimizeBtn onClick={onMinimize} />}
        <button type="button" onClick={onClose} aria-label="Закрыть карточку" className="p-1 rounded text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
        {askDel && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm">
            <span className="text-red-700 dark:text-red-300">Удалить {caseKey} из Zephyr? Отменить будет нельзя.</span>
            <button type="button" onClick={remove} disabled={busy} className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 text-white font-semibold">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Удалить</button>
            <button type="button" onClick={() => setAskDel(false)} className="px-2.5 py-1 rounded-md border border-border-main text-text-muted">Нет</button>
          </div>
        )}
        {saveErr && !editing && <p className="text-sm text-red-600 dark:text-red-400">{saveErr}</p>}
        {editing && c && <CaseEditor initial={c} busy={busy} error={saveErr} onSave={save} onCancel={() => { setEditing(false); setSaveErr(""); }} />}
        {err && <p className="text-sm text-red-600 dark:text-red-400">Кейс не загрузился: {err}</p>}
        {!c && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
        {c && !editing && (
          <>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {c.status && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main text-text-main">{c.status}</span>}
              {c.priority && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main text-text-main">Приоритет: {c.priority}</span>}
              {c.owner && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main text-text-muted">{c.owner}</span>}
              {c.labels.map(l => <span key={l} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary">{l}</span>)}
            </div>
            {c.folder && <p className="text-xs text-text-muted">Папка: {c.folder}</p>}
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">Связи с Jira</p>
              <IssueLinks keys={c.issueLinks} baseUrl={baseUrl} />
            </section>
            <Block title="Цель" text={c.objective} />
            <Block title="Предусловие" text={c.precondition} />
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">Шаги · {c.steps.length}</p>
              {c.steps.length === 0 ? <p className="text-xs text-text-muted">Шагов нет.</p> : (
                <ol className="space-y-2">
                  {c.steps.map((s, i) => (
                    <li key={i} className="rounded-lg border border-border-main p-2.5 text-sm">
                      <p className="flex gap-2"><span className="w-5 h-5 flex-shrink-0 rounded bg-bg-subtle text-[11px] font-semibold text-text-muted flex items-center justify-center">{i + 1}</span>
                        <span className="text-text-main whitespace-pre-wrap">{zText(s.description) || "—"}</span></p>
                      {zText(s.testData) && <p className="mt-1.5 ml-7 text-xs text-text-muted whitespace-pre-wrap"><b className="font-medium">Данные:</b> {zText(s.testData)}</p>}
                      {zText(s.expectedResult) && <p className="mt-1.5 ml-7 text-xs text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap"><b className="font-medium">Ожидаемо:</b> {zText(s.expectedResult)}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}


/** «Свернуть» в шапке окна кейса. */
export function MinimizeBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Свернуть (Esc)" aria-label="Свернуть окно"
      className="p-1 rounded text-text-muted hover:text-text-main"><Minus className="w-4 h-4" /></button>
  );
}

/** Новый кейс в папке: форма → «Создать в Jira» → открывается его карточка. */
export function NewCaseCard({ project, folder, onCreated, onClose, onMinimize }: {
  project: string;
  folder: string;
  onCreated: (key: string) => void;
  onClose: () => void;
  onMinimize?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async (e: CaseEditIn) => {
    setBusy(true); setErr("");
    try { const c = await createCase(project, { ...e, name: e.name ?? "", folder }); onCreated(c.key); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  return (
    <aside className="flex flex-col min-h-0 h-full border-l border-border-main bg-bg-card" aria-label="Новый кейс">
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border-main">
        <p className="min-w-0 flex-1 text-sm font-semibold text-text-main">Новый кейс</p>
        {onMinimize && <MinimizeBtn onClick={onMinimize} />}
        <button type="button" onClick={onClose} aria-label="Закрыть" className="p-1 rounded text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
        <CaseEditor folder={folder} busy={busy} error={err} onSave={save} onCancel={onClose} />
      </div>
    </aside>
  );
}
