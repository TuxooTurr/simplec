"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  SplitSquareHorizontal, Play, Loader2, Paperclip, Trophy,
  ChevronDown, Trash2, History, Sparkles, Clock, Zap, AlertTriangle, RefreshCw, Plus, Minus,
} from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { getCustomLlmProviders, type CustomLlmProvider } from "@/lib/settingsApi";
import {
  getProviders, getGigachatModels, parseFile, type ProviderStatus,
  createModelBenchSession, runModelBenchTarget, analyzeModelBenchSession,
  listModelBenchSessions, getModelBenchSession, deleteModelBenchSession,
  type ModelBenchSession, type ModelBenchSessionSummary, type ModelBenchTarget,
} from "@/lib/api";

/* ── Style constants (локальные — как в остальных секциях) ─────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

const BTN_PRIMARY =
  "flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg " +
  "hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_SECONDARY =
  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border-main rounded-lg " +
  "text-text-main hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 transition-all";

const SCENARIOS = [{ value: "transcript_summary", label: "Транскрибация" }];

const MAX_MODELS = 6;

interface TargetRow { provider: string; model: string }

function targetKey(provider: string, model: string) {
  return `${provider}::${model}`;
}

function targetLabel(provider: string, model: string, providers: ProviderStatus[]) {
  const name = providers.find((p) => p.id === provider)?.name ?? provider;
  return model ? `${name} · ${model}` : name;
}

function avg(nums: number[]): number {
  const vals = nums.filter((n) => n > 0);
  if (!vals.length) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

/* ── Карточка одной модели с прогонами ──────────────────────────────── */

