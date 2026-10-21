"use client";

import { useEffect, useMemo, useState } from "react";
import { loadState, type Issue } from "@/lib/jiraTool";
import { defectIndex } from "@/lib/jiraModel";
import { applyStageStyles, makeStageResolver, stageDot, stageText } from "@/lib/jiraStages";
import { issueCache } from "@/lib/jiraToolCache";
import { issuesByKeys } from "@/lib/jiraToolApi";
import type { StandView } from "@/lib/standsApi";
import type { FeatureStage } from "./StandTimeline";

/**
 * Статус (st) фич графика — так же, как в Jira tool: задачи из кэша Jira tool, недостающие — из Jira одним запросом,
 * сопоставление статусов, свои названия статусов и ручные статусы — из настроек Jira tool.
 * Задачи нет ни в кэше, ни в Jira (или Jira не подключена) — статуса нет, на графике пусто.
 */
export function useFeatureStage(v: StandView | null): FeatureStage {
  const keys = useMemo(() => {
    const all = new Set<string>();
    v?.days.forEach(d => d.bookings.forEach(b => { if (b.task) all.add(b.task.trim().toUpperCase()); }));
    return [...all].sort();
  }, [v]);
  const [fetched, setFetched] = useState<Record<string, Issue>>({});

  const keysSig = keys.join(",");
  useEffect(() => {
    if (!keys.length) return;
    let cached: Record<string, Issue> = {};
    try { cached = issueCache().issues; } catch { /* кэша нет */ }
    const need = keys.filter(k => !cached[k] && !fetched[k]);
    if (!need.length) return;
    let alive = true;
    issuesByKeys(need)
      .then(r => { if (alive) setFetched(f => ({ ...f, ...Object.fromEntries(r.issues.map(i => [i.key, i])) })); })
      .catch(() => { /* Jira недоступна — фичи без статуса */ });
    return () => { alive = false; };
  }, [keysSig]);   // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<FeatureStage>(() => {
    let cached: Record<string, Issue> = {};
    try { cached = issueCache().issues; } catch { /* кэша нет */ }
    const all = [...Object.values(cached), ...Object.values(fetched)];
    const byKey = new Map(all.map(i => [i.key, i]));
    let st: ReturnType<typeof loadState> | null = null;
    try { st = loadState(); } catch { /* настроек Jira tool нет */ }
    applyStageStyles(st?.stageStyles ?? {}, st?.customStages ?? []);
    const stageOf = makeStageResolver(all, st?.mapping ?? {}, defectIndex(all), st?.stageManual ?? {});
    return key => {
      const issue = byKey.get(key.trim().toUpperCase());
      if (!issue) return null;
      const info = stageOf(issue);
      return { dot: stageDot(info), text: stageText(info) };
    };
  }, [fetched]);
}
