"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  SplitSquareHorizontal, Play, Loader2, Paperclip,
  ChevronDown, Trash2, History, Sparkles, Clock, Zap, AlertTriangle, RefreshCw,
} from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";
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

function TargetCard({ target, providers }: { target: ModelBenchTarget; providers: ProviderStatus[] }) {
  const [expanded, setExpanded] = useState(false);
  const okRuns = target.results.filter((r) => !r.error);
  const errCount = target.results.length - okRuns.length;

  return (
    <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-bg-subtle/70 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          {targetLabel(target.provider, target.model, providers)}
          <span className="text-xs font-normal text-text-muted">
            {target.results.length} прогонов{errCount > 0 ? `, ${errCount} с ошибкой` : ""}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      <div className="px-4 pb-3 flex flex-wrap gap-4 text-xs text-text-muted border-t border-border-main pt-3">
        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> ~{avg(okRuns.map((r) => r.latency_sec))}с</span>
        <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> ~{avg(okRuns.map((r) => r.tokens_per_sec))} ток/сек</span>
        <span>~{avg(okRuns.map((r) => r.tokens_out))} токенов на ответ</span>
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
                    <span>{r.tokens_in}→{r.tokens_out} токенов</span>
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
  const [prompt, setPrompt] = useState("");
  const [transcript, setTranscript] = useState("");
  const [session, setSession] = useState<ModelBenchSession | null>(null);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomLlmProvider[]>([]);
  const [gigachatModels, setGigachatModels] = useState<string[]>([]);

  const [selProvider, setSelProvider] = useState("");
  const [selModel, setSelModel] = useState("");
  const [runsCount, setRunsCount] = useState(5);

  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const [judgeProvider, setJudgeProvider] = useState("");
  const [judgeModel, setJudgeModel] = useState("");

  const [history, setHistory] = useState<ModelBenchSessionSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const transcriptFileRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    getProviders().then(setProviders).catch(() => {});
    getCustomLlmProviders().then(setCustomProviders).catch(() => {});
    listModelBenchSessions().then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    if (providers.length && !selProvider) {
      setSelProvider(providers[0].id);
      setJudgeProvider(providers[0].id);
    }
  }, [providers, selProvider]);

  useEffect(() => {
    if (selProvider === "gigachat") {
      getGigachatModels({}).then((r) => {
        setGigachatModels(r.models);
        if (r.models.length && !selModel) setSelModel(r.models[0]);
      }).catch(() => setGigachatModels([]));
    } else {
      const cfg = customProviders.find((p) => p.id === selProvider);
      setSelModel(cfg?.model ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selProvider, customProviders]);

  useEffect(() => {
    if (judgeProvider === "gigachat") {
      if (gigachatModels.length && !judgeModel) setJudgeModel(gigachatModels[0]);
    } else {
      const cfg = customProviders.find((p) => p.id === judgeProvider);
      setJudgeModel(cfg?.model ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgeProvider, customProviders, gigachatModels]);

  const refreshHistory = useCallback(() => {
    listModelBenchSessions().then(setHistory).catch(() => {});
  }, []);

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || !transcript.trim() || !selProvider) return;
    setError("");
    setRunning(true);
    try {
      let s = session;
      if (!s) {
        s = await createModelBenchSession(prompt, transcript);
        setSession(s);
      }
      const updated = await runModelBenchTarget(s.id, { provider: selProvider, model: selModel, runs: runsCount });
      setSession(updated);
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [prompt, transcript, selProvider, selModel, runsCount, session, refreshHistory]);

  const handleAnalyze = useCallback(async () => {
    if (!session || !judgeProvider) return;
    setError("");
    setAnalyzing(true);
    try {
      const updated = await analyzeModelBenchSession(session.id, { provider: judgeProvider, model: judgeModel });
      setSession(updated);
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [session, judgeProvider, judgeModel, refreshHistory]);

  const handleReset = useCallback(() => {
    setSession(null);
    setPrompt("");
    setTranscript("");
    setError("");
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-main">
        <div className="flex items-center gap-2">
          <SplitSquareHorizontal className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-text-main">Сравнение моделей</h2>
          <span className="text-xs text-text-muted">саммаризация транскрибаций</span>
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

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4 max-w-3xl">
        {showHistory && (
          <div className="bg-bg-card border border-border-main rounded-xl p-3 space-y-1.5 animate-fade-in">
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
          <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-bg-card border border-border-main rounded-xl p-5">
          <label className={LABEL_CLS}>Промпт саммаризации (как на Sber911)</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={locked}
            placeholder="Вставьте system-промпт, который используется для саммари..."
            rows={6}
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
            rows={8}
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

        <div className="bg-bg-card border border-border-main rounded-xl p-5">
          <label className={LABEL_CLS}>Запустить модель</label>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <select
                value={selProvider}
                onChange={(e) => { setSelProvider(e.target.value); setSelModel(""); }}
                className={INPUT_CLS}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {selProvider === "gigachat" ? (
              <div className="min-w-[180px]">
                <select value={selModel} onChange={(e) => setSelModel(e.target.value)} className={INPUT_CLS}>
                  {gigachatModels.length === 0 && <option value="">(модели не загружены)</option>}
                  {gigachatModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            ) : (
              <span className="text-xs text-text-muted px-2 py-2 border border-border-main rounded-lg bg-bg-subtle">
                {selModel || "модель не настроена"}
              </span>
            )}
            <div className="w-20">
              <input
                type="number"
                min={1}
                max={10}
                value={runsCount}
                onChange={(e) => setRunsCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className={INPUT_CLS}
                title="Количество прогонов"
              />
            </div>
            <button
              onClick={handleRun}
              disabled={running || !prompt.trim() || !transcript.trim() || !selProvider || (selProvider === "gigachat" && !selModel)}
              className={BTN_PRIMARY}
            >
              {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Выполняется...</> : <><Play className="w-4 h-4" /> Запустить</>}
            </button>
          </div>
          <p className="text-xs text-text-muted mt-2">
            Выберите модель, запустите — она отработает {runsCount} раз(а) на одном промпте и транскрибации.
            Затем выберите другую модель и повторите.
          </p>
        </div>

        {session && session.targets.length > 0 && (
          <div className="space-y-3">
            <p className={LABEL_CLS}>Результаты ({session.targets.length} моделей)</p>
            {session.targets.map((t) => (
              <TargetCard key={targetKey(t.provider, t.model)} target={t} providers={providers} />
            ))}
          </div>
        )}

        {session && session.targets.length > 0 && (
          <div className="bg-bg-card border border-border-main rounded-xl p-5">
            <label className={LABEL_CLS}>Сравнительный отчёт</label>
            <div className="flex flex-wrap items-center gap-3">
              <select value={judgeProvider} onChange={(e) => setJudgeProvider(e.target.value)} className={`${INPUT_CLS} max-w-[220px]`}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {judgeProvider === "gigachat" && (
                <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} className={`${INPUT_CLS} max-w-[200px]`}>
                  {gigachatModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
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
