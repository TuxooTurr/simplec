"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { PickerPanel } from "@/components/jiratool/FieldPicker";
import { dashboardColumns, useDashboardColumns } from "@/lib/dashboardColumns";
import { getWidgetData, getWidgetDelivery, saveWidgetDelivery, type DashboardWidget, type WidgetDelivery, type WidgetDeliveryState } from "@/lib/dashboardApi";
import { applyStageStyles, stageForStatus, stageStyle } from "@/lib/jiraStages";
import { loadState } from "@/lib/jiraTool";
import { projectKeyOfIssue } from "@/lib/jiraModel";
import { etherSearch, type EtherParticipant } from "@/lib/etherApi";

const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const fullDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const input = "w-full rounded-lg border border-border-main bg-bg-card px-3 py-2 text-sm focus-visible:outline-primary";
const statuses = { sending: "Выполняется", sent: "Отправлено", partial: "Отправлено частично", error: "Ошибка отправки",
  skipped: "Пропущено", unknown: "Доставка не подтверждена" };
const format = (at: string, zone: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: zone }).format(new Date(at));

async function captureColors(widget: DashboardWidget, draft: WidgetDelivery) {
  const colors = { ...draft.statusColors };
  if (!draft.enabled || !draft.columns.includes("status")) return colors;
  const data = await getWidgetData(widget.id).catch(() => null);
  if (!data) return colors;
  const state = loadState();
  applyStageStyles(state.stageStyles ?? {}, state.customStages ?? []);
  for (const issue of data.items) {
    const status = issue.fields.status;
    if (typeof status !== "string" || !status) continue;
    const stage = stageForStatus(issue, status, state.mapping);
    if (stage.kind !== "stage") continue;
    const value = stageStyle(stage.stage).backgroundColor;
    const key = projectKeyOfIssue(issue.key) + "|" + String(issue.fields.issuetype ?? "") + "|" + status;
    if (key.length <= 420 && typeof value === "string") colors[key] = value;
  }
  return Object.fromEntries(Object.entries(colors).slice(-200));
}

