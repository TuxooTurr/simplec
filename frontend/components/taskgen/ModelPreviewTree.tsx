"use client";

import { useEffect, useState, type DragEvent } from "react";
import { ArrowDownToLine, ChevronRight, Folder, FolderOpen, GripVertical, MoveRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { inModelFolder, type ModelCase, type ModelGroup, type ModelNode } from "@/lib/taskModel";

export type ModelMove =
  | { kind: "cases"; ids: string[]; name: string; paths: string[] }
  | { kind: "folder"; path: string; name: string };

export function acceptsModelMove(source: ModelMove, target: string) {
  if (source.kind === "cases") return source.paths.some(path => path !== target);
  const parent = source.path.slice(0, source.path.lastIndexOf("/"));
  return parent !== target && !inModelFolder(target, source.path);
}

export const modelFolderName = (path: string) => path || "Корень тестовой модели";

type Props = {
  tree: ModelNode[];
  batch: ModelMove | null;
  sent: Record<string, string>;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onSelect: (id: string) => void;
  onToggle: (group: ModelGroup, testCase: ModelCase) => void;
  onMove: (source: ModelMove, destination: string) => void;
  onPickDestination: (source: ModelMove) => void;
  onRemove: (node: ModelNode) => void;
};

type TreeControls = Omit<Props, "tree"> & {
  drag: ModelMove | null;
  hover: string | null;
  setHover: (path: string | null) => void;
  start: (event: DragEvent, source: ModelMove) => void;
  finish: () => void;
};

const folderLeaf = (path: string) => modelFolderName(path.slice(path.lastIndexOf("/") + 1));

function origins(move: ModelMove, full = false) {
  if (move.kind === "folder") return full ? modelFolderName(move.path) : folderLeaf(move.path);
  if (full) return move.paths.map(modelFolderName).join(", ");
  return move.paths.length === 1 ? folderLeaf(move.paths[0]) : `Папки (${move.paths.length})`;
}

export function selectedModelCases(nodes: ModelNode[], selected: ReadonlySet<string>, sent: Props["sent"]): ModelMove | null {
  const cases: { id: string; name: string; path: string }[] = [];
  function collect(node: ModelNode) {
    for (const { c } of node.cases) {
      if (selected.has(c.id) && !sent[c.id]) cases.push({ id: c.id, name: c.name, path: node.path });
    }
    node.children.forEach(collect);
  }
  nodes.forEach(collect);
  if (!cases.length) return null;
  return { kind: "cases", ids: cases.map(c => c.id), name: cases.length === 1 ? cases[0].name : `Кейсы (${cases.length})`,
    paths: [...new Set(cases.map(c => c.path))] };
}

function Node({ node, depth, controls: c }: { node: ModelNode; depth: number; controls: TreeControls }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? (depth === 0 || node.count > 0);
  const folder: ModelMove = { kind: "folder", path: node.path, name: node.name };
  const canMove = !c.disabled && node.canMove;
  const target = !!c.drag && c.hover === node.path;
  const allowed = !!c.drag && !c.disabled && acceptsModelMove(c.drag, node.path);
  const sourceFolder = c.drag?.kind === "folder" && c.drag.path === node.path;
  useEffect(() => {
    if (!target || !allowed || open) return;
    const timer = setTimeout(() => setExpanded(true), 550);
    return () => clearTimeout(timer);
  }, [target, allowed, open]);

  function drop(event: DragEvent) {
    if (!c.drag || !allowed) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(true);
    c.onMove(c.drag, node.path);
    c.finish();
  }

  return <li>
    <div data-drop-state={target ? (allowed ? "target" : "blocked") : undefined}
      className={"relative flex min-h-8 min-w-0 items-center gap-1 border-y border-transparent pr-1 " +
        (target && allowed ? "!border-primary bg-primary/15" : target ? "bg-red-500/10" : sourceFolder ? "bg-primary/10" : "hover:bg-bg-subtle")}
      style={{ paddingLeft: 8 + depth * 14 }}
      onDragOver={event => {
        if (!c.drag) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = allowed ? "move" : "none";
        if (c.hover !== node.path) c.setHover(node.path);
      }}
      onDragLeave={event => {
        if (target && !(event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget))) c.setHover(null);
      }} onDrop={drop}>
      <button type="button" aria-expanded={open} onClick={() => setExpanded(!open)} title={modelFolderName(node.path)}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs">
        <ChevronRight className={"h-3 w-3 shrink-0 text-text-muted " + (open ? "rotate-90" : "")} />
        {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        <span className="truncate text-text-main">{node.name}</span>
        {node.isNew && node.count > 0 && <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 text-[10px] tone-success-text">новая</span>}
        {!!node.count && <span className="ml-auto shrink-0 tabular-nums text-text-muted">{node.count}</span>}
      </button>
      {target && <span className={"flex shrink-0 items-center gap-1 px-1 text-xs font-semibold " + (allowed ? "text-primary" : "tone-danger-text")}>
        {allowed && <ArrowDownToLine className="h-3.5 w-3.5" />} {allowed ? "Сюда" : "Недоступно"}
      </span>}
      {canMove && <>
        <span draggable onDragStart={event => c.start(event, folder)} onDragEnd={c.finish}
          title="Перетащить папку" className="cursor-grab rounded p-1 text-text-muted hover:bg-bg-subtle"><GripVertical className="h-4 w-4" /></span>
        <Button variant="icon" title={"Переместить папку " + node.name} onClick={() => c.onPickDestination(folder)} icon={<MoveRight className="h-3.5 w-3.5" />} />
        <Button variant="icon" title={"Убрать папку " + node.name} onClick={() => c.onRemove(node)} icon={<Trash2 className="h-3.5 w-3.5" />} />
      </>}
    </div>
    {open && <ul>
      {node.children.map(child => <Node key={child.path} node={child} depth={depth + 1} controls={c} />)}
      {node.cases.map(({ group, c: testCase }) => {
        const movable = !c.disabled && !c.sent[testCase.id];
        const selected = c.selected.has(testCase.id);
        const carrying = c.drag?.kind === "cases" && c.drag.ids.includes(testCase.id);
        const single: ModelMove = { kind: "cases", ids: [testCase.id], name: testCase.name, paths: [node.path] };
        const source = selected && c.batch ? c.batch : single;
        return <li key={testCase.id} style={{ paddingLeft: 26 + depth * 14 }}
          className={"flex min-h-8 min-w-0 items-center gap-1.5 pr-1 text-xs " +
            (carrying ? "bg-primary/20" : selected ? "bg-primary/10" : "hover:bg-bg-subtle")}
          onDragOver={() => { if (c.hover !== null) c.setHover(null); }}>
          {movable && <>
            <span draggable onDragStart={event => c.start(event, source)} onDragEnd={c.finish}
              title="Перетащить кейс" className="cursor-grab rounded p-1 text-text-muted hover:bg-bg-subtle"><GripVertical className="h-4 w-4" /></span>
            <input type="checkbox" checked={selected} onChange={() => c.onSelect(testCase.id)}
              className="accent-primary" title="Выбрать для переноса" aria-label={"Выбрать для переноса " + testCase.name} />
          </>}
          <span draggable={movable} onDragStart={event => { if (movable) c.start(event, source); }} onDragEnd={c.finish}
            className={"min-w-0 flex-1 truncate py-1 " + (movable ? "cursor-grab " : "") +
              (testCase.on ? "text-text-main" : "text-text-muted line-through")} title={testCase.name}>{testCase.name}</span>
          {group.task && <span className="shrink-0 font-mono text-[10px] text-text-muted">{group.task.key}</span>}
          <input type="checkbox" checked={testCase.on} disabled={!movable} onChange={() => c.onToggle(group, testCase)}
            title="Включить в отправку" aria-label={"Отправить кейс " + testCase.name} />
          {c.sent[testCase.id] && <span className="shrink-0 font-mono text-[10px] tone-success-text">{c.sent[testCase.id]}</span>}
          {movable && <Button variant="icon" title={"Переместить кейс " + testCase.name} onClick={() => c.onPickDestination(source)} icon={<MoveRight className="h-3.5 w-3.5" />} />}
        </li>;
      })}
    </ul>}
  </li>;
}

export default function ModelPreviewTree({ tree, ...props }: Props) {
  const [drag, setDrag] = useState<ModelMove | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  function start(event: DragEvent, source: ModelMove) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-shark-zephyr-placement", source.kind);
    const preview = document.createElement("div");
    preview.className = "pointer-events-none fixed -left-[480px] top-0 z-50 w-72 rounded-lg border border-primary bg-bg-card px-3 py-2 text-sm text-text-main shadow-lg";
    const title = document.createElement("strong");
    title.className = "block truncate";
    title.textContent = source.name;
    const location = document.createElement("span");
    location.className = "block truncate text-xs text-text-muted";
    location.textContent = `Из: ${origins(source)}`;
    preview.append(title, location);
    document.body.append(preview);
    event.dataTransfer.setDragImage(preview, 18, 18);
    requestAnimationFrame(() => preview.remove());
    setHover(null);
    setDrag(source);
  }

  const controls: TreeControls = { ...props, drag, hover, setHover, start, finish: () => { setDrag(null); setHover(null); } };
  const allowed = drag && hover !== null && acceptsModelMove(drag, hover);
  return <>
    <div role="status" className={"sticky top-0 z-10 flex min-w-0 items-center gap-2 border-b border-border-main bg-bg-card px-2.5 py-2 text-xs " +
      (drag ? "font-medium text-primary" : "text-text-muted")}>
      {drag ? <>
        <b className="max-w-[30%] shrink-0 truncate" title={drag.name}>{drag.name}</b>
        <span className="min-w-0 flex-1 truncate" title={origins(drag, true)}>Из: {origins(drag)}</span>
        <span aria-hidden>→</span>
        <span className={"min-w-0 flex-1 truncate " + (hover !== null && !allowed ? "tone-danger-text" : "")}
          title={hover !== null ? modelFolderName(hover) : undefined}>
          {hover === null ? "Выберите папку" : allowed ? `В: ${folderLeaf(hover)}` : `Недоступно: ${folderLeaf(hover)}`}
        </span>
      </> : "Слева — выбор для переноса. Справа — включение в отправку."}
    </div>
    <ul>{tree.map(node => <Node key={node.path} node={node} depth={0} controls={controls} />)}</ul>
  </>;
}
