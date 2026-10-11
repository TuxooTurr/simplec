"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Folder, FolderTree, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { STRUCTURES, flattenStructure, type StructNode, type StructureDef } from "@/lib/jiraTool";

export interface StructureImport {
  structure: StructureDef;
  items: { key: string; folder: string; parent?: string }[];
  target: "current" | "new";
}

function countIssues(nodes: StructNode[]): number {
  return nodes.reduce((n, x) => n + (x.key ? 1 : 0) + countIssues(x.children ?? []), 0);
}

/** Предпросмотр: только папки с числом задач — задач может быть сотни. */
function FolderTree_({ nodes, depth = 0 }: { nodes: StructNode[]; depth?: number }) {
  const [open, setOpen] = useState<Set<number>>(new Set(depth === 0 ? nodes.map((_, i) => i) : []));
  const folders = nodes.map((n, i) => ({ n, i })).filter(x => x.n.folder);
  const loose = nodes.filter(n => n.key).length;
  return (
    <ul className="space-y-0.5">
      {folders.map(({ n, i }) => {
        const sub = (n.children ?? []).some(c => c.folder);
        return (
          <li key={i}>
            <button type="button" onClick={() => setOpen(s => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x; })}
              className="flex items-center gap-1.5 text-sm text-text-main py-0.5" style={{ paddingLeft: depth * 16 }}>
              <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition-transform ${sub ? "" : "invisible"} ${open.has(i) ? "rotate-90" : ""}`} />
              <Folder className="w-3.5 h-3.5 text-amber-500" />
              {n.folder}
              <span className="text-[11px] text-text-muted">· задач: {countIssues(n.children ?? [])}</span>
            </button>
            {sub && open.has(i) && <FolderTree_ nodes={n.children ?? []} depth={depth + 1} />}
          </li>
        );
      })}
      {depth === 0 && loose > 0 && <li className="text-xs text-text-muted pl-5">Задач без папки: {loose}</li>}
    </ul>
  );
}

/**
 * Импорт структуры (плагин Structure в Jira): все задачи с папками попадают в список,
 * папка становится колонкой «Папка структуры» и первым уровнем группировки.
 */
export default function ImportStructureModal({ open, listName, onImport, onClose }: {
  open: boolean;
  listName: string;
  onImport: (imp: StructureImport) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<StructureDef | null>(null);
  const [target, setTarget] = useState<"current" | "new">("new");

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return STRUCTURES.filter(x => !s || x.name.toLowerCase().includes(s) || String(x.id) === s);
  }, [q]);
  const items = picked ? flattenStructure(picked.root) : [];

  return (
    <Modal open={open} onClose={onClose} title="Импорт структуры" size="max-w-3xl">
      <div className="space-y-4">
        <label className="flex items-center gap-2 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-3 py-2
          focus-within:ring-2 focus-within:ring-primary/30">
          <Search className="w-4 h-4 text-text-muted" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Название структуры или её ID"
            aria-label="Найти структуру" className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
        </label>

        <div className="grid grid-cols-[1fr_1.2fr] gap-4">
          <ul className="border border-border-main rounded-xl divide-y divide-border-main max-h-80 overflow-y-auto scrollbar-thin">
            {found.length === 0 && <li className="p-3 text-sm text-text-muted">Структура не найдена.</li>}
            {found.map(st => (
              <li key={st.id}>
                <button type="button" onClick={() => setPicked(st)} aria-pressed={picked?.id === st.id}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${picked?.id === st.id ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                  <span className="flex items-center gap-2 text-sm font-medium text-text-main">
                    <FolderTree className="w-4 h-4 text-primary" /> {st.name}
                  </span>
                  <span className="block text-[11px] text-text-muted mt-0.5 pl-6">
                    ID {st.id} · {st.owner} · задач: {flattenStructure(st.root).length}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border border-border-main rounded-xl p-3 max-h-80 overflow-y-auto scrollbar-thin">
            {picked ? (
              <>
                <p className="text-xs font-semibold text-text-muted mb-2">Папки «{picked.name}» · задач: {items.length}</p>
                <FolderTree_ key={picked.id} nodes={picked.root} />
              </>
            ) : (
              <p className="text-sm text-text-muted">Выберите структуру слева — здесь появятся её папки.</p>
            )}
          </div>
        </div>

        {picked && (
          <fieldset className="flex flex-wrap gap-4 text-sm text-text-main">
            <legend className="sr-only">Куда импортировать</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="imp-target" checked={target === "new"} onChange={() => setTarget("new")} />
              Новый список «{picked.name}»
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="imp-target" checked={target === "current"} onChange={() => setTarget("current")} />
              В текущий список «{listName}»
            </label>
          </fieldset>
        )}

        <div className="flex items-center gap-2 pt-1">
          <p className="text-[11px] text-text-muted min-w-0">Демо: структуры из мок-Jira. Папка станет колонкой и первым уровнем группировки.</p>
          <div className="ml-auto flex gap-2 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={!picked}
              onClick={() => { if (picked) { onImport({ structure: picked, items, target }); onClose(); } }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 whitespace-nowrap">
              Импортировать {items.length || ""}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
