"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown, Columns3, FilePlus2, FlaskConical, FolderTree, GitBranch, Layers, LayoutList, ListChecks, PanelLeftClose,
  PanelLeftOpen, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Users, X,
} from "lucide-react";

import BugsSection from "./BugsSection";
import { PickerPanel, type PickOption } from "@/components/jiratool/FieldPicker";
import ListTable, { type SortState } from "@/components/jiratool/ListTable";
import AddIssuesModal from "@/components/jiratool/AddIssuesModal";
import OwnFieldModal from "@/components/jiratool/OwnFieldModal";
import ParticipantsModal, { initials } from "@/components/jiratool/ParticipantsModal";
import { type NewDefect } from "@/components/jiratool/CreateDefectModal";
import CreateIssueModal, { type NewIssue } from "@/components/jiratool/CreateIssueModal";
import BulkStatusModal, { type StatusChange } from "@/components/jiratool/BulkStatusModal";
import StageMappingModal from "@/components/jiratool/StageMappingModal";
import ImportStructureModal, { type StructureImport } from "@/components/jiratool/ImportStructureModal";
import DefectsModal from "@/components/jiratool/DefectsModal";
import {
  BLOCK_COL, DEFAULT_COLUMNS, DEFECTS_COL, FOLDER_COL, OWN_TYPE_LABEL, PARTICIPANT_COL, PROJECTS, STAGE_COL, STRUCTURES, colLabel,
  applyGroupMove, colValues, defectIndex, effectiveIssues, emptyList, flattenStructure, initialStatus, listFields, loadState,
  makeDefectsOf, moveItem,
  projectKeyOfIssue, projectOf, resetState, saveState,
  type ColCtx, type Issue, type OwnField, type TaskList, type ToolState,
} from "@/lib/jiraTool";
import { makeStageResolver } from "@/lib/jiraStages";

/* ── Jira tool ─────────────────────────────────────────────────────────────
   Списки задач для планирования и назначения. Шапка списка — только проект и
   действия с задачами (импорт структуры, добавить из Jira, создать задачу);
   всё, что настраивает вид списка (колонки, группировка, свои поля, поиск),
   — в левой колонке, она сворачивается. Итерация на моках, данные в браузере.
   Старый генератор дефектов — отдельной вкладкой. */

type Tab = "lists" | "generator";
type ModalState = null | "add" | "create" | "import" | "participants" | "bulk" | "stages"
  | { own: OwnField | null } | { defectsFor: Issue };
type Panel = "columns" | "group" | null;

/** Свёрнута ли левая колонка — удобство конкретного человека, живёт в его браузере. */
const ASIDE_KEY = "st_jira_tool_aside";

