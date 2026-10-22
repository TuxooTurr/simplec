"use client";

import { useEffect, useMemo, useState } from "react";
import { ListPlus, Loader2 } from "lucide-react";
import { loadState, type Issue, type TaskList } from "@/lib/jiraTool";
import { issueCache } from "@/lib/jiraToolCache";
import { issuesByKeys } from "@/lib/jiraToolApi";

/** Фича для черновика брони: номер, название и микросервисы задачи из поля «Микросервисы (st)» Jira tool. */
export interface PickedFeature { task: string; name: string; ms: string[] }

/**
 * Выбор задач из списка Jira tool для черновика брони. Ничего не бронирует: «Подставить в форму» отдаёт фичи
 * (номер, название и микросервисы из поля «Микросервисы (st)» Jira tool), их правят в форме и публикуют.
 * С 22.10.2026 на графике бронируют микросервисы, поле КЭ задачи не подставляется. Задачи — из кэша Jira tool,
 * недостающие — из Jira. Уже добавленные в форму помечены.
 */
export default function ImportFromList({ already, onPick }: { already: Set<string>; onPick: (rows: PickedFeature[]) => void }) {
  const lists = useMemo<TaskList[]>(() => { try { return loadState().lists.filter(l => l.keys.length); } catch { return []; } }, []);
  const msLinks = useMemo<Record<string, string[]>>(() => { try { return loadState().msLinks ?? {}; } catch { return {}; } }, []);
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
    return <p className="text-xs text-text-muted">В Jira tool нет списков с задачами — подставить нечего.</p>;
  }
  const order = new Map((lists.find(l => l.id === listId)?.keys ?? []).map((k, i) => [k, i]));
  const shown = (issues ?? [])
    .filter(i => !filter.trim() || `${i.key} ${String(i.fields.summary ?? "")}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  const chosen = (issues ?? []).filter(i => picked.has(i.key));
  const allOn = shown.length > 0 && shown.every(i => picked.has(i.key));

  return (
    <div className="rounded-lg border border-border-main bg-bg-card p-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-text-main">Фичи из списка Jira tool:</span>
        <select value={listId} onChange={e => setListId(e.target.value)} aria-label="Список Jira tool"
          className="text-sm border border-border-main rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main">
          {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.keys.length})</option>)}
        </select>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Поиск: номер, название" aria-label="Поиск задачи"
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
        {shown.map(i => (
          <li key={i.key}>
            <label className="flex items-start gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-bg-subtle">
              <input type="checkbox" className="mt-0.5" checked={picked.has(i.key)}
                onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(i.key); else n.delete(i.key); return n; })} />
              <span className="font-mono text-primary whitespace-nowrap">{i.key}</span>
              <span className="min-w-0 flex-1 text-text-main">{String(i.fields.summary ?? "")}
                {already.has(i.key) && <span className="ml-1.5 text-text-muted">· уже в форме</span>}</span>
              <span className="flex flex-wrap justify-end gap-1 max-w-[45%]">
                {(msLinks[i.key] ?? []).map(m => <span key={m} className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300 font-mono">{m}</span>)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!chosen.length}
          onClick={() => { onPick(chosen.map(i => ({ task: i.key, name: String(i.fields.summary ?? "").trim(), ms: msLinks[i.key] ?? [] }))); setPicked(new Set()); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-primary/10 disabled:opacity-50">
          <ListPlus className="w-4 h-4" /> Подставить в форму: {chosen.length}</button>
        <span className="text-xs text-text-muted">номер, название и микросервисы задачи (поле «Микросервисы (st)») заполнят форму — проверьте и опубликуйте</span>
      </div>
    </div>
  );
}
