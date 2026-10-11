"use client";

import { useMemo, useState } from "react";
import { Hash, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { JqlError, compileJql, jqlExamples, parseKeys, projectOf, type Issue } from "@/lib/jiraTool";

/** Добавление задач в список: JQL-фильтр или номера задач. */
export default function AddIssuesModal({ open, project, onClose, allIssues, inList, onAdd }: {
  open: boolean;
  /** Проект списка: голый номер задачи и примеры JQL — из него. */
  project: string;
  onClose: () => void;
  allIssues: Issue[];
  inList: Set<string>;
  onAdd: (keys: string[]) => void;
}) {
  const [tab, setTab] = useState<"jql" | "keys">("jql");
  const [jql, setJql] = useState("");
  const [keysText, setKeysText] = useState("");
  const [found, setFound] = useState<Issue[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const byKey = useMemo(() => new Map(allIssues.map(i => [i.key, i])), [allIssues]);

  const show = (issues: Issue[]) => {
    setFound(issues);
    setPicked(new Set(issues.filter(i => !inList.has(i.key)).map(i => i.key)));
  };

  const runJql = () => {
    setErr(""); setMissing([]);
    try { show(allIssues.filter(compileJql(jql))); }
    catch (e) { setFound(null); setErr(e instanceof JqlError ? e.message : String(e)); }
  };

  const runKeys = () => {
    setErr("");
    const keys = parseKeys(keysText, project);
    if (!keys.length) { setErr(`Введите номера задач: ${project}-123 или просто 123, через пробел или запятую`); setFound(null); return; }
    setMissing(keys.filter(k => !byKey.has(k)));
    show(keys.map(k => byKey.get(k)).filter((i): i is Issue => !!i));
  };

  const fresh = found?.filter(i => !inList.has(i.key)) ?? [];
  const allOn = fresh.length > 0 && fresh.every(i => picked.has(i.key));
  const toggle = (k: string) => setPicked(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const tabCls = (on: boolean) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors
    ${on ? "bg-primary/10 text-primary font-medium" : "text-text-muted hover:text-text-main"}`;
  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono";

  return (
    <Modal open={open} onClose={onClose} title="Добавить задачи в список" size="max-w-4xl">
      <div className="space-y-3">
        <div className="flex gap-1" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "jql"} onClick={() => { setTab("jql"); setFound(null); setErr(""); }}
            className={tabCls(tab === "jql")}><Search className="w-4 h-4" /> JQL-фильтр</button>
          <button type="button" role="tab" aria-selected={tab === "keys"} onClick={() => { setTab("keys"); setFound(null); setErr(""); }}
            className={tabCls(tab === "keys")}><Hash className="w-4 h-4" /> По номеру</button>
        </div>

        {tab === "jql" ? (
          <div className="space-y-2">
            <textarea value={jql} onChange={e => setJql(e.target.value)} rows={3} autoFocus
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runJql(); }}
              placeholder={`project = ${project} AND issuetype = Дефект AND status = "Открыт"`} aria-label="JQL-запрос" className={field} />
            <div className="flex flex-wrap gap-1.5">
              {jqlExamples(project).map(x => (
                <button key={x} type="button" onClick={() => setJql(x)}
                  className="text-[11px] px-2 py-1 rounded-md bg-bg-subtle text-text-muted hover:text-primary font-mono truncate max-w-full">
                  {x}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={runJql}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90">Найти</button>
              <span className="text-xs text-text-muted">⌘/Ctrl + Enter. Пустой запрос — все задачи.</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea value={keysText} onChange={e => setKeysText(e.target.value)} rows={2} autoFocus
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runKeys(); } }}
              placeholder={`${project}-123, 124 125 — голый номер берётся из проекта «${projectOf(project).name}»`} aria-label="Номера задач" className={field} />
            <button type="button" onClick={runKeys}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90">Найти</button>
          </div>
        )}

        {err && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">{err}</p>}
        {missing.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">Не найдены: {missing.join(", ")}</p>
        )}

        {found && (
          <div className="border border-border-main rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2 bg-bg-subtle text-xs text-text-muted">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allOn} disabled={!fresh.length}
                  onChange={() => setPicked(allOn ? new Set() : new Set(fresh.map(i => i.key)))} />
                Найдено: {found.length}{found.length - fresh.length > 0 && ` · уже в списке: ${found.length - fresh.length}`}
              </label>
            </div>
            <div className="max-h-80 overflow-y-auto scrollbar-thin divide-y divide-border-main">
              {found.length === 0 && <p className="text-sm text-text-muted p-4">Ничего не нашлось.</p>}
              {found.map(i => {
                const already = inList.has(i.key);
                return (
                  <label key={i.key} className={`flex items-center gap-3 px-3 py-2 text-sm ${already ? "opacity-50" : "cursor-pointer hover:bg-bg-subtle"}`}>
                    <input type="checkbox" disabled={already} checked={already || picked.has(i.key)} onChange={() => toggle(i.key)} />
                    <span className="font-mono text-xs text-primary w-28 flex-shrink-0">{i.key}</span>
                    <span className="truncate flex-1 text-text-main">{String(i.fields.summary ?? "")}</span>
                    <span className="text-xs text-text-muted flex-shrink-0">{String(i.fields.issuetype ?? "")}</span>
                    <span className="text-xs text-text-muted w-36 truncate flex-shrink-0">{String(i.fields.status ?? "")}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Закрыть</button>
          <button type="button" disabled={!picked.size}
            onClick={() => { onAdd([...picked]); onClose(); }}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
            Добавить{picked.size ? ` (${picked.size})` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
