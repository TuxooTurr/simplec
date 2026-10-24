"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ClipboardCopy, Loader2, Tags, X, XCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { applyKe, getKePlan, type KePlan, type KeResult } from "@/lib/zephyrApi";

const SKIP_KEY = (release: string) => `st_zephyr_ke_skip:${release}`;

function readSkip(release: string): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY(release)) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function writeSkip(release: string, v: Record<string, string[]>) {
  try {
    if (Object.keys(v).length) localStorage.setItem(SKIP_KEY(release), JSON.stringify(v));
    else localStorage.removeItem(SKIP_KEY(release));
  } catch { /* приватный режим — исключения живут до закрытия окна */ }
}

/**
 * Выравнивание КЭ: все КЭ релиза — на все его стори (по процессу у стори должны стоять КЭ релиза).
 * Открытие окна — только чтение: что у каждой стори есть и чего не хватает, и проверка поля КЭ у стори
 * (editmeta: на экране ли, тип, операции). Запись — по кнопке, добавляются только недостающие КЭ,
 * свои КЭ стори не трогаются. Отдельную КЭ конкретной стори можно исключить — крестик на её маркере в «Добавится».
 * Ответ Jira по каждой стори виден как есть; отчёт можно скопировать разработчику.
 */
export default function KeAlignModal({ releaseKey, baseUrl, onClose }: { releaseKey: string; baseUrl: string; onClose: () => void }) {
  const [plan, setPlan] = useState<KePlan | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [off, setOff] = useState<Set<string>>(new Set());     // стори, с которых сняли галочку
  /** Стори → КЭ, которые ей не добавлять (сняли крестиком на маркере). Помнится по релизу: иначе при следующем
   *  выравнивании исключённая КЭ снова встала бы «к добавлению». */
  const [skip, setSkip] = useState<Record<string, string[]>>(() => readSkip(releaseKey));
  const toggleSkip = (story: string, ke: string) => setSkip(o => {
    const cur = o[story] ?? [];
    const next = cur.includes(ke) ? cur.filter(x => x !== ke) : [...cur, ke];
    const n = { ...o };
    if (next.length) n[story] = next; else delete n[story];
    writeSkip(releaseKey, n);
    return n;
  });
  const [results, setResults] = useState<KeResult[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getKePlan(releaseKey).then(p => { if (alive) setPlan(p); }, e => { if (alive) setErr((e as Error).message); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [releaseKey]);

  // Стори, у которой исключили все недостающие КЭ, — назначать нечего.
  const todo = plan?.stories.filter(s => s.missing.some(k => !(skip[s.key] ?? []).includes(k)) && !s.error) ?? [];
  const chosen = todo.filter(s => !off.has(s.key));
  const byKey = new Map((results ?? []).map(r => [r.key, r]));

  const apply = async () => {
    setBusy(true); setErr("");
    try {
      const out = await applyKe(releaseKey, chosen.map(s => s.key), skip);
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
                  const can = todo.includes(s);
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
                        {s.missing.length > 0 && (
                          <span className="flex flex-wrap items-center gap-1 mt-0.5 text-[11px]">
                            <span className="text-text-muted">Добавится:</span>
                            {s.missing.map(k => {
                              const out = (skip[s.key] ?? []).includes(k);
                              return (
                                <span key={k} className={`inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-full border
                                  ${out ? "border-border-main text-text-muted line-through" : "border-primary/40 bg-primary/10 text-primary"}`}>
                                  {k}
                                  <button type="button" onClick={() => toggleSkip(s.key, k)} disabled={busy}
                                    aria-label={out ? `Вернуть ${k} для ${s.key}` : `Не добавлять ${k} в ${s.key}`}
                                    title={out ? "Вернуть: КЭ добавится стори" : "Исключить: этой стори КЭ не добавлять"}
                                    className="p-0.5 rounded-full hover:bg-bg-subtle">
                                    {out ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}</button>
                                </span>
                              );
                            })}
                          </span>
                        )}
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
