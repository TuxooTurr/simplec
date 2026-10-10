"use client";

/**
 * Веб-коннекторы: подключение к ресурсу + записанные операции.
 *
 * Как это работает для человека:
 *   1. Коннектор: название, адрес и способ входа — вручную (SSO, 2FA) или логином и
 *      паролем техучётки (пароль хранится зашифрованным, в интерфейс не возвращается).
 *   2. «Записать операцию» — окно Chrome: входите и делаете, что нужно. SimpleTest
 *      записывает шаги и запросы сайта. Пароль не записывается; форма входа запоминается.
 *   3. Мастер: что делает операция (данные с сайта или повтор действий), какие из
 *      введённых значений — параметры, какой нужен результат. Сохранить.
 *   4. Запуск: вводите параметры — операция повторяется под вашей сессией.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Circle, ExternalLink, Globe, KeyRound, Loader2, LogIn, MousePointerClick, Pencil, Play, Plus,
  Radio, Server, Star, Trash2, X,
} from "lucide-react";
import ErrorGroups from "@/components/logs/ErrorGroups";
import {
  closeWindow, deleteConnector, deleteScenario, lastRecording, listWeb, makeDraft, openWindow, runScenario,
  saveConnector, saveScenario, windowState,
  type Connector, type ConnectorInput, type DraftParam, type OpOutput, type ParamDef, type RecResponse,
  type RecStep, type RequestTemplate, type RunResult, type Scenario, type WindowState, WebApiError,
} from "@/lib/webconnectApi";

const INPUT = "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
const LABEL = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";
const CARD = "bg-bg-card border border-border-main rounded-xl p-4";
const MINUTES = [5, 10, 15, 30, 60];

const VAR_RE = /(\{[a-z][a-z0-9_]*\})/g;
// Отдельный неглобальный — у глобального test() сдвигает lastIndex между вызовами.
const IS_VAR = /^\{[a-z][a-z0-9_]*\}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Переменные шаблона подсвечены — видно, что будет подставляться. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(VAR_RE).map((part, i) => IS_VAR.test(part)
        ? <mark key={i} className="bg-primary/15 text-primary rounded px-0.5">{part}</mark>
        : <span key={i}>{part}</span>)}
    </>
  );
}

/** Красивый JSON с сохранением переменных: строковые ("{service}") остаются в кавычках,
 *  числовые ({from_ms}) — без, как в настоящем теле запроса. */
function prettyKeepVars(body?: string | null): string {
  if (!body) return "";
  const vars: string[] = [];
  const keep = (v: string) => { vars.push(v); return vars.length - 1; };
  const masked = body
    .replace(/"(\{[a-z][a-z0-9_]*\})"/g, (_, v) => `"__Q${keep(v)}__"`)
    .replace(VAR_RE, (v) => `"__U${keep(v)}__"`);
  try {
    return JSON.stringify(JSON.parse(masked), null, 2)
      .replace(/"__Q(\d+)__"/g, (_, i) => `"${vars[+i]}"`)
      .replace(/"__U(\d+)__"/g, (_, i) => vars[+i]);
  } catch { return body; }
}

