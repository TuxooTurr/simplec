"use client";
import { StageCell } from "@/components/jiratool/ListCells";
import type { useDashboardFields } from "@/lib/dashboardFields";
import type { Issue } from "@/lib/jiraTool";

/** «Статус (st)» в списках Главной — та же стрелка выбора, что в Jira tool, и то же хранилище ручных статусов. */
export function stageRenderer(st: ReturnType<typeof useDashboardFields>) {
  return (col: string, issue: Issue) => col === "st:stage"
    ? <StageCell info={st.stageOf(issue)} manual={st.manual[issue.key]} onManual={stage => st.setManual(issue, stage)} />
    : undefined;
}
