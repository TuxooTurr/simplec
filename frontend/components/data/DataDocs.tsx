"use client";
/* Hallmark · document workspace · local Shark tokens · pre-emit critique P4 H4 E4 S5 R5 V4 */

import { notify, onPage } from "@/lib/notifications";
import { useEffect, useState } from "react";
import { FilePlus2, KeyRound, Loader2 } from "lucide-react";
import DocTree from "@/components/data/DocTree";
import { Resizer, usePaneSize } from "@/components/zephyr/Resizer";
import DocPage from "@/components/data/DocPage";
import NewDocForm from "@/components/data/NewDocForm";
import ConfluenceSettingsModal from "@/components/settings/ConfluenceSettingsModal";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { usePanelRefresh } from "@/components/ui/RefreshButton";
import {
  addReqFolder, addRequirement, deleteReqFolder, deleteRequirement, generateRequirementDoc, getRequirementDocJob, waitForRequirementDoc, cancelRequirementDoc, listReqFolders,
  listRequirements, renderRequirementDiagrams, updateReqFolder, updateRequirement, type ReqFolder, type Requirement,
} from "@/lib/api";

const DIAGRAM_NEEDS_RENDERING = /(?:^ {0,3}(?:`{3}(?:plantuml|puml)\s*$|@startuml\b)|Для отрисовки схем настройте PlantUML на сервере Shark|PlantUML не смог обработать схему|Не удалось запустить встроенный рендерер PlantUML)/im;

const LAST_KEY = "st_data_doc";   // последний открытый документ — удобство одного браузера

/**
 * Раздел «Данные»: слева дерево папок с документами (как в Notion), справа — открытый документ или форма нового.
 * Документы — те же требования (data/requirements.json): их по-прежнему выбирают в генерации и в дефектах.
 */
export default function DataDocs() {
  const { provider } = useWorkspace();
  const [folders, setFolders] = useState<ReqFolder[]>([]);
  const [docs, setDocs] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [docJob, setDocJob] = useState<{ id: string; progress: string } | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);   // папка нового документа; null — не создаём
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null);

  const load = async () => {
    setErr("");
    try {
      const [f, d] = await Promise.all([listReqFolders(), listRequirements()]);
      setFolders(f); setDocs(d);
      return d;
    } catch (e) { setErr((e as Error).message); return null; }
    finally { setLoading(false); }
  };

  // «/etalons?req=<id>» (так документ открывает Jira tool) — открыть его; иначе — последний открытый.
  useEffect(() => {
    void load().then(d => {
      if (!d) return;
      let want = new URLSearchParams(window.location.search).get("req");
      if (!want) { try { want = localStorage.getItem(LAST_KEY); } catch { /* приватный режим */ } }
      if (want && d.some(x => x.id === want)) setSelected(want);
    });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string | null, release = "") => {
    setReleaseId(release);
    setSelected(id); setCreating(null);
    try { if (id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); } catch { /* приватный режим */ }
  };
  const replace = (d: Requirement) => setDocs(ds => ds.map(x => (x.id === d.id ? d : x)));
  const fail = (e: unknown) => setErr((e as Error).message);

  const doc = docs.find(d => d.id === selected) ?? null;
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const id = selected;
    const update = (progress: string) => { if (live) setDocJob(progress ? { id, progress } : null); };
    void getRequirementDocJob(id).then(async job => {
      if (!live || job.status !== "running") return;
      update(job.progress);
      try {
        const updated = await waitForRequirementDoc(id, update);
        if (live) replace(updated);
      } catch (e) {
        if (live && (e as Error).message !== "Обработка отменена.") fail(e);
      } finally { if (live) setDocJob(null); }
    }, () => {});
    return () => { live = false; };
  }, [selected]);
  const renderNeeded = !!doc && [doc.qa_doc, ...(doc.release_pages ?? []).map(page => page.markdown)]
    .some(text => DIAGRAM_NEEDS_RENDERING.test(text));
  const updatedAt = doc?.updated_at;
  const generating = docJob?.id === selected;
  useEffect(() => {
    if (!selected || !renderNeeded || generating || creating !== null) return;
    const controller = new AbortController();
    setRendering(selected);
    void renderRequirementDiagrams(selected, controller.signal).then(updated => {
      if (!controller.signal.aborted) {
        setDocs(current => current.map(item => item.id === updated.id && item.updated_at <= updated.updated_at ? updated : item));
      }
    }, error => {
      if (!controller.signal.aborted) setErr((error as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setRendering(null); });
    return () => { controller.abort(); setRendering(null); };
  }, [selected, renderNeeded, generating, creating, updatedAt]);
  // Дерево — шириной, которую тянут мышью (длинные названия папок видны целиком); запоминается в браузере.
  const treePane = usePaneSize("tree", 288, 220, 720, "st_data_panes");

  // «Обновить» — в шапке панели, как у всех разделов.
  usePanelRefresh(() => void load(), { title: "Перечитать дерево" });

  return (
    <div className="flex flex-col md:flex-row gap-0 h-full min-h-[360px] bg-bg-card overflow-hidden">
      <aside style={{ "--data-tree-width": `${treePane.size}px` } as React.CSSProperties} className="w-full md:w-[var(--data-tree-width)] max-h-48 md:max-h-none flex-shrink-0 bg-bg-subtle/40 flex flex-col p-2 min-h-0 border-b md:border-b-0 border-border-main">
        {loading ? (
          <p className="flex items-center gap-2 px-2 py-3 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загрузка…</p>
        ) : (
          <DocTree folders={folders} docs={docs} selected={creating === null ? selected : null}
            selectedRelease={releaseId} onSelect={select}
            onNewDoc={folderId => { setCreating(folderId); }}
            onCreateFolder={async (name, parent) => { try { const f = await addReqFolder(name, parent); setFolders(fs => [...fs, f]); } catch (e) { fail(e); } }}
            onRenameFolder={async (id, name) => { try { const f = await updateReqFolder(id, { name }); setFolders(fs => fs.map(x => (x.id === id ? f : x))); } catch (e) { fail(e); } }}
            onMoveFolder={(id, parent) => void updateReqFolder(id, { parent_id: parent }).then(f => setFolders(fs => fs.map(x => (x.id === id ? f : x))), fail)}
            onMoveDoc={(id, folder) => void updateRequirement(id, { folder_id: folder }).then(replace, fail)}
            onDeleteFolder={f => {
              if (!confirm(`Удалить папку «${f.name}» со всеми вложенными папками?\nДокументы не удалятся — перейдут в папку уровнем выше.`)) return;
              void deleteReqFolder(f.id).then(() => load(), fail);
            }} />
        )}
        <div className="mt-auto flex items-center gap-1">
          <span className="flex-1" />
          <button type="button" onClick={() => setSettingsOpen(true)} title="Единый вход в Jira и Confluence, подключение к Confluence"
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-muted hover:text-text-main rounded-md hover:bg-bg-subtle">
            <KeyRound className="w-3.5 h-3.5" /> Учётная запись
          </button>
        </div>
      </aside>
      <div className="hidden md:flex"><Resizer pane={treePane} label="Ширина дерева документов" /></div>

      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-4 md:p-6">
        {err && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
        {creating !== null ? (
          <NewDocForm key={creating} folders={folders} folderId={creating} onCancel={() => setCreating(null)}
            onSettings={() => setSettingsOpen(true)}
            onImported={async first => { await load(); select(first); }}
            onSave={async d => {
              const made = await addRequirement(d);
              setDocs(ds => [made, ...ds]);
              select(made.id);
            }} />
        ) : doc ? (<>
          {rendering === doc.id && <p role="status" className="mb-2 flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Отрисовываю схемы…
          </p>}
          <DocPage jobProgress={docJob?.id === doc.id ? docJob.progress : ""} onCancelGenerate={async () => { await cancelRequirementDoc(doc.id); }}
            releaseId={releaseId} onRelease={setReleaseId} doc={doc} folders={folders} provider={provider}
            onPatch={async patch => replace(await updateRequirement(doc.id, patch))}
            onGenerate={async (links, focus) => {
              const name = doc.name;
              try {
                replace(await generateRequirementDoc(doc.id, provider, links, focus,
                  progress => setDocJob(progress ? { id: doc.id, progress } : null)));
                notify({ kind: "success", title: "Документ QA готов", text: name, links: [{ label: "Открыть Данные", href: "/etalons" }], silent: onPage("/etalons") });
              } catch (e) {
                if ((e as Error).message !== "Обработка отменена.") {
                  notify({ kind: "error", title: "Документ QA не сгенерирован", text: `${name} · ${(e as Error).message}`, silent: onPage("/etalons") });
                }
                throw e;
              } finally { setDocJob(job => job?.id === doc.id ? null : job); }
            }}
            onReplace={replace}
            onSettings={() => setSettingsOpen(true)}
            onDelete={() => {
              if (!confirm(`Удалить документ «${doc.name}»?`)) return;
              void deleteRequirement(doc.id).then(() => { setDocs(ds => ds.filter(x => x.id !== doc.id)); select(null); }, fail);
            }} />
        </>) : !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center text-sm text-text-muted gap-3">
            <p>Выберите документ слева или создайте новый.</p>
            <button type="button" onClick={() => setCreating("")}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark shadow-sm">
              <FilePlus2 className="w-4 h-4" /> Новый документ
            </button>
          </div>
        )}
      </main>
      <ConfluenceSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Учётная запись и подключение к Confluence" />
    </div>
  );
}
