"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import Floating from "@/components/jiratool/Floating";
import type { ReqFolder, Requirement } from "@/lib/api";

const STEP = 14;                          // сдвиг вложенного узла, px
const OPEN_KEY = "st_data_tree_open";     // раскрытые папки — удобство одного браузера

type Drag = { kind: "doc" | "folder"; id: string } | null;

function readOpen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]")); } catch { return new Set(); }
}

/** Поле имени папки прямо в дереве: Enter — сохранить, Esc или уход фокуса — отмена. */
function NameInput({ initial, depth, onDone }: { initial: string; depth: number; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex items-center gap-1.5 py-0.5 pr-2" style={{ paddingLeft: 8 + depth * STEP + 18 }}>
      <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />
      <input autoFocus value={v} onChange={e => setV(e.target.value)} aria-label="Имя папки" placeholder="Имя папки, Enter"
        onKeyDown={e => { if (e.key === "Enter") onDone(v.trim() || null); if (e.key === "Escape") onDone(null); }}
        onBlur={() => onDone(null)}
        className="min-w-0 flex-1 text-sm px-1.5 py-0.5 rounded border border-primary/50 bg-[var(--color-input-bg)] text-text-main focus:outline-none" />
    </div>
  );
}

/**
 * Дерево документов «Данных», как страницы в Notion: папки любой вложенности, в них документы.
 * У папки при наведении — «+» (документ в эту папку) и «⋯» (документ, подпапка, переименовать, удалить).
 * Документ и папку можно перетащить на другую папку или на заголовок «Документы» (в корень).
 */
