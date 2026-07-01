"use client";

import { type ReactNode } from "react";
import { Modal } from "./Modal";

/**
 * Единый шаблон «менеджер подключений»: модалка со списком слева и формой
 * добавления/редактирования справа. Эталон — Kafka Explorer; переиспользуется
 * Ревизором, Тестовыми данными и Логами VPS для единообразия.
 */
export interface ConnectionsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: { ok: boolean; text: string } | null;
  listTitle: string;
  list: ReactNode;
  formTitle: string;
  form: ReactNode;
  size?: string;
}

export function ConnectionsModal({
  open, onClose, title, message, listTitle, list, formTitle, form, size = "max-w-2xl",
}: ConnectionsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size={size}>
      {message && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${message.ok ? "tone-success" : "tone-danger"}`}>
          {message.text}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-text-muted">{listTitle}</p>
          {list}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-text-muted">{formTitle}</p>
          {form}
        </div>
      </div>
    </Modal>
  );
}

export interface ConnectionRowAction {
  key: string;
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  hoverClass?: string;
}

export interface ConnectionRowProps {
  name: string;
  subtitle?: ReactNode;
  actions: ConnectionRowAction[];
}

export function ConnectionRow({ name, subtitle, actions }: ConnectionRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-main px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-main">{name}</p>
        {subtitle && <p className="truncate font-mono text-[11px] text-text-muted">{subtitle}</p>}
      </div>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          title={a.title}
          className={`rounded p-1 text-text-muted hover:bg-bg-subtle disabled:opacity-40 ${a.hoverClass ?? "hover:text-text-main"}`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

export default ConnectionsModal;
