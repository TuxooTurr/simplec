"use client";
import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import IssueTable, {
  NO_FILTER,
  filterIssueRows,
  type IssueFilter,
} from "@/components/jiratool/IssueTable";
import IssueActions from "@/components/jiratool/IssueActions";
import type { Issue } from "@/lib/jiraTool";
import type {
  DashboardWidget,
  QueueIssue,
  WidgetData,
} from "@/lib/dashboardApi";
import DashboardColumns from "./DashboardColumns";
import { needsStList, useDashboardColumns } from "@/lib/dashboardColumns";
import { markWidget } from "@/lib/dashboardApi";
import { stageRenderer } from "./stageCell";
export default function IssueQueueModal({
  widget,
  data,
  onClose,
  onChanged,
  subset, canEdit, onColumnsChange, loading, loadError, notice,
}: {
  widget: DashboardWidget;
  canEdit: boolean;
  onColumnsChange: (columns: string[]) => Promise<void>;
  data: Pick<WidgetData, "pending" | "error" | "partial"> & { items: Issue[] };
  onClose: () => void;
  onChanged: () => void;
  subset?: Set<string>;
  loading?: boolean;
  loadError?: string;
  notice?: string;
}) {
  const [done, setDone] = useState(false),
    [picked, setPicked] = useState<Set<string>>(new Set()),
    [filter, setFilter] = useState<IssueFilter>(NO_FILTER),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = data.items.filter(
    (i) =>
      (widget.kind !== "counter" || !!(i as QueueIssue).processedAt === done) &&
      (!subset || subset.has(i.key)),
  );
  const table = useDashboardColumns(widget, rows);
  useEffect(() => setFilter(NO_FILTER), [widget.columns]);
  const tableFilter = { ...filter, searchCols: table.columns };
  const visible = filterIssueRows(table.rows, tableFilter);
  const selected = visible.filter((i) => picked.has(i.key));
  async function mark(items: Issue[], value: boolean) {
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < items.length; i += 1000)
        await markWidget(
          widget.id,
          items.slice(i, i + 1000).map((x) => x.key),
          value,
        );
      setPicked(new Set());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={widget.title} onClose={onClose} size="max-w-6xl">
      <div className="space-y-3">
        {data.error && <p role="alert" className="text-sm tone-warning rounded-lg p-3">{data.error} Показаны последние сохранённые данные.</p>}
        {data.partial && <p className="text-xs text-text-muted">Выдача ограничена; сузьте JQL для полной проверки.</p>}
        {notice && <p className="text-xs text-text-muted">{notice}</p>}
        {loading && <p role="status" className="text-sm text-text-muted">Загружаю дефекты из Jira…</p>}
        {loadError && <p role="alert" className="text-sm tone-danger">{loadError}</p>}
        {widget.kind === "counter" && (
          <div className="flex gap-2">
            <Button
              variant={!done ? "primary" : "ghost"}
              onClick={() => {
                setDone(false);
                setPicked(new Set());
              }}
            >
              К обработке · {data.pending}
            </Button>
            <Button
              variant={done ? "primary" : "ghost"}
              onClick={() => {
                setDone(true);
                setPicked(new Set());
              }}
            >
              Обработанные · {data.items.length - data.pending}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <IssueActions issues={selected} onDone={() => onChanged()} />
          <span className="text-sm text-text-muted">
            Выбрано: {selected.length}
          </span>
          {canEdit && <DashboardColumns columns={table.columns} options={table.options} onChange={async columns => { await onColumnsChange(columns); setFilter(NO_FILTER); }} />}
          {widget.kind === "counter" && (
            <Button
              disabled={!selected.length}
              loading={busy}
              onClick={() => void mark(selected, !done)}
            >
              {done ? "Вернуть в очередь" : "Обработано"}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {table.columns.some(needsStList) && !table.available && <p className="text-xs tone-warning">Источник ST не найден в этом браузере. Выберите источник в настройках виджета или перенесите данные Jira tool.</p>}
        <IssueTable
          cols={table.columns}
          columnLabels={table.labels} columnKinds={table.kinds}
          renderCell={stageRenderer(table.st)} detailAddToList
          initialSort={{ col: "key", dir: 1 }}
          filter={tableFilter}
          onFilter={setFilter}
          source={table.rows}
          groups={[{ title: null, issues: visible }]}
          picked={picked}
          onPick={(keys, on) =>
            setPicked((p) => {
              const n = new Set(p);
              keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
              return n;
            })
          }
          widthKey="dashboard-queue"
          rowActions={
            widget.kind === "counter"
              ? (issue) => (
                  <Button
                    variant="sm"
                    disabled={busy}
                    title={
                      (issue as QueueIssue).processedReason === "status-change"
                        ? `Обработано автоматически: смена статуса ${(issue as QueueIssue).statusChange?.from ?? ""} → ${(issue as QueueIssue).statusChange?.to ?? ""}`
                        : (issue as QueueIssue).processedAt
                        ? `Обработал ${(issue as QueueIssue).processedBy} · ${new Date((issue as QueueIssue).processedAt!).toLocaleString("ru-RU")}`
                        : !(issue as QueueIssue).inFilter
                          ? "Сохранена в очереди, уже вне текущего фильтра"
                          : undefined
                    }
                    onClick={() => void mark([issue], !done)}
                  >
                    {done ? "Вернуть" : "Обработано"}
                  </Button>
                )
              : undefined
          }
        />
        {widget.kind === "counter" && (
          <p className="text-xs text-text-muted">
            Отметка общая для команды. Необработанные задачи сохраняются и после
            выхода из выбранного периода.
          </p>
        )}
      </div>
    </Modal>
  );
}
