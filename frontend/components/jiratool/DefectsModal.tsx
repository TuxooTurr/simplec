"use client";

import { useState } from "react";
import { ArrowRightLeft, Bug, Check, MessageSquareShare } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { blockersOf, categoryOf, defectsChatReport, isOpenDefect, type Issue } from "@/lib/jiraTool";
import { STAGES, stageText, type StageInfo } from "@/lib/jiraStages";
import { copyToClipboard } from "@/lib/clipboard";
import { StageBadge } from "./ListCells";
import IssueTable, { NO_FILTER, filterIssueRows, sortIssueRows, type IssueFilter, type IssueSort } from "./IssueTable";
import BulkStatusModal from "./BulkStatusModal";
import ChatFieldsPicker, { type ChatFieldsCfg } from "./ChatFieldsPicker";

/** Порядок по статусу (st): раньше по процессу — выше. */
function stageRank(info: StageInfo): number {
  const base = info.kind === "blocked" ? info.base : info;
  return base.kind === "stage" || base.kind === "epic" ? STAGES.indexOf(base.stage) : -1;
}

/**
 * Дефекты задачи: привязанные через Epic Link или связь, плюс унаследованные блокирующие.
 * По умолчанию — только активные (всё, кроме «Подтверждение исправления», «Исключено», «Отложен» и «Закрыт»).
 * Галочка «Показать устранённые» добавляет
 * их отдельной группой ниже; сортировка по колонке работает внутри каждой группы.
 * «Статус (st)» — у каждого дефекта свой, по его статусу Jira (блокировка задачи на дефекты не переносится).
 * «Скопировать в чат» — отмеченные галочками показанные дефекты (по умолчанию все) в порядке таблицы:
 * статус (st), номер, название; под дефектом — поля, выбранные в «Поля в чат» (пустые не пишутся).
 * «Создать дефект» — форма дефекта: у эпика эпик подставлен, у стори дефект после создания связывается с ней.
 * «Сменить статус» — отмеченные дефекты переводятся в Jira тем же окном, что и в списке (переходы workflow).
 * Поиск и фильтры колонок сужают таблицу; в чат и в смену статуса уходят только видимые отмеченные дефекты.
 */
export default function DefectsModal({ open, issue, defects, stageOf, chat, onCreate, onTransitions, onClose }: {
  open: boolean;
  issue: Issue;
  defects: Issue[];
  stageOf: (i: Issue) => StageInfo;
  /** «Поля в чат» списка; нет — выбора нет, в чат только статус, номер и название. */
  chat?: ChatFieldsCfg;
  /** Создать дефект к этой задаче; нет — кнопки нет (задача — черновик, её нет в Jira). */
  onCreate?: () => void;
  /** Переходы выполнены — перечитать эти задачи из Jira. */
  onTransitions?: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [showFixed, setShowFixed] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<IssueFilter>(NO_FILTER);
  const label = (d: Issue) => stageText(stageOf(d));
  const allOpened = defects.filter(isOpenDefect);
  const allFixed = defects.filter(d => !isOpenDefect(d));
  const opened = filterIssueRows(allOpened, filter, label);
  const fixed = filterIssueRows(allFixed, filter, label);
  const blockers = blockersOf(defects).length;
  // Что отправить в чат: по умолчанию все; галочки — выбрать нужные.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defects.map(d => d.key)));
  const [sort, setSort] = useState<IssueSort>({ col: "priority", dir: 1 });
  const rank = (d: Issue) => stageRank(stageOf(d));
  const shown = [...sortIssueRows(opened, sort, rank), ...(showFixed ? sortIssueRows(fixed, sort, rank) : [])];
  const toSend = shown.filter(d => picked.has(d.key));
  const pick = (keys: string[], on: boolean) => setPicked(p => {
    const n = new Set(p); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n;
  });

  const copy = async () => {
    const ok = await copyToClipboard(defectsChatReport(issue, toSend, stageOf, chat?.lines));
    setNote(ok ? `Скопировано для чата: дефектов ${toSend.length}` : "Браузер не дал скопировать — попробуйте ещё раз");
    setTimeout(() => setNote(""), 3000);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Дефекты ${issue.key}`} size="max-w-5xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          {String(issue.fields.summary ?? "")} · неустранённых {allOpened.length}, устранённых {allFixed.length}
          {blockers > 0 && <b className="text-red-600 dark:text-red-400"> · блокирующих {blockers}</b>}.
          {categoryOf(issue) === "epic" ? " Считаются дефекты с Epic Link на эпик и связанные с ним, а также блокирующие дефекты его сторей."
            : categoryOf(issue) === "story" ? " Считаются связанные дефекты и блокирующие дефекты эпика." : " Считаются связанные дефекты."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
            <input type="checkbox" checked={showFixed} onChange={e => setShowFixed(e.target.checked)} />
            Показать устранённые <span className="text-text-muted">(«Подтверждение исправления», «Исключено», «Отложен», «Закрыт») — отдельной группой</span>
          </label>
          <span className="ml-auto flex items-center gap-2">
            {note && <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="w-3.5 h-3.5" />{note}</span>}
            {onCreate && (
              <button type="button" onClick={onCreate}
                title={categoryOf(issue) === "epic" ? "Новый дефект с эпиком " + issue.key : "Новый дефект, связанный с " + issue.key}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold">
                <Bug className="w-4 h-4" /> Создать дефект</button>
            )}
            {onTransitions && (
              <button type="button" onClick={() => setStatusOpen(true)} disabled={!toSend.length}
                title="Перевести отмеченные дефекты в другой статус Jira — переходы спрашиваются у Jira"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
                <ArrowRightLeft className="w-4 h-4" /> Сменить статус ({toSend.length})</button>
            )}
            {chat && <ChatFieldsPicker cfg={chat} align="right" />}
            <button type="button" onClick={copy} disabled={!toSend.length}
              title="Статус (st), номер и название отмеченных дефектов, под каждым — «Поля в чат»; галочками выберите, что отправить"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
              <MessageSquareShare className="w-4 h-4" /> Скопировать в чат{shown.length ? ` (${toSend.length} из ${shown.length})` : ""}</button>
          </span>
        </div>
        {defects.length === 0 || (!showFixed && allOpened.length === 0) ? (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
            {defects.length ? "Неустранённых дефектов нет." : "Дефектов нет."}
          </p>
        ) : (
          <IssueTable cols={["type", "key", "summary", "status", "stage", "priority", "assignee"]} initialSort={sort} onSort={setSort}
            picked={picked} onPick={pick} widthKey="defects"
            filter={filter} onFilter={setFilter} source={showFixed ? defects : allOpened} stageLabel={label}
            stage={d => <StageBadge info={stageOf(d)} />} stageRank={rank}
            dim={d => !isOpenDefect(d)}
            groups={showFixed
              ? [{ title: `Неустранённые · ${opened.length}`, issues: opened }, { title: `Устранённые · ${fixed.length}`, issues: fixed }]
              : [{ title: null, issues: opened }]} />
        )}
      </div>
      {statusOpen && onTransitions && (
        <BulkStatusModal open issues={toSend} storiesOf={() => []} onDone={onTransitions} onClose={() => setStatusOpen(false)} />
      )}
    </Modal>
  );
}
