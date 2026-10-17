"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Bug, Check, CheckCheck, ChevronRight, Loader2, Timer, X, XCircle } from "lucide-react";
import IssueFormModal from "@/components/jiratool/IssueFormModal";
import { getCase, saveResults, zText, type ZCaseFull, type ZStatus } from "@/lib/zephyrApi";
import { IssueLinks, ResultPill } from "./parts";

type StepMark = "Pass" | "Fail" | "Blocked" | null;

interface Work {
  steps: StepMark[];
  stepComments: string[];
  comment: string;
  defects: string[];
  startedAt: number;
  /** Сохранённый в Jira итог кейса. */
  saved?: ZStatus;
}

/** Итог кейса по шагам: упал хоть один — Fail; заблокирован — Blocked; все пройдены — Pass; иначе не начат. */
function overall(steps: StepMark[]): ZStatus {
  if (steps.some(s => s === "Fail")) return "Fail";
  if (steps.some(s => s === "Blocked")) return "Blocked";
  if (steps.length && steps.every(s => s === "Pass")) return "Pass";
  return "Not Executed";
}

const MARK_BTN: Record<Exclude<StepMark, null>, { label: string; key: string; on: string; Icon: typeof Check }> = {
  Pass:    { label: "Pass",    key: "1", on: "bg-green-600 text-white border-green-600", Icon: Check },
  Fail:    { label: "Fail",    key: "2", on: "bg-red-600 text-white border-red-600", Icon: XCircle },
  Blocked: { label: "Blocked", key: "3", on: "bg-amber-500 text-amber-950 border-amber-500", Icon: Ban },
};

const fmtTime = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/**
 * Плеер прохождения прогона. Слева — кейсы прогона со статусами, в центре — текущий кейс по шагам:
 * Pass / Fail / Blocked (клавиши 1 / 2 / 3 — отмечают первый неотмеченный шаг), комментарий к шагу,
 * таймер, «Завести дефект» из упавшего шага (форма Jira tool, дефект привязывается к результату).
 * «Сохранить и дальше» (Ctrl+Enter) — итог кейса уходит в Jira сразу.
 */
