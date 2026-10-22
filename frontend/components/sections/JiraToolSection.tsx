"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ChevronDown, SlidersHorizontal, ClipboardCheck, FileSpreadsheet, Download, Rocket, Upload, Columns3, Loader2, MessageSquareShare, FilePlus2, Folder, FolderTree, GitBranch, Layers, LayoutList, LayoutTemplate, ListChecks, PanelLeftClose,
  ListFilter, PanelLeftOpen, Pencil, Plus, RefreshCw, Search, Settings2, Trash2, Users, X,
} from "lucide-react";

import { PickerPanel, type PickOption } from "@/components/jiratool/FieldPicker";
import ListTable, { sortIssues, type SortState } from "@/components/jiratool/ListTable";
import type { FilterOption } from "@/components/jiratool/ColumnFilter";
import ReqAssignModal, { type ReqAssignMode } from "@/components/jiratool/ReqAssignModal";
import MsAssignModal from "@/components/jiratool/MsAssignModal";
import MsOverlapModal from "@/components/jiratool/MsOverlapModal";
import ViewSwitcher from "@/components/jiratool/ViewSwitcher";
import ListsNav from "@/components/jiratool/ListsNav";
import type { ReqOption } from "@/components/jiratool/ListCells";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { listRequirements } from "@/lib/api";
import AddIssuesModal, { type PickedSource } from "@/components/jiratool/AddIssuesModal";
import OwnFieldModal from "@/components/jiratool/OwnFieldModal";
import ParticipantsModal, { initials } from "@/components/jiratool/ParticipantsModal";
import IssueFormModal, { type IssueDraft } from "@/components/jiratool/IssueFormModal";
import BulkStatusModal from "@/components/jiratool/BulkStatusModal";
import StageMappingModal from "@/components/jiratool/StageMappingModal";
import ImportStructureModal, { type StructureImport } from "@/components/jiratool/ImportStructureModal";
import DefectsModal from "@/components/jiratool/DefectsModal";
import BackupModal from "@/components/BackupModal";
import { downloadBacklog } from "@/lib/backlogExport";
import { addMs, getMsCatalog } from "@/lib/standsApi";
import { isBackup } from "@/lib/backupApi";
import IssueModal from "@/components/jiratool/IssueModal";
import StageModal from "@/components/jiratool/StageModal";
import LoadSettingsModal from "@/components/jiratool/LoadSettingsModal";
import JiraSettingsModal from "@/components/settings/JiraSettingsModal";
import LoadDetailsModal from "@/components/jiratool/LoadDetailsModal";
import LoadRowView from "@/components/jiratool/LoadRowView";
import { getPeople, savePeople, saveJiraPeopleFields, type JiraPeopleFields } from "@/lib/peopleApi";
import { copyToClipboard } from "@/lib/clipboard";
import {
  BLOCK_COL, DEFAULT_COLUMNS, DEFAULT_PROJECT, DEFECTS_COL, ImportError, addView, applySourceCheck, exportLists, importLists, parseExportFile, composeRelease, deleteView, listViews, newId, renameView, switchView, releaseKeys, upsertSource, withoutMark, moveIssues, LOAD_COL, REQ_COL, MS_COL, msOverlaps, chatReport, checklistReport, folderSections, loadSkip,
  type ReportSection, listFromTemplate, templateOf, ROLE_COLS, defaultLoadRange, fmtMinutes, getTimeFmt, setTimeFmt, setTimeDay, type TimeFmt, listLoad, FOLDER_COL, OWN_TYPE_LABEL, PARTICIPANT_COL, STAGE_COL, colLabel,
  NO_FOLDER, applyGroupMove, categoryOf, colValues, setFolder, defectIndex, draftKey, emptyList, flattenStructure, listFields, loadState,
  epicLinkId, makeDefectsOf, moveItem, replaceDraft, fmtJiraDate, jiraDateKind, setCatalog,
  projectKeyOfIssue, saveState, migratePeople, nextColor, inDirection, calendarDays, TESTING, DIRECTION_ROLE, DIRECTIONS, directionAssignment, isCommonReserve, ownStageInfo,
  type ColCtx, type Issue, type LoadSettings, type OwnField, type Participant, type TaskList, type ToolState,
} from "@/lib/jiraTool";
import { applyStageStyles, blockingDefects, makeStageResolver, storiesByEpic, type Stage } from "@/lib/jiraStages";
import { getCatalog, getProjectFields, getProjects, getRelease, getStructureTree, issuesByKeys, relatedIssues, searchIssues, taskChecklist, writePeopleFields } from "@/lib/jiraToolApi";
import { dropSent, peopleFieldChanges, queuePeopleChanges } from "@/lib/jiraPeopleSync";
import { REFRESH_MS, bindCacheTo, issueCache, persistCache } from "@/lib/jiraToolCache";

/* ── Jira tool ─────────────────────────────────────────────────────────────
   Списки задач для планирования и назначения. Задачи, поля, статусы, переходы и
   структуры — из настоящей Jira (подключение и токен — Настройки → Jira, те же,
   что у регистрации дефектов). Списки, участники, свои поля, трудозатраты и
   черновики — у SimpleTest, в этом браузере.
   Шапка списка — проект и действия с задачами; всё, что настраивает вид списка
   (колонки, группировка, папки, свои поля, поиск), — в левой колонке. */

/**
 * Импорт структуры выключен: плагин Structure в Jira Сбера отвечает 403 на REST этого токена.
 * Код (бэкенд /api/jira/tool/structures и окно ImportStructureModal) оставлен — включить здесь,
 * когда доступ появится.
 */
const STRUCTURE_ENABLED = false;

type ModalState = null | "add" | "create" | "import" | "participants" | "bulk" | "stages" | "reqs" | "ms" | "msOverlaps" | "load" | "loadDetails" | { stageFor: Issue }
  | { own: OwnField | null } | { defectsFor: Issue } | { issueFor: Issue } | { draft: Issue };
type Panel = "columns" | "group" | null;