export default function DocTree({
  folders, docs, selected, onSelect, onNewDoc, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveDoc, onMoveFolder,
}: {
  folders: ReqFolder[];
  docs: Requirement[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNewDoc: (folderId: string) => void;
  onCreateFolder: (name: string, parentId: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (f: ReqFolder) => void;
  onMoveDoc: (docId: string, folderId: string) => void;
  onMoveFolder: (id: string, parentId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { setOpen(readOpen()); }, []);
  const toggle = (id: string, to?: boolean) => setOpen(o => {
    const n = new Set(o);
    if (to ?? !n.has(id)) n.add(id); else n.delete(id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])); } catch { /* приватный режим */ }
    return n;
  });

  const [edit, setEdit] = useState<{ mode: "new"; parent: string } | { mode: "rename"; id: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);   // id папки под курсором, "" — корень

  const ids = useMemo(() => new Set(folders.map(f => f.id)), [folders]);
  // Папка или документ со ссылкой на исчезнувшую папку — в корне, а не потерян.
  const parentOf = (f: ReqFolder) => (f.parent_id && ids.has(f.parent_id) ? f.parent_id : "");
  const folderOf = (d: Requirement) => (d.folder_id && ids.has(d.folder_id) ? d.folder_id : "");
  const kids = useMemo(() => {
    const m = new Map<string, ReqFolder[]>();
    for (const f of [...folders].sort((a, b) => a.name.localeCompare(b.name, "ru"))) { const p = parentOf(f); m.set(p, [...(m.get(p) ?? []), f]); }
    return m;
  }, [folders, ids]);   // eslint-disable-line react-hooks/exhaustive-deps
  const docsIn = useMemo(() => {
    const m = new Map<string, Requirement[]>();
    for (const d of [...docs].sort((a, b) => a.name.localeCompare(b.name, "ru"))) { const f = folderOf(d); m.set(f, [...(m.get(f) ?? []), d]); }
    return m;
  }, [docs, ids]);      // eslint-disable-line react-hooks/exhaustive-deps

  // Поиск: документы, где строка есть в названии или фиче, и папки по пути к ним (раскрыты).
  const s = q.trim().toLowerCase();
  const found = useMemo(() => {
    if (!s) return null;
    const docOk = new Set(docs.filter(d => d.name.toLowerCase().includes(s) || d.feature.toLowerCase().includes(s)).map(d => d.id));
    const keep = new Set<string>();
    const walk = (id: string): boolean => {
      const f = folders.find(x => x.id === id)!;
      const sub = (kids.get(id) ?? []).map(c => walk(c.id)).some(Boolean);
      const hit = sub || f.name.toLowerCase().includes(s) || (docsIn.get(id) ?? []).some(d => docOk.has(d.id));
      if (hit) keep.add(id);
      return hit;
    };
    (kids.get("") ?? []).forEach(f => walk(f.id));
    return { docOk, keep };
  }, [s, docs, folders, kids, docsIn]);

  const count = (id: string): number => (docsIn.get(id)?.length ?? 0) + (kids.get(id) ?? []).reduce((n, c) => n + count(c.id), 0);
  const inside = (id: string, target: string): boolean => {   // target — сама папка id или вложенная в неё
    for (let cur: string = target; cur; cur = parentOf(folders.find(f => f.id === cur)!)) if (cur === id) return true;
    return false;
  };

  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag || (drag.kind === "folder" && inside(drag.id, target))) return;
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: () => setOver(o => (o === target ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      if (!drag) return;
      if (drag.kind === "doc") onMoveDoc(drag.id, target);
      else if (!inside(drag.id, target)) onMoveFolder(drag.id, target);
      if (target) toggle(target, true);
      setDrag(null);
    },
  });

  const rowCls = "group flex items-center gap-1.5 rounded-md pr-1 py-[3px] text-sm cursor-pointer select-none";
  const iconBtn = "w-5 h-5 flex items-center justify-center rounded text-text-muted hover:bg-bg-muted hover:text-text-main";
  const menuItem = (Icon: typeof Plus, label: string, fn: () => void, danger = false) => (
    <button type="button" role="menuitem" onClick={() => { setMenu(null); fn(); }}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-left ${danger
        ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40" : "text-text-main hover:bg-bg-subtle"}`}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );

  const docRow = (d: Requirement, depth: number) => {
    if (found && !found.docOk.has(d.id)) return null;
    const on = selected === d.id;
    return (
      <div key={d.id} role="treeitem" aria-selected={on} draggable
        onDragStart={() => setDrag({ kind: "doc", id: d.id })} onDragEnd={() => { setDrag(null); setOver(null); }}
        onClick={() => onSelect(d.id)} title={d.feature ? `${d.name} · ${d.feature}` : d.name}
        className={`${rowCls} ${on ? "bg-primary/10 text-primary font-medium" : "text-text-main hover:bg-bg-subtle"}`}
        style={{ paddingLeft: 8 + depth * STEP + 18 }}>
        <FileText className={`w-4 h-4 flex-shrink-0 ${on ? "text-primary" : "text-text-muted"}`} />
        <span className="truncate flex-1">{d.name}</span>
        {d.qa_doc && <span className="w-1.5 h-1.5 mr-1 rounded-full bg-emerald-500 flex-shrink-0" title="Документ QA готов" />}
      </div>
    );
  };

  const folderRow = (f: ReqFolder, depth: number): React.ReactNode => {
    if (found && !found.keep.has(f.id)) return null;
    const isOpen = !!found || open.has(f.id);
    if (edit?.mode === "rename" && edit.id === f.id) {
      return <NameInput key={f.id} initial={f.name} depth={depth}
        onDone={name => { setEdit(null); if (name && name !== f.name) void onRenameFolder(f.id, name); }} />;
    }
    return (
      <div key={f.id} role="treeitem" aria-expanded={isOpen}>
        <div draggable onDragStart={() => setDrag({ kind: "folder", id: f.id })} onDragEnd={() => { setDrag(null); setOver(null); }}
          {...dropProps(f.id)} onClick={() => toggle(f.id)}
          className={`${rowCls} text-text-main hover:bg-bg-subtle ${over === f.id ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
          style={{ paddingLeft: 8 + depth * STEP }}>
          <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 text-text-muted transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
          {isOpen ? <FolderOpen className="w-4 h-4 flex-shrink-0 text-amber-500" /> : <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />}
          <span className="truncate flex-1">{f.name}</span>
          <span className="text-[11px] text-text-muted group-hover:hidden">{count(f.id) || ""}</span>
          <span className="hidden group-hover:flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
            <button type="button" className={iconBtn} title="Новый документ в папке" aria-label={`Новый документ в ${f.name}`}
              onClick={() => { toggle(f.id, true); onNewDoc(f.id); }}><Plus className="w-3.5 h-3.5" /></button>
            <button type="button" className={iconBtn} title="Ещё" aria-label={`Действия с папкой ${f.name}`} aria-haspopup="menu"
              ref={el => { if (menu === f.id) menuBtn.current = el; }}
              onClick={e => { menuBtn.current = e.currentTarget; setMenu(m => (m === f.id ? null : f.id)); }}>
              <MoreHorizontal className="w-3.5 h-3.5" /></button>
          </span>
        </div>
        {menu === f.id && (
          <Floating anchor={menuBtn} onClose={() => setMenu(null)} width={210} role="menu" ariaLabel={`Папка ${f.name}`} className="p-1">
            {menuItem(FilePlus2, "Новый документ", () => { toggle(f.id, true); onNewDoc(f.id); })}
            {menuItem(FolderPlus, "Новая подпапка", () => { toggle(f.id, true); setEdit({ mode: "new", parent: f.id }); })}
            {menuItem(Pencil, "Переименовать", () => setEdit({ mode: "rename", id: f.id }))}
            {menuItem(Trash2, "Удалить папку…", () => onDeleteFolder(f), true)}
          </Floating>
        )}
        {isOpen && (
          <div role="group">
            {(kids.get(f.id) ?? []).map(c => folderRow(c, depth + 1))}
            {edit?.mode === "new" && edit.parent === f.id && (
              <NameInput initial="" depth={depth + 1}
                onDone={name => { setEdit(null); if (name) void onCreateFolder(name, f.id); }} />
            )}
            {(docsIn.get(f.id) ?? []).map(d => docRow(d, depth + 1))}
            {!found && !kids.get(f.id)?.length && !docsIn.get(f.id)?.length && !(edit?.mode === "new" && edit.parent === f.id) && (
              <p className="py-[3px] text-xs text-text-muted/70" style={{ paddingLeft: 8 + (depth + 1) * STEP + 18 }}>Пусто</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0">
      <div {...dropProps("")}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-md ${over === "" ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Документы</span>
        <button type="button" className={iconBtn} title="Новый документ" aria-label="Новый документ в корне" onClick={() => onNewDoc("")}>
          <FilePlus2 className="w-3.5 h-3.5" /></button>
        <button type="button" className={iconBtn} title="Новая папка" aria-label="Новая папка в корне" onClick={() => setEdit({ mode: "new", parent: "" })}>
          <FolderPlus className="w-3.5 h-3.5" /></button>
      </div>
      <div className="relative px-1 pb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-[calc(50%+4px)] w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти документ" aria-label="Найти документ"
          className="w-full text-sm pl-7 pr-7 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Очистить поиск"
            className="absolute right-2.5 top-1/2 -translate-y-[calc(50%+4px)] text-text-muted hover:text-text-main"><X className="w-3.5 h-3.5" /></button>
        )}
      </div>
      <div role="tree" aria-label="Документы" className="min-h-0 overflow-y-auto scrollbar-thin pb-2">
        {edit?.mode === "new" && edit.parent === "" && (
          <NameInput initial="" depth={0} onDone={name => { setEdit(null); if (name) void onCreateFolder(name, ""); }} />
        )}
        {(kids.get("") ?? []).map(f => folderRow(f, 0))}
        {(docsIn.get("") ?? []).map(d => docRow(d, 0))}
        {found && !found.keep.size && !found.docOk.size && <p className="px-3 py-2 text-xs text-text-muted">Ничего не найдено</p>}
        {!found && !folders.length && !docs.length && (
          <p className="px-3 py-2 text-xs text-text-muted">Пока пусто — создайте папку или документ кнопками выше.</p>
        )}
      </div>
    </div>
  );
}
