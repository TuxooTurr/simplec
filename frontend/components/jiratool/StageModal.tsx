"use client";

import { useState } from "react";
import { ArrowRightLeft, Check, MessageSquareShare } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { categoryOf, storiesChatReport, type Issue } from "@/lib/jiraTool";
import { STAGES, stageText, type StageInfo } from "@/lib/jiraStages";
import { copyToClipboard } from "@/lib/clipboard";
import { StageBadge } from "./ListCells";
import IssueTable, { NO_FILTER, filterIssueRows, sortIssueRows, type IssueFilter, type IssueSort } from "./IssueTable";
import BulkStatusModal from "./BulkStatusModal";

/** Порядок для сортировки по статусу (st): заблокированные и отстающие — первыми. */
function stageRank(info: StageInfo): number {
  const base = info.kind === "blocked" ? info.base : info;
  const i = base.kind === "stage" || base.kind === "epic" ? STAGES.indexOf(base.stage) : -1;
  return (info.kind === "blocked" ? -10 : 0) + i;
}

/**
 * Окно по клику на «Статус (st)» эпика: его стори — тип, номер со ссылкой в Jira, название,
 * статус Jira, собственный статус (st) стори (блокировка эпика на стори здесь не переносится), исполнитель.
 * Дефекты здесь не показываются — они только в «Дефекты (st)», включая блокирующие, из-за которых эпик «Заблокирован».
 * Статус (st) меняется стрелкой в строке списка; статус Jira отмеченных стори — «Сменить статус».
 * «Скопировать в чат» — отмеченные галочками стори (по умолчанию все) в порядке таблицы, как отчёт общего списка:
 * стори со статусом (st), под ней её активные дефекты.
 * «Сменить статус» — отмеченные стори переводятся в Jira тем же окном, что и в списке (переходы workflow).
 * Поиск и фильтры колонок сужают таблицу; в чат и в смену статуса уходят только видимые отмеченные стори.
 */
export default function StageModal({ open, issue, stories, stageOf, ownStageOf, defectsOf, onTransitions, onClose }: {
  open: boolean;
  issue: Issue;
  /** Стори эпика (через Epic Link). */
  stories: Issue[];
  stageOf: (i: Issue) => StageInfo;
  /** Собственный статус (st) стори — без блокировки, унаследованной от эпика (иначе при заблокированном эпике заблокированы все). */
  ownStageOf: (i: Issue) => StageInfo;
  /** Дефекты задачи (свои и унаследованные) — для отчёта в чат; null — у дефекта поля нет. */
  defectsOf: (i: Issue) => Issue[] | null;
  /** Переходы выполнены — перечитать эти задачи из Jira. */
  onTransitions?: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const info = stageOf(issue);
  const isEpic = categoryOf(issue) === "epic";
  const [picked, setPicked] = useState<Set<string>>(() => new Set(stories.map(s => s.key)));
  const [sort, setSort] = useState<IssueSort>({ col: "stage", dir: 1 });
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<IssueFilter>(NO_FILTER);
  const rank = (s: Issue) => stageRank(ownStageOf(s));
  const label = (s: Issue) => stageText(ownStageOf(s));
  const visible = filterIssueRows(stories, filter, label);
  const toSend = sortIssueRows(visible, sort, rank).filter(s => picked.has(s.key));
  const pick = (keys: string[], on: boolean) => setPicked(p => {
    const n = new Set(p); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n;
  });
  const copy = async () => {
    const ok = await copyToClipboard(storiesChatReport(issue, toSend, info, ownStageOf, defectsOf));
    setNote(ok ? `Скопировано для чата: сторей ${toSend.length}` : "Браузер не дал скопировать — попробуйте ещё раз");
    setTimeout(() => setNote(""), 3000);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Статус (st) · ${issue.key}`} size="max-w-5xl">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-text-main font-medium min-w-0">{String(issue.fields.summary ?? "")}</span>
          <StageBadge info={info} />
          {info.kind === "blocked" && (
            <span className="text-xs text-text-muted">
              без блокировки — «{stageText(info.base)}»; блокирующие дефекты ({info.by.length}) — в «Дефекты (st)»
            </span>
          )}
        </div>

        {isEpic && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-main">Стори эпика · {stories.length}</h3>
              {stories.length > 0 && (
                <span className="ml-auto flex items-center gap-2">
                  {note && <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"><Check className="w-3.5 h-3.5" />{note}</span>}
                  {onTransitions && (
                    <button type="button" onClick={() => setStatusOpen(true)} disabled={!toSend.length}
                      title="Перевести отмеченные стори в другой статус Jira — переходы спрашиваются у Jira"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
                      <ArrowRightLeft className="w-4 h-4" /> Сменить статус ({toSend.length})</button>
                  )}
                  <button type="button" onClick={copy} disabled={!toSend.length}
                    title="Стори со статусом (st) и их активные дефекты — как отчёт списка; галочками выберите, что отправить"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
                    <MessageSquareShare className="w-4 h-4" /> Скопировать в чат ({toSend.length} из {visible.length})</button>
                </span>
              )}
            </div>
            {stories.length === 0 ? (
              <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
                У эпика нет сторей (Epic Link) — статус (st) не посчитать. Заведите стори и привяжите их к эпику.
              </p>
            ) : (
              <IssueTable cols={["type", "key", "summary", "status", "stage", "assignee"]} initialSort={sort} onSort={setSort}
                picked={picked} onPick={pick} widthKey="stories"
                filter={filter} onFilter={setFilter} source={stories} stageLabel={label}
                stage={s => <StageBadge info={ownStageOf(s)} />} stageRank={rank}
                groups={[{ title: null, issues: visible }]} />
            )}
          </section>
        )}
      </div>
      {statusOpen && onTransitions && (
        <BulkStatusModal open issues={toSend} storiesOf={() => []} onDone={onTransitions} onClose={() => setStatusOpen(false)} />
      )}
    </Modal>
  );
}
