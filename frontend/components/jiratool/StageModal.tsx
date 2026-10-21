"use client";

import Modal from "@/components/ui/Modal";
import { categoryOf, type Issue } from "@/lib/jiraTool";
import { STAGES, stageText, type StageInfo } from "@/lib/jiraStages";
import { StageBadge } from "./ListCells";
import IssueTable from "./IssueTable";

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
 * Только просмотр: статус (st) меняется стрелкой в строке списка.
 */
export default function StageModal({ open, issue, stories, stageOf, ownStageOf, onClose }: {
  open: boolean;
  issue: Issue;
  /** Стори эпика (через Epic Link). */
  stories: Issue[];
  stageOf: (i: Issue) => StageInfo;
  /** Собственный статус (st) стори — без блокировки, унаследованной от эпика (иначе при заблокированном эпике заблокированы все). */
  ownStageOf: (i: Issue) => StageInfo;
  onClose: () => void;
}) {
  const info = stageOf(issue);
  const isEpic = categoryOf(issue) === "epic";

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
            <h3 className="text-sm font-semibold text-text-main">Стори эпика · {stories.length}</h3>
            {stories.length === 0 ? (
              <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">
                У эпика нет сторей (Epic Link) — статус (st) не посчитать. Заведите стори и привяжите их к эпику.
              </p>
            ) : (
              <IssueTable cols={["type", "key", "summary", "status", "stage", "assignee"]} initialSort={{ col: "stage", dir: 1 }}
                stage={s => <StageBadge info={ownStageOf(s)} />} stageRank={s => stageRank(ownStageOf(s))}
                groups={[{ title: null, issues: stories }]} />
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
