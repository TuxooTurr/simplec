"use client";

import { useRef, useState } from "react";
import { Eye, FileText, Folder, Globe, Loader2, Paperclip, Pencil, Save, Tag, X } from "lucide-react";
import { ACCEPT_FILES, fileToText, folderOptions, SourceView } from "@/components/data/DocPage";
import ConfluenceImport from "@/components/data/ConfluenceImport";
import type { ReqFolder } from "@/lib/api";

/**
 * Новый документ: заголовок, фича, папка и содержимое — Markdown вручную или из файла (PDF и DOCX собираются
 * в Markdown: заголовки, списки, абзацы, таблицы DOCX). «Просмотр» показывает, как разметка будет выглядеть на странице.
 */
export default function NewDocForm({ folders, folderId, onSave, onCancel, onImported, onSettings }: {
  folders: ReqFolder[];
  folderId: string;
  onSave: (d: { name: string; feature: string; text: string; folder_id: string }) => Promise<void>;
  onCancel: () => void;
  onImported: (firstId: string) => Promise<void>;
  onSettings: () => void;
}) {
  const [source, setSource] = useState<"manual" | "confluence">("manual");
  const [name, setName] = useState("");
  const [feature, setFeature] = useState("");
  const [folder, setFolder] = useState(folderId);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFileBusy(true); setErr("");
    try {
      setText(await fileToText(f));
      setFileName(f.name);
      if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
      setPreview(true);
    } catch (e) { setErr((e as Error).message); }
    setFileBusy(false);
  };
  const submit = async () => {
    setBusy(true); setErr("");
    try { await onSave({ name: name.trim(), feature: feature.trim(), text, folder_id: folder }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const BTN = "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-main text-text-main hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 transition-all";
  const tab = (on: boolean) => `inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs ${on ? "bg-bg-card text-text-main font-medium shadow-sm" : "text-text-muted hover:text-text-main"}`;

  const modeSwitch = (
    <div className="mb-3 inline-flex gap-0.5 rounded-lg bg-bg-subtle p-0.5" role="group" aria-label="Откуда документ">
      <button type="button" className={tab(source === "manual")} aria-pressed={source === "manual"} onClick={() => setSource("manual")}><Pencil className="w-3.5 h-3.5" /> Вручную или из файла</button>
      <button type="button" className={tab(source === "confluence")} aria-pressed={source === "confluence"} onClick={() => setSource("confluence")}><Globe className="w-3.5 h-3.5" /> Из Confluence</button>
    </div>
  );
  if (source === "confluence") return (
    <article className="max-w-4xl mx-auto px-2 pb-16">
      {modeSwitch}
      <h2 className="mb-3 text-2xl font-bold text-text-main">Новый документ из Confluence</h2>
      <ConfluenceImport folders={folders} folderId={folderId} onImported={onImported} onCancel={onCancel} onSettings={onSettings} />
    </article>
  );

  return (
    <article className="max-w-4xl mx-auto px-2 pb-16">
      {modeSwitch}
      <p className="mb-2 text-xs text-text-muted">Новый документ</p>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Без названия" aria-label="Заголовок документа"
        className="w-full bg-transparent text-3xl font-bold text-text-main placeholder:text-text-muted/50 rounded-md px-1 -mx-1 focus:outline-none focus:ring-2 focus:ring-primary/30" />
      <div className="mt-3 grid grid-cols-[110px_1fr] items-center gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5 text-text-muted"><Tag className="w-3.5 h-3.5" /> Фича</span>
        <input value={feature} onChange={e => setFeature(e.target.value)} placeholder="Пусто" aria-label="Фича"
          className="w-full max-w-sm bg-transparent rounded-md px-1.5 py-0.5 text-text-main placeholder:text-text-muted/50 hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <span className="flex items-center gap-1.5 text-text-muted"><Folder className="w-3.5 h-3.5" /> Папка</span>
        <select value={folder} onChange={e => setFolder(e.target.value)} aria-label="Папка документа"
          className="w-full max-w-sm bg-transparent rounded-md px-1 py-0.5 text-text-main hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30">
          {folderOptions(folders).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-border-main py-2.5">
        <div className="inline-flex gap-0.5 rounded-lg bg-bg-subtle p-0.5" role="group" aria-label="Режим">
          <button type="button" className={tab(!preview)} aria-pressed={!preview} onClick={() => setPreview(false)}><Pencil className="w-3.5 h-3.5" /> Текст</button>
          <button type="button" className={tab(preview)} aria-pressed={preview} onClick={() => setPreview(true)} disabled={!text.trim()}><Eye className="w-3.5 h-3.5" /> Просмотр</button>
        </div>
        <input ref={fileRef} type="file" accept={ACCEPT_FILES} className="hidden" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className={BTN} disabled={fileBusy} onClick={() => fileRef.current?.click()}>
          {fileBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />} {fileBusy ? "Читаю файл…" : "Загрузить из файла"}
        </button>
        {fileName && <span className="inline-flex items-center gap-1 text-xs text-text-muted"><FileText className="w-3.5 h-3.5" /> {fileName}</span>}
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={onCancel} disabled={busy}><X className="w-3.5 h-3.5" /> Отмена</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !name.trim() || !text.trim()}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Сохранить
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="mt-4">
        {preview && text.trim() ? <SourceView text={text} /> : (
          <textarea value={text} onChange={e => setText(e.target.value)} aria-label="Содержимое (Markdown)"
            placeholder={"Вставьте текст требования или Markdown:\n\n# Заголовок\n## Раздел\n- пункт списка\n\nили загрузите файл — PDF и DOCX соберутся в разметку."}
            className="w-full min-h-[420px] border border-border-main rounded-lg px-3 py-2 font-mono text-[13px] leading-relaxed bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
        )}
      </div>
    </article>
  );
}