function host(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function pathOf(url: string): string {
  try { const u = new URL(url); return u.pathname + (u.search ? "?…" : ""); } catch { return url; }
}

function stepText(s: RecStep): string {
  switch (s.type) {
    case "goto":  return `Переход: ${pathOf(s.url ?? "")}`;
    case "click": return `Клик: ${s.text || s.selector}`;
    case "fill":  return s.secret ? `Ввод пароля в ${s.selector} (не записан)` : `Ввод «${s.value}» в ${s.selector}`;
    case "press": return `Enter в ${s.selector}`;
  }
}

function templateStepText(s: RecStep): string {
  switch (s.type) {
    case "goto":  return `Открыть ${s.url}`;
    case "click": return `Нажать ${s.text ? `«${s.text}»` : s.selector}`;
    case "fill":  return `Ввести ${s.value} в ${s.selector}`;
    case "press": return `Enter в ${s.selector}`;
  }
}

function opTemplate(s: Scenario): RequestTemplate {
  const found = {};
  if (s.kind === "k8s_logs") return { kind: "k8s_logs", namespace: s.namespace, container: s.container ?? "", found };
  if (s.kind === "steps") return { kind: "steps", start_url: s.start_url, steps: s.steps, found };
  return { kind: "request", ...s.request, found } as RequestTemplate;
}

const KIND_LABEL: Record<Scenario["kind"], string> = { request: "Данные с сайта", k8s_logs: "Логи OpenShift", steps: "Повтор действий" };
const OUTPUT_LABEL: Record<OpOutput, string> = { logs: "разбор ошибок", data: "данные", text: "текст и скриншот" };

// ── Мастер операции после записи ─────────────────────────────────────────────

interface Candidate { value: string; on: boolean; name: string; label: string }

function suggestName(i: number): string { return i === 0 ? "service" : `param${i + 1}`; }

function OperationWizard({ connector, steps, responses, loginEnd, onDone, onCancel }: {
  connector: Connector; steps: RecStep[]; responses: RecResponse[]; loginEnd: number;
  onDone: () => void; onCancel: () => void;
}) {
  const best = responses[0];
  const [mode, setMode] = useState<"request" | "steps">(responses.length ? "request" : "steps");
  const [chosen, setChosen] = useState<number | null>(best && best.likeness >= 40 ? best.id : null);
  const [startIndex, setStartIndex] = useState(loginEnd);
  const [extractSelector, setExtractSelector] = useState("");

  // Кандидаты в параметры — значения, которые человек вводил (кроме логина на форме входа).
  const [cands, setCands] = useState<Candidate[]>(() => {
    const vals: string[] = [];
    steps.forEach((s, i) => {
      if (s.type === "fill" && !s.secret && s.value && i >= loginEnd && !vals.includes(s.value)) vals.push(s.value);
    });
    return vals.map((v, i) => ({ value: v, on: i === vals.length - 1, name: suggestName(i), label: i === 0 ? "Сервис" : "Параметр" }));
  });
  const [extra, setExtra] = useState("");

  const [output, setOutput] = useState<OpOutput>(responses.length && best?.likeness >= 50 ? "logs" : responses.length ? "data" : "text");
  const [draft, setDraft] = useState<{ template: RequestTemplate; note: string; warnings: string[] } | null>(null);
  const [name, setName] = useState("");
  const [logSource, setLogSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const params: DraftParam[] = cands.filter(c => c.on).map(c => ({ name: c.name.trim(), label: c.label.trim() || c.name, value: c.value }));
  const badName = params.find(p => !NAME_RE.test(p.name)) ?? null;

  const updateCand = (i: number, patch: Partial<Candidate>) => {
    setCands(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c));
    setDraft(null);
  };

  const switchMode = (m: "request" | "steps") => {
    setMode(m); setDraft(null);
    setOutput(m === "steps" ? "text" : (responses.find(r => r.id === chosen)?.likeness ?? 0) >= 50 ? "logs" : "data");
  };

  const build = async () => {
    if (mode === "request" && chosen === null) return;
    setBusy(true); setErr("");
    try {
      const d = await makeDraft(connector.id, { mode, response_id: chosen, params, start_index: startIndex });
      setDraft(d);
      if (!name) setName(params[0]?.label ? `${KIND_LABEL[d.template.kind]} · ${params.map(p => p.label).join(", ")}` : KIND_LABEL[d.template.kind]);
    } catch (e) { setErr((e as Error).message); setDraft(null); }
    setBusy(false);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true); setErr("");
    try {
      await saveScenario({
        connector_id: connector.id, name: name.trim(), template: draft.template, steps,
        params: params.map(p => ({ name: p.name, label: p.label, default: p.value })),
        output: draft.template.kind === "k8s_logs" ? "logs" : output,
        extract_selector: extractSelector, log_source: logSource && output === "logs",
      });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className={`${CARD} space-y-5 border-primary/30`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-main">Новая операция из записи</h3>
        <button type="button" onClick={onCancel} aria-label="Закрыть мастер" className="p-1 rounded text-text-muted hover:text-text-main">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 1. Вид операции */}
      <div>
        <p className={LABEL}>1. Что делает операция</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Вид операции">
          {([
            ["request", Server, "Получает данные с сайта", "Повторяет запрос, которым сайт загрузил данные. Надёжно: не зависит от вёрстки."],
            ["steps", MousePointerClick, "Повторяет действия", "Открыть страницу, ввести, нажать, забрать текст. Для сайтов без удобного запроса."],
          ] as const).map(([id, Icon, title, text]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => switchMode(id)}
              className={`text-left flex gap-3 p-3 rounded-lg border transition-colors ${
                mode === id ? "border-primary/50 bg-[var(--color-active-bg)]" : "border-border-main hover:border-primary/30"}`}>
              <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${mode === id ? "text-primary" : "text-text-muted"}`} />
              <span>
                <span className="block text-sm font-medium text-text-main">{title}</span>
                <span className="block text-xs text-text-muted mt-0.5">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Источник */}
      {mode === "request" ? (
        <div>
          <p className={LABEL}>2. Где лежат данные</p>
          {responses.length === 0 ? (
            <p className="text-sm text-text-muted">Сайт не сделал ни одного запроса за данными — выберите «Повторяет действия».</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-thin pr-1" role="radiogroup" aria-label="Источник данных">
              {responses.slice(0, 20).map(r => (
                <button key={r.id} type="button" role="radio" aria-checked={chosen === r.id}
                  onClick={() => { setChosen(r.id); setDraft(null); setOutput(r.likeness >= 50 ? "logs" : "data"); }}
                  className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${
                    chosen === r.id ? "border-primary/50 bg-[var(--color-active-bg)]" : "border-border-main hover:border-primary/30"}`}>
                  {chosen === r.id ? <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" /> : <Circle className="w-4 h-4 text-text-muted flex-shrink-0" />}
                  <span className="text-[11px] font-mono font-semibold text-text-muted w-12 flex-shrink-0">{r.kind === "download" ? "ФАЙЛ" : r.method}</span>
                  <span className="flex-1 min-w-0 text-xs font-mono text-text-main truncate" title={r.url}>
                    {r.kind === "download" ? r.filename : pathOf(r.url)}
                  </span>
                  <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0">{Math.max(1, Math.round(r.size / 1024))} КБ</span>
                  {r.likeness >= 50 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300 flex-shrink-0">
                      похоже на логи
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {chosen !== null && (
            <pre className="mt-2 text-[10px] leading-4 font-mono whitespace-pre-wrap break-all text-text-muted bg-bg-subtle
              border border-border-main rounded-lg px-3 py-2 max-h-28 overflow-y-auto scrollbar-thin">
              {responses.find(r => r.id === chosen)?.preview || "— пусто —"}
            </pre>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className={LABEL}>2. С какого шага начинать</p>
            {loginEnd > 0 && <p className="text-xs text-text-muted mb-1.5">Шаги входа (1–{loginEnd}) пропущены: вход делает сессия или логин техучётки.</p>}
            <ol className="space-y-0.5 max-h-56 overflow-y-auto scrollbar-thin pr-1" role="radiogroup" aria-label="Начальный шаг">
              {steps.map((s, i) => (
                <li key={i}>
                  <button type="button" role="radio" aria-checked={startIndex === i} onClick={() => { setStartIndex(i); setDraft(null); }}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-1 rounded-md text-xs transition-colors ${
                      startIndex === i ? "bg-[var(--color-active-bg)] text-primary" : i < startIndex ? "text-text-muted/50" : "text-text-main hover:bg-bg-subtle"}`}>
                    <span className="tabular-nums w-5 text-right text-text-muted">{i + 1}</span>
                    <span className="truncate">{stepText(s)}</span>
                    {startIndex === i && <span className="ml-auto text-[10px] flex-shrink-0">← отсюда</span>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <label htmlFor="wz-extract" className={LABEL}>Что вернуть</label>
            <input id="wz-extract" value={extractSelector} onChange={e => setExtractSelector(e.target.value)}
              placeholder="CSS-элемент с результатом, например #status. Пусто — весь текст страницы" className={INPUT} />
          </div>
        </div>
      )}

      {/* 3. Параметры */}
      <div>
        <p className={LABEL}>3. Параметры — что меняется при каждом запуске</p>
        {cands.length === 0 && <p className="text-xs text-text-muted mb-2">При записи вы ничего не вводили. Значение из адреса или запроса можно добавить вручную.</p>}
        <div className="space-y-1.5">
          {cands.map((c, i) => (
            <div key={i} className="grid grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center">
              <input type="checkbox" checked={c.on} onChange={e => updateCand(i, { on: e.target.checked })}
                aria-label={`Сделать «${c.value}» параметром`} className="accent-[var(--color-primary)]" />
              <span className="text-xs font-mono text-text-main truncate px-2 py-1.5 bg-bg-subtle rounded-md" title={c.value}>{c.value}</span>
              <input value={c.name} onChange={e => updateCand(i, { name: e.target.value })} disabled={!c.on}
                aria-label="Имя параметра" placeholder="имя: service"
                className={`${INPUT} py-1.5 font-mono text-xs ${c.on && !NAME_RE.test(c.name) ? "border-red-400" : ""}`} />
              <input value={c.label} onChange={e => updateCand(i, { label: e.target.value })} disabled={!c.on}
                aria-label="Подпись параметра" placeholder="подпись: Сервис" className={`${INPUT} py-1.5 text-xs`} />
            </div>
          ))}
          <div className="flex gap-2">
            <input value={extra} onChange={e => setExtra(e.target.value)} placeholder="Значение из адреса или запроса"
              aria-label="Добавить значение-параметр" className={`${INPUT} py-1.5 text-xs`} />
            <button type="button" disabled={!extra.trim()}
              onClick={() => { setCands(p => [...p, { value: extra.trim(), on: true, name: suggestName(p.length), label: "Параметр" }]); setExtra(""); setDraft(null); }}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-main text-xs text-text-muted hover:text-text-main disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> Добавить
            </button>
          </div>
        </div>
        {badName && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Имя «{badName.name}»: латиница в нижнем регистре, цифры и _, с буквы.</p>}
        <p className="mt-1 text-[11px] text-text-muted">Окно времени («последние N минут») подставляется само, если оно есть в запросе.</p>
      </div>

      {/* 4. Результат */}
      <div>
        <p className={LABEL}>4. Что показать в результате</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Вид результата">
          {(mode === "request" ? (["logs", "data"] as OpOutput[]) : (["text", "logs"] as OpOutput[])).map(o => (
            <button key={o} type="button" role="radio" aria-checked={output === o} onClick={() => setOutput(o)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                output === o ? "border-primary bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:border-primary/40"}`}>
              {o === "logs" ? "Разбор ошибок (логи)" : o === "data" ? "Данные как есть" : "Текст и скриншот"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={build} disabled={busy || !!badName || (mode === "request" && chosen === null)}
          className="px-4 py-2 rounded-lg border border-primary/40 text-sm font-medium text-primary hover:bg-[var(--color-active-bg)] disabled:opacity-40">
          {busy && !draft ? <Loader2 className="w-4 h-4 animate-spin" /> : "Собрать операцию"}
        </button>
      </div>

      {draft && (
        <div className="space-y-2">
          {draft.template.kind === "k8s_logs" ? (
            <p className="text-sm text-text-main">
              Логи OpenShift: проект <b>{draft.template.namespace}</b>
              {draft.template.container && <>, контейнер <b>{draft.template.container}</b></>}. Поды сервиса находятся
              при каждом запуске.
            </p>
          ) : draft.template.kind === "steps" ? (
            <ol className="text-xs font-mono bg-bg-subtle border border-border-main rounded-lg px-3 py-2 space-y-1 list-decimal pl-7 overflow-x-auto">
              <li><Highlighted text={`Открыть ${draft.template.start_url || connector.base_url}`} /></li>
              {(draft.template.steps ?? []).map((s, i) => <li key={i}><Highlighted text={templateStepText(s)} /></li>)}
              <li>{extractSelector ? `Забрать текст ${extractSelector}` : "Забрать текст страницы"} и скриншот</li>
            </ol>
          ) : (
            <div className="text-xs font-mono bg-bg-subtle border border-border-main rounded-lg px-3 py-2 space-y-1.5 overflow-x-auto">
              <p className="break-all"><b>{draft.template.method}</b> <Highlighted text={draft.template.url ?? ""} /></p>
              {draft.template.body && (
                <pre className="whitespace-pre-wrap break-all text-text-muted max-h-48 overflow-y-auto scrollbar-thin">
                  <Highlighted text={prettyKeepVars(draft.template.body)} />
                </pre>
              )}
            </div>
          )}
          {draft.note && <p className="text-xs text-text-muted">{draft.note}</p>}
          {draft.warnings.map(w => <p key={w} className="text-xs text-amber-700 dark:text-amber-300">⚠ {w}</p>)}

          <div className="flex flex-wrap items-end gap-3 pt-2">
            <div className="flex-1 min-w-[220px]">
              <label htmlFor="wz-name" className={LABEL}>5. Название операции</label>
              <input id="wz-name" value={name} onChange={e => setName(e.target.value)} className={INPUT} />
            </div>
            {output === "logs" && (
              <label className="flex items-center gap-2 text-sm text-text-main pb-2 cursor-pointer">
                <input type="checkbox" checked={logSource} onChange={e => setLogSource(e.target.checked)} className="accent-[var(--color-primary)]" />
                Источник для анализатора логов
              </label>
            )}
            <button type="button" onClick={save} disabled={busy || !name.trim()}
              className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-40">
              Сохранить
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

// ── Результат операции ───────────────────────────────────────────────────────

function DataView({ data }: { data: unknown }) {
  const rows = Array.isArray(data) && data.length && data.every(r => r && typeof r === "object" && !Array.isArray(r))
    ? (data as Record<string, unknown>[]) : null;
  if (rows) {
    const cols = Array.from(new Set(rows.slice(0, 50).flatMap(r => Object.keys(r)))).slice(0, 12);
    return (
      <div className="overflow-x-auto border border-border-main rounded-lg max-h-96 overflow-y-auto scrollbar-thin">
        <table className="text-xs w-full">
          <thead className="bg-bg-subtle sticky top-0">
            <tr>{cols.map(c => <th key={c} className="text-left font-semibold text-text-muted px-2.5 py-1.5 whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t border-border-main">
                {cols.map(c => {
                  const v = r[c];
                  return <td key={c} className="px-2.5 py-1 text-text-main align-top max-w-[320px] truncate" title={typeof v === "string" ? v : JSON.stringify(v)}>
                    {v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 200 && <p className="text-[11px] text-text-muted px-2.5 py-1.5">Показаны 200 из {rows.length}</p>}
      </div>
    );
  }
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return (
    <pre className="text-[11px] leading-4 font-mono whitespace-pre-wrap break-all text-text-main bg-bg-subtle border
      border-border-main rounded-lg px-3 py-2 max-h-96 overflow-y-auto scrollbar-thin">{text.slice(0, 50_000)}</pre>
  );
}

function OperationResult({ r }: { r: RunResult }) {
  const head = (
    <p className="text-xs text-text-muted flex flex-wrap gap-x-3">
      <span>{r.seconds} с</span>
      {r.relogged && <span>выполнен вход по логину техучётки</span>}
      <span className="truncate max-w-[420px]" title={r.url ?? r.source}>{r.url ?? r.source}</span>
    </p>
  );
  if ((r.output ?? "logs") === "logs") return <ErrorGroups result={r} />;
  if (r.output === "data") return <div className="space-y-1.5">{head}<DataView data={r.data} /></div>;
  return (
    <div className="space-y-2">
      {head}
      <pre className="text-xs whitespace-pre-wrap break-words text-text-main bg-bg-subtle border border-border-main rounded-lg
        px-3 py-2 max-h-64 overflow-y-auto scrollbar-thin">{r.text || "— пусто —"}</pre>
      {r.screenshot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/jpeg;base64,${r.screenshot}`} alt="Скриншот страницы после операции"
          className="max-h-80 rounded-lg border border-border-main" />
      )}
    </div>
  );
}

// ── Строка операции: параметры и запуск ──────────────────────────────────────

/**
 * Удаление с подтверждением прямо на странице. Системный confirm() не годится:
 * встроенные браузеры (панель Claude, некоторые WebView) молча отвечают «Отмена».
 */
function DeleteButton({ label, question, onConfirm, small }: {
  label: string; question: string; onConfirm: () => Promise<void>; small?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} aria-label={label}
        className={small ? "ml-auto p-1 rounded text-text-muted hover:text-red-500 flex-shrink-0"
                         : "p-2 rounded-lg border border-border-main text-text-muted hover:text-red-500"}>
        <Trash2 className={small ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </button>
    );
  }
  return (
    <span role="alertdialog" aria-label={question}
      className={`${small ? "ml-auto" : ""} flex items-center gap-1.5 flex-shrink-0 text-xs`}>
      <span className="text-text-muted">{question}</span>
      <button type="button" autoFocus disabled={busy}
        onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setAsking(false); } }}
        onKeyDown={e => { if (e.key === "Escape") setAsking(false); }}
        className="px-2 py-1 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
        {busy ? "Удаляю…" : "Удалить"}
      </button>
      <button type="button" onClick={() => setAsking(false)} disabled={busy}
        className="px-2 py-1 rounded-md border border-border-main text-text-muted hover:text-text-main">
        Отмена
      </button>
    </span>
  );
}

function OperationRow({ s, onChanged, onLogin }: { s: Scenario; onChanged: () => void; onLogin: () => void }) {
  const params: ParamDef[] = s.params ?? (s.kind === "k8s_logs" || (s.request?.url ?? "").includes("{service}") || (s.request?.body ?? "").includes("{service}")
    ? [{ name: "service", label: "Сервис", default: "" }] : []);
  const output: OpOutput = s.output ?? (s.kind === "steps" ? "text" : "logs");
  const withWindow = s.window ?? (s.kind !== "steps");
  const [values, setValues] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<{ message: string; needLogin: boolean } | null>(null);

  const run = async () => {
    setRunning(true); setErr(null); setResult(null);
    try { setResult(await runScenario(s.id, values, minutes)); }
    catch (e) { const x = e as WebApiError; setErr({ message: x.message, needLogin: !!x.needLogin }); }
    setRunning(false);
  };

  const makeSource = async () => {
    try {
      await saveScenario({ id: s.id, connector_id: s.connector_id, name: s.name, template: opTemplate(s),
                           params, output, extract_selector: s.extract_selector ?? "",
                           steps: s.recorded_steps ?? [], log_source: true });
      onChanged();
    } catch (e) { alert((e as Error).message); }
  };

  const remove = async () => {
    try { await deleteScenario(s.id); onChanged(); } catch (e) { setErr({ message: (e as Error).message, needLogin: false }); }
  };

  return (
    <div className="border border-border-main rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-sm font-medium text-text-main truncate">{s.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-muted text-text-muted flex-shrink-0">
          {KIND_LABEL[s.kind]}{s.kind === "k8s_logs" ? ` · ${s.namespace}` : ""} → {OUTPUT_LABEL[output]}
        </span>
        {s.log_source ? (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700
            dark:bg-amber-950/50 dark:text-amber-300 flex-shrink-0"><Star className="w-3 h-3" /> источник анализатора</span>
        ) : output === "logs" && (
          <button type="button" onClick={makeSource} className="text-[11px] text-text-muted hover:text-primary flex-shrink-0">
            сделать источником анализатора
          </button>
        )}
        <DeleteButton small label={`Удалить ${s.name}`} question="Удалить операцию?" onConfirm={remove} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {params.map(p => (
          <input key={p.name} value={values[p.name] ?? ""} onChange={e => setValues(v => ({ ...v, [p.name]: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") run(); }}
            placeholder={p.default ? `${p.label}: ${p.default}` : p.label} aria-label={p.label}
            className={`${INPUT} max-w-[240px] py-1.5`} />
        ))}
        {withWindow && (
          <select value={minutes} onChange={e => setMinutes(+e.target.value)} aria-label="Период"
            className="border border-border-main rounded-lg px-2 py-1.5 text-sm bg-[var(--color-input-bg)] text-text-main">
            {MINUTES.map(m => <option key={m} value={m}>{m} мин</option>)}
          </select>
        )}
        <button type="button" onClick={run} disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Запустить
        </button>
      </div>
      {params.some(p => p.default) && <p className="text-[11px] text-text-muted">Пустое поле — значение из записи.</p>}
      {err && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {err.message}
          {err.needLogin && <button type="button" onClick={onLogin} className="ml-2 underline">Войти</button>}
        </p>
      )}
      {result && <OperationResult r={result} />}
    </div>
  );
}

// ── Форма коннектора ─────────────────────────────────────────────────────────

function ConnectorForm({ initial, onSaved, onCancel }: {
  initial: Partial<Connector>; onSaved: (c: Connector) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<ConnectorInput>({
    id: initial.id, name: initial.name ?? "", base_url: initial.base_url ?? "https://", notes: initial.notes ?? "",
    auth_mode: initial.auth?.mode ?? "manual", login: initial.auth?.login ?? "", password: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const hasPassword = !!initial.auth?.has_password;
  const recipe = initial.auth?.recipe;

  const submit = async () => {
    if (!f.name.trim() || !f.base_url.trim()) return;
    if (f.auth_mode === "password" && !f.login?.trim()) { setErr("Укажите логин техучётки"); return; }
    if (f.auth_mode === "password" && !hasPassword && !f.password) { setErr("Укажите пароль техучётки"); return; }
    setBusy(true); setErr("");
    try { onSaved(await saveConnector({ ...f, name: f.name.trim(), base_url: f.base_url.trim() })); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className={`${CARD} space-y-3 max-w-2xl`}>
      <h3 className="text-sm font-semibold text-text-main">{f.id ? "Коннектор" : "Новый коннектор"}</h3>
      <div>
        <label htmlFor="wc-name" className={LABEL}>Название</label>
        <input id="wc-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })}
          placeholder="например, dropup ИФТ, Kibana ПСИ, портал заявок" className={INPUT} />
      </div>
      <div>
        <label htmlFor="wc-url" className={LABEL}>Адрес ресурса</label>
        <input id="wc-url" value={f.base_url} onChange={e => setF({ ...f, base_url: e.target.value })}
          placeholder="https://…" className={INPUT} />
      </div>
      <div>
        <label htmlFor="wc-notes" className={LABEL}>Заметка</label>
        <input id="wc-notes" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="что здесь делаем" className={INPUT} />
      </div>

      <div>
        <p className={LABEL}>Как подключаемся</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Способ входа">
          {([
            ["manual", LogIn, "Вход вручную", "Вы входите сами в окне браузера (SSO, двухфакторная). Пароль никуда не сохраняется."],
            ["password", KeyRound, "Логин и пароль техучётки", "SimpleTest входит сам, когда сессия истекла. Только для технических учёток тестовых стендов."],
          ] as const).map(([id, Icon, title, text]) => (
            <button key={id} type="button" role="radio" aria-checked={f.auth_mode === id} onClick={() => setF({ ...f, auth_mode: id })}
              className={`text-left flex gap-3 p-3 rounded-lg border transition-colors ${
                f.auth_mode === id ? "border-primary/50 bg-[var(--color-active-bg)]" : "border-border-main hover:border-primary/30"}`}>
              <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${f.auth_mode === id ? "text-primary" : "text-text-muted"}`} />
              <span>
                <span className="block text-sm font-medium text-text-main">{title}</span>
                <span className="block text-xs text-text-muted mt-0.5">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {f.auth_mode === "password" && (
        <div className="space-y-3 rounded-lg border border-amber-200 dark:border-amber-900 p-3">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Не указывайте здесь личный корпоративный пароль: хранить его в приложении запрещено политикой ИБ.
            Пароль техучётки шифруется ключом из ~/.simpletest/secret.key и в интерфейс не возвращается.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="wc-login" className={LABEL}>Логин</label>
              <input id="wc-login" value={f.login} onChange={e => setF({ ...f, login: e.target.value })} autoComplete="off" className={INPUT} />
            </div>
            <div>
              <label htmlFor="wc-pass" className={LABEL}>Пароль</label>
              <input id="wc-pass" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })}
                autoComplete="new-password" placeholder={hasPassword ? "сохранён — оставьте пустым" : ""} className={INPUT} />
            </div>
          </div>
          <p className="text-xs text-text-muted">
            {recipe?.password_selector
              ? <>Форма входа известна из записи: логин в <code>{recipe.user_selector || "—"}</code>, пароль в <code>{recipe.password_selector}</code>.</>
              : "Форму входа SimpleTest запомнит при первой записи: в окне записи войдите этим логином и паролем."}
          </p>
        </div>
      )}

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-40">Сохранить</button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>
      </div>
    </div>
  );
}

// ── Раздел ───────────────────────────────────────────────────────────────────

interface WizardState { steps: RecStep[]; responses: RecResponse[]; loginEnd: number }

export default function WebConnectorsSection() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Connector> | null>(null);
  const [win, setWin] = useState<WindowState | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await listWeb();
      setConnectors(d.connectors);
      setScenarios(d.scenarios);
      setSelectedId(prev => prev ?? d.connectors[0]?.id ?? null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = connectors.find(c => c.id === selectedId) ?? null;
  const own = useMemo(() => scenarios.filter(s => s.connector_id === selectedId), [scenarios, selectedId]);

  const toWizard = (res: { steps?: RecStep[]; responses?: RecResponse[]; login_end?: number }) =>
    setWizard({ steps: res.steps ?? [], responses: res.responses ?? [], loginEnd: res.login_end ?? 0 });

  // Пока окно открыто — показываем, что записывается; закрыл сам человек — сохраняем запись.
  useEffect(() => {
    if (!selectedId) return;
    let stop = false;
    const tick = async () => {
      try {
        const st = await windowState(selectedId);
        if (stop) return;
        // Фоновый браузер запусков (mode "run") — не окно человека, его не показываем.
        const human = st.mode === "login" || st.mode === "record";
        if (!st.open && human) {
          const res = await closeWindow(selectedId);
          setWin(null);
          if (res.saved) toWizard(res);
          load();
          return;
        }
        setWin(st.open && human ? st : null);
      } catch { /* сеть моргнула — следующий тик */ }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [selectedId, load]);

  const open = async (mode: "login" | "record") => {
    if (!selected) return;
    setBusy(true); setErr(""); setWizard(null);
    try { setWin(await openWindow(selected.id, mode)); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const done = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await closeWindow(selected.id);
      setWin(null);
      if (res.saved) toWizard(res);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
    load();
  };

  const fromLast = async () => {
    if (!selected) return;
    try { toWizard(await lastRecording(selected.id)); }
    catch (e) { setErr((e as Error).message); }
  };

  const remove = async () => {
    if (!selected) return;
    try { await deleteConnector(selected.id); setSelectedId(null); setWizard(null); await load(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="h-full flex gap-4 p-6 overflow-hidden animate-slide-up">
      {/* Список коннекторов */}
      <div className="w-64 flex-shrink-0 bg-bg-card border border-border-main rounded-xl p-3 flex flex-col gap-1 overflow-y-auto scrollbar-thin">
        <button type="button" onClick={() => { setForm({}); setWizard(null); }}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-primary hover:bg-[var(--color-active-bg)]">
          <Plus className="w-3.5 h-3.5" /> Новый коннектор
        </button>
        {connectors.map(c => (
          <button key={c.id} type="button" onClick={() => { setSelectedId(c.id); setForm(null); setWizard(null); }}
            className={`text-left px-3 py-2 rounded-lg border transition-colors ${
              c.id === selectedId ? "border-primary/30 bg-[var(--color-active-bg)]" : "border-transparent hover:bg-bg-subtle"}`}>
            <span className="flex items-center gap-2">
              <Globe className={`w-4 h-4 flex-shrink-0 ${c.id === selectedId ? "text-primary" : "text-text-muted"}`} />
              <span className="text-sm text-text-main truncate">{c.name}</span>
              {c.auth?.mode === "password" && <KeyRound className="w-3 h-3 text-text-muted flex-shrink-0" aria-label="вход по логину" />}
              {c.window?.open && <span className="ml-auto w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" title="окно открыто" />}
            </span>
            <span className="block text-[11px] text-text-muted truncate pl-6">{host(c.base_url)}</span>
          </button>
        ))}
      </div>

      {/* Рабочая область */}
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin space-y-4">
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">{err}</p>}

        {form ? (
          <ConnectorForm initial={form} onCancel={() => setForm(null)}
            onSaved={async c => { setForm(null); setSelectedId(c.id); await load(); }} />
        ) : !selected ? (
          <div className={`${CARD} max-w-2xl space-y-2`}>
            <h3 className="text-sm font-semibold text-text-main">Как это работает</h3>
            <ol className="text-sm text-text-muted list-decimal pl-5 space-y-1">
              <li>Создайте коннектор: адрес ресурса и как подключаемся — вручную или логином техучётки.</li>
              <li>«Записать операцию» — в окне Chrome войдите и сделайте, что нужно: откройте логи, найдите заявку…</li>
              <li>В мастере выберите, что делает операция, какие из введённых значений — параметры, и что показать.</li>
              <li>Запускайте операцию с любыми параметрами. Операцию с логами можно сделать источником раздела «Логи».</li>
            </ol>
          </div>
        ) : (
          <>
            {/* Шапка коннектора */}
            <div className={`${CARD} flex flex-wrap items-center gap-3`}>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-text-main truncate">{selected.name}</h2>
                <a href={selected.base_url} target="_blank" rel="noreferrer"
                  className="text-xs text-text-muted hover:text-primary inline-flex items-center gap-1 break-all">
                  {selected.base_url} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
                <p className="text-xs text-text-muted mt-0.5">
                  {selected.auth?.mode === "password"
                    ? `Вход: логин ${selected.auth.login || "—"}${selected.auth.recipe?.password_selector ? "" : " · форма входа ещё не записана"}`
                    : "Вход: вручную"}
                  {selected.notes ? ` · ${selected.notes}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => open("login")} disabled={busy || !!win}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
                <LogIn className="w-4 h-4" /> Войти
              </button>
              <button type="button" onClick={() => open("record")} disabled={busy || !!win}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">
                <Radio className="w-4 h-4" /> Записать операцию
              </button>
              <button type="button" onClick={() => setForm(selected)} aria-label="Изменить коннектор"
                className="p-2 rounded-lg border border-border-main text-text-muted hover:text-primary"><Pencil className="w-4 h-4" /></button>
              <DeleteButton label="Удалить коннектор" question="Удалить коннектор и все его операции?" onConfirm={remove} />
            </div>

            {/* Окно открыто */}
            {win && (
              <div className={`${CARD} border-red-300 dark:border-red-900 space-y-3`}>
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <p className="text-sm font-semibold text-text-main flex-1">
                    {win.mode === "record" ? "Идёт запись" : "Окно входа открыто"}
                    <span className="ml-2 font-normal text-text-muted tabular-nums">{Math.floor(win.seconds / 60)}:{String(Math.floor(win.seconds % 60)).padStart(2, "0")}</span>
                  </p>
                  <button type="button" onClick={done} disabled={busy}
                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-40">
                    {win.mode === "record" ? "Готово — остановить запись" : "Готово, я вошёл"}
                  </button>
                </div>
                <p className="text-xs text-text-muted">
                  {win.mode === "record"
                    ? "Действуйте в открывшемся окне Chrome: войдите и сделайте то, что должна делать операция. Когда результат на экране — нажмите «Готово»."
                    : "Войдите в открывшемся окне Chrome. Когда вход выполнен — нажмите «Готово»: сессия сохранится для фоновых запусков."}
                </p>
                {win.mode === "record" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-text-muted mb-1">Шаги · {win.steps.length}</p>
                      <ul className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
                        {win.steps.slice(-12).map((s, i) => <li key={i} className="text-text-main truncate">{stepText(s)}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-text-muted mb-1">Запросы сайта · {win.responses.length}</p>
                      <ul className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
                        {win.responses.slice(-12).map(r => (
                          <li key={r.id} className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-text-muted w-10 flex-shrink-0">{r.kind === "download" ? "ФАЙЛ" : r.method}</span>
                            <span className="font-mono text-text-main truncate">{r.kind === "download" ? r.filename : pathOf(r.url)}</span>
                            {r.likeness >= 50 && <span className="text-green-600 dark:text-green-400 flex-shrink-0">● логи</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {wizard && (
              <OperationWizard connector={selected} steps={wizard.steps} responses={wizard.responses} loginEnd={wizard.loginEnd}
                onCancel={() => setWizard(null)} onDone={() => { setWizard(null); load(); }} />
            )}

            {/* Операции */}
            <div className={`${CARD} space-y-2`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-main">Операции</h3>
                {!wizard && !win && (
                  <button type="button" onClick={fromLast} className="text-xs text-text-muted hover:text-primary">
                    Создать из последней записи
                  </button>
                )}
              </div>
              {own.length === 0 ? (
                <p className="text-sm text-text-muted">Операций пока нет — нажмите «Записать операцию».</p>
              ) : own.map(s => <OperationRow key={s.id} s={s} onChanged={load} onLogin={() => open("login")} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
