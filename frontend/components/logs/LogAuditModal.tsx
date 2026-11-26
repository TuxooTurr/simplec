"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { formatLogSize, getLogAudit, type LogAuditEntry, type LogAuditPage } from "@/lib/mcpLogsApi";

const STATUS: Record<LogAuditEntry["status"], { label: string; tone: string }> = {
  running: { label: "В процессе", tone: "tone-neutral" },
  done: { label: "Готово", tone: "tone-success" },
  error: { label: "Ошибка", tone: "tone-danger" },
  timeout: { label: "Таймаут", tone: "tone-warning" },
  cancelled: { label: "Отменено", tone: "tone-neutral" },
};

const date = (value: string) => new Date(value).toLocaleString("ru-RU");

export default function LogAuditModal({ onClose }: { onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<LogAuditPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    getLogAudit(offset, controller.signal).then(setData, error => {
      if (!controller.signal.aborted) setError((error as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, reload]);

  return <Modal open title="Аудит анализа логов" size="max-w-2xl" onClose={onClose}
    footer={<div className="flex flex-wrap justify-between gap-2">
      <Button variant="ghost" type="button" loading={loading} icon={<RefreshCw className="h-4 w-4" />}
        onClick={() => { setOffset(0); setReload(value => value + 1); }}>Обновить</Button>
      <div className="flex gap-2">
        <Button variant="ghost" type="button" disabled={!offset || loading} onClick={() => setOffset(value => Math.max(0, value - 30))}>Назад</Button>
        <Button variant="ghost" type="button" disabled={!data?.hasMore || loading} onClick={() => setOffset(value => value + 30)}>Дальше</Button>
      </div>
    </div>}>
    {error && <p role="alert" className="tone-danger rounded-md border p-2 text-sm">{error}</p>}
    {!data && loading && <p role="status" className="text-sm text-text-muted">Загружаю журнал…</p>}
    {data && !data.entries.length && <p className="text-sm text-text-muted">Запросов на анализ логов пока нет.</p>}
    <ul className="divide-y divide-border-main" aria-busy={loading}>
      {data?.entries.map(entry => <li key={entry.id} className="space-y-1 py-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <p className="min-w-0 break-words text-sm font-semibold text-text-main">
            {entry.source === "file" ? "Загрузка файлов" : "Анализ событий MCP"} · {entry.actor}
          </p>
          <span className={`rounded-md border px-1.5 py-0.5 text-xs ${STATUS[entry.status].tone}`}>{STATUS[entry.status].label}</span>
        </div>
        <p className="text-xs text-text-muted">
          {[date(entry.started_at), entry.provider, entry.item_count !== null && `${entry.source === "file" ? "файлов" : "записей"}: ${entry.item_count}`,
            entry.size_bytes !== null && formatLogSize(entry.size_bytes), entry.errors_only === 1 && "Только ошибки"].filter(Boolean).join(" · ")}
        </p>
        {entry.period_start && entry.period_end && <p className="text-xs text-text-muted">{date(entry.period_start)} — {date(entry.period_end)}</p>}
      </li>)}
    </ul>
  </Modal>;
}
