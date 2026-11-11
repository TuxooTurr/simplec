"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { Issue } from "@/lib/jiraTool";
import { getAqaIssue, updateAqaIssue } from "@/lib/aqaApi";

/** Служебные теги вики-разметки Jira ({color:red}, {code}, {noformat}, {panel:…}, {quote}) — читать мешают, смысла не несут. */
const WIKI_TAG_RE = /\{(?:color|code|noformat|panel|quote)(?::[^}]*)?\}/g;
/** [текст|ссылка] и [ссылка] из вики-разметки, а также голые http(s)-ссылки. */
const LINK_RE = /\[([^\]|]+)\|(https?:\/\/[^\]\s]+)\]|\[(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<>\]]+)/g;

/** Текст описания с кликабельными ссылками. Остальная разметка остаётся как есть. */
function DescriptionText({ text }: { text: string }) {
  const clean = text.replace(WIKI_TAG_RE, "").replace(/\r\n/g, "\n").trim();
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of clean.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(clean.slice(last, at));
    const href = m[2] ?? m[3] ?? m[4];
    parts.push(
      <a key={at} href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{m[1] ?? href}</a>,
    );
    last = at + m[0].length;
  }
  if (last < clean.length) parts.push(clean.slice(last));
  return <div className="text-sm text-text-main whitespace-pre-wrap break-words leading-relaxed">{parts}</div>;
}

function Person({ label, name }: { label: string; name: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-sm text-text-main truncate">{name ? String(name) : <span className="text-text-muted/60">не назначен</span>}</p>
    </div>
  );
}

const fmtIso = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const DATE_INPUT = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50";

/**
 * Плановые даты задачи — «Дата начала работ» и «Дата завершения», необязательные. Читаются и пишутся в Jira тем же
 * кодом, что окно задачи «Трекинга AQA» (/api/aqa/issue/{key}): поля «Плановое начало/окончание» ищутся по названию,
 * поле для записи — по экрану редактирования (editmeta). Поля нет на экране — дата только для чтения.
 */
export function PlanDates({ issueKey, onSaved }: { issueKey: string; onSaved?: () => void }) {
  const [loaded, setLoaded] = useState<{ start: string; end: string; canStart: string | null; canEnd: string | null; created: string } | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(null); setNote(null);
    getAqaIssue(issueKey).then(d => {
      if (!alive) return;
      setLoaded({ start: d.planStart ?? "", end: d.planEnd ?? "", canStart: d.editable.planStart, canEnd: d.editable.planEnd, created: d.created ?? "" });
      setStart(d.planStart ?? ""); setEnd(d.planEnd ?? "");
    }).catch(e => alive && setNote({ kind: "err", text: `Даты не загрузились: ${(e as Error).message}` }));
    return () => { alive = false; };
  }, [issueKey]);

  const changed = !!loaded && (start !== loaded.start || end !== loaded.end);
  const bad = !!start && !!end && start > end;
  const save = async () => {
    if (!loaded) return;
    setBusy(true); setNote(null);
    try {
      const r = await updateAqaIssue(issueKey, {
        ...(start !== loaded.start ? { planStart: start } : {}), ...(end !== loaded.end ? { planEnd: end } : {}),
      });
      setLoaded({ ...loaded, start, end });
      setNote(r.warnings.length ? { kind: "warn", text: r.warnings.join(" · ") } : { kind: "ok", text: "Записано в Jira" });
      onSaved?.();
    } catch (e) {
      setNote({ kind: "err", text: (e as Error).message });
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-border-main">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span className="block mb-1">Дата начала работ</span>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} disabled={!loaded || !loaded.canStart || busy}
          title={loaded && !loaded.canStart ? "Поля плановой даты нет на экране редактирования задачи в Jira" : loaded?.canStart ?? undefined}
          className={DATE_INPUT} />
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span className="block mb-1">Дата завершения</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} disabled={!loaded || !loaded.canEnd || busy}
          title={loaded && !loaded.canEnd ? "Поля плановой даты нет на экране редактирования задачи в Jira" : loaded?.canEnd ?? undefined}
          className={DATE_INPUT} />
      </label>
      {!loaded && !note && <Loader2 className="w-4 h-4 mb-2 animate-spin text-text-muted" />}
      {changed && (
        <button type="button" onClick={save} disabled={busy || bad} aria-busy={busy}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
          {busy ? "Записываю…" : "Записать в Jira"}</button>
      )}
      <p className={`basis-full text-[11px] ${note?.kind === "err" || bad ? "text-red-600 dark:text-red-400" : note?.kind === "warn" ? "text-amber-700 dark:text-amber-300" : "text-text-muted"}`}>
        {bad ? "Дата начала позже даты завершения" : note ? note.text
          : "Необязательно. Из полей Jira «Плановое начало» и «Плановое окончание» — по ним задача стоит на графике и считается срок."}
        {!bad && loaded && !start && loaded.created && (
          <span className="block">Дата начала не задана — на графике считается от создания задачи: {fmtIso(loaded.created)}.</span>
        )}
      </p>
    </div>
  );
}

/** Задача из списка: кто автор, кто исполнитель, плановые даты и описание — без перехода в Jira. */
export default function IssueModal({ open, issue, onClose, onPlanSaved }: {
  open: boolean; issue: Issue; onClose: () => void;
  /** Плановые даты записаны в Jira — перечитать историю для графика. */
  onPlanSaved?: (key: string) => void;
}) {
  const desc = issue.fields.description;
  return (
    <Modal open={open} onClose={onClose} title={`${issue.key} · ${String(issue.fields.summary ?? "")}`} size="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2 pb-3 border-b border-border-main">
          <Person label="Автор" name={issue.fields.reporter} />
          <Person label="Исполнитель" name={issue.fields.assignee} />
          {issue.url && (
            <a href={issue.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-primary hover:underline">Открыть в Jira ↗</a>
          )}
        </div>
        {!issue.local && <PlanDates issueKey={issue.key} onSaved={() => onPlanSaved?.(issue.key)} />}
        {desc ? (
          <div className="max-h-[60vh] overflow-y-auto pr-1"><DescriptionText text={String(desc)} /></div>
        ) : (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">Описания нет.</p>
        )}
      </div>
    </Modal>
  );
}
