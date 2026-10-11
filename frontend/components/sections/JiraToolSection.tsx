"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ChevronDown, Columns3, FilePlus2, Folder, FolderTree, GitBranch, Layers, LayoutList, ListChecks, PanelLeftClose,
  PanelLeftOpen, Pencil, Plus, RefreshCw, Search, Trash2, Users, X,
} from "lucide-react";

import { PickerPanel, type PickOption } from "@/components/jiratool/FieldPicker";
import ListTable, { type SortState } from "@/components/jiratool/ListTable";
import AddIssuesModal from "@/components/jiratool/AddIssuesModal";
import OwnFieldModal from "@/components/jiratool/OwnFieldModal";
import ParticipantsModal, { initials } from "@/components/jiratool/ParticipantsModal";
import IssueFormModal, { type IssueDraft } from "@/components/jiratool/IssueFormModal";
import BulkStatusModal from "@/components/jiratool/BulkStatusModal";
import StageMappingModal from "@/components/jiratool/StageMappingModal";
import ImportStructureModal, { type StructureImport } from "@/components/jiratool/ImportStructureModal";
import DefectsModal from "@/components/jiratool/DefectsModal";
import JiraSettingsModal from "@/components/settings/JiraSettingsModal";
import {
  BLOCK_COL, DEFAULT_COLUMNS, DEFECTS_COL, SPEND_COLS, FOLDER_COL, OWN_TYPE_LABEL, PARTICIPANT_COL, STAGE_COL, colLabel,
  NO_FOLDER, applyGroupMove, categoryOf, colValues, setFolder, defectIndex, draftKey, emptyList, flattenStructure, listFields, loadState,
  epicLinkId, makeDefectsOf, moveItem, replaceDraft, fmtJiraDate, jiraDateKind, setCatalog,
  projectKeyOfIssue, saveState,
  type ColCtx, type Issue, type OwnField, type TaskList, type ToolState,
} from "@/lib/jiraTool";
import { makeStageResolver } from "@/lib/jiraStages";
import { getCatalog, getProjectFields, getProjects, getStructureTree, issuesByKeys, relatedIssues } from "@/lib/jiraToolApi";

/* ── Jira tool ─────────────────────────────────────────────────────────────
   Списки задач для планирования и назначения. Задачи, поля, статусы, переходы и
   структуры — из настоящей Jira (подключение и токен — Настройки → Jira, те же,
   что у регистрации дефектов). Списки, участники, свои поля, трудозатраты и
   черновики — у SimpleTest, в этом браузере.
   Шапка списка — проект и действия с задачами; всё, что настраивает вид списка
   (колонки, группировка, папки, свои поля, поиск), — в левой колонке. */

type ModalState = null | "add" | "create" | "import" | "participants" | "bulk" | "stages"
  | { own: OwnField | null } | { defectsFor: Issue } | { draft: Issue };
type Panel = "columns" | "group" | null;

/** Свёрнута ли левая колонка — удобство конкретного человека, живёт в его браузере. */
const ASIDE_KEY = "st_jira_tool_aside";

