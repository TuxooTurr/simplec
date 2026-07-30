"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";

import { uploadSettingsFile } from "@/lib/api";

/**
 * Поле «путь к файлу» с кнопкой загрузки — единый вид для всех настроек.
 *
 * Приём взят из настройки сертификатов GigaChat: путь можно вписать руками
 * (файл уже лежит на сервере) либо выбрать файл — он сохраняется в защищённую
 * папку с правами 0600, а путь подставляется в поле.
 *
 * Раньше каждая настройка решала это по-своему: где-то была только загрузка,
 * где-то только текстовое поле, а у части полей не было ничего.
 */
export interface FilePathInputProps {
  value:       string;
  onChange:    (path: string) => void;
  /** Имя файла на сервере: cert, kafka_ssl_ca, vps_ca_<id> и т.п.
   *  Не нужен, если задан свой uploader. */
  purpose?:    string;
  /** Своя загрузка — для настроек с отдельным эндпоинтом (например .jar драйвера).
   *  Должна вернуть путь либо пустую строку, если путь ведёт само приложение. */
  uploader?:   (file: File) => Promise<string>;
  placeholder?: string;
  /** Что принимать в диалоге выбора файла. */
  accept?:     string;
  disabled?:   boolean;
  /** Подпись над полем. */
  label?:      string;
  hint?:       string;
  className?:  string;
}

const INPUT_CLS =
  "w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition";

export function FilePathInput({
  value, onChange, purpose, uploader, placeholder, accept = ".pem,.crt,.cer,.key,.txt",
  disabled = false, label, hint, className = "",
}: FilePathInputProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const path = uploader
        ? await uploader(file)
        : (await uploadSettingsFile(purpose || "file", file)).path;
      // Свой загрузчик может не возвращать путь: приложение хранит файл само.
      if (path) onChange(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      )}
      <div className="flex gap-2 min-w-0">
        <input
          className={`${INPUT_CLS} flex-1 min-w-0 font-mono text-xs`}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled || uploading}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Очистить путь"
            className="shrink-0 rounded-lg border border-border-main px-2 text-text-muted
              hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <label
          className={`shrink-0 flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2
            text-xs font-medium text-text-main transition-colors ${
            disabled || uploading
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-bg-subtle cursor-pointer"}`}
        >
          {uploading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Upload className="w-3.5 h-3.5" />}
          Файл
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            disabled={disabled || uploading}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";   // тот же файл можно выбрать повторно
            }}
          />
        </label>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      {hint && !error && <p className="mt-1 text-[11px] text-text-muted/70">{hint}</p>}
    </div>
  );
}

export default FilePathInput;
