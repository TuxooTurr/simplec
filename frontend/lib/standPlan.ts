import type { ToolState } from "./jiraTool";
import { keKey, type StandBooking, type StandView } from "./standsApi";

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

interface Candidate { task: string; team: string; service: string; from: string }

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Одинаковые задача, папка и микросервис в нескольких списках дают одну плановую полосу. */
export function standCandidates(stand: StandName, state: ToolState, transfers: Record<string, StandTransfers>): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const list of state.lists) {
    if (list.archivedAt) continue;
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
    const issue = issues[task];
    const to = issue?.planEnd;
    if (!to || !isDate(to) || to < from || from > v.range.to || to < v.range.from) continue;
    teams.add(team);
    planned.push({ id: `plan:${JSON.stringify([task, team, keKey(service)])}`, task, team, service,
      features: issue.summary, date: from, dateTo: to, by: "", createdAt: "", source: "jira-plan", conflict: false });
  }
  if (!planned.length) return v;

  const index = new Map(v.days.map((day, i) => [day.date, i]));
  const days = v.days.map(day => ({ ...day, bookings: [...day.bookings] }));
  for (const b of planned) {
    const start = b.date < v.range.from ? 0 : index.get(b.date);
    const end = b.dateTo > v.range.to ? days.length - 1 : index.get(b.dateTo);
    if (start === undefined || end === undefined) continue;
    for (let i = start; i <= end; i++) days[i].bookings.push(b);
  }
  return { ...v, teams: [...teams], days };
}
