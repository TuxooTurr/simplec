"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { INPUT_CLS } from "./Input";

/** Значение, которым бэкенд подменяет сохранённый секрет: показываем, но не отправляем обратно. */
export const MASKED_PLACEHOLDER = "●●●●●●●●●●●●";

export interface PasswordInputProps {
  /** Ключ поля — возвращается в onChange, чтобы одна форма могла вести много полей. */
  fieldKey:     string;
  value:        string;
  onChange:     (key: string, val: string) => void;
  placeholder?: string;
}

/** Поле пароля с кнопкой «показать». Маску не отправляем: при фокусе поле очищается. */
export function PasswordInput({ fieldKey, value, onChange, placeholder }: PasswordInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} className={INPUT_CLS + " pr-8"}
        value={value}
        onChange={(e) => { if (e.target.value !== MASKED_PLACEHOLDER) onChange(fieldKey, e.target.value); }}
        onFocus={(e) => { if (e.target.value === MASKED_PLACEHOLDER) onChange(fieldKey, ""); }}
        placeholder={placeholder ?? ""} autoComplete="off" spellCheck={false} />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
        title={show ? "Скрыть" : "Показать"}>
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default PasswordInput;
