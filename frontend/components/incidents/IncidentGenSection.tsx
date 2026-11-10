"use client";

import { useSplitView } from "@/contexts/WorkspaceContext";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, Eye, History, Loader2, Pencil, Plus, Send, Settings2, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import NotionRenderer from "@/components/NotionRenderer";
import IncidentGenSettings from "@/components/incidents/IncidentGenSettings";
import ScenarioIcon from "@/components/incidents/ScenarioIcon";
import ServiceDialog from "@/components/incidents/ServiceDialog";
import { BTN, BTN_PRIMARY, INPUT } from "@/components/incidents/ui";
import {
  clearIncHistory, deleteIncService, getIncCatalog, getIncHistory, getIncState, previewIncPackage, sendIncPackage,
  type IncCatalog, type IncPackage, type IncPreviewItem, type IncPriority, type IncResult, type IncRun, type IncService, type IncState,
} from "@/lib/incidentGenApi";

const PRIORITY: Record<IncPriority, string> = { LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", CRITICAL: "Критический" };

/** Результат отправки: по каждому инциденту — номер, сценарий, смещение в Kafka или ошибка, инструкция. */
function ResultTable({ results }: { results: IncResult[] }) {
  const [copied, setCopied] = useState(false);
  const ok = results.filter(r => !r.error);
  const copy = async () => {
    try { await navigator.clipboard.writeText(ok.map(r => r.inc).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* браузер не дал доступ к буферу */ }
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className="text-green-700 dark:text-green-400">Отправлено: {ok.length}</span>
        {results.length > ok.length && <span className="text-red-600 dark:text-red-400">Ошибок: {results.length - ok.length}</span>}
        <span className="flex-1" />
        {ok.length > 0 && <button type="button" className={BTN} onClick={() => void copy()}>
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />} Номера INC</button>}
      </div>
      <div className="max-h-[360px] overflow-auto scrollbar-thin rounded-lg border border-border-main">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
            <tr><th className="text-left px-3 py-2">Инцидент</th><th className="text-left px-3 py-2">КЭ</th>
              <th className="text-left px-3 py-2">Kafka</th><th className="text-left px-3 py-2">Инструкция</th></tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-border-main align-top">
                <td className="px-3 py-1.5"><span className="font-mono text-xs text-primary">{r.inc}</span>
                  {!r.main && <span className="ml-1.5 text-[10px] text-text-muted">другой на АС</span>}
                  <span className="block text-xs text-text-muted truncate max-w-[380px]" title={r.title}>{r.title}</span></td>
                <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{r.ci}</td>
                <td className="px-3 py-1.5 text-xs">{r.error ? <span className="text-red-600 dark:text-red-400">{r.error}</span>
                  : <span className="text-text-muted">p{r.partition} · offset {r.offset}</span>}</td>
                <td className="px-3 py-1.5 text-xs">{!r.hasInstruction ? <span className="text-text-muted">—</span>
                  : r.instruction_id ? <span className="text-green-700 dark:text-green-400">id {r.instruction_id}</span>
                  : <span className="text-amber-700 dark:text-amber-300">{r.instruction_error || "не записана"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Что уйдёт: заголовок, текст описания, инструкция и JSON сообщения. */
function PreviewList({ items }: { items: IncPreviewItem[] }) {
  return (
    <div className="max-h-[70vh] overflow-y-auto scrollbar-thin space-y-3 pr-1">
      <p className="text-xs text-text-muted">Пример: при отправке тексты выберутся заново из событий сценария, время — момент отправки.
        Основные инциденты — первыми, за ними другие инциденты по той же АС.</p>
      {items.map((it, i) => (
        <details key={i} className="rounded-lg border border-border-main" open={items.length === 1 || i === 0}>
          <summary className="cursor-pointer px-3 py-2 text-sm">
            <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${it.main ? "bg-primary/10 text-primary" : "bg-bg-subtle text-text-muted"}`}>
              {it.main ? "основной" : "другой на АС"}</span>
            <span className="font-mono text-xs text-primary">{it.ci}</span> · {String(it.message.title)}
            <span className="text-text-muted"> · {String(it.message.priorityCode)}</span>
          </summary>
          <pre className="mx-3 mb-2 whitespace-pre-wrap rounded-lg bg-bg-subtle p-3 text-xs leading-relaxed font-sans">{String(it.message.description)}</pre>
          {it.instruction && <div className="border-t border-border-main px-3 py-2"><p className="text-xs font-semibold text-text-muted mb-1">Инструкция</p><NotionRenderer text={it.instruction} /></div>}
          <details className="border-t border-border-main px-3 py-2">
            <summary className="cursor-pointer text-xs text-text-muted">Сообщение Sber ESM (JSON)</summary>
            <pre className="mt-2 text-[11px] leading-relaxed overflow-x-auto">{JSON.stringify(it.message, null, 2)}</pre>
          </details>
        </details>
      ))}
    </div>
  );
}

const FORM_KEY = "st_incident_form";   // сценарий и строки КЭ — черновик одного браузера

/** Строка КЭ: count 0 — КЭ не регистрируется; priority "" и instruction null — как в сценарии. */
interface KeRow { count: number; priority: IncPriority | ""; instruction: boolean | null }
interface Form { scenario: string; rows: Record<string, KeRow> }
const NO_ROW: KeRow = { count: 0, priority: "", instruction: null };

const STEP = "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted";
const NUM = "inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary";

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

/** Есть ли на стенде логи / метрики по КЭ — маленькая метка. */
function Flag({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${value
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
      {value ? label : `без ${label.toLowerCase()}`}
    </span>
  );
}

function extraText(e: [number, number]) {
  return e[1] === 0 ? "без других на АС" : e[0] === e[1] ? `+${e[0]} на АС` : `+${e[0]}–${e[1]} на АС`;
}

/**
 * Генератор инцидентов: сценарий (15 готовых наборов) → у каждой КЭ (встроенные и свои) — сколько инцидентов, приоритет
 * и инструкция. Пусто в «Инцидентов» — КЭ не регистрируется.
 * Текст каждого инцидента сервер выбирает случайно из событий сценария, время — момент отправки; рядом с основным
 * регистрируются другие инциденты по той же АС, как в ноутбуке test_incident_pakage_generator. Отправка — сообщениями
 * Sber ESM в Kafka; подключение и SQL инструкций — «Настройки».
 */
export default function IncidentGenSection() {
  const split = useSplitView();
  const [cat, setCat] = useState<IncCatalog | null>(null);
  const [st, setSt] = useState<IncState | null>(null);
  const [form, setFormState] = useState<Form | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [preview, setPreview] = useState<IncPreviewItem[] | null>(null);
  const [run, setRun] = useState<IncRun | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<IncRun[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [svcDialog, setSvcDialog] = useState<{ editing: IncService | null } | null>(null);

  const setForm = (p: Partial<Form>) => setFormState(prev => {
    if (!prev) return prev;
    const v = { ...prev, ...p };
    try { localStorage.setItem(FORM_KEY, JSON.stringify(v)); } catch { /* приватный режим */ }
    return v;
  });
  const load = useCallback(() => {
    getIncState().then(setSt, e => setErr((e as Error).message));
    getIncCatalog().then(c => {
      setCat(c);
      let saved: Partial<Form> = {};
      try { saved = JSON.parse(localStorage.getItem(FORM_KEY) || "{}"); } catch { /* черновика нет */ }
      const known = new Set(c.services.map(s => s.ci));
      const rows: Record<string, KeRow> = {};
      for (const [ci, r] of Object.entries(saved.rows ?? {})) {
        if (known.has(ci)) rows[ci] = { count: Math.min(20, Math.max(0, Number(r.count) || 0)), priority: r.priority ?? "", instruction: r.instruction ?? null };
      }
      if (!Object.values(rows).some(r => r.count > 0)) rows[c.services[0].ci] = { ...NO_ROW, ...rows[c.services[0].ci], count: 1 };
      setFormState({ scenario: c.scenarios.some(s => s.id === saved.scenario) ? saved.scenario! : c.scenarios[0].id, rows });
    }, e => setErr((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (historyOpen) getIncHistory().then(r => setHistory(r.history), e => setErr((e as Error).message)); }, [historyOpen]);

  if (!cat || !st || !form) return (
    <div className="flex items-center justify-center h-full">
      {err ? <p className="text-sm text-red-600">{err}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" />}
    </div>
  );

  const sc = cat.scenarios.find(s => s.id === form.scenario) ?? cat.scenarios[0];
  const rowOf = (ci: string): KeRow => form.rows[ci] ?? NO_ROW;
  const active = cat.services.filter(s => rowOf(s.ci).count > 0);
  const mainTotal = active.reduce((n, s) => n + rowOf(s.ci).count, 0);
  const minTotal = mainTotal + active.length * sc.extra[0], maxTotal = mainTotal + active.length * sc.extra[1];
  const wantInstr = active.some(s => rowOf(s.ci).instruction ?? sc.instruction);
  const pkg: IncPackage = {
    scenario: sc.id,
    items: active.map(s => {
      const r = rowOf(s.ci);
      return { ci: s.ci, count: r.count, priority: r.priority || null, instruction: r.instruction };
    }),
  };

  const patchRow = (ci: string, p: Partial<KeRow>) => setForm({ rows: { ...form.rows, [ci]: { ...rowOf(ci), ...p } } });

  const doPreview = async () => {
    setBusy("preview"); setErr("");
    try { setPreview((await previewIncPackage(pkg)).items); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const doSend = async () => {
    const total = minTotal === maxTotal ? `${minTotal}` : `${minTotal}–${maxTotal}`;
    if (!confirm(`Зарегистрировать в Sber911 инцидентов: ${total} на ${active.length} ${plural(active.length, "КЭ", "КЭ", "КЭ")} (сценарий «${sc.name}») через топик ${st.settings.topic}?`)) return;
    setBusy("send"); setErr(""); setRun(null);
    try { setRun(await sendIncPackage(pkg)); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const removeService = async (s: IncService) => {
    if (!confirm(`Удалить КЭ ${s.ci}${s.name !== s.ci ? ` «${s.name}»` : ""} из списка? Инциденты в Sber911 останутся.`)) return;
    try {
      const r = await deleteIncService(s.ci);
      setCat({ ...cat, services: r.services });
      const rows = { ...form.rows }; delete rows[s.ci];
      setForm({ rows });
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <p className="text-sm text-text-muted">Выберите сценарий и укажите у КЭ, сколько инцидентов завести. Регистрируются по-настоящему
            (топик <code className="font-mono">{st.settings.topic}</code>).</p>
          <span className="flex-1" />
          <button type="button" className={BTN} onClick={() => setHistoryOpen(true)}><History className="w-4 h-4" /> История</button>
          <button type="button" className={BTN} onClick={() => setSettingsOpen(true)}><Settings2 className="w-4 h-4" /> Настройки</button>
        </div>
        {err && <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}</p>}

        {/* Зона одна — результат отправки сбоку, зон две — под формой */}
        <div className={run && !split ? "grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-4" : "space-y-4"}>
        <div className="space-y-4">
        <section className="rounded-xl border border-border-main bg-bg-card p-4" aria-labelledby="inc-step-1">
          <h3 id="inc-step-1" className={STEP}><span className={NUM}>1</span> Сценарий
            <span className="font-normal normal-case tracking-normal">· {cat.scenarios.length} готовых</span></h3>
          <div role="radiogroup" aria-labelledby="inc-step-1" className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
            {cat.scenarios.map(s => {
              const on = s.id === sc.id;
              return (
                <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => setForm({ scenario: s.id })}
                  className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                    ${on ? "border-primary bg-primary/5" : "border-border-main hover:border-primary/40 hover:bg-bg-subtle"}`}>
                  <ScenarioIcon name={s.icon} active={on} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight text-text-main">{s.name}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-text-muted line-clamp-2" title={s.short}>{s.short}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-text-muted">По умолчанию:</span>
            <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-text-main">{PRIORITY[sc.priority]} приоритет</span>
            <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-text-main">{sc.instruction ? "с инструкцией" : "без инструкции"}</span>
            <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-text-main">{extraText(sc.extra)}</span>
            {sc.large_scale && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950/40 dark:text-red-300">массовый</span>}
            {sc.potential_vpi && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">потенциальный ВПИ</span>}
            <button type="button" onClick={() => void doPreview()} disabled={!active.length || !!busy}
              className="ml-1 inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50">
              <Eye className="h-3.5 w-3.5" /> пример текста</button>
          </div>
        </section>

        <section className="rounded-xl border border-border-main bg-bg-card p-4" aria-labelledby="inc-step-2">
          <div className="flex items-center gap-2">
            <h3 id="inc-step-2" className={STEP}><span className={NUM}>2</span> КЭ
              <span className="font-normal normal-case tracking-normal">· пусто в «Инцидентов» — КЭ не регистрируется</span></h3>
            <span className="flex-1" />
            <button type="button" className={BTN} onClick={() => setSvcDialog({ editing: null })}><Plus className="w-4 h-4" /> Своя КЭ</button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border-main">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">КЭ</th>
                  <th className="w-[96px] px-2 py-2 text-left font-semibold">Инцидентов</th>
                  <th className="w-[170px] px-2 py-2 text-left font-semibold">Приоритет</th>
                  <th className="w-[96px] px-2 py-2 text-center font-semibold">Инструкция</th>
                  <th className="w-[64px] px-2 py-2" aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {cat.services.map(s => {
                  const r = rowOf(s.ci);
                  const on = r.count > 0;
                  const instr = r.instruction ?? sc.instruction;
                  return (
                    <tr key={s.ci} className={`border-t border-border-main ${on ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex-none font-mono text-xs text-primary">{s.ci}</span>
                          <span className={`min-w-0 truncate ${on ? "text-text-main" : "text-text-muted"}`} title={s.name}>{s.name}</span>
                          <span className="flex flex-none items-center gap-1">
                            <Flag label="Логи" value={s.logs} /><Flag label="Метрики" value={s.metrics} />
                            {s.custom && <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-text-muted">своя</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min={0} max={20} inputMode="numeric" placeholder="—" aria-label={`Инцидентов на ${s.ci}`}
                          value={r.count || ""} onChange={e => patchRow(s.ci, { count: Math.min(20, Math.max(0, Number(e.target.value) || 0)) })}
                          className={`${INPUT} py-1 text-center`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={r.priority} aria-label={`Приоритет, ${s.ci}`} disabled={!on} title={r.priority ? undefined : "Как в сценарии"}
                          onChange={e => patchRow(s.ci, { priority: e.target.value as IncPriority | "" })} className={`${INPUT} py-1 disabled:opacity-50`}>
                          <option value="">{PRIORITY[sc.priority]}</option>
                          {cat.priorities.map(p => <option key={p} value={p}>{PRIORITY[p]}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={instr} disabled={!on} aria-label={`Инструкция, ${s.ci}`}
                          title={r.instruction === null ? "Как в сценарии" : undefined}
                          onChange={e => patchRow(s.ci, { instruction: e.target.checked })}
                          className="h-4 w-4 accent-[var(--color-primary)] disabled:opacity-40" />
                      </td>
                      <td className="px-2 py-1.5">
                        {s.custom && (
                          <span className="flex justify-end gap-0.5">
                            <button type="button" title="Изменить" aria-label={`Изменить КЭ ${s.ci}`} onClick={() => setSvcDialog({ editing: s })}
                              className="rounded p-1.5 text-text-muted hover:bg-bg-subtle hover:text-text-main"><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" title="Удалить" aria-label={`Удалить КЭ ${s.ci}`} onClick={() => void removeService(s)}
                              className="rounded p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">Логи и метрики — то, что есть на стенде по КЭ. Проверяете «без логов» — берите КЭ без логов.
            Рядом с каждым основным инцидентом сценарий заводит {extraText(sc.extra).replace("+", "")} — другие инциденты по той же АС.</p>
        </section>

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-border-main bg-bg-card px-4 py-3 shadow-sm">
          <ScenarioIcon name={sc.icon} active />
          <div className="min-w-0 flex-1 basis-[280px] text-sm">
            <p className="font-medium text-text-main">{sc.name}</p>
            <p className="text-xs text-text-muted">
              {active.length ? <>Основных: {mainTotal} на {active.length} {plural(active.length, "КЭ", "КЭ", "КЭ")}
                {sc.extra[1] > 0 && <>, других на АС: {sc.extra[0] === sc.extra[1] ? sc.extra[0] : `${sc.extra[0]}–${sc.extra[1]}`} на каждую</>}
                {" "}· всего {minTotal === maxTotal ? minTotal : `${minTotal}–${maxTotal}`}</> : "Укажите количество инцидентов хотя бы у одной КЭ"}
            </p>
            {wantInstr && st.instructionsBlocked && (
              <p className="text-xs text-amber-700 dark:text-amber-300">Инструкции не запишутся: {st.instructionsBlocked} — задать в «Настройках».</p>
            )}
          </div>
          <button type="button" className={BTN} disabled={!active.length || !!busy} onClick={() => void doPreview()}>
            {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Пример</button>
          <button type="button" className={BTN_PRIMARY} disabled={!active.length || !!busy} onClick={() => void doSend()}>
            {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {busy === "send" ? "Отправляю…" : "Отправить"}</button>
        </div>
        </div>

        {run && (
          <section className="rounded-xl border border-border-main bg-bg-card p-4">
            <h3 className="text-sm font-semibold text-text-main mb-3">Результат · {run.preset || "отправка"}</h3>
            <ResultTable results={run.results} />
          </section>
        )}
        </div>
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Пример · ${preview?.length ?? 0}`} size="max-w-4xl">
        {preview && <PreviewList items={preview} />}
      </Modal>
      <ServiceDialog open={!!svcDialog} editing={svcDialog?.editing ?? null} crits={cat.crits} onClose={() => setSvcDialog(null)}
        onSaved={(services, ci) => {
          const was = svcDialog?.editing?.ci;
          setCat({ ...cat, services });
          const rows = { ...form.rows };
          const prev = was ? rows[was] : undefined;
          if (was) delete rows[was];
          rows[ci] = prev ?? { ...NO_ROW, count: 1 };
          setForm({ rows });
          setSvcDialog(null);
        }} />
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Генератор инцидентов — настройки" size="max-w-3xl">
        <div className="max-h-[75vh] overflow-y-auto scrollbar-thin pr-1">
          <IncidentGenSettings initial={st.settings} onSaved={(settings, instructionsBlocked) => setSt({ ...st, settings, instructionsBlocked })} />
        </div>
      </Modal>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="История отправок" size="max-w-4xl">
        <div className="max-h-[75vh] overflow-y-auto scrollbar-thin space-y-2 pr-1">
          {history === null ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : !history.length ? <p className="text-sm text-text-muted">Отправок ещё не было.</p> : (
            <>
              <div className="flex justify-end">
                <button type="button" className={`${BTN} text-red-500`}
                  onClick={() => { if (confirm("Очистить историю отправок? Инциденты в Sber911 останутся.")) void clearIncHistory().then(r => setHistory(r.history)); }}>
                  <Trash2 className="w-4 h-4" /> Очистить</button>
              </div>
              {history.map(h => {
                const ok = h.results.filter(r => !r.error).length;
                return (
                  <div key={h.id} className="rounded-xl border border-border-main p-3">
                    <button type="button" onClick={() => setOpenRun(o => (o === h.id ? null : h.id))} aria-expanded={openRun === h.id}
                      className="w-full flex items-center gap-3 text-left text-sm">
                      <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${openRun === h.id ? "rotate-90" : ""}`} />
                      <span>{new Date(h.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
                      {h.preset && <span className="font-medium text-text-main truncate">{h.preset}</span>}
                      <span className="text-text-muted truncate">· {h.cis.join(", ")}</span>
                      <span className="flex-1" />
                      <span className="text-green-700 dark:text-green-400">{ok}</span>
                      {ok < h.results.length && <span className="text-red-600 dark:text-red-400">· ошибок {h.results.length - ok}</span>}
                    </button>
                    {openRun === h.id && <div className="mt-3"><ResultTable results={h.results} /></div>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
