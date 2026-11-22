"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  browserSummary, downloadBackup, makeBackup, readBackup, restoreBackup, sectionTitle,
  type BackupFile, type RestoreResult, type RestoreMode,
} from "@/lib/backupApi";

/**
 * Резервная копия окном — для разделов (кнопка BackupButton, импорт в Jira tool).
 * В «Настройках» то же содержимое стоит прямо во вкладке «Резервная копия» (BackupPanel), без окна.
 */
export default function BackupModal({ open, onClose, section, file }: {
  open: boolean; onClose: () => void;
  /** Раздел, откуда открыли: «только этот раздел» по умолчанию предлагается он. */
  section: string;
  /** Файл, уже выбранный в другом месте (импорт в Jira tool узнал резервную копию). */
  file?: File | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Резервная копия данных" size="max-w-2xl">
      {/* Содержимое монтируется при открытии — каждое открытие начинается с чистого листа. */}
      {open && <BackupPanel section={section} file={file} />}
    </Modal>
  );
}

/**
 * Резервная копия: выгрузить данные раздела или всех разделов в .json и восстановить из файла.
 * Восстановление показывает, что есть в файле по разделам, и заменяет только отмеченные.
 */
export function BackupPanel({ section, file: file0 }: { section: string; file?: File | null }) {
  const [scope, setScope] = useState<"section" | "all">("all");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState<BackupFile | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<RestoreResult | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const modeId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (file0) void load(file0);
  }, [file0]);   // eslint-disable-line react-hooks/exhaustive-deps

  const doExport = async () => {
    setBusy(true); setNote(null);
    try {
      const b = await makeBackup(scope === "all" ? "all" : section);
      const name = downloadBackup(b);
      const parts = b.summary.length + (Object.keys(b.browser?.localStorage ?? {}).length ? " + данные браузера" : "");
      const skipped = (b.server.skipped as string[] | undefined) ?? [];
      setNote({ ok: !skipped.length, text: `Сохранено: ${name} (разделов с данными: ${parts})` + (skipped.length ? `. Не вошло: ${skipped.join("; ")}` : "") });
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const load = async (f: File) => {
    setBusy(true); setNote(null); setDone(null);
    try {
      const b = await readBackup(f);
      setLoaded(b); setMode("merge");
      const ids = new Set([...b.summary.map(s => s.id), ...Object.keys(browserSummary(b))]);
      setPicked(ids);
    } catch (e) { setLoaded(null); setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const doRestore = async () => {
    if (!loaded) return;
    setBusy(true); setNote(null);
    try {
      const r = await restoreBackup(loaded, [...picked], mode);
      setDone(r);
      // Разделы держат данные браузера в памяти и при первом сохранении затёрли бы восстановленное — перезагружаемся.
      if (r.browserKeys || Object.values(r.restored).some(values => values?.length)) setTimeout(() => window.location.reload(), 4000);
    }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const browser = loaded ? browserSummary(loaded) : {};
  const rows = loaded ? Array.from(new Set([...loaded.summary.map(s => s.id), ...Object.keys(browser)])) : [];

  return (
      <div className="space-y-5 text-sm">
        <section className="space-y-2">
          <h3 className="font-semibold text-text-main">Выгрузить в файл</h3>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Что выгрузить">
            <label className="flex items-start gap-2 cursor-pointer text-text-main">
              <input type="radio" className="mt-1" checked={scope === "all"} onChange={() => setScope("all")} />
              <span>Все разделы
                <span className="block text-xs text-text-muted">виджеты и счётчики Главной, документы, подключения к БД, скрипты, справочники, настройки</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-text-main">
              <input type="radio" checked={scope === "section"} onChange={() => setScope("section")} />
              Только «{sectionTitle(section)}»
            </label>
          </div>
          <button type="button" onClick={doExport} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
            {busy && !loaded ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Скачать .json</button>
          <p className="text-xs text-text-muted">Токены, пароли и ключи API в файл не попадают — после восстановления на новой установке их вводят заново.
            Перед удалением папки Shark выгрузите «Все разделы».</p>
        </section>

        <section className="space-y-2 border-t border-border-main pt-4">
          <h3 className="font-semibold text-text-main">Восстановить из файла</h3>
          <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-hidden tabIndex={-1}
            onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-text-main hover:bg-bg-subtle disabled:opacity-50">
            <Upload className="w-4 h-4" /> Выбрать файл</button>
          {loaded && !done && (
            <div className="space-y-2">
              <p className="text-xs text-text-muted">
                Копия от {loaded.createdAt.replace("T", " ").slice(0, 16)} · {loaded.scope === "all" ? "все разделы" : loaded.scopeTitle}.
                Выберите разделы и способ восстановления.</p>
              <fieldset disabled={busy} className="space-y-2 rounded-lg border border-border-main p-3" role="radiogroup" aria-label="Способ восстановления">
                <label className="flex items-start gap-2 cursor-pointer"><input type="radio" name={modeId} value="merge" checked={mode === "merge"} onChange={() => setMode("merge")} className="mt-1" />
                  <span><b>Дополнить</b><span className="block text-xs text-text-muted">Добавить недостающие записи и настройки. Существующие значения сохраняются.</span></span></label>
                <label className="flex items-start gap-2 cursor-pointer"><input type="radio" name={modeId} value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-1" />
                  <span><b>Перезаписать</b><span className="block text-xs text-text-muted">Заменить файлы, таблицы и значения, представленные в копии. Невыбранные разделы и отсутствующие в копии хранилища сохраняются.</span></span></label>
              </fieldset>
              <ul className="divide-y divide-border-main border border-border-main rounded-lg">
                {rows.map(id => {
                  const s = loaded.summary.find(x => x.id === id);
                  const what = [
                    s?.files.length ? `файлов ${s.files.length}` : "", s?.tables.length ? `таблиц ${s.tables.length}` : "",
                    s?.settings ? `настроек ${s.settings}` : "", s?.assets ? `рисунков ${s.assets}` : "",
                    browser[id] ? `данных браузера ${browser[id]}` : "",
                    s?.widgets !== undefined ? `списков ${s.widgets}` : "", s?.counters !== undefined ? `счётчиков ${s.counters}` : "",
                  ].filter(Boolean).join(", ");
                  return (
                    <li key={id}>
                      <label className="flex items-start gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-bg-subtle">
                        <input type="checkbox" disabled={busy} className="mt-0.5" checked={picked.has(id)}
                          onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(id); else n.delete(id); return n; })} />
                        <span className="text-text-main font-medium w-48 flex-shrink-0">{sectionTitle(id)}</span>
                        <span className="text-xs text-text-muted" title={s?.files.join(", ")}>{what}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button type="button" onClick={doRestore} disabled={busy || !picked.size}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Восстановить отмеченное ({picked.size})</button>
              <p className="text-xs text-text-muted">Перед восстановлением создаётся снимок данных сервера. «Главная» включает раскладку, фильтры, колонки, размеры, цвета и очередь счётчиков. Для значений ST переносите также Jira tool либо все разделы.</p>
            </div>
          )}
          {done && (
            <div className="rounded-lg border border-green-600/40 bg-green-600/5 p-2.5 space-y-1 text-xs">
              <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400 font-semibold text-sm"><Check className="w-4 h-4" /> {done.errors.length ? "Восстановлено с замечаниями" : "Восстановлено"} · {mode === "merge" ? "дополнение" : "перезапись"}</p>
              <p className="text-text-main">Файлов {done.restored.files.length}, таблиц {done.restored.tables.length}, настроек {done.restored.settings.length},
                рисунков {done.restored.assets?.length ?? 0}, данных браузера {done.browserKeys}.</p>
              <p className="text-text-muted">Снимок до восстановления: {done.snapshot}</p>
              {done.errors.length > 0 && <p className="text-amber-700 dark:text-amber-300">Не восстановлено: {done.errors.join("; ")}</p>}
              {(done.browserKeys > 0 || Object.values(done.restored).some(values => values?.length)) && <p className="text-text-main">Страница перезагрузится через несколько секунд.</p>}
              <button type="button" onClick={() => window.location.reload()}
                className="mt-1 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold">Перезагрузить сейчас</button>
            </div>
          )}
        </section>

        {note && (
          <p className={`flex items-start gap-1.5 text-sm ${note.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {note.ok ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}{note.text}</p>
        )}
      </div>
  );
}
