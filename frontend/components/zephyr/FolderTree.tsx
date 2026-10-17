"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, FolderPlus, Layers, Search, Sparkles, X } from "lucide-react";
import type { ZFolder } from "@/lib/zephyrApi";
import { isInside, type Parent, type Staging, type StagedCase, type StagedFolder } from "@/lib/zephyrStaging";

const STEP = 16;   // сдвиг дочернего узла относительно родителя, px

type Drag = { kind: "case" | "folder"; id: string } | null;
type DropKey = string;   // "e:<path>" — папка дерева, "n:<id>" — новая папка, "root" — корень

/** Папки, у которых в названии есть строка (или у потомков) — и пути, которые нужно раскрыть, чтобы их увидеть. */
function match(nodes: ZFolder[], s: string): { keep: Set<string>; open: Set<string> } {
  const keep = new Set<string>(), open = new Set<string>();
  const walk = (n: ZFolder): boolean => {
    const kids = n.children.map(walk).some(Boolean);
    const self = n.name.toLowerCase().includes(s);
    if (self || kids) keep.add(n.path);
    if (kids) open.add(n.path);
    return self || kids;
  };
  nodes.forEach(walk);
  return { keep, open };
}

/**
 * Дерево проекта тестирования: дочерний узел сдвинут вправо от родителя на STEP, у папок — число кейсов.
 *
 * С черновиком новой модели (staging) сверху — блок «Новая модель»: новые папки и кейсы, выделенные цветом.
 * Перетаскиванием: кейс — в любую папку (старую или новую); новую папку — внутрь папки дерева, другой новой папки
 * или обратно в корень (на заголовок блока). Во время переноса свёрнутая папка раскрывается при наведении.
 */
