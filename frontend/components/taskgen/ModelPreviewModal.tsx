"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, FileCheck2, Folder, FolderOpen, Loader2, PlayCircle, Send } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { applyStaging, createTaskRuns, getTaskPlan, type TaskPlan, type TaskRunResult } from "@/lib/zephyrStaging";
import { modelTree, newFolders, stagingOf, type ModelCase, type ModelGroup, type ModelNode } from "@/lib/taskModel";

const INPUT = "w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 font-mono text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

/** Папка раскладки: новая помечена; внутри — вложенные папки и кейсы с галочками. */
function Node({ node, depth, sent, onToggle }: { node: ModelNode; depth: number; sent: Record<string, string>; onToggle: (g: ModelGroup, c: ModelCase) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ paddingLeft: 8 + depth * 16 }}
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs hover:bg-bg-subtle">
        <ChevronRight className={`h-3 w-3 flex-shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />}
        <span className="truncate text-text-main">{node.name}</span>
        {node.isNew && node.count > 0 && <span className="flex-shrink-0 rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">новая</span>}
        <span className="ml-auto flex-shrink-0 tabular-nums text-text-muted">{node.count}</span>
      </button>
      {open && (
        <ul>
          {node.children.map(n => <Node key={n.path} node={n} depth={depth + 1} sent={sent} onToggle={onToggle} />)}
          {node.cases.map(({ group, c }) => (
            <li key={c.id}>
              <label style={{ paddingLeft: 26 + depth * 16 }} className="flex cursor-pointer items-center gap-1.5 py-0.5 pr-2 text-xs hover:bg-bg-subtle">
                <input type="checkbox" checked={c.on} disabled={!!sent[c.id]} onChange={() => onToggle(group, c)} aria-label={`Отправить кейс ${c.name}`} />
                <span className={`truncate ${c.on ? "text-text-main" : "text-text-muted line-through"}`} title={c.name}>{c.name}</span>
                {group.task && <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-text-muted">{group.task.key}</span>}
                {sent[c.id] && <span className="flex-shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">{sent[c.id]}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

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
  const [sent, setSent] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, TaskRunResult>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fatal, setFatal] = useState("");
  const stop = useRef(false);

  useEffect(() => {
    if (!open) return;
    setGroups(initial); setSent({}); setRuns({}); setErrors([]); setFatal(""); setPlan(null); setPlanErr(""); setPlanBusy(true);
    getTaskPlan(project, initial.flatMap(g => (g.task ? [g.task.key] : [])))
      .then(setPlan, e => setPlanErr((e as Error).message)).finally(() => setPlanBusy(false));
  }, [open, project, initial]);

  const existing = useMemo(() => (plan ? new Set(plan.folders) : null), [plan]);
  const tree = useMemo(() => modelTree(groups, existing), [groups, existing]);
  const chosen = groups.flatMap(g => g.cases.filter(c => c.on).map(c => ({ g, c })));
  const left = chosen.filter(x => !sent[x.c.id]);
  const runGroups = groups.filter(g => g.task && g.run && g.cases.some(c => c.on));
  const runsLeft = runGroups.filter(g => !runs[g.task!.key]?.run);
  const sending = progress !== null;
  const badFolder = groups.some(g => g.task && g.cases.some(c => c.on) && !g.folder.trim());
  const nothing = !left.length && !runsLeft.length;

  const toggle = (g: ModelGroup, c: ModelCase) => setGroups(gs => gs.map(x => (x.id !== g.id ? x
    : { ...x, cases: x.cases.map(y => (y.id === c.id ? { ...y, on: !y.on } : y)) })));
  const patch = (id: string, p: Partial<ModelGroup>) => setGroups(gs => gs.map(g => (g.id === id ? { ...g, ...p } : g)));

  const send = async () => {
    stop.current = false;
    setFatal(""); setErrors([]);
    const made = { ...sent };
    const staging = stagingOf(groups, made);
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

  return (
    <Modal open={open} onClose={() => { if (!sending) onClose(); }} title={`Выгрузка в тестовую модель · ${project}`} size="max-w-7xl">
      <div className="grid h-[72vh] grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-4">
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
                      <label className="block text-[11px] text-text-muted">Папка фичи в модели
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
          {planErr && <p className="text-xs text-amber-700 dark:text-amber-400">С моделью не сверилось — новые папки не помечены: {planErr}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-main py-1 scrollbar-thin">
            {tree.length ? (
              <ul>{tree.map(n => <Node key={n.path} node={n} depth={0} sent={sent} onToggle={toggle} />)}</ul>
            ) : <p className="p-4 text-center text-sm text-text-muted">Кейсов нет</p>}
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
            <button type="button" onClick={() => void send()} disabled={sending || nothing || badFolder}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {Object.keys(sent).length ? "Отправить остаток" : "Отправить в Zephyr"}</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
