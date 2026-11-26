"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui";
import { ACTIVITY_PERIODS, DEFAULT_ACTIVITY_METRICS, getDashboardEmployee, type ActivityMetric, type ActivityPeriod, type DashboardWidget } from "@/lib/dashboardApi";

const SOURCES = [
  { name: "Jira", metrics: [
    ["jiraDefectsCreated", "Созданные дефекты"],
    ["jiraDefectsActive", "Дефекты в работе"],
    ["jiraDefectsProcessed", "Обработанные дефекты"],
  ] },
  { name: "Bitbucket", metrics: [
    ["bbCommitCount", "Количество коммитов"],
    ["bbCommitList", "Список коммитов"],
  ] },
  { name: "Zephyr", metrics: [
    ["zephyrRunCount", "Количество назначенных прогонов"],
    ["zephyrRunList", "Список назначенных прогонов"],
  ] },
] as const;

export default function EmployeeSettings({ widget, set, inputClass }: {
  widget: DashboardWidget;
  set: <K extends keyof DashboardWidget>(key: K, value: DashboardWidget[K]) => void;
  inputClass: string;
}) {
  const login = widget.employeeLogin?.trim() ?? "";
  const period = widget.activityPeriod ?? "week";
  const selected = widget.activityMetrics ?? DEFAULT_ACTIVITY_METRICS;
  const [lookup, setLookup] = useState<{ login: string; name?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!login) return;
    let live = true;
    const timer = setTimeout(() => {
      getDashboardEmployee(login).then(
        result => { if (live) setLookup({ login, name: result.name }); },
        () => { if (live) setLookup({ login, failed: true }); },
      );
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [login]);

  function select(metrics: readonly ActivityMetric[], checked: boolean) {
    set("activityMetrics", checked ? [...new Set([...selected, ...metrics])] : selected.filter(key => !metrics.includes(key)));
  }

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Логин Jira
        <input aria-label="Логин Jira" required maxLength={160} value={widget.employeeLogin ?? ""} onChange={e => {
          set("employeeLogin", e.target.value);
          set("employeeName", "");
        }} className={inputClass} />
        {login && <span role="status" className="mt-1 block text-xs text-text-muted">
          {lookup?.login !== login ? "Ищу сотрудника в Jira…" : lookup.name || (lookup.failed ? "Имя в Jira недоступно. В карточке будет указан логин." : "Jira вернула только логин.")}
        </span>}
      </label>
      <label className="text-sm">Проект Jira и Zephyr
        <input required pattern="[A-Z][A-Z0-9_]{0,39}" value={widget.activityProject ?? "SBER911"}
          onChange={e => set("activityProject", e.target.value.toUpperCase())} className={inputClass} />
      </label>
      <div className="sm:col-span-2">
        <p className="text-sm mb-1">Период активности</p>
        <Select aria-label="Период активности" value={period} onChange={value => set("activityPeriod", value as ActivityPeriod)}>
          {Object.entries(ACTIVITY_PERIODS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
      </div>
      {period === "custom" && <>
        <label className="text-sm">С даты
          <input required type="date" className={inputClass} value={widget.activityFrom ?? ""}
            onChange={e => set("activityFrom", e.target.value)} />
        </label>
        <label className="text-sm">По дату
          <input aria-label="По дату" type="date" min={widget.activityFrom} className={inputClass} value={widget.activityTo ?? ""}
            onChange={e => set("activityTo", e.target.value)} />
          <span className="mt-1 block text-xs text-text-muted">Оставьте пустым, чтобы показать один день</span>
        </label>
      </>}
    </div>
    <div className="space-y-2">
      <p className="text-sm font-medium">Что показывать</p>
      {SOURCES.map(({ name, metrics }) => <fieldset key={name} className="rounded-lg border border-border-main px-3 pb-3">
        <legend className="px-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-primary" checked={metrics.some(([key]) => selected.includes(key))}
              onChange={e => select(metrics.map(([key]) => key), e.target.checked)} />{name}
          </label>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 pt-1">{metrics.map(([key, label]) =>
          <label key={key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="accent-primary" checked={selected.includes(key)}
              onChange={e => select([key], e.target.checked)} />{label}
          </label>)}</div>
        {name === "Jira" && selected.includes("jiraDefectsActive") &&
          <p className="mt-2 text-xs text-text-muted">Дефекты в работе учитывают исполнителя и тестировщика.</p>}
        {name === "Bitbucket" && selected.some(key => key.startsWith("bb")) &&
          <label className="text-sm block mt-3">Ветка Bitbucket
            <input maxLength={160} value={widget.activityBranch ?? ""} placeholder="Ветка по умолчанию"
              onChange={e => set("activityBranch", e.target.value)} className={inputClass} />
          </label>}
      </fieldset>)}
    </div>
  </div>;
}
