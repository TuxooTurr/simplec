/**
 * Люди списка → поля Jira. Назначили человека в «Тестировщик» или в поле направления (Аналитика, Back-end…) —
 * его имя в Jira (логин из справочника людей) пишется в поле Jira, выбранное для направления в справочнике.
 * Пишется не сразу: изменение встаёт в очередь (ToolState.jiraPending) и уходит при обновлении из Jira —
 * ручном или фоновом раз в 30 минут. Поменяли человека несколько раз до обновления — уйдёт последний.
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
import type { PersonFieldChange, PersonFieldResult } from "./jiraToolApi";

const isDraftKey = (key: string) => key.includes("-ЧЕРНОВИК-");

function personOf(list: TaskList, key: string, dir: string, people: Participant[]): Participant | undefined {
  if (dir === TESTING) return people.find(p => p.id === list.assignees[key]);
  const r = list.roles?.[key]?.[dir];
  if (!r) return undefined;
  if (r.pid) return people.find(p => p.id === r.pid);
  const name = (r.name ?? "").trim().toLowerCase();
  return name ? people.find(p => p.name.trim().toLowerCase() === name) : undefined;
}

/** Что сделать с полями Jira после правки списка: записать (changes) или оставить как было в Jira (keep). */
export interface PeopleDiff {
  changes: PersonFieldChange[];
  /** Поставили человека без имени в Jira — поле Jira не трогаем, ждущая в очереди запись отменяется. */
  keep: { key: string; field: string }[];
}

export function peopleFieldChanges(before: TaskList, after: TaskList, people: Participant[],
                                   fields: JiraPeopleFields): PeopleDiff {
  const out: PeopleDiff = { changes: [], keep: [] };
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
      if (now && !user) { out.keep.push({ key, field }); continue; }   // нового человека Jira не знает
      if (!now && !prev) continue;          // сняли того, кого в Jira и не писали
      if (user === prev) continue;
      out.changes.push({ key, field, user, display: now?.jiraDisplay?.trim() ?? "", prev });
    }
  }
  return out;
}

/**
 * Добавить изменения в очередь. По задаче и полю — одна запись: человек — последний, «прежний» — тот, кто стоял
 * в Jira до первого изменения (для поля на несколько людей убираем именно его). Вернулись к нему — записи нет.
 */
export function queuePeopleChanges(queue: PersonFieldChange[], { changes, keep }: PeopleDiff): PersonFieldChange[] {
  let out = queue.filter(q => !keep.some(k => k.key === q.key && k.field === q.field));
  for (const c of changes) {
    const i = out.findIndex(q => q.key === c.key && q.field === c.field);
    const merged = i >= 0 ? { ...c, prev: out[i].prev } : c;
    out = out.filter((_, j) => j !== i);
    if (merged.user !== merged.prev) out.push(merged);
  }
  return out;
}

/**
 * Убрать из очереди отправленное: ушло, поля у задачи нет или Jira отказала (отказ показываем, повторять бессмысленно).
 * Пока шла отправка, человека поменяли снова — новая запись остаётся.
 */
export function dropSent(queue: PersonFieldChange[], sent: PersonFieldChange[], results: PersonFieldResult[]): PersonFieldChange[] {
  const res = (c: PersonFieldChange) => results.find(r => r.key === c.key.toUpperCase() && r.field === c.field);
  const done = sent.filter(c => res(c));
  return queue
    .filter(q => !done.some(d => d.key === q.key && d.field === q.field && d.user === q.user))
    // Ушедший в Jira человек теперь там и стоит — для новой записи он «прежний».
    .map(q => {
      const d = done.find(x => x.key === q.key && x.field === q.field && res(x)?.ok);
      return d ? { ...q, prev: d.user } : q;
    })
    .filter(q => q.user !== q.prev);
}
