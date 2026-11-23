"use client";
import { useState, type ReactNode } from "react";
import { ArrowRightLeft, Pencil } from "lucide-react";
import BulkStatusModal from "./BulkStatusModal";
import { IssueEditModal } from "./IssueEditButton";
import type { Issue } from "@/lib/jiraTool";

/**
 * Значок-кнопка с подписью-подсказкой: название всплывает под значком сразу при наведении и при фокусе с клавиатуры.
 */
export function IconAction({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <span className="relative group/act inline-flex">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
        className="flex items-center justify-center w-8 h-8 rounded-lg border border-border-main text-text-main hover:bg-bg-subtle hover:text-primary hover:border-primary/40 disabled:opacity-40 disabled:hover:text-text-main disabled:hover:border-border-main focus-visible:ring-2 focus-visible:ring-primary">
        {icon}
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-0 top-full mt-1 z-50 whitespace-nowrap rounded-md bg-[var(--color-text-main)] px-2 py-1 text-[11px] text-[var(--color-bg-card)] shadow-lg opacity-0 transition-opacity group-hover/act:opacity-100 group-focus-within/act:opacity-100">
        {label}
      </span>
    </span>
  );
}

/**
 * Единые действия с задачами — во всех окнах и списках одинаково и в одном месте (слева над таблицей):
 * «Сменить статус» (переходы workflow Jira) и «Изменить задачу» (поля, одна или несколько задач).
 * Локальные черновики (без ключа Jira) не участвуют.
 */
export default function IssueActions({ issues, onDone, storiesOf = () => [], noun = "задачи", onStatusClosed, children }: {
  issues: Issue[];
  /** Ключи изменённых в Jira задач — перечитать. */
  onDone?: (keys: string[]) => void;
  /** Стори эпика — на них раскладывается смена статуса эпика (как в списке Jira tool). */
  storiesOf?: (epicKey: string) => Issue[];
  /** Чьё действие в подсказке: «задачи», «дефекты», «стори». */
  noun?: string;
  /** Окно смены статуса закрыто; moved — переходы выполнялись (например, снять выбор). */
  onStatusClosed?: (moved: boolean) => void;
  children?: ReactNode;
}) {
  const [status, setStatus] = useState(false);
  const [edit, setEdit] = useState(false);
  const valid = issues.filter(i => !i.local);
  const count = valid.length > 1 ? ` (${valid.length})` : "";
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`Действия: ${noun}`}>
      <IconAction icon={<ArrowRightLeft className="w-4 h-4" />} label={`Сменить статус${count}`} disabled={!valid.length} onClick={() => setStatus(true)} />
      <IconAction icon={<Pencil className="w-4 h-4" />} label={`Изменить ${valid.length > 1 ? noun : "задачу"}${count}`} disabled={!valid.length} onClick={() => setEdit(true)} />
      {children}
      {status && <BulkStatusModal open issues={valid} storiesOf={storiesOf} onDone={keys => onDone?.(keys)} onClose={moved => { setStatus(false); onStatusClosed?.(moved); }} />}
      {edit && <IssueEditModal issues={valid} onClose={() => setEdit(false)} onDone={onDone} />}
    </div>
  );
}
