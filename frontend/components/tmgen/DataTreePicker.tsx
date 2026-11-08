"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, FileText, Folder, FolderOpen, Search } from "lucide-react";
import type { ReqFolder, Requirement } from "@/lib/api";

const STEP = 14;

/**
 * Дерево «Данных» для генерации: в режиме "docs" отмечаются документы (галочками, можно несколько),
 * в режиме "folder" выбирается одна папка — место набора в модели. Без перетаскивания и правки:
 * само дерево правится в разделе «Данные».
 */
export default function DataTreePicker({ folders, docs = [], mode, selectedDocs, onToggleDoc, selectedFolder, onPickFolder, maxH = "max-h-[340px]" }: {
  folders: ReqFolder[];
  docs?: Requirement[];
  mode: "docs" | "folder";
  selectedDocs?: Set<string>;
  onToggleDoc?: (d: Requirement) => void;
  selectedFolder?: string;
  onPickFolder?: (f: ReqFolder) => void;
  maxH?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const ids = useMemo(() => new Set(folders.map(f => f.id)), [folders]);
  const kids = useMemo(() => {
    const m = new Map<string, ReqFolder[]>();
    for (const f of [...folders].sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
      const p = f.parent_id && ids.has(f.parent_id) ? f.parent_id : "";
      m.set(p, [...(m.get(p) ?? []), f]);
    }
    return m;
  }, [folders, ids]);
  const docsIn = useMemo(() => {
    const m = new Map<string, Requirement[]>();
    for (const d of [...docs].sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
      const f = d.folder_id && ids.has(d.folder_id) ? d.folder_id : "";
      m.set(f, [...(m.get(f) ?? []), d]);
    }
    return m;
  }, [docs, ids]);

  // Поиск: показываем совпавшие документы (или папки) и их родителей раскрытыми.
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return null;
    const keep = new Set<string>();
    const byId = new Map(folders.map(f => [f.id, f]));
    const up = (id: string) => { for (let c = byId.get(id); c && !keep.has(c.id); c = byId.get(c.parent_id)) keep.add(c.id); };
    if (mode === "docs") docs.filter(d => d.name.toLowerCase().includes(needle)).forEach(d => { keep.add(`doc:${d.id}`); if (d.folder_id) up(d.folder_id); });
    else folders.filter(f => f.name.toLowerCase().includes(needle)).forEach(f => up(f.id));
    return keep;
  }, [needle, folders, docs, mode]);

  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const countDocs = (id: string): number => (docsIn.get(id)?.length ?? 0) + (kids.get(id) ?? []).reduce((n, k) => n + countDocs(k.id), 0);

  const renderFolder = (f: ReqFolder, depth: number): React.ReactNode => {
    if (visible && !visible.has(f.id)) return null;
    if (mode === "docs" && !countDocs(f.id)) return null;      // пустые ветки не мешают искать документ
    const isOpen = !!visible || open.has(f.id);
    const picked = mode === "folder" && selectedFolder === f.id;
    return (
      <li key={f.id}>
        <div className={`group flex items-center gap-1 rounded-md py-0.5 pr-2 text-sm ${picked ? "bg-primary/10 text-primary" : "text-text-main hover:bg-bg-subtle"}`}
          style={{ paddingLeft: 4 + depth * STEP }}>
          <button type="button" onClick={() => toggle(f.id)} aria-label={isOpen ? `Свернуть ${f.name}` : `Раскрыть ${f.name}`}
            className={`rounded p-0.5 text-text-muted ${(kids.get(f.id)?.length || (mode === "docs" && docsIn.get(f.id)?.length)) ? "" : "invisible"}`}>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </button>
          <button type="button" onClick={() => (mode === "folder" ? onPickFolder?.(f) : toggle(f.id))}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {isOpen ? <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />}
            <span className="truncate">{f.name}</span>
            {mode === "docs" && <span className="ml-auto flex-shrink-0 text-[11px] text-text-muted">{countDocs(f.id)}</span>}
            {picked && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
          </button>
        </div>
        {isOpen && (
          <ul>
            {(kids.get(f.id) ?? []).map(k => renderFolder(k, depth + 1))}
            {mode === "docs" && (docsIn.get(f.id) ?? []).map(d => renderDoc(d, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const renderDoc = (d: Requirement, depth: number): React.ReactNode => {
    if (visible && !visible.has(`doc:${d.id}`)) return null;
    const on = !!selectedDocs?.has(d.id);
    return (
      <li key={d.id}>
        <label className={`flex cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-2 text-sm ${on ? "bg-primary/10" : "hover:bg-bg-subtle"}`}
          style={{ paddingLeft: 4 + depth * STEP + 18 }}>
          <input type="checkbox" checked={on} onChange={() => onToggleDoc?.(d)} aria-label={`Выбрать документ ${d.name}`} />
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
          <span className="truncate text-text-main">{d.name}</span>
          {!(d.text || d.qa_doc) && <span className="ml-auto flex-shrink-0 text-[11px] text-text-muted">пустой</span>}
        </label>
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-border-main">
      <div className="relative border-b border-border-main">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={mode === "docs" ? "Найти документ" : "Найти папку"}
          aria-label={mode === "docs" ? "Найти документ" : "Найти папку"}
          className="w-full rounded-t-lg bg-transparent py-1.5 pl-8 pr-2 text-sm text-text-main focus:outline-none" />
      </div>
      <ul className={`${maxH} overflow-y-auto p-1 scrollbar-thin`}>
        {(kids.get("") ?? []).map(f => renderFolder(f, 0))}
        {mode === "docs" && (docsIn.get("") ?? []).map(d => renderDoc(d, 0))}
        {mode === "docs" && !docs.length && <li className="p-3 text-center text-xs text-text-muted">В «Данных» нет документов</li>}
      </ul>
    </div>
  );
}
