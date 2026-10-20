"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { FolderTree, GripVertical, LayoutList, Trash2 } from "lucide-react";
import { DRAG_ISSUES } from "@/lib/jiraTool";

export interface ListsNavItem { id: string; name: string; project: string; count: number; structure: boolean }

/** Сколько списков видно без прокрутки — остальные под скролл. */
const VISIBLE = 4;

/**
 * Списки в колонке Jira tool: видно первые 4, остальные — прокруткой. Порядок меняется перетаскиванием
 * (линия показывает, куда встанет список; у края области она сама прокручивается) или Alt+↑/↓ с клавиатуры.
 * На список можно бросить строки таблицы (DRAG_ISSUES) — задачи переедут в него из открытого списка.
 */
export default function ListsNav({ items, activeId, askDeleteId, onOpen, onAskDelete, onConfirmDelete, onCancelDelete, onMove, onDropIssues }: {
  items: ListsNavItem[];
  activeId: string | null;
  askDeleteId: string | null;
  onOpen: (id: string) => void;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onMove: (id: string, target: string, place: "before" | "after") => void;
  onDropIssues: (listId: string, keys: string[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);   // список, на который сейчас бросят задачи
  const issuesDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_ISSUES);

  // Высота — ровно по 4 первым спискам (строки разной высоты: с подписью проекта и без).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const rows = [...el.children] as HTMLElement[];
    setMaxH(rows.length > VISIBLE ? rows[VISIBLE - 1].offsetTop + rows[VISIBLE - 1].offsetHeight - rows[0].offsetTop : undefined);
  }, [items, askDeleteId]);

  const end = () => { dragId.current = null; setDragging(null); setOver(null); };
  const placeOf = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "before" : "after";
  };
  /** У верхнего/нижнего края области — прокрутить, чтобы дотянуть список до скрытых. */
  const autoScroll = (e: React.DragEvent) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientY < r.top + 24) el.scrollTop -= 8;
    else if (e.clientY > r.bottom - 24) el.scrollTop += 8;
  };

  return (
    <div ref={box} role="list" aria-label="Списки"
      onDragOver={e => { if (dragId.current) autoScroll(e); }}
      style={{ maxHeight: maxH }} className="overflow-y-auto scrollbar-thin flex flex-col gap-0.5">
      {items.map((l, i) => askDeleteId === l.id ? (
        <div key={l.id} role="listitem" className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-xs">
          <span className="flex-1 min-w-0 truncate text-text-main">Удалить «{l.name}»?</span>
          <button type="button" onClick={() => onConfirmDelete(l.id)} className="px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold">Да</button>
          <button type="button" onClick={onCancelDelete} className="px-2 py-0.5 rounded-md border border-border-main text-text-muted">Нет</button>
        </div>
      ) : (
        <div key={l.id} role="listitem" draggable={items.length > 1}
          onDragStart={e => {
            e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.name);
            dragId.current = l.id;
            // Подсветку — после начала переноса: Chrome отменяет перенос, если в dragstart меняется страница.
            setTimeout(() => { if (dragId.current === l.id) setDragging(l.id); }, 0);
          }}
          onDragOver={e => {
            if (!dragId.current && issuesDrag(e)) {
              if (l.id === activeId) return;                    // в тот же список — нечего переносить
              e.preventDefault(); e.dataTransfer.dropEffect = "move";
              if (dropOn !== l.id) setDropOn(l.id);
              return;
            }
            if (!dragId.current) return;
            e.preventDefault(); e.dataTransfer.dropEffect = "move";
            const place = placeOf(e);
            if (over?.id !== l.id || over.place !== place) setOver({ id: l.id, place });
          }}
          onDragLeave={e => { if (dropOn === l.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null); }}
          onDrop={e => {
            e.preventDefault();
            if (!dragId.current && issuesDrag(e)) {
              setDropOn(null);
              try { onDropIssues(l.id, JSON.parse(e.dataTransfer.getData(DRAG_ISSUES)) as string[]); } catch { /* чужие данные */ }
              return;
            }
            if (dragId.current && dragId.current !== l.id) onMove(dragId.current, l.id, placeOf(e));
            end();
          }}
          onDragEnd={end}
          className={`group/li relative flex items-center rounded-lg transition-colors
            ${l.id === activeId ? "bg-primary/10" : "hover:bg-bg-subtle"} ${dragging === l.id ? "opacity-40" : ""}
            ${dropOn === l.id ? "ring-2 ring-primary bg-primary/10" : ""}
            ${over?.id === l.id && dragging !== l.id ? (over.place === "before" ? "shadow-[inset_0_2px_0_0_var(--color-primary,#6366f1)]" : "shadow-[inset_0_-2px_0_0_var(--color-primary,#6366f1)]") : ""}`}>
          {items.length > 1 && (
            <GripVertical aria-hidden className="absolute left-0 w-3 h-3.5 text-text-muted opacity-0 group-hover/li:opacity-60 cursor-grab" />
          )}
          <button type="button" onClick={() => onOpen(l.id)} title={items.length > 1 ? "Перетащите, чтобы поменять порядок (или Alt+↑/↓)" : undefined}
            onKeyDown={e => {
              if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              const j = e.key === "ArrowUp" ? i - 1 : i + 1;
              if (j >= 0 && j < items.length) onMove(l.id, items[j].id, e.key === "ArrowUp" ? "before" : "after");
            }}
            className={`flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left text-sm
              ${l.id === activeId ? "text-primary font-medium" : "text-text-main"}`}>
            {l.structure ? <FolderTree className="w-4 h-4 flex-shrink-0" /> : <LayoutList className="w-4 h-4 flex-shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{l.name}</span>
              <span className="block text-[10px] text-text-muted font-normal">{l.project}</span>
            </span>
            <span className="text-[11px] text-text-muted group-hover/li:hidden">{l.count}</span>
          </button>
          <button type="button" onClick={() => onAskDelete(l.id)} aria-label={`Удалить список ${l.name}`} title="Удалить список"
            className="hidden group-hover/li:inline-flex focus-visible:inline-flex p-1.5 mr-1 rounded-md text-text-muted hover:text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
