"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, FileUp, FlaskConical, ListChecks, Loader2, Pencil, PlayCircle, RefreshCw, Rocket, Search, Sparkles, Stethoscope, Trash2, Upload, X } from "lucide-react";
import FolderTree from "@/components/zephyr/FolderTree";
import RunsView from "@/components/zephyr/RunsView";
import ReleasesView from "@/components/zephyr/ReleasesView";
import CaseDialog from "@/components/zephyr/CaseDialog";
import { Resizer, usePaneSize } from "@/components/zephyr/Resizer";
import { BulkEditModal, CaseStatus, ColumnsMenu, DeleteCasesModal, useCaseCols } from "@/components/zephyr/CaseBulk";
import ProbeModal from "@/components/zephyr/ProbeModal";
import { CaseCard, NewCaseCard } from "@/components/zephyr/parts";
import Modal from "@/components/ui/Modal";
import { ApplyDialog, StagedCaseCard } from "@/components/zephyr/StagingParts";
import { loadStaging, saveStaging, stagingFromXml, takeHandoff, usedFolders, type ApplyResult, type Parent, type Staging } from "@/lib/zephyrStaging";
import { getJiraSettings } from "@/lib/jiraApi";
import { DRAG_CASES, fmtDate, fmtDuration, createFolder, getCases, getIndex, getTree, moveCases, moveFolder as moveFolderApi, refreshFolder, type ZCase, type ZFolder } from "@/lib/zephyrApi";

/** Узел дерева по пути — для подтверждения переноса (сколько кейсов уедет). */
function findNode(nodes: ZFolder[], path: string): ZFolder | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (path.startsWith(n.path + "/")) { const x = findNode(n.children, path); if (x) return x; }
  }
  return null;
}

const PROJECT_KEY = "st_zephyr_project";

function readProject(): string {
  try { return localStorage.getItem(PROJECT_KEY) || "SBER911"; } catch { return "SBER911"; }
}

/**
 * Zephyr Tool — проект тестирования Zephyr Scale в SimpleTest: дерево папок с кейсами, карточка кейса
 * со шагами и связями с Jira, прогоны с прогрессом и статусами.
 *
 * Этап 1 — чтение. Запись (создание, правка, удаление кейсов, папок, прогонов, добавление кейсов в прогон,
 * связи с задачами, плеер прохождения) включается после проверки API на стенде: кнопка «Проверить API».
 */
