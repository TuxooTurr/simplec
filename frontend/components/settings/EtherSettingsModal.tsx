"use client";
import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import {
  connectEther,
  disconnectEther,
  fetchEtherState,
  type EtherState,
} from "@/lib/etherApi";
export default function EtherSettingsModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState<EtherState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    const read = () => {
      void fetchEtherState().then(
        (r) => {
          if (live) setStatus(r);
        },
        (e) => {
          if (live) setError(e.message);
        },
      );
    };
    read();
    const timer = setInterval(read, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open]);
  async function run(action: () => Promise<EtherState>) {
    setBusy(true);
    setError("");
    try {
      setStatus(await action());
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Эфир · подключение"
      size="max-w-xl"
    >
      <div className="space-y-4 text-sm">
        <p className="text-text-muted">
          Одно подключение для чата, почты и встреч на «Главной». Для входа откроется
          отдельное окно Сбербраузера или Chrome на компьютере, где запущен
          Shark.
        </p>
        <dl className="rounded-lg border border-border-main bg-bg-subtle p-3">
          <dt className="text-xs text-text-muted">Подключение</dt>
          <dd>{status?.source_text ?? "Проверяю…"}</dd>
          <dt className="text-xs text-text-muted mt-2">Состояние</dt>
          <dd>
            {status?.state === "waiting"
              ? "Открылось окно браузера — войдите в Эфир"
              : status?.state === "connected"
                ? "Подключено"
                : status?.state === "timeout"
                  ? "Время ожидания истекло"
                  : status?.state === "error"
                    ? "Ошибка входа"
                    : "Ожидает подключения"}
          </dd>
        </dl>
        {(error || status?.error) && (
          <p role="alert" className="text-red-600">
            {error || status?.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            loading={busy || status?.state === "waiting"}
            onClick={() => void run(connectEther)}
          >
            Подключить через браузер
          </Button>
          {(status?.source === "cookie" ||
            status?.source === "broken" ||
            status?.state === "waiting" ||
            status?.state === "connected") && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void run(disconnectEther)}
            >
              {status.state === "waiting"
                ? "Отменить вход"
                : "Убрать сохранённую сессию"}
            </Button>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Сессия хранится зашифрованной. Панель работает только на чтение. Если
          вход истёк, подключитесь повторно.
        </p>
      </div>
    </Modal>
  );
}
