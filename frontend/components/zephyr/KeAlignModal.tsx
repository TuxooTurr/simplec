"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ClipboardCopy, Loader2, Tags, XCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { applyKe, getKePlan, type KePlan, type KeResult } from "@/lib/zephyrApi";

/**
 * Выравнивание КЭ: все КЭ релиза — на все его стори (по процессу у стори должны стоять КЭ релиза).
 * Открытие окна — только чтение: что у каждой стори есть и чего не хватает, и проверка поля КЭ у стори
 * (editmeta: на экране ли, тип, операции). Запись — по кнопке, добавляются только недостающие КЭ,
 * свои КЭ стори не трогаются. Ответ Jira по каждой стори виден как есть; отчёт можно скопировать разработчику.
 */
export default function KeAlignModal({ releaseKey, baseUrl, onClose }: { releaseKey: string; baseUrl: string; onClose: () => void }) {
  const [plan, setPlan] = useState<KePlan | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [off, setOff] = useState<Set<string>>(new Set());     // стори, с которых сняли галочку
  const [results, setResults] = useState<KeResult[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getKePlan(releaseKey).then(p => { if (alive) setPlan(p); }, e => { if (alive) setErr((e as Error).message); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [releaseKey]);

  const todo = plan?.stories.filter(s => s.missing.length && !s.error) ?? [];
  const chosen = todo.filter(s => !off.has(s.key));
  const byKey = new Map((results ?? []).map(r => [r.key, r]));

  const apply = async () => {
    setBusy(true); setErr("");
    try {
      const out = await applyKe(releaseKey, chosen.map(s => s.key));
      setResults(out.results); setPlan(out.plan); setOff(new Set());
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ plan, results }, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setErr("Не удалось скопировать — браузер не дал доступ к буферу"); }
  };
  const check = plan?.check;

  return (
    <Modal open onClose={onClose} title={`КЭ релиза → на стори · ${releaseKey}`} size="max-w-4xl">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Каждой стори релиза добавятся КЭ релиза, которых у неё нет. Свои КЭ стори остаются. Пока не нажата
          «Назначить», в Jira ничего не меняется.
        </p>
        {busy && !plan && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Читаю КЭ релиза и стори…</p>}
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

        {plan && (
          <>
            <div className="rounded-lg border border-border-main bg-bg-subtle px-3 py-2 text-sm">
              <span className="text-text-muted">КЭ релиза ({plan.release.fieldName}, {plan.release.field}): </span>
              {plan.release.ke.length
                ? <span className="text-text-main">{plan.release.ke.join(" · ")}</span>
                : <span className="text-amber-700 dark:text-amber-300">в релизе КЭ не заполнены — назначать нечего</span>}
            </div>

            {check?.story && (
              <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${plan.mode ? "bg-green-600/10 text-green-800 dark:text-green-300" : "border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"}`}>
                {plan.mode ? <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                <span>
                  Проверка поля на {check.story}:{" "}
                  {check.error ? check.error : check.onScreen
                    ? <>на экране правки · тип {check.schema?.type ?? "?"}{check.schema?.items ? ` из ${check.schema.items}` : ""} · операции {check.operations?.join(", ") || "нет"}{check.allowedValues != null ? ` · вариантов ${check.allowedValues}` : ""}</>
                    : "поля нет на экране правки"}
                  {plan.mode ? ` — запишем ${plan.mode === "set" ? "списком (set)" : "по одной (add)"}.` : ` — ${plan.blocked}`}
                </span>
              </p>
            )}

            {plan.stories.length === 0 ? (
              <p className="text-sm text-text-muted">К релизу не привязаны стори (связи Jira с типом «История»).</p>
            ) : (
              <ul className="border border-border-main rounded-xl divide-y divide-border-main max-h-[50vh] overflow-y-auto scrollbar-thin">
                {plan.stories.map(s => {
                  const r = byKey.get(s.key);
                  const can = s.missing.length > 0 && !s.error;
                  return (
                    <li key={s.key} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <input type="checkbox" className="mt-1" aria-label={`Назначить КЭ ${s.key}`} disabled={!can || busy}
                        checked={can && !off.has(s.key)}
                        onChange={e => setOff(p => { const n = new Set(p); if (e.target.checked) n.delete(s.key); else n.add(s.key); return n; })} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <a href={`${baseUrl}/browse/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">{s.key}</a>
                          <span className="min-w-0 truncate text-text-main" title={s.summary}>{s.summary}</span>
                        </span>
                        <span className="block text-[11px] text-text-muted">Сейчас: {s.ke.length ? s.ke.join(" · ") : "КЭ нет"}</span>
                        {s.error && <span className="block text-[11px] text-red-600 dark:text-red-400">Не прочиталась: {s.error}</span>}
                        {s.missing.length > 0 && <span className="block text-[11px] text-primary">Добавится: {s.missing.join(" · ")}</span>}
                        {r && !r.ok && <span className="block text-[11px] text-red-600 dark:text-red-400">Jira: {r.error}</span>}
                      </span>
                      {r?.ok ? <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 whitespace-nowrap"><Check className="w-3.5 h-3.5" /> Назначено</span>
                        : r ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        : !s.missing.length && !s.error ? <span className="text-xs text-green-700 dark:text-green-400 whitespace-nowrap">Все КЭ есть</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={apply} disabled={busy || !plan.mode || !chosen.length}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tags className="w-4 h-4" />} Назначить · стори: {chosen.length}
              </button>
              {results && (
                <span className="text-sm text-text-main">
                  Готово: {results.filter(r => r.ok).length} из {results.length}
                  {results.some(r => !r.ok) && <span className="text-red-600 dark:text-red-400"> · с ошибкой: {results.filter(r => !r.ok).length}</span>}
                </span>
              )}
              <button type="button" onClick={copy} title="Скопировать план, проверку поля и ответы Jira — прислать разработчику"
                className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
                <ClipboardCopy className="w-4 h-4" /> {copied ? "Скопировано" : "Скопировать отчёт"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
