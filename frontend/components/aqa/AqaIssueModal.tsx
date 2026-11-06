"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import JiraUserField from "@/components/jiratool/JiraUserField";
import { fmtDay, getAqaIssue, updateAqaIssue, type AqaIssueChange, type AqaIssueDetails } from "@/lib/aqaApi";
import { applyTransitions, getTransitions, type Transition } from "@/lib/jiraToolApi";

const INPUT = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed";
const LBL = "block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5";
const NOT_ON_SCREEN = "Поля нет на экране редактирования задачи в Jira";

interface Form { summary: string; description: string; priority: string; login: string; display: string; planStart: string; planEnd: string }

/** textarea хранит переводы строк как \n, а Jira отдаёт \r\n: без этого нетронутое описание считалось бы изменённым. */
const text = (s: string) => s.replace(/\r\n/g, "\n");
const formOf = (d: AqaIssueDetails): Form => ({
  summary: d.summary, description: text(d.description), priority: d.priorityId, login: d.assigneeLogin, display: d.assignee,
  planStart: d.planStart, planEnd: d.planEnd,
});

/** Только изменённое: в Jira не уходит то, что не трогали (и не перетирается чужая правка соседнего поля). */
function changesOf(d: AqaIssueDetails, f: Form): AqaIssueChange {
  const c: AqaIssueChange = {};
  if (f.summary.trim() !== d.summary) c.summary = f.summary.trim();
  if (f.description !== text(d.description)) c.description = f.description;
  if (f.priority !== d.priorityId) c.priority = f.priority;
  if (f.login !== d.assigneeLogin) c.assignee = f.login;
  if (f.planStart !== d.planStart) c.planStart = f.planStart;
  if (f.planEnd !== d.planEnd) c.planEnd = f.planEnd;
  return c;
}

/**
 * Задача эпика: статус (переходы Jira), исполнитель, плановые даты, приоритет, название и описание — без перехода в Jira.
 * Статус применяется сразу, как в самой Jira; остальное — кнопкой «Сохранить», уходит только изменённое.
 * Описание — вики-разметка Jira как есть. Поле, которого нет на экране редактирования задачи, закрыто.
 */