function TargetCard({ target, providers, isBest }: { target: ModelBenchTarget; providers: ProviderStatus[]; isBest: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const okRuns = target.results.filter((r) => !r.error);
  const errCount = target.results.length - okRuns.length;

  return (
    <div className={`bg-bg-card border rounded-xl overflow-hidden ${isBest ? "border-green-500 ring-1 ring-green-500/30" : "border-border-main"}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-bg-subtle/70 transition-colors"
      >
        <span className="flex items-center gap-2">
          {isBest ? <Trophy className="w-4 h-4 text-green-600" /> : <Sparkles className="w-4 h-4 text-primary" />}
          {targetLabel(target.provider, target.model, providers)}
          {isBest && (
            <span className="text-xs font-normal text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              лучшая модель
            </span>
          )}
          <span className="text-xs font-normal text-text-muted">
            {target.results.length} прогонов{errCount > 0 ? `, ${errCount} с ошибкой` : ""}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      <div className="px-4 pb-3 flex flex-wrap gap-4 text-xs text-text-muted border-t border-border-main pt-3">
        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> ~{avg(okRuns.map((r) => r.latency_sec))}с</span>
        <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> ~{avg(okRuns.map((r) => r.tokens_per_sec))} ток/сек</span>
        <span>токены: ~{avg(okRuns.map((r) => r.tokens_in))} контекст → ~{avg(okRuns.map((r) => r.tokens_out))} ответ</span>
      </div>

      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main animate-fade-in">
          {target.results.map((r) => (
            <div key={r.run} className="px-4 py-3">
              <div className="flex items-center gap-3 text-xs text-text-muted mb-1.5">
                <span className="font-medium text-text-main">Прогон {r.run}</span>
                {r.error ? (
                  <span className="text-red-500">ошибка</span>
                ) : (
                  <>
                    <span>{r.latency_sec}с</span>
                    <span>контекст {r.tokens_in} → ответ {r.tokens_out} токенов</span>
                    <span>{r.tokens_per_sec} ток/сек</span>
                    {r.finish_reason === "length" && (
                      <span className="text-amber-600">обрезан лимитом</span>
                    )}
                  </>
                )}
              </div>
              {r.error ? (
                <p className="text-xs text-red-500">{r.error}</p>
              ) : (
                <p className="text-sm text-text-main whitespace-pre-wrap">{r.output_text}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Основная секция ─────────────────────────────────────────────────── */

export default function ModelBenchSection() {
  const { provider: judgeProvider } = useWorkspace(); // судья = платформенная модель, здесь не выбирается

  const [scenario, setScenario] = useState(SCENARIOS[0].value);
  const [prompt, setPrompt] = useState("");
  const [transcript, setTranscript] = useState("");
  const [session, setSession] = useState<ModelBenchSession | null>(null);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomLlmProvider[]>([]);
  const [gigachatModels, setGigachatModels] = useState<string[]>([]);

  const [modelsCount, setModelsCount] = useState(2);
  const [targetRows, setTargetRows] = useState<TargetRow[]>([]);
  const [runsCount, setRunsCount] = useState(5);
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});

  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const [history, setHistory] = useState<ModelBenchSessionSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const transcriptFileRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    getProviders().then(setProviders).catch(() => {});
    getCustomLlmProviders().then(setCustomProviders).catch(() => {});
    getGigachatModels({}).then((r) => setGigachatModels(r.models)).catch(() => {});
    listModelBenchSessions().then(setHistory).catch(() => {});
  }, []);

  const defaultModelFor = useCallback((providerId: string) => {
    if (providerId === "gigachat") return gigachatModels[0] ?? "";
    return customProviders.find((p) => p.id === providerId)?.model ?? "";
  }, [gigachatModels, customProviders]);

  const modelOptionsFor = useCallback((providerId: string): string[] => {
    if (providerId === "gigachat") return gigachatModels;
    const m = customProviders.find((p) => p.id === providerId)?.model;
    return m ? [m] : [];
  }, [gigachatModels, customProviders]);

  // Подгоняем количество строк выбора модели под modelsCount, не теряя уже выбранное.
  useEffect(() => {
    if (!providers.length) return;
    setTargetRows((prev) => {
      const next = prev.slice(0, modelsCount);
      while (next.length < modelsCount) {
        const p = providers[next.length % providers.length]?.id ?? providers[0].id;
        next.push({ provider: p, model: defaultModelFor(p) });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsCount, providers]);

  const refreshHistory = useCallback(() => {
    listModelBenchSessions().then(setHistory).catch(() => {});
  }, []);

  const updateRow = useCallback((i: number, patch: Partial<TargetRow>) => {
    setTargetRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }, []);

  const rowsValid = targetRows.length > 0 && targetRows.every((r) => r.provider && r.model);

  const handleRunAll = useCallback(async () => {
    if (!prompt.trim() || !transcript.trim() || !rowsValid) return;
    setError("");
    setRunning(true);
    setProgress(Object.fromEntries(targetRows.map((r) => [targetKey(r.provider, r.model), { done: 0, total: runsCount }])));

    try {
      let s = session;
      if (!s) {
        s = await createModelBenchSession(prompt, transcript);
        setSession(s);
      }
      for (const row of targetRows) {
        const key = targetKey(row.provider, row.model);
        for (let i = 1; i <= runsCount; i++) {
          try {
            const updated = await runModelBenchTarget(s.id, { provider: row.provider, model: row.model, runs: 1 });
            setSession(updated);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            break; // эта модель недоступна — переходим к следующей, не долбим тот же провайдер
          }
          setProgress((prev) => ({ ...prev, [key]: { done: i, total: runsCount } }));
        }
      }
      refreshHistory();
    } finally {
      setRunning(false);
    }
  }, [prompt, transcript, rowsValid, targetRows, runsCount, session, refreshHistory]);

  const handleAnalyze = useCallback(async () => {
    if (!session || !judgeProvider) return;
    setError("");
    setAnalyzing(true);
    try {
      const updated = await analyzeModelBenchSession(session.id, { provider: judgeProvider });
      setSession(updated);
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [session, judgeProvider, refreshHistory]);

  const handleReset = useCallback(() => {
    setSession(null);
    setPrompt("");
    setTranscript("");
    setError("");
    setProgress({});
  }, []);

  const handleLoadHistory = useCallback(async (id: string) => {
    try {
      const s = await getModelBenchSession(id);
      setSession(s);
      setPrompt(s.prompt);
      setTranscript(s.transcript);
      setShowHistory(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleDeleteHistory = useCallback(async (id: string) => {
    try {
      await deleteModelBenchSession(id);
      refreshHistory();
      if (session?.id === id) handleReset();
    } catch { /* игнорируем — просто не обновится список */ }
  }, [refreshHistory, session, handleReset]);

  const locked = !!session; // промпт/транскрибация фиксируются на первом запуске
  const judgeName = providers.find((p) => p.id === judgeProvider)?.name ?? judgeProvider;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-main">
        <div className="flex items-center gap-2">
          <SplitSquareHorizontal className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-text-main">Тестирование моделей LLM</h2>
        </div>
        <div className="flex items-center gap-2">
          {session && (
            <button onClick={handleReset} className={BTN_SECONDARY}>
              <RefreshCw className="w-3.5 h-3.5" /> Новая сессия
            </button>
          )}
          <button onClick={() => setShowHistory((v) => !v)} className={BTN_SECONDARY}>
            <History className="w-3.5 h-3.5" /> История
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
        {showHistory && (
          <div className="bg-bg-card border border-border-main rounded-xl p-3 space-y-1.5 animate-fade-in max-w-3xl">
            {history.length === 0 && <p className="text-xs text-text-muted px-2 py-1">Пока пусто</p>}
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-subtle text-xs">
                <button onClick={() => handleLoadHistory(h.id)} className="flex-1 text-left truncate text-text-main">
                  {h.prompt || "(без промпта)"}
                  <span className="text-text-muted ml-2">
                    {h.targets_count} моделей{h.has_report ? " · есть отчёт" : ""}
                  </span>
                </button>
                <button onClick={() => handleDeleteHistory(h.id)} className="text-text-muted hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-3xl">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="max-w-xs">
          <label className={LABEL_CLS}>Сценарий</label>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)} className={INPUT_CLS} disabled={locked}>
            {SCENARIOS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-bg-card border border-border-main rounded-xl p-5">
            <label className={LABEL_CLS}>Промпт саммаризации (как на Sber911)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={locked}
              placeholder="Вставьте system-промпт, который используется для саммари..."
              rows={10}
              className={`${INPUT_CLS} resize-none font-mono disabled:opacity-70`}
            />
          </div>

          <div className="bg-bg-card border border-border-main rounded-xl p-5">
            <label className={LABEL_CLS}>Транскрибация</label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={locked}
              placeholder="Вставьте текст транскрибации звонка..."
              rows={10}
              className={`${INPUT_CLS} resize-none disabled:opacity-70`}
            />
            <input
              ref={transcriptFileRef}
              type="file"
              accept=".txt,.log,.docx,.pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileLoading(true);
                try {
                  const result = await parseFile(file);
                  setTranscript(result.text);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setFileLoading(false);
                  if (e.target) e.target.value = "";
                }
              }}
            />
            {!locked && (
              <button
                type="button"
                onClick={() => transcriptFileRef.current?.click()}
                disabled={fileLoading}
                className="mt-2 flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-border-main rounded-lg
                  text-xs text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-50 transition-all duration-150"
              >
                {fileLoading
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Загружаю...</>
                  : <><Paperclip className="w-3 h-3" /> Загрузить из файла</>}
              </button>
            )}
          </div>
        </div>

        <div className="bg-bg-card border border-border-main rounded-xl p-5 max-w-3xl">
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div>
              <label className={LABEL_CLS}>Сколько моделей проверяем</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setModelsCount((c) => Math.max(1, c - 1))}
                  disabled={running || modelsCount <= 1}
                  className={BTN_SECONDARY}
                ><Minus className="w-3.5 h-3.5" /></button>
                <span className="w-6 text-center text-sm text-text-main">{modelsCount}</span>
                <button
                  type="button"
                  onClick={() => setModelsCount((c) => Math.min(MAX_MODELS, c + 1))}
                  disabled={running || modelsCount >= MAX_MODELS}
                  className={BTN_SECONDARY}
                ><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="w-24">
              <label className={LABEL_CLS}>Запросов на модель</label>
              <input
                type="number"
                min={1}
                max={10}
                value={runsCount}
                onChange={(e) => setRunsCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                disabled={running}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {targetRows.map((row, i) => {
              const key = targetKey(row.provider, row.model);
              const prog = progress[key];
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.provider}
                    onChange={(e) => updateRow(i, { provider: e.target.value, model: defaultModelFor(e.target.value) })}
                    disabled={running}
                    className={`${INPUT_CLS} min-w-[160px] flex-1`}
                  >
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select
                    value={row.model}
                    onChange={(e) => updateRow(i, { model: e.target.value })}
                    disabled={running || modelOptionsFor(row.provider).length <= 1}
                    className={`${INPUT_CLS} min-w-[160px] flex-1`}
                  >
                    {modelOptionsFor(row.provider).length === 0 && <option value="">(модель не настроена)</option>}
                    {modelOptionsFor(row.provider).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {prog && (
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <div className="flex-1 h-1.5 bg-bg-subtle rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${prog.done >= prog.total ? "bg-green-500" : "bg-primary"}`}
                          style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-muted tabular-nums">{Math.round((prog.done / prog.total) * 100)}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={handleRunAll}
            disabled={running || !prompt.trim() || !transcript.trim() || !rowsValid}
            className={BTN_PRIMARY}
          >
            {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Выполняется...</> : <><Play className="w-4 h-4" /> Запустить</>}
          </button>
          <p className="text-xs text-text-muted mt-2">
            Каждая модель по очереди выполнит {runsCount} запрос(ов) на одном промпте и транскрибации,
            затем автоматически перейдёт к следующей.
          </p>
        </div>

        {session && session.targets.length > 0 && (
          <div className="space-y-3 max-w-3xl">
            <p className={LABEL_CLS}>Результаты ({session.targets.length} моделей)</p>
            {session.targets.map((t) => (
              <TargetCard
                key={targetKey(t.provider, t.model)}
                target={t}
                providers={providers}
                isBest={session.best_provider === t.provider && session.best_model === t.model}
              />
            ))}
          </div>
        )}

        {session && session.targets.length > 0 && (
          <div className="bg-bg-card border border-border-main rounded-xl p-5 max-w-3xl">
            <label className={LABEL_CLS}>Сравнительный отчёт</label>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-text-muted">Судья: <span className="text-text-main font-medium">{judgeName}</span> (модель платформы)</span>
              <button onClick={handleAnalyze} disabled={analyzing} className={BTN_PRIMARY}>
                {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализирую...</> : <><Sparkles className="w-4 h-4" /> {session.report ? "Обновить отчёт" : "Получить отчёт"}</>}
              </button>
            </div>
            {session.report && (
              <div className="mt-4 pt-4 border-t border-border-main">
                <NotionRenderer text={session.report} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
