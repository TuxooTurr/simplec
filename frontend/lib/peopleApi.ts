/**
 * Справочник людей Jira tool — клиент к /api/people (бэкенд: backend/api/people.py, файл data/people.json).
 * Справочник живёт на бэкенде, а не в браузере: не пропадает при очистке браузера и одинаков во всех вкладках.
 */

import { fetchJson } from "./jiraApi";
import type { Participant } from "./jiraTool";

export const getPeople = () => fetchJson<{ people: Participant[]; updatedAt: string }>("/api/people");

export const savePeople = (people: Participant[]) =>
  fetchJson<{ people: Participant[]; updatedAt: string }>("/api/people", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    // Направления не заданы — старая запись участника: это тестировщик (как в inDirection).
    body: JSON.stringify({ people: people.map(p => ({ ...p, directions: p.directions ?? ["testing"] })) }),
  });
