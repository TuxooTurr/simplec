"use client";

import { useEffect, useState } from "react";
import { FilePlus2, KeyRound, Loader2, RefreshCw } from "lucide-react";
import DocTree from "@/components/data/DocTree";
import { Resizer, usePaneSize } from "@/components/zephyr/Resizer";
import DocPage from "@/components/data/DocPage";
import NewDocForm from "@/components/data/NewDocForm";
import ConfluenceSettingsModal from "@/components/settings/ConfluenceSettingsModal";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  addReqFolder, addRequirement, deleteReqFolder, deleteRequirement, generateRequirementDoc, listReqFolders,
  listRequirements, updateReqFolder, updateRequirement, type ReqFolder, type Requirement,
} from "@/lib/api";

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
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);   // папка нового документа; null — не создаём
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const select = (id: string | null) => {
    setSelected(id); setCreating(null);
    try { if (id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); } catch { /* приватный режим */ }
  };
  const replace = (d: Requirement) => setDocs(ds => ds.map(x => (x.id === d.id ? d : x)));
  const fail = (e: unknown) => setErr((e as Error).message);

  const doc = docs.find(d => d.id === selected) ?? null;
  // Дерево — шириной, которую тянут мышью (длинные названия папок видны целиком); запоминается в браузере.
  const treePane = usePaneSize("tree", 288, 220, 720, "st_data_panes");

  return (
    <div className="flex gap-0 h-[calc(100vh-170px)] min-h-[480px] rounded-xl border border-border-main bg-bg-card overflow-hidden">
      <aside style={{ width: treePane.size }} className="flex-shrink-0 bg-bg-subtle/40 flex flex-col p-2 min-h-0">
        {loading ? (
          <p className="flex items-center gap-2 px-2 py-3 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загрузка…</p>
        ) : (
          <DocTree folders={folders} docs={docs} selected={creating === null ? selected : null}
            onSelect={id => select(id)}
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
          <button type="button" onClick={() => void load()} title="Перечитать дерево"
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-muted hover:text-text-main rounded-md hover:bg-bg-subtle">
            <RefreshCw className="w-3.5 h-3.5" /> Обновить
          </button>
          <span className="flex-1" />
          <button type="button" onClick={() => setSettingsOpen(true)} title="Единый вход в Jira и Confluence, подключение к Confluence"
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-muted hover:text-text-main rounded-md hover:bg-bg-subtle">
            <KeyRound className="w-3.5 h-3.5" /> Учётная запись
          </button>
        </div>
      </aside>
      <Resizer pane={treePane} label="Ширина дерева документов" />

      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin px-8 py-6">
        {err && <p className="max-w-4xl mx-auto mb-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
        {creating !== null ? (
          <NewDocForm key={creating} folders={folders} folderId={creating} onCancel={() => setCreating(null)}
            onSettings={() => setSettingsOpen(true)}
            onImported={async first => { await load(); select(first); }}
            onSave={async d => {
              const made = await addRequirement(d);
              setDocs(ds => [made, ...ds]);
              select(made.id);
            }} />
        ) : doc ? (
          <DocPage doc={doc} folders={folders} provider={provider}
            onPatch={async patch => replace(await updateRequirement(doc.id, patch))}
            onGenerate={async (links, focus) => replace(await generateRequirementDoc(doc.id, provider, links, focus))}
            onReplace={replace}
            onSettings={() => setSettingsOpen(true)}
            onDelete={() => {
              if (!confirm(`Удалить документ «${doc.name}»?`)) return;
              void deleteRequirement(doc.id).then(() => { setDocs(ds => ds.filter(x => x.id !== doc.id)); select(null); }, fail);
            }} />
        ) : !loading && (
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
