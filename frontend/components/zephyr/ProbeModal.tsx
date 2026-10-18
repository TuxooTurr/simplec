"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardCopy, Loader2, MinusCircle, Stethoscope, XCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { probeZephyr, type ProbeReport } from "@/lib/zephyrApi";

/**
 * Проверка API Zephyr на стенде: только чтение. Отчёт (что сработало, коды, каркас ответов без данных)
 * копируется в буфер — его присылают разработчику, по нему фиксируются рабочие запросы и пишется запись.
 */
export default function ProbeModal({ open, project, onClose }: { open: boolean; project: string; onClose: () => void }) {
  const [samples, setSamples] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<ProbeReport | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(""); setRep(null); setCopied(false);
    try { setRep(await probeZephyr(project, samples)); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const copy = async () => {
    if (!rep) return;
    try { await navigator.clipboard.writeText(JSON.stringify(rep, null, 2)); setCopied(true); }
    catch { setErr("Не удалось скопировать — браузер не дал доступ к буферу"); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Проверка API Zephyr · ${project}`} size="max-w-3xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Только чтение — в Jira ничего не меняется. Проверяются оба варианта запросов (публичный API Zephyr Scale
          и вариант из документации), дерево папок и справочники. Отчёт скопируйте и пришлите — по нему включим
          создание и правку кейсов, прогонов и плеер.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={run} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />} {rep ? "Проверить ещё раз" : "Проверить"}
          </button>
          <label className="flex items-center gap-2 text-xs text-text-main cursor-pointer select-none">
            <input type="checkbox" checked={samples} onChange={e => setSamples(e.target.checked)} />
            С образцами ответов <span className="text-text-muted">(начало ответа — там будут названия кейсов)</span>
          </label>
          {rep && (
            <button type="button" onClick={copy} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
              <ClipboardCopy className="w-4 h-4" /> {copied ? "Скопировано" : "Скопировать отчёт"}
            </button>
          )}
        </div>
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        {rep && (
          <>
            <p className="text-sm text-text-main">Сработало <b>{rep.ok}</b> из {rep.total} · {rep.base_url} · {rep.checkedAt}</p>
            <ul className="border border-border-main rounded-xl divide-y divide-border-main">
              {rep.results.map(r => (
                <li key={r.id} className="text-sm">
                  <button type="button" onClick={() => setOpenRow(o => (o === r.id ? null : r.id))} disabled={r.skipped}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-bg-subtle disabled:hover:bg-transparent">
                    {r.skipped ? <MinusCircle className="w-4 h-4 mt-0.5 text-text-muted flex-shrink-0" />
                      : r.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                      : <XCircle className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-text-main">{r.label}</span>
                      <span className="block text-[11px] text-text-muted font-mono truncate">
                        {r.skipped ? r.reason : `${r.method} ${r.path}`}
                      </span>
                      {r.error && <span className="block text-[11px] text-red-600 dark:text-red-400">{r.error}</span>}
                      {r.note && <span className="block text-[11px] text-text-main">{r.note}</span>}
                    </span>
                    {!r.skipped && <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">{r.status} · {r.ms} мс</span>}
                  </button>
                  {openRow === r.id && (r.shape !== undefined || r.sample) && (
                    <pre className="mx-3 mb-2 p-2 rounded-lg bg-bg-subtle text-[11px] text-text-main overflow-x-auto max-h-60">
                      {r.sample ?? JSON.stringify(r.shape, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
