"use client";

import { useState } from "react";
import { Check, MessageSquareShare } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { blockersOf, categoryOf, defectsChatReport, isOpenDefect, type Issue } from "@/lib/jiraTool";
import { STAGES, type StageInfo } from "@/lib/jiraStages";
import { copyToClipboard } from "@/lib/clipboard";
import { StageBadge } from "./ListCells";
import IssueTable from "./IssueTable";

/** Порядок по статусу (st): раньше по процессу — выше. */
function stageRank(info: StageInfo): number {
  const base = info.kind === "blocked" ? info.base : info;
  return base.kind === "stage" || base.kind === "epic" ? STAGES.indexOf(base.stage) : -1;
}

/**
 * Дефекты задачи: привязанные через Epic Link или связь, плюс унаследованные блокирующие.
 * По умолчанию — только неустранённые (всё, кроме «Подтверждено исправление» и «Закрыт»;
 * блокирующий — пока не «Закрыт»). Галочка «Показать устранённые» добавляет
 * их отдельной группой ниже; сортировка по колонке работает внутри каждой группы.
 * «Статус (st)» — у каждого дефекта свой, по его статусу Jira (блокировка задачи на дефекты не переносится).
 * «Скопировать в чат» — показанные дефекты: номер, название, приоритет, статус (st).
 */
export default function DefectsModal({ open, issue, defects, stageOf, onClose }: {
  open: boolean;
  issue: Issue;
  defects: Issue[];
  stageOf: (i: Issue) => StageInfo;
  onClose: () => void;
}) {
  const [showFixed, setShowFixed] = useState(false);
  const [note, setNote] = useState("");
  const opened = defects.filter(isOpenDefect);
  const fixed = defects.filter(d => !isOpenDefect(d));
  const blockers = blockersOf(defects).length;
  const shown = showFixed ? [...opened, ...fixed] : opened;

  const copy = async () => {
    const ok = await copyToClipboard(defectsChatReport(issue, shown, stageOf));
    setNote(ok ? `Скопировано для чата: дефектов ${shown.length}` : "Браузер не дал скопировать — попробуйте ещё раз");
    setTimeout(() => setNote(""), 3000);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Дефекты ${issue.key}`} size="max-w-5xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          {String(issue.fields.summary ?? "")} · неустранённых {opened.length}, устранённых {fixed.length}
          {blockers > 0 && <b className="text-red-600 dark:text-red-400"> · блокирующих {blockers}</b>}.
          {categoryOf(issue) === "epic" ? " Считаются дефекты с Epic Link на эпик и связанные с ним, а также блокирующие дефекты его сторей."
            : categoryOf(issue) === "story" ? " Считаются связанные дефекты и блокирующие дефекты эпика." : " Считаются связанные дефекты."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
            <input type="checkbox" checked={showFixed} onChange={e => setShowFixed(e.target.checked)} />
            Показать устранённые <span className="text-text-muted">(«Подтверждено исправление», «Закрыт»; блокирующие — только «Закрыт») — отдельной группой</span>
          </label>
          <span className="ml-auto flex items-center gap-2">
            {note && <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="w-3.5 h-3.5" />{note}</span>}
            <button type="button" onClick={copy} disabled={!shown.length}
              title="Номер, название, приоритет и статус (st) показанных дефектов — для чата"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
              <MessageSquareShare className="w-4 h-4" /> Скопировать в чат</button>
          </span>
        </div>
        {defects.length === 0 || (!showFixed && opened.length === 0) ? (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
            {defects.length ? "Неустранённых дефектов нет." : "Дефектов нет."}
          </p>
        ) : (
          <IssueTable cols={["type", "key", "summary", "status", "stage", "priority", "assignee"]} initialSort={{ col: "priority", dir: 1 }}
            stage={d => <StageBadge info={stageOf(d)} />} stageRank={d => stageRank(stageOf(d))}
            dim={d => !isOpenDefect(d)}
            groups={showFixed
              ? [{ title: `Неустранённые · ${opened.length}`, issues: opened }, { title: `Устранённые · ${fixed.length}`, issues: fixed }]
              : [{ title: null, issues: opened }]} />
        )}
      </div>
    </Modal>
  );
}
