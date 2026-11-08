"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Check, Folder, LayoutTemplate, Pencil, Plus, Rocket, Search, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { NO_FOLDER, OWN_TYPE_LABEL, type OwnField, type TaskList } from "@/lib/jiraTool";

const INPUT = "min-w-0 flex-1 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 text-sm text-text-main " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30";
const H = "text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/**
 * Редактирование списка — карандашом у списка слева: имя, шаблон, папки, свои поля, источники задач, архив и удаление.
 * Колонки и группировка — над таблицей, рядом с «Добавить задачи».
 */
export default function ListEditModal({
  list, templateNames, onClose, onRename, onSaveTemplate, onAddFolder, onRenameFolder, onDeleteFolder, onOwn, onUntrack,
  onArchive, onRestore, onDelete,
}: {
  list: TaskList;
  templateNames: string[];
  onClose: () => void;
  onRename: (name: string) => void;
  onSaveTemplate: (name: string) => void;
  onAddFolder: (name: string) => void;
  onRenameFolder: (name: string, next: string) => void;
  onDeleteFolder: (name: string) => void;
  /** Своё поле: null — новое. */
  onOwn: (field: OwnField | null) => void;
  /** Перестать сверять состав с источником (задачи остаются). */
  onUntrack: (sourceId: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [tpl, setTpl] = useState<string | null>(null);
  const [tplDone, setTplDone] = useState("");
  const [folder, setFolder] = useState("");
  const [editFolder, setEditFolder] = useState<{ was: string; now: string } | null>(null);
  const [askFolder, setAskFolder] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const commitName = () => { const v = name.trim(); if (v && v !== list.name) onRename(v); else setName(list.name); };
  const addFolder = () => { const v = folder.trim(); if (v) { onAddFolder(v); setFolder(""); } };
  const count = (f: string) => list.keys.filter(k => list.folders?.[k] === f).length;

  return (
    <Modal open onClose={onClose} title="Список" size="max-w-lg">
      <div className="space-y-5">
        <section className="space-y-1.5">
          <label htmlFor="list-name" className={H}>Название</label>
          <input id="list-name" value={name} onChange={e => setName(e.target.value)} onBlur={commitName}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} maxLength={80} className={`${INPUT} w-full`} />
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className={H}>Шаблон</p>
            {tpl === null && (
              <button type="button" onClick={() => { setTpl(list.name); setTplDone(""); }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <LayoutTemplate className="h-3.5 w-3.5" /> Сохранить как шаблон</button>
            )}
          </div>
          {tpl !== null ? (
            <div className="space-y-1.5 rounded-lg bg-bg-subtle p-2.5">
              <p className="text-[11px] text-text-muted">
                В шаблон попадут колонки ({list.columns.length}), свои поля ({list.ownFields.length}) и папки ({list.folderList?.length ?? 0}). Задачи — нет.
              </p>
              <div className="flex gap-1.5">
                <input autoFocus value={tpl} onChange={e => setTpl(e.target.value)} maxLength={60} placeholder="Название шаблона" aria-label="Название шаблона"
                  onKeyDown={e => { if (e.key === "Enter" && tpl.trim()) { onSaveTemplate(tpl.trim()); setTplDone(tpl.trim()); setTpl(null); } if (e.key === "Escape") setTpl(null); }}
                  className={INPUT} />
                <button type="button" disabled={!tpl.trim()} onClick={() => { onSaveTemplate(tpl.trim()); setTplDone(tpl.trim()); setTpl(null); }}
                  className="rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-40">Сохранить</button>
                <button type="button" onClick={() => setTpl(null)} aria-label="Отмена" className="px-1 text-text-muted hover:text-text-main"><X className="h-4 w-4" /></button>
              </div>
              {templateNames.includes(tpl.trim()) && <p className="text-[11px] text-amber-700 dark:text-amber-300">Шаблон с таким названием будет заменён.</p>}
            </div>
          ) : tplDone ? (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300" role="status"><Check className="h-3.5 w-3.5" /> Шаблон «{tplDone}» сохранён</p>
          ) : (
            <p className="text-xs text-text-muted">Колонки, свои поля и папки этого списка — заготовкой для новых списков.</p>
          )}
        </section>

        <section className="space-y-1.5">
          <p className={H}>Папки</p>
          <ul className="space-y-0.5">
            {!list.folderList?.length && <li className="text-xs text-text-muted">Нет. Папки делят список на разделы; группировка — внутри каждой.</li>}
            {(list.folderList ?? []).map(f => (
              <li key={f}>
                {askFolder === f ? (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-xs dark:bg-red-950/40">
                    <span className="flex-1 text-text-main">Удалить «{f}»?{count(f) > 0 && <> Задачи ({count(f)}) уйдут в «{NO_FOLDER}».</>}</span>
                    <button type="button" onClick={() => { onDeleteFolder(f); setAskFolder(null); }} className="rounded-md bg-red-600 px-2 py-0.5 font-semibold text-white">Удалить</button>
                    <button type="button" onClick={() => setAskFolder(null)} className="rounded-md border border-border-main px-2 py-0.5 text-text-muted">Нет</button>
                  </div>
                ) : editFolder?.was === f ? (
                  <input autoFocus value={editFolder.now} onChange={e => setEditFolder({ was: f, now: e.target.value })} aria-label={`Новое имя папки ${f}`}
                    onBlur={() => { const v = editFolder.now.trim(); if (v && v !== f) onRenameFolder(f, v); setEditFolder(null); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditFolder(null); }}
                    className={`${INPUT} w-full`} />
                ) : (
                  <div className="group/f flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-text-main hover:bg-bg-subtle">
                    <Folder className="h-4 w-4 flex-shrink-0 text-text-muted" />
                    <span className="flex-1 truncate">{f}</span>
                    <span className="text-xs text-text-muted">{count(f)}</span>
                    <button type="button" onClick={() => setEditFolder({ was: f, now: f })} aria-label={`Переименовать папку ${f}`}
                      className="rounded p-0.5 text-text-muted opacity-0 hover:text-text-main group-hover/f:opacity-100 focus-visible:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setAskFolder(f)} aria-label={`Удалить папку ${f}`}
                      className="rounded p-0.5 text-text-muted opacity-0 hover:text-red-500 group-hover/f:opacity-100 focus-visible:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            <input value={folder} onChange={e => setFolder(e.target.value)} onKeyDown={e => e.key === "Enter" && addFolder()}
              placeholder="Новая папка" aria-label="Новая папка" className={INPUT} />
            <button type="button" onClick={addFolder} disabled={!folder.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-border-main px-2.5 text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
              <Plus className="h-4 w-4" /> Добавить</button>
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className={H}>Свои поля</p>
            <button type="button" onClick={() => onOwn(null)} className="text-xs text-primary hover:underline">+ поле</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {list.ownFields.length === 0 && <span className="text-xs text-text-muted">Нет — например, дата ретеста или стенд.</span>}
            {list.ownFields.map(f => (
              <button key={f.id} type="button" onClick={() => onOwn(f)} title={`${OWN_TYPE_LABEL[f.type]} — изменить`}
                className="inline-flex items-center gap-1 rounded-md bg-bg-subtle px-2 py-1 text-xs text-text-main hover:text-primary">
                <Pencil className="h-3 w-3" /> {f.name}</button>
            ))}
          </div>
        </section>

        {!!list.sources?.length && (
          <section className="space-y-1.5">
            <p className={H} title="При обновлении из Jira состав сверяется: новые — «n», выпавшие — «У»">Источники · сверка состава</p>
            <ul className="space-y-0.5">
              {list.sources.map(src => (
                <li key={src.id} className="group/s flex items-center gap-1.5 text-xs text-text-muted"
                  title={`Задач в составе: ${src.keys.length} · сверено ${src.checkedAt}`}>
                  {src.kind === "jql" ? <Search className="h-3.5 w-3.5 flex-shrink-0" /> : <Rocket className="h-3.5 w-3.5 flex-shrink-0" />}
                  <span className={`min-w-0 flex-1 truncate text-text-main ${src.kind === "jql" ? "font-mono" : ""}`}>{src.name}</span>
                  <span>{src.keys.length}</span>
                  <button type="button" onClick={() => onUntrack(src.id)} aria-label={`Не отслеживать: ${src.name}`} title="Не отслеживать состав (задачи останутся)"
                    className="rounded p-0.5 opacity-0 hover:text-red-500 group-hover/s:opacity-100 focus-visible:opacity-100"><X className="h-3 w-3" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border-main pt-3">
          {list.archivedAt ? (
            <button type="button" onClick={onRestore} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
              <ArchiveRestore className="h-4 w-4" /> Вернуть из архива</button>
          ) : (
            <button type="button" onClick={onArchive} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
              <Archive className="h-4 w-4" /> В архив</button>
          )}
          {askDelete ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs">
              <span className="text-text-muted">Удалить список? Задачи в Jira останутся.</span>
              <button type="button" onClick={onDelete} className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white">Удалить</button>
              <button type="button" onClick={() => setAskDelete(false)} className="rounded-md border border-border-main px-2 py-1 text-text-muted">Нет</button>
            </span>
          ) : (
            <button type="button" onClick={() => setAskDelete(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              <Trash2 className="h-4 w-4" /> Удалить список</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
