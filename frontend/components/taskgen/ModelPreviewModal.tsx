"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileCheck2, Loader2, PlayCircle, Send } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button, Select } from "@/components/ui";
import { applyStaging, createTaskRuns, getTaskPlan, type TaskPlan, type TaskRunResult } from "@/lib/zephyrStaging";
import { cleanPath, inModelFolder, modelTree, moveModelCases, newFolders, stagingOf, type ModelCase, type ModelGroup, type ModelNode } from "@/lib/taskModel";
import ModelPreviewTree, { acceptsModelMove, modelFolderName, selectedModelCases, type ModelMove } from "./ModelPreviewTree";

const INPUT = "w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 font-mono text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

/**
 * Предпросмотр выгрузки в тестовую модель: как кейсы лягут в дерево Zephyr (новые папки помечены), куда идёт каждая
 * задача, какой прогон на неё создастся и что уже есть в модели. «Отправить» создаёт папки и кейсы (связь с задачей)
 * и НФ-прогоны. Обрыв посередине не задваивает: созданное запоминается, повтор отправляет только остаток.
 */
export default function ModelPreviewModal({ open, project, groups: initial, onClose }: {
  open: boolean; project: string; groups: ModelGroup[]; onClose: () => void;
}) {
  const [groups, setGroups] = useState<ModelGroup[]>(initial);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [planErr, setPlanErr] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [planAttempt, setPlanAttempt] = useState(0);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, TaskRunResult>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fatal, setFatal] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [moveNotice, setMoveNotice] = useState("");
  const [moving, setMoving] = useState<ModelMove | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModelNode | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    if (!open) return;
    setGroups(initial); setSent({}); setRuns({}); setErrors([]); setFatal(""); setMoving(null); setRemoving(null); setSelection(new Set()); setMoveNotice("");
  }, [open, project, initial]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null); setPlanErr(""); setPlanBusy(true);
    getTaskPlan(project, initial.flatMap(g => (g.task ? [g.task.key] : [])))
      .then(value => { if (live) setPlan(value); }, e => { if (live) setPlanErr((e as Error).message); })
      .finally(() => { if (live) setPlanBusy(false); });
    return () => { live = false; };
  }, [open, project, initial, planAttempt]);

  const existing = useMemo(() => (plan ? new Set(plan.folders.map(cleanPath).filter(Boolean)) : null), [plan]);
  const tree = useMemo(() => modelTree(groups, existing, sent), [groups, existing, sent]);
  const selected = useMemo(() => selectedModelCases(tree, selection, sent), [tree, selection, sent]);
  const chosen = groups.flatMap(g => g.cases.filter(c => c.on).map(c => ({ g, c })));
  const left = chosen.filter(x => !sent[x.c.id]);
  const runGroups = groups.filter(g => g.task && g.run && g.cases.some(c => c.on));
  const runsLeft = runGroups.filter(g => !runs[g.task!.key]?.run);
  const sending = progress !== null;
  const badFolder = groups.some(g => g.task && !cleanPath(g.folder) && g.cases.some(c => c.on && !sent[c.id] && c.destination === undefined));
  const nothing = !left.length && !runsLeft.length;

  const toggle = (g: ModelGroup, c: ModelCase) => setGroups(gs => gs.map(x => (x.id !== g.id ? x
    : { ...x, cases: x.cases.map(y => (y.id === c.id ? { ...y, on: !y.on } : y)) })));
  const patch = (id: string, p: Partial<ModelGroup>) => setGroups(gs => gs.map(g => (g.id === id ? { ...g, ...p } : g)));

  function move(source: ModelMove, path: string) {
    if (sending || !plan || !acceptsModelMove(source, path)) return;
    if (source.kind === "cases") {
      const ids = new Set(source.ids);
      setGroups(current => moveModelCases(current, sent, (from, id) => ids.has(id) ? path : from));
      setSelection(current => new Set([...current].filter(id => !ids.has(id))));
    } else {
      const next = cleanPath(`${path}/${source.name}`);
      setGroups(current => moveModelCases(current, sent, from => inModelFolder(from, source.path) ? next + from.slice(source.path.length) : from));
    }
    setMoveNotice(`Перемещено: ${source.name} → ${modelFolderName(path)}`);
    setMoving(null);
  }

  function pickDestination(source: ModelMove) {
    setDestination(null);
    setMoving(source);
  }

  function removeFolder(node: ModelNode) {
    if (!node.canMove || sending) return;
    const parent = node.path.slice(0, node.path.lastIndexOf("/"));
    setGroups(current => moveModelCases(current, sent, from => inModelFolder(from, node.path) ? parent + from.slice(node.path.length) : from));
    setRemoving(null);
  }

  const send = async () => {
    stop.current = false;
    setFatal(""); setErrors([]);
    const made = { ...sent };
    const staging = stagingOf(groups, made, existing ?? undefined);
    setProgress({ done: 0, total: staging.cases.length });
    try {
      if (staging.cases.length) {
        const r = await applyStaging(project, staging, (part, done, total) => {
          for (const x of part.results) if (x.key) made[x.id] = x.key;
          setSent({ ...made });
          setProgress({ done, total });
        }, () => stop.current);
        setErrors([
          ...Object.entries(r.folderErrors).map(([f, e]) => `Папка ${f}: ${e}`),
          ...r.results.filter(x => x.error).map(x => `${x.name}: ${x.error}`),
          ...r.results.filter(x => x.warning).map(x => `${x.name}: ${x.warning}`),
        ]);
      }
      if (stop.current) return;
      // Прогон — когда созданы все отмеченные кейсы задачи: прогон с частью кейсов повтор уже не дополнит.
      // Кейс не создаётся никак — снимите с него галочку и отправьте остаток.
      const tasks = runGroups.filter(g => !runs[g.task!.key]?.run && g.cases.every(c => !c.on || made[c.id]))
        .map(g => ({ key: g.task!.key, summary: g.task!.summary, caseKeys: g.cases.filter(c => c.on).map(c => made[c.id]) }));
      if (tasks.length) {
        const r = await createTaskRuns(project, tasks);
        setRuns(cur => ({ ...cur, ...Object.fromEntries(r.results.map(x => [x.task, x])) }));
      }
    } catch (e) {
      setFatal((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const allDone = nothing && chosen.length > 0;

  const destinations = moving ? tree.flatMap(function paths(node): string[] { return [node.path, ...node.children.flatMap(paths)]; }) : [];

  return (<>
    <Modal open={open} onClose={() => { if (!sending) onClose(); }} title={`Выгрузка в тестовую модель · ${project}`} size="max-w-7xl">
      <div className="grid h-[72vh] grid-rows-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1">
        {/* Задачи: куда и что */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {groups.map(g => {
              const on = g.cases.filter(c => c.on).length;
              const known = g.task ? plan?.tasks[g.task.key] : undefined;
              const run = g.task ? runs[g.task.key] : undefined;
              const made = g.cases.filter(c => sent[c.id]).length;
              return (
                <section key={g.id} className="space-y-2 rounded-lg border border-border-main p-3 text-sm">
                  {g.task ? (
                    <p className="flex items-baseline gap-2">
                      <span className="flex-shrink-0 font-mono text-xs text-primary">{g.task.key}</span>
                      <span className="truncate font-medium text-text-main" title={g.task.summary}>{g.task.summary}</span>
                    </p>
                  ) : <p className="font-medium text-text-main">Кейсы без задачи — по папкам из XML</p>}
                  <p className="text-xs text-text-muted">Кейсов: {on} из {g.cases.length}{made > 0 && ` · создано ${made}`}</p>
                  {g.reqNames.length > 0 && <p className="truncate text-xs text-text-muted" title={g.reqNames.join("; ")}>Требования: {g.reqNames.join("; ")}</p>}
                  {g.task && (
                    <>
                      <label className="block text-[11px] text-text-muted">Папка фичи по умолчанию
                        <input value={g.folder} onChange={e => patch(g.id, { folder: e.target.value })} list="model-folders" disabled={sending || made > 0}
                          aria-label={`Папка фичи ${g.task.key}`} className={`mt-1 ${INPUT}`} />
                      </label>
                      {!g.folder.trim() && <p className="text-[11px] text-red-600 dark:text-red-400">Укажите папку</p>}
                      <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-text-main">
                        <input type="checkbox" checked={g.run} disabled={sending || !!run?.run} onChange={e => patch(g.id, { run: e.target.checked })} />
                        <PlayCircle className="h-3.5 w-3.5 text-text-muted" />
                        <span className="truncate">Создать прогон НФ-{g.task.key}</span>
                      </label>
                      {known && (known.cases.length > 0 || known.runs.length > 0) && (
                        <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
                          <span>
                            Уже в модели: кейсов {known.cases.length}, прогонов {known.runs.length}
                            {known.runs.length > 0 && ` (${known.runs.map(r => r.key).join(", ")})`}. Отправка добавит новые, старые не заменит.
                          </span>
                        </p>
                      )}
                      {run?.run && (
                        <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Прогон {run.url
                            ? <a href={run.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono underline">{run.run}<ExternalLink className="h-3 w-3" /></a>
                            : <span className="font-mono">{run.run}</span>}: кейсов {run.cases}
                        </p>
                      )}
                      {!run?.run && g.run && made > 0 && g.cases.some(c => c.on && !sent[c.id]) && !sending && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">Прогон создастся, когда отправятся все отмеченные кейсы задачи</p>
                      )}
                      {run?.error && <p className="text-xs text-red-600 dark:text-red-400">Прогон не создан: {run.error}</p>}
                      {run?.warnings?.map(w => <p key={w} className="text-[11px] text-amber-700 dark:text-amber-400">{w}</p>)}
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <datalist id="model-folders">{plan?.folders.slice(0, 2000).map(f => <option key={f} value={f} />)}</datalist>
        </div>

        {/* Раскладка */}
        <div className="flex min-h-0 flex-col gap-2">
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <span className="font-semibold uppercase tracking-wide">Как ляжет в структуру</span>
            {planBusy && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> сверяю с моделью</span>}
            {plan && <span>новых папок: {newFolders(tree)}</span>}
          </p>
          {planErr && <div className="flex items-center gap-2 text-xs tone-warning"><p>{planErr}</p>
            <Button variant="sm" onClick={() => setPlanAttempt(n => n + 1)}>Перечитать дерево</Button></div>}
          {plan && <div className="flex min-h-8 flex-wrap items-center gap-2 text-xs">
            {selected?.kind === "cases" ? <>
              <span className="font-semibold text-primary">Выбрано для переноса: {selected.ids.length}</span>
              <Button variant="sm" disabled={sending} onClick={() => pickDestination(selected)}>Переместить</Button>
              <Button variant="ghost" onClick={() => setSelection(new Set())}>Снять выбор</Button>
            </> : <p role="status" className="text-text-muted">{moveNotice || "Выберите кейсы и перетащите их за ручку на папку."}</p>}
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-main py-1 scrollbar-thin">
            <ModelPreviewTree tree={tree} batch={selected} sent={sent} disabled={sending || !plan} selected={selection} onToggle={toggle} onMove={move}
              onSelect={id => setSelection(current => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })} onPickDestination={pickDestination} onRemove={setRemoving} />
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {fatal && <p className="text-sm text-red-600 dark:text-red-400">{fatal}</p>}
        {errors.length > 0 && (
          <ul className="max-h-24 overflow-y-auto rounded-lg bg-red-500/5 p-2 text-xs text-red-700 scrollbar-thin dark:text-red-300">
            {errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <p className="text-xs text-text-muted">
            {sending ? `Отправляю: ${progress.done} из ${progress.total}`
              : allDone ? `Готово: кейсов ${Object.keys(sent).length}, прогонов ${Object.values(runs).filter(r => r.run).length}`
              : `Будет создано: кейсов ${left.length}, папок ${plan ? newFolders(tree) : "—"}, прогонов ${runsLeft.length}`}
          </p>
          <span className="flex-1" />
          {sending ? (
            <button type="button" onClick={() => { stop.current = true; }} className="rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">Прервать</button>
          ) : (
            <button type="button" onClick={onClose} className="rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">Закрыть</button>
          )}
          {allDone ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><FileCheck2 className="h-4 w-4" /> В модели</span>
          ) : (
            <button type="button" onClick={() => void send()} disabled={sending || nothing || badFolder || !plan}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {Object.keys(sent).length ? "Отправить остаток" : "Отправить в Zephyr"}</button>
          )}
        </div>
      </div>
    </Modal>
    {moving && <Modal open title="Переместить в папку" onClose={() => setMoving(null)} size="max-w-md"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMoving(null)}>Отмена</Button>
        <Button disabled={destination === null} onClick={() => { if (destination !== null) move(moving, destination); }}>Переместить</Button></div>}>
      <p className="mb-2 break-words text-sm text-text-main">{moving.name}</p>
      <Select searchable aria-label="Папка назначения" value={destination ?? "•"} placeholder="Выберите папку" onChange={setDestination}>
        {destinations.filter(path => acceptsModelMove(moving, path)).map(path => <option key={path} value={path}>{path || "Корень тестовой модели"}</option>)}
      </Select>
    </Modal>}
    {removing && <Modal open title="Убрать папку из выгрузки" onClose={() => setRemoving(null)} size="max-w-md"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRemoving(null)}>Отмена</Button>
        <Button onClick={() => removeFolder(removing)}>Убрать папку</Button></div>}>
      <p className="text-sm text-text-main">Кейсы и вложенные папки из «{removing.name}» перейдут на уровень выше.</p>
    </Modal>}
  </>);
}
