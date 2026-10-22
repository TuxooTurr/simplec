"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { deleteCasesChunked, exportFolderXml, folderKeys, forgetFolder } from "@/lib/zephyrApi";

type Errors = { key: string; error: string }[];

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <p className="text-xs text-text-muted tabular-nums">{label}: {done} из {total}</p>
    </div>
  );
}

const ErrorList = ({ errors, what }: { errors: Errors; what: string }) => errors.length ? (
  <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-300">
    <p className="font-semibold">{what}: {errors.length}</p>
    <p className="max-h-28 overflow-y-auto scrollbar-thin">{errors.slice(0, 50).map(e => `${e.key} — ${e.error}`).join("; ")}</p>
  </div>
) : null;

/** Сколько кейсов и папок под папкой (с вложенными) — для текста окна до запуска. */
function useFolderSize(project: string, folder: string) {
  const [size, setSize] = useState<{ cases: number; folders: number } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    folderKeys(project, folder).then(r => live && setSize({ cases: r.keys.length, folders: r.folders.length }), e => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [project, folder]);
  return { size, err };
}

/**
 * Выгрузка папки со всеми вложенными (folder "" — весь проект) в Zephyr XML: папки (и пустые), кейсы со всеми
 * полями, шагами, связями и пользовательскими полями. Тот же формат принимает «Новая модель из XML».
 */
export function ExportFolderModal({ project, folder, onClose }: { project: string; folder: string; onClose: () => void }) {
  const { size, err: sizeErr } = useFolderSize(project, folder);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<{ file: string; exported: number; total: number; errors: Errors } | null>(null);
  const stop = useRef(false);
  const title = folder ? folder.slice(folder.lastIndexOf("/") + 1) : "вся модель";

  const go = async () => {
    setBusy(true); setErr(""); stop.current = false;
    try {
      const r = await exportFolderXml(project, folder, (done, total) => setProg({ done, total }), () => stop.current);
      const d = new Date();
      const stamp = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
      const file = `Zephyr — ${project} — ${title} — ${stamp}.xml`.replace(/[\\/:*?"<>|]+/g, "_");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.blob); a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setRes({ file, exported: r.exported, total: r.total, errors: r.errors });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Выгрузка в XML · ${title}`} size="max-w-lg">
      <div className="space-y-3 text-sm">
        <p className="text-text-main">
          {folder ? <>Папка <span className="font-mono">{folder}</span> со всеми вложенными папками на всех уровнях.</> : <>Весь проект {project}.</>}
          {" "}{size ? <>Кейсов: <b>{size.cases}</b>, папок: <b>{size.folders}</b>.</> : sizeErr ? "" : <Loader2 className="inline w-3.5 h-3.5 animate-spin" />}
        </p>
        <p className="text-xs text-text-muted">
          В файле — структура папок (и пустые папки) и кейсы со всеми полями: название, цель, предусловие, приоритет, статус,
          метки, владелец, длительность, связи с задачами, пользовательские поля, шаги. Формат — Zephyr XML: этот же файл
          принимает «Новая модель из XML». Шагов в модели SimpleTest нет, поэтому кейсы читаются из Jira пачками по 100.
        </p>
        {sizeErr && <p className="text-red-600 dark:text-red-400">{sizeErr}</p>}
        {prog && !res && <Progress done={prog.done} total={prog.total} label="Прочитано кейсов из Jira" />}
        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
        {res && (
          <p className="text-text-main">Выгружено кейсов: <b>{res.exported}</b> из {res.total} — файл «{res.file}».</p>
        )}
        {res && <ErrorList errors={res.errors} what="Не прочитались из Jira (в файл не попали)" />}
        <div className="flex justify-end gap-2">
          {busy
            ? <button type="button" onClick={() => { stop.current = true; }} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отменить</button>
            : <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">{res ? "Готово" : "Отмена"}</button>}
          {!res && (
            <button type="button" onClick={go} disabled={busy || !size}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Выгрузить</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Удаление папки: все её кейсы и кейсы вложенных папок удаляются из Zephyr (пачками, с прогрессом), папка уходит
 * из дерева SimpleTest. Сама папка в Zephyr остаётся пустой — публичный API Zephyr папки не удаляет.
 */
export function DeleteFolderModal({ project, folder, onDone, onClose }: {
  project: string; folder: string;
  onDone: (r: { deleted: number; errors: Errors }) => void;
  onClose: () => void;
}) {
  const { size, err: sizeErr } = useFolderSize(project, folder);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const go = async () => {
    setBusy(true); setErr("");
    try {
      // Ключи — заново перед удалением: за время чтения окна модель могла поменяться.
      const { keys } = await folderKeys(project, folder);
      const r = await deleteCasesChunked(project, keys, (done, total) => setProg({ done, total }));
      await forgetFolder(project, folder);
      onDone({ deleted: r.deleted.length, errors: r.errors });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Удалить папку · ${folder.slice(folder.lastIndexOf("/") + 1)}`} size="max-w-lg">
      <div className="space-y-3 text-sm">
        <p className="text-text-main">
          Удалить папку <span className="font-mono">{folder}</span> со всеми вложенными папками?{" "}
          {size ? <>Из Zephyr будут удалены кейсы: <b className="text-red-600 dark:text-red-400">{size.cases}</b> (папок: {size.folders}).</>
            : sizeErr ? "" : <Loader2 className="inline w-3.5 h-3.5 animate-spin" />}
          {" "}Отменить будет нельзя.
        </p>
        <p className="text-xs text-text-muted">
          Публичный API Zephyr не удаляет папки — удаляются их кейсы. Пустая папка в Zephyr останется (её можно удалить в
          интерфейсе Zephyr), в дереве SimpleTest её не будет. Кейс, который не удалится (например, нет прав), оставит свою
          папку в дереве.
        </p>
        {sizeErr && <p className="text-red-600 dark:text-red-400">{sizeErr}</p>}
        {prog && <Progress done={prog.done} total={prog.total} label="Удалено кейсов" />}
        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отмена</button>
          <button type="button" onClick={go} disabled={busy || !size}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Удалить папку и кейсы</button>
        </div>
      </div>
    </Modal>
  );
}

/** Удаление новой папки из черновика (в Jira её ещё нет): вместе с вложенными новыми папками и их кейсами. */
export function DeleteStagedFolderModal({ name, cases, folders, onConfirm, onClose }: {
  name: string; cases: number; folders: number; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Убрать новую папку · ${name}`} size="max-w-md">
      <div className="space-y-3 text-sm">
        <p className="text-text-main">Убрать из черновика папку «{name}»{folders ? ` и вложенные (${folders})` : ""} вместе с кейсами: <b>{cases}</b>?</p>
        <p className="text-xs text-text-muted">В Jira эта папка ещё не создана — ничего в Zephyr не удаляется, меняется только черновик.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-text-muted">Отмена</button>
          <button type="button" onClick={onConfirm} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold">
            <Trash2 className="w-4 h-4" /> Убрать</button>
        </div>
      </div>
    </Modal>
  );
}