export default function AqaIssueModal({ issueKey, onChanged, onClose }: {
  issueKey: string;
  /** Что-то записано в Jira — роадмап надо перечитать. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<AqaIssueDetails | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [trans, setTrans] = useState<{ list: Transition[]; err: string }>({ list: [], err: "" });
  /** Переход, которому нужно решение: сначала выбираем его. */
  const [pending, setPending] = useState<{ tr: Transition; resolution: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const loadTransitions = useCallback(async () => {
    try {
      const r = (await getTransitions([issueKey])).issues[issueKey];
      setTrans({ list: r?.transitions ?? [], err: r?.error ?? "" });
    } catch (e) { setTrans({ list: [], err: (e as Error).message }); }
  }, [issueKey]);

  useEffect(() => {
    let alive = true;
    getAqaIssue(issueKey).then(d => { if (alive) { setData(d); setForm(formOf(d)); } }, e => { if (alive) setLoadErr((e as Error).message); });
    void loadTransitions();
    return () => { alive = false; };
  }, [issueKey, loadTransitions]);

  const set = (patch: Partial<Form>) => setForm(f => (f ? { ...f, ...patch } : f));
  const change = data && form ? changesOf(data, form) : {};
  const dirty = Object.keys(change).length > 0;
  const badDates = !!form?.planStart && !!form.planEnd && form.planStart > form.planEnd;
  const ed = data?.editable;

  /** Статус применяется сразу. Несохранённые правки формы при этом не теряются. */
  const go = async (tr: Transition, resolution = "") => {
    if (tr.resolution_required && tr.resolutions?.length && !resolution) { setPending({ tr, resolution: "" }); return; }
    setBusy(true); setErr(""); setPending(null);
    try {
      const r = (await applyTransitions([{ key: issueKey, transition_id: tr.id, resolution }])).results[0];
      if (!r?.ok) throw new Error(r?.error || "Jira не применила переход");
      onChanged();
      const d = await getAqaIssue(issueKey);
      setData(d);
      if (!dirty) setForm(formOf(d));               // переход мог сменить исполнителя — показываем, что стало
      await loadTransitions();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setErr(""); setWarnings([]);
    try {
      const r = await updateAqaIssue(issueKey, change);
      onChanged();
      if (!r.warnings.length) { onClose(); return; }
      setWarnings(r.warnings);                       // что-то не записалось — остаёмся и показываем, что именно
      const d = await getAqaIssue(issueKey);
      setData(d); setForm(formOf(d));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} size="max-w-3xl" title={data ? `${data.key} · ${data.type}` : issueKey}>
      {!data || !form ? (
        loadErr ? <p className="text-sm text-red-600 dark:text-red-400">{loadErr}</p>
          : <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю задачу из Jira…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <span className={LBL}>Статус</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-bg-subtle px-2.5 py-1 text-sm font-semibold text-text-main">{data.status}</span>
              {trans.list.length > 0 && <ArrowRight className="h-3.5 w-3.5 text-text-muted" aria-hidden />}
              {trans.list.map(t => (
                <button key={t.id} type="button" disabled={busy} onClick={() => void go(t)} title={`Перевести в «${t.to}» — сразу в Jira`}
                  aria-pressed={pending?.tr.id === t.id}
                  className={`rounded-md border px-2.5 py-1 text-xs hover:bg-bg-subtle disabled:opacity-40 ${pending?.tr.id === t.id ? "border-primary text-primary" : "border-border-main text-text-main"}`}>{t.name}</button>
              ))}
              {!trans.list.length && !trans.err && <span className="text-xs text-text-muted">переходов нет</span>}
            </div>
            {trans.err && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Переходы не загрузились: {trans.err}</p>}
            {pending && (
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor="aqa-res" className="text-xs text-text-muted whitespace-nowrap">Решение для «{pending.tr.to}»</label>
                <select id="aqa-res" value={pending.resolution} onChange={e => setPending({ ...pending, resolution: e.target.value })} className={`${INPUT} max-w-[240px] py-1`}>
                  <option value="">— выберите —</option>
                  {pending.tr.resolutions?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <button type="button" disabled={busy || !pending.resolution} onClick={() => void go(pending.tr, pending.resolution)}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Перевести</button>
                <button type="button" onClick={() => setPending(null)} className="text-xs text-text-muted hover:text-text-main">Отмена</button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="aqa-sum" className={LBL}>Название</label>
            <input id="aqa-sum" value={form.summary} onChange={e => set({ summary: e.target.value })} maxLength={250} disabled={!ed?.summary}
              title={ed?.summary ? undefined : NOT_ON_SCREEN} className={INPUT} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="aqa-start" className={LBL}>Плановое начало</label>
              <input id="aqa-start" type="date" value={form.planStart} onChange={e => set({ planStart: e.target.value })} disabled={!ed?.planStart}
                title={ed?.planStart ? `Поле Jira «${ed.planStart}»` : NOT_ON_SCREEN} className={INPUT} />
              {!data.planStart && data.created && <p className="mt-1 text-[11px] text-text-muted">Не задано — на роадмапе от даты создания ({fmtDay(data.created)})</p>}
            </div>
            <div>
              <label htmlFor="aqa-end" className={LBL}>Плановое окончание</label>
              <input id="aqa-end" type="date" value={form.planEnd} onChange={e => set({ planEnd: e.target.value })} disabled={!ed?.planEnd}
                title={ed?.planEnd ? `Поле Jira «${ed.planEnd}»` : NOT_ON_SCREEN} className={INPUT} />
              {!data.planEnd && data.due && <p className="mt-1 text-[11px] text-text-muted">Не задано — на роадмапе срок ({fmtDay(data.due)})</p>}
            </div>
            {(!ed?.planStart || !ed?.planEnd) && <p className="col-span-2 text-[11px] text-amber-700 dark:text-amber-400">{NOT_ON_SCREEN}: дату здесь не поменять.</p>}
            {badDates && <p className="col-span-2 text-xs text-red-600 dark:text-red-400">Плановое начало позже планового окончания.</p>}
            <div>
              <span className={LBL}>Исполнитель</span>
              <JiraUserField label="" jiraOk name={form.login} display={form.display} onChange={v => set({ login: v.jiraName, display: v.jiraDisplay })} />
            </div>
            <div>
              <label htmlFor="aqa-prio" className={LBL}>Критичность</label>
              <select id="aqa-prio" value={form.priority} onChange={e => set({ priority: e.target.value })} disabled={!ed?.priority || !data.priorities.length}
                title={ed?.priority ? undefined : NOT_ON_SCREEN} className={INPUT}>
                {!data.priorities.some(p => p.id === form.priority) && <option value={form.priority}>{data.priority || "—"}</option>}
                {data.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="aqa-desc" className={LBL}>Описание</label>
            <textarea id="aqa-desc" value={form.description} onChange={e => set({ description: e.target.value })} rows={9} disabled={!ed?.description}
              title={ed?.description ? "Разметка Jira, как в самой задаче" : NOT_ON_SCREEN} className={`${INPUT} resize-y font-mono text-[13px]`} />
          </div>

          {err && <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40">{err}</p>}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-700 dark:text-amber-300">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
          )}

          <div className="flex items-center gap-2 border-t border-border-main pt-3">
            <a href={data.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              Открыть в Jira <ExternalLink className="h-3.5 w-3.5" /></a>
            <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:text-text-main">
              {dirty ? "Отмена" : "Закрыть"}</button>
            <button type="button" onClick={() => void save()} disabled={!dirty || busy || badDates || !form.summary.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить в Jira</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