export default function WidgetDeliveryModal({ widget, onClose }: { widget: DashboardWidget; onClose: () => void }) {
  const [state, setState] = useState<WidgetDeliveryState | null>(null);
  const [draft, setDraft] = useState<WidgetDelivery>(() => ({
    enabled: false, recipients: [], weekdays: [], time: "09:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow",
    columns: dashboardColumns(widget).filter(c => !c.startsWith("st:")).slice(0, 12),
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ items: EtherParticipant[]; note: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const { options } = useDashboardColumns(widget);

  useEffect(() => {
    let active = true;
    getWidgetDelivery(widget.id).then(result => {
      if (!active) return;
      setState(result);
      if (result.config) setDraft(result.config);
    }, e => { if (active) setError(e.message); });
    const timer = setInterval(() => {
      void getWidgetDelivery(widget.id).then(result => { if (active) setState(result); }, () => {});
    }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [widget.id]);

  useEffect(() => {
    setSearch(null);
    setSearching(false);
    const term = query.trim();
    if (term.length < 2) return;
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await etherSearch(term);
        if (active) setSearch({ items: found.items.filter(p => p.peer != null && p.peer !== ""),
          note: found.reason || "В Эфире никого не найдено." });
      } catch (e) {
        if (active) setSearch({ items: [], note: (e as Error).message });
      } finally {
        if (active) setSearching(false);
      }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  const save = async (body: WidgetDelivery) => {
    setSaving(true); setError("");
    try {
      const result = await saveWidgetDelivery(widget.id, { ...body, statusColors: await captureColors(widget, body) });
      setState(result); if (result.config) setDraft(result.config);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const valid = !draft.enabled || !!(draft.recipients.length && draft.weekdays.length && draft.columns.length);
  const form = "widget-delivery-" + widget.id;
  return <Modal open onClose={onClose} title={"Отправка в Эфир · " + widget.title} size="max-w-2xl"
    footer={state && <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>Закрыть</Button>
      {state.locked ? <Button loading={saving} onClick={() => void save({ ...draft, enabled: false })}>Остановить расписание</Button>
        : <Button loading={saving} disabled={!valid} type="submit" form={form}>Сохранить расписание</Button>}
    </div>}>
    {error && <p role="alert" className="text-sm tone-danger mb-3">{error}</p>}
    {!state && !error && <p role="status" className="flex gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю расписание…</p>}
    {state?.locked && <p className="text-sm text-text-muted">Расписание настроил другой редактор. Его можно остановить перед настройкой нового.</p>}
    {state && !state.locked && <form id={form} className="space-y-4" onSubmit={e => { e.preventDefault(); if (valid) void save(draft); }}>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />
        Отправлять по расписанию
      </label>
      <div className="space-y-2">
        <label htmlFor={form + "-peer"} className="text-sm font-medium">Получатели</label>
        {!!draft.recipients.length && <ul className="flex flex-wrap gap-2">
          {draft.recipients.map((p, i) => <li className="flex gap-1 items-center rounded-md bg-bg-subtle px-2 py-1 text-xs" key={JSON.stringify(p.peer)}>
            {p.name}<button type="button" aria-label={"Убрать " + p.name} onClick={() =>
              setDraft(d => ({ ...d, recipients: d.recipients.filter((_, j) => i !== j) }))}><X className="w-3.5 h-3.5" /></button>
          </li>)}
        </ul>}
        <input id={form + "-peer"} className={input} placeholder="Фамилия, логин или название чата" value={query}
          maxLength={100} disabled={draft.recipients.length >= 10}
          onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} onChange={e => setQuery(e.target.value)} />
        {searching && <p role="status" className="text-xs text-text-muted">Ищу в Эфире…</p>}
        {search && (search.items.length ? <ul aria-label="Найденные получатели" className="max-h-40 overflow-y-auto divide-y rounded-lg border border-border-main divide-border-main">
          {search.items.map(item => <li key={item.kind + JSON.stringify(item.peer)}>
            <button type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-subtle" onClick={() => {
              if (item.peer == null) return;
              const peer = item.peer;
              setDraft(d => d.recipients.some(p => JSON.stringify(p.peer) === JSON.stringify(peer))
                ? d : { ...d, recipients: [...d.recipients, { name: item.name, peer }] });
              setQuery(""); setSearch(null);
            }}>
              {item.name}<span className="block text-xs text-text-muted">{[item.kind === "group" ? "Группа" : item.kind === "chat" ? "Чат" : "Коллега", item.login || item.subtitle].filter(Boolean).join(" · ")}</span>
            </button>
          </li>)}
        </ul> : <p role="status" className="text-xs text-text-muted">{search.note}</p>)}
      </div>
      <fieldset>
        <legend className="text-sm font-medium mb-2">Дни отправки</legend>
        <div className="flex flex-wrap gap-1.5">
          {days.map((day, i) => <button type="button" key={day} aria-label={fullDays[i]} aria-pressed={draft.weekdays.includes(i)}
            className={"rounded-md border px-2.5 py-1.5 text-sm focus-visible:outline-primary " + (draft.weekdays.includes(i) ? "border-primary bg-primary/10 text-primary" : "border-border-main hover:bg-bg-subtle")}
            onClick={() => setDraft(d => ({ ...d, weekdays: d.weekdays.includes(i) ? d.weekdays.filter(x => x !== i) : [...d.weekdays, i] }))}>{day}</button>)}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Время<input required type="time" className={input} value={draft.time}
          onChange={e => setDraft(d => ({ ...d, time: e.target.value }))} /></label>
        <label className="space-y-1 text-sm">Часовой пояс
          <input required className={input} list={form + "-zones"} maxLength={80} value={draft.timezone}
            onChange={e => setDraft(d => ({ ...d, timezone: e.target.value }))} />
          <datalist id={form + "-zones"}>
            {[...new Set(["Europe/Moscow", "Asia/Shanghai", "Asia/Yekaterinburg", "UTC", Intl.DateTimeFormat().resolvedOptions().timeZone])].map(zone => <option key={zone} value={zone} />)}
          </datalist>
        </label>
      </div>
      <details className="rounded-lg border border-border-main p-3">
        <summary className="cursor-pointer text-sm font-medium">Колонки Jira · {draft.columns.length}</summary>
        <div className="mt-2">
          <PickerPanel label="Колонки сообщения" options={options.filter(o => !o.value.startsWith("st:"))}
            selected={draft.columns} ordered max={12} onChange={columns => setDraft(d => ({ ...d, columns }))} />
        </div>
      </details>
      <p className="text-xs text-text-muted">Отчёт содержит задачи из JQL виджета, цветные маркеры статусов и ссылку на полную выдачу Jira.
        {widget.kind === "counter" && " Для счётчика используется текущая выдача JQL."}
        {widget.kind === "employee" && " Для сотрудника используются назначенные ему задачи выбранного проекта."}</p>
      {state.sourceChanged && <p role="status" className="text-sm tone-danger">Источник виджета изменился. Сохраните расписание, чтобы возобновить отправку.</p>}
      {state.nextAt && state.config && <p role="status" className="text-sm">Следующая отправка {format(state.nextAt, state.config.timezone)} · {state.config.timezone}</p>}
      {state.last && state.config && <p className="text-sm text-text-muted">
        {format(state.last.at, state.config.timezone)} · {statuses[state.last.status]} · {state.last.sent}/{state.last.total}
        {state.last.error && " · " + state.last.error}
      </p>}
    </form>}
  </Modal>;
}
