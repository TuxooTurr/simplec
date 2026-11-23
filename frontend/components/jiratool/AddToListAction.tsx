"use client";
import { useRef, useState } from "react";
import { Check, ListPlus } from "lucide-react";
import Floating from "./Floating";
import { IconAction } from "./IssueActions";
import { liveLists, loadState, saveState, type Issue } from "@/lib/jiraTool";
import { issueCache, persistCache } from "@/lib/jiraToolCache";

/**
 * «Добавить в список» — задача попадает в выбранный список Jira tool этого браузера (в конец, без папки) и в кэш
 * задач, чтобы список сразу её показал. Уже добавленная отмечена галочкой.
 */
export default function AddToListAction({ issue }: { issue: Issue }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const lists = open ? liveLists(loadState()) : [];
  const add = (id: string) => {
    const s = loadState();
    const list = s.lists.find(l => l.id === id);
    if (!list) return;
    if (!list.keys.includes(issue.key)) {
      saveState({ ...s, lists: s.lists.map(l => (l.id === id ? { ...l, keys: [...l.keys, issue.key] } : l)) });
      const cache = issueCache();
      cache.issues[issue.key] = issue;
      persistCache();
    }
    setNote(`В списке «${list.name}»`); setOpen(false);
    setTimeout(() => setNote(""), 3000);
  };
  return (
    <span ref={anchor} className="inline-flex items-center gap-2">
      <IconAction icon={<ListPlus className="w-4 h-4" />} label="Добавить в список" disabled={issue.local} onClick={() => setOpen(o => !o)} />
      {note && <span role="status" className="text-[11px] tone-success-text whitespace-nowrap">{note}</span>}
      {open && (
        <Floating anchor={anchor} onClose={() => setOpen(false)} width={280} role="menu" ariaLabel="Списки Jira tool" className="p-1">
          {!lists.length && <p className="px-2.5 py-2 text-xs text-text-muted">Списков Jira tool в этом браузере нет. Создайте список в Jira tool.</p>}
          {lists.map(l => {
            const has = l.keys.includes(issue.key);
            return (
              <button key={l.id} type="button" role="menuitem" disabled={has} onClick={() => add(l.id)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-left hover:bg-bg-subtle disabled:opacity-60 disabled:hover:bg-transparent">
                <span className="truncate flex-1">{l.name}</span>
                {has ? <Check className="w-3.5 h-3.5 text-green-600" aria-label="Уже в списке" /> : <span className="text-[11px] text-text-muted">{l.keys.length}</span>}
              </button>
            );
          })}
        </Floating>
      )}
    </span>
  );
}