function shortName(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

const nowStamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

export default function JiraToolSection() {
  const [tab, setTab] = useState<Tab>("lists");
  const [state, setState] = useState<ToolState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newList, setNewList] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  // Состояние читается из браузера только на клиенте — иначе расхождение с серверной отрисовкой.
  useEffect(() => {
    const s = loadState();
    setState(s);
    setActiveId(s.lists[0]?.id ?? null);
    try { setCollapsed(localStorage.getItem(ASIDE_KEY) === "1"); } catch { /* развёрнута по умолчанию */ }
  }, []);

  const toggleAside = (next = !collapsed) => {
    setCollapsed(next);
    try { localStorage.setItem(ASIDE_KEY, next ? "1" : "0"); } catch { /* не запомнится — не страшно */ }
  };

  // «[» сворачивает и разворачивает колонку, если фокус не в поле ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setCollapsed(c => {
        try { localStorage.setItem(ASIDE_KEY, c ? "0" : "1"); } catch { /* ignore */ }
        return !c;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (fn: (s: ToolState) => ToolState) => setState(prev => {
    if (!prev) return prev;
    const next = fn(prev);
    saveState(next);
    return next;
  });
  const updateList = (fn: (l: TaskList) => TaskList) =>
    update(s => ({ ...s, lists: s.lists.map(l => (l.id === activeId ? fn(l) : l)) }));

  const allIssues = useMemo(() => (state ? effectiveIssues(state) : []), [state?.created, state?.changed]); // eslint-disable-line react-hooks/exhaustive-deps
  const byKey = useMemo(() => new Map(allIssues.map(i => [i.key, i])), [allIssues]);
  const stageOf = useMemo(() => makeStageResolver(allIssues, state?.mapping ?? {}), [allIssues, state?.mapping]);
  const defectsOf = useMemo(() => makeDefectsOf(defectIndex(allIssues)), [allIssues]);
  const list = state?.lists.find(l => l.id === activeId) ?? null;

  const usage = useMemo(() => {
    const u: Record<string, number> = {};
    for (const l of state?.lists ?? []) for (const k of l.keys) { const p = l.assignees[k]; if (p) u[p] = (u[p] ?? 0) + 1; }
    return u;
  }, [state?.lists]);

  if (tab === "generator") return <Shell tab={tab} setTab={setTab}><BugsSection /></Shell>;
  if (!state) return <Shell tab={tab} setTab={setTab}><div className="p-6 text-sm text-text-muted">Загрузка…</div></Shell>;

  const ctx: ColCtx | null = list ? { list, participants: state.participants, stageOf, defectsOf } : null;

  /* ── Колонки и группировка: поля проекта списка ── */
  const hasFolders = !!list?.folders && Object.keys(list.folders).length > 0;
  const fieldOptions: PickOption[] = list ? [
    ...listFields(list).map(f => ({ value: `jira:${f.id}`, label: f.name, group: f.custom ? `Пользовательские поля ${list.project}` : "Поля Jira",
                                     hint: f.custom ? f.id.replace("customfield_", "cf ") : undefined })),
    // Поля, которые считает SimpleTest, — с пометкой (st): рядом с настоящим «Статусом» из Jira
    // стоит «Статус (st)», и их не перепутать.
    ...[STAGE_COL, DEFECTS_COL, BLOCK_COL, PARTICIPANT_COL, ...(hasFolders ? [FOLDER_COL] : [])]
      .map(c => ({ value: c, label: colLabel(c, list), group: "Поля SimpleTest", hint: "st" })),
    ...list.ownFields.map(f => ({ value: `own:${f.id}`, label: f.name, group: "Свои поля списка", hint: `st · ${OWN_TYPE_LABEL[f.type]}` })),
  ] : [];
  const groupOptions = fieldOptions.filter(o => !["jira:summary", "jira:description", "jira:environment", DEFECTS_COL].includes(o.value));

  /* ── Задачи текущего списка с фильтром ── */
  const q = filter.trim().toLowerCase();
  const listIssues: Issue[] = list && ctx
    ? list.keys.map(k => byKey.get(k)).filter((i): i is Issue => !!i)
        .filter(i => !q || i.key.toLowerCase().includes(q) || list.columns.some(c => colValues(c, i, ctx).some(v => v.toLowerCase().includes(q))))
    : [];
  const foreign = list ? list.keys.filter(k => projectKeyOfIssue(k) !== list.project).length : 0;
  const selectedIssues = listIssues.filter(i => selected.has(i.key));
  const projectEpics = list ? allIssues.filter(i => i.fields.issuetype === "Epic" && projectKeyOfIssue(i.key) === list.project) : [];

  /* ── Действия ── */
  const openList = (id: string) => { setActiveId(id); setSort(null); setFilter(""); setAskDelete(false); setSelected(new Set()); setRenaming(null); };

  const createList = () => {
    const name = (newList ?? "").trim();
    if (!name) return;
    const l = emptyList(name, list?.project);
    update(s => ({ ...s, lists: [...s.lists, l] }));
    openList(l.id); setNewList(null);
  };

  /** Новая задача попадает в мок-Jira и сразу в текущий список. */
  const addCreated = (issue: Issue, participantId: string) => update(s => ({
    ...s,
    created: [...s.created, issue],
    nextKey: s.nextKey + 1,
    lists: s.lists.map(l => l.id !== activeId ? l : {
      ...l, keys: [issue.key, ...l.keys],
      assignees: participantId ? { ...l.assignees, [issue.key]: participantId } : l.assignees,
    }),
  }));

  const createDefect = (d: NewDefect) => {
    if (!list) return;
    const now = nowStamp();
    addCreated({
      key: `${list.project}-${state.nextKey}`, local: true,
      fields: {
        summary: d.summary, description: d.description, issuetype: "Дефект", status: initialStatus("Дефект"), priority: d.priority,
        components: [d.component], assignee: null, reporter: "Вы", created: now, updated: now, labels: [], fixVersions: [], issuelinks: [],
      },
    }, d.participantId);
  };

  const createIssue = (n: NewIssue) => {
    if (!list) return;
    const now = nowStamp();
    addCreated({
      key: `${list.project}-${state.nextKey}`, local: true,
      fields: {
        summary: n.summary, description: n.description, issuetype: n.type, status: initialStatus(n.type), priority: n.priority,
        components: [n.component], assignee: null, reporter: "Вы", created: now, updated: now, labels: [], fixVersions: [],
        customfield_10006: n.type !== "Epic" && n.epicLink ? n.epicLink : null,
        customfield_10007: n.type === "Epic" ? n.summary : null,
      },
    }, n.participantId);
  };

  const importStructure = ({ structure, items, target }: StructureImport) => {
    const folders = Object.fromEntries(items.map(i => [i.key, i.folder]));
    const keys = items.map(i => i.key);
    const meta = { id: structure.id, name: structure.name, importedAt: nowStamp() };
    if (target === "new") {
      // Проект нового списка — тот, чьих задач в структуре больше.
      const counts = new Map<string, number>();
      keys.forEach(k => counts.set(projectKeyOfIssue(k), (counts.get(projectKeyOfIssue(k)) ?? 0) + 1));
      const project = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? list?.project;
      const l: TaskList = {
        ...emptyList(structure.name, project), keys, folders, structure: meta,
        columns: [...DEFAULT_COLUMNS, DEFECTS_COL, BLOCK_COL], groupBy: [FOLDER_COL],
      };
      update(s => ({ ...s, lists: [...s.lists, l] }));
      openList(l.id);
    } else {
      updateList(l => ({
        ...l,
        keys: [...l.keys, ...keys.filter(k => !l.keys.includes(k))],
        folders: { ...l.folders, ...folders },
        structure: meta,
        groupBy: l.groupBy.includes(FOLDER_COL) ? l.groupBy : [FOLDER_COL, ...l.groupBy].slice(0, 3),
      }));
    }
  };

  /** Повторный импорт той же структуры в текущий список: новые задачи и папки подтянутся. */
  const refreshStructure = () => {
    const st = list?.structure && STRUCTURES.find(x => x.id === list.structure!.id);
    if (st) importStructure({ structure: st, items: flattenStructure(st.root), target: "current" });
  };

  const applyStatuses = (changes: StatusChange[]) => {
    const now = nowStamp();
    update(s => ({
      ...s,
      changed: { ...s.changed, ...Object.fromEntries(changes.map(c => [c.key, { status: c.status, resolution: c.resolution, updated: now }])) },
    }));
    setSelected(new Set());
  };

  const saveOwn = (f: OwnField) => updateList(l => {
    const exists = l.ownFields.some(x => x.id === f.id);
    return {
      ...l,
      ownFields: exists ? l.ownFields.map(x => (x.id === f.id ? f : x)) : [...l.ownFields, f],
      columns: exists || l.columns.includes(`own:${f.id}`) ? l.columns : [...l.columns, `own:${f.id}`],
    };
  });
  const deleteOwn = (id: string) => updateList(l => ({
    ...l,
    ownFields: l.ownFields.filter(x => x.id !== id),
    columns: l.columns.filter(c => c !== `own:${id}`),
    groupBy: l.groupBy.filter(c => c !== `own:${id}`),
    values: Object.fromEntries(Object.entries(l.values).map(([k, v]) => { const { [id]: _drop, ...rest } = v; return [k, rest]; })),
  }));
  const ownUsed = (id: string) => !!list && Object.values(list.values).some(v => {
    const x = v[id]; return Array.isArray(x) ? x.length > 0 : !!x;
  });

  /** Из свёрнутой полоски: развернуть колонку и сразу открыть нужную настройку. */
  const openPanel = (p: Panel) => { toggleAside(false); setPanel(p); };

  return (
    <Shell tab={tab} setTab={setTab}>
      <div className="h-full flex gap-4 p-6 overflow-hidden">
        {collapsed ? (
          /* ── Свёрнутая полоска ── */
          <aside aria-label="Списки (свёрнуто)" className="w-12 flex-shrink-0 flex flex-col items-center gap-2 overflow-hidden animate-fade-in">
            <RailButton label="Развернуть колонку  [" onClick={() => toggleAside(false)}><PanelLeftOpen className="w-4 h-4" /></RailButton>
            <div className="w-12 flex-1 min-h-0 bg-bg-card border border-border-main rounded-xl py-1.5 flex flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
              {state.lists.map(l => (
                <button key={l.id} type="button" onClick={() => openList(l.id)} aria-label={l.name} aria-current={l.id === activeId}
                  title={`${l.name} · ${l.project} · задач: ${l.keys.length}`}
                  className={`w-9 h-9 flex-shrink-0 rounded-lg text-[11px] font-bold transition-colors
                    ${l.id === activeId ? "bg-primary text-white" : "bg-bg-subtle text-text-muted hover:text-primary"}`}>
                  {shortName(l.name)}
                </button>
              ))}
              <button type="button" onClick={() => { toggleAside(false); setNewList(""); }} aria-label="Новый список" title="Новый список"
                className="w-9 h-9 flex-shrink-0 rounded-lg border border-dashed border-border-main text-text-muted hover:text-primary hover:border-primary/40 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {list && <RailButton label="Колонки" onClick={() => openPanel("columns")}><Columns3 className="w-4 h-4" /></RailButton>}
            {list && <RailButton label="Группировка" onClick={() => openPanel("group")} badge={list.groupBy.length || undefined}><Layers className="w-4 h-4" /></RailButton>}
            <button type="button" onClick={() => setModal("participants")} aria-label="Участники"
              title={`Участники: ${state.participants.map(p => p.name).join(", ") || "пока никого"}`}
              className="w-12 flex-shrink-0 bg-bg-card border border-border-main rounded-xl py-2 flex flex-col items-center -space-y-1.5 hover:border-primary/40">
              {state.participants.slice(0, 4).map(p => (
                <span key={p.id} className="w-6 h-6 rounded-full ring-2 ring-[var(--color-bg-card,#fff)] flex items-center justify-center text-white text-[9px] font-bold"
                  style={{ backgroundColor: p.color }}>{initials(p.name)}</span>
              ))}
              {state.participants.length > 4 && <span className="pt-2 text-[10px] text-text-muted">+{state.participants.length - 4}</span>}
              {state.participants.length === 0 && <Users className="w-4 h-4 text-text-muted" />}
            </button>
            <RailButton label="Статус (st): сопоставление" onClick={() => setModal("stages")}><GitBranch className="w-4 h-4" /></RailButton>
            <span title="Демо: мок-Jira, данные хранятся в этом браузере" className="pb-1">
              <FlaskConical className="w-4 h-4 text-amber-500" />
            </span>
          </aside>
        ) : (
          /* ── Развёрнутая колонка ── */
          <aside className="w-72 flex-shrink-0 flex flex-col gap-3 overflow-y-auto scrollbar-thin pr-0.5 animate-fade-in">
            <div className="bg-bg-card border border-border-main rounded-xl p-2 flex flex-col gap-0.5">
              <div className="flex items-center justify-between pl-2 pr-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted py-1">Списки</p>
                <button type="button" onClick={() => toggleAside(true)} aria-label="Свернуть колонку" title="Свернуть колонку  ["
                  className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle">
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto scrollbar-thin flex flex-col gap-0.5">
                {state.lists.map(l => (
                  <button key={l.id} type="button" onClick={() => openList(l.id)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors
                      ${l.id === activeId ? "bg-primary/10 text-primary font-medium" : "text-text-main hover:bg-bg-subtle"}`}>
                    {l.structure ? <FolderTree className="w-4 h-4 flex-shrink-0" /> : <LayoutList className="w-4 h-4 flex-shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{l.name}</span>
                      <span className="block text-[10px] text-text-muted font-normal">{l.project}</span>
                    </span>
                    <span className="text-[11px] text-text-muted">{l.keys.length}</span>
                  </button>
                ))}
              </div>
              {newList === null ? (
                <button type="button" onClick={() => setNewList("")}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-text-muted hover:text-primary">
                  <Plus className="w-4 h-4" /> Новый список
                </button>
              ) : (
                <input autoFocus value={newList} onChange={e => setNewList(e.target.value)} onBlur={() => !newList.trim() && setNewList(null)}
                  onKeyDown={e => { if (e.key === "Enter") createList(); if (e.key === "Escape") setNewList(null); }}
                  placeholder="Название, Enter" aria-label="Название нового списка"
                  className="mx-1 text-sm border border-primary/40 rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
              )}
            </div>

            {/* Настройка списка: всё, что меняет вид таблицы */}
            {list && (
              <div className="bg-bg-card border border-border-main rounded-xl p-3 flex flex-col gap-3">
                <div className="flex items-center gap-1 min-w-0">
                  {renaming !== null ? (
                    <input autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} aria-label="Название списка"
                      onBlur={() => { if (renaming.trim()) updateList(l => ({ ...l, name: renaming.trim() })); setRenaming(null); }}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                      className="min-w-0 flex-1 text-sm font-semibold bg-[var(--color-input-bg)] border border-primary/40 rounded-lg px-2 py-1 text-text-main focus:outline-none" />
                  ) : (
                    <p className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Настройка списка</p>
                  )}
                  <button type="button" onClick={() => setRenaming(list.name)} aria-label="Переименовать список" title="Переименовать список"
                    className="p-1 rounded-md text-text-muted hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setAskDelete(true)} aria-label="Удалить список" title="Удалить список"
                    className="p-1 rounded-md text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {askDelete && (
                  <div className="flex items-center gap-1.5 text-xs -mt-1">
                    <span className="text-text-muted flex-1">Удалить список? Задачи в Jira останутся.</span>
                    <button type="button" onClick={() => {
                      update(s => ({ ...s, lists: s.lists.filter(l => l.id !== list.id) }));
                      openList(state.lists.find(l => l.id !== list.id)?.id ?? "");
                    }} className="px-2 py-1 rounded-md bg-red-600 text-white font-semibold">Удалить</button>
                    <button type="button" onClick={() => setAskDelete(false)} className="px-2 py-1 rounded-md border border-border-main text-text-muted">Нет</button>
                  </div>
                )}

                <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)]
                  focus-within:ring-2 focus-within:ring-primary/30">
                  <Search className="w-3.5 h-3.5 text-text-muted" />
                  <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Найти в списке" aria-label="Найти в списке"
                    className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
                  {filter && <button type="button" onClick={() => setFilter("")} aria-label="Очистить"><X className="w-3.5 h-3.5 text-text-muted" /></button>}
                </label>

                <Section icon={<Columns3 className="w-4 h-4" />} title="Колонки" note={`${list.columns.length}`}
                  open={panel === "columns"} onToggle={() => setPanel(p => (p === "columns" ? null : "columns"))}>
                  <PickerPanel label="Колонки" options={fieldOptions} selected={list.columns} listHeight="max-h-64"
                    onChange={columns => updateList(l => ({ ...l, columns }))}
                    footer={
                      <button type="button" onClick={() => setModal({ own: null })}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-primary hover:bg-primary/5">
                        <FilePlus2 className="w-4 h-4" /> Своё поле…
                      </button>
                    } />
                </Section>

                <Section icon={<Layers className="w-4 h-4" />} title="Группировка"
                  note={list.groupBy.length ? list.groupBy.map(g => colLabel(g, list)).join(" → ") : "нет"}
                  open={panel === "group"} onToggle={() => setPanel(p => (p === "group" ? null : "group"))}>
                  <PickerPanel label="Группировка" options={groupOptions} selected={list.groupBy} max={3} ordered listHeight="max-h-64"
                    onChange={groupBy => updateList(l => ({ ...l, groupBy }))} />
                </Section>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-text-main">Свои поля</p>
                    <button type="button" onClick={() => setModal({ own: null })} className="text-xs text-primary hover:underline">+ поле</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {list.ownFields.length === 0 && <span className="text-[11px] text-text-muted">Нет — добавьте дату ретеста, стенд и т.п.</span>}
                    {list.ownFields.map(f => (
                      <button key={f.id} type="button" onClick={() => setModal({ own: f })} title={`${OWN_TYPE_LABEL[f.type]} — изменить`}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-bg-subtle text-xs text-text-main hover:text-primary">
                        <Pencil className="w-3 h-3" /> {f.name}
                      </button>
                    ))}
                  </div>
                </div>

                {list.structure && (
                  <div className="text-[11px] text-text-muted flex items-start gap-1.5 border-t border-border-main pt-2">
                    <FolderTree className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                    <span className="flex-1">Из структуры «{list.structure.name}» · {list.structure.importedAt}</span>
                    <button type="button" onClick={refreshStructure} title="Подтянуть новые задачи и папки"
                      className="p-0.5 rounded hover:text-primary"><RefreshCw className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            )}

            <div className="bg-bg-card border border-border-main rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Участники</p>
                <button type="button" onClick={() => setModal("participants")} className="text-xs text-primary hover:underline">Изменить</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {state.participants.length === 0 && <span className="text-xs text-text-muted">Пока никого</span>}
                {state.participants.map(p => (
                  <span key={p.id} title={`${p.name}${p.role ? ` · ${p.role}` : ""} · задач: ${usage[p.id] ?? 0}`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: p.color }}>
                    {initials(p.name)}
                  </span>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => setModal("stages")}
              className="flex items-center gap-2 bg-bg-card border border-border-main rounded-xl px-3 py-2.5 text-sm text-text-main hover:border-primary/40 text-left">
              <GitBranch className="w-4 h-4 text-text-muted" />
              <span className="flex-1">Статус (st)</span>
              <span className="text-[10px] text-text-muted">настроить</span>
            </button>

            <div className="mt-auto text-[11px] text-text-muted leading-relaxed px-1 pb-1">
              <p className="flex items-start gap-1.5"><FlaskConical className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                Демо: мок-Jira ({PROJECTS.length} проекта, {allIssues.length} задач), списки и правки хранятся в этом браузере.</p>
              {askReset ? (
                <span className="flex items-center gap-1.5 mt-1.5">
                  <button type="button" onClick={() => { const s = resetState(); setState(s); openList(s.lists[0]?.id ?? ""); setAskReset(false); }}
                    className="px-2 py-0.5 rounded bg-red-600 text-white font-semibold">Сбросить</button>
                  <button type="button" onClick={() => setAskReset(false)} className="px-2 py-0.5 rounded border border-border-main">Отмена</button>
                </span>
              ) : (
                <button type="button" onClick={() => setAskReset(true)} className="flex items-center gap-1 mt-1.5 hover:text-text-main">
                  <RotateCcw className="w-3 h-3" /> Сбросить демо-данные
                </button>
              )}
            </div>
          </aside>
        )}

        {/* ── Список ── */}
        <main className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
          {!list || !ctx ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-text-muted">
              <LayoutList className="w-8 h-8" />
              <p className="text-sm">Создайте первый список — например, «Дефекты релиза» или «Ретест на этой неделе».</p>
              <button type="button" onClick={() => { toggleAside(false); setNewList(""); }}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">Новый список</button>
            </div>
          ) : (
            <>
              {/* Шапка: проект и действия с задачами */}
              <div className="flex items-center gap-3">
                <select value={list.project} onChange={e => updateList(l => ({ ...l, project: e.target.value }))} aria-label="Проект списка"
                  title="Проект списка: от него зависят поля, поиск и создание задач"
                  className="text-sm font-semibold border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main">
                  {PROJECTS.map(p => <option key={p.key} value={p.key}>{p.key} · {p.name}</option>)}
                </select>
                <div className="min-w-0 flex-1" title={list.name}>
                  <p className="text-sm font-semibold text-text-main truncate">{list.name}</p>
                  <p className="text-[11px] text-text-muted truncate">задач: {list.keys.length}
                    {foreign > 0 && <span title="Поля этих задач берутся из их проектов"> · из других проектов: {foreign}</span>}
                    {q && <> · найдено: {listIssues.length}</>}
                    {sort && (
                      <> · сортировка: {colLabel(sort.col, list)} {sort.dir === 1 ? "↑" : "↓"}{" "}
                        <button type="button" onClick={() => setSort(null)} className="text-primary hover:underline"
                          title="Вернуть ручной порядок — тогда строки можно перетаскивать">сбросить</button></>
                    )}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button" onClick={() => setModal("import")} title="Импорт структуры: все задачи с папками"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle whitespace-nowrap">
                    <FolderTree className="w-4 h-4" /> Структура
                  </button>
                  <button type="button" onClick={() => setModal("add")}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle whitespace-nowrap">
                    <Plus className="w-4 h-4" /> Добавить задачи
                  </button>
                  <button type="button" onClick={() => setModal("create")}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 whitespace-nowrap">
                    <FilePlus2 className="w-4 h-4" /> Создать задачу
                  </button>
                </div>
              </div>

              {selected.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 animate-fade-in">
                  <ListChecks className="w-4 h-4 text-primary" />
                  <span className="text-sm text-text-main">Выбрано: <b>{selected.size}</b></span>
                  <button type="button" onClick={() => setModal("bulk")}
                    className="ml-2 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90">Сменить статус</button>
                  <button type="button" onClick={() => { updateList(l => ({ ...l, keys: l.keys.filter(k => !selected.has(k)) })); setSelected(new Set()); }}
                    className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">Убрать из списка</button>
                  <button type="button" onClick={() => setSelected(new Set())} aria-label="Снять выбор"
                    className="ml-auto p-1.5 rounded-lg text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {list.keys.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border-main rounded-xl text-text-muted">
                    <p className="text-sm">Список пуст. Добавьте задачи проекта {projectOf(list.project).name}, импортируйте структуру или создайте задачу.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setModal("add")} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">Добавить задачи</button>
                      <button type="button" onClick={() => setModal("import")} className="px-4 py-2 rounded-lg border border-border-main text-sm text-text-main">Импорт структуры</button>
                    </div>
                  </div>
                ) : listIssues.length === 0 ? (
                  <p className="text-sm text-text-muted p-4">По «{filter}» в списке ничего нет.</p>
                ) : (
                  <ListTable key={list.id} ctx={ctx} issues={listIssues} sort={sort} onSort={setSort}
                    selected={selected}
                    onSelect={(keys, on) => setSelected(prev => { const n = new Set(prev); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n; })}
                    onValue={(key, fid, v) => updateList(l => ({ ...l, values: { ...l.values, [key]: { ...l.values[key], [fid]: v } } }))}
                    onParticipant={(key, id) => updateList(l => {
                      const a = { ...l.assignees };
                      if (id) a[key] = id; else delete a[key];
                      return { ...l, assignees: a };
                    })}
                    onRemove={key => { updateList(l => ({ ...l, keys: l.keys.filter(k => k !== key) })); setSelected(p => { const n = new Set(p); n.delete(key); return n; }); }}
                    onOpenDefects={issue => setModal({ defectsFor: issue })}
                    onMoveRow={(key, target, place) => updateList(l => ({ ...l, keys: moveItem(l.keys, key, target, place) }))}
                    onMoveColumn={(col, target, place) => updateList(l => ({ ...l, columns: moveItem(l.columns, col, target, place) }))}
                    onMoveToGroup={(key, changes, target, place) => updateList(l => {
                      const moved = applyGroupMove(l, state.participants, key, changes);
                      return target ? { ...moved, keys: moveItem(moved.keys, key, target, place) } : moved;
                    })} />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {modal === "add" && list && (
        <AddIssuesModal open project={list.project} onClose={() => setModal(null)} allIssues={allIssues} inList={new Set(list.keys)}
          onAdd={keys => updateList(l => ({ ...l, keys: [...l.keys, ...keys.filter(k => !l.keys.includes(k))] }))} />
      )}
      {modal === "create" && list && (
        <CreateIssueModal open project={list.project} participants={state.participants} epics={projectEpics}
          onCreateDefect={createDefect} onCreate={createIssue} onClose={() => setModal(null)} />
      )}
      {modal === "import" && list && (
        <ImportStructureModal open listName={list.name} onImport={importStructure} onClose={() => setModal(null)} />
      )}
      {modal === "participants" && (
        <ParticipantsModal open participants={state.participants} usage={usage} onClose={() => setModal(null)}
          onChange={participants => update(s => {
            const ids = new Set(participants.map(p => p.id));
            // Удалённого участника снимаем со всех задач во всех списках.
            const lists = s.lists.map(l => ({ ...l, assignees: Object.fromEntries(Object.entries(l.assignees).filter(([, p]) => ids.has(p))) }));
            return { ...s, participants, lists };
          })} />
      )}
      {modal === "bulk" && (
        <BulkStatusModal open issues={selectedIssues} onClose={() => setModal(null)} onApply={applyStatuses} />
      )}
      {modal === "stages" && (
        <StageMappingModal open project={list?.project ?? PROJECTS[0].key} mapping={state.mapping} onClose={() => setModal(null)}
          onSave={mapping => update(s => ({ ...s, mapping }))} />
      )}
      {modal && typeof modal === "object" && "defectsFor" in modal && (
        <DefectsModal open issue={modal.defectsFor} defects={defectsOf(modal.defectsFor) ?? []} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "own" in modal && (
        <OwnFieldModal open initial={modal.own} typeLocked={!!modal.own && ownUsed(modal.own.id)} onClose={() => setModal(null)}
          onSave={saveOwn} onDelete={modal.own ? () => deleteOwn(modal.own!.id) : undefined} />
      )}
    </Shell>
  );
}

/** Раскрывающийся блок настройки в левой колонке. */
function Section({ icon, title, note, open, onToggle, children }: {
  icon: ReactNode; title: string; note: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border ${open ? "border-primary/30" : "border-border-main"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
        <span className="text-text-muted">{icon}</span>
        <span className="text-sm font-medium text-text-main">{title}</span>
        <span className="min-w-0 flex-1 text-[11px] text-text-muted truncate text-right">{note}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-2 pb-2 animate-fade-in">{children}</div>}
    </div>
  );
}

function RailButton({ label, onClick, badge, children }: { label: string; onClick: () => void; badge?: number; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="relative w-10 h-10 flex-shrink-0 rounded-xl border border-border-main bg-bg-card flex items-center justify-center text-text-muted hover:text-primary">
      {children}
      {badge !== undefined && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{badge}</span>
      )}
    </button>
  );
}

function Shell({ tab, setTab, children }: { tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  const tabCls = (on: boolean) => `px-3 py-1.5 rounded-lg text-sm transition-colors
    ${on ? "bg-primary/10 text-primary font-medium" : "text-text-muted hover:text-text-main"}`;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
        <LayoutList className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Jira tool</h1>
        <div className="flex gap-1 ml-4" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "lists"} onClick={() => setTab("lists")} className={tabCls(tab === "lists")}>Списки</button>
          <button type="button" role="tab" aria-selected={tab === "generator"} onClick={() => setTab("generator")} className={tabCls(tab === "generator")}>Генератор дефектов</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
