"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Folder, History, Link2, Loader2, Paperclip, Pencil, Save, Sparkles, Tag, Target, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import NotionRenderer, { headingSlug, looksLikeMarkdown } from "@/components/NotionRenderer";
import QaDocView from "@/components/data/QaDocView";
import SourcesBar from "@/components/data/SourcesBar";
import VersionChanges from "@/components/data/VersionChanges";
import MarkdownEditor from "@/components/data/MarkdownEditor";
import QaGenerateModal from "@/components/data/QaGenerateModal";
import { newReqVersion, parseFile, type ReqFolder, type Requirement } from "@/lib/api";

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

/** Текст из файла: PDF и DOCX — сразу в Markdown (заголовки, списки, абзацы, таблицы), остальное — как отдаёт разбор файлов. */
export async function fileToText(file: File): Promise<string> {
  return (await parseFile(file, { markdown: true })).text;
}

/** Исходник: размеченный — отрисованным (с переключателем на текст разметки), обычный текст — как есть. */
export function SourceView({ text, actions, anchors = false }: { text: string; actions?: React.ReactNode; anchors?: boolean }) {
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
      {md && !raw ? <NotionRenderer text={text} anchors={anchors} /> : (
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
      <MarkdownEditor value={text} onChange={setText} minHeight={360} autoFocus />
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
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "");
const PROP_INPUT = "w-full max-w-xl bg-transparent rounded-md px-1.5 py-0.5 text-text-main placeholder:text-text-muted/50 hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30";

/** Новая версия документа: доработка фичи — новый исходник и что изменили. */
function NewVersionModal({ open, initial, onClose, onSave }: { open: boolean; initial: string; onClose: () => void; onSave: (text: string, note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  useEffect(() => { if (open) setNote(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Новая версия документа" size="max-w-4xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">Текущие исходник и документ QA сохранятся в истории версий; документ QA для новой версии нужно будет собрать заново.</p>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Что доработали (например: добавлен фильтр по статусу)" aria-label="Что доработали" className={INPUT} />
        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
          <SourceEditor initial={initial} onSave={text => onSave(text, note)} onCancel={onClose} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Документ «Данных», как страница в Notion: заголовок правится прямо в шапке, ниже — свойства и содержимое.
 *  • «Что нужно» — уточнение для документа QA, если в исходнике несколько СТ: ИИ смотрит на название и уточнение;
 *  • «Confluence» — страницы (СТ), из которых собран исходник: добавить СТ, обновить из Confluence;
 *  • «Версия» — переключатель версий (прошлые — только просмотр) и свод «что изменилось» со ссылками на разделы.
 * Пока QA-документа нет, содержимое — исходник; после «Преобразовать в документ QA» исходник — кнопка с окном,
 * на странице — QA-документ, внизу свёрнут текст для краткого рассказа о функционале.
 */
export default function DocPage({ doc, folders, provider, onPatch, onGenerate, onDelete, onReplace, onSettings }: {
  doc: Requirement;
  folders: ReqFolder[];
  provider: string;
  onPatch: (patch: { name?: string; feature?: string; focus?: string; text?: string; folder_id?: string }) => Promise<void>;
  onGenerate: (links: string[], focus: string) => Promise<void>;
  onDelete: () => void;
  onReplace: (d: Requirement) => void;
  onSettings: () => void;
}) {
  const [title, setTitle] = useState(doc.name);
  const [feature, setFeature] = useState(doc.feature);
  const [focus, setFocus] = useState(doc.focus ?? "");
  useEffect(() => { setTitle(doc.name); setFeature(doc.feature); setFocus(doc.focus ?? ""); }, [doc.id, doc.name, doc.feature, doc.focus]);
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [newVer, setNewVer] = useState(false);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const cur = doc.version ?? 1;
  const [viewN, setViewN] = useState(cur);
  useEffect(() => { setEditing(false); setSourceOpen(false); setErr(""); setNote(""); }, [doc.id]);
  useEffect(() => { setViewN(doc.version ?? 1); }, [doc.id, doc.version]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const history = doc.versions ?? [];
  const isCur = viewN === cur;
  const old = history.find(v => v.n === viewN);
  const view = isCur || !old
    ? { text: doc.text, qa_doc: doc.qa_doc, qa_doc_truncated: doc.qa_doc_truncated, at: doc.version_at ?? doc.created_at, note: doc.version_note ?? "" }
    : old;
  const versionsDesc = [cur, ...history.map(v => v.n).filter(n => n !== cur)].sort((a, b) => b - a);
  const prevN = versionsDesc.filter(n => n < viewN)[0];

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
  const saveFocus = () => { if (focus.trim() !== (doc.focus ?? "")) void save({ focus }).catch(() => setFocus(doc.focus ?? "")); };
  const [qaOpen, setQaOpen] = useState(false);
  const generate = async () => {
    if (!provider) { setErr("Выберите LLM-провайдер в шапке"); return; }
    setErr("");
    setQaOpen(true);
  };
  /** Из окна сборки: ошибка — в окне (оно не закроется), успех — окно закрывается. */
  const runGenerate = async (links: string[], f: string) => {
    setGen(true);
    try { await onGenerate(links, f); setFocus(f); } finally { setGen(false); }
  };
  const saveSource = async (text: string) => {
    await save({ text });
    setEditing(false);
    if (doc.qa_doc) setNote("Исходник сохранён. Чтобы документ QA учёл правку — «Обновить документ QA».");
  };
  /** К месту в документе: раздел по якорю заголовка, подсветка на пару секунд. */
  const jump = (section: string) => {
    const root = bodyRef.current;
    if (!root) return;
    const el = (section ? root.querySelector<HTMLElement>(`#${CSS.escape(headingSlug(section))}`) : null) ?? root;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("bg-amber-100", "dark:bg-amber-900/40", "rounded");
    setTimeout(() => el.classList.remove("bg-amber-100", "dark:bg-amber-900/40", "rounded"), 1800);
  };
  const hasQa = !!view.qa_doc;
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
      <div className="mt-3 grid grid-cols-[120px_1fr] items-start gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5 pt-0.5 text-text-muted"><Tag className="w-3.5 h-3.5" /> Фича</span>
        <input value={feature} onChange={e => setFeature(e.target.value)} onBlur={saveFeature} placeholder="Пусто" aria-label="Фича"
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={PROP_INPUT} />
        <span className="flex items-center gap-1.5 pt-0.5 text-text-muted" title="Если в исходнике несколько СТ, ИИ возьмёт только то, что относится к функции из названия и этого уточнения">
          <Target className="w-3.5 h-3.5" /> Что нужно</span>
        <input value={focus} onChange={e => setFocus(e.target.value)} onBlur={saveFocus} aria-label="Что именно нужно"
          placeholder="Уточнение для документа QA, если СТ несколько: например, только выгрузка карточки в PDF"
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={PROP_INPUT} />
        <span className="flex items-center gap-1.5 pt-0.5 text-text-muted"><Folder className="w-3.5 h-3.5" /> Папка</span>
        <select value={doc.folder_id ?? ""} onChange={e => void save({ folder_id: e.target.value }).catch(() => undefined)} aria-label="Папка документа"
          className="w-full max-w-sm bg-transparent rounded-md px-1 py-0.5 text-text-main hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30">
          {folderOptions(folders).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="flex items-center gap-1.5 pt-0.5 text-text-muted"><Link2 className="w-3.5 h-3.5" /> Confluence</span>
        <SourcesBar key={doc.id} doc={doc} onError={setErr} onSettings={onSettings}
          onChanged={(d, msg) => { onReplace(d); if (msg) setNote(msg); }} />
        <span className="flex items-center gap-1.5 pt-0.5 text-text-muted"><History className="w-3.5 h-3.5" /> Версия</span>
        <div className="flex flex-wrap items-center gap-2">
          <select value={viewN} onChange={e => setViewN(Number(e.target.value))} aria-label="Версия документа"
            className="max-w-md bg-transparent rounded-md px-1 py-0.5 text-text-main hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/30">
            {versionsDesc.map(n => {
              const v = n === cur ? { at: doc.version_at ?? doc.created_at, note: doc.version_note ?? "" } : history.find(h => h.n === n)!;
              return <option key={n} value={n}>{`Версия ${n}${n === cur ? " (текущая)" : ""} · ${when(v.at)}${v.note ? ` · ${v.note.slice(0, 60)}` : ""}`}</option>;
            })}
          </select>
          {isCur && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setNewVer(true)}>+ Новая версия</button>}
        </div>
        <span className="flex items-center gap-1.5 pt-0.5 text-text-muted"><FileText className="w-3.5 h-3.5" /> Исходник</span>
        <span className="text-text-muted text-xs pt-1">{size(view.text.length)} · изменён {when(isCur ? doc.updated_at : view.at)}</span>
      </div>

      {!isCur && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <History className="w-4 h-4 shrink-0" /> Версия {viewN} от {when(view.at)} — только просмотр{view.note ? `: ${view.note}` : ""}.
          <span className="flex-1" />
          <button type="button" className="font-medium hover:underline" onClick={() => setViewN(cur)}>К текущей версии</button>
        </div>
      )}

      {/* Действия (у прошлой версии без документа QA их нет — полосу не рисуем) */}
      {(isCur || hasQa) && <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-border-main py-2.5">
        {hasQa && (
          <button type="button" className={BTN} onClick={() => setSourceOpen(true)} aria-haspopup="dialog">
            <FileText className="w-4 h-4 text-emerald-500" /> Исходник <span className="text-xs text-text-muted">· {size(view.text.length)}</span>
          </button>
        )}
        {isCur && (hasQa ? (
          <button type="button" className={BTN} onClick={() => void generate()} disabled={gen}>
            {gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Собираю документ QA…" : "Обновить документ QA"}
          </button>
        ) : (
          <>
            <button type="button" className={BTN_PRIMARY} onClick={() => void generate()} disabled={gen || editing}>
              {gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Собираю документ QA…" : "Преобразовать в документ QA"}
            </button>
            {!editing && <button type="button" className={BTN} onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Править исходник</button>}
          </>
        ))}
        <span className="flex-1" />
        {isCur && (
          <button type="button" onClick={onDelete} title="Удалить документ"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
            <Trash2 className="w-4 h-4" /> Удалить
          </button>
        )}
      </div>}

      {err && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}
      {note && <p className="mt-3 text-sm text-text-muted">{note}</p>}
      {isCur && hasQa && (doc.qa_links?.length || doc.qa_link_errors?.length) ? (
        <div className="mt-3 text-xs text-text-muted">
          {doc.qa_links?.length ? <p>Собран по исходнику и страницам: {doc.qa_links.map((l, i) => (
            <span key={l.url}>{i > 0 && ", "}<a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{l.title}</a></span>))}</p> : null}
          {doc.qa_link_errors?.length ? <p className="text-amber-700 dark:text-amber-300">Не прочитаны: {doc.qa_link_errors.join("; ")}</p> : null}
        </div>
      ) : null}
      {hasQa && view.qa_doc_truncated && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Документ QA обрезан лимитом модели — конец может отсутствовать.</p>
      )}

      {prevN !== undefined && <VersionChanges docId={doc.id} a={prevN} b={viewN} onJump={jump} />}

      <div ref={bodyRef} className="mt-5">
        {hasQa ? <QaDocView doc={view.qa_doc} anchors />
          : editing && isCur ? <SourceEditor initial={doc.text} onSave={saveSource} onCancel={() => setEditing(false)} />
          : <SourceView text={view.text} anchors />}
      </div>

      <Modal open={sourceOpen} onClose={() => { setSourceOpen(false); setEditing(false); }} title={`Исходник · ${doc.name}${isCur ? "" : ` · версия ${viewN}`}`} size="max-w-4xl">
        <div className="max-h-[70vh] overflow-y-auto scrollbar-thin pr-1">
          {editing && isCur ? <SourceEditor initial={doc.text} onSave={saveSource} onCancel={() => setEditing(false)} />
            : <SourceView text={view.text} actions={isCur ? <button type="button" className={BTN} onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Править</button> : undefined} />}
        </div>
      </Modal>
      <QaGenerateModal open={qaOpen} doc={doc} onClose={() => setQaOpen(false)} onGenerate={runGenerate} />
      <NewVersionModal open={newVer} initial={doc.text} onClose={() => setNewVer(false)}
        onSave={async (text, n) => { onReplace(await newReqVersion(doc.id, text, n)); setNewVer(false); setNote("Создана новая версия — соберите для неё документ QA."); }} />
    </article>
  );
}