function shortName(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

const nowStamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

type JiraConn = { state: "loading" } | { state: "ok"; baseUrl: string } | { state: "error"; message: string };

export default function JiraToolSection() {
  const [state, setState] = useState<ToolState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newList, setNewList] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Режим выбора задач: чекбоксы в таблице и панель действий. Выход — снимает выбор. */
  const [selecting, setSelecting] = useState(false);
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const [modal, setModal] = useState<ModalState>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [askDeleteList, setAskDeleteList] = useState<string | null>(null);

  /* ── Jira: подключение, справочники и задачи ── */
  const [jira, setJira] = useState<JiraConn>({ state: "loading" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<{ key: string; name: string }[]>([]);
  const [projectFieldIds, setProjectFieldIds] = useState<Record<string, string[]>>({});
  /** Задачи из Jira: списка и связанные (стори эпиков, дефекты). Не сохраняются — читаются заново. */
  const [cache, setCache] = useState<Record<string, Issue>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(0);
  const [loadErr, setLoadErr] = useState("");
  const [projectInput, setProjectInput] = useState("");
  /** Ключи, которые уже запрошены (или упали с ошибкой — тогда ждут «Обновить»), и у которых подтянуты связанные. */
  const inflight = useRef(new Set<string>());
  const relatedDone = useRef(new Set<string>());

  // Состояние читается из браузера только на клиенте — иначе расхождение с серверной отрисовкой.
  useEffect(() => {
    const s = loadState();
    setState(s);
    setActiveId(s.lists[0]?.id ?? null);
    try { setCollapsed(localStorage.getItem(ASIDE_KEY) === "1"); } catch { /* развёрнута по умолчанию */ }
  }, []);

  const connect = (refresh = false) => {
    setJira({ state: "loading" });
    getCatalog(refresh)
      .then(c => {
        setCatalog(c);
        setJira({ state: "ok", baseUrl: c.base_url });
        getProjects().then(r => setProjects(r.projects)).catch(() => setProjects([]));
      })
      .catch(e => setJira({ state: "error", message: (e as Error).message }));
  };
  useEffect(() => { connect(); }, []);

  const mergeIssues = (items: Issue[]) => setCache(c => {
    const n = { ...c };
    for (const i of items) n[i.key] = i;
    return n;
  });

  /**
   * Подтянуть из Jira задачи need (по ключам) и связанные задачи для них и для withRelated:
   * стори и дефекты эпиков (Epic Link) и задачи из связей — без них не посчитать
   * статус (st) эпика, «Дефекты (st)» и «Блок (st)».
   */
  const sync = async (need: string[], withRelated: Issue[]) => {
    need.forEach(k => inflight.current.add(k));
    withRelated.forEach(i => relatedDone.current.add(i.key));
    setBusy(b => b + 1); setLoadErr("");
    try {
      let fresh: Issue[] = [];
      if (need.length) {
        const r = await issuesByKeys(need);
        fresh = r.issues;
        mergeIssues(fresh);
        setMissing(m => { const n = new Set(m); need.forEach(k => n.delete(k)); r.missing.forEach(k => n.add(k)); return n; });
        fresh.forEach(i => relatedDone.current.add(i.key));
        need.forEach(k => inflight.current.delete(k));
      }
      const base = [...fresh, ...withRelated];
      const epics = base.filter(i => categoryOf(i) === "epic").map(i => i.key);
      const linked = Array.from(new Set(base.flatMap(i => (Array.isArray(i.fields.issuelinks) ? i.fields.issuelinks : []))));
      if (epics.length || linked.length) mergeIssues((await relatedIssues(epics, linked)).issues);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
    setBusy(b => b - 1);
  };

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

  const allIssues = useMemo(() => [...Object.values(cache), ...(state?.created ?? [])], [cache, state?.created]);
  const byKey = useMemo(() => new Map(allIssues.map(i => [i.key, i])), [allIssues]);
  const stageOf = useMemo(() => makeStageResolver(allIssues, state?.mapping ?? {}), [allIssues, state?.mapping]);
  const defectsOf = useMemo(() => makeDefectsOf(defectIndex(allIssues)), [allIssues]);
  const list = state?.lists.find(l => l.id === activeId) ?? null;

  // Задачи списка, которых ещё нет, — из Jira; у загруженных — связанные (один раз).
  const listKeys = list?.keys.join(",") ?? "";
  useEffect(() => {
    if (jira.state !== "ok" || !list || !state) return;
    const drafts = new Set(state.created.map(i => i.key));
    const need = list.keys.filter(k => !cache[k] && !drafts.has(k) && !missing.has(k) && !inflight.current.has(k));
    const rel = list.keys.map(k => cache[k]).filter((i): i is Issue => !!i && !relatedDone.current.has(i.key));
    if (need.length || rel.length) void sync(need, rel);
  }, [jira.state, listKeys, cache, missing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Поля проекта списка — для выбора колонок.
  const listProject = list?.project ?? "";
  useEffect(() => {
    setProjectInput(listProject);
    if (jira.state !== "ok" || !listProject || projectFieldIds[listProject]) return;
    getProjectFields(listProject)
      .then(r => setProjectFieldIds(m => ({ ...m, [listProject]: r.fields })))
      .catch(() => { /* поля не загрузились — в выборе все поля сервера */ });
  }, [jira.state, listProject]); // eslint-disable-line react-hooks/exhaustive-deps

  /** «Обновить из Jira»: перечитать задачи списка и связанные, повторить упавшие. */
  const refreshFromJira = () => {
    if (!list || !state) return;
    inflight.current.clear(); relatedDone.current.clear();
    setMissing(new Set());
    const drafts = new Set(state.created.map(i => i.key));
    void sync(list.keys.filter(k => !drafts.has(k)), []);
  };

  const usage = useMemo(() => {
    const u: Record<string, number> = {};
    for (const l of state?.lists ?? []) for (const k of l.keys) { const p = l.assignees[k]; if (p) u[p] = (u[p] ?? 0) + 1; }
    return u;
  }, [state?.lists]);

  if (!state) return <Shell><div className="p-6 text-sm text-text-muted">Загрузка…</div></Shell>;

  const ctx: ColCtx | null = list ? { list, participants: state.participants, stageOf, defectsOf } : null;

  /* ── Колонки и группировка: поля проекта списка ── */
  const hasFolders = !!list?.folderList?.length;
  const fieldOptions: PickOption[] = list ? [
    ...listFields(list, projectFieldIds[list.project] ?? null).map(f => ({ value: `jira:${f.id}`, label: f.name, group: f.custom ? `Пользовательские поля ${list.project}` : "Поля Jira",
                                     hint: f.custom ? f.id.replace("customfield_", "cf ") : undefined })),
    // Поля, которые считает SimpleTest, — с пометкой (st): рядом с настоящим «Статусом» из Jira
    // стоит «Статус (st)», и их не перепутать.
    ...[STAGE_COL, DEFECTS_COL, BLOCK_COL, PARTICIPANT_COL, ...SPEND_COLS, ...(hasFolders ? [FOLDER_COL] : [])]
      .map(c => ({ value: c, label: colLabel(c, list), group: "Поля SimpleTest", hint: "st" })),
    ...list.ownFields.map(f => ({ value: `own:${f.id}`, label: f.name, group: "Свои поля списка", hint: `st · ${OWN_TYPE_LABEL[f.type]}` })),
  ] : [];
  // Папка — не группировка, а уровень над ней (разделы таблицы), поэтому в группировке её нет.
  // Числа и время (дефекты, трудозатраты) — не для группировки: у каждой задачи своё значение.
  const groupOptions = fieldOptions.filter(o => !["jira:summary", "jira:description", "jira:environment", DEFECTS_COL, FOLDER_COL, ...SPEND_COLS].includes(o.value));

  /* ── Задачи текущего списка с фильтром ── */
  const q = filter.trim().toLowerCase();
  const listIssues: Issue[] = list && ctx
    ? list.keys.map(k => byKey.get(k)).filter((i): i is Issue => !!i)
        .filter(i => !q || i.key.toLowerCase().includes(q) || list.columns.some(c => colValues(c, i, ctx).some(v =>
          v.toLowerCase().includes(q) || (jiraDateKind(c) !== null && fmtJiraDate(v).includes(q)))))
    : [];
  const foreign = list ? list.keys.filter(k => projectKeyOfIssue(k) !== list.project).length : 0;
  const selectedIssues = listIssues.filter(i => selected.has(i.key));
  const notFound = list ? list.keys.filter(k => missing.has(k) && !byKey.has(k)) : [];
  const pending = list ? list.keys.filter(k => !byKey.has(k) && !missing.has(k)).length : 0;

  /* ── Действия ── */
  const openList = (id: string) => { setActiveId(id); setSort(null); setFilter(""); setAskDelete(false); stopSelecting(); setRenaming(null); };

  const createList = () => {
    const name = (newList ?? "").trim();
    if (!name) return;
    const l = emptyList(name, list?.project);
    update(s => ({ ...s, lists: [...s.lists, l] }));
    openList(l.id); setNewList(null);
  };

  /** Поля задачи из формы — пока Jira не вернула свои (или для черновика). */
  const formFields = (d: IssueDraft) => ({
    summary: d.summary, description: d.description, issuetype: d.type, priority: d.priority || null,
    components: d.components, labels: d.labels, [epicLinkId()]: d.epicKey || null,
  });

  /**
   * Созданная в Jira задача: сразу в список с полями из формы, а через пару секунд
   * перечитываем её из Jira — статус и остальные поля проставляет Jira.
   */
  const addJiraIssue = (key: string, issue: Issue) => {
    mergeIssues([issue]);
    setTimeout(() => void sync([key], []), 2000);
  };

  /** Задача из формы «Создать задачу»: созданная в Jira — с настоящим ключом, иначе — черновик SimpleTest. */
  const saveIssue = (d: IssueDraft) => {
    if (!list) return;
    const now = nowStamp();
    const key = d.jira?.key ?? draftKey(list.project, state.nextKey);
    if (d.jira) addJiraIssue(key, { key, url: d.jira.url, fields: { ...formFields(d), created: now, updated: now } });
    update(s => ({
      ...s,
      created: d.jira ? s.created : [...s.created, { key, local: true, fields: { ...formFields(d), created: now, updated: now } }],
      nextKey: d.jira ? s.nextKey : s.nextKey + 1,
      lists: s.lists.map(l => l.id !== activeId ? l : {
        ...l, keys: [key, ...l.keys.filter(k => k !== key)],
        assignees: d.participantId ? { ...l.assignees, [key]: d.participantId } : l.assignees,
      }),
    }));
  };

  /** Черновик из списка → поля формы. */
  const draftOf = (i: Issue): IssueDraft & { key: string } => ({
    key: i.key,
    type: String(i.fields.issuetype ?? "Дефект"),
    summary: String(i.fields.summary ?? ""),
    description: String(i.fields.description ?? ""),
    priority: String(i.fields.priority ?? ""),
    labels: Array.isArray(i.fields.labels) ? i.fields.labels : [],
    epicKey: String(i.fields[epicLinkId()] ?? ""),
    components: Array.isArray(i.fields.components) ? i.fields.components : [],
    standType: "",
    participantId: list?.assignees[i.key] ?? "",
  });

  /** Сохранили черновик (обновить поля) или отправили его в Jira (заменить на настоящую задачу). */
  const saveDraft = (old: Issue, d: IssueDraft) => {
    const fields = { ...old.fields, ...formFields(d), updated: nowStamp() };
    if (d.jira) addJiraIssue(d.jira.key, { key: d.jira.key, url: d.jira.url, fields });
    update(s => {
      // Отправленный черновик становится задачей Jira: из черновиков уходит, всё SimpleTest-овое по ключу переезжает.
      const next = d.jira
        ? (r => ({ ...r, created: r.created.filter(i => i.key !== d.jira!.key) }))(replaceDraft(s, old.key, { key: d.jira.key, url: d.jira.url, fields }))
        : { ...s, created: s.created.map(i => (i.key === old.key ? { ...i, fields } : i)) };
      const key = d.jira?.key ?? old.key;
      return {
        ...next,
        lists: next.lists.map(l => l.id !== activeId ? l : {
          ...l, assignees: d.participantId ? { ...l.assignees, [key]: d.participantId }
            : Object.fromEntries(Object.entries(l.assignees).filter(([k]) => k !== key)),
        }),
      };
    });
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
        folderList: Array.from(new Set(items.map(i => i.folder))),
        columns: [...DEFAULT_COLUMNS, DEFECTS_COL, BLOCK_COL], groupBy: [],
      };
      update(s => ({ ...s, lists: [...s.lists, l] }));
      openList(l.id);
    } else {
      updateList(l => ({
        ...l,
        keys: [...l.keys, ...keys.filter(k => !l.keys.includes(k))],
        folders: { ...l.folders, ...folders },
        folderList: Array.from(new Set([...(l.folderList ?? []), ...items.map(i => i.folder)])),
        structure: meta,
      }));
    }
  };

  /** Повторный импорт той же структуры в текущий список: новые задачи и папки подтянутся. */
  const refreshStructure = () => {
    const st = list?.structure;
    if (!st) return;
    setBusy(b => b + 1);
    getStructureTree(st.id)
      .then(r => importStructure({ structure: { id: st.id, name: st.name }, items: flattenStructure(r.root), target: "current" }))
      .catch(e => setLoadErr(`Структура «${st.name}» не прочиталась: ${(e as Error).message}`))
      .finally(() => setBusy(b => b - 1));
  };

  const commitProject = () => {
    if (!list) return;
    const v = projectInput.trim().toUpperCase();
    const known = !projects.length || projects.some(p => p.key === v);
    if (/^[A-Z][A-Z0-9_]*$/.test(v) && known && v !== list.project) updateList(l => ({ ...l, project: v }));
    else setProjectInput(list.project);
  };

  /* ── Папки списка ── */
  const addFolder = () => {
    const name = (newFolder ?? "").trim();
    if (!name) return;
    updateList(l => ({ ...l, folderList: Array.from(new Set([...(l.folderList ?? []), name])) }));
    setNewFolder(null);
  };
  /** Переименование в уже существующее имя сливает папки. */
  const renameFolder = (name: string, next: string) => updateList(l => ({
    ...l,
    folderList: Array.from(new Set((l.folderList ?? []).map(f => (f === name ? next : f)))),
    folders: Object.fromEntries(Object.entries(l.folders ?? {}).map(([k, f]) => [k, f === name ? next : f])),
  }));
  const deleteFolder = (name: string) => updateList(l => ({
    ...l,
    folderList: (l.folderList ?? []).filter(f => f !== name),
    folders: Object.fromEntries(Object.entries(l.folders ?? {}).filter(([, f]) => f !== name)),
  }));
  const moveSelectedToFolder = (folder: string | null) => {
    updateList(l => [...selected].reduce((acc, k) => setFolder(acc, k, folder), l));
    setSelected(new Set());
  };

  /** Статусы сменены в Jira — перечитываем эти задачи (и связанные: этап эпика мог сдвинуться). */
  const afterTransitions = (keys: string[]) => {
    void sync(keys, []);
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
    <Shell>
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
            <span title={jira.state === "ok" ? `Jira подключена: ${jira.baseUrl}` : jira.state === "error" ? `Jira не подключена: ${jira.message}` : "Подключение к Jira…"}
              className="pb-2">
              <span className={`block w-2.5 h-2.5 rounded-full ${jira.state === "ok" ? "bg-emerald-500" : jira.state === "error" ? "bg-red-500" : "bg-amber-400 animate-pulse"}`} />
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
                {state.lists.map(l => askDeleteList === l.id ? (
                  <div key={l.id} className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-xs">
                    <span className="flex-1 min-w-0 truncate text-text-main">Удалить «{l.name}»?</span>
                    <button type="button" onClick={() => {
                      update(s => ({ ...s, lists: s.lists.filter(x => x.id !== l.id) }));
                      if (l.id === activeId) openList(state.lists.find(x => x.id !== l.id)?.id ?? "");
                      setAskDeleteList(null);
                    }} className="px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold">Да</button>
                    <button type="button" onClick={() => setAskDeleteList(null)} className="px-2 py-0.5 rounded-md border border-border-main text-text-muted">Нет</button>
                  </div>
                ) : (
                  <div key={l.id} className={`group/li flex items-center rounded-lg transition-colors
                    ${l.id === activeId ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                    <button type="button" onClick={() => openList(l.id)}
                      className={`flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left text-sm
                        ${l.id === activeId ? "text-primary font-medium" : "text-text-main"}`}>
                      {l.structure ? <FolderTree className="w-4 h-4 flex-shrink-0" /> : <LayoutList className="w-4 h-4 flex-shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{l.name}</span>
                        <span className="block text-[10px] text-text-muted font-normal">{l.project}</span>
                      </span>
                      <span className="text-[11px] text-text-muted group-hover/li:hidden">{l.keys.length}</span>
                    </button>
                    <button type="button" onClick={() => setAskDeleteList(l.id)} aria-label={`Удалить список ${l.name}`} title="Удалить список"
                      className="hidden group-hover/li:inline-flex focus-visible:inline-flex p-1.5 mr-1 rounded-md text-text-muted hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
                    <p className="text-xs font-semibold text-text-main">Папки</p>
                    <button type="button" onClick={() => setNewFolder("")} className="text-xs text-primary hover:underline">+ папка</button>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {!list.folderList?.length && newFolder === null && (
                      <span className="text-[11px] text-text-muted">Нет. Папки делят список на разделы; группировка — внутри каждой.</span>
                    )}
                    {(list.folderList ?? []).map(f => (
                      <span key={f} className="flex items-center gap-1.5 text-xs text-text-main px-1 py-0.5">
                        <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        <span className="truncate flex-1">{f}</span>
                        <span className="text-text-muted">{list.keys.filter(k => list.folders?.[k] === f).length}</span>
                      </span>
                    ))}
                    {newFolder !== null && (
                      <input autoFocus value={newFolder} onChange={e => setNewFolder(e.target.value)} aria-label="Название папки"
                        onBlur={() => (newFolder.trim() ? addFolder() : setNewFolder(null))}
                        onKeyDown={e => { if (e.key === "Enter") addFolder(); if (e.key === "Escape") setNewFolder(null); }}
                        placeholder="Название папки, Enter"
                        className="text-sm border border-primary/40 rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    )}
                  </div>
                </div>

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

            <div className="mt-auto text-[11px] text-text-muted leading-relaxed px-1 pb-1 space-y-1">
              {jira.state === "ok" ? (
                <p className="flex items-center gap-1.5 min-w-0" title={jira.baseUrl}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="truncate">Jira: {jira.baseUrl.replace(/^https?:\/\//, "")}</span>
                </p>
              ) : jira.state === "error" ? (
                <p className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /> Jira не подключена</p>
              ) : (
                <p>Подключение к Jira…</p>
              )}
              <p>Списки, участники, свои поля и черновики хранятся в этом браузере.</p>
              <button type="button" onClick={() => setSettingsOpen(true)} className="hover:text-text-main underline-offset-2 hover:underline">
                Настройки Jira
              </button>
            </div>
          </aside>
        )}

        {/* ── Список ── */}
        <main className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
          {jira.state === "error" && (
            <div role="alert" className="flex items-center gap-3 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="min-w-0 flex-1 text-text-main"><b>Jira не подключена.</b> {jira.message}</span>
              <button type="button" onClick={() => setSettingsOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold whitespace-nowrap">Настроить Jira</button>
              <button type="button" onClick={() => connect(true)}
                className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main whitespace-nowrap">Повторить</button>
            </div>
          )}
          {loadErr && jira.state === "ok" && (
            <div role="alert" className="flex items-center gap-3 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="min-w-0 flex-1 text-text-main">Ошибка Jira: {loadErr}</span>
              <button type="button" onClick={refreshFromJira} className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main whitespace-nowrap">Повторить</button>
              <button type="button" onClick={() => setLoadErr("")} aria-label="Скрыть" className="p-1 text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
            </div>
          )}
          {!list || !ctx ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-text-muted">
              <LayoutList className="w-8 h-8" />
              <p className="text-sm">Создайте первый список — например, «Дефекты релиза» или «Ретест на этой неделе».</p>
              <button type="button" onClick={() => { toggleAside(false); setNewList(""); }}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">Новый список</button>
            </div>
          ) : (
            <>
              {/* Шапка: проект и действия с задачами; на узком окне кнопки уходят строкой ниже */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <input value={projectInput} onChange={e => setProjectInput(e.target.value.toUpperCase())} list="jt-projects"
                  onBlur={commitProject} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setProjectInput(list.project); }}
                  aria-label="Проект списка" spellCheck={false}
                  title={`Проект списка: от него зависят поля, поиск и создание задач${projects.find(p => p.key === list.project) ? ` · ${projects.find(p => p.key === list.project)!.name}` : ""}`}
                  className="w-32 text-sm font-semibold uppercase border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <datalist id="jt-projects">{projects.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</datalist>
                <div className="min-w-[10rem] flex-1" title={list.name}>
                  <p className="text-sm font-semibold text-text-main truncate">{list.name}</p>
                  <p className="text-[11px] text-text-muted truncate">задач: {list.keys.length}
                    {foreign > 0 && <span title="Поля этих задач берутся из их проектов"> · из других проектов: {foreign}</span>}
                    {pending > 0 && busy > 0 && <> · загружаю из Jira: {pending}</>}
                    {q && <> · найдено: {listIssues.length}</>}
                    {sort && (
                      <> · сортировка: {colLabel(sort.col, list)} {sort.dir === 1 ? "↑" : "↓"}{" "}
                        <button type="button" onClick={() => setSort(null)} className="text-primary hover:underline"
                          title="Вернуть ручной порядок — тогда строки можно перетаскивать">сбросить</button></>
                    )}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button" onClick={refreshFromJira} disabled={jira.state !== "ok"} aria-label="Обновить из Jira"
                    title="Перечитать задачи списка из Jira" className="p-2 rounded-lg border border-border-main text-text-muted hover:text-primary disabled:opacity-40">
                    <RefreshCw className={`w-4 h-4 ${busy > 0 ? "animate-spin" : ""}`} />
                  </button>
                  <button type="button" onClick={() => setModal("import")} disabled={jira.state !== "ok"} title="Импорт структуры: все задачи с папками"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle whitespace-nowrap disabled:opacity-40">
                    <FolderTree className="w-4 h-4" /> Структура
                  </button>
                  <button type="button" onClick={() => setModal("add")} disabled={jira.state !== "ok"}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle whitespace-nowrap disabled:opacity-40">
                    <Plus className="w-4 h-4" /> Добавить задачи
                  </button>
                  <button type="button" onClick={() => setModal("create")}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 whitespace-nowrap">
                    <FilePlus2 className="w-4 h-4" /> Создать задачу
                  </button>
                </div>
              </div>

              {notFound.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={notFound.join(", ")}>
                    Не найдены в Jira (удалены, перенесены или нет прав): {notFound.join(", ")}
                  </span>
                  <button type="button" onClick={() => updateList(l => ({ ...l, keys: l.keys.filter(k => !notFound.includes(k)) }))}
                    className="px-2 py-1 rounded-md border border-amber-400 dark:border-amber-700 font-semibold whitespace-nowrap">Убрать из списка</button>
                </div>
              )}

              {selecting && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 animate-fade-in">
                  <ListChecks className="w-4 h-4 text-primary" />
                  <span className="text-sm text-text-main">
                    {selected.size ? <>Выбрано: <b>{selected.size}</b></> : "Отметьте задачи чекбоксами"}
                  </span>
                  <button type="button" onClick={() => setModal("bulk")} disabled={!selected.size}
                    className="ml-2 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">Сменить статус</button>
                  <button type="button" onClick={() => { updateList(l => ({ ...l, keys: l.keys.filter(k => !selected.has(k)) })); setSelected(new Set()); }}
                    disabled={!selected.size}
                    className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">Убрать из списка</button>
                  {!!list.folderList?.length && (
                    <select value="" onChange={e => e.target.value && moveSelectedToFolder(e.target.value === "__none__" ? null : e.target.value)}
                      aria-label="Переложить выбранные в папку" disabled={!selected.size}
                      className="px-2 py-1.5 rounded-lg border border-border-main text-sm text-text-main bg-[var(--color-input-bg)] disabled:opacity-40">
                      <option value="">В папку…</option>
                      {list.folderList.map(f => <option key={f} value={f}>{f}</option>)}
                      <option value="__none__">{NO_FOLDER}</option>
                    </select>
                  )}
                  <button type="button" onClick={stopSelecting}
                    className="ml-auto px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {list.keys.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border-main rounded-xl text-text-muted">
                    <p className="text-sm">Список пуст. Добавьте задачи проекта {list.project} из Jira, импортируйте структуру или создайте задачу.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setModal("add")} disabled={jira.state !== "ok"}
                        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">Добавить задачи</button>
                      <button type="button" onClick={() => setModal("import")} disabled={jira.state !== "ok"}
                        className="px-4 py-2 rounded-lg border border-border-main text-sm text-text-main disabled:opacity-40">Импорт структуры</button>
                    </div>
                  </div>
                ) : listIssues.length === 0 && !q ? (
                  <p className="text-sm text-text-muted p-4">
                    {busy > 0 ? "Загружаю задачи из Jira…" : jira.state === "ok" ? "Задачи списка не загрузились — нажмите «Обновить из Jira»." : "Задачи списка хранятся в Jira — подключите её, чтобы их увидеть."}
                  </p>
                ) : listIssues.length === 0 ? (
                  <p className="text-sm text-text-muted p-4">По «{filter}» в списке ничего нет.</p>
                ) : (
                  <ListTable key={list.id} ctx={ctx} issues={listIssues} sort={sort} onSort={setSort}
                    selecting={selecting} onToggleSelecting={() => (selecting ? stopSelecting() : setSelecting(true))}
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
                    })}
                    onMoveToFolder={(key, folder, target, place) => updateList(l => {
                      const moved = setFolder(l, key, folder);
                      return target ? { ...moved, keys: moveItem(moved.keys, key, target, place) } : moved;
                    })}
                    onResizeColumn={(col, w) => updateList(l => {
                      const widths = { ...l.widths };
                      if (w === null) delete widths[col]; else widths[col] = w;
                      return { ...l, widths };
                    })}
                    onRenameFolder={renameFolder}
                    onDeleteFolder={deleteFolder}
                    onMoveFolder={(name, target, place) => updateList(l => ({ ...l, folderList: moveItem(l.folderList ?? [], name, target, place) }))}
                    onOpenDraft={issue => setModal({ draft: issue })}
                    onSpend={(key, patch) => updateList(l => {
                      const cur = { ...l.spend?.[key] };
                      if ("plan" in patch) { if (patch.plan == null) delete cur.plan; else cur.plan = patch.plan; }
                      if ("start" in patch) { if (patch.start) cur.start = patch.start; else delete cur.start; }
                      if ("end" in patch) { if (patch.end) cur.end = patch.end; else delete cur.end; }
                      return { ...l, spend: { ...l.spend, [key]: cur } };
                    })}
                    onTogglePin={col => updateList(l => {
                      const p = l.pinned ?? [];
                      return { ...l, pinned: p.includes(col) ? p.filter(c => c !== col) : [...p, col] };
                    })}
                    onToggleWrap={fid => updateList(l => ({ ...l, ownFields: l.ownFields.map(f => (f.id === fid ? { ...f, wrap: !f.wrap } : f)) }))} />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {modal === "add" && list && (
        <AddIssuesModal open project={list.project} onClose={() => setModal(null)} inList={new Set(list.keys)}
          onAdd={issues => {
            mergeIssues(issues);
            updateList(l => ({ ...l, keys: [...l.keys, ...issues.map(i => i.key).filter(k => !l.keys.includes(k))] }));
          }} />
      )}
      {modal === "create" && list && (
        <IssueFormModal open project={list.project} participants={state.participants}
          onSave={saveIssue} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "draft" in modal && list && (
        <IssueFormModal open project={projectKeyOfIssue(modal.draft.key)} participants={state.participants}
          initial={draftOf(modal.draft)} onSave={d => saveDraft(modal.draft, d)} onClose={() => setModal(null)} />
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
        <BulkStatusModal open issues={selectedIssues} onClose={() => setModal(null)} onDone={afterTransitions} />
      )}
      {modal === "stages" && (
        <StageMappingModal open project={list?.project ?? "SBER911"} projects={state.lists.map(l => l.project)}
          mapping={state.mapping} onClose={() => setModal(null)}
          onSave={mapping => update(s => ({ ...s, mapping }))} />
      )}
      {modal && typeof modal === "object" && "defectsFor" in modal && (
        <DefectsModal open issue={modal.defectsFor} defects={defectsOf(modal.defectsFor) ?? []} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "own" in modal && (
        <OwnFieldModal open initial={modal.own} typeLocked={!!modal.own && ownUsed(modal.own.id)} onClose={() => setModal(null)}
          onSave={saveOwn} onDelete={modal.own ? () => deleteOwn(modal.own!.id) : undefined} />
      )}
      <JiraSettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); connect(true); }} />
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
        <LayoutList className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Jira tool</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
