"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Layers, MoreHorizontal, Pencil, Search, Sparkles, X } from "lucide-react";
import Floating from "@/components/jiratool/Floating";
import { DRAG_CASES, type ZFolder } from "@/lib/zephyrApi";
import { isInside, type Parent, type Staging, type StagedCase, type StagedFolder } from "@/lib/zephyrStaging";

const STEP = 16;   // сдвиг дочернего узла относительно родителя, px

/** Что тянут внутри дерева: новый кейс/папку черновика или существующую папку. Кейсы из списка — через dataTransfer. */
type Drag = { kind: "case" | "folder" | "zfolder"; id: string } | null;
type DropKey = string;   // "e:<path>" — папка дерева ("e:" — корень), "n:<id>" — новая папка, "root" — корень черновика

const parentPath = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

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

/** Поле ввода имени папки прямо в дереве: Enter — сохранить, Esc или уход фокуса — отмена. */
function NameInput({ initial, depth, onDone }: { initial: string; depth: number; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft: 4 + depth * STEP + 18 }}>
      <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />
      <input autoFocus value={v} onChange={e => setV(e.target.value)} aria-label="Имя папки" placeholder="Имя папки, Enter"
        onKeyDown={e => { if (e.key === "Enter") onDone(v.trim() || null); if (e.key === "Escape") onDone(null); }}
        onBlur={() => onDone(null)}
        className="min-w-0 flex-1 text-sm px-1.5 py-0.5 rounded border border-primary/50 bg-[var(--color-input-bg)] text-text-main focus:outline-none" />
    </div>
  );
}

/**
 * Дерево проекта тестирования: дочерний узел сдвинут вправо от родителя на STEP, у папок — число кейсов.
 *
 * Правка структуры (сразу в Jira, через обработчики раздела): меню «⋯» у папки — новая подпапка, переименовать,
 * новый кейс; папку можно перетащить в другую папку или на «Все кейсы» (в корень); кейсы из списка справа —
 * перетащить на папку. С черновиком новой модели (staging) сверху — блок «Новая модель»: новые папки и кейсы,
 * их раскладывают перетаскиванием и применяют кнопкой «Применить».
 */
