"use client";

import { useEffect } from "react";
import { JIRA_PLAN_CHANGED } from "@/lib/aqaApi";
import { JIRA_TOOL_STORAGE_KEY, loadState } from "@/lib/jiraTool";
import { loadStandTransfers, standCandidates, STAND_TRANSFERS_KEY, TRANSFER_FIELD, type StandName } from "@/lib/standPlan";
import { saveStandPlan, type StandPlanSnapshot } from "@/lib/standsApi";

let tail: Promise<void> = Promise.resolve();
let saved = "";
export const STAND_PLAN_SYNC_ERROR = "shark-stand-plan-sync-error";

/** Serialize snapshots so that a slow earlier request cannot overwrite a newer edit. */
export function syncStandPlanSource(): Promise<void> {
  const state = loadState();
  const transfers = loadStandTransfers();
  const key = "st_stands_plan_source";
  let source = localStorage.getItem(key);
  if (!source) { source = crypto.randomUUID(); localStorage.setItem(key, source); }
  const snapshot: StandPlanSnapshot = { source, lists: state.lists.map(list => ({
    id: list.id,
    items: (Object.keys(TRANSFER_FIELD) as StandName[]).flatMap(stand =>
      standCandidates(stand, { ...state, lists: [list] }, transfers).map(item => ({ ...item, stand }))),
  })) };
  const signature = JSON.stringify(snapshot);
  const next = tail.catch(() => {}).then(async () => {
    if (saved === signature) return;
    await saveStandPlan(snapshot);
    saved = signature;
    window.dispatchEvent(new CustomEvent(STAND_PLAN_SYNC_ERROR, { detail: "" }));
  });
  tail = next;
  return next;
}

/** Mounted once after login, including while Jira tool is open instead of the stand graph. */
export default function StandPlanSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void syncStandPlanSource().catch(e => window.dispatchEvent(new CustomEvent(STAND_PLAN_SYNC_ERROR,
          { detail: `План стендов не сохранён на сервере: ${(e as Error).message}` })));
      }, 400);
    };
    const storage = (e: StorageEvent) => {
      if (!e.key || e.key === JIRA_TOOL_STORAGE_KEY || e.key === STAND_TRANSFERS_KEY) schedule();
    };
    schedule();
    const retry = setInterval(schedule, 60_000);
    window.addEventListener(JIRA_TOOL_STORAGE_KEY, schedule);
    window.addEventListener(STAND_TRANSFERS_KEY, schedule);
    window.addEventListener(JIRA_PLAN_CHANGED, schedule);
    window.addEventListener("storage", storage);
    return () => {
      clearTimeout(timer); clearInterval(retry);
      window.removeEventListener(JIRA_TOOL_STORAGE_KEY, schedule);
      window.removeEventListener(STAND_TRANSFERS_KEY, schedule);
      window.removeEventListener(JIRA_PLAN_CHANGED, schedule);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return null;
}
