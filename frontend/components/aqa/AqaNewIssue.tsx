"use client";

import { useState } from "react";
import IssueFormModal from "@/components/jiratool/IssueFormModal";
import JiraUserField from "@/components/jiratool/JiraUserField";
import { updateAqaIssue, type AqaIssueChange } from "@/lib/aqaApi";
import type { FormControl } from "@/lib/backgroundForms";

const INPUT = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const LBL = "block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5";

/**
 * Новая задача эпика — та же форма, что в Jira tool (генерация, вложения, компоненты, лейблы), плюс то, что важно
 * роадмапу: исполнитель и плановые даты. Создаётся в проекте эпика; даты и исполнитель пишутся в задачу сразу после
 * создания: при создании их не передать (поля плановых дат у каждого сервера свои, а createmeta корп. Jira закрыт).
 * Что не записалось — предупреждением в окне «Создано в Jira».
 */
export default function AqaNewIssue({ epic, control, onCreated, defect, epicChoices }: {
  /** Подставленный эпик; пусто — выбрать из epicChoices. */
  epic: string; control: FormControl;
  /** Создана задача: номер в Jira (пусто — форма закрыта без создания). */
  onCreated: (key?: string) => void;
  /** Дефект из упавшего автотеста: заполненные название и описание. */
  defect?: { summary: string; description: string };
  /** Эпики на выбор: дефект из запуска вяжется только к эпикам роадмапа. */
  epicChoices?: { key: string; summary: string }[];
}) {
  const [person, setPerson] = useState({ jiraName: "", jiraDisplay: "" });
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const badDates = !!planStart && !!planEnd && planStart > planEnd;

  const afterCreate = async (key: string) => {
    const change: AqaIssueChange = {};
    if (person.jiraName) change.assignee = person.jiraName;
    if (planStart) change.planStart = planStart;
    if (planEnd) change.planEnd = planEnd;
    if (!Object.keys(change).length) return [];
    return (await updateAqaIssue(key, change)).warnings;
  };

  return (
    <IssueFormModal control={control} jiraOnly project={(epic || epicChoices?.[0]?.key || "").replace(/-\d+$/, "")} participants={[]}
      prefill={defect ? { type: "Дефект", epicKey: epic, ...defect } : { type: "Задача", epicKey: epic }}
      epicChoices={epicChoices}
      epicNote={defect ? <>Дефект привяжется к выбранному эпику AQA и появится на роадмапе.</> : <>Эпик подставлен: <b>{epic}</b> — задача появится на роадмапе.</>}
      afterCreate={afterCreate} createBlocked={badDates} onSave={d => onCreated(d.jira?.key)}
      extraFields={<>
        <div>
          <label htmlFor="aqa-new-start" className={LBL}>Плановое начало</label>
          <input id="aqa-new-start" type="date" value={planStart} onChange={e => setPlanStart(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="aqa-new-end" className={LBL}>Плановое окончание</label>
          <input id="aqa-new-end" type="date" value={planEnd} onChange={e => setPlanEnd(e.target.value)} className={INPUT} />
        </div>
        {badDates && <p className="col-span-2 text-xs text-red-600 dark:text-red-400">Плановое начало позже планового окончания.</p>}
        <div className="col-span-2">
          <span className={LBL}>Исполнитель</span>
          <JiraUserField label="" jiraOk name={person.jiraName} display={person.jiraDisplay} onChange={setPerson} />
        </div>
      </>} />
  );
}
