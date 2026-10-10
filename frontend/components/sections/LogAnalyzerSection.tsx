"use client";

/**
 * Анализатор логов: имя микросервиса → ошибки за последние N минут.
 *
 * Логи берутся сценарием веб-коннектора, отмеченным «Источник для анализатора»
 * (Генераторы событий → Веб-коннекторы). Имена сервисов можно сохранить списком,
 * чтобы не вводить каждый раз.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, ScrollText, Search, Settings2, X } from "lucide-react";
import ErrorGroups from "@/components/logs/ErrorGroups";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  analyzeLogs, analyzerState, deleteService, saveService,
  type ErrorGroupView, type RunResult, WebApiError,
} from "@/lib/webconnectApi";

const WINDOWS = [5, 10, 15, 30, 60];

export default function LogAnalyzerSection() {
  const router = useRouter();
  const { setBugPrefill } = useWorkspace();

  const [services, setServices] = useState<{ name: string; note: string }[]>([]);
  const [source, setSource] = useState<{ name: string; connector: string } | null | undefined>(undefined);
  const [service, setService] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<{ message: string; needLogin: boolean } | null>(null);

  const load = useCallback(() => {
    analyzerState()
      .then(s => { setServices(s.services); setSource(s.source); })
      .catch(e => setError({ message: String(e.message ?? e), needLogin: false }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (name = service) => {
    const svc = name.trim();
    if (!svc) return;
    setService(svc);
    setRunning(true); setError(null); setResult(null);
    try {
      setResult(await analyzeLogs(svc, minutes));
    } catch (e) {
      const err = e as WebApiError;
      setError({ message: err.message, needLogin: !!err.needLogin });
    }
    setRunning(false);
  };

  const remember = async () => {
    const svc = service.trim();
    if (!svc) return;
    try { setServices((await saveService(svc)).services); } catch { /* не критично */ }
  };

  const forget = async (name: string) => {
    try { setServices((await deleteService(name)).services); } catch { /* не критично */ }
  };

  const toBug = (g: ErrorGroupView) => {
    const lines = [
      `Сервис ${result?.service}: ошибка в логах за последние ${result?.minutes} мин — ${g.count} раз(а), ` +
      `с ${g.first_ts ?? "?"} по ${g.last_ts ?? "?"}.`,
      ...(g.pods.length ? [`Поды: ${g.pods.join(", ")}.`] : []),
      "",
      "Ключевая строка:",
      "```",
      g.message,
      ...g.sample_stack.slice(0, 8),
      "```",
    ];
    setBugPrefill({ platform: "Back", feature: result?.service ?? "", description: lines.join("\n"), source: "log_analyzer" });
    router.push("/bugs");
  };

  const openConnectors = () => router.push("/event-generators?open=webconnect");
  const saved = services.some(s => s.name === service.trim());

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin h-full animate-slide-up">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-text-main mb-1 flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-primary" /> Анализатор логов
          </h1>
          <p className="text-sm text-text-muted">
            Введите микросервис — SimpleTest выгрузит его логи за выбранный период и сгруппирует ошибки по причине.
          </p>
        </div>

        {source === null && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800
            dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              Источник логов не настроен. Запишите в веб-коннекторе, как вы открываете логи сервиса,
              и отметьте сценарий «Источник для анализатора».
            </div>
            <button type="button" onClick={openConnectors}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 text-xs font-medium hover:bg-amber-100
                dark:border-amber-800 dark:hover:bg-amber-900/40">
              <Settings2 className="w-3.5 h-3.5" /> Веб-коннекторы
            </button>
          </div>
        )}

        <div className="bg-bg-card border border-border-main rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label htmlFor="la-service" className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
                Микросервис
              </label>
              <input id="la-service" value={service} onChange={e => setService(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") run(); }}
                placeholder="например, pay-api" autoComplete="off"
                className="w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main
                  placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Период</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Период">
                {WINDOWS.map(m => (
                  <button key={m} type="button" role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      minutes === m ? "border-primary bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:border-primary/40"}`}>
                    {m} мин
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={remember} disabled={!service.trim() || saved}
              title={saved ? "Уже в списке" : "Сохранить в список"}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted
                hover:text-text-main hover:bg-bg-subtle disabled:opacity-40">
              <Plus className="w-4 h-4" /> В список
            </button>
            <button type="button" onClick={() => run()} disabled={running || !service.trim() || !source}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold
                hover:bg-primary-dark disabled:opacity-40 shadow-sm">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {running ? "Проверяю…" : "Проверить"}
            </button>
          </div>

          {services.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-text-muted mr-1">Сохранённые:</span>
              {services.map(s => (
                <span key={s.name} className={`group inline-flex items-center rounded-full border text-xs transition-colors ${
                  s.name === service.trim() ? "border-primary/50 bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-main"}`}>
                  <button type="button" onClick={() => run(s.name)} disabled={running || !source}
                    className="pl-2.5 pr-1 py-1 disabled:opacity-50" title={`Проверить ${s.name}`}>
                    {s.name}
                  </button>
                  <button type="button" onClick={() => forget(s.name)} aria-label={`Убрать ${s.name} из списка`}
                    className="pr-2 pl-0.5 py-1 text-text-muted opacity-40 group-hover:opacity-100 hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {source && (
            <p className="text-[11px] text-text-muted">
              Источник: {source.name} · {source.connector}
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700
            dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error.message}</div>
            {error.needLogin && (
              <button type="button" onClick={openConnectors}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-red-300 text-xs font-medium hover:bg-red-100
                  dark:border-red-800 dark:hover:bg-red-900/40">
                Войти заново
              </button>
            )}
          </div>
        )}

        {running && !result && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Выгружаю логи {service} за {minutes} мин…
          </div>
        )}

        {result && <ErrorGroups result={result} onBug={toBug} />}
      </div>
    </div>
  );
}
