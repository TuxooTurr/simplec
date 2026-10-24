"use client";

import { useState } from "react";
import { Download, Eye, FileText, Folder, KeyRound, Loader2, Target, X } from "lucide-react";
import { folderOptions, SourceView } from "@/components/data/DocPage";
import { importConfluence, previewConfluence, type ConfluencePage, type ReqFolder } from "@/lib/api";

const INPUT = "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";
const BTN = "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-main text-text-main " +
  "hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Документ из Confluence: ссылка на страницу (или её id, или /display/ПРОСТРАНСТВО/Заголовок), по желанию — с дочерними
 * страницами (они лягут деревом папок, как в Confluence). «Показать» — что придёт, без сохранения; «Загрузить» — в папку.
 */
export default function ConfluenceImport({ folders, folderId, onImported, onCancel, onSettings }: {
  folders: ReqFolder[];
  folderId: string;
  onImported: (firstId: string) => Promise<void>;
  onCancel: () => void;
  onSettings: () => void;
}) {
  const [ref, setRef] = useState("");
  const [children, setChildren] = useState(false);
  const [focus, setFocus] = useState("");
  const [folder, setFolder] = useState(folderId);
  const [pages, setPages] = useState<ConfluencePage[] | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState<"" | "preview" | "import">("");
  const [err, setErr] = useState("");

  const preview = async () => {
    setBusy("preview"); setErr(""); setPages(null);
    try { const r = await previewConfluence(ref.trim(), children); setPages(r.pages); setShown(0); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const doImport = async () => {
    setBusy("import"); setErr("");
    try { const r = await importConfluence(ref.trim(), children, folder, focus.trim()); await onImported(r.created[0].id); }
    catch (e) { setErr((e as Error).message); setBusy(""); }
  };
  const needsAuth = /маркер|401|токен/i.test(err);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input autoFocus value={ref} onChange={e => { setRef(e.target.value); setPages(null); }} aria-label="Страница Confluence"
          onKeyDown={e => { if (e.key === "Enter" && ref.trim()) void preview(); }}
          placeholder="https://confluence.sberbank.ru/pages/viewpage.action?pageId=… или id страницы" className={INPUT} />
        <button type="button" className={BTN} disabled={!ref.trim() || !!busy} onClick={() => void preview()}>
          {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Показать</button>
      </div>
      <div className="grid grid-cols-[120px_1fr] items-center gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5 text-text-muted"><Target className="w-3.5 h-3.5" /> Что нужно</span>
        <input value={focus} onChange={e => setFocus(e.target.value)} aria-label="Что именно нужно" placeholder="Уточнение для документа QA, если на странице несколько СТ"
          className="w-full bg-transparent rounded-md px-1.5 py-0.5 text-text-main placeholder:text-text-muted/50 hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <span className="flex items-center gap-1.5 text-text-muted"><Folder className="w-3.5 h-3.5" /> Папка</span>
        <select value={folder} onChange={e => setFolder(e.target.value)} aria-label="Папка"
          className="w-full max-w-sm bg-transparent rounded-md px-1 py-0.5 text-text-main hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30">
          {folderOptions(folders).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-text-main">
        <input type="checkbox" checked={children} onChange={e => { setChildren(e.target.checked); setPages(null); }} />
        С дочерними страницами — деревом папок, как в Confluence (до 3 уровней, не больше 60 страниц)
      </label>

      {err && (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <span className="flex-1">{err}</span>
          {needsAuth && <button type="button" className={BTN} onClick={onSettings}><KeyRound className="w-4 h-4" /> Войти</button>}
        </div>
      )}

      {pages && (
        <div className="rounded-xl border border-border-main">
          <div className="flex items-center gap-2 border-b border-border-main px-3 py-2">
            <span className="text-sm font-medium text-text-main">Придёт страниц: {pages.length}</span>
            <span className="flex-1" />
            <button type="button" className={BTN} onClick={onCancel}><X className="w-4 h-4" /> Отмена</button>
            <button type="button" disabled={!!busy} onClick={() => void doImport()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark shadow-sm disabled:opacity-50">
              {busy === "import" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Загрузить</button>
          </div>
          {pages.length > 1 && (
            <ul className="border-b border-border-main px-2 py-1.5 max-h-40 overflow-y-auto scrollbar-thin">
              {pages.map((p, i) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setShown(i)} style={{ paddingLeft: 8 + p.depth * 16 }}
                    className={`w-full flex items-center gap-1.5 rounded py-0.5 text-left text-sm ${i === shown ? "bg-primary/10 text-primary" : "text-text-main hover:bg-bg-subtle"}`}>
                    <FileText className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{p.title}</span>
                    <span className="text-xs text-text-muted">v{p.version}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 py-3 max-h-[50vh] overflow-y-auto scrollbar-thin">
            <h2 className="mb-2 text-xl font-bold text-text-main">{pages[shown].title}</h2>
            {pages[shown].markdown ? <SourceView text={pages[shown].markdown} /> : <p className="text-sm text-text-muted">Страница пустая.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
