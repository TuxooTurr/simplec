"use client";

import { useEffect, useMemo, useState } from "react";
import { JIRA_PLAN_CHANGED } from "@/lib/aqaApi";
import { JIRA_TOOL_STORAGE_KEY, loadState } from "@/lib/jiraTool";
import { getStandPlanIssues } from "@/lib/jiraToolApi";
import { loadStandTransfers, standCandidates, STAND_TRANSFERS_KEY, withStandPlan, type StandIssue, type StandName } from "@/lib/standPlan";
import type { StandView } from "@/lib/standsApi";

export function useStandPlan(stand: StandName, base: StandView | null, refresh: number) {
  const [browser, setBrowser] = useState(() => ({ state: loadState(), transfers: loadStandTransfers() }));
  const [issues, setIssues] = useState<Record<string, StandIssue>>({});
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const reload = () => setBrowser({ state: loadState(), transfers: loadStandTransfers() });
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === JIRA_TOOL_STORAGE_KEY || e.key === STAND_TRANSFERS_KEY) reload();
    };
    const onPlanChange = () => setRevision(r => r + 1);
    reload();
    window.addEventListener(JIRA_TOOL_STORAGE_KEY, reload);
    window.addEventListener(STAND_TRANSFERS_KEY, reload);
    window.addEventListener(JIRA_PLAN_CHANGED, onPlanChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(JIRA_TOOL_STORAGE_KEY, reload);
      window.removeEventListener(STAND_TRANSFERS_KEY, reload);
      window.removeEventListener(JIRA_PLAN_CHANGED, onPlanChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const candidates = useMemo(() => standCandidates(stand, browser.state, browser.transfers), [stand, browser]);
  const keys = [...new Set(candidates.map(c => c.task))].sort().join(",");
  useEffect(() => {
    setError("");
    if (!keys) { setIssues({}); return; }
    let alive = true;
    getStandPlanIssues(keys.split(",")).then(
      r => { if (alive) setIssues(r); },
      e => { if (alive) setError((e as Error).message); },
    );
    return () => { alive = false; };
  }, [keys, refresh, revision]);

  const view = useMemo(() => base ? withStandPlan(base, candidates, issues) : null, [base, candidates, issues]);
  return { view, error };
}
