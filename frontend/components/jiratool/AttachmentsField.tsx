"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { IMAGE_RE, fmtSize } from "@/lib/attachments";

/** Превью картинки: адрес объекта живёт, пока плитка на экране (иначе утечка памяти). */
function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" className="w-full h-full object-cover" /> : null;
}

/**
 * Вложения задачи: кнопка, перетаскивание и вставка из буфера (⌘V / Ctrl+V — её ловит вся форма).
 * Картинки — плитками с превью, остальное — строкой с размером. Всё уходит вложениями в Jira.
 */
export default function AttachmentsField({ files, onAdd, onRemove }: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div
      onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault(); setOver(false);
        onAdd(Array.from(e.dataTransfer.files));
      }}
      className={`rounded-lg border border-dashed p-2 transition-colors ${over ? "border-primary bg-primary/5" : "border-border-main"}`}>
      <input ref={input} type="file" multiple className="hidden"
        onChange={e => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={() => input.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-main bg-bg-card text-xs text-text-main hover:bg-bg-subtle">
          <Paperclip className="w-3.5 h-3.5" /> Приложить файл
        </button>
        <span className="text-[11px] text-text-muted">
          или перетащите сюда · скриншот — <kbd className="px-1 rounded border border-border-main bg-bg-card font-sans">{mac ? "⌘" : "Ctrl"}</kbd>+<kbd className="px-1 rounded border border-border-main bg-bg-card font-sans">V</kbd> в любом месте формы
        </span>
      </div>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Приложенные файлы">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} title={`${f.name} · ${fmtSize(f.size)}`}
              className="group/at relative flex items-center gap-1.5 rounded-md border border-border-main bg-bg-card text-xs text-text-main overflow-hidden">
              {IMAGE_RE.test(f.name) ? (
                <span className="w-14 h-10 flex-shrink-0 bg-bg-subtle"><Thumb file={f} /></span>
              ) : (
                <FileText className="w-4 h-4 ml-2 text-text-muted flex-shrink-0" />
              )}
              <span className="min-w-0 max-w-[150px] pr-6 py-1">
                <span className="block truncate">{f.name}</span>
                <span className="block text-[10px] text-text-muted">{fmtSize(f.size)}</span>
              </span>
              <button type="button" onClick={() => onRemove(i)} aria-label={`Убрать ${f.name}`}
                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-bg-card/80 text-text-muted hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
