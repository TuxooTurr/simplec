"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { kernelAudit, type KernelAuditEntry } from "@/lib/api";

export default function KernelAuditModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<KernelAuditEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const load = () => {
      void kernelAudit(20).then(rows => {
        if (live) { setEntries(rows); setError(""); }
      }, error => {
        if (live) setError((error as Error).message);
      });
    };
    load();
    const interval = window.setInterval(load, 10_000);
    return () => { live = false; window.clearInterval(interval); };
  }, []);

  return <Modal open onClose={onClose} title="Аудит запусков ядер" size="max-w-2xl">
    {error && <p role="alert" className="text-xs tone-danger-text">{error}</p>}
    {!entries && !error && <p role="status" className="text-sm text-text-muted">Загружаю журнал…</p>}
    {entries?.length === 0 && <p className="text-sm text-text-muted">Записей пока нет.</p>}
    {entries && <ul className="space-y-1.5">
      {entries.map((entry, index) => (
        <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-subtle px-2.5 py-1.5 text-xs text-text-muted">
          {entry.ts && <time dateTime={entry.ts} className="font-mono text-[11px]">{new Date(entry.ts).toLocaleString("ru-RU")}</time>}
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
            entry.action === "start" ? "tone-success" : entry.action === "stop" ? "tone-danger" : "tone-neutral"
          }`}>{entry.action}</span>
          <span className="inline-flex items-center gap-1 font-medium text-text-main"><User className="h-3 w-3" aria-hidden />{entry.user}</span>
          <span className="break-all">{entry.script_name || entry.script_id}</span>
        </li>
      ))}
    </ul>}
  </Modal>;
}