export default function ZephyrSection() {
  const [project, setProject] = useState("SBER911");
  const [projectDraft, setProjectDraft] = useState("SBER911");
  const [tab, setTab] = useState<"cases" | "runs" | "release">("cases");
  /** Прогон, который открыть на вкладке «Прогоны» (клик по прогону в строке релиза). */
  const [openRun, setOpenRun] = useState<string | null>(null);
  const treePane = usePaneSize("tree", 320, 220, 640);
  /** Окно кейса свёрнуто в плашку. */
  const [minimized, setMinimized] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [probeOpen, setProbeOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [tree, setTree] = useState<{ folders: ZFolder[]; total?: number; source: string; loadedAt?: number } | null>(null);
  /** Полная перезагрузка модели из Jira или обновление одной папки — идёт сейчас. */
  const [modelBusy, setModelBusy] = useState<"" | "all" | "folder">("");
  const [modelErr, setModelErr] = useState("");
  /** Итог последней правки структуры (создание папки, перенос) — строкой над деревом. */
  const [opNote, setOpNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [newCaseIn, setNewCaseIn] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Несколько отмеченных кейсов: окно правки или удаления. */
  const [bulk, setBulk] = useState<"edit" | "delete" | null>(null);
  /** Кейс открыт кнопкой «Изменить» — карточка сразу в режиме правки. */
  const [editOpen, setEditOpen] = useState(false);
  const [cols, toggleCol] = useCaseCols();
  /** Перенос/переименование папки ждёт подтверждения: сколько кейсов уедет и куда. */
  const [folderMove, setFolderMove] = useState<{ source: string; target: string; count: number; rename: boolean } | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [treeErr, setTreeErr] = useState("");
  const [folder, setFolder] = useState("");
  const [cases, setCases] = useState<ZCase[] | null>(null);
  const [casesErr, setCasesErr] = useState("");
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [caseKey, setCaseKey] = useState<string | null>(null);

  // Новая модель (XML или генерация) — черновик раскладки до «Применить».
  const [staging, setStagingState] = useState<Staging | null>(null);
  const [stagedPick, setStagedPick] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [askDrop, setAskDrop] = useState(false);
  const xmlInput = useRef<HTMLInputElement>(null);
  const setStaging = (s: Staging | null) => { setStagingState(s); saveStaging(project, s); };

  useEffect(() => { const p = readProject(); setProject(p); setProjectDraft(p); }, []);
  // Открыли другой кейс (или новый) — окно разворачивается.
  useEffect(() => { setMinimized(false); setDialogTitle(""); }, [caseKey, newCaseIn, stagedPick]);
  useEffect(() => { setStagingState(loadStaging(project)); setStagedPick(null); }, [project]);

  const importXml = async (xml: string, source: string) => {
    if (staging && !window.confirm("Уже есть неприменённая новая модель. Заменить её новой?")) return;
    setImportBusy(true); setImportErr(""); setTab("cases");
    try { setStaging(await stagingFromXml(xml, source)); setStagedPick(null); } catch (e) { setImportErr((e as Error).message); }
    setImportBusy(false);
  };
  // XML из генерации SimpleTest («Открыть в Zephyr Tool») — забираем при открытии раздела.
  useEffect(() => {
    const h = takeHandoff();
    if (h) void importXml(h.xml, h.source);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const moveCase = (id: string, target: Exclude<Parent, { kind: "root" }>) =>
    staging && setStaging({ ...staging, cases: staging.cases.map(c => (c.id === id ? { ...c, target, error: undefined } : c)) });
  const moveFolder = (id: string, parent: Parent) =>
    staging && setStaging({ ...staging, folders: staging.folders.map(f => (f.id === id ? { ...f, parent } : f)) });
  /** После «Применить»: созданные кейсы уходят из черновика, у несозданных — текст ошибки; пустые новые папки убираем. */
  const afterApply = (r: ApplyResult) => {
    if (!staging) return;
    const byId = new Map(r.results.map(x => [x.id, x]));
    const left = staging.cases.filter(c => !byId.get(c.id)?.key).map(c => ({ ...c, error: byId.get(c.id)?.error ?? c.error }));
    const next = { ...staging, cases: left };
    const used = usedFolders(next);
    setStaging(left.length ? { ...next, folders: next.folders.filter(f => used.has(f.id)) } : null);
    setStagedPick(null);
    setReloadKey(k => k + 1);
  };
  useEffect(() => { getJiraSettings().then(s => setBaseUrl(s.base_url.replace(/\/$/, ""))).catch(() => {}); }, []);

  useEffect(() => {
    let live = true;
    setTree(null); setTreeErr("");
    getTree(project).then(t => live && setTree(t)).catch(e => live && setTreeErr((e as Error).message));
    return () => { live = false; };
  }, [project, reloadKey]);

  // Поиск по названию — на сервере (кейсов бывают тысячи): после паузы в наборе.
  useEffect(() => { const t = setTimeout(() => setText(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let live = true;
    setCases(null); setCasesErr("");
    getCases(project, folder, text).then(r => live && setCases(r.cases)).catch(e => live && setCasesErr((e as Error).message));
    return () => { live = false; };
  }, [project, folder, text, reloadKey]);

  /** Модель целиком из Jira — по кнопке; обычное открытие раздела берёт её из кэша сервера мгновенно. */
  const reloadModel = async () => {
    setModelBusy("all"); setModelErr("");
    try { await getIndex(project, true); setReloadKey(k => k + 1); } catch (e) { setModelErr((e as Error).message); }
    setModelBusy("");
  };
  /** Только выбранная папка — когда поменяли несколько кейсов и не хочется перечитывать все тысячи. */
  const reloadFolder = async () => {
    if (!folder) return;
    setModelBusy("folder"); setModelErr("");
    try { await refreshFolder(project, folder); setReloadKey(k => k + 1); } catch (e) { setModelErr((e as Error).message); }
    setModelBusy("");
  };
  const done = (ok: boolean, text: string) => { setOpNote({ ok, text }); setReloadKey(k => k + 1); };
  const errText = (r: { errors: { key: string; error: string }[] }) => (r.errors.length ? ` Не перенеслось: ${r.errors.length} (${r.errors[0].key}: ${r.errors[0].error})` : "");

  const onCreateFolder = async (parent: string, name: string) => {
    const path = `${parent}/${name.replace(/\//g, "-")}`;
    try { await createFolder(project, path); done(true, `Папка ${path} создана в Zephyr.`); } catch (e) { setOpNote({ ok: false, text: `Папка не создалась: ${(e as Error).message}` }); }
  };
  const askMove = (source: string, target: string, rename: boolean) => {
    const count = (tree && findNode(tree.folders, source)?.count) ?? 0;
    setFolderMove({ source, target, count, rename });
  };
  const runFolderMove = async () => {
    if (!folderMove) return;
    setMoveBusy(true);
    try {
      const r = await moveFolderApi(project, folderMove.source, folderMove.target);
      if (folder === folderMove.source || folder.startsWith(folderMove.source + "/")) setFolder(r.target + folder.slice(folderMove.source.length));
      done(!r.errors.length, `Папка теперь ${r.target}: перенесено кейсов ${r.moved}.${errText(r)}`);
      setFolderMove(null);
    } catch (e) { setOpNote({ ok: false, text: `Не перенеслось: ${(e as Error).message}` }); setFolderMove(null); }
    setMoveBusy(false);
  };
  const onDropCases = async (keys: string[], to: string) => {
    try { const r = await moveCases(project, keys, to); setChecked(new Set()); done(!r.errors.length, `Перенесено в ${to}: ${r.moved}.${errText(r)}`); }
    catch (e) { setOpNote({ ok: false, text: `Не перенеслось: ${(e as Error).message}` }); }
  };

  const loadedAt = tree?.loadedAt ? new Date(tree.loadedAt * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

  const applyProject = () => {
    const p = projectDraft.trim().toUpperCase();
    if (!p || p === project) return;
    try { localStorage.setItem(PROJECT_KEY, p); } catch { /* не запомнится — не страшно */ }
    setProject(p); setFolder(""); setCaseKey(null);
  };

  const crumbs = useMemo(() => folder.split("/").filter(Boolean), [folder]);
  const tabCls = (on: boolean) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${on ? "bg-primary/10 text-primary font-semibold" : "text-text-muted hover:text-text-main hover:bg-bg-subtle"}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
        <FlaskConical className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Zephyr Tool</h1>
        <input value={projectDraft} onChange={e => setProjectDraft(e.target.value)} onBlur={applyProject}
          onKeyDown={e => e.key === "Enter" && applyProject()} aria-label="Проект Jira"
          className="w-28 text-sm font-mono border border-border-main rounded-lg px-2.5 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <div className="flex gap-1 ml-2" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "cases"} onClick={() => setTab("cases")} className={tabCls(tab === "cases")}>
            <ListChecks className="w-4 h-4" /> Кейсы</button>
          <button type="button" role="tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")} className={tabCls(tab === "runs")}>
            <PlayCircle className="w-4 h-4" /> Прогоны</button>
          <button type="button" role="tab" aria-selected={tab === "release"} onClick={() => setTab("release")} className={tabCls(tab === "release")}>
            <Rocket className="w-4 h-4" /> Релиз</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={reloadModel} disabled={!!modelBusy} title="Перечитать модель из Jira целиком" aria-label="Обновить из Jira"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${modelBusy === "all" ? "animate-spin" : ""}`} /></button>
          <button type="button" onClick={() => setProbeOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
            <Stethoscope className="w-4 h-4" /> Проверить API</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "release" ? <ReleasesView key={project} project={project} baseUrl={baseUrl} onOpenRun={k => { setOpenRun(k); setTab("runs"); }} />
          : tab === "runs" ? <RunsView project={project} baseUrl={baseUrl} reloadKey={reloadKey} openKey={openRun} /> : (
          <div className="flex h-full min-h-0">
            <div style={{ width: treePane.size }} className="flex-shrink-0 p-3 min-h-0 flex flex-col gap-2">
              <input ref={xmlInput} type="file" accept=".xml,application/xml,text/xml" className="hidden"
                onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await importXml(await f.text(), f.name); }} />
              {staging ? (
                <div className="rounded-lg bg-violet-500/10 border border-violet-400/40 px-2.5 py-2 text-xs space-y-1.5">
                  <p className="flex items-center gap-1.5 font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="w-3.5 h-3.5" /> Новая модель · {staging.source}</p>
                  <p className="text-text-muted">Кейсов: {staging.cases.length}{staging.cases.some(c => c.error) ? ` (с ошибкой: ${staging.cases.filter(c => c.error).length})` : ""}.
                    Перетащите кейсы в папки дерева или новые папки внутрь папок, затем «Применить».</p>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setApplyOpen(true)} disabled={!staging.cases.length}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white font-semibold disabled:opacity-40"><Upload className="w-3.5 h-3.5" /> Применить</button>
                    {!askDrop ? (
                      <button type="button" onClick={() => setAskDrop(true)} className="px-2 py-1 rounded-md text-text-muted hover:text-red-500">Сбросить</button>
                    ) : (
                      <span className="flex items-center gap-1">Удалить черновик?
                        <button type="button" onClick={() => { setStaging(null); setAskDrop(false); setStagedPick(null); }} className="px-1.5 py-0.5 rounded bg-red-600 text-white">Да</button>
                        <button type="button" onClick={() => setAskDrop(false)} className="px-1.5 py-0.5 rounded border border-border-main">Нет</button>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => xmlInput.current?.click()} disabled={importBusy}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-50">
                  {importBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} Новая модель из XML</button>
              )}
              {importErr && <p className="text-xs text-red-600 dark:text-red-400">XML не загрузился: {importErr}</p>}
              <div className="flex-1 min-h-0">
              {treeErr && <p className="mb-2 text-sm text-red-600 dark:text-red-400">Папки не загрузились: {treeErr}</p>}
              {tree && (
                <p className="mb-1.5 text-[11px] text-text-muted" title="Модель хранится на сервере; дерево и поиск — без запросов в Jira">
                  Модель: {tree.total ?? 0} кейсов{loadedAt && <> · из Jira {loadedAt}</>}
                  {modelBusy === "all" && <> · <Loader2 className="inline w-3 h-3 animate-spin" /> перечитываю…</>}
                </p>
              )}
              {modelErr && <p className="mb-1.5 text-xs text-red-600 dark:text-red-400">Не обновилось: {modelErr}</p>}
              {opNote && (
                <p className={`mb-1.5 flex items-start gap-1 text-xs ${opNote.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  <span className="min-w-0 flex-1">{opNote.text}</span>
                  <button type="button" onClick={() => setOpNote(null)} aria-label="Скрыть"><X className="w-3 h-3" /></button>
                </p>
              )}
              {!tree && !treeErr ? <p className="flex items-start gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 mt-0.5 animate-spin flex-shrink-0" />
                  Загружаю модель… В первый раз она читается из Jira целиком (тысячи кейсов — до минуты), дальше открывается сразу.</p>
                // Черновик новой модели виден и без дерева (Jira недоступна) — раскладку можно начать и применить позже.
                : (tree || staging) && <FolderTree key={project} folders={tree?.folders ?? []} total={tree?.total} selected={folder}
                    onSelect={p => { setFolder(p); setCaseKey(null); setStagedPick(null); }}
                    staging={staging} pickedCase={stagedPick} onPickCase={id => { setStagedPick(id); setCaseKey(null); }}
                    onCreateFolder={onCreateFolder}
                    onRenameFolder={(path, name) => askMove(path, `${path.slice(0, path.lastIndexOf("/"))}/${name.replace(/\//g, "-")}`, true)}
                    onMoveExisting={(src, to) => askMove(src, `${to}/${src.slice(src.lastIndexOf("/") + 1)}`, false)}
                    onDropCases={onDropCases}
                    onNewCase={f => { setNewCaseIn(f); setCaseKey(null); setStagedPick(null); }}
                    onMoveCase={moveCase} onMoveFolder={moveFolder} />}
              </div>
            </div>
            <Resizer pane={treePane} label="Ширина дерева папок" />

            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-main">
                <nav aria-label="Путь папки" className="min-w-0 flex-1 flex items-center gap-1 text-sm truncate">
                  <button type="button" onClick={() => setFolder("")} className={folder ? "text-text-muted hover:text-primary" : "font-semibold text-text-main"}>Все кейсы</button>
                  {crumbs.map((c, i) => {
                    const p = "/" + crumbs.slice(0, i + 1).join("/");
                    return (
                      <span key={p} className="flex items-center gap-1 min-w-0">
                        <span className="text-text-muted">/</span>
                        <button type="button" onClick={() => setFolder(p)} className={`truncate ${i === crumbs.length - 1 ? "font-semibold text-text-main" : "text-text-muted hover:text-primary"}`}>{c}</button>
                      </span>
                    );
                  })}
                </nav>
                {folder && (
                  <button type="button" onClick={() => { setNewCaseIn(folder); setCaseKey(null); setStagedPick(null); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap">
                    <FilePlus2 className="w-3.5 h-3.5" /> Новый кейс</button>
                )}
                {folder && (
                  <button type="button" onClick={reloadFolder} disabled={!!modelBusy} title="Перечитать из Jira только кейсы этой папки"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle disabled:opacity-50 whitespace-nowrap">
                    <RefreshCw className={`w-3.5 h-3.5 ${modelBusy === "folder" ? "animate-spin" : ""}`} /> Обновить папку</button>
                )}
                <ColumnsMenu cols={cols} onToggle={toggleCol} />
                <label className="flex items-center gap-2 w-64 px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] focus-within:ring-2 focus-within:ring-primary/30">
                  <Search className="w-3.5 h-3.5 text-text-muted" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Название кейса" aria-label="Найти кейс"
                    className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
                  {q && <button type="button" onClick={() => setQ("")} aria-label="Очистить"><X className="w-3.5 h-3.5 text-text-muted" /></button>}
                </label>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {casesErr && <p className="p-4 text-sm text-red-600 dark:text-red-400">Кейсы не загрузились: {casesErr}</p>}
                {!cases && !casesErr && <p className="flex items-center gap-2 p-4 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю кейсы…</p>}
                {cases && (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-bg-card text-[11px] uppercase tracking-wide text-text-muted">
                      <tr><th className="w-9 pl-3" title="Отметьте кейсы и перетащите их на папку в дереве">
                        <input type="checkbox" aria-label="Выбрать все кейсы" checked={!!cases.length && cases.every(c => checked.has(c.key))}
                          onChange={e => setChecked(e.target.checked ? new Set(cases.map(c => c.key)) : new Set())} /></th>
                        <th className="text-left px-3 py-2 w-36">Ключ</th><th className="text-left px-3 py-2">Название</th>
                        {cols.has("status") && <th className="text-left px-3 py-2 w-28">Статус</th>}
                        {cols.has("priority") && <th className="text-left px-3 py-2 w-24">Приоритет</th>}
                        {cols.has("duration") && <th className="text-left px-3 py-2 w-28">Длительность</th>}
                        {cols.has("owner") && <th className="text-left px-3 py-2 w-40">Владелец</th>}
                        {cols.has("folder") && <th className="text-left px-3 py-2 w-56">Папка</th>}
                        {cols.has("labels") && <th className="text-left px-3 py-2 w-40">Метки</th>}
                        {cols.has("updated") && <th className="text-left px-3 py-2 w-28">Изменён</th>}</tr>
                    </thead>
                    <tbody>
                      {cases.length === 0 && (
                        <tr><td colSpan={3 + cols.size} className="px-4 py-6 text-center text-text-muted">
                          {text ? `По «${text}» кейсов нет.` : folder ? "В этой папке кейсов нет (кейсы вложенных папок — в самих папках)." : "Кейсов нет."}</td></tr>
                      )}
                      {cases.map(c => (
                        <tr key={c.key} onClick={() => { setCaseKey(c.key); setEditOpen(false); setNewCaseIn(null); }} aria-selected={caseKey === c.key}
                          // Перетащить на папку дерева: отмеченные кейсы (если строка среди них) или только эту строку.
                          draggable onDragStart={e => {
                            const keys = checked.has(c.key) ? [...checked] : [c.key];
                            e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(DRAG_CASES, JSON.stringify(keys)); e.dataTransfer.setData("text/plain", keys.join(", "));
                          }}
                          title="Перетащите на папку в дереве, чтобы перенести"
                          className={`border-t border-border-main cursor-pointer ${caseKey === c.key ? "bg-primary/5" : checked.has(c.key) ? "bg-primary/[0.03]" : "hover:bg-bg-subtle/60"}`}>
                          <td className="pl-3" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" aria-label={`Выбрать ${c.key}`} checked={checked.has(c.key)}
                              onChange={() => setChecked(o => { const n = new Set(o); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} /></td>
                          <td className="px-3 py-1.5 font-mono text-xs text-primary whitespace-nowrap">{c.key}</td>
                          <td className="px-3 py-1.5 text-text-main">
                            <span className="block truncate max-w-[520px]">{c.name}</span>
                            {!folder && c.folder && !cols.has("folder") && <span className="block text-[11px] text-text-muted truncate">{c.folder}</span>}
                          </td>
                          {cols.has("status") && <td className="px-3 py-1.5"><CaseStatus status={c.status} /></td>}
                          {cols.has("priority") && <td className="px-3 py-1.5 text-text-main whitespace-nowrap">{c.priority || "—"}</td>}
                          {cols.has("duration") && <td className="px-3 py-1.5 text-text-main whitespace-nowrap tabular-nums">{fmtDuration(c.estimatedTime)}</td>}
                          {cols.has("owner") && <td className="px-3 py-1.5 text-text-muted truncate">{c.owner || "—"}</td>}
                          {cols.has("folder") && <td className="px-3 py-1.5 text-xs text-text-muted"><span className="block truncate max-w-[220px]" title={c.folder}>{c.folder || "—"}</span></td>}
                          {cols.has("labels") && <td className="px-3 py-1.5 text-xs text-text-muted truncate">{c.labels.join(", ") || "—"}</td>}
                          {cols.has("updated") && <td className="px-3 py-1.5 text-xs text-text-muted whitespace-nowrap">{c.updated ? fmtDate(c.updated) : "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              {checked.size > 0 && (
                // Панель выбора — поверх низа списка, а не над ним: строки не сдвигаются, пока отмечаешь кейсы.
                <div className="sticky bottom-3 z-10 mx-4 flex items-center gap-2 rounded-xl border border-primary/40 bg-bg-card shadow-lg px-4 py-2 text-sm">
                  <span className="text-text-main">Выбрано: <b>{checked.size}</b></span>
                  <button type="button" onClick={() => { if (checked.size === 1) { setCaseKey([...checked][0]); setEditOpen(true); setNewCaseIn(null); } else setBulk("edit"); }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90">
                    <Pencil className="w-3.5 h-3.5" /> Изменить</button>
                  <button type="button" onClick={() => setBulk("delete")}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-300 dark:border-red-900 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40">
                    <Trash2 className="w-3.5 h-3.5" /> Удалить</button>
                  <span className="text-xs text-text-muted">или перетащите на папку в дереве</span>
                  <button type="button" onClick={() => setChecked(new Set())} className="ml-auto text-xs text-text-muted hover:text-text-main underline">Снять выбор</button>
                </div>
              )}
              </div>
            </div>

            {caseKey ? (
              <CaseDialog label={`Кейс ${caseKey}`} title={`${caseKey}${dialogTitle ? ` · ${dialogTitle}` : ""}`} minimized={minimized}
                onMinimize={() => setMinimized(true)} onRestore={() => setMinimized(false)} onClose={() => setCaseKey(null)}>
                <CaseCard caseKey={caseKey} baseUrl={baseUrl} project={project} editable startEditing={editOpen} onChanged={() => setReloadKey(k => k + 1)}
                  onClose={() => setCaseKey(null)} onMinimize={() => setMinimized(true)} onTitle={setDialogTitle} />
              </CaseDialog>
            ) : newCaseIn !== null ? (
              <CaseDialog label="Новый кейс" title={`Новый кейс · ${newCaseIn || "корень"}`} minimized={minimized}
                onMinimize={() => setMinimized(true)} onRestore={() => setMinimized(false)} onClose={() => setNewCaseIn(null)}>
                <NewCaseCard project={project} folder={newCaseIn} onClose={() => setNewCaseIn(null)} onMinimize={() => setMinimized(true)}
                  onCreated={k => { setNewCaseIn(null); setCaseKey(k); done(true, `Кейс ${k} создан.`); }} />
              </CaseDialog>
            ) : stagedPick && staging ? (
              <CaseDialog label="Новый кейс из черновика" title={staging.cases.find(c => c.id === stagedPick)?.name ?? "Кейс черновика"} minimized={minimized}
                onMinimize={() => setMinimized(true)} onRestore={() => setMinimized(false)} onClose={() => setStagedPick(null)}>
                <StagedCaseCard staging={staging} caseId={stagedPick} onClose={() => setStagedPick(null)} onMinimize={() => setMinimized(true)} />
              </CaseDialog>
            ) : null}
          </div>
        )}
      </div>
      {probeOpen && <ProbeModal open project={project} onClose={() => setProbeOpen(false)} />}
      {folderMove && (
        <Modal open onClose={() => !moveBusy && setFolderMove(null)} title={folderMove.rename ? "Переименовать папку" : "Переместить папку"} size="max-w-lg">
          <div className="space-y-3 text-sm">
            <p className="text-text-main"><span className="font-mono">{folderMove.source}</span> → <span className="font-mono font-semibold">{folderMove.target}</span></p>
            <p className="text-text-muted">
              Будет перенесено кейсов (с вложенными папками): <b className="text-text-main">{folderMove.count}</b> — по запросу в Jira на каждый.
              Публичный API Zephyr не даёт переименовать папку напрямую, поэтому старая папка в Zephyr останется пустой —
              её можно удалить в интерфейсе Zephyr. В дереве SimpleTest её не будет.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setFolderMove(null)} disabled={moveBusy} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отмена</button>
              <button type="button" onClick={runFolderMove} disabled={moveBusy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
                {moveBusy && <Loader2 className="w-4 h-4 animate-spin" />} {folderMove.rename ? "Переименовать" : "Переместить"}</button>
            </div>
          </div>
        </Modal>
      )}
      {bulk === "edit" && (
        <BulkEditModal project={project} keys={[...checked]} onClose={() => setBulk(null)}
          onDone={r => { setBulk(null); setChecked(new Set()); done(!r.errors.length, `Изменено кейсов: ${r.ok}.${r.errors.length ? ` Ошибки: ${r.errors.map(e => `${e.key} — ${e.error}`).join("; ")}` : ""}`); }} />
      )}
      {bulk === "delete" && (
        <DeleteCasesModal project={project} keys={[...checked]} onClose={() => setBulk(null)}
          onDone={r => {
            setBulk(null); setChecked(new Set());
            if (caseKey && checked.has(caseKey)) setCaseKey(null);
            done(!r.errors.length, `Удалено кейсов: ${r.ok}.${r.errors.length ? ` Ошибки: ${r.errors.map(e => `${e.key} — ${e.error}`).join("; ")}` : ""}`);
          }} />
      )}
      {applyOpen && staging && <ApplyDialog project={project} staging={staging} onDone={afterApply} onClose={() => setApplyOpen(false)} />}
    </div>
  );
}
