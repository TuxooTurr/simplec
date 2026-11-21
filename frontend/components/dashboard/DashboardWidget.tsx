"use client";
import { useEffect, useState, useCallback, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, BarChart3, Donut, List, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import IssueTable, { NO_FILTER, filterIssueRows, type IssueFilter } from "@/components/jiratool/IssueTable";
import { JIRA_ISSUES_CHANGED } from "@/components/jiratool/IssueEditButton";
import { getWidgetData, refreshWidget, type DashboardWidget as Widget, type WidgetData, type WidgetPresentation } from "@/lib/dashboardApi";
import { seriesColor } from "@/lib/dashboardGrid";
import IssueQueueModal from "./IssueQueueModal";
import DashboardColumns from "./DashboardColumns";
import { useDashboardColumns } from "@/lib/dashboardColumns";
const formats = [
  { id: "list" as const, label: "Список", Icon: List },
  { id: "donut" as const, label: "Кольцо", Icon: Donut },
  { id: "bar" as const, label: "Гистограмма", Icon: BarChart3 },
];
export default function DashboardWidget({ widget, canEdit, arranging, onEdit, onDelete, dragHandle, onColumnsChange }: {
  widget: Widget; canEdit: boolean; arranging: boolean; onEdit: () => void; onDelete: () => void; dragHandle?: ReactNode; onColumnsChange: (columns: string[]) => Promise<void>;
}) {
  const [kind, setKind] = useState<WidgetPresentation>(widget.presentation ?? "list");
  const [data, setData] = useState<WidgetData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<IssueFilter>(NO_FILTER);
  const [modal, setModal] = useState<{ keys?: Set<string> } | null>(null);
  const table = useDashboardColumns(widget, data?.items);
  const st = table.st;
  const changeColumns = async (columns: string[]) => { await onColumnsChange(columns); setFilter(NO_FILTER); };
  useEffect(() => setFilter(NO_FILTER), [widget.columns]);
  const load = useCallback(async () => {
    try { setData(await getWidgetData(widget.id)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [widget.id]);
  const refresh = useCallback(async () => {
    try { await refreshWidget(widget.id); await load(); }
    catch (e) { setError((e as Error).message); }
  }, [widget.id, load]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(load, 5000);
    window.addEventListener(JIRA_ISSUES_CHANGED, refresh);
    return () => { clearInterval(timer); window.removeEventListener(JIRA_ISSUES_CHANGED, refresh); };
  }, [load, refresh, widget.kind, widget.jql, widget.period, widget.fromDate, widget.toDate, widget.columns, widget.groupField, widget.valueField]);
  useEffect(() => setKind(widget.presentation ?? "list"), [widget.presentation]);
  if (widget.kind === "counter") {
    const count = data?.lastCheckedAt ? data.pending : null;
    const problem = error || data?.error;
    const status = problem ? `Последние данные сохранены. ${problem}` : data?.lastCheckedAt ? `Проверено ${new Date(data.lastCheckedAt).toLocaleString("ru-RU")}` : "Получаю задачи из Jira";
    return <article className={`dashboard-counter min-w-0 min-h-0 border bg-bg-card overflow-hidden flex flex-col ${problem ? "border-amber-500" : "border-border-main"}`} aria-label={widget.title} title={status}>
      <header className="px-4 pt-3 flex items-center gap-1.5 shrink-0">
        {dragHandle}
        <h2 className={`min-w-0 flex-1 text-sm font-semibold truncate ${problem ? "text-amber-600 dark:text-amber-400" : "text-text-main"}`} title={`${widget.title} · ${status}`}>{widget.title}</h2>
        {canEdit && arranging && <>
          <Button variant="icon" title="Обновить виджет" disabled={data?.running} onClick={() => void refresh()} icon={<RefreshCw className="w-3.5 h-3.5" />} />
          <Button variant="icon" title="Настроить виджет" onClick={onEdit} icon={<Settings2 className="w-3.5 h-3.5" />} />
          <Button variant="icon" title="Удалить виджет" onClick={onDelete} icon={<Trash2 className="w-3.5 h-3.5" />} />
        </>}
      </header>
      <button type="button" disabled={!data} onClick={() => setModal({})} aria-label={`${widget.title}: ${count ?? "ожидание"}. Открыть очередь. ${status}`}
        className="w-full flex-1 min-h-0 p-3 flex items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary hover:bg-primary/[0.02] disabled:cursor-wait">
        <strong className={`dashboard-counter-number ${count === 0 ? "tone-success-text" : "text-primary"}`} style={{ "--counter-digits": String(count ?? "—").length } as CSSProperties}>{count ?? "—"}</strong>
      </button>
      {modal && data && <IssueQueueModal canEdit={canEdit} onColumnsChange={changeColumns} widget={widget} data={{ ...data, error: problem }} onClose={() => setModal(null)} onChanged={() => { void load(); void refresh(); }} />}
    </article>;
  }
  const rows = table.rows;
  const tableFilter = { ...filter, searchCols: table.columns };
  const filteredRows = filterIssueRows(rows, tableFilter);
  const groups = new Map<string, { value: number; keys: Set<string> }>();
  let metricConflict = false;
  for (const issue of filteredRows) {
    const raw = st.values(widget.groupField, issue);
    const labels = raw.length ? [...new Set(raw)] : ["Не указано"];
    for (const label of labels) {
      const group = groups.get(label) ?? { value: 0, keys: new Set<string>() };
      group.keys.add(issue.key);
      const values = widget.valueField ? st.values(widget.valueField, issue) : [];
      if (values.length > 1) metricConflict = true;
      const value = widget.valueField ? values.length > 1 ? 0 : Number(String(values[0] ?? "0").replace(",", ".")) : 1;
      group.value += Number.isFinite(value) ? Math.max(0, value) : 0;
      groups.set(label, group);
    }
  }
  let entries = [...groups.entries()].sort((a, b) => b[1].value - a[1].value);
  const total = entries.reduce((n, [, g]) => n + g.value, 0);
  if (entries.length > 12) {
    const tail = entries.slice(11);
    let label = "Остальные группы";
    while (groups.has(label)) label += " ·";
    entries = [...entries.slice(0, 11), [label, { value: tail.reduce((n, [, g]) => n + g.value, 0), keys: new Set(tail.flatMap(([, g]) => [...g.keys])) }]];
  }
  const color = (label: string, index: number) => ({ "--widget-series": seriesColor(widget, label, index) } as CSSProperties);
  let offset = 0;
  return <article className="min-w-0 min-h-0 border border-border-main bg-bg-card overflow-hidden flex flex-col" aria-label={widget.title}>
    <header className="px-3 py-2.5 flex items-center gap-1.5 shrink-0">
      {dragHandle ?? <List className="w-4 h-4 text-primary shrink-0" />}
      <h2 className="min-w-0 flex-1 text-[13px] font-semibold truncate" title={widget.title}>{widget.title}</h2>
      <Button variant="icon" title="Обновить виджет" disabled={data?.running} onClick={() => void refresh()} icon={<RefreshCw className={`w-3.5 h-3.5 ${data?.running ? "animate-spin" : ""}`} />} />
      {canEdit && <Button variant="icon" title="Настроить виджет" onClick={onEdit} icon={<Settings2 className="w-3.5 h-3.5" />} />}
      {canEdit && arranging && <Button variant="icon" title="Удалить виджет" onClick={onDelete} icon={<Trash2 className="w-3.5 h-3.5" />} />}
    </header>
    <div className="px-3 pb-2 flex items-center justify-between gap-1 border-b border-border-main shrink-0">
      <div className="flex bg-bg-subtle p-0.5 rounded-lg gap-0.5" role="group" aria-label="Представление списка">
        {formats.map(({ id, label, Icon }) => <button type="button" key={id} title={label} aria-label={label} aria-pressed={kind === id}
          className={`p-1.5 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-primary ${kind === id ? "bg-bg-card text-primary shadow-sm" : "text-text-muted hover:text-text-main"}`}
          onClick={() => setKind(id)}><Icon className="w-3.5 h-3.5" /></button>)}
      </div>
      <div className="flex items-center gap-1">
      {kind === "list" && canEdit && <DashboardColumns columns={table.columns} options={table.options} onChange={changeColumns} />}
      <button type="button" title="Открыть задачи" aria-label="Открыть задачи" onClick={() => setModal({})}
        className="text-xs text-text-muted inline-flex items-center gap-1 whitespace-nowrap p-1 rounded hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-primary">
        {rows.length}<ArrowUpRight className="w-3.5 h-3.5" />
      </button></div>
    </div>
    <div className="flex-1 min-h-0 overflow-auto min-w-0 p-3">
      {(widget.groupField.startsWith("st:") || widget.valueField.startsWith("st:") || table.columns.some(c => c.startsWith("st:"))) && (!st.available || !st.lists.length) && <p className="text-xs tone-warning mb-2">Источник ST не найден в этом браузере. Откройте нужный список Jira tool или выберите другой источник.</p>}
      {(error || data?.error) && <p role="alert" className="text-xs tone-danger mb-2">{error || data?.error}</p>}
      {data?.filterChangedAt && (!data.lastCheckedAt || data.filterChangedAt > data.lastCheckedAt) && <p role="status" className="text-xs text-text-muted mb-2">Фильтр изменён. Ожидаю обновления; предыдущие данные сохранены.</p>}
      {data?.partial && <p role="status" className="text-xs tone-warning mb-2">Выдача ограничена. Сузьте JQL.</p>}
      {(filter.q || Object.keys(filter.cols).length > 0) && <Button variant="sm" onClick={() => setFilter(NO_FILTER)} className="mb-2">Сбросить фильтр</Button>}
      {!data?.lastCheckedAt && !error && !data?.error ? <p role="status" className="text-xs text-text-muted py-5">Получаю задачи из Jira…</p> : metricConflict && kind !== "list" ? <p className="text-xs tone-warning">Числовые значения ST различаются между списками. Выберите конкретный список в настройках виджета.</p> : kind === "list" ? <IssueTable cols={table.columns} columnLabels={table.labels} columnKinds={table.kinds} initialSort={{ col: "key", dir: 1 }}
        groups={[{ title: null, issues: filteredRows }]} source={rows} filter={tableFilter} onFilter={setFilter} widthKey={`dashboard-${widget.id}`} />
        : !filteredRows.length ? <p className="py-8 text-center text-xs text-text-muted">Нет задач для отображения</p>
        : <div className={`h-full min-h-0 flex ${kind === "donut" ? "flex-nowrap" : "flex-col"} items-center gap-3`}>
          {kind === "donut" && <svg viewBox="0 0 100 100" className="h-full max-h-40 max-w-[44%] w-auto shrink-0 mx-auto" role="img" aria-label={`${widget.title}: распределение задач`}>
            <circle cx="50" cy="50" r="36" fill="none" stroke="var(--color-bg-subtle)" strokeWidth="13" />
            {entries.map(([label, group], index) => {
              const percent = total ? group.value / total * 100 : 0;
              const start = offset; offset += percent;
              return <circle key={label} cx="50" cy="50" r="36" pathLength="100" fill="none" stroke="var(--widget-series)" style={color(label, index)}
                strokeWidth="13" strokeDasharray={`${Math.max(0, percent - 0.8)} ${100 - Math.max(0, percent - 0.8)}`} strokeDashoffset={-start} transform="rotate(-90 50 50)"
                role="button" tabIndex={0} aria-label={`${label}: ${group.value}. Открыть задачи`} className="cursor-pointer hover:opacity-75 focus-visible:opacity-60"
                onClick={() => setModal({ keys: group.keys })} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModal({ keys: group.keys }); } }}><title>{label}: {group.value}</title></circle>;
            })}
            <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fill="var(--color-text-main)" style={{ fontSize: 17, fontWeight: 600 }}>{Number(total.toFixed(1))}</text>
            <text x="50" y="62" textAnchor="middle" fill="var(--color-text-muted)" style={{ fontSize: 6 }}>{widget.valueField ? "сумма" : "задач"}</text>
          </svg>}
          <div className="w-full flex-1 min-w-0 max-h-full overflow-auto space-y-2">
            {entries.map(([label, group], index) => <button key={label} type="button" onClick={() => setModal({ keys: group.keys })}
              style={color(label, index)} className="block w-full text-left rounded-lg p-1.5 hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-primary text-xs">
              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: "var(--widget-series)" }} />
                <span className="truncate flex-1" title={label}>{label}</span><b className="tabular-nums">{Number(group.value.toFixed(1))}</b></span>
              {kind === "bar" && <span className="block h-2 rounded-full bg-bg-subtle mt-2 overflow-hidden"><span className="block h-2 rounded-full" style={{ background: "var(--widget-series)", width: `${Math.max(0, group.value / Math.max(1, entries[0]?.[1].value ?? 1) * 100)}%` }} /></span>}
            </button>)}
          </div>
        </div>}
    </div>
    <footer className="px-3 py-2 text-[10px] text-text-muted flex gap-1.5 items-center shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${data?.error || error ? "bg-amber-500" : "bg-primary/60"}`} />
      <span className="truncate">{data?.running ? "Обновление…" : data?.lastCheckedAt ? `Проверено ${new Date(data.lastCheckedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "Ожидание данных"}</span>
    </footer>
    {modal && data && <IssueQueueModal canEdit={canEdit} onColumnsChange={changeColumns} widget={widget} data={data} subset={modal.keys} onClose={() => setModal(null)} onChanged={() => { void load(); void refresh(); }} />}
  </article>;
}
