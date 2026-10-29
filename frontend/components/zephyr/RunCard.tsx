"use client";

import { useState } from "react";
import { CheckCheck, Loader2, PlayCircle } from "lucide-react";
import { fmtDate, passRun, resultTone, runKind, runKindLabel, zephyrRunUrl, type ZRun } from "@/lib/zephyrApi";
import { ResultBar } from "./parts";

/** Плашка вида прогона: НФ — фиолетовая, регресс — синяя, прочее — нейтральная. */
export function RunTypeChip({ type }: { type: string }) {
  if (!type) return null;
  const k = runKind(type);
  const cls = k === "nf" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : k === "regress" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-bg-subtle text-text-muted";
  return <span title={type} className={`inline-block px-1.5 py-px rounded text-[10px] font-semibold whitespace-nowrap ${cls}`}>{runKindLabel(type)}</span>;
}

/** Сколько кейсов прогона пройдено (Pass и подобные) — для подписи под полосой. */
export function passedOf(run: Pick<ZRun, "counts">): number {
  return Object.entries(run.counts).reduce((n, [st, c]) => n + (resultTone(st) === "pass" ? c : 0), 0);
}

/**
 * Карточка прогона — одинаковая везде: номер, вид тестирования, название, прогресс (сколько пройдено), дата создания
 * и «Пройти» — проставить Pass всем непройденным кейсам в Jira (с подтверждением). onPassed — раздел перечитывает данные.
 * Номер (есть baseUrl) — ссылка: прогон в Jira в новой вкладке, страница прогона с правкой, а не плеер.
 * Остальная карточка — выбрать прогон (onOpen); название — до двух строк.
 */
export default function RunCard({ run, baseUrl, active, onOpen, onPassed }: {
  run: ZRun;
  /** Адрес Jira — номер прогона становится ссылкой на страницу прогона. */
  baseUrl?: string;
  active?: boolean;
  onOpen?: () => void;
  onPassed?: () => void;
}) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const passed = passedOf(run);
  const total = Math.max(run.total, Object.values(run.counts).reduce((a, b) => a + b, 0));

  const pass = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await passRun(run.key);
      setNote(r.errors.length
        ? { ok: false, text: `Pass: ${r.saved}, ошибок: ${r.errors.length} — ${r.errors[0].testCaseKey}: ${r.errors[0].error}` }
        : { ok: true, text: r.saved ? `Pass проставлен: ${r.saved}${r.skipped ? `, уже были пройдены: ${r.skipped}` : ""}.` : "Все кейсы уже пройдены." });
      onPassed?.();
    } catch (e) { setNote({ ok: false, text: `Не прошёл: ${(e as Error).message}` }); }
    setBusy(false); setAsk(false);
  };

  return (
    // Щелчок по любому месту карточки (кроме ссылки и кнопок) выбирает прогон; с клавиатуры — кнопка-название.
    <div onClick={e => { if (onOpen && !(e.target as HTMLElement).closest("a, button, input")) onOpen(); }}
      className={`rounded-lg border px-2.5 py-2 ${onOpen ? "cursor-pointer" : ""} ${active ? "border-primary/50 bg-primary/5" : "border-border-main bg-bg-card hover:bg-bg-subtle/60"}`}>
      <div className="flex items-start gap-2">
        {/* Ссылка не может лежать внутри кнопки — номер стоит рядом, а кнопка выбора прогона занимает остальное. */}
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <PlayCircle className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            {baseUrl
              ? <a href={zephyrRunUrl(baseUrl, run.key)} target="_blank" rel="noopener noreferrer" title="Открыть прогон в Jira (страница прогона, не плеер)"
                  className="font-mono text-[11px] text-primary whitespace-nowrap hover:underline">{run.key} ↗</a>
              : <span className="font-mono text-[11px] text-primary whitespace-nowrap">{run.key}</span>}
            <RunTypeChip type={run.type} />
            <span className="ml-auto text-[10px] text-text-muted whitespace-nowrap" title="Дата создания прогона">{fmtDate(run.created)}</span>
          </span>
          <button type="button" onClick={onOpen} disabled={!onOpen} aria-pressed={active} title={run.name}
            className="w-full text-left text-sm text-text-main line-clamp-2 mt-0.5 disabled:cursor-default">{run.name || "—"}</button>
        </div>
        {!ask && (
          <button type="button" onClick={() => setAsk(true)} disabled={busy || total === 0} title="Пройти прогон: Pass всем непройденным кейсам"
            className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-main text-[11px] text-text-main hover:border-green-600 hover:text-green-700 disabled:opacity-40">
            <CheckCheck className="w-3.5 h-3.5" /> Пройти</button>
        )}
      </div>
      <div className="mt-1.5"><ResultBar counts={run.counts} total={run.total} /></div>
      <p className="mt-0.5 text-[11px] text-text-muted">Пройдено: <b className="text-text-main font-medium">{passed}</b> из {total}
        {run.status && <span title="Статус прогона"> · {run.status}</span>}</p>
      {ask && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-xs">
          <span className="text-amber-800 dark:text-amber-200">Pass всем непройденным ({total - passed}) — в Jira?</span>
          <button type="button" onClick={pass} disabled={busy} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded bg-green-600 text-white font-semibold">
            {busy && <Loader2 className="w-3 h-3 animate-spin" />} Да</button>
          <button type="button" onClick={() => setAsk(false)} disabled={busy} className="px-2 py-0.5 rounded border border-border-main text-text-muted">Нет</button>
        </div>
      )}
      {note && <p className={`mt-1 text-[11px] ${note.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{note.text}</p>}
    </div>
  );
}
