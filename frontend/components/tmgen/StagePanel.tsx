"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Download, FileText, ListChecks, Loader2, Plus, RefreshCw,
  Send, ShieldCheck, Sparkles, StopCircle, Trash2, Wrench,
} from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";
import PlaceEditor from "./PlaceEditor";
import { useTmGen } from "@/contexts/TmGenContext";
import { SCENARIO_TYPES, TM_RUNNING, TM_STATUS_LABEL, tmStep, type TmPlan, type TmRow, type TmSession } from "@/lib/tmApi";

const CELL = "w-full rounded-md border border-border-main bg-[var(--color-input-bg)] px-1.5 py-1 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const H = "text-xs font-semibold uppercase tracking-wide text-text-muted";
const STEPS = ["Планирование", "Генерация", "Проверка"];

/** Готовый XML: скачать файл или сразу в Zephyr (через предпросмотр структуры). Окна настроек экспорта нет. */
export interface XmlActions {
  busy: "" | "download" | "zephyr";
  error: string;
  download: (ids: string[]) => Promise<void>;
  send: (ids: string[]) => Promise<void>;
}

export function XmlButtons({ ids, xml, size = "md" }: { ids: string[]; xml: XmlActions; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-3 py-1.5" : "px-4 py-2";
  return (
    <>
      <button type="button" disabled={!!xml.busy} onClick={() => void xml.download(ids)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-border-main ${pad} text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40`}>
        {xml.busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Скачать XML</button>
      <button type="button" disabled={!!xml.busy} onClick={() => void xml.send(ids)}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-primary ${pad} text-sm font-semibold text-white disabled:opacity-40`}>
        {xml.busy === "zephyr" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} В Zephyr</button>
    </>
  );
}

/** Шкала этапов: планирование → генерация → проверка (методика Sber911-QA). */
function Stepper({ s }: { s: TmSession }) {
  const at = tmStep(s.status, s.failed_stage);
  const failed = s.status === "error" || s.status === "cancelled";
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((name, i) => {
        const done = at > i, cur = at === i;
        return (
          <li key={name} className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium
              ${done ? "tone-success" : cur ? (failed ? "tone-danger" : "bg-primary/10 text-primary") : "bg-bg-subtle text-text-muted"}`}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : cur && TM_RUNNING.includes(s.status) ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <span className="tabular-nums">{i + 1}</span>}
              {name}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-border-main" />}
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ s }: { s: TmSession }) {
  const p = s.progress;
  const pct = p ? Math.round(((p.current - 1) / Math.max(1, p.total)) * 100) : 0;
  return (
    <div className="space-y-2 rounded-xl border border-border-main bg-bg-card p-4">
      <p className="flex items-center gap-2 text-sm text-text-main"><Loader2 className="h-4 w-4 animate-spin text-primary" />
        {s.status === "planning" ? "Модель разбирает требования: место в дереве, карта сценариев, покрытие, вопросы"
          : s.status === "writing" ? "Кейсы пишутся строго по утверждённой карте"
          : s.status === "fixing" ? "Исправляются согласованные замечания"
          : "Арбитр проверяет набор и пишет документ QA"}</p>
      {p && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="truncate text-xs text-text-muted">{p.current} из {p.total} · {p.name}</p>
        </>
      )}
    </div>
  );
}

/** Карта сценариев с правкой: строки можно менять, удалять и добавлять до утверждения. */
function PlanEditor({ s }: { s: TmSession }) {
  const { approve, cancel } = useTmGen();
  const [plan, setPlan] = useState<TmPlan>(s.plan!);
  const [answers, setAnswers] = useState<Record<string, string>>(s.answers ?? {});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPlan(s.plan!); setAnswers(s.answers ?? {}); }, [s.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const row = (id: string, p: Partial<TmRow>) => setPlan(cur => ({ ...cur, scenarios: cur.scenarios.map(r => (r.id === id ? { ...r, ...p } : r)) }));
  const add = () => setPlan(cur => ({
    ...cur, scenarios: [...cur.scenarios, {
      id: `n${Date.now().toString(36)}`, scenario: cur.scenarios[cur.scenarios.length - 1]?.scenario ?? "", type: SCENARIO_TYPES[0],
      name: `[W][${s.feature}] `, platform: "W", checks: "", steps: 5, critical: false,
    }],
  }));
  const place = plan.place.map(p => p.trim()).filter(Boolean);
  const bad = plan.scenarios.filter(r => !r.name.trim() || !r.scenario.trim());
  const go = async () => {
    setBusy(true);
    try { await approve(s.id, { ...plan, place }, answers); } catch { /* текст ошибки — в шапке */ }
    setBusy(false);
  };
  const crit = plan.scenarios.filter(r => r.critical).length;

  return (
    <div className="space-y-4">
      <section className="space-y-1.5 rounded-xl border border-border-main bg-bg-card p-4">
        <p className={H}>1. Место в дереве</p>
        <PlaceEditor place={plan.place} onChange={p => setPlan(cur => ({ ...cur, place: p }))} />
        {plan.place_note && <p className="flex items-start gap-1.5 text-xs text-text-muted"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{plan.place_note}</p>}
        <p className="text-[11px] text-text-muted">Папки в XML: Новая ТМ / {place.join(" / ") || "…"} / Пользовательский сценарий / Тип сценария</p>
      </section>

      <section className="space-y-2 rounded-xl border border-border-main bg-bg-card p-4">
        <div className="flex items-center gap-2">
          <p className={H}>2. Карта сценариев · {plan.scenarios.length}</p>
          <span className="text-[11px] text-text-muted">крит регресс: {crit}</span>
          <button type="button" onClick={add} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Кейс</button>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[860px] border-separate border-spacing-y-1 text-xs">
            <thead className="text-left text-text-muted">
              <tr>
                <th className="w-[18%] font-medium">Пользовательский сценарий</th>
                <th className="w-[14%] font-medium">Тип</th>
                <th className="w-[30%] font-medium">Кейс</th>
                <th className="w-[6%] font-medium">Платф.</th>
                <th className="font-medium">Что проверяет</th>
                <th className="w-[5%] font-medium">Шагов</th>
                <th className="w-[4%] font-medium" title="Крит регресс">Крит</th>
                <th className="w-[3%]" />
              </tr>
            </thead>
            <tbody>
              {plan.scenarios.map(r => (
                <tr key={r.id} className="align-top">
                  <td className="pr-1"><input value={r.scenario} onChange={e => row(r.id, { scenario: e.target.value.replace(/\//g, "-") })} aria-label="Сценарий" className={CELL} /></td>
                  <td className="pr-1">
                    <select value={r.type} onChange={e => row(r.id, { type: e.target.value })} aria-label="Тип сценария" className={CELL}>
                      {SCENARIO_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="pr-1"><input value={r.name} maxLength={120} onChange={e => row(r.id, { name: e.target.value })} aria-label="Имя кейса" className={CELL} /></td>
                  <td className="pr-1">
                    <select value={r.platform} onChange={e => row(r.id, { platform: e.target.value as "W" | "M" })} aria-label="Платформа" className={CELL}>
                      <option>W</option><option>M</option>
                    </select>
                  </td>
                  <td className="pr-1"><textarea value={r.checks} rows={1} onChange={e => row(r.id, { checks: e.target.value })} aria-label="Что проверяет" className={`${CELL} resize-y`} /></td>
                  <td className="pr-1"><input type="number" min={1} max={12} value={r.steps} onChange={e => row(r.id, { steps: Number(e.target.value) || 1 })} aria-label="Шагов" className={CELL} /></td>
                  <td className="pt-1.5 text-center"><input type="checkbox" checked={r.critical} onChange={e => row(r.id, { critical: e.target.checked })} aria-label="Крит регресс" /></td>
                  <td className="pt-1">
                    <button type="button" onClick={() => setPlan(cur => ({ ...cur, scenarios: cur.scenarios.filter(x => x.id !== r.id) }))}
                      aria-label={`Убрать ${r.name}`} className="rounded p-1 text-text-muted hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {plan.coverage.length > 0 && (
        <section className="space-y-1.5 rounded-xl border border-border-main bg-bg-card p-4">
          <p className={H}>3. Покрытие</p>
          <ul className="space-y-1 text-xs">
            {plan.coverage.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-1/3 flex-shrink-0 text-text-main">{c.item}</span>
                <span className={c.cases.length ? "text-text-muted" : "text-red-500"}>{c.cases.length ? c.cases.join(" · ") : "не покрыто"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-border-main bg-bg-card p-4">
        <p className={H}>4. Вопросы · {plan.questions.length}</p>
        {!plan.questions.length && <p className="text-xs text-text-muted">Вопросов нет.</p>}
        {plan.questions.map(q => (
          <div key={q.id} className="space-y-1">
            <p className="text-sm text-text-main">{q.question}</p>
            {(q.unknown || q.where) && <p className="text-[11px] text-text-muted">{[q.unknown, q.where].filter(Boolean).join(" · ")}</p>}
            <textarea value={answers[q.id] ?? ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} rows={1}
              placeholder="Ответ — без ответа в кейсе останется ⚠" aria-label={`Ответ: ${q.question}`} className={`${CELL} resize-y text-sm`} />
          </div>
        ))}
      </section>

      {plan.contradictions.length > 0 && (
        <section className="space-y-1.5 rounded-xl border border-border-main bg-bg-card p-4">
          <p className={H}>5. Противоречия</p>
          <ul className="space-y-2 text-xs">
            {plan.contradictions.map((c, i) => (
              <li key={i} className="space-y-0.5">
                <p className="text-text-main">Требования: {c.requirement}</p>
                <p className="text-text-main">Дизайн: {c.design}</p>
                <p className="text-text-muted">До ответа: {c.resolution}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {bad.length > 0 && <span className="mr-auto text-xs text-red-500">У {bad.length} строк нет сценария или имени кейса</span>}
        {!place.length && <span className="mr-auto text-xs text-red-500">Укажите место в дереве</span>}
        <button type="button" onClick={() => void cancel(s.id)} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отменить</button>
        <button type="button" disabled={busy || !plan.scenarios.length || bad.length > 0 || !place.length} onClick={go}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Утвердить и сгенерировать
        </button>
      </div>
    </div>
  );
}

/** Итог проверки арбитра: вердикт, замечания с галочками, вопросы, документ QA. */
function ReviewView({ s, onOpenCases }: { s: TmSession; onOpenCases: () => void }) {
  const { fix, recheck, accept } = useTmGen();
  const rev = s.review;
  const open = (rev?.remarks ?? []).filter(r => r.status !== "fixed");
  const fixed = (rev?.remarks ?? []).filter(r => r.status === "fixed");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [docOpen, setDocOpen] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { setSel(new Set()); }, [s.id, rev?.remarks.length, fixed.length]);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch { /* в шапке */ } setBusy(""); };
  const ready = rev?.verdict === "ready" && !open.length;

  return (
    <div className="space-y-4">
      <section className={`flex items-center gap-3 rounded-xl border p-4 ${ready ? "border-emerald-500/40 bg-emerald-500/5" : "border-border-main bg-bg-card"}`}>
        <ShieldCheck className={`h-6 w-6 flex-shrink-0 ${ready ? "text-emerald-500" : "text-primary"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-main">{ready ? "Готово к загрузке" : `Нужны правки: замечаний ${open.length}`}</p>
          <p className="text-xs text-text-muted">Кейсов {s.cases.length} · крит регресс {s.cases.filter(c => c.critical).length}{fixed.length ? ` · исправлено ${fixed.length}` : ""}</p>
        </div>
        <button type="button" onClick={onOpenCases} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
          <ListChecks className="h-4 w-4" /> Кейсы</button>
      </section>

      {open.length > 0 && (
        <section className="space-y-2 rounded-xl border border-border-main bg-bg-card p-4">
          <div className="flex items-center gap-2">
            <p className={H}>Замечания арбитра</p>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
              <input type="checkbox" checked={sel.size === open.length} onChange={() => setSel(sel.size === open.length ? new Set() : new Set(open.map(r => r.id)))} /> Все
            </label>
          </div>
          <ul className="divide-y divide-border-main">
            {open.map(r => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-start gap-2.5 py-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={sel.has(r.id)} aria-label={`Исправить: ${r.what}`}
                    onChange={() => setSel(cur => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-text-main">{r.what}</span>
                    <span className="block text-xs text-text-muted">{r.case ? `Кейс: ${r.case}` : r.where ? `Где: ${r.where}` : ""}</span>
                    <span className="block text-xs text-text-main">Как исправить: {r.fix}{!r.case && <span className="text-text-muted"> · будет новый кейс</span>}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fixed.length > 0 && (
        <details className="rounded-xl border border-border-main bg-bg-card p-4 text-sm">
          <summary className="cursor-pointer text-text-muted">Исправлено · {fixed.length}</summary>
          <ul className="mt-2 space-y-1 text-xs text-text-muted">{fixed.map(r => <li key={r.id} className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />{r.what}</li>)}</ul>
        </details>
      )}

      {(rev?.questions.length ?? 0) > 0 && (
        <section className="space-y-1.5 rounded-xl border border-border-main bg-bg-card p-4">
          <p className={H}>Вопросы к аналитику</p>
          <ul className="space-y-1 text-sm">
            {rev!.questions.map((q, i) => (
              <li key={i} className="flex gap-2"><span className="text-text-main">{q.question}</span>{q.priority && <span className="flex-shrink-0 text-xs text-text-muted">{q.priority}</span>}</li>
            ))}
          </ul>
        </section>
      )}

      {s.qa_doc && (
        <section className="overflow-hidden rounded-xl border border-border-main bg-bg-card">
          <button type="button" onClick={() => setDocOpen(v => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-text-main hover:bg-bg-subtle/70">
            <FileText className="h-4 w-4 text-primary" /> Документ QA
            <ChevronDown className={`ml-auto h-4 w-4 text-text-muted transition-transform ${docOpen ? "rotate-180" : ""}`} />
          </button>
          {docOpen && <div className="max-h-[50vh] overflow-y-auto border-t border-border-main px-5 py-4 scrollbar-thin"><NotionRenderer text={s.qa_doc} /></div>}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" disabled={!!busy} onClick={() => run("recheck", () => recheck(s.id))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
          <RefreshCw className="h-4 w-4" /> Проверить ещё раз</button>
        {open.length > 0 && (
          <button type="button" disabled={!!busy || !sel.size} onClick={() => run("fix", () => fix(s.id, [...sel]))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-40">
            <Wrench className="h-4 w-4" /> Исправить отмеченные{sel.size ? ` (${sel.size})` : ""}</button>
        )}
        <button type="button" disabled={!!busy} onClick={() => run("accept", () => accept(s.id))}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
          <CheckCircle2 className="h-4 w-4" /> Принять набор</button>
      </div>
    </div>
  );
}

/**
 * Правая зона генерации: этапы одной сессии тестовой модели. Готовый (принятый) набор открывается прежним
 * экраном результата — там кейсы, эталон и экспорт.
 */
export default function StagePanel({ session: s, onOpenCases, xml }: { session: TmSession; onOpenCases: (id: string) => void; xml: XmlActions }) {
  const { cancel, retry, error } = useTmGen();
  const running = TM_RUNNING.includes(s.status);
  return (
    <div className="space-y-4 p-6 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-text-main">{s.task ? `${s.task.key} · ` : ""}{s.feature}</h1>
          <p className="text-xs text-text-muted">{TM_STATUS_LABEL[s.status]}{s.place.length ? ` · ${s.place.join(" / ")}` : ""}</p>
        </div>
        {running && (
          <button type="button" onClick={() => void cancel(s.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40">
            <StopCircle className="h-4 w-4" /> Остановить</button>
        )}
      </div>
      <Stepper s={s} />
      {error && <p className="flex items-center gap-1.5 text-sm text-red-500"><AlertCircle className="h-4 w-4" />{error}</p>}

      {running && <Progress s={s} />}
      {running && s.cases.length > 0 && (
        <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
          {s.cases.map((c, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-border-main bg-bg-card px-3 py-2 text-sm">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
              <span className="truncate text-text-main">{c.name}</span>
              <span className="ml-auto flex-shrink-0 text-xs text-text-muted">{c.steps.length} шаг.</span>
            </li>
          ))}
        </ul>
      )}
      {s.status === "plan_ready" && s.plan && <PlanEditor s={s} />}
      {s.status === "review_ready" && <ReviewView s={s} onOpenCases={() => onOpenCases(s.id)} />}
      {s.status === "done" && (
        <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-main">Набор принят: кейсов {s.cases.length}</p>
              <p className="text-xs text-text-muted">XML собран из кейсов: папки, АС, метки и крит уже в нём. «В Zephyr» сначала покажет, куда лягут кейсы{s.task ? ", и создаст прогон задачи" : ""}.</p>
            </div>
            <button type="button" onClick={() => onOpenCases(s.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-4 py-2 text-sm text-text-main hover:bg-bg-subtle">
              <ListChecks className="h-4 w-4" /> Кейсы</button>
            <XmlButtons ids={[s.id]} xml={xml} />
          </div>
          {xml.error && <p className="text-sm text-red-500">{xml.error}</p>}
        </div>
      )}
      {(s.status === "error" || s.status === "cancelled") && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <p className="flex-1 text-sm text-text-main">{s.error || "Этап не завершён"}</p>
          <button type="button" onClick={() => void retry(s.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle">
            <RefreshCw className="h-4 w-4" /> Повторить</button>
        </div>
      )}
    </div>
  );
}
