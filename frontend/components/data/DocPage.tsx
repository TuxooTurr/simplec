"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Folder, Loader2, Paperclip, Pencil, Save, Sparkles, Tag, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import NotionRenderer, { looksLikeMarkdown } from "@/components/NotionRenderer";
import QaDocView from "@/components/data/QaDocView";
import { parseFile, type ReqFolder, type Requirement } from "@/lib/api";

export const ACCEPT_FILES = ".pdf,.docx,.doc,.xlsx,.xls,.xml,.png,.jpg,.jpeg,.txt,.md,.markdown";

const BTN = "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-main text-text-main " +
  "hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all";
const BTN_PRIMARY = "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white " +
  "hover:bg-primary-dark shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]";
const INPUT = "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

/** Путь папки для подписей: «Релиз 26 / Карточка». */
export function folderPath(folders: ReqFolder[], id: string): string {
  const parts: string[] = [];
  for (let cur = folders.find(f => f.id === id); cur && parts.length < 20; cur = folders.find(f => f.id === cur!.parent_id)) parts.unshift(cur.name);
  return parts.join(" / ");
}

/** Варианты «куда положить» для выпадающего списка: все папки деревом (с отступом по вложенности). */
export function folderOptions(folders: ReqFolder[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [{ id: "", label: "— корень —" }];
  const ids = new Set(folders.map(f => f.id));
  const walk = (parent: string, depth: number) => {
    for (const f of folders.filter(x => (x.parent_id && ids.has(x.parent_id) ? x.parent_id : "") === parent)) {
      out.push({ id: f.id, label: `${"   ".repeat(depth)}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

/** Текст из файла: PDF — сразу в Markdown (заголовки, списки, абзацы), остальное — как отдаёт разбор файлов. */
export async function fileToText(file: File): Promise<string> {
  return (await parseFile(file, { markdown: true })).text;
}

/** Исходник: размеченный — отрисованным (с переключателем на текст разметки), обычный текст — как есть. */
export function SourceView({ text, actions }: { text: string; actions?: React.ReactNode }) {
  const md = looksLikeMarkdown(text);
  const [raw, setRaw] = useState(false);
  const tab = (on: boolean) => `px-2 py-0.5 rounded text-[11px] ${on ? "bg-bg-card text-text-main font-medium shadow-sm" : "text-text-muted hover:text-text-main"}`;
  return (
    <div>
      {(md || actions) && (
        <div className="mb-3 flex items-center gap-2">
          {md && (
            <div className="inline-flex gap-0.5 rounded-lg bg-bg-subtle p-0.5" role="group" aria-label="Вид исходника">
              <button type="button" onClick={() => setRaw(false)} aria-pressed={!raw} className={tab(!raw)}>Разметка</button>
              <button type="button" onClick={() => setRaw(true)} aria-pressed={raw} className={tab(raw)}>Текст</button>
            </div>
          )}
          <span className="flex-1" />
          {actions}
        </div>
      )}
      {md && !raw ? <NotionRenderer text={text} /> : (
        <pre className="text-sm text-text-main whitespace-pre-wrap leading-relaxed font-sans">{text}</pre>
      )}
    </div>
  );
}

/** Правка исходника: Markdown вручную или заменить текстом из файла. */
function SourceEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFileBusy(true); setErr("");
    try { setText(await fileToText(f)); } catch (e) { setErr((e as Error).message); }
    setFileBusy(false);
  };
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={e => setText(e.target.value)} aria-label="Исходник (Markdown)"
        className={`${INPUT} min-h-[360px] font-mono text-[13px] leading-relaxed resize-y`} />
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept={ACCEPT_FILES} className="hidden" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className={BTN} disabled={fileBusy} onClick={() => fileRef.current?.click()}>
          {fileBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />} Заменить из файла
        </button>
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={onCancel} disabled={busy}><X className="w-3.5 h-3.5" /> Отмена</button>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !text.trim()}
          onClick={async () => { setBusy(true); setErr(""); try { await onSave(text); } catch (e) { setErr((e as Error).message); } setBusy(false); }}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Сохранить
        </button>
      </div>
    </div>
  );
}

const size = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K символов` : `${n} символов`);

/**
 * Документ «Данных», как страница в Notion: заголовок правится прямо в шапке, ниже — свойства (фича, папка)
 * и содержимое. Пока QA-документа нет, содержимое — исходник (Markdown отрисован). «Преобразовать в документ QA»
 * собирает QA-документ; после этого исходник сворачивается в кнопку «Исходник» (открывается окном), а на странице —
 * QA-документ, внизу свёрнут текст для краткого рассказа о функционале.
 */
export default function DocPage({ doc, folders, provider, onPatch, onGenerate, onDelete }: {
  doc: Requirement;
  folders: ReqFolder[];
  provider: string;
  onPatch: (patch: { name?: string; feature?: string; text?: string; folder_id?: string }) => Promise<void>;
  onGenerate: () => Promise<void>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(doc.name);
  const [feature, setFeature] = useState(doc.feature);
  useEffect(() => { setTitle(doc.name); setFeature(doc.feature); }, [doc.id, doc.name, doc.feature]);
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setEditing(false); setSourceOpen(false); setErr(""); setNote(""); }, [doc.id]);

  const save = async (patch: Parameters<typeof onPatch>[0]) => {
    setErr("");
    try { await onPatch(patch); } catch (e) { setErr((e as Error).message); throw e; }
  };
  const saveTitle = () => {
    const t = title.trim();
    if (!t) { setTitle(doc.name); return; }
    if (t !== doc.name) void save({ name: t }).catch(() => setTitle(doc.name));
  };
  const saveFeature = () => { if (feature.trim() !== doc.feature) void save({ feature }).catch(() => setFeature(doc.feature)); };
  const generate = async () => {
    if (!provider) { setErr("Выберите LLM-провайдер в шапке"); return; }
    setGen(true); setErr("");
    try { await onGenerate(); } catch (e) { setErr((e as Error).message); }
    setGen(false);
  };
  const saveSource = async (text: string) => {
    await save({ text });
    setEditing(false);
    if (doc.qa_doc) setNote("Исходник сохранён. Чтобы документ QA учёл правку — «Обновить документ QA».");
  };
  const hasQa = !!doc.qa_doc;
  const where = folderPath(folders, doc.folder_id ?? "");

  return (
    <article className="max-w-4xl mx-auto px-2 pb-16">
      <p className="mb-2 flex items-center gap-1.5 text-xs text-text-muted">
        <Folder className="w-3.5 h-3.5" /> {where || "Корень"}
      </p>
      <input value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} aria-label="Заголовок документа"
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setTitle(doc.name); (e.target as HTMLInputElement).blur(); } }}
        placeholder="Без названия"
        className="w-full bg-transparent text-3xl font-bold text-text-main placeholder:text-text-muted/50 rounded-md px-1 -mx-1 hover:bg-bg-subtle/60 focus:bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />

      {/* Свойства — как строки свойств страницы в Notion */}
      <div className="mt-3 grid grid-cols-[110px_1fr] items-center gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5 text-text-muted"><Tag className="w-3.5 h-3.5" /> Фича</span>
        <input value={feature} onChange={e => setFeature(e.target.value)} onBlur={saveFeature} placeholder="Пусто" aria-label="Фича"
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full max-w-sm bg-transparent rounded-md px-1.5 py-0.5 text-text-main placeholder:text-text-muted/50 hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <span className="flex items-center gap-1.5 text-text-muted"><Folder className="w-3.5 h-3.5" /> Папка</span>
        <select value={doc.folder_id ?? ""} onChange={e => void save({ folder_id: e.target.value }).catch(() => undefined)} aria-label="Папка документа"
          className="w-full max-w-sm bg-transparent rounded-md px-1 py-0.5 text-text-main hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30">
          {folderOptions(folders).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="flex items-center gap-1.5 text-text-muted"><FileText className="w-3.5 h-3.5" /> Исходник</span>
        <span className="text-text-muted text-xs">{size(doc.text.length)} · изменён {new Date(doc.updated_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
      </div>

      {/* Действия */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-border-main py-2.5">
        {hasQa ? (
          <>
            <button type="button" className={BTN} onClick={() => setSourceOpen(true)} aria-haspopup="dialog">
              <FileText className="w-4 h-4 text-emerald-500" /> Исходник <span className="text-xs text-text-muted">· {size(doc.text.length)}</span>
            </button>
            <button type="button" className={BTN} onClick={() => void generate()} disabled={gen}>
              {gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Собираю документ QA…" : "Обновить документ QA"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={BTN_PRIMARY} onClick={() => void generate()} disabled={gen || editing}>
              {gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Собираю документ QA…" : "Преобразовать в документ QA"}
            </button>
            {!editing && <button type="button" className={BTN} onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Править исходник</button>}
          </>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onDelete} title="Удалить документ"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
          <Trash2 className="w-4 h-4" /> Удалить
        </button>
      </div>

      {err && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}
      {note && <p className="mt-3 text-sm text-text-muted">{note}</p>}
      {hasQa && doc.qa_doc_truncated && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Документ QA обрезан лимитом модели — конец может отсутствовать.</p>
      )}

      <div className="mt-5">
        {hasQa ? <QaDocView doc={doc.qa_doc} />
          : editing ? <SourceEditor initial={doc.text} onSave={saveSource} onCancel={() => setEditing(false)} />
          : <SourceView text={doc.text} />}
      </div>

      <Modal open={sourceOpen} onClose={() => { setSourceOpen(false); setEditing(false); }} title={`Исходник · ${doc.name}`} size="max-w-4xl">
        <div className="max-h-[70vh] overflow-y-auto scrollbar-thin pr-1">
          {editing ? <SourceEditor initial={doc.text} onSave={saveSource} onCancel={() => setEditing(false)} />
            : <SourceView text={doc.text} actions={<button type="button" className={BTN} onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Править</button>} />}
        </div>
      </Modal>
    </article>
  );
}
