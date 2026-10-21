"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { loadState, type Issue, type TaskList } from "@/lib/jiraTool";
import { FIELD_BY_ID } from "@/lib/jiraModel";
import { issueCache } from "@/lib/jiraToolCache";
import { issuesByKeys } from "@/lib/jiraToolApi";
import type { NewBooking } from "@/lib/standsApi";

/** Поле КЭ в SBER911 (jira_constants.FIELD_KE); если каталог Jira знает поле с названием «КЭ» — оно. */
const KE_FIELD = "customfield_18300";
const keFieldId = () => Object.values(FIELD_BY_ID).find(f => f.name.trim().toLowerCase() === "кэ")?.id ?? KE_FIELD;

/** КЭ задачи — значения поля КЭ (одно или списком). */
export function keOf(issue: Issue): string[] {
  const v = issue.fields[keFieldId()];
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(list.map(x => String(x).trim()).filter(Boolean)));
}

/**
 * Задачи из списка Jira tool → брони: номер задачи, название — в фичи, КЭ — из поля КЭ задачи. Задача с несколькими
 * КЭ даёт бронь на каждый КЭ (одна задача на 30 серверов — 30 броней). У задачи без КЭ — КЭ из формы, если он введён.
 * Задачи берутся из кэша Jira tool, недостающие — из Jira.
 */
export default function ImportFromList({ date, team, fallbackService, busy, onImport }: {
  date: string; team: string; fallbackService: string; busy: boolean;
  onImport: (items: NewBooking[]) => void;
}) {
  const lists = useMemo<TaskList[]>(() => { try { return loadState().lists.filter(l => l.keys.length); } catch { return []; } }, []);
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const list = lists.find(l => l.id === listId);
    if (!list) { setIssues([]); return; }
    let alive = true;
    const cached = issueCache().issues;
    const have = list.keys.map(k => cached[k]).filter((i): i is Issue => !!i);
    const need = list.keys.filter(k => !cached[k] && !k.includes("ЧЕРНОВИК"));
    setIssues(have); setPicked(new Set()); setErr("");
    if (!need.length) return;
    setLoading(true);
    issuesByKeys(need)
      .then(r => { if (alive) setIssues(cur => [...(cur ?? []), ...r.issues]); })
      .catch(e => { if (alive) setErr(`Часть задач не загрузилась из Jira: ${(e as Error).message}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [listId, lists]);

  if (!lists.length) {
    return <p className="text-xs text-text-muted">В Jira tool нет списков с задачами — импортировать нечего.</p>;
  }
  const order = new Map((lists.find(l => l.id === listId)?.keys ?? []).map((k, i) => [k, i]));
  const shown = (issues ?? [])
    .filter(i => !filter.trim() || `${i.key} ${String(i.fields.summary ?? "")} ${keOf(i).join(" ")}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  const items: NewBooking[] = (issues ?? []).filter(i => picked.has(i.key)).flatMap(i => {
    const kes = keOf(i).length ? keOf(i) : fallbackService.trim() ? [fallbackService.trim()] : [];
    return kes.map(service => ({ date, team, service, features: String(i.fields.summary ?? "").trim(), task: i.key, hotfix: false }));
  });
  const noKe = (issues ?? []).filter(i => picked.has(i.key) && !keOf(i).length && !fallbackService.trim()).map(i => i.key);
  const allOn = shown.length > 0 && shown.every(i => picked.has(i.key));

  return (
    <div className="rounded-lg border border-border-main bg-bg-card p-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-text-main">Из списка Jira tool:</span>
        <select value={listId} onChange={e => setListId(e.target.value)} aria-label="Список Jira tool"
          className="text-sm border border-border-main rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main">
          {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.keys.length})</option>)}
        </select>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Поиск: номер, название, КЭ" aria-label="Поиск задачи"
          className="text-sm border border-border-main rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main w-56" />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-text-main cursor-pointer">
          <input type="checkbox" checked={allOn} onChange={e => setPicked(p => {
            const n = new Set(p); shown.forEach(i => (e.target.checked ? n.add(i.key) : n.delete(i.key))); return n;
          })} /> все
        </label>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <ul className="max-h-56 overflow-y-auto scrollbar-thin divide-y divide-border-main border border-border-main rounded-md">
        {shown.length === 0 && <li className="px-2 py-2 text-xs text-text-muted">{loading ? "Загружаю задачи…" : "Нет задач"}</li>}
        {shown.map(i => {
          const kes = keOf(i);
          return (
            <li key={i.key}>
              <label className="flex items-start gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-bg-subtle">
                <input type="checkbox" className="mt-0.5" checked={picked.has(i.key)}
                  onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(i.key); else n.delete(i.key); return n; })} />
                <span className="font-mono text-primary whitespace-nowrap">{i.key}</span>
                <span className="min-w-0 flex-1 text-text-main">{String(i.fields.summary ?? "")}</span>
                <span className="flex flex-wrap justify-end gap-1 max-w-[45%]">
                  {kes.length ? kes.map(k => <span key={k} className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">{k}</span>)
                    : <span className="text-amber-700 dark:text-amber-300">КЭ не указан</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !items.length} onClick={() => onImport(items)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          <Download className="w-4 h-4" /> Добавить: броней {items.length}</button>
        <span className="text-xs text-text-muted">задача → номер, название → фичи, КЭ задачи → бронь на каждый КЭ</span>
        {noKe.length > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-300">без КЭ и не попадут: {noKe.join(", ")} — укажите КЭ в форме выше</span>
        )}
      </div>
    </div>
  );
}
