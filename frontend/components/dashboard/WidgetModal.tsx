"use client";
import { useEffect, useId, useState } from "react";
import { BarChart3, Donut, Check, Gauge, LayoutList, List, UserRound } from "lucide-react";
import { Button, Modal, Select } from "@/components/ui";
import type { DashboardWidget, WidgetPresentation, WidgetSize } from "@/lib/dashboardApi";
import { getWidgetData } from "@/lib/dashboardApi";
import { GRID_COLUMNS, pixels, sizeLabel, WIDGET_SIZES, PALETTES } from "@/lib/dashboardGrid";
import { useDashboardColumns } from "@/lib/dashboardColumns";
import { PickerPanel } from "@/components/jiratool/FieldPicker";
import EmployeeSettings from "./EmployeeSettings";
const input = "w-full mt-1 rounded-lg border border-border-main bg-bg-card px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
export default function WidgetModal({ widget, canShare, onSave, onClose }: {
  widget?: DashboardWidget;
  /** Редактор Главной: может создавать и менять виджеты «Для всех». */
  canShare: boolean;
  onSave: (widget: DashboardWidget) => Promise<void>; onClose: () => void;
}) {
  const formId = useId();
  const [v, setV] = useState<DashboardWidget>(widget?.kind === "counter" ? { ...widget, size: "S", w: 4, h: 4 } : widget ?? {
    id: crypto.randomUUID(), title: "", jql: "project = SBER911", kind: "view", size: "M",
    presentation: "list", palette: "indigo", colors: {}, groupField: "status", valueField: "",
    period: "all", fromDate: "", toDate: "", fullWidth: false, gridVersion: 2, ...WIDGET_SIZES.M,
    scope: canShare ? "shared" : "personal",
  });
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const table = useDashboardColumns(v);
  const st = table.st;
  const fields = table.jira;
  const allFields = [...fields, ...st.fields];
  useEffect(() => {
    let live = true;
    if (widget && widget.kind !== "employee") getWidgetData(widget.id).then(data => {
      const groups = data.items.flatMap(i => {
        const values = st.values(v.groupField, i);
        return values.length ? values : ["Не указано"];
      });
      if (live) setGroupNames([...new Set(groups)].sort().slice(0, 30));
    }, () => {});
    return () => { live = false; };
  }, [widget?.id, v.groupField, st.values]);
  const set = <K extends keyof DashboardWidget>(key: K, value: DashboardWidget[K]) => setV(s => ({ ...s, [key]: value }));
  const currentSize = (Object.keys(WIDGET_SIZES) as WidgetSize[]).find(name =>
    WIDGET_SIZES[name].w === (v.w ?? WIDGET_SIZES[v.size].w) && WIDGET_SIZES[name].h === (v.h ?? WIDGET_SIZES[v.size].h));
  function size(value: WidgetSize) {
    const dimensions = WIDGET_SIZES[value];
    setV(s => ({ ...s, size: value, ...dimensions, fullWidth: value === "XXL", gridVersion: 2, x: value === "XXL" ? 0 : s.x === undefined ? undefined : Math.min(s.x, GRID_COLUMNS - dimensions.w) }));
  }
  const paletteHex = (index: number) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--dashboard-${v.palette}-${index % 6 + 1}`).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : getComputedStyle(document.documentElement).getPropertyValue("--dashboard-indigo-1").trim();
  };
  return <Modal open title={widget ? "Настроить виджет" : "Новый виджет"} onClose={onClose} size="max-w-2xl"
    footer={<div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={onClose}>Отмена</Button><Button form={formId} type="submit" loading={busy}>Сохранить</Button></div>}>
    <form id={formId} className="space-y-5" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      const employee = v.kind === "employee" ? {
        title: v.title.trim() || "Активность сотрудника",
        period: "all" as const,
        employeeLogin: v.employeeLogin?.trim(),
        activityTimezone: v.activityTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      } : {};
      try { await onSave({ ...v, ...employee, size: currentSize ?? v.size }); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="group" aria-label="Тип виджета">
        {[{ id: "view" as const, title: "Список", text: "Задачи и диаграммы", Icon: LayoutList }, { id: "counter" as const, title: "Счётчик", text: "Общая очередь команды", Icon: Gauge }, { id: "employee" as const, title: "Сотрудник", text: "Jira, Bitbucket и Zephyr", Icon: UserRound }].map(({ id, title, text, Icon }) =>
          <button type="button" key={id} aria-pressed={v.kind === id} onClick={() => id === "counter" ? setV(s => ({ ...s, kind: id, size: "S", w: 4, h: 4, fullWidth: false, x: s.x === undefined ? undefined : Math.min(GRID_COLUMNS - 4, s.x) })) : setV(s => s.kind === "counter"
              ? { ...s, kind: id, size: "M", ...WIDGET_SIZES.M, x: undefined, y: undefined }
              : { ...s, kind: id })}
            className={`text-left rounded-xl border p-3 focus-visible:ring-2 focus-visible:ring-primary transition-colors ${v.kind === id ? "border-primary bg-primary/5" : "border-border-main hover:bg-bg-subtle"}`}>
            <span className="flex items-center gap-2"><Icon className="w-4 h-4 text-primary" /><b className="text-sm">{title}</b>{v.kind === id && <Check className="ml-auto w-3.5 h-3.5 text-primary" />}</span>
            <span className="text-[11px] text-text-muted block mt-1.5">{text}</span>
          </button>)}
      </div>
      <div role="radiogroup" aria-label="Кому виден виджет" className="flex flex-wrap items-center gap-2">
        {([["shared", "Для всех", "Видят все пользователи Shark. Создаёт и меняет редактор Главной"], ["personal", "Личный", "Видите только вы"]] as const).map(([id, label, hint]) =>
          <button type="button" key={id} role="radio" aria-checked={(v.scope ?? "shared") === id} title={hint}
            disabled={id === "shared" && !canShare}
            onClick={() => set("scope", id)}
            className={`px-3 py-1.5 rounded-lg border text-sm focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed ${(v.scope ?? "shared") === id ? "border-primary bg-primary/5 text-primary" : "border-border-main hover:bg-bg-subtle"}`}>
            {label}</button>)}
        <span className="text-[11px] text-text-muted">{(v.scope ?? "shared") === "personal" ? "Виден только вам; в резервную копию попадает, восстанавливается только вам." : canShare ? "Виден всем пользователям." : "«Для всех» создаёт редактор Главной."}</span>
      </div>
      <label className="block text-sm">Название<input required={v.kind !== "employee"} maxLength={200} placeholder={v.kind === "employee" ? "Активность сотрудника" : "Например, ошибки на ИФТ"} value={v.title} onChange={e => set("title", e.target.value)} className={input} /></label>
      {v.kind === "employee" ? <EmployeeSettings widget={v} set={set} fields={fields} inputClass={input} />
        : <label className="block text-sm">Фильтр JQL<textarea aria-label="Фильтр JQL" required maxLength={4000} rows={3} value={v.jql} onChange={e => set("jql", e.target.value)} className={input + " font-mono text-xs"} /></label>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label id={formId + "-size"} className="text-sm block mb-1">Размер</label>
          {v.kind === "counter" ? <div className="rounded-lg border border-border-main bg-bg-subtle px-3 py-2 text-sm" aria-label="Размер счётчика">{sizeLabel("S")}</div> : <Select aria-label="Размер виджета" value={currentSize ?? "custom"} onChange={s => { if (s !== "custom") size(s as WidgetSize); }}>
            {!currentSize && <option value="custom">Ручной · {v.fullWidth ? "вся ширина" : pixels(v.w ?? 4)} × {pixels(v.h ?? 4)}</option>}
            {(Object.keys(WIDGET_SIZES) as WidgetSize[]).map(name => <option key={name} value={name}>{sizeLabel(name)}</option>)}
          </Select>}<p className="text-[11px] text-text-muted mt-1">{v.kind === "counter" ? "Счётчик всегда квадратный, только S" : "Можно изменить вручную на рабочем столе"}</p>
        </div>
        {v.kind !== "employee" && <div><label className="text-sm block mb-1">Период создания</label><Select aria-label="Период создания" value={v.period} onChange={s => set("period", s as DashboardWidget["period"])}>
          <option value="all">Любой · по JQL</option><option value="today">Сегодня</option><option value="week">Последние 7 дней</option><option value="custom">Указать даты</option>
        </Select></div>}
        {v.kind !== "employee" && v.period === "custom" && <><label className="text-sm">С даты<input required type="date" className={input} value={v.fromDate} onChange={e => set("fromDate", e.target.value)} /></label>
          <label className="text-sm">По дату<input required type="date" min={v.fromDate} className={input} value={v.toDate} onChange={e => set("toDate", e.target.value)} /></label></>}
      </div>
      {v.kind === "view" && <div className="space-y-4 border-t border-border-main pt-4">
        <div><p className="text-sm mb-2">Представление списка</p><div className="flex flex-wrap gap-2" role="group" aria-label="Начальное представление">
          {[{ id: "list", label: "Список", Icon: List }, { id: "donut", label: "Кольцо", Icon: Donut }, { id: "bar", label: "Гистограмма", Icon: BarChart3 }].map(({ id, label, Icon }) =>
            <Button type="button" key={id} variant="sm" aria-pressed={v.presentation === id} onClick={() => set("presentation", id as WidgetPresentation)}
              className={v.presentation === id ? "border-primary text-primary" : ""} icon={<Icon className="w-3.5 h-3.5" />}>{label}</Button>)}
        </div></div>
        <details className="border border-border-main rounded-lg p-3">
          <summary className="text-sm cursor-pointer">Колонки списка · {table.columns.length}</summary>
          <div className="mt-3"><PickerPanel label="Колонки" options={table.options} selected={table.columns} ordered onChange={next => set("columns", [...new Set(["key", ...next])])} /></div>
        </details>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-sm block mb-1">Группировать по полю</label><Select aria-label="Группировать по полю" searchable value={v.groupField} onChange={s => set("groupField", s)}>
            {(!fields.length ? [{ id: "status", name: "Статус" }, { id: "assignee", name: "Исполнитель" }, { id: "priority", name: "Приоритет" }, ...st.fields] : allFields).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select></div>
          <div><label className="text-sm block mb-1">Значение диаграммы</label><Select aria-label="Значение диаграммы" value={v.valueField} onChange={s => set("valueField", s)}>
            <option value="">Количество задач</option>{allFields.filter(f => f.kind === "number").map(f => <option key={f.id} value={f.id}>Сумма: {f.name}</option>)}
          </Select></div>
        </div>
        {(v.groupField.startsWith("st:") || v.valueField.startsWith("st:") || table.columns.some(c => c.startsWith("st:"))) && <div><label className="text-sm block mb-1">Источник полей ST</label>
          <Select aria-label="Источник полей ST" value={v.stListId ?? ""} onChange={id => set("stListId", id)}>
            <option value="">Все сохранённые списки Jira tool</option>
            {st.lists.map(list => <option key={list.id} value={list.id}>{list.name}{list.archivedAt ? " (архив)" : ""}</option>)}
          </Select><p className="text-[11px] text-text-muted mt-1">Используются поля Shark из этого браузера. Для разных значений одной задачи выберите конкретный список.</p>
        </div>}
        <div><p className="text-sm mb-2">Палитра диаграмм</p><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PALETTES.map(palette => <button key={palette.id} type="button" aria-pressed={v.palette === palette.id} onClick={() => set("palette", palette.id)}
            className={`border rounded-lg px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:ring-primary ${v.palette === palette.id ? "border-primary bg-primary/5" : "border-border-main hover:bg-bg-subtle"}`}>
            <span className="flex gap-1 mb-1.5">{[1, 2, 3, 4, 5, 6].map(n => <span key={n} className="h-2 rounded-sm flex-1" style={{ background: `var(--dashboard-${palette.id}-${n})` }} />)}</span>
            <span className="text-xs">{palette.name}</span>
          </button>)}
        </div></div>
        {groupNames.length > 0 && <details className="rounded-lg border border-border-main px-3 py-2">
          <summary className="text-xs cursor-pointer">Цвета отдельных групп</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">{groupNames.map((label, index) => <label key={label} className="flex items-center gap-2 text-xs min-w-0">
            <input type="color" aria-label={`Цвет группы ${label}`} className="dashboard-color shrink-0" value={v.colors?.[label] ?? paletteHex(index)}
              onChange={e => set("colors", { ...v.colors, [label]: e.target.value })} /><span className="truncate" title={label}>{label}</span>
          </label>)}</div>
          {Object.keys(v.colors ?? {}).length > 0 && <Button type="button" variant="sm" className="mt-3" onClick={() => set("colors", {})}>Вернуть палитру</Button>}
        </details>}
      </div>}
      {v.kind === "counter" && <div><label className="text-sm block mb-1">Источник полей ST в очереди</label><Select aria-label="Источник полей ST" value={v.stListId ?? ""} onChange={id => set("stListId", id)}>
        <option value="">Все сохранённые списки Jira tool</option>{st.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
      </Select></div>}
      {v.kind === "counter" && <div className="space-y-2 border-t border-border-main pt-4">
        <p className="text-sm">Цвет числа</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2">Основной
            <input type="color" aria-label="Основной цвет счётчика" className="dashboard-color" value={v.counterColor || "#4f46e5"} onChange={e => set("counterColor", e.target.value)} /></label>
          {v.counterColor && <Button type="button" variant="sm" onClick={() => set("counterColor", "")}>Цвет темы</Button>}
          <span className="text-text-muted">Ноль всегда зелёный.</span>
        </div>
        {(v.thresholds ?? []).map((t, i) => <div key={i} className="flex items-center gap-2 text-xs">
          <span>От</span>
          <input type="number" min={1} aria-label={`Порог ${i + 1}: от скольких задач`} value={t.from}
            onChange={e => set("thresholds", (v.thresholds ?? []).map((x, j) => j === i ? { ...x, from: Math.max(1, Number(e.target.value) || 1) } : x))}
            className="w-20 rounded-lg border border-border-main bg-bg-card px-2 py-1" />
          <span>задач</span>
          <input type="color" aria-label={`Порог ${i + 1}: цвет`} className="dashboard-color" value={t.color}
            onChange={e => set("thresholds", (v.thresholds ?? []).map((x, j) => j === i ? { ...x, color: e.target.value } : x))} />
          <button type="button" aria-label={`Убрать порог ${i + 1}`} className="text-text-muted hover:text-red-500" onClick={() => set("thresholds", (v.thresholds ?? []).filter((_, j) => j !== i))}>Убрать</button>
        </div>)}
        {(v.thresholds ?? []).length < 10 && <Button type="button" variant="sm" onClick={() => set("thresholds", [...(v.thresholds ?? []), { from: Math.max(1, ...(v.thresholds ?? []).map(t => t.from + 1), 5), color: "#dc2626" }])}>Добавить порог</Button>}
        <p className="text-[11px] text-text-muted">Число окрашивается цветом самого большого достигнутого порога, например: от 5 — жёлтый, от 10 — красный.</p>
      </div>}
      {v.kind === "counter" && <p className="text-xs text-text-muted rounded-lg bg-bg-subtle p-3">Найденные задачи остаются в командной очереди до отметки «Обработано», даже если выходят из фильтра. Счётчик — самостоятельный виджет.</p>}
      {error && <p role="alert" className="text-sm tone-danger">{error}</p>}
    </form>
  </Modal>;
}
