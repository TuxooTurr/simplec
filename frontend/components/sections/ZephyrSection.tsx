"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, FlaskConical, Info, ListChecks, Loader2, PlayCircle, RefreshCw, Search, ShieldCheck, Sparkles, Stethoscope, Upload, X } from "lucide-react";
import FolderTree from "@/components/zephyr/FolderTree";
import RunsView from "@/components/zephyr/RunsView";
import CritRegressView from "@/components/zephyr/CritRegressView";
import ProbeModal from "@/components/zephyr/ProbeModal";
import { CaseCard } from "@/components/zephyr/parts";
import { ApplyDialog, StagedCaseCard } from "@/components/zephyr/StagingParts";
import { loadStaging, saveStaging, stagingFromXml, takeHandoff, usedFolders, type ApplyResult, type Parent, type Staging } from "@/lib/zephyrStaging";
import { getJiraSettings } from "@/lib/jiraApi";
import { getCases, getTree, type ZCase, type ZFolder } from "@/lib/zephyrApi";

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
  const [tab, setTab] = useState<"cases" | "runs" | "crit">("crit");
  const [baseUrl, setBaseUrl] = useState("");
  const [probeOpen, setProbeOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [tree, setTree] = useState<{ folders: ZFolder[]; total?: number; source: string } | null>(null);
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
          <button type="button" role="tab" aria-selected={tab === "crit"} onClick={() => setTab("crit")} className={tabCls(tab === "crit")}>
            <ShieldCheck className="w-4 h-4" /> Крит регресс</button>
          <button type="button" role="tab" aria-selected={tab === "cases"} onClick={() => setTab("cases")} className={tabCls(tab === "cases")}>
            <ListChecks className="w-4 h-4" /> Кейсы</button>
          <button type="button" role="tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")} className={tabCls(tab === "runs")}>
            <PlayCircle className="w-4 h-4" /> Прогоны</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setReloadKey(k => k + 1)} title="Обновить из Jira" aria-label="Обновить из Jira"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle"><RefreshCw className="w-4 h-4" /></button>
          <button type="button" onClick={() => setProbeOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
            <Stethoscope className="w-4 h-4" /> Проверить API</button>
        </div>
      </div>
      <div className="flex items-start gap-2 px-6 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>Запросы Zephyr на вашем стенде ещё не проверены: если что-то не загрузится или не сохранится — нажмите «Проверить API»
          и пришлите отчёт. Правка кейсов, папок и прогонов — следующим этапом.</span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "crit" ? <CritRegressView key={project} project={project} baseUrl={baseUrl} />
          : tab === "runs" ? <RunsView project={project} baseUrl={baseUrl} reloadKey={reloadKey} /> : (
          <div className="flex h-full min-h-0">
            <div className="w-80 flex-shrink-0 border-r border-border-main p-3 min-h-0 flex flex-col gap-2">
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
              {!tree && !treeErr ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю папки…</p>
                // Черновик новой модели виден и без дерева (Jira недоступна) — раскладку можно начать и применить позже.
                : (tree || staging) && <FolderTree key={project} folders={tree?.folders ?? []} total={tree?.total} selected={folder}
                    onSelect={p => { setFolder(p); setCaseKey(null); setStagedPick(null); }}
                    staging={staging} pickedCase={stagedPick} onPickCase={id => { setStagedPick(id); setCaseKey(null); }}
                    onMoveCase={moveCase} onMoveFolder={moveFolder} />}
              </div>
            </div>

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
                      <tr><th className="text-left px-4 py-2 w-36">Ключ</th><th className="text-left px-3 py-2">Название</th>
                        <th className="text-left px-3 py-2 w-28">Статус</th><th className="text-left px-3 py-2 w-24">Приоритет</th>
                        <th className="text-left px-3 py-2 w-40">Владелец</th></tr>
                    </thead>
                    <tbody>
                      {cases.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                          {text ? `По «${text}» кейсов нет.` : folder ? "В этой папке кейсов нет (кейсы вложенных папок — в самих папках)." : "Кейсов нет."}</td></tr>
                      )}
                      {cases.map(c => (
                        <tr key={c.key} onClick={() => setCaseKey(c.key)} aria-selected={caseKey === c.key}
                          className={`border-t border-border-main cursor-pointer ${caseKey === c.key ? "bg-primary/5" : "hover:bg-bg-subtle/60"}`}>
                          <td className="px-4 py-1.5 font-mono text-xs text-primary whitespace-nowrap">{c.key}</td>
                          <td className="px-3 py-1.5 text-text-main">
                            <span className="block truncate max-w-[520px]">{c.name}</span>
                            {!folder && c.folder && <span className="block text-[11px] text-text-muted truncate">{c.folder}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-text-main whitespace-nowrap">{c.status || "—"}</td>
                          <td className="px-3 py-1.5 text-text-main whitespace-nowrap">{c.priority || "—"}</td>
                          <td className="px-3 py-1.5 text-text-muted truncate">{c.owner || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {caseKey && <div className="w-[420px] flex-shrink-0 min-h-0"><CaseCard caseKey={caseKey} baseUrl={baseUrl} onClose={() => setCaseKey(null)} /></div>}
            {stagedPick && staging && !caseKey && (
              <div className="w-[420px] flex-shrink-0 min-h-0"><StagedCaseCard staging={staging} caseId={stagedPick} onClose={() => setStagedPick(null)} /></div>
            )}
          </div>
        )}
      </div>
      {probeOpen && <ProbeModal open project={project} onClose={() => setProbeOpen(false)} />}
      {applyOpen && staging && <ApplyDialog project={project} staging={staging} onDone={afterApply} onClose={() => setApplyOpen(false)} />}
    </div>
  );
}
