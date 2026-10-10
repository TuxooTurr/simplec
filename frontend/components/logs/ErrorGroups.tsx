"use client";

/**
 * Результат разбора логов: сводка + группы ошибок (одна причина = одна карточка).
 * Используется анализатором логов и пробным запуском сценария веб-коннектора.
 */

import { useState } from "react";
import { Bug, CheckCircle2, ChevronDown, ChevronRight, Clock, Server } from "lucide-react";
import type { ErrorGroupView, RunResult } from "@/lib/webconnectApi";

const SEVERITY: Record<ErrorGroupView["severity"], { label: string; cls: string }> = {
  critical: { label: "Критично", cls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900" },
  high:     { label: "Высокая",  cls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900" },
  medium:   { label: "Средняя",  cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900" },
  low:      { label: "Низкая",   cls: "bg-bg-muted text-text-muted border-border-main" },
};

const CATEGORY: Record<string, string> = {
  NPE: "NullPointer", timeout: "таймаут", db: "база данных", auth: "доступ", network: "сеть",
  memory: "память", serialization: "формат данных", config: "конфигурация", other: "прочее",
};

function hhmmss(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts.slice(11, 19) : d.toLocaleTimeString("ru-RU");
}

/** Сообщение без даты и уровня в начале — они показаны отдельно. */
function cleanMessage(msg: string): string {
  return msg
    .replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*/, "")
    .replace(/^(?:FATAL|CRITICAL|SEVERE|ERROR|ERR|WARN|WARNING)\b\s*/, "")
    .trim();
}

function GroupCard({ g, onBug }: { g: ErrorGroupView; onBug?: (g: ErrorGroupView) => void }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[g.severity];
  const text = cleanMessage(g.message);
  return (
    <div className="bg-bg-card border border-border-main rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={`flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${sev.cls}`}>
          {sev.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-main break-words">
            {g.exception && !text.includes(g.exception) && (
              <span className="font-mono text-[12px] text-red-600 dark:text-red-400 mr-1.5">{g.exception}</span>
            )}
            {text}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            <span className="font-semibold text-text-main tabular-nums">×{g.count}</span>
            <span className="px-1.5 py-0.5 rounded bg-bg-muted">{CATEGORY[g.category] ?? g.category}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden />
              {hhmmss(g.first_ts)} → {hhmmss(g.last_ts)}</span>
            {g.pods.length > 0 && (
              <span className="flex items-center gap-1 min-w-0" title={g.pods.join(", ")}>
                <Server className="w-3 h-3 flex-shrink-0" aria-hidden />
                <span className="truncate max-w-[240px]">{g.pods.length === 1 ? g.pods[0] : `${g.pods.length} пода`}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {g.sample_stack.length > 0 && (
            <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-muted hover:text-text-main hover:bg-bg-subtle">
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Стек
            </button>
          )}
          {onBug && (
            <button type="button" onClick={() => onBug(g)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-border-main
                text-text-muted hover:text-primary hover:border-primary/40">
              <Bug className="w-3.5 h-3.5" /> Дефект
            </button>
          )}
        </div>
      </div>
      {open && (
        <pre className="mt-2.5 text-[11px] leading-4 font-mono whitespace-pre-wrap break-all text-text-muted
          bg-bg-subtle border border-border-main rounded-lg px-3 py-2 max-h-72 overflow-y-auto scrollbar-thin">
          {g.sample_stack.join("\n")}
        </pre>
      )}
    </div>
  );
}

export default function ErrorGroups({ result, onBug }: { result: RunResult; onBug?: (g: ErrorGroupView) => void }) {
  const [showSample, setShowSample] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="font-semibold text-text-main">{result.service || "без сервиса"}</span>
        <span>последние {result.minutes} мин</span>
        <span className="tabular-nums">строк: {result.lines}</span>
        <span className="tabular-nums">ошибок: {result.errors}</span>
        <span className="tabular-nums">групп: {result.groups.length}</span>
        <span>{result.seconds} с</span>
        <span className="truncate max-w-[360px]" title={result.source}>источник: {result.scenario?.name ?? result.source}</span>
      </div>

      {result.groups.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-green-200 bg-green-50 text-sm text-green-700
          dark:bg-green-950/40 dark:border-green-900 dark:text-green-300">
          <CheckCircle2 className="w-4 h-4" />
          {result.lines === 0
            ? "Ресурс не вернул ни одной строки за этот период — проверьте имя сервиса."
            : `Ошибок нет: просмотрено ${result.lines} строк.`}
        </div>
      ) : (
        <div className="space-y-2">
          {result.groups.map(g => <GroupCard key={g.fingerprint} g={g} onBug={onBug} />)}
        </div>
      )}

      {result.sample.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowSample(v => !v)} aria-expanded={showSample}
            className="text-xs text-text-muted hover:text-text-main flex items-center gap-1">
            {showSample ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Последние строки ({result.sample.length})
          </button>
          {showSample && (
            <pre className="mt-1.5 text-[11px] leading-4 font-mono whitespace-pre-wrap break-all text-text-muted
              bg-bg-subtle border border-border-main rounded-lg px-3 py-2 max-h-64 overflow-y-auto scrollbar-thin">
              {result.sample.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
