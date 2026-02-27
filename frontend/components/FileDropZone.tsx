"use client";

import { useRef, useState, useCallback } from "react";
import { CloudUpload, FileText, X, Loader2 } from "lucide-react";

interface FileDropZoneProps {
  onFile: (file: File) => void;
  loading?: boolean;
  accept?: string;            // e.g. ".pdf,.docx,.txt"
  hint?: string;              // shown below icon
  className?: string;
}

const ACCEPT_DEFAULT = ".pdf,.docx,.doc,.xlsx,.xls,.xml,.txt";
const HINT_DEFAULT   = "PDF, DOCX, XLSX, XML, TXT";

export default function FileDropZone({
  onFile,
  loading = false,
  accept = ACCEPT_DEFAULT,
  hint = HINT_DEFAULT,
  className = "",
}: FileDropZoneProps) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]   = useState(false);
  const [fileName, setFileName]   = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      onFile(file);
    },
    [onFile],
  );

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); };
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFileName(null);
  };

  return (
    <div
      onClick={() => !loading && inputRef.current?.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`
        relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
        cursor-pointer select-none transition-all duration-200
        ${dragging
          ? "border-primary bg-indigo-50 scale-[1.01]"
          : fileName
          ? "border-green-300 bg-green-50/50"
          : "border-border-main bg-gray-50/60 hover:border-primary/50 hover:bg-indigo-50/30"
        }
        ${loading ? "pointer-events-none opacity-70" : ""}
        ${className}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onInputChange}
      />

      {loading ? (
        <>
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-text-muted">Читаю файл...</p>
        </>
      ) : fileName ? (
        <>
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <FileText className="w-5 h-5 text-green-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-main truncate max-w-[240px]">{fileName}</p>
            <p className="text-xs text-green-600 mt-0.5">Файл загружен — нажмите для замены</p>
          </div>
          <button
            onClick={clear}
            className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-white border border-border-main
              flex items-center justify-center text-text-muted hover:text-red-500 hover:border-red-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200
            ${dragging ? "bg-indigo-100" : "bg-white border border-border-main"}`}
          >
            <CloudUpload className={`w-5 h-5 transition-colors duration-200 ${dragging ? "text-primary" : "text-text-muted"}`} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-main">
              {dragging ? "Отпустите файл" : "Перетащите файл или нажмите"}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{hint}</p>
          </div>
        </>
      )}
    </div>
  );
}
