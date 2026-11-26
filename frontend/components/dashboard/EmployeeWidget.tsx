"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw, Settings2, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui";
import { ACTIVITY_PERIODS, type DashboardWidget, type WidgetData } from "@/lib/dashboardApi";
import type { Issue } from "@/lib/jiraTool";
import { issuesByKeys, searchIssues } from "@/lib/jiraToolApi";
import IssueQueueModal from "./IssueQueueModal";

function dateLabel(day: string) {
  return day.slice(0, 10).split("-").reverse().join(".");
}

export default function EmployeeWidget({ widget, data, error, canEdit, arranging, onEdit, onDelete, onRefresh, onColumnsChange, dragHandle, extraAction }: {
  widget: DashboardWidget; data: WidgetData | null; error: string; canEdit: boolean; arranging: boolean;
  onEdit: () => void; onDelete: () => void; onRefresh: () => void; dragHandle?: ReactNode; extraAction?: ReactNode;
  onColumnsChange: (columns: string[]) => Promise<void>;
}) {
  const period = widget.activityPeriod ?? "week";
  const from = widget.activityFrom ?? "";
  const to = widget.activityTo;
  const dates = period === "custom" ? `${dateLabel(from)}${to && to !== from ? ` – ${dateLabel(to)}` : ""}` : ACTIVITY_PERIODS[period];
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [partial, setPartial] = useState(false);
  const [reload, setReload] = useState(0);
  const metric = data?.activity?.Jira?.metrics?.find(row => row.label === openMetric);
  const query = metric?.jql;
  const keys = metric?.issueKeys?.join(",");
  useEffect(() => {
    if (!openMetric || (!query && keys === undefined)) return;
    let live = true;
    setLoading(true); setListError(""); setPartial(false); setIssues([]);
    const request = query
      ? searchIssues(query, 1000).then(result => ({ issues: result.issues, partial: result.truncated }))
      : issuesByKeys(keys ? keys.split(",") : []).then(result => ({ issues: result.issues, partial: !!result.missing.length }));
    request.then(result => {
      if (!live) return;
      setIssues(result.issues); setPartial(result.partial);
    }, err => { if (live) setListError((err as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [openMetric, query, keys, reload]);
  return <><article className="h-full min-h-0 flex flex-col rounded-xl border border-border-main bg-bg-card overflow-hidden">
    <header className="flex items-center gap-2 px-3 py-2 border-b border-border-main">
      {dragHandle ?? <UserRound className="w-4 h-4 text-primary shrink-0" />}
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold truncate" title={widget.title}>{widget.title}</h2>
        <p className="text-xs text-text-muted truncate">{data?.employeeName || widget.employeeName || widget.employeeLogin} · {widget.activityProject}</p>
      </div>
      <Button variant="icon" title="Обновить активность" onClick={onRefresh} disabled={data?.running}
        icon={<RefreshCw className={`w-3.5 h-3.5 ${data?.running ? "animate-spin" : ""}`} />} />
      {extraAction}
      {canEdit && <Button variant="icon" title="Настроить виджет" onClick={onEdit} icon={<Settings2 className="w-3.5 h-3.5" />} />}
      {canEdit && arranging && <Button variant="icon" title="Удалить виджет" onClick={onDelete} icon={<Trash2 className="w-3.5 h-3.5" />} />}
    </header>
    <div className="overflow-y-auto p-3 space-y-3">
      <p className="text-xs text-text-muted" title={widget.activityTimezone}>{dates}</p>
      {error && <p role="alert" className="text-xs tone-danger">{error}</p>}
      {!data?.activity && !error && <p role="status" className="text-xs text-text-muted">Загружаю данные об активности…</p>}
      {Object.entries(data?.activity ?? {}).map(([name, source]) => <section key={name} className="space-y-1.5">
        <h3 className="text-xs font-semibold text-text-main">{name}</h3>
        {source.error && <p role="status" className="text-xs tone-danger">{source.error}{source.metrics?.length ? " · Последние полученные данные" : ""}</p>}
        <dl className="space-y-1">{source.metrics?.map(metric => <div key={metric.label} className="flex items-center justify-between gap-2 rounded-md bg-bg-subtle px-2 py-1.5">
          <dt className="text-xs text-text-muted">{metric.label}{metric.detail && <span className="block text-[10px]">{metric.detail}</span>}</dt>
          <dd className="text-sm font-semibold tabular-nums">{name === "Jira" && (metric.jql || metric.issueKeys) ?
            <button type="button" onClick={() => setOpenMetric(metric.label)} aria-label={`${metric.label}: ${metric.value}. Открыть дефекты`}
              className="flex items-center gap-1 rounded text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary">
              {metric.value}<ArrowUpRight className="w-3.5 h-3.5" />
            </button> : metric.url
            ? <a href={metric.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
              {metric.value ?? "—"}<ArrowUpRight className="w-3 h-3" /></a>
            : metric.value ?? "—"}</dd>
        </div>)}</dl>
        {source.runs && (source.runs.length ? <ul className="space-y-1 text-xs">{source.runs.map(run => <li key={run.key}>
          <a className="text-primary break-words hover:underline" href={run.url} target="_blank" rel="noopener noreferrer">{run.key} · {run.name}</a>
        </li>)}</ul> : <p className="text-xs text-text-muted">Список прогонов пуст</p>)}
        {source.commits && (source.commits.length ? <ul className="space-y-1 text-xs">{source.commits.map(commit => <li key={commit.hash}>
          <a className="text-primary break-words hover:underline" href={commit.url} target="_blank" rel="noopener noreferrer">{commit.id} · {commit.message}</a>
          <span className="block text-text-muted">{dateLabel(commit.date)}</span>
        </li>)}</ul> : <p className="text-xs text-text-muted">Список коммитов пуст</p>)}
        {source.listDetail && source.listDetail !== source.metrics?.[0]?.detail && <p className="text-xs text-text-muted">{source.listDetail}</p>}
      </section>)}
    </div>
  </article>
  {openMetric && metric && <IssueQueueModal widget={{ ...widget, title: `${openMetric} · ${data?.employeeName || widget.employeeName || widget.employeeLogin}` }}
    canEdit={canEdit} onColumnsChange={onColumnsChange} data={{ items: issues, pending: 0 }}
    loading={loading} loadError={listError}
    notice={[metric.detail, partial ? "Показана доступная часть списка дефектов" : ""].filter(Boolean).join(" · ")}
    onClose={() => setOpenMetric(null)} onChanged={() => { onRefresh(); setReload(value => value + 1); }} />}
  </>;
}
