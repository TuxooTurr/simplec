import type { ToolState } from "./jiraTool";
import { keKey, type StandBooking, type StandDay, type StandView } from "./standsApi";

export const STAND_TRANSFERS_KEY = "st_jira_stand_transfers";

export interface StandTransfers { ift: string; psi: string }
export const EMPTY_TRANSFERS: StandTransfers = { ift: "", psi: "" };
export const TRANSFER_FIELD = { "Major-Check": "ift", "Major-GO": "psi" } as const;
export type StandName = keyof typeof TRANSFER_FIELD;
export type StandIssue = { summary: string; planEnd: string };

export function loadStandTransfers(): Record<string, StandTransfers> {
  try {
    const value = JSON.parse(localStorage.getItem(STAND_TRANSFERS_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function saveStandTransfers(key: string, dates: StandTransfers): void {
  const all = loadStandTransfers();
  if (dates.ift || dates.psi) all[key] = dates;
  else delete all[key];
  localStorage.setItem(STAND_TRANSFERS_KEY, JSON.stringify(all));
  window.dispatchEvent(new Event(STAND_TRANSFERS_KEY));
}

export interface Candidate { task: string; team: string; service: string; from: string }

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Одинаковые задача, папка и микросервис в нескольких списках дают одну плановую полосу. */
export function standCandidates(stand: StandName, state: ToolState, transfers: Record<string, StandTransfers>): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const list of state.lists) {
    for (const task of list.keys) {
      const from = transfers[task]?.[TRANSFER_FIELD[stand]];
      if (!from || !isDate(from) || task.includes("ЧЕРНОВИК")) continue;
      const team = list.folders?.[task]?.trim() || "Без папки";
      for (const service of state.msLinks[task] ?? []) {
        const norm = keKey(service);
        if (!norm) continue;
        const key = JSON.stringify([task, team, norm]);
        if (!out.has(key)) out.set(key, { task, team, service: service.trim(), from });
      }
    }
  }
  return [...out.values()];
}

/** План использует тот же календарь и ось команд, что и опубликованные брони. */
export function withStandPlan(v: StandView, candidates: Candidate[], issues: Record<string, StandIssue>): StandView {
  const planned: Array<StandBooking & { dateTo: string }> = [];
  const teams = new Set(v.teams);
  for (const { task, team, service, from } of candidates) {
    teams.add(team);
    const issue = issues[task];
    const to = issue?.planEnd;
    if (!to || !isDate(to) || to < from || from > v.range.to || to < v.range.from) continue;
    planned.push({ id: `plan:${JSON.stringify([task, team, keKey(service)])}`, task, team, service,
      features: issue.summary, date: from, dateTo: to, by: "", createdAt: "", source: "jira-plan", conflict: false });
  }
  if (!planned.length) return teams.size === v.teams.length ? v : { ...v, teams: [...teams] };

  const index = new Map(v.days.map((day, i) => [day.date, i]));
  const ids = new Set(planned.map(item => item.id));
  const days: StandDay[] = v.days.map(day => ({ ...day, bookings: day.bookings.filter(item => !ids.has(item.id)) }));
  for (const b of planned) {
    const start = b.date < v.range.from ? 0 : index.get(b.date);
    const end = b.dateTo > v.range.to ? days.length - 1 : index.get(b.dateTo);
    if (start === undefined || end === undefined) continue;
    for (let i = start; i <= end; i++) {
      if (!days[i].bookings.some(existing => existing.id === b.id)) days[i].bookings.push(b);
    }
  }
  // Local edits must show the same conflicts as the server snapshot, before hourly publication.
  for (const day of days) {
    const groups = new Map<string, StandBooking[]>();
    for (const booking of day.bookings) {
      const key = keKey(booking.service);
      groups.set(key, [...(groups.get(key) ?? []), booking]);
    }
    const conflicts = new Set<string>();
    const minute = (value: string | undefined, fallback: number) => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : fallback;
    const span = (booking: StandBooking) => {
      const start = booking.date === day.date ? minute(booking.timeFrom, 0) : 0;
      const end = (booking.dateTo || booking.date) === day.date ? minute(booking.timeTo, 1440) : 1440;
      return start < end ? [start, end] : [0, 1440];
    };
    for (const bookings of groups.values()) for (let i = 0; i < bookings.length; i++) {
      for (let j = i + 1; j < bookings.length; j++) {
        const first = bookings[i], second = bookings[j];
        const [a, b] = span(first), [c, d] = span(second);
        if (first.team !== second.team && a < d && c < b) { conflicts.add(first.id); conflicts.add(second.id); }
      }
    }
    day.bookings = day.bookings.map(booking => ({ ...booking, conflict: conflicts.has(booking.id) }));
    day.conflicts = [...groups.entries()].flatMap(([service, bookings]) => {
      const teams = [...new Set(bookings.filter(booking => conflicts.has(booking.id)).map(booking => booking.team))].sort();
      return teams.length ? [{ service, teams }] : [];
    });
    if (day.date >= v.today.date && !day.weekend && !day.freeze) {
      const count = new Set(day.bookings.map(booking => JSON.stringify([booking.team, keKey(booking.service)]))).size;
      day.status = conflicts.size ? "КОНФЛИКТ" : v.limit > 0 && count >= v.limit ? "ЛИМИТ" : "МОЖНО";
      day.colour = day.status === "МОЖНО" ? "Green" : "Red";
    }
  }
  const today = days.find(day => day.date === v.today.date);
  return { ...v, teams: [...teams], days, today: today ? { ...v.today, status: today.status, colour: today.colour,
    count: new Set(today.bookings.map(booking => JSON.stringify([booking.team, keKey(booking.service)]))).size } : v.today };
}