export default function FolderTree({ folders, selected, onSelect, total, staging, pickedCase, onPickCase, onMoveCase, onMoveFolder }: {
  folders: ZFolder[];
  /** Путь выбранной папки; "" — все кейсы. */
  selected: string;
  onSelect: (path: string) => void;
  total?: number;
  staging?: Staging | null;
  pickedCase?: string | null;
  onPickCase?: (id: string) => void;
  onMoveCase?: (id: string, target: Exclude<Parent, { kind: "root" }>) => void;
  onMoveFolder?: (id: string, parent: Parent) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(folders.map(f => f.path)));
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<DropKey | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const s = q.trim().toLowerCase();
  const found = useMemo(() => (s ? match(folders, s) : null), [folders, s]);
  const isOpen = (k: string) => (found && !k.startsWith("n:") ? found.open.has(k) || open.has(k) : open.has(k));
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const newIn = (p: Parent) => (staging?.folders ?? []).filter(f =>
    p.kind === "root" ? f.parent.kind === "root" : p.kind === "existing" ? f.parent.kind === "existing" && f.parent.path === p.path : f.parent.kind === "new" && f.parent.id === p.id);
  const casesIn = (p: Exclude<Parent, { kind: "root" }>) => (staging?.cases ?? []).filter(c =>
    p.kind === "existing" ? c.target.kind === "existing" && c.target.path === p.path : c.target.kind === "new" && c.target.id === p.id);

  /** Можно ли бросить то, что тянут, на этот узел. */
  const canDrop = (key: DropKey): boolean => {
    if (!drag || !staging) return false;
    if (drag.kind === "case") return key !== "root";
    if (key === `n:${drag.id}`) return false;
    if (key.startsWith("n:") && isInside(staging, key.slice(2), drag.id)) return false;   // в свою же вложенную
    return true;
  };
  const parentOf = (key: DropKey): Parent => (key === "root" ? { kind: "root" } : key.startsWith("e:") ? { kind: "existing", path: key.slice(2) } : { kind: "new", id: key.slice(2) });
  const drop = (key: DropKey) => {
    if (!drag || !canDrop(key)) return;
    const p = parentOf(key);
    if (drag.kind === "case" && p.kind !== "root") onMoveCase?.(drag.id, p);
    if (drag.kind === "folder") onMoveFolder?.(drag.id, p);
    setOpen(o => new Set(o).add(key === "root" ? "" : key.startsWith("e:") ? key.slice(2) : key));
    setDrag(null); setOver(null);
  };
  /** Свойства цели переноса: подсветка и автораскрытие свёрнутой папки через полсекунды. */
  const dropProps = (key: DropKey, openKey?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop(key)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (over !== key) {
        setOver(key);
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        if (openKey) hoverTimer.current = setTimeout(() => setOpen(o => new Set(o).add(openKey)), 500);
      }
    },
    onDragLeave: () => { if (over === key) setOver(null); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(key); },
  });
  const dragProps = (d: NonNullable<Drag>) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", d.id); setDrag(d); },
    onDragEnd: () => { setDrag(null); setOver(null); },
  });

  const row = (on: boolean, depth: number, key: DropKey, extra = "") =>
    `group flex items-center gap-1 pr-2 py-1 rounded-md cursor-pointer text-sm ${extra}
     ${over === key ? "ring-2 ring-primary bg-primary/10" : on ? "bg-primary/10 text-primary font-medium" : "hover:bg-bg-subtle"}`;
  const chevron = (k: string, has: boolean, label: string) => (
    <button type="button" onClick={e => { e.stopPropagation(); toggle(k); }} tabIndex={-1} aria-label={isOpen(k) ? `Свернуть ${label}` : `Развернуть ${label}`}
      className={`p-0.5 rounded text-text-muted hover:text-text-main ${has ? "" : "invisible"}`}>
      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen(k) ? "rotate-90" : ""}`} />
    </button>
  );

  const caseNode = (c: StagedCase, depth: number) => (
    <li key={c.id} role="treeitem" aria-selected={pickedCase === c.id}>
      <div {...dragProps({ kind: "case", id: c.id })} onClick={() => onPickCase?.(c.id)} title={c.error ? `Ошибка: ${c.error}` : "Перетащите в нужную папку"}
        className={`${row(pickedCase === c.id, depth, `c:${c.id}`)} cursor-grab text-text-main`} style={{ paddingLeft: 4 + depth * STEP + 18 }}>
        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${c.error ? "text-red-500" : "text-violet-500"}`} />
        <span className={`min-w-0 flex-1 truncate ${c.error ? "text-red-600 dark:text-red-400" : ""}`}>{c.name}</span>
      </div>
    </li>
  );

  const newNode = (f: StagedFolder, depth: number): React.ReactNode => {
    const k = `n:${f.id}`;
    const kids = newIn({ kind: "new", id: f.id });
    const cs = casesIn({ kind: "new", id: f.id });
    const has = kids.length + cs.length > 0;
    return (
      <li key={f.id} role="treeitem" aria-expanded={has ? isOpen(k) : undefined}>
        <div {...dragProps({ kind: "folder", id: f.id })} {...dropProps(k, k)} onClick={() => toggle(k)}
          className={`${row(false, depth, k, "border border-dashed border-violet-400/60 bg-violet-500/5")} cursor-grab text-text-main`}
          style={{ paddingLeft: 4 + depth * STEP }} title="Новая папка — перетащите в папку дерева или бросьте на неё кейсы">
          {chevron(k, has, f.name)}
          <FolderPlus className="w-4 h-4 flex-shrink-0 text-violet-500" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="text-[10px] px-1 rounded bg-violet-500/15 text-violet-600 dark:text-violet-300">новая</span>
        </div>
        {has && isOpen(k) && (
          <ul role="group">
            {kids.map(x => newNode(x, depth + 1))}
            {cs.map(c => caseNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const node = (f: ZFolder, depth: number): React.ReactNode => {
    if (found && !found.keep.has(f.path)) return null;
    const k = `e:${f.path}`;
    const on = selected === f.path;
    const nf = newIn({ kind: "existing", path: f.path });
    const cs = casesIn({ kind: "existing", path: f.path });
    const has = f.children.length + nf.length + cs.length > 0;
    const expanded = isOpen(f.path);
    return (
      <li key={f.path} role="treeitem" aria-expanded={has ? expanded : undefined} aria-selected={on}>
        <div {...dropProps(k, f.path)} className={`${row(on, depth, k)} ${on ? "" : "text-text-main"}`}
          style={{ paddingLeft: 4 + depth * STEP }} onClick={() => onSelect(f.path)} title={f.path}>
          {chevron(f.path, has, f.name)}
          {expanded && has ? <FolderOpen className="w-4 h-4 flex-shrink-0 text-amber-500" /> : <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />}
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {nf.length + cs.length > 0 && <span className="text-[10px] px-1 rounded bg-violet-500/15 text-violet-600 dark:text-violet-300">+{nf.length + cs.length}</span>}
          {f.count > 0 && <span className="text-[11px] text-text-muted tabular-nums">{f.count}</span>}
        </div>
        {has && expanded && (
          <ul role="group">
            {nf.map(x => newNode(x, depth + 1))}
            {cs.map(c => caseNode(c, depth + 1))}
            {f.children.map(c => node(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const rootNew = newIn({ kind: "root" });

  return (
    <div className="flex flex-col min-h-0 h-full">
      <label className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30">
        <Search className="w-3.5 h-3.5 text-text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти папку" aria-label="Найти папку"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Очистить"><X className="w-3.5 h-3.5 text-text-muted" /></button>}
      </label>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {staging && (
          <div className="mb-2 rounded-lg border border-violet-400/50 bg-violet-500/5 p-1.5">
            <div {...dropProps("root")} className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md text-xs font-semibold text-violet-700 dark:text-violet-300
              ${over === "root" ? "ring-2 ring-primary bg-primary/10" : ""}`} title="Бросьте сюда новую папку — она останется в корне проекта">
              <Sparkles className="w-3.5 h-3.5" /> Новая модель · в корне
            </div>
            {rootNew.length === 0
              ? <p className="px-2 py-1 text-[11px] text-text-muted">Все новые папки разложены по дереву.</p>
              : <ul role="tree" aria-label="Новая модель">{rootNew.map(f => newNode(f, 0))}</ul>}
          </div>
        )}
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-sm ${selected === "" ? "bg-primary/10 text-primary font-medium" : "text-text-main hover:bg-bg-subtle"}`}
          onClick={() => onSelect("")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onSelect("")}>
          <Layers className="w-4 h-4 text-text-muted" />
          <span className="flex-1">Все кейсы</span>
          {total ? <span className="text-[11px] text-text-muted tabular-nums">{total}</span> : null}
        </div>
        <ul role="tree" aria-label="Папки кейсов" className="mt-0.5">
          {folders.map(f => node(f, 0))}
          {found && found.keep.size === 0 && <li className="px-2 py-2 text-xs text-text-muted">Папок не найдено.</li>}
        </ul>
      </div>
    </div>
  );
}
