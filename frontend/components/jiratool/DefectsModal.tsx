"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { blockersOf, categoryOf, isOpenDefect, type Issue } from "@/lib/jiraTool";
import IssueTable from "./IssueTable";

/**
 * Дефекты задачи: привязанные через Epic Link или связь, плюс унаследованные блокирующие.
 * По умолчанию — только неустранённые (всё, кроме «Подтверждено исправление» и «Закрыт»;
 * блокирующий — пока не «Закрыт»). Галочка «Показать устранённые» добавляет
 * их отдельной группой ниже; сортировка по колонке работает внутри каждой группы.
 */
export default function DefectsModal({ open, issue, defects, onClose }: {
  open: boolean;
  issue: Issue;
  defects: Issue[];
  onClose: () => void;
}) {
  const [showFixed, setShowFixed] = useState(false);
  const opened = defects.filter(isOpenDefect);
  const fixed = defects.filter(d => !isOpenDefect(d));
  const blockers = blockersOf(defects).length;

  return (
    <Modal open={open} onClose={onClose} title={`Дефекты ${issue.key}`} size="max-w-5xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          {String(issue.fields.summary ?? "")} · неустранённых {opened.length}, устранённых {fixed.length}
          {blockers > 0 && <b className="text-red-600 dark:text-red-400"> · блокирующих {blockers}</b>}.
          {categoryOf(issue) === "epic" ? " Считаются дефекты с Epic Link на эпик и связанные с ним, а также блокирующие дефекты его сторей."
            : categoryOf(issue) === "story" ? " Считаются связанные дефекты и блокирующие дефекты эпика." : " Считаются связанные дефекты."}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
          <input type="checkbox" checked={showFixed} onChange={e => setShowFixed(e.target.checked)} />
          Показать устранённые <span className="text-text-muted">(«Подтверждено исправление», «Закрыт»; блокирующие — только «Закрыт») — отдельной группой</span>
        </label>
        {defects.length === 0 || (!showFixed && opened.length === 0) ? (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
            {defects.length ? "Неустранённых дефектов нет." : "Дефектов нет."}
          </p>
        ) : (
          <IssueTable cols={["type", "key", "summary", "status", "priority", "assignee"]} initialSort={{ col: "priority", dir: 1 }}
            dim={d => !isOpenDefect(d)}
            groups={showFixed
              ? [{ title: `Неустранённые · ${opened.length}`, issues: opened }, { title: `Устранённые · ${fixed.length}`, issues: fixed }]
              : [{ title: null, issues: opened }]} />
        )}
      </div>
    </Modal>
  );
}