export default function Player({ runKey, items, project, baseUrl, onClose }: {
  runKey: string;
  items: { testCaseKey: string; status: string }[];
  project: string;
  baseUrl: string;
  /** changed — что-то сохранили в Jira (прогон стоит перечитать). */
  onClose: (changed: boolean) => void;
}) {
  const [idx, setIdx] = useState(() => Math.max(0, items.findIndex(i => !i.status || /not executed|не выполн/i.test(i.status))));
  const [cases, setCases] = useState<Record<string, ZCaseFull>>({});
  const [loadErr, setLoadErr] = useState("");
  const [work, setWork] = useState<Record<string, Work>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [changed, setChanged] = useState(false);
  const [defectFor, setDefectFor] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const key = items[idx]?.testCaseKey ?? "";
  const c = cases[key];
  useEffect(() => {
    if (!key || cases[key]) return;
    let live = true;
    setLoadErr("");
    getCase(key).then(x => live && setCases(m => ({ ...m, [key]: x }))).catch(e => live && setLoadErr((e as Error).message));
    return () => { live = false; };
  }, [key, cases]);

  // Рабочее состояние кейса заводим при первом открытии — с этого момента идёт таймер.
  useEffect(() => {
    if (!c || work[key]) return;
    setWork(w => ({ ...w, [key]: { steps: c.steps.map(() => null), stepComments: c.steps.map(() => ""), comment: "", defects: [], startedAt: Date.now() } }));
  }, [c, key, work]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const w = work[key];
  const patch = (p: Partial<Work>) => setWork(m => ({ ...m, [key]: { ...m[key], ...p } }));
  const mark = (i: number, m: StepMark) => {
    if (!w) return;
    const steps = [...w.steps]; steps[i] = steps[i] === m ? null : m;
    patch({ steps });
  };
  const nextUnset = w ? w.steps.findIndex(s => s === null) : -1;
  const status = w ? overall(w.steps) : "Not Executed";
  const statusOf = (k: string) => work[k]?.saved ?? items.find(i => i.testCaseKey === k)?.status ?? "Not Executed";

  const save = async (andNext: boolean) => {
    if (!w || !c) return;
    setSaving(true); setSaveErr("");
    try {
      const st: ZStatus = status === "Not Executed" && w.steps.every(s => s === null) && !c.steps.length ? "Pass" : status;
      const r = await saveResults(runKey, [{
        testCaseKey: key, status: st, comment: w.comment.trim() || undefined, executionTime: Date.now() - w.startedAt,
        issueLinks: w.defects.length ? w.defects : undefined,
        scriptResults: w.steps.map((s, i) => ({ index: c.steps[i]?.index ?? i, status: (s ?? "Not Executed") as ZStatus, comment: w.stepComments[i] || undefined })),
      }]);
      if (r.errors.length) throw new Error(r.errors[0].error);
      patch({ saved: st }); setChanged(true);
      if (andNext && idx < items.length - 1) setIdx(idx + 1);
    } catch (e) { setSaveErr((e as Error).message); }
    setSaving(false);
  };

  // Горячие клавиши — когда курсор не в поле ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName);
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(true); return; }
      if (typing || defectFor !== null || !w || nextUnset < 0) return;
      const m = e.key === "1" ? "Pass" : e.key === "2" ? "Fail" : e.key === "3" ? "Blocked" : null;
      if (m) { e.preventDefault(); mark(nextUnset, m); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const defectPrefill = useMemo(() => {
    if (defectFor === null || !c || !w) return undefined;
    const upto = c.steps.slice(0, defectFor + 1);
    const failed = c.steps[defectFor];
    // Markdown: при отправке в Jira его переводит _md_to_jira (**жирный** → *жирный*); «#» в начале строки стал бы заголовком.
    const lines = [
      `**Кейс Zephyr:** ${c.key} — ${c.name} (прогон ${runKey})`,
      zText(c.precondition) ? `**Предусловие:** ${zText(c.precondition)}` : "",
      "**Шаги воспроизведения:**",
      ...upto.map((s, i) => `${i + 1}. ${zText(s.description)}${zText(s.testData) ? ` (данные: ${zText(s.testData)})` : ""}`),
      `**Фактический результат:** ${w.stepComments[defectFor] || "—"}`,
      `**Ожидаемый результат:** ${zText(failed?.expectedResult) || "—"}`,
    ].filter(Boolean);
    return { type: "Дефект", summary: `[Регресс] ${c.name}`, description: lines.join("\n") };
  }, [defectFor, c, w, runKey]);

  const done = items.filter(i => /pass|fail|block/i.test(statusOf(i.testCaseKey))).length;

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-main" role="dialog" aria-label={`Прохождение прогона ${runKey}`}>
      <aside className="w-72 flex-shrink-0 flex flex-col border-r border-border-main bg-bg-card">
        <div className="px-4 py-3 border-b border-border-main">
          <p className="font-mono text-xs text-primary">{runKey}</p>
          <p className="text-sm font-semibold text-text-main">Прохождение · {done}/{items.length}</p>
        </div>
        <ol className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
          {items.map((it, i) => (
            <li key={`${it.testCaseKey}-${i}`}>
              <button type="button" onClick={() => setIdx(i)} aria-current={i === idx}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left ${i === idx ? "bg-primary/10" : "hover:bg-bg-subtle"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[11px] text-primary">{it.testCaseKey}</span>
                  <span className="block text-xs text-text-main truncate">{cases[it.testCaseKey]?.name ?? ""}</span>
                </span>
                <ResultPill status={statusOf(it.testCaseKey)} />
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-primary">{key} · {idx + 1} из {items.length}</p>
            <p className="text-base font-semibold text-text-main truncate">{c?.name ?? " "}</p>
          </div>
          {w && <span className="flex items-center gap-1 text-sm text-text-muted tabular-nums" title="Время на кейс"><Timer className="w-4 h-4" />{fmtTime(now - w.startedAt)}</span>}
          <ResultPill status={w?.saved ?? status} />
          <button type="button" onClick={() => onClose(changed)} aria-label="Закрыть плеер" className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-4">
          {loadErr && <p className="text-sm text-red-600 dark:text-red-400">Кейс не загрузился: {loadErr}</p>}
          {!c && !loadErr && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю кейс…</p>}
          {c && w && (
            <div className="max-w-4xl space-y-4">
              {zText(c.objective) && <p className="text-sm text-text-main whitespace-pre-wrap"><b className="text-text-muted font-medium">Цель:</b> {zText(c.objective)}</p>}
              {zText(c.precondition) && <p className="text-sm text-text-main whitespace-pre-wrap"><b className="text-text-muted font-medium">Предусловие:</b> {zText(c.precondition)}</p>}
              <div className="flex items-center gap-2">
                <p className="text-xs text-text-muted">Клавиши 1 / 2 / 3 — Pass / Fail / Blocked для следующего шага · Ctrl+Enter — сохранить и дальше</p>
                <button type="button" onClick={() => patch({ steps: w.steps.map(() => "Pass") })}
                  className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle">
                  <CheckCheck className="w-3.5 h-3.5 text-green-600" /> Все шаги Pass</button>
              </div>
              {c.steps.length === 0 && <p className="text-sm text-text-muted">У кейса нет шагов — отметьте итог кнопкой «Все шаги Pass» или сохраните с комментарием.</p>}
              <ol className="space-y-2">
                {c.steps.map((s, i) => {
                  const m = w.steps[i];
                  return (
                    <li key={i} className={`rounded-xl border p-3 ${i === nextUnset ? "border-primary/50 ring-1 ring-primary/20" : "border-border-main"}
                      ${m === "Fail" ? "bg-red-50/60 dark:bg-red-950/20" : m === "Pass" ? "bg-green-50/40 dark:bg-green-950/10" : ""}`}>
                      <div className="flex gap-3">
                        <span className="w-6 h-6 flex-shrink-0 rounded-md bg-bg-subtle text-xs font-semibold text-text-muted flex items-center justify-center">{i + 1}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm text-text-main whitespace-pre-wrap">{zText(s.description) || "—"}</p>
                          {zText(s.testData) && <p className="text-xs text-text-muted whitespace-pre-wrap"><b className="font-medium">Данные:</b> {zText(s.testData)}</p>}
                          {zText(s.expectedResult) && <p className="text-xs text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap"><b className="font-medium">Ожидаемо:</b> {zText(s.expectedResult)}</p>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0 self-start" role="group" aria-label={`Шаг ${i + 1}`}>
                          {(Object.keys(MARK_BTN) as Exclude<StepMark, null>[]).map(k => {
                            const b = MARK_BTN[k];
                            return (
                              <button key={k} type="button" onClick={() => mark(i, k)} aria-pressed={m === k} title={`${b.label} (${b.key})`}
                                className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium ${m === k ? b.on : "border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle"}`}>
                                <b.Icon className="w-3.5 h-3.5" /> {b.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {(m === "Fail" || m === "Blocked") && (
                        <div className="mt-2 ml-9 flex items-start gap-2">
                          <input value={w.stepComments[i]} onChange={e => { const sc = [...w.stepComments]; sc[i] = e.target.value; patch({ stepComments: sc }); }}
                            placeholder="Фактический результат" aria-label={`Фактический результат шага ${i + 1}`}
                            className="min-w-0 flex-1 text-sm px-2.5 py-1.5 rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                          {m === "Fail" && (
                            <button type="button" onClick={() => setDefectFor(i)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:opacity-90">
                              <Bug className="w-3.5 h-3.5" /> Завести дефект</button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div>
                <label htmlFor="pl-comment" className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">Комментарий к прохождению</label>
                <textarea id="pl-comment" ref={commentRef} rows={2} value={w.comment} onChange={e => patch({ comment: e.target.value })}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
              </div>
              {w.defects.length > 0 && (
                <div className="flex items-center gap-2 text-xs"><span className="text-text-muted">Дефекты:</span><IssueLinks keys={w.defects} baseUrl={baseUrl} /></div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-3 border-t border-border-main bg-bg-card">
          {saveErr && <p className="text-sm text-red-600 dark:text-red-400 min-w-0 truncate" title={saveErr}>Не сохранилось: {saveErr}</p>}
          {w?.saved && !saveErr && <p className="text-sm text-green-700 dark:text-green-400">Сохранено в Jira: {w.saved}</p>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => idx < items.length - 1 && setIdx(idx + 1)} disabled={idx >= items.length - 1}
              className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main disabled:opacity-40">Пропустить</button>
            <button type="button" onClick={() => save(false)} disabled={!w || saving}
              className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">Сохранить</button>
            <button type="button" onClick={() => save(true)} disabled={!w || saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Сохранить и дальше <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </main>

      {defectFor !== null && defectPrefill && (
        <IssueFormModal open project={project} participants={[]} jiraOnly prefill={defectPrefill}
          onClose={() => setDefectFor(null)}
          onSave={d => { if (d.jira) patch({ defects: [...(w?.defects ?? []), d.jira.key] }); }} />
      )}
    </div>
  );
}
