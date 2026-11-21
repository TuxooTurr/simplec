"use client";
import { useEffect, useMemo, useState } from "react";
import { FIELD_BY_ID, setCatalog, type Issue, type JiraFieldDef } from "./jiraModel";
import { getCatalog } from "./jiraToolApi";
import type { DashboardWidget } from "./dashboardApi";
import { useDashboardFields } from "./dashboardFields";
export const DEFAULT_DASHBOARD_COLUMNS = ["key", "summary", "status", "assignee"];
export function dashboardColumns(widget: DashboardWidget) {
  return [...new Set(["key", ...(widget.columns ?? (widget.kind === "counter" ? ["type", "summary", "status", "priority", "assignee"] : DEFAULT_DASHBOARD_COLUMNS))])];
}
const NO_ISSUES: Issue[] = [];
export function useDashboardColumns(widget: DashboardWidget, issues: Issue[] = NO_ISSUES) {
  const st = useDashboardFields(issues, widget.stListId);
  const [jira, setJira] = useState<JiraFieldDef[]>(() => Object.values(FIELD_BY_ID));
  useEffect(() => { let live = true; getCatalog().then(catalog => { if (live) { setCatalog(catalog); setJira(catalog.fields); } }, () => {}); return () => { live = false; }; }, []);
  return useMemo(() => {
    const columns = dashboardColumns(widget);
    const options = [
      { value: "key", label: "Номер", group: "Поля Jira" },
      ...jira.map(f => ({ value: f.id === "issuetype" ? "type" : f.id, label: f.name, group: f.custom ? "Пользовательские поля Jira" : "Поля Jira" })),
      ...st.fields.map(f => ({ value: f.id, label: f.name, group: "Поля Shark", hint: "st" })),
    ];
    for (const column of columns) if (!options.some(o => o.value === column)) options.push({ value: column, label: column, group: "Сохранённые поля" });
    const labels = Object.fromEntries(options.map(o => [o.value, o.label]));
    const kinds = Object.fromEntries([...jira, ...st.fields].map(field => [field.id, field.kind ?? "text"]));
    const rows = issues.map(issue => ({ ...issue, fields: { ...issue.fields,
      ...Object.fromEntries(columns.filter(c => c.startsWith("st:")).map(c => [c, st.values(c, issue)])),
    } }));
    return { columns, options, labels, kinds, rows, jira, st, available: st.available && st.lists.length > 0 };
  }, [widget.columns, widget.kind, jira, issues, st.values, st.available, st.lists]);
}
