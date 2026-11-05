"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Loader2, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { listReqFolders, listRequirements, type ReqFolder, type Requirement } from "@/lib/api";
import { liveLists, loadState, projectKeyOfIssue, type Issue, type ToolState } from "@/lib/jiraTool";
import { issuesByKeys } from "@/lib/jiraToolApi";
import { issueCache } from "@/lib/jiraToolCache";
import { dataFolderPath, type TaskDoc, type TaskPick } from "@/lib/taskModel";

const LAST_LIST_KEY = "st_jira_last_list";

/**
 * Выбор задач перед генерацией: список Jira tool → задачи с галочками. У каждой видно привязанные требования и папку
 * «Данных» — по ней кейсы лягут в модель. Нет требований — предупреждение: генерация пойдёт по описанию задачи.
 */
export default function TaskPickerModal({ open, picked, onPick, onClose }: {
  open: boolean;
  picked: TaskPick[];
  onPick: (tasks: TaskPick[]) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<ToolState | null>(null);
  const [listId, setListId] = useState("");
  const [docs, setDocs] = useState<Requirement[]>([]);
  const [folders, setFolders] = useState<ReqFolder[]>([]);
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [onlyReqs, setOnlyReqs] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const s = loadState();
    setState(s);
    setSel(new Set(picked.map(t => t.key)));
    setIssues({ ...issueCache().issues, ...Object.fromEntries(s.created.map(i => [i.key, i])) });
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_LIST_KEY); } catch { /* приватный режим */ }
    const live = liveLists(s);
    setListId(cur => (live.some(l => l.id === cur) ? cur : live.find(l => l.id === last)?.id ?? live[0]?.id ?? ""));
    Promise.all([listRequirements(), listReqFolders()]).then(([d, f]) => { setDocs(d); setFolders(f); }, e => setErr((e as Error).message));
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const list = state?.lists.find(l => l.id === listId);
  const drafts = useMemo(() => new Set(state?.created.map(i => i.key) ?? []), [state]);

  // Задач нет в кэше Jira tool (раздел не открывали) — подгружаем темы и описания.
  useEffect(() => {
    if (!open || !list) return;
    const need = list.keys.filter(k => !issues[k] && !drafts.has(k));
    if (!need.length) return;
    setBusy(true);
    issuesByKeys(need)
      .then(r => { setIssues(cur => ({ ...cur, ...Object.fromEntries(r.issues.map(i => [i.key, i])) })); setErr(""); },
        e => setErr(`Jira не ответила — темы задач не подтянулись: ${(e as Error).message}`))
      .finally(() => setBusy(false));
  }, [open, listId, list?.keys.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pathOf = (r: Requirement) => dataFolderPath(folders, r.folder_id);
  const docsOf = (key: string): Requirement[] => (state?.reqLinks[key] ?? []).map(id => docs.find(d => d.id === id)).filter((d): d is Requirement => !!d);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list?.keys ?? []).filter(k => !drafts.has(k)).filter(k => {
      const summary = String(issues[k]?.fields.summary ?? "");
      return (!needle || k.toLowerCase().includes(needle) || summary.toLowerCase().includes(needle)) && (!onlyReqs || docsOf(k).length > 0);
    });
  }, [list, issues, q, onlyReqs, docs, state]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setSel(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allOn = rows.length > 0 && rows.every(k => sel.has(k));

  const apply = () => {
    const keep = picked.filter(t => sel.has(t.key));
    const added: TaskPick[] = [...sel].filter(k => !keep.some(t => t.key === k)).map(key => {
      const f = issues[key]?.fields ?? {};
      const linked: TaskDoc[] = docsOf(key).map(d => ({ id: d.id, name: d.name, feature: d.feature, text: d.text || d.qa_doc, dataPath: pathOf(d) }));
      return {
        key, summary: String(f.summary ?? ""), type: String(f.issuetype ?? ""), project: projectKeyOfIssue(key),
        description: String(f.description ?? ""), docs: linked, dataPath: linked.find(d => d.dataPath.length)?.dataPath ?? [],
      };
    });
    onPick([...keep, ...added]);
    onClose();
  };

  const lists = state ? liveLists(state) : [];

  return (
    <Modal open={open} onClose={onClose} title="Задачи для генерации" size="max-w-4xl">
      <div className="space-y-3">
        {!lists.length ? <p className="text-sm text-text-muted">В Jira tool нет списков в работе — создайте список и добавьте задачи.</p> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select value={listId} onChange={e => setListId(e.target.value)} aria-label="Список Jira tool"
                className="min-w-[220px] rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 text-sm text-text-main">
                {lists.map(l => <option key={l.id} value={l.id}>{l.name} · {l.keys.length}</option>)}
              </select>
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Номер или тема" aria-label="Поиск задачи"
                  className="w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] py-1.5 pl-8 pr-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-main">
                <input type="checkbox" checked={onlyReqs} onChange={e => setOnlyReqs(e.target.checked)} /> Только с требованиями
              </label>
            </div>
            {err && <p className="text-xs text-amber-700 dark:text-amber-400">{err}</p>}
            <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-border-main scrollbar-thin">
              {!rows.length ? <p className="p-4 text-center text-sm text-text-muted">{busy ? "Загружаю задачи…" : "Задач нет"}</p> : (
                <>
                  <label className="sticky top-0 z-10 flex cursor-pointer select-none items-center gap-2 border-b border-border-main bg-bg-card px-3 py-1.5 text-xs text-text-muted">
                    <input type="checkbox" checked={allOn} onChange={() => setSel(s => {
                      const n = new Set(s); rows.forEach(k => (allOn ? n.delete(k) : n.add(k))); return n;
                    })} /> Все ({rows.length})
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </label>
                  <ul className="divide-y divide-border-main">
                    {rows.map(k => {
                      const f = issues[k]?.fields, linked = docsOf(k);
                      const path = linked.map(pathOf).find(p => p.length);
                      return (
                        <li key={k}>
                          <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm hover:bg-bg-subtle">
                            <input type="checkbox" className="mt-1" checked={sel.has(k)} onChange={() => toggle(k)} aria-label={`Выбрать ${k}`} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="flex-shrink-0 font-mono text-xs text-primary">{k}</span>
                                <span className="truncate text-text-main">{String(f?.summary ?? "")}</span>
                                {f?.issuetype && <span className="flex-shrink-0 text-[11px] text-text-muted">{String(f.issuetype)}</span>}
                              </span>
                              {linked.length ? (
                                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
                                  <FileText className="h-3 w-3 flex-shrink-0" />
                                  {linked.map(d => <span key={d.id} className="rounded bg-bg-subtle px-1.5 py-px text-text-main">{d.name}</span>)}
                                  {path && <span className="truncate">{path.join(" / ")}</span>}
                                </span>
                              ) : (
                                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3" />
                                  {String(f?.description ?? "").trim() ? "Нет требований — генерация пойдёт по описанию задачи" : "Нет ни требований, ни описания — генерировать не из чего"}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-text-muted">Выбрано: {sel.size}</span>
          <button type="button" onClick={onClose} className="rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">Отмена</button>
          <button type="button" onClick={apply} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white">Выбрать</button>
        </div>
      </div>
    </Modal>
  );
}
