"use client";

import IssueFormModal from "@/components/jiratool/IssueFormModal";
import type { FormControl } from "@/lib/backgroundForms";

/**
 * Новая задача эпика — та же форма, что в Jira tool (генерация, вложения, компоненты, лейблы), плюс то, что важно
 * роадмапу: исполнитель и плановые даты — они теперь часть самой формы (IssueFormModal) и пишутся в задачу сразу после
 * создания. Что не записалось — предупреждением в окне «Создано в Jira».
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
  // Плановые даты и исполнитель — в самой форме (IssueFormModal), как в Jira tool; «Тестировщика (st)» здесь нет.
  return (
    <IssueFormModal control={control} jiraOnly project={(epic || epicChoices?.[0]?.key || "").replace(/-\d+$/, "")} participants={[]}
      prefill={defect ? { type: "Дефект", epicKey: epic, ...defect } : { type: "Задача", epicKey: epic }}
      epicChoices={epicChoices}
      epicNote={defect ? <>Дефект привяжется к выбранному эпику AQA и появится на роадмапе.</> : <>Эпик подставлен: <b>{epic}</b> — задача появится на роадмапе.</>}
      onSave={d => onCreated(d.jira?.key)} extraFields={<></>} />
  );
}
