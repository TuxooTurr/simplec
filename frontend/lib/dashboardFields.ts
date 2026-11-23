"use client";
import { useEffect, useMemo, useState } from "react";
import { loadState, saveState, ST_COLS, ROLE_FIELDS, ROLE_STATE_LABEL, colLabel, colValues, makeDefectsOf, defectIndex, JIRA_TOOL_STORAGE_KEY, type TaskList, type Issue, type ToolState } from "./jiraTool";
import { applyStageStyles, blockingDefects, jiraStageOf, makeStageResolver, stageKeyOf, stageText, storiesByEpic, type Stage } from "./jiraStages";
import { issueCache } from "./jiraToolCache";
import { listRequirements } from "./api";
import { loadStandTransfers, STAND_TRANSFERS_KEY } from "./standPlan";

export interface DashboardField { id: string; name: string; kind?: string }
const EMPTY: TaskList = { id: "", name: "", project: "", createdAt: "", keys: [], columns: [], groupBy: [], ownFields: [], values: {}, assignees: {} };
const NO_ISSUES: Issue[] = [];
export function useDashboardFields(issues: Issue[] = NO_ISSUES, listId = "") {
  const [state, setState] = useState<ToolState | null>(null);
  const [revision, setRevision] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => { setState(loadState()); setRevision(n => n + 1); };
    const storage = (e: StorageEvent) => { if (!e.key || [JIRA_TOOL_STORAGE_KEY, STAND_TRANSFERS_KEY].includes(e.key)) read(); };
    read(); window.addEventListener(JIRA_TOOL_STORAGE_KEY, read); window.addEventListener(STAND_TRANSFERS_KEY, read); window.addEventListener("storage", storage);
    listRequirements().then(rows => setNames(Object.fromEntries(rows.map(row => [row.id, row.name]))), () => {});
    return () => { window.removeEventListener(JIRA_TOOL_STORAGE_KEY, read); window.removeEventListener(STAND_TRANSFERS_KEY, read); window.removeEventListener("storage", storage); };
  }, []);
  return useMemo(() => {
    const lists = state?.lists ?? [];
    const available = !listId || lists.some(l => l.id === listId);
    const selected = listId ? lists.filter(l => l.id === listId) : lists;
    const cached = issueCache();
    const compatible = !issues[0]?.url || !cached.baseUrl || issues[0].url.startsWith(cached.baseUrl + "/");
    const all = [...new Map([...(compatible ? Object.values(cached.issues) : []), ...(state?.created ?? []), ...issues].map(i => [i.key, i])).values()];
    applyStageStyles(state?.stageStyles ?? {}, state?.customStages ?? []);
    const defects = defectIndex(all), stories = storiesByEpic(all), own = makeDefectsOf(defects);
    const stageOf = makeStageResolver(all, state?.mapping ?? {}, defects, state?.stageManual ?? {}, state?.stageLog ?? {});
    const defectsOf = (issue: Issue) => {
      const current = own(issue); if (current === null) return null;
      return [...new Map([...current, ...blockingDefects(issue, defects, stories)].map(d => [d.key, d])).values()];
    };
    const transfers = loadStandTransfers();
    const fields: DashboardField[] = ST_COLS.map(ref => ({ id: "st:" + ref, name: colLabel(ref, EMPTY), kind: ref === "defects" ? "number" : "text" }));
    fields.push({ id: "st:testing-hours", name: "Тестировщик: часы (st)", kind: "number" },
      { id: "st:ift", name: "Передача на ИФТ (st)", kind: "date" }, { id: "st:psi", name: "Передача на ПСИ (st)", kind: "date" });
    for (const role of ROLE_FIELDS) fields.push({ id: "st:hours:" + role.id, name: role.label + ": часы (st)", kind: "number" },
      { id: "st:state:" + role.id, name: role.label + ": состояние (st)", kind: "text" });
    // Свои поля отдельных списков («… (st) · имя списка») в выбор колонок Главной не попадают — только общие поля ST.
    // Уже выбранные раньше колонки продолжают показываться (значения ниже), но новых не добавить.
    function values(id: string, issue: Issue): string[] {
      if (!id.startsWith("st:")) {
        const value = issue.fields[id]; return value == null ? [] : Array.isArray(value) ? value : [String(value)];
      }
      const ref = id.slice(3);
      // «Статус (st)» считается по задачам и сопоставлению статусов — списки Jira tool ему не нужны.
      if (ref === "stage") return [stageText(stageOf(issue))];
      if (!state || !available) return [];
      if (ref === "ms") return state.msLinks[issue.key] ?? [];
      if (ref === "reqs") return (state.reqLinks[issue.key] ?? []).map(key => names[key] ?? "Требование не загружено");
      if (ref === "ift" || ref === "psi") return transfers[issue.key]?.[ref] ? [transfers[issue.key][ref]] : [];
      const global = ["defects", "block"].includes(ref);
      const contexts = global ? [EMPTY] : selected.filter(list => list.keys.includes(issue.key));
      const result = contexts.flatMap(list => {
        if (ref === "testing-hours") { const value = list.spend?.[issue.key]?.plan; return value == null ? [] : [String(value / 60)]; }
        if (ref.startsWith("hours:")) { const value = list.roles?.[issue.key]?.[ref.slice(6)]?.plan; return value == null ? [] : [String(value / 60)]; }
        if (ref.startsWith("state:")) { const value = list.roles?.[issue.key]?.[ref.slice(6)]?.state; return value ? [ROLE_STATE_LABEL[value]] : []; }
        let column = ref;
        if (ref.startsWith("own:")) {
          const prefix = "own:" + list.id + ":"; if (!ref.startsWith(prefix)) return []; column = "own:" + ref.slice(prefix.length);
        }
        return colValues(column, issue, { list, participants: state.participants, stageOf, defectsOf,
          reqsOf: key => (state.reqLinks[key] ?? []).map(id => names[id] ?? "Требование не загружено"), msOf: key => state.msLinks[key] ?? [] });
      });
      return [...new Set(result)];
    }
    /**
     * Статус (st) руками — как стрелкой в списке Jira tool: то же хранилище (stageManual) и отметка в журнале
     * (stageLog) с этапом по Jira в этот момент; null — вернуть расчёт по Jira.
     */
    function setManual(issue: Issue, stage: Stage | null) {
      const s = loadState();
      const base = stageKeyOf(jiraStageOf(stageOf(issue)));
      const manual = { ...s.stageManual };
      if (stage) manual[issue.key] = stage; else delete manual[issue.key];
      const mark = { at: new Date().toISOString(), stage, base };
      saveState({ ...s, stageManual: manual, stageLog: { ...s.stageLog, [issue.key]: [...(s.stageLog[issue.key] ?? []), mark].slice(-200) } });
    }
    return { fields, lists, available, values, stageOf, manual: state?.stageManual ?? {}, setManual };
  }, [issues, listId, state, revision, names]);
}
