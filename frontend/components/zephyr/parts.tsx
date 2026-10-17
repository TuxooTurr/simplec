"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2, Loader2, X } from "lucide-react";
import { getCase, resultTone, zText, type ZCaseFull } from "@/lib/zephyrApi";

const TONE_CLS = {
  pass: "bg-green-600 text-white",
  fail: "bg-red-600 text-white",
  blocked: "bg-amber-500 text-amber-950",
  progress: "bg-blue-600 text-white",
  none: "bg-bg-subtle text-text-muted border border-border-main",
} as const;
const TONE_BAR = { pass: "bg-green-600", fail: "bg-red-600", blocked: "bg-amber-500", progress: "bg-blue-600", none: "bg-text-muted/25" } as const;
const TONE_ORDER = ["pass", "fail", "blocked", "progress", "none"] as const;

/** Статус результата прохождения цветом по смыслу. */
export function ResultPill({ status }: { status: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${TONE_CLS[resultTone(status)]}`}>{status || "Not Executed"}</span>;
}

/** Полоса прогресса прогона: доли статусов, слева направо — пройдено, провалено, заблокировано, в работе, не начато. */
export function ResultBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const sum = Math.max(total, Object.values(counts).reduce((a, b) => a + b, 0));
  const byTone = new Map<string, number>();
  for (const [st, n] of Object.entries(counts)) byTone.set(resultTone(st), (byTone.get(resultTone(st)) ?? 0) + n);
  const done = sum - (byTone.get("none") ?? 0) - (byTone.get("progress") ?? 0);
  const title = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Нет данных о прохождении";
  return (
    <div className="flex items-center gap-2 min-w-0" title={title}>
      <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden flex">
        {sum > 0 && TONE_ORDER.map(t => (byTone.get(t) ? <span key={t} className={TONE_BAR[t]} style={{ width: `${((byTone.get(t) ?? 0) / sum) * 100}%` }} /> : null))}
      </div>
      <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">{done}/{sum}</span>
    </div>
  );
}

/** Ссылки на задачи Jira (отслеживание): кейс или прогон ↔ стори, эпик, дефект. */
export function IssueLinks({ keys, baseUrl }: { keys: string[]; baseUrl: string }) {
  if (!keys.length) return <span className="text-xs text-text-muted">нет связей</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {keys.map(k => (
        <a key={k} href={baseUrl ? `${baseUrl}/browse/${k}` : undefined} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-mono hover:underline">
          <Link2 className="w-3 h-3" />{k}
        </a>
      ))}
    </span>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  const t = zText(text);
  if (!t) return null;
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">{title}</p>
      <p className="text-sm text-text-main whitespace-pre-wrap leading-relaxed">{t}</p>
    </section>
  );
}

/** Карточка кейса: цель, предусловие, шаги, метки, связи с Jira. Этап 1 — только просмотр. */
export function CaseCard({ caseKey, baseUrl, onClose }: { caseKey: string; baseUrl: string; onClose: () => void }) {
  const [c, setC] = useState<ZCaseFull | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setC(null); setErr("");
    getCase(caseKey).then(x => live && setC(x)).catch(e => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [caseKey]);

  return (
    <aside className="flex flex-col min-h-0 h-full border-l border-border-main bg-bg-card" aria-label={`Кейс ${caseKey}`}>
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border-main">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-primary">{caseKey}</p>
          <p className="text-sm font-semibold text-text-main break-words">{c?.name ?? " "}</p>
        </div>
        {baseUrl && (
          <a href={`${baseUrl}/secure/Tests.jspa#/testCase/${caseKey}`} target="_blank" rel="noopener noreferrer" title="Открыть в Zephyr"
            className="p-1 rounded text-text-muted hover:text-primary"><ExternalLink className="w-4 h-4" /></a>
        )}
        <button type="button" onClick={onClose} aria-label="Закрыть карточку" className="p-1 rounded text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
        {err && <p className="text-sm text-red-600 dark:text-red-400">Кейс не загрузился: {err}</p>}
        {!c && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p>}
        {c && (
          <>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {c.status && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main text-text-main">{c.status}</span>}
              {c.priority && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main text-text-main">Приоритет: {c.priority}</span>}
              {c.owner && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main text-text-muted">{c.owner}</span>}
              {c.labels.map(l => <span key={l} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary">{l}</span>)}
            </div>
            {c.folder && <p className="text-xs text-text-muted">Папка: {c.folder}</p>}
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">Связи с Jira</p>
              <IssueLinks keys={c.issueLinks} baseUrl={baseUrl} />
            </section>
            <Block title="Цель" text={c.objective} />
            <Block title="Предусловие" text={c.precondition} />
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">Шаги · {c.steps.length}</p>
              {c.steps.length === 0 ? <p className="text-xs text-text-muted">Шагов нет.</p> : (
                <ol className="space-y-2">
                  {c.steps.map((s, i) => (
                    <li key={i} className="rounded-lg border border-border-main p-2.5 text-sm">
                      <p className="flex gap-2"><span className="w-5 h-5 flex-shrink-0 rounded bg-bg-subtle text-[11px] font-semibold text-text-muted flex items-center justify-center">{i + 1}</span>
                        <span className="text-text-main whitespace-pre-wrap">{zText(s.description) || "—"}</span></p>
                      {zText(s.testData) && <p className="mt-1.5 ml-7 text-xs text-text-muted whitespace-pre-wrap"><b className="font-medium">Данные:</b> {zText(s.testData)}</p>}
                      {zText(s.expectedResult) && <p className="mt-1.5 ml-7 text-xs text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap"><b className="font-medium">Ожидаемо:</b> {zText(s.expectedResult)}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