/** Свёрнута ли левая колонка — удобство конкретного человека, живёт в его браузере. */
const ASIDE_KEY = "st_jira_tool_aside";
/** Раскрыта ли «Настройка списка» вверху колонки — тоже удобство одного браузера. */
const LIST_SETUP_KEY = "st_jira_tool_list_setup";

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
  /**
   * Фильтры в заголовках колонок: колонка → отмеченные значения ("" — пусто). На время работы со списком:
   * сохранённый скрытый фильтр потом путал бы («куда делись задачи»). Сбрасываются при смене списка.
   */
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Режим выбора задач: чекбоксы в таблице и панель действий. Выход — снимает выбор. */
  const [selecting, setSelecting] = useState(false);
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const [modal, setModal] = useState<ModalState>(null);
  const [collapsed, setCollapsed] = useState(false);
  /** Настройка списка раскрыта (сверху колонки, по умолчанию — свёрнутая полоса). */
  const [listSetupOpen, setListSetupOpen] = useState(false);
  const toggleListSetup = (on: boolean) => { setListSetupOpen(on); try { localStorage.setItem(LIST_SETUP_KEY, on ? "1" : "0"); } catch { /* не запомнится */ } };
  const [panel, setPanel] = useState<Panel>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [askDeleteFolder, setAskDeleteFolder] = useState<string | null>(null);
  /* ── Экспорт и импорт списков файлом ── */
  const [exportMenu, setExportMenu] = useState(false);
  const [ioNote, setIoNote] = useState<{ ok: boolean; text: string } | null>(null);
  /** Резервная копия всего SimpleTest: окно открыто; файл, который импорт узнал как резервную копию. */
  const [backup, setBackup] = useState<{ file: File | null } | null>(null);
  /** Справочник микросервисов (общий с графиком стендов) — для поля «Микросервисы (st)». */
  const [msCatalog, setMsCatalog] = useState<{ ms: string[]; info: Record<string, string> }>({ ms: [], info: {} });
  useEffect(() => { getMsCatalog().then(setMsCatalog).catch(() => { /* бэкенд недоступен — поле работает без списка */ }); }, []);
  const createMs = async (names: string[]) => {
    const r = await addMs(names);
    setMsCatalog(c => ({ ...c, ms: r.ms }));
  };
  /** Формат трудозатрат («ч · мин» / «д · ч · мин»): сам формат — в lib/jiraTool, состояние — чтобы перерисовать таблицу. */
  const [timeFmt, setTimeFmtState] = useState<TimeFmt>(getTimeFmt);
  /** Создание дефекта из окна «Дефекты» задачи: эпику — Epic Link, стори и прочим — связь после создания. */
  const [defectFor, setDefectFor] = useState<Issue | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  /** Шаблон для нового списка ("" — пустой) и название сохраняемого шаблона (null — поле скрыто). */
  const [newTpl, setNewTpl] = useState("");
  const [tplName, setTplName] = useState<string | null>(null);
  const [tplNote, setTplNote] = useState("");

  /* ── Требования («Данные») и отчёты в чат ── */
  const { provider } = useWorkspace();
  const [reqOptions, setReqOptions] = useState<ReqOption[]>([]);
  useEffect(() => {
    listRequirements().then(r => setReqOptions(r.map(x => ({ id: x.id, name: x.name, feature: x.feature })))).catch(() => setReqOptions([]));
  }, []);
  /** Идёт генерация чек-листа: сколько фич готово из скольких. */
  const [reportBusy, setReportBusy] = useState<{ done: number; total: number } | null>(null);
  const [reportNote, setReportNote] = useState("");
  /** Текст, который браузер не дал скопировать сам (прошло много времени после нажатия) — копируем по кнопке. */
  const [pendingCopy, setPendingCopy] = useState<string | null>(null);
  const cancelReport = useRef(false);
  /** Готовые проверки по фиче в этой сессии: повторное нажатие не гоняет LLM заново, пока не поменялись требования. */
  const checksCache = useRef(new Map<string, { sig: string; checks: string[] }>());
  const [askDeleteList, setAskDeleteList] = useState<string | null>(null);

  /* ── Jira: подключение, справочники и задачи ── */
  const [jira, setJira] = useState<JiraConn>({ state: "loading" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<{ key: string; name: string }[]>([]);
  const [projectFieldIds, setProjectFieldIds] = useState<Record<string, string[]>>({});
  /**
   * Задачи из Jira: списка и связанные (стори эпиков, дефекты). Держатся в кэше сессии (lib/jiraToolCache):
   * вернулись в раздел или переключили список — данные сразу, свежие подтягиваются фоном раз в 30 минут.
   */
  const [cache, setCache] = useState<Record<string, Issue>>({});
  const [missing, setMissingState] = useState<Set<string>>(new Set());
  const [refreshedAt, setRefreshedAt] = useState(0);
  const setMissing = (fn: (m: Set<string>) => Set<string>) => setMissingState(m => {
    const n = fn(m);
    const c = issueCache(); c.missing = n; persistCache();
    return n;
  });
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
    const c = issueCache();
    setCache({ ...c.issues }); setMissingState(new Set(c.missing)); setRefreshedAt(c.refreshedAt);
    relatedDone.current = c.related;
    try { setCollapsed(localStorage.getItem(ASIDE_KEY) === "1"); } catch { /* развёрнута по умолчанию */ }
    try { setListSetupOpen(localStorage.getItem(LIST_SETUP_KEY) === "1"); } catch { /* свёрнута по умолчанию */ }
  }, []);

  const connect = (refresh = false) => {
    setJira({ state: "loading" });
    getCatalog(refresh)
      .then(c => {
        setCatalog(c);
        const store = bindCacheTo(c.base_url);       // сменили сервер Jira — кэш от старого сбрасывается
        setCache({ ...store.issues }); setMissingState(new Set(store.missing)); relatedDone.current = store.related;
        setJira({ state: "ok", baseUrl: c.base_url });
        getProjects().then(r => setProjects(r.projects)).catch(() => setProjects([]));
      })
      .catch(e => setJira({ state: "error", message: (e as Error).message }));
  };
  useEffect(() => { connect(); }, []);

  /*
   * Справочник людей живёт на бэкенде (/api/people), в состоянии — его копия: ячейки и нагрузка читают её синхронно.
   * Сначала читаем бэкенд; там пусто, а в браузере есть участники или фамилии направлений — первый запуск после
   * обновления: переносим их в справочник. Пока бэкенд не прочитан — ничего не сохраняем, чтобы не затереть его
   * копией из браузера (например, если сервер на секунду недоступен).
   */
  const peopleSaved = useRef<string | null>(null);
  const [peopleErr, setPeopleErr] = useState("");
  /** Направление → поле Jira, куда пишется имя человека в Jira (хранится в справочнике людей на бэкенде). */
  const [jiraFields, setJiraFields] = useState<JiraPeopleFields>({});
  const [jiraPeopleErr, setJiraPeopleErr] = useState("");
  const hasState = !!state;
  useEffect(() => {
    if (!hasState || peopleSaved.current !== null) return;
    let alive = true;
    getPeople().then(r => {
      if (!alive) return;
      setPeopleErr("");
      setJiraFields(r.jiraFields ?? {});
      update(s => {
        const legacy = s.participants.length > 0 || Object.values(s.roleNames).some(n => n.length > 0);
        const people = r.people.length || !legacy ? r.people : migratePeople(s.participants, s.roleNames);
        peopleSaved.current = r.people.length ? JSON.stringify(people) : "";   // перенесённое — сохранится ниже
        return { ...s, participants: people };
      });
    }, e => { if (alive) setPeopleErr(`Справочник людей не загрузился с сервера — изменения людей не сохранятся: ${(e as Error).message}`); });
    return () => { alive = false; };
  }, [hasState]);
  const people = state?.participants;
  useEffect(() => {
    if (!people || peopleSaved.current === null) return;
    const json = JSON.stringify(people);
    if (json === peopleSaved.current) return;
    const t = setTimeout(() => {
      savePeople(people).then(() => { peopleSaved.current = json; setPeopleErr(""); },
        e => setPeopleErr(`Справочник людей не сохранился на сервере: ${(e as Error).message}`));
    }, 400);
    return () => clearTimeout(t);
  }, [people]);

  /** Новый человек из ячейки направления: такое имя уже есть в справочнике — добавляем ему направление. */
  const addPerson = (dir: string, name: string): Participant => {
    const all = state?.participants ?? [];
    const hit = all.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    const person: Participant = hit
      ? { ...hit, directions: Array.from(new Set([...(hit.directions ?? [TESTING]), dir])) }
      : { id: newId("ptc"), name: name.trim(), role: DIRECTION_ROLE[dir] ?? "", color: nextColor(all), directions: [dir] };
    update(s => ({ ...s, participants: hit ? s.participants.map(p => (p.id === hit.id ? person : p)) : [...s.participants, person] }));
    return person;
  };
  const leaveDirection = (dir: string, pid: string) => update(s => ({
    ...s, participants: s.participants.map(p => (p.id === pid ? { ...p, directions: (p.directions ?? [TESTING]).filter(d => d !== dir) } : p)),
  }));

  const mergeIssues = (items: Issue[], drop: string[] = []) => setCache(c => {
    const n = { ...c };
    for (const i of items) n[i.key] = i;
    for (const k of drop) delete n[k];            // задачи, которых больше нет в Jira
    const store = issueCache(); store.issues = n; persistCache();
    return n;
  });
  // Первые данные из Jira в сессии (загрузка, релиз) — тоже «свежие»: иначе при возврате в раздел
  // сразу пошло бы полное обновление. Отметку ставим вне функции-обновления состояния.
  const markFresh = () => {
    const store = issueCache();
    if (!store.refreshedAt) { store.refreshedAt = Date.now(); persistCache(); setRefreshedAt(store.refreshedAt); }
  };

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
        mergeIssues(fresh, r.missing);
        markFresh();
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
  /**
   * Правка списка, которая может поменять людей задач (тестировщик, поля направлений): кроме списка — ставим
   * в очередь запись имён в Jira (lib/jiraPeopleSync.ts). Очередь уходит при обновлении из Jira (flushPeople).
   */
  const updateListPeople = (fn: (l: TaskList) => TaskList) => update(s => {
    const cur = s.lists.find(l => l.id === activeId);
    if (!cur) return s;
    const next = fn(cur);
    const diff = peopleFieldChanges(cur, next, s.participants, jiraFields);
    return {
      ...s, lists: s.lists.map(l => (l.id === activeId ? next : l)),
      jiraPending: diff.changes.length || diff.keep.length ? queuePeopleChanges(s.jiraPending ?? [], diff) : s.jiraPending,
    };
  });

  const allIssues = useMemo(() => [...Object.values(cache), ...(state?.created ?? [])], [cache, state?.created]);
  const byKey = useMemo(() => new Map(allIssues.map(i => [i.key, i])), [allIssues]);
  const defectIdx = useMemo(() => defectIndex(allIssues), [allIssues]);
  const byEpic = useMemo(() => storiesByEpic(allIssues), [allIssues]);
  // Свои названия и цвета статусов (st) — до расчёта этапов: от названия зависят группы и сортировка.
  const stageStyles = state?.stageStyles;
  const customStages = state?.customStages;
  const stageOf = useMemo(() => {
    applyStageStyles(stageStyles ?? {}, customStages ?? []);
    return makeStageResolver(allIssues, state?.mapping ?? {}, defectIdx, state?.stageManual ?? {});
  }, [allIssues, state?.mapping, defectIdx, stageStyles, customStages, state?.stageManual]);
  /**
   * Дефекты задачи — свои (Epic Link и связи) плюс блокирующие, которые она наследует: у эпика —
   * от его сторей, у стори — от её эпика. Так дефект, из-за которого задача «Заблокирована»,
   * всегда виден в «Дефекты (st)» — других мест показа дефектов нет.
   */
  const defectsOf = useMemo(() => {
    const own = makeDefectsOf(defectIdx);
    return (i: Issue): Issue[] | null => {
      const d = own(i);
      if (d === null) return null;
      const inherited = blockingDefects(i, defectIdx, byEpic).filter(x => !d.includes(x));
      return inherited.length ? [...d, ...inherited] : d;
    };
  }, [defectIdx, byEpic]);
  const list = state?.lists.find(l => l.id === activeId) ?? null;
  /** Изменений людей, ждущих записи в Jira (уйдут при обновлении). */
  const pendingPeople = state?.jiraPending?.length ?? 0;

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

  /**
   * Людей из очереди — в поля Jira. Перед каждым обновлением из Jira (ручным и фоновым): после него в списке уже
   * значения из Jira. Поля нет у задачи — молча; Jira отказала — баннер; Jira недоступна — очередь ждёт следующего раза.
   */
  const flushPeople = async () => {
    const sent = stateRef.current?.jiraPending ?? [];
    if (!sent.length) return;
    try {
      const r = await writePeopleFields(sent);
      update(s => ({ ...s, jiraPending: dropSent(s.jiraPending ?? [], sent, r.results) }));
      const bad = r.results.filter(x => x.ok === false);
      setJiraPeopleErr(bad.length ? bad.map(b => `${b.key}: ${b.error}`).join("; ") : "");
    } catch (e) {
      setJiraPeopleErr(`${(e as Error).message}. Отправим при следующем обновлении`);
    }
  };

  /** «Обновить из Jira»: отправить людей из очереди, перечитать задачи списка и связанные, повторить упавшие. */
  const refreshFromJira = () => {
    if (!list || !state) return;
    inflight.current.clear(); relatedDone.current.clear();
    setMissing(() => new Set());
    const drafts = new Set(state.created.map(i => i.key));
    const id = list.id;
    void flushPeople().then(() => sync(list.keys.filter(k => !drafts.has(k)), [])).then(() => checkSources([id]));
  };

  /**
   * Фоновое обновление кэша: все задачи всех списков и связанные — раз в 30 минут, пока раздел открыт,
   * и сразу при открытии, если кэш старше 30 минут. На экране остаются данные из кэша, пока идёт загрузка.
   */
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshAll = async () => {
    if (!stateRef.current) return;
    await flushPeople();
    const st = stateRef.current;
    if (!st) return;
    const drafts = new Set(st.created.map(i => i.key));
    const keys = Array.from(new Set(st.lists.flatMap(l => l.keys))).filter(k => !drafts.has(k));
    if (!keys.length) return;
    relatedDone.current.clear();
    await sync(keys, []);
    await checkSources(st.lists.map(l => l.id));
    const c = issueCache(); c.refreshedAt = Date.now(); persistCache();
    setRefreshedAt(c.refreshedAt);
  };
  useEffect(() => {
    if (jira.state !== "ok") return;
    if (Date.now() - issueCache().refreshedAt > REFRESH_MS && Object.keys(issueCache().issues).length) void refreshAll();
    const t = setInterval(() => void refreshAll(), REFRESH_MS);
    return () => clearInterval(t);
  }, [jira.state]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Сколько задач у человека во всех списках: тестировщиком и в полях направлений (одна задача — один раз). */
  const usage = useMemo(() => {
    const u: Record<string, number> = {};
    const people = state?.participants ?? [];
    for (const l of state?.lists ?? []) for (const k of l.keys) {
      const ids = new Set(DIRECTIONS.map(d => directionAssignment(l, d.id, k, people).pid).filter((x): x is string => !!x));
      ids.forEach(id => { u[id] = (u[id] ?? 0) + 1; });
    }
    return u;
  }, [state?.lists, state?.participants]);

  if (!state) return <Shell><div className="p-6 text-sm text-text-muted">Загрузка…</div></Shell>;

  const reqName = new Map(reqOptions.map(r => [r.id, r.name]));
  // Пересечения по микросервисам в текущем списке: виджет слева, окно с деталями, подсветка в ячейках.
  const overlaps = list ? msOverlaps(list.keys, state.msLinks) : [];
  const msShared = new Map(overlaps.map(o => [o.service.trim().replace(/\s+/g, " ").toLowerCase(), o.keys]));
  const ctx: ColCtx | null = list ? {
    list, participants: state.participants, stageOf, defectsOf,
    reqsOf: key => (state.reqLinks[key] ?? []).map(id => reqName.get(id) ?? "удалён"),
    msOf: key => state.msLinks[key] ?? [],
  } : null;

  /* ── Колонки и группировка: поля проекта списка ── */
  const hasFolders = !!list?.folderList?.length;
  const fieldOptions: PickOption[] = list ? [
    ...listFields(list, projectFieldIds[list.project] ?? null).map(f => ({ value: `jira:${f.id}`, label: f.name, group: f.custom ? `Пользовательские поля ${list.project}` : "Поля Jira",
                                     hint: f.custom ? f.id.replace("customfield_", "cf ") : undefined })),
    // Поля, которые считает SimpleTest, — с пометкой (st): рядом с настоящим «Статусом» из Jira
    // стоит «Статус (st)», и их не перепутать.
    ...[STAGE_COL, DEFECTS_COL, BLOCK_COL, PARTICIPANT_COL, ...ROLE_COLS, LOAD_COL, REQ_COL, MS_COL, ...(hasFolders ? [FOLDER_COL] : [])]
      .map(c => ({ value: c, label: colLabel(c, list), group: "Поля SimpleTest", hint: "st" })),
    ...list.ownFields.map(f => ({ value: `own:${f.id}`, label: f.name, group: "Свои поля списка", hint: `st · ${OWN_TYPE_LABEL[f.type]}` })),
  ] : [];
  // Папка — не группировка, а уровень над ней (разделы таблицы), поэтому в группировке её нет.
  // Числа и время (дефекты, трудозатраты) — не для группировки: у каждой задачи своё значение.
  // Ссылки тоже не группируем — у каждой задачи своя.
  const linkCols = list ? list.ownFields.filter(f => f.type === "link").map(f => `own:${f.id}`) : [];
  const groupOptions = fieldOptions.filter(o => ![
    "jira:summary", "jira:description", "jira:environment", DEFECTS_COL, FOLDER_COL, ...linkCols,
  ].includes(o.value));

  /* ── Задачи текущего списка с фильтром ── */
  const q = filter.trim().toLowerCase();
  const searched: Issue[] = list && ctx
    ? list.keys.map(k => byKey.get(k)).filter((i): i is Issue => !!i)
        .filter(i => !q || i.key.toLowerCase().includes(q) || list.columns.some(c => colValues(c, i, ctx).some(v =>
          v.toLowerCase().includes(q) || (jiraDateKind(c) !== null && fmtJiraDate(v).includes(q)))))
    : [];
  // Фильтр колонки, которой больше нет в списке (убрали из колонок), не действует.
  const activeFilters = Object.entries(colFilters).filter(([c]) => list?.columns.includes(c));
  const passes = (i: Issue, except?: string) => !ctx || activeFilters.every(([c, vals]) => {
    if (c === except) return true;
    const v = colValues(c, i, ctx);
    return v.length ? v.some(x => vals.includes(x)) : vals.includes("");
  });
  const listIssues: Issue[] = searched.filter(i => passes(i));
  /** Варианты фильтра колонки — по задачам, прошедшим остальные фильтры (как в Excel). */
  const filterOptions = (c: string): FilterOption[] => {
    if (!ctx) return [];
    const counts = new Map<string, number>();
    for (const i of searched) {
      if (!passes(i, c)) continue;
      const vals = colValues(c, i, ctx);
      for (const v of vals.length ? new Set(vals) : [""]) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const kind = jiraDateKind(c);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: !value ? "(пусто)" : kind ? fmtJiraDate(value, kind === "datetime") : value }))
      .sort((a, b) => (!a.value ? 1 : !b.value ? -1 : a.label.localeCompare(b.label, "ru", { numeric: true })));
  };
  const foreign = list ? list.keys.filter(k => projectKeyOfIssue(k) !== list.project).length : 0;
  const selectedIssues = listIssues.filter(i => selected.has(i.key));
  const notFound = list ? list.keys.filter(k => missing.has(k) && !byKey.has(k)) : [];
  const pending = list ? list.keys.filter(k => !byKey.has(k) && !missing.has(k)).length : 0;

  /* ── Действия ── */
  const openList = (id: string) => { setActiveId(id); setSort(null); setFilter(""); setColFilters({}); setAskDelete(false); stopSelecting(); setRenaming(null); setTplName(null); };

  const createList = () => {
    const name = (newList ?? "").trim();
    if (!name) return;
    const tpl = state?.templates.find(t => t.id === newTpl);
    const l = tpl ? listFromTemplate(name, list?.project ?? DEFAULT_PROJECT, tpl) : emptyList(name, list?.project);
    update(s => ({ ...s, lists: [...s.lists, l] }));
    openList(l.id); setNewList(null); setNewTpl("");
  };

  /** Списки и весь справочник людей → файл .json: скачивается браузером, его можно переслать коллеге. ids пустой — только люди. */
  const exportToFile = (ids: string[]) => {
    if (!state || (!ids.length && !state.participants.length)) return;
    const data = exportLists(state, ids);
    const one = !ids.length ? "справочник людей" : ids.length === 1 ? state.lists.find(l => l.id === ids[0])?.name ?? "список" : "списки";
    const safe = one.replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 60) || "список";
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `SimpleTest — ${safe} — ${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setExportMenu(false);
    const people = `людей в справочнике: ${state.participants.length}`;
    setIoNote({ ok: true, text: !ids.length ? `Справочник сохранён в файл — ${people}`
      : ids.length === 1 ? `Список «${one}» сохранён в файл, ${people}` : `Списков в файле: ${ids.length}, ${people}` });
  };

  /** Файл → списки добавляются новыми; ничего у получателя не затирается. */
  const importFromFile = async (file: File) => {
    try {
      const text = await file.text();
      try { if (isBackup(JSON.parse(text))) { setBackup({ file }); return; } } catch { /* не JSON — скажет parseExportFile */ }
      const f = parseExportFile(text);
      const cur = stateRef.current;
      if (!cur) return;
      // Считаем один раз (у импортированных списков новые id) и подставляем готовое состояние.
      const r = importLists(cur, f);
      update(() => r.state);
      if (f.lists.length) openList(r.state.lists[r.state.lists.length - f.lists.length].id);
      const people = r.peopleAdded ? `новых людей в справочнике: ${r.peopleAdded}` : "новых людей нет — все уже в справочнике";
      setIoNote({ ok: true, text: f.lists.length
        ? `Добавлено списков: ${f.lists.length} — ${f.lists.map(l => `«${l.name}»`).join(", ")}; ${people}`
        : `Справочник из файла: ${people}` });
    } catch (e) {
      setIoNote({ ok: false, text: e instanceof ImportError ? e.message : `Файл не прочитался: ${(e as Error).message}` });
    }
  };

  /** Структура текущего списка → шаблон. Шаблон с тем же названием перезаписывается. */
  const saveTemplate = () => {
    const name = (tplName ?? "").trim();
    if (!list || !name) return;
    const tpl = templateOf(list, name);
    const replaced = state?.templates.some(t => t.name === name);
    update(s => ({ ...s, templates: [...s.templates.filter(t => t.name !== name), tpl] }));
    setTplName(null);
    setTplNote(replaced ? `Шаблон «${name}» обновлён` : `Шаблон «${name}» сохранён`);
    setTimeout(() => setTplNote(""), 3000);
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
    // Создали в Jira без галочки «Добавить в список» — в списке ничего не меняем.
    if (d.jira && d.addToList === false) return;
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

  /**
   * Сверка источников (JQL-фильтров и релизов) списков с Jira: новые задачи встают с «n» в «Без папки»,
   * выпавшие помечаются «У». Идёт вместе с обновлением кэша — фоновым и по кнопке «Обновить из Jira».
   */
  const checkSources = async (listIds: string[]) => {
    const st = stateRef.current;
    if (!st) return;
    const errors: string[] = [];
    for (const l of st.lists.filter(x => listIds.includes(x.id))) {
      for (const src of l.sources ?? []) {
        try {
          let keys: string[], truncated = false;
          if (src.kind === "jql") {
            const r = await searchIssues(src.query, 1000);
            mergeIssues(r.issues);
            keys = r.issues.map(i => i.key); truncated = r.truncated;
          } else {
            const d = await getRelease(src.query, l.project);
            mergeIssues([...d.issues, ...d.epics]);
            keys = releaseKeys(composeRelease(d.issues, d.epics, d.epic_link)); truncated = d.truncated;
          }
          const now = nowStamp();
          update(s => ({ ...s, lists: s.lists.map(x => (x.id === l.id ? applySourceCheck(x, src.id, keys, truncated, now) : x)) }));
        } catch (e) { errors.push(`${src.kind === "jql" ? "фильтр" : "релиз"} «${src.name.slice(0, 60)}»: ${(e as Error).message}`); }
      }
    }
    if (errors.length) setLoadErr(`Состав источников не сверен — ${errors.join("; ")}`);
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
  /** Требования по задачам: на уровне SimpleTest (общие на все списки). */
  /** Микросервисы задач: «set» — значение ячейки; add / replace / remove — массово для выбранных (как требования). */
  const setMs = (keys: string[], names: string[], mode: ReqAssignMode | "set") => update(s => {
    const links = { ...s.msLinks };
    const key = (n: string) => n.trim().toLowerCase();
    for (const k of keys) {
      const cur = links[k] ?? [];
      const next = mode === "set" || mode === "replace" ? names
        : mode === "add" ? [...cur, ...names.filter(n => !cur.some(c => key(c) === key(n)))]
        : cur.filter(c => !names.some(n => key(n) === key(c)));
      if (next.length) links[k] = next; else delete links[k];
    }
    return { ...s, msLinks: links };
  });

  const setReqs = (keys: string[], ids: string[], mode: ReqAssignMode | "set") => update(s => {
    const links = { ...s.reqLinks };
    for (const k of keys) {
      const cur = links[k] ?? [];
      const next = mode === "set" || mode === "replace" ? ids
        : mode === "add" ? Array.from(new Set([...cur, ...ids])) : cur.filter(x => !ids.includes(x));
      if (next.length) links[k] = next; else delete links[k];
    }
    return { ...s, reqLinks: links };
  });

  /* ── Отчёт в чат и чек-лист: только отмеченные задачи, в порядке таблицы, по папкам ── */
  const reportSections = (): ReportSection[] => {
    if (!list || !ctx) return [];
    const all = list.keys.map(k => byKey.get(k)).filter((i): i is Issue => !!i);
    const chosen = sortIssues(all, sort, ctx).filter(i => selected.has(i.key));
    return list.folderList?.length
      ? folderSections(list, chosen).map(sec => ({ folder: sec.name ?? NO_FOLDER, issues: sec.issues }))
      : [{ folder: null, issues: chosen }];
  };

  const copyText = copyToClipboard;

  const deliver = async (text: string, note: string) => {
    if (await copyText(text)) { setPendingCopy(null); setReportNote(note); }
    else { setPendingCopy(text); setReportNote("Браузер не дал скопировать автоматически — нажмите «Скопировать»."); }
  };

  /** Выбранные задачи — в .xlsx по формату «Бэклога Платформы» (lib/backlogExport.ts). */
  const exportExcel = async () => {
    if (!ctx || !list) return;
    const issues = reportSections().flatMap(x => x.issues);
    try {
      const name = await downloadBacklog(list.name, issues, ctx);
      setReportNote(`Выгружено в Excel: задач ${issues.length} — ${name}`);
    } catch (e) { setReportNote((e as Error).message); }
  };

  const copyChatReport = async () => {
    if (!ctx) return;
    const sections = reportSections();
    const n = sections.reduce((a, x) => a + x.issues.length, 0);
    await deliver(chatReport(sections, ctx), `Скопировано для чата: задач ${n}.`);
  };

  /**
   * Чек-лист: у фич с требованиями и при выбранной модели — критически важные проверки от LLM
   * (по одной фиче за раз, с прогрессом); у остальных — только «Результат проверок:».
   */
  const copyChecklist = async () => {
    if (!state) return;
    const sections = reportSections();
    const all = sections.flatMap(x => x.issues);
    const withReqs = all.filter(i => (state.reqLinks[i.key] ?? []).some(id => reqName.has(id)));
    const checks: Record<string, string[]> = {};
    let failed = 0, firstErr = "";
    cancelReport.current = false;
    setReportNote(""); setPendingCopy(null);
    if (withReqs.length && provider) {
      setReportBusy({ done: 0, total: withReqs.length });
      for (const [n, i] of withReqs.entries()) {
        if (cancelReport.current) break;
        const ids = (state.reqLinks[i.key] ?? []).filter(id => reqName.has(id));
        const sig = `${ids.join(",")}|${String(i.fields.summary ?? "")}`;
        const hit = checksCache.current.get(i.key);
        if (hit?.sig === sig) checks[i.key] = hit.checks;
        else {
          try {
            const r = await taskChecklist({ key: i.key, summary: String(i.fields.summary ?? i.key), requirement_ids: ids, provider });
            checks[i.key] = r.checks;
            checksCache.current.set(i.key, { sig, checks: r.checks });
          } catch (e) { failed++; firstErr ||= (e as Error).message; }
        }
        setReportBusy({ done: n + 1, total: withReqs.length });
      }
      setReportBusy(null);
    }
    const done = Object.keys(checks).length;
    const parts = [`Чек-лист скопирован: фич ${all.length}`];
    if (withReqs.length && !provider) parts.push("модель не выбрана — проверки не сгенерированы");
    else if (withReqs.length) parts.push(`с проверками ${done}`);
    if (cancelReport.current) parts.push("генерация прервана");
    if (failed) parts.push(`не сгенерировано ${failed}: ${firstErr.slice(0, 120)}`);
    await deliver(checklistReport(sections, checks), parts.join(" · ") + ".");
  };

  /** Исключить задачи из нагрузки (skip) или вернуть. */
  const setNoLoad = (keys: string[], skip: boolean) => updateList(l => {
    const n = { ...l.noLoad };
    for (const k of keys) { if (skip) n[k] = true; else delete n[k]; }
    return { ...l, noLoad: n };
  });

  const moveSelectedToFolder = (folder: string | null) => {
    updateList(l => [...selected].reduce((acc, k) => setFolder(acc, k, folder), l));
    setSelected(new Set());
  };

  /** Перенести задачи открытого списка в другой: выбранные — из панели выбора, или перетащенные на список слева. */
  const moveToList = (toId: string, keys: string[]) => {
    if (!activeId || !keys.length) return;
    update(st => moveIssues(st, activeId, toId, keys));
    setSelected(p => { const n = new Set(p); keys.forEach(k => n.delete(k)); return n; });
  };

  /** Статусы сменены в Jira — перечитываем эти задачи (и связанные: этап эпика мог сдвинуться). */
  /** Статус (st) руками; null — вернуть расчёт по Jira. */
  const setStageManual = (key: string, st: Stage | null) => update(s => {
    const m = { ...s.stageManual };
    if (st) m[key] = st; else delete m[key];
    return { ...s, stageManual: m };
  });

  // Выбор не сбрасываем: окно остаётся открытым для следующего шага. Сброс — при закрытии окна.
  const afterTransitions = (keys: string[]) => { void sync(keys, []); };

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

  // «д · ч · мин» считает день по норме из настроек нагрузки — до отрисовки ячеек.
  if (state) setTimeDay(state.loadSettings.dayMinutes);

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
            <button type="button" onClick={() => setModal("participants")} aria-label="Справочник людей"
              title={`Справочник людей: ${state.participants.map(p => p.name).join(", ") || "пока никого"}`}
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
            {/*
              Настройка списка — самой верхней полосой, свёрнута по умолчанию (экономит место): щелчок — раскрывается
              привычный виджет, всё ниже сдвигается. Раскрыта ли — удобство одного браузера (LIST_SETUP_KEY).
            */}
            {list && (
              <div className={`bg-bg-card border rounded-xl flex flex-col ${listSetupOpen ? "border-primary/30" : "border-border-main"}`}>
                <button type="button" onClick={() => toggleListSetup(!listSetupOpen)} aria-expanded={listSetupOpen}
                  title={listSetupOpen ? "Свернуть настройку списка" : "Колонки, группировка, папки, свои поля, шаблон"}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl hover:bg-bg-subtle/60">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">Настройка списка</span>
                  <span className="min-w-0 flex-1 text-xs text-text-main truncate text-right">{listSetupOpen ? "" : list.name}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${listSetupOpen ? "rotate-180" : ""}`} />
                </button>
                {listSetupOpen && (
                  <div className="px-3 pb-3 flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-center gap-1 min-w-0">
                    {renaming !== null ? (
                      <input autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} aria-label="Название списка"
                        onBlur={() => { if (renaming.trim()) updateList(l => ({ ...l, name: renaming.trim() })); setRenaming(null); }}
                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                        className="min-w-0 flex-1 text-sm font-semibold bg-[var(--color-input-bg)] border border-primary/40 rounded-lg px-2 py-1 text-text-main focus:outline-none" />
                    ) : (
                      <p className="min-w-0 flex-1 text-sm font-semibold text-text-main truncate" title={list.name}>{list.name}</p>
                    )}
                    <button type="button" onClick={() => setTplName(t => (t === null ? list.name : null))} aria-label="Сохранить как шаблон"
                      aria-pressed={tplName !== null} title="Сохранить как шаблон: колонки, свои поля и папки (без задач)"
                      className={`p-1 rounded-md hover:text-primary ${tplName !== null ? "text-primary" : "text-text-muted"}`}>
                      <LayoutTemplate className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setRenaming(list.name)} aria-label="Переименовать список" title="Переименовать список"
                      className="p-1 rounded-md text-text-muted hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => setAskDelete(true)} aria-label="Удалить список" title="Удалить список"
                      className="p-1 rounded-md text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {tplName !== null && (
                    <div className="flex flex-col gap-1.5 -mt-1 p-2 rounded-lg bg-bg-subtle">
                      <p className="text-[11px] text-text-muted">
                        В шаблон попадут колонки по порядку ({list.columns.length}), свои поля ({list.ownFields.length}) и папки
                        ({list.folderList?.length ?? 0}). Задачи и значения — нет.
                      </p>
                      <div className="flex gap-1.5">
                        <input autoFocus value={tplName} onChange={e => setTplName(e.target.value)} maxLength={60}
                          onKeyDown={e => { if (e.key === "Enter") saveTemplate(); if (e.key === "Escape") setTplName(null); }}
                          placeholder="Название шаблона" aria-label="Название шаблона"
                          className="min-w-0 flex-1 text-sm border border-primary/40 rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <button type="button" onClick={saveTemplate} disabled={!tplName.trim()}
                          className="px-2.5 rounded-md bg-primary text-white text-xs font-semibold disabled:opacity-40">Сохранить</button>
                      </div>
                      {state.templates.some(t => t.name === tplName.trim()) && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">Шаблон с таким названием есть — он будет заменён.</p>
                      )}
                    </div>
                  )}
                  {tplNote && <p className="text-[11px] text-emerald-700 dark:text-emerald-300 -mt-1" role="status">{tplNote}</p>}
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
                  {activeFilters.length > 0 && (
                    <p className="flex items-center gap-1.5 px-1 text-[11px] text-primary">
                      <ListFilter className="w-3.5 h-3.5" />
                      Фильтр по колонкам: {activeFilters.map(([c]) => colLabel(c, list)).join(", ")}
                      <button type="button" onClick={() => setColFilters({})} className="ml-auto text-text-muted hover:text-text-main underline">сбросить</button>
                    </p>
                  )}

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
                      {(list.folderList ?? []).map(f => {
                        const n = list.keys.filter(k => list.folders?.[k] === f).length;
                        return askDeleteFolder === f ? (
                          <div key={f} className="flex flex-col gap-1 px-2 py-1.5 rounded-md bg-red-50 dark:bg-red-950/40 text-xs">
                            <span className="text-text-main">
                              Удалить папку «{f}»?{n > 0 && <> Задачи ({n}) останутся в списке — в разделе «{NO_FOLDER}».</>}
                            </span>
                            <span className="flex gap-1.5">
                              <button type="button" onClick={() => { deleteFolder(f); setAskDeleteFolder(null); }}
                                className="px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold">Удалить</button>
                              <button type="button" onClick={() => setAskDeleteFolder(null)}
                                className="px-2 py-0.5 rounded-md border border-border-main text-text-muted">Нет</button>
                            </span>
                          </div>
                        ) : (
                          <span key={f} className="group/fd flex items-center gap-1.5 text-xs text-text-main px-1 py-0.5 rounded-md hover:bg-bg-subtle">
                            <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                            <span className="truncate flex-1">{f}</span>
                            <span className="text-text-muted group-hover/fd:hidden">{n}</span>
                            <button type="button" onClick={() => setAskDeleteFolder(f)} aria-label={`Удалить папку ${f}`} title="Удалить папку"
                              className="hidden group-hover/fd:inline-flex focus-visible:inline-flex p-0.5 rounded text-text-muted hover:text-red-500">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        );
                      })}
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

                  {!!list.sources?.length && (
                    <div className="border-t border-border-main pt-2">
                      <p className="text-xs font-semibold text-text-main mb-1"
                        title="При обновлении из Jira (по кнопке и фоном раз в 30 минут) состав сверяется: новые — «n», выпавшие — «У»">
                        Источники · сверка состава
                      </p>
                      <div className="flex flex-col gap-0.5">
                        {list.sources.map(src => (
                          <span key={src.id} className="group/src flex items-start gap-1.5 text-[11px] text-text-muted py-0.5"
                            title={`${src.kind === "jql" ? "JQL" : "Релиз"}: ${src.name}\nЗадач в составе: ${src.keys.length} · сверено ${src.checkedAt}`}>
                            {src.kind === "jql" ? <Search className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" /> : <Rocket className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />}
                            <span className={`flex-1 min-w-0 truncate text-text-main ${src.kind === "jql" ? "font-mono" : ""}`}>{src.name}</span>
                            <span className="flex-shrink-0">{src.keys.length}</span>
                            <button type="button" aria-label={`Не отслеживать: ${src.name}`} title="Не отслеживать состав (задачи останутся в списке)"
                              onClick={() => updateList(l => ({ ...l, sources: (l.sources ?? []).filter(x => x.id !== src.id) }))}
                              className="hidden group-hover/src:inline-flex focus-visible:inline-flex p-0.5 rounded hover:text-red-500">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {STRUCTURE_ENABLED && list.structure && (
                    <div className="text-[11px] text-text-muted flex items-start gap-1.5 border-t border-border-main pt-2">
                      <FolderTree className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                      <span className="flex-1">Из структуры «{list.structure.name}» · {list.structure.importedAt}</span>
                      <button type="button" onClick={refreshStructure} title="Подтянуть новые задачи и папки"
                        className="p-0.5 rounded hover:text-primary"><RefreshCw className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                  </div>
                )}
              </div>
            )}

            <div className="bg-bg-card border border-border-main rounded-xl p-2 flex flex-col gap-0.5">
              <div className="flex items-center justify-between pl-2 pr-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted py-1">Списки</p>
                <button type="button" onClick={() => toggleAside(true)} aria-label="Свернуть колонку" title="Свернуть колонку  ["
                  className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle">
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
              <ListsNav
                items={state.lists.map(l => ({ id: l.id, name: l.name, project: l.project, count: l.keys.length, structure: !!l.structure }))}
                activeId={activeId} askDeleteId={askDeleteList}
                onOpen={openList} onAskDelete={setAskDeleteList} onCancelDelete={() => setAskDeleteList(null)}
                onConfirmDelete={id => {
                  update(s => ({ ...s, lists: s.lists.filter(x => x.id !== id) }));
                  if (id === activeId) openList(state.lists.find(x => x.id !== id)?.id ?? "");
                  setAskDeleteList(null);
                }}
                onDropIssues={moveToList}
                onRename={(id, name) => update(s => ({ ...s, lists: s.lists.map(x => (x.id === id ? { ...x, name } : x)) }))}
                onMove={(id, target, place) => update(s => {
                  const byId = new Map(s.lists.map(x => [x.id, x]));
                  const ids = moveItem(s.lists.map(x => x.id), id, target, place);
                  return { ...s, lists: ids.map(x => byId.get(x)!) };
                })} />
              {newList === null ? (
                <div className="relative flex items-center">
                  <button type="button" onClick={() => setNewList("")}
                    className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-text-muted hover:text-primary">
                    <Plus className="w-4 h-4" /> Новый список
                  </button>
                  <input ref={importInput} type="file" accept=".json,application/json" className="hidden" aria-hidden tabIndex={-1}
                    onChange={e => { const f = e.target.files?.[0]; if (f) void importFromFile(f); e.target.value = ""; }} />
                  <button type="button" onClick={() => importInput.current?.click()} aria-label="Импорт списков из файла"
                    title="Импорт: списки и люди из файла .json (списки добавятся новыми, люди — в справочник; ваше не затрётся)"
                    className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle"><Upload className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setExportMenu(m => !m)} aria-label="Экспорт списков в файл" aria-expanded={exportMenu}
                    disabled={!state.lists.length && !state.participants.length}
                    title="Экспорт: списки и справочник людей в файл .json, чтобы переслать или не потерять"
                    className="p-1.5 mr-0.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle disabled:opacity-40"><Download className="w-4 h-4" /></button>
                  {exportMenu && (
                    <div className="absolute z-30 right-0 top-full mt-1 w-64 rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-1 animate-fade-in">
                      <button type="button" onClick={() => list && exportToFile([list.id])} disabled={!list}
                        className="w-full text-left px-2.5 py-1.5 rounded text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40 truncate">
                        Текущий список{list ? ` «${list.name}»` : ""}
                      </button>
                      <button type="button" onClick={() => exportToFile(state.lists.map(l => l.id))}
                        className="w-full text-left px-2.5 py-1.5 rounded text-sm text-text-main hover:bg-bg-subtle">
                        Все списки ({state.lists.length})
                      </button>
                      <button type="button" onClick={() => exportToFile([])} disabled={!state.participants.length}
                        className="w-full text-left px-2.5 py-1.5 rounded text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
                        Только справочник людей ({state.participants.length})
                      </button>
                      <p className="px-2.5 pt-1 pb-0.5 text-[10px] text-text-muted border-t border-border-main mt-1">
                        Справочник людей и резервы нагрузки уходят в файл всегда — он общий на все списки.</p>
                      <button type="button" onClick={() => { setExportMenu(false); setBackup({ file: null }); }}
                        className="w-full text-left px-2.5 py-1.5 mt-1 rounded text-sm text-text-main hover:bg-bg-subtle border-t border-border-main">
                        Резервная копия: весь Jira tool или все разделы…
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mx-1 flex flex-col gap-1.5 py-1">
                  <input autoFocus value={newList} onChange={e => setNewList(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") createList(); if (e.key === "Escape") { setNewList(null); setNewTpl(""); } }}
                    placeholder="Название, Enter" aria-label="Название нового списка"
                    className="text-sm border border-primary/40 rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  {state.templates.length > 0 && (
                    <select value={newTpl} onChange={e => setNewTpl(e.target.value)} aria-label="Шаблон нового списка"
                      className="text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main">
                      <option value="">Без шаблона — пустой список</option>
                      {state.templates.map(t => <option key={t.id} value={t.id}>Шаблон: {t.name}</option>)}
                    </select>
                  )}
                  <div className="flex gap-1.5">
                    <button type="button" onClick={createList} disabled={!newList.trim()}
                      className="px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold disabled:opacity-40">Создать</button>
                    <button type="button" onClick={() => { setNewList(null); setNewTpl(""); }}
                      className="px-2.5 py-1 rounded-md border border-border-main text-xs text-text-muted">Отмена</button>
                  </div>
                </div>
              )}
              {ioNote && (
                <p role="status" className={`mx-2 my-1 text-[11px] ${ioNote.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>
                  {ioNote.text}
                  <button type="button" onClick={() => setIoNote(null)} aria-label="Скрыть" className="ml-1.5 text-text-muted hover:text-text-main">×</button>
                </p>
              )}
              {state.templates.length > 0 && (
                <div className="border-t border-border-main mt-1 pt-1.5 px-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-1">Шаблоны</p>
                  <div className="flex flex-col gap-0.5">
                    {state.templates.map(t => (
                      <span key={t.id} className="group/tp flex items-center gap-1.5 text-xs text-text-main py-0.5"
                        title={`Колонок: ${t.columns.length} · своих полей: ${t.ownFields.length} · папок: ${t.folderList.length}`}>
                        <LayoutTemplate className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                        <span className="truncate flex-1">{t.name}</span>
                        <button type="button" onClick={() => update(s => ({ ...s, templates: s.templates.filter(x => x.id !== t.id) }))}
                          aria-label={`Удалить шаблон ${t.name}`} title="Удалить шаблон (списки, созданные по нему, не изменятся)"
                          className="hidden group-hover/tp:inline-flex focus-visible:inline-flex p-0.5 rounded text-text-muted hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-bg-card border border-border-main rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Тестировщики</p>
                <button type="button" onClick={() => setModal("participants")} title="Справочник людей: тестировщики и люди направлений"
                  className="text-xs text-primary hover:underline">Справочник</button>
              </div>
              {peopleErr && <p className="mb-2 text-[11px] text-red-600 dark:text-red-400">{peopleErr}</p>}
              <div className="flex flex-wrap gap-1.5">
                {!state.participants.some(p => inDirection(p, TESTING)) && <span className="text-xs text-text-muted">Пока никого</span>}
                {state.participants.filter(p => inDirection(p, TESTING)).map(p => (
                  <span key={p.id} title={`${p.name}${p.role ? ` · ${p.role}` : ""} · задач: ${usage[p.id] ?? 0}`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: p.color }}>
                    {initials(p.name)}
                  </span>
                ))}
              </div>
            </div>

            {list && (
              <LoadPanel list={list} participants={state.participants} settings={state.loadSettings} onSettings={() => setModal("load")}
                skip={key => loadSkip(list, byKey.get(key), stageOf)}
                onRange={load => updateList(l => ({ ...l, load }))}
                onDetails={() => setModal("loadDetails")} />
            )}

            {/* Пересечения по микросервисам: сколько микросервисов указано у нескольких задач списка → окно с деталями */}
            {list && list.keys.some(k => state.msLinks[k]?.length) && (
              <button type="button" onClick={() => setModal("msOverlaps")}
                title="Микросервисы, которые трогают несколько задач списка: какие фичи и в каком они статусе"
                className="bg-bg-card border border-border-main rounded-xl px-3 py-2.5 text-left hover:border-primary/40">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-text-muted">Пересечения по микросервисам</span>
                <span className="flex items-baseline gap-2">
                  <b className={`text-2xl tabular-nums ${overlaps.length ? "text-amber-600 dark:text-amber-400" : "text-text-main"}`}>{overlaps.length}</b>
                  <span className="text-xs text-text-muted">{overlaps.length ? `задач в них: ${new Set(overlaps.flatMap(o => o.keys)).size} · подробно →` : "каждый микросервис — у одной задачи"}</span>
                </span>
              </button>
            )}

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
              <p>Списки, свои поля и черновики хранятся в этом браузере, справочник людей — на сервере SimpleTest.</p>
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
          {jiraPeopleErr && jira.state === "ok" && (
            <div role="alert" className="flex items-center gap-3 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="min-w-0 flex-1 text-text-main">Jira не приняла людей (в SimpleTest они сохранены): {jiraPeopleErr}</span>
              <button type="button" onClick={() => setJiraPeopleErr("")} aria-label="Скрыть" className="p-1 text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
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
              {/* Шапка: представления, проект и действия с задачами; на узком окне кнопки уходят строкой ниже */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <ViewSwitcher views={listViews(list)} active={list.activeView ?? listViews(list)[0].id}
                  onSwitch={id => updateList(l => switchView(l, id))}
                  onAdd={() => updateList(l => addView(l, `Представление ${listViews(l).length + 1}`))}
                  onRename={(id, name) => updateList(l => renameView(l, id, name))}
                  onDelete={id => updateList(l => deleteView(l, id))} />
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
                    {refreshedAt > 0 && (
                      <span title="Задачи берутся из кэша сессии и обновляются из Jira фоном раз в 30 минут">
                        {" "}· данные Jira: {new Date(refreshedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {q && <> · найдено: {listIssues.length}</>}
                    {sort && (
                      <> · сортировка: {colLabel(sort.col, list)} {sort.dir === 1 ? "↑" : "↓"}{" "}
                        <button type="button" onClick={() => setSort(null)} className="text-primary hover:underline"
                          title="Вернуть ручной порядок — тогда строки можно перетаскивать">сбросить</button></>
                    )}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Формат трудозатрат во всём Jira tool и в Excel: ч·мин или д·ч·мин (день — норма из настроек нагрузки) */}
                  <span className="flex rounded-lg border border-border-main overflow-hidden text-xs" role="radiogroup" aria-label="Формат времени"
                    title={`Трудозатраты: часы и минуты или дни, часы и минуты (день = ${fmtMinutes(state.loadSettings.dayMinutes, "hm")} — норма из настроек нагрузки)`}>
                    {(["hm", "dhm"] as const).map(f => (
                      <button key={f} type="button" role="radio" aria-checked={timeFmt === f}
                        onClick={() => { setTimeFmt(f); setTimeFmtState(f); }}
                        className={`px-2.5 py-2 whitespace-nowrap ${timeFmt === f ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main"}`}>
                        {f === "hm" ? "ч · мин" : "д · ч · мин"}
                      </button>
                    ))}
                  </span>
                  <button type="button" onClick={refreshFromJira} disabled={jira.state !== "ok"} aria-label="Обновить из Jira"
                    title={pendingPeople ? `Отправить в Jira людей (изменений: ${pendingPeople}) и перечитать задачи списка` : "Перечитать задачи списка из Jira"}
                    className="relative p-2 rounded-lg border border-border-main text-text-muted hover:text-primary disabled:opacity-40">
                    <RefreshCw className={`w-4 h-4 ${busy > 0 ? "animate-spin" : ""}`} />
                    {pendingPeople > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-4 text-center">
                        {pendingPeople}</span>
                    )}
                  </button>
                  {STRUCTURE_ENABLED && (
                    <button type="button" onClick={() => setModal("import")} disabled={jira.state !== "ok"} title="Импорт структуры: все задачи с папками"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle whitespace-nowrap disabled:opacity-40">
                      <FolderTree className="w-4 h-4" /> Структура
                    </button>
                  )}
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
                <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 animate-fade-in [&_button]:whitespace-nowrap">
                  <ListChecks className="w-4 h-4 text-primary" />
                  <span className="text-sm text-text-main">
                    {selected.size ? <>Выбрано: <b>{selected.size}</b></> : "Отметьте задачи чекбоксами"}
                  </span>
                  <button type="button" onClick={() => setModal("bulk")} disabled={!selected.size}
                    className="ml-2 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">Сменить статус</button>
                  <button type="button" onClick={() => setModal("reqs")} disabled={!selected.size}
                    className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">Требования…</button>
                  <button type="button" onClick={() => setModal("ms")} disabled={!selected.size}
                    title="Добавить, заменить или снять микросервисы у выбранных задач"
                    className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">Микросервисы…</button>
                  <select value="" disabled={!selected.size} aria-label="Нагрузка для выбранных"
                    onChange={e => { if (e.target.value) { setNoLoad([...selected], e.target.value === "skip"); setSelected(new Set()); } }}
                    className="px-2 py-1.5 rounded-lg border border-border-main text-sm text-text-main bg-[var(--color-input-bg)] disabled:opacity-40">
                    <option value="">Нагрузка…</option>
                    <option value="skip">Не учитывать</option>
                    <option value="count">Учитывать</option>
                  </select>
                  {!!list.folderList?.length && (
                    <select value="" onChange={e => e.target.value && moveSelectedToFolder(e.target.value === "__none__" ? null : e.target.value)}
                      aria-label="Переложить выбранные в папку" disabled={!selected.size}
                      className="px-2 py-1.5 rounded-lg border border-border-main text-sm text-text-main bg-[var(--color-input-bg)] disabled:opacity-40">
                      <option value="">В папку…</option>
                      {list.folderList.map(f => <option key={f} value={f}>{f}</option>)}
                      <option value="__none__">{NO_FOLDER}</option>
                    </select>
                  )}
                  {state.lists.length > 1 && (
                    <select value="" onChange={e => e.target.value && moveToList(e.target.value, [...selected])}
                      aria-label="Перенести выбранные в другой список" disabled={!selected.size}
                      title="Перенести в другой список — с участником, трудозатратами и своими полями, которые есть и там. Или перетащите строки на список слева"
                      className="px-2 py-1.5 rounded-lg border border-border-main text-sm text-text-main bg-[var(--color-input-bg)] disabled:opacity-40">
                      <option value="">В список…</option>
                      {state.lists.filter(l => l.id !== activeId).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  )}
                  {/* Удаление из списка — справа, отдельно от массовых действий и красным: его легко перепутать */}
                  <button type="button" onClick={() => {
                    updateList(l => ({ ...l, keys: l.keys.filter(k => !selected.has(k)), marks: [...selected].reduce((m, k) => withoutMark(m, k), l.marks) }));
                    setSelected(new Set());
                  }}
                    disabled={!selected.size}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">
                    <Trash2 className="w-4 h-4" /> Убрать из списка{selected.size ? ` (${selected.size})` : ""}</button>
                  <button type="button" onClick={stopSelecting}
                    className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {list.keys.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border-main rounded-xl text-text-muted">
                    <p className="text-sm">Список пуст. Добавьте задачи проекта {list.project} из Jira или создайте задачу.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setModal("add")} disabled={jira.state !== "ok"}
                        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">Добавить задачи</button>
                      {STRUCTURE_ENABLED && (
                        <button type="button" onClick={() => setModal("import")} disabled={jira.state !== "ok"}
                          className="px-4 py-2 rounded-lg border border-border-main text-sm text-text-main disabled:opacity-40">Импорт структуры</button>
                      )}
                    </div>
                  </div>
                ) : searched.length === 0 && !q ? (
                  <p className="text-sm text-text-muted p-4">
                    {busy > 0 ? "Загружаю задачи из Jira…" : jira.state === "ok" ? "Задачи списка не загрузились — нажмите «Обновить из Jira»." : "Задачи списка хранятся в Jira — подключите её, чтобы их увидеть."}
                  </p>
                ) : searched.length === 0 ? (
                  <p className="text-sm text-text-muted p-4">По «{filter}» в списке ничего нет.</p>
                ) : (
                  <ListTable key={list.id} ctx={ctx} issues={listIssues} sort={sort} onSort={setSort}
                    selecting={selecting} onToggleSelecting={() => (selecting ? stopSelecting() : setSelecting(true))}
                    selected={selected}
                    onSelect={(keys, on) => setSelected(prev => { const n = new Set(prev); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n; })}
                    onValue={(key, fid, v) => updateList(l => ({ ...l, values: { ...l.values, [key]: { ...l.values[key], [fid]: v } } }))}
                    colFilters={colFilters} filterOptions={filterOptions}
                    onResetFilters={activeFilters.length ? () => setColFilters({}) : undefined}
                    onColFilter={(c, vals) => setColFilters(f => {
                      const next = { ...f };
                      if (vals) next[c] = vals; else delete next[c];
                      return next;
                    })}
                    stageManual={state.stageManual}
                    onStageManual={setStageManual}
                    onIcon={(key, fid, code) => updateList(l => {
                      const row = { ...l.icons?.[key] };
                      if (code) row[fid] = code; else delete row[fid];
                      return { ...l, icons: { ...l.icons, [key]: row } };
                    })}
                    onParticipant={(key, id) => updateListPeople(l => {
                      const a = { ...l.assignees };
                      if (id) a[key] = id; else delete a[key];
                      return { ...l, assignees: a };
                    })}
                    onRemove={key => { updateList(l => ({ ...l, keys: l.keys.filter(k => k !== key), marks: withoutMark(l.marks, key) })); setSelected(p => { const n = new Set(p); n.delete(key); return n; }); }}
                    onClearMark={key => updateList(l => ({ ...l, marks: withoutMark(l.marks, key) }))}
                    onOpenDefects={issue => setModal({ defectsFor: issue })}
                    onOpenIssue={issue => setModal({ issueFor: issue })}
                    onMoveRow={(key, target, place) => updateList(l => ({ ...l, keys: moveItem(l.keys, key, target, place) }))}
                    onMoveColumn={(col, target, place) => updateList(l => ({ ...l, columns: moveItem(l.columns, col, target, place) }))}
                    onMoveToGroup={(key, changes, target, place) => updateListPeople(l => {
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
                      return { ...l, spend: { ...l.spend, [key]: cur } };
                    })}
                    onTogglePin={col => updateList(l => {
                      const p = l.pinned ?? [];
                      return { ...l, pinned: p.includes(col) ? p.filter(c => c !== col) : [...p, col] };
                    })}
                    onToggleWrap={fid => updateList(l => ({ ...l, ownFields: l.ownFields.map(f => (f.id === fid ? { ...f, wrap: !f.wrap } : f)) }))}
                    onOpenStage={issue => setModal({ stageFor: issue })}
                    onRole={(key, fid, patch) => updateListPeople(l => ({
                      ...l, roles: { ...l.roles, [key]: { ...l.roles?.[key], [fid]: { ...l.roles?.[key]?.[fid], ...patch } } },
                    }))}
                    onAddPerson={addPerson} onLeaveDirection={leaveDirection}
                    onNoLoad={(key, skip) => setNoLoad([key], skip)}
                    reqLinks={state.reqLinks} reqUrls={state.reqUrls} reqOptions={reqOptions} onReqs={(key, ids) => setReqs([key], ids, "set")}
                    msLinks={state.msLinks} msCatalog={msCatalog.ms} msInfo={msCatalog.info} onCreateMs={createMs} msShared={msShared}
                    onMs={(key, names) => setMs([key], names, "set")}
                    onReqUrl={(key, u) => update(s => {
                      const m = { ...s.reqUrls };
                      if (u) m[key] = u; else delete m[key];
                      return { ...s, reqUrls: m };
                    })} />
                )}
              </div>

              {/* Отчёты по отмеченным задачам — только в режиме выбора (карандаш) */}
              {selecting && (
                <div className="flex items-center gap-4 flex-wrap text-sm -mt-1">
                  <button type="button" onClick={copyChatReport} disabled={!selected.size || !!reportBusy}
                    title="Код, наименование, статус (st), дефекты, участник; под фичей — её неустранённые дефекты"
                    className="flex items-center gap-1.5 text-text-muted hover:text-primary disabled:opacity-40 disabled:hover:text-text-muted">
                    <MessageSquareShare className="w-4 h-4" /> Скопировать в чат
                  </button>
                  <button type="button" onClick={copyChecklist} disabled={!selected.size || !!reportBusy}
                    title="Код и наименование фичи, проверки по требованиям (если привязаны и выбрана модель) и «Результат проверок:»"
                    className="flex items-center gap-1.5 text-text-muted hover:text-primary disabled:opacity-40 disabled:hover:text-text-muted">
                    <ClipboardCheck className="w-4 h-4" /> Чек-лист
                  </button>
                  <button type="button" onClick={exportExcel} disabled={!selected.size || !!reportBusy}
                    title="Как «Бэклог Платформы», два листа: «Фамилии» — люди направлений, «Нагрузка» — их план (в выбранном формате времени). Команда — папка задачи; состояние направления — цветом: серый, жёлтый, зелёный"
                    className="flex items-center gap-1.5 text-text-muted hover:text-primary disabled:opacity-40 disabled:hover:text-text-muted">
                    <FileSpreadsheet className="w-4 h-4" /> Выгрузить в Excel
                  </button>
                  {reportBusy && (
                    <span className="flex items-center gap-2 text-xs text-text-muted" role="status">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Проверки по требованиям: {reportBusy.done} из {reportBusy.total}
                      <button type="button" onClick={() => { cancelReport.current = true; }} className="underline hover:text-text-main">прервать</button>
                    </span>
                  )}
                  {pendingCopy !== null && (
                    <button type="button" onClick={() => void deliver(pendingCopy, "Скопировано.")}
                      className="px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold">Скопировать</button>
                  )}
                  {reportNote && !reportBusy && <span className="text-xs text-text-muted" role="status">{reportNote}</span>}
                  {!selected.size && <span className="text-xs text-text-muted">Отметьте задачи — отчёт соберётся по ним.</span>}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {modal === "add" && list && (
        <AddIssuesModal open project={list.project} onClose={() => setModal(null)} inList={new Set(list.keys)}
          onAdd={(issues, sources: PickedSource[], extra) => {
            mergeIssues([...extra, ...issues]);
            markFresh();
            const now = nowStamp();
            updateList(l => sources.reduce(
              (acc, src) => upsertSource(acc, { ...src, id: newId("src"), checkedAt: now }),
              { ...l, keys: [...l.keys, ...issues.map(i => i.key).filter(k => !l.keys.includes(k))] } as TaskList,
            ));
          }} />
      )}
      {modal === "create" && list && (
        <IssueFormModal open project={list.project} participants={state.participants} listName={list.name}
          onSave={saveIssue} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "draft" in modal && list && (
        <IssueFormModal open project={projectKeyOfIssue(modal.draft.key)} participants={state.participants}
          initial={draftOf(modal.draft)} onSave={d => saveDraft(modal.draft, d)} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "stageFor" in modal && (
        <StageModal open issue={modal.stageFor} stories={byEpic.get(modal.stageFor.key) ?? []} stageOf={stageOf} defectsOf={defectsOf}
          ownStageOf={i => ownStageInfo(stageOf(i), defectIdx.get(i.key))} onClose={() => setModal(null)} />
      )}
      {STRUCTURE_ENABLED && modal === "import" && list && (
        <ImportStructureModal open listName={list.name} onImport={importStructure} onClose={() => setModal(null)} />
      )}
      {backup && <BackupModal open section="bugs" file={backup.file} onClose={() => setBackup(null)} />}
      {modal === "participants" && (
        <ParticipantsModal open participants={state.participants} usage={usage} onClose={() => setModal(null)}
          jiraOk={jira.state === "ok"} jiraFields={jiraFields}
          onJiraFields={f => {
            const prev = jiraFields;
            setJiraFields(f);
            saveJiraPeopleFields(f).then(() => setPeopleErr(""), e => {
              setJiraFields(prev);
              setPeopleErr(`Поля Jira направлений не сохранились: ${(e as Error).message}`);
            });
          }}
          onChange={participants => update(s => {
            const ids = new Set(participants.map(p => p.id));
            // Удалённого участника снимаем со всех задач во всех списках.
            const lists = s.lists.map(l => ({ ...l, assignees: Object.fromEntries(Object.entries(l.assignees).filter(([, p]) => ids.has(p))) }));
            return { ...s, participants, lists };
          })} />
      )}
      {modal === "msOverlaps" && (
        <MsOverlapModal open overlaps={overlaps} issueOf={k => byKey.get(k)} stageOf={stageOf} info={msCatalog.info} onClose={() => setModal(null)} />
      )}
      {modal === "ms" && (
        <MsAssignModal open count={selected.size} catalog={msCatalog.ms} info={msCatalog.info} onCreate={createMs}
          onClose={() => setModal(null)} onApply={(names, mode) => setMs([...selected], names, mode)} />
      )}
      {modal === "reqs" && (
        <ReqAssignModal open count={selected.size} options={reqOptions} onClose={() => setModal(null)}
          onApply={(ids, mode) => setReqs([...selected], ids, mode)} />
      )}
      {modal === "bulk" && (
        <BulkStatusModal open issues={selectedIssues} storiesOf={k => byEpic.get(k) ?? []} onClose={moved => { setModal(null); if (moved) setSelected(new Set()); }} onDone={afterTransitions} />
      )}
      {modal === "stages" && (
        <StageMappingModal open project={list?.project ?? "SBER911"} projects={state.lists.map(l => l.project)}
          mapping={state.mapping} styles={state.stageStyles} custom={state.customStages} onClose={() => setModal(null)}
          onSave={(mapping, stageStyles, customStages) => update(s => ({ ...s, mapping, stageStyles, customStages }))} />
      )}
      {modal === "loadDetails" && list && (
        <LoadDetailsModal list={list} people={state.participants} settings={state.loadSettings} issueOf={key => byKey.get(key)}
          skip={key => loadSkip(list, byKey.get(key), stageOf)} onClose={() => setModal(null)}
          onRange={load => updateList(l => ({ ...l, load }))}
          onAuto={on => updateList(l => ({ ...l, loadAuto: on ? undefined : false }))}
          onWeekends={on => updateList(l => ({ ...l, loadWeekends: on || undefined }))}
          onBars={(dir, on) => updateList(l => ({ ...l, loadBars: { ...l.loadBars, [dir]: on } }))}
          onSettings={() => setModal("load")} />
      )}
      {modal === "load" && (
        <LoadSettingsModal open settings={state.loadSettings} participants={state.participants} onClose={() => setModal(null)}
          onSave={loadSettings => update(s => ({ ...s, loadSettings }))} />
      )}
      {modal && typeof modal === "object" && "issueFor" in modal && (
        <IssueModal open issue={modal.issueFor} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "defectsFor" in modal && (
        <DefectsModal open issue={modal.defectsFor} defects={defectsOf(modal.defectsFor) ?? []} stageOf={stageOf}
          onCreate={modal.defectsFor.local ? undefined : () => setDefectFor(modal.defectsFor)} onClose={() => setModal(null)} />
      )}
      {/* Поверх окна «Дефекты» — поэтому ниже него */}
      {defectFor && (
        <IssueFormModal open jiraOnly project={projectKeyOfIssue(defectFor.key)} participants={state.participants}
          prefill={categoryOf(defectFor) === "epic" ? { type: "Дефект", epicKey: defectFor.key } : { type: "Дефект" }}
          linkTo={categoryOf(defectFor) === "epic" ? undefined : { key: defectFor.key, summary: String(defectFor.fields.summary ?? "") }}
          // Новый дефект — сразу в кэш (с Epic Link и связями), чтобы окно «Дефекты» и маркер в списке его показали.
          onSave={d => { if (d.jira) void sync([d.jira.key], []); }}
          onClose={() => setDefectFor(null)} />
      )}
      {modal && typeof modal === "object" && "own" in modal && (
        <OwnFieldModal open initial={modal.own} typeLocked={!!modal.own && ownUsed(modal.own.id)} onClose={() => setModal(null)}
          sources={fieldOptions}
          valuesOf={ref => {
            if (!ctx || !list) return [];
            const all = list.keys.map(k => byKey.get(k)).filter((i): i is Issue => !!i).flatMap(i => colValues(ref, i, ctx));
            return Array.from(new Set(all.map(String))).sort((a, b) => a.localeCompare(b, "ru"));
          }}
          onSave={saveOwn} onDelete={modal.own ? () => deleteOwn(modal.own!.id) : undefined} />
      )}
      <JiraSettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); connect(true); }} />
    </Shell>
  );
}

/**
 * Нагрузка по списку — только команда тестирования: у каждого тестировщика сумма плана (ячейка «Тестировщик») его задач
 * в этом списке против нормы за период (дни × норма дня минус резервы). Превышение — красным; если в списке
 * считаются выходные — сколько из плана уходит на выходные (переработка). Остальные направления, галочки
 * «выходные» и «готовые не считать» — в подробной нагрузке.
 */
function LoadPanel({ list, participants, settings, onSettings, skip, onRange, onDetails }: {
  list: TaskList;
  participants: Participant[];
  settings: LoadSettings;
  onSettings: () => void;
  skip: (key: string) => ReturnType<typeof loadSkip>;
  onRange: (r: { from: string; to: string }) => void;
  onDetails: () => void;
}) {
  const range = list.load ?? defaultLoadRange();
  const rows = listLoad(list, participants, range, skip, settings);
  // Резервы у всех — в общую строку нормы; личные — в подсказке и под строкой участника.
  const common = settings.reserves.filter(r => r.minutes > 0 && isCommonReserve(r));
  const commonMin = common.reduce((n, r) => n + r.minutes, 0);
  const { days, weekend } = calendarDays(range.from, range.to, !!list.loadWeekends);
  const dateCls = "min-w-0 flex-1 text-xs border border-border-main rounded-md px-1.5 py-1 bg-[var(--color-input-bg)] text-text-main " +
    "focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <div className="bg-bg-card border border-border-main rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Нагрузка · Testing</p>
        <span className="flex items-center gap-2">
          <button type="button" onClick={onDetails} title="Все направления, выходные, не учтённые задачи"
            className="text-xs text-primary hover:underline">Подробно</button>
          <button type="button" onClick={onSettings} aria-label="Настройка нагрузки: норма дня и резервы" title="Норма дня и резервы (автотесты, дежурства…)"
            className="p-1 -m-1 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle"><Settings2 className="w-3.5 h-3.5" /></button>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && onRange({ ...range, from: e.target.value })}
          aria-label="Нагрузка: с даты" className={dateCls} />
        <span className="text-xs text-text-muted">—</span>
        <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && onRange({ ...range, to: e.target.value })}
          aria-label="Нагрузка: по дату" className={dateCls} />
      </div>
      <p className="text-[11px] text-text-muted" title="Праздники не учитываются. Норму дня и резервы — шестерёнкой; выходные — в «Подробно».">
        {weekend ? <>Дней: {days}, из них выходных {weekend}</> : <>Рабочих дней: {days}</>} · в день {fmtMinutes(settings.dayMinutes, "hm")}
        {commonMin > 0 && <> − {common.map(r => `${r.name} ${fmtMinutes(r.minutes, "hm")}`).join(", ")} = <b className="font-medium text-text-main">{fmtMinutes(Math.max(0, settings.dayMinutes - commonMin), "hm")}</b></>}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">Добавьте тестировщиков в справочник и назначьте их на задачи — здесь появится их нагрузка.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => <LoadRowView key={r.participant.id} r={r} bars />)}
        </ul>
      )}
    </div>
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