export default function FolderTree({
  folders, selected, onSelect, total, staging, pickedCase, onPickCase, onMoveCase, onMoveFolder,
  onCreateFolder, onRenameFolder, onMoveExisting, onDropCases, onNewCase,
}: {
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
  /** Новая папка: parent "" — в корне проекта. */
  onCreateFolder?: (parent: string, name: string) => void;
  onRenameFolder?: (path: string, name: string) => void;
  /** Существующую папку перетащили в другую (target "" — в корень). */
  onMoveExisting?: (source: string, target: string) => void;
  /** Кейсы из списка бросили на папку. */
  onDropCases?: (keys: string[], folder: string) => void;
  onNewCase?: (folder: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(folders.map(f => f.path)));
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<DropKey | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ mode: "new" | "rename"; path: string } | null>(null);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const s = q.trim().toLowerCase();
  const found = useMemo(() => (s ? match(folders, s) : null), [folders, s]);
  const isOpen = (k: string) => (found && !k.startsWith("n:") ? found.open.has(k) || open.has(k) : open.has(k));
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const editable = !!onCreateFolder;

  const newIn = (p: Parent) => (staging?.folders ?? []).filter(f =>
    p.kind === "root" ? f.parent.kind === "root" : p.kind === "existing" ? f.parent.kind === "existing" && f.parent.path === p.path : f.parent.kind === "new" && f.parent.id === p.id);
  const casesIn = (p: Exclude<Parent, { kind: "root" }>) => (staging?.cases ?? []).filter(c =>
    p.kind === "existing" ? c.target.kind === "existing" && c.target.path === p.path : c.target.kind === "new" && c.target.id === p.id);

  /** Можно ли бросить на этот узел. external — тянут кейсы из списка справа. */
  const canDrop = (key: DropKey, external: boolean): boolean => {
    if (external) return !!onDropCases && key.startsWith("e:") && key !== "e:";
    if (!drag) return false;
    if (drag.kind === "zfolder") {
      if (!key.startsWith("e:")) return false;
      const to = key.slice(2), src = drag.id;
      return to !== src && !to.startsWith(src + "/") && to !== parentPath(src);
    }
    if (!staging || key === "e:") return false;
    if (drag.kind === "case") return key !== "root";
    if (key === `n:${drag.id}`) return false;
    if (key.startsWith("n:") && isInside(staging, key.slice(2), drag.id)) return false;   // в свою же вложенную
    return true;
  };
  const parentOf = (key: DropKey): Parent => (key === "root" ? { kind: "root" } : key.startsWith("e:") ? { kind: "existing", path: key.slice(2) } : { kind: "new", id: key.slice(2) });
  const drop = (key: DropKey, e: React.DragEvent) => {
    const external = e.dataTransfer.types.includes(DRAG_CASES);
    if (!canDrop(key, external)) return;
    if (external) {
      try { onDropCases?.(JSON.parse(e.dataTransfer.getData(DRAG_CASES)) as string[], key.slice(2)); } catch { /* чужие данные */ }
    } else if (drag?.kind === "zfolder") onMoveExisting?.(drag.id, key.slice(2));
    else if (drag) {
      const p = parentOf(key);
      if (drag.kind === "case" && p.kind !== "root") onMoveCase?.(drag.id, p);
      if (drag.kind === "folder") onMoveFolder?.(drag.id, p);
      setOpen(o => new Set(o).add(key === "root" ? "" : key.startsWith("e:") ? key.slice(2) : key));
    }
    setDrag(null); setOver(null);
  };
  /** Свойства цели переноса: подсветка и автораскрытие свёрнутой папки через полсекунды. */
  const dropProps = (key: DropKey, openKey?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop(key, e.dataTransfer.types.includes(DRAG_CASES))) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (over !== key) {
        setOver(key);
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        if (openKey) hoverTimer.current = setTimeout(() => setOpen(o => new Set(o).add(openKey)), 500);
      }
    },
    onDragLeave: () => { if (over === key) setOver(null); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(key, e); },
  });
  const dragProps = (d: NonNullable<Drag>) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", d.id); setDrag(d); },
    onDragEnd: () => { setDrag(null); setOver(null); },
  });

  const row = (on: boolean, key: DropKey, extra = "") =>
    `group flex items-center gap-1 pr-1 py-1 rounded-md cursor-pointer text-sm ${extra}
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
        className={`${row(pickedCase === c.id, `c:${c.id}`)} cursor-grab text-text-main`} style={{ paddingLeft: 4 + depth * STEP + 18 }}>
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
          className={`${row(false, k, "border border-dashed border-violet-400/60 bg-violet-500/5")} cursor-grab text-text-main`}
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

  const menuItem = (Icon: typeof Pencil, label: string, act: () => void) => (
    <button type="button" role="menuitem" onClick={() => { setMenu(null); act(); }}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-left text-text-main hover:bg-bg-subtle">
      <Icon className="w-3.5 h-3.5 text-text-muted" /> {label}
    </button>
  );

  const node = (f: ZFolder, depth: number): React.ReactNode => {
    if (found && !found.keep.has(f.path)) return null;
    const k = `e:${f.path}`;
    const on = selected === f.path;
    const nf = newIn({ kind: "existing", path: f.path });
    const cs = casesIn({ kind: "existing", path: f.path });
    const adding = edit?.mode === "new" && edit.path === f.path;
    const has = f.children.length + nf.length + cs.length > 0 || adding;
    const expanded = isOpen(f.path) || adding;
    if (edit?.mode === "rename" && edit.path === f.path) {
      return (
        <li key={f.path}>
          <NameInput initial={f.name} depth={depth} onDone={n => { setEdit(null); if (n && n !== f.name) onRenameFolder?.(f.path, n); }} />
        </li>
      );
    }
    return (
      <li key={f.path} role="treeitem" aria-expanded={has ? expanded : undefined} aria-selected={on}>
        <div {...(editable ? dragProps({ kind: "zfolder", id: f.path }) : {})} {...dropProps(k, f.path)}
          className={`${row(on, k)} ${on ? "" : "text-text-main"}`}
          style={{ paddingLeft: 4 + depth * STEP }} onClick={() => onSelect(f.path)} title={f.path}>
          {chevron(f.path, has, f.name)}
          {expanded && has ? <FolderOpen className="w-4 h-4 flex-shrink-0 text-amber-500" /> : <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />}
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {nf.length + cs.length > 0 && <span className="text-[10px] px-1 rounded bg-violet-500/15 text-violet-600 dark:text-violet-300">+{nf.length + cs.length}</span>}
          {f.count > 0 && <span className="text-[11px] text-text-muted tabular-nums">{f.count}</span>}
          {editable && (
            <button type="button" aria-label={`Действия с папкой ${f.name}`} aria-haspopup="menu" aria-expanded={menu === f.path}
              onClick={e => { e.stopPropagation(); menuBtn.current = e.currentTarget; setMenu(m => (m === f.path ? null : f.path)); }}
              className={`p-0.5 rounded text-text-muted hover:text-text-main hover:bg-bg-card ${menu === f.path ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
          )}
        </div>
        {menu === f.path && menuBtn.current && (
          <Floating anchor={menuBtn} onClose={() => setMenu(null)} width={200} role="menu" ariaLabel={`Папка ${f.name}`} className="p-1">
            {menuItem(FolderPlus, "Новая подпапка", () => { setOpen(o => new Set(o).add(f.path)); setEdit({ mode: "new", path: f.path }); })}
            {menuItem(Pencil, "Переименовать", () => setEdit({ mode: "rename", path: f.path }))}
            {onNewCase && menuItem(FilePlus2, "Новый кейс здесь", () => onNewCase(f.path))}
          </Floating>
        )}
        {has && expanded && (
          <ul role="group">
            {adding && <li><NameInput initial="" depth={depth + 1} onDone={n => { setEdit(null); if (n) onCreateFolder?.(f.path, n); }} /></li>}
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
        <div {...dropProps("e:")} className={`group flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-sm
            ${over === "e:" ? "ring-2 ring-primary bg-primary/10" : selected === "" ? "bg-primary/10 text-primary font-medium" : "text-text-main hover:bg-bg-subtle"}`}
          onClick={() => onSelect("")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onSelect("")}
          title={editable ? "Все кейсы. Бросьте сюда папку — она переедет в корень проекта" : "Все кейсы"}>
          <Layers className="w-4 h-4 text-text-muted" />
          <span className="flex-1">Все кейсы</span>
          {total ? <span className="text-[11px] text-text-muted tabular-nums">{total}</span> : null}
          {editable && (
            <button type="button" onClick={e => { e.stopPropagation(); setEdit({ mode: "new", path: "" }); }} title="Новая папка в корне проекта"
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs text-primary hover:bg-primary/10">
              <FolderPlus className="w-3.5 h-3.5" /> папка</button>
          )}
        </div>
        <ul role="tree" aria-label="Папки кейсов" className="mt-0.5">
          {edit?.mode === "new" && edit.path === "" && <li><NameInput initial="" depth={0} onDone={n => { setEdit(null); if (n) onCreateFolder?.("", n); }} /></li>}
          {folders.map(f => node(f, 0))}
          {found && found.keep.size === 0 && <li className="px-2 py-2 text-xs text-text-muted">Папок не найдено.</li>}
        </ul>
      </div>
    </div>
  );
}
