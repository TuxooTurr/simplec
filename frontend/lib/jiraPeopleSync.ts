/**
 * Люди списка → поля Jira. Назначили человека в «Тестировщик» или в поле направления (Аналитика, Back-end…) —
 * его имя в Jira (логин из справочника людей) пишется в поле Jira, выбранное для направления в справочнике.
 *
 * Что не уходит в Jira (человек остаётся только в SimpleTest, без ошибки):
 *  - для направления не выбрано поле Jira;
 *  - у человека нет имени в Jira (тогда Jira не трогаем вовсе — не стираем того, кто там стоит);
 *  - черновик (задачи в Jira ещё нет);
 *  - у задачи нет такого поля (дефект без «Аналитика») — это решает бэкенд по editmeta задачи.
 * Сняли человека — поле в Jira очищается, если прежний человек был записан туда по имени в Jira.
 */

import { TESTING, DIRECTIONS, type Participant, type TaskList } from "./jiraTool";
import type { JiraPeopleFields } from "./peopleApi";
import type { PersonFieldChange } from "./jiraToolApi";

const isDraftKey = (key: string) => key.includes("-ЧЕРНОВИК-");

function personOf(list: TaskList, key: string, dir: string, people: Participant[]): Participant | undefined {
  if (dir === TESTING) return people.find(p => p.id === list.assignees[key]);
  const r = list.roles?.[key]?.[dir];
  if (!r) return undefined;
  if (r.pid) return people.find(p => p.id === r.pid);
  const name = (r.name ?? "").trim().toLowerCase();
  return name ? people.find(p => p.name.trim().toLowerCase() === name) : undefined;
}

export function peopleFieldChanges(before: TaskList, after: TaskList, people: Participant[],
                                   fields: JiraPeopleFields): PersonFieldChange[] {
  const out: PersonFieldChange[] = [];
  for (const key of after.keys) {
    if (isDraftKey(key)) continue;
    for (const { id: dir } of DIRECTIONS) {
      const field = fields[dir];
      if (!field) continue;
      const was = personOf(before, key, dir, people);
      const now = personOf(after, key, dir, people);
      if (was?.id === now?.id) continue;
      const user = now?.jiraName?.trim() ?? "";
      const prev = was?.jiraName?.trim() ?? "";
      if (now && !user) continue;           // нового человека Jira не знает — не трогаем поле
      if (!now && !prev) continue;          // сняли того, кого в Jira и не писали
      if (user === prev) continue;
      out.push({ key, field, user, display: now?.jiraDisplay?.trim() ?? "", prev });
    }
  }
  return out;
}
