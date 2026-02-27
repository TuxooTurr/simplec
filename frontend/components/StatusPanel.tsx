"use client";

import { CheckCircle2, XCircle, Loader2, Layers, Clock } from "lucide-react";
import type { GenEvent, Progress } from "@/lib/useGeneration";

interface StatusPanelProps {
  events: GenEvent[];
  progress: Progress | null;
  done?: boolean;
  elapsed?: number;
}

const LAYER_NAMES: Record<number, string> = {
  1: "QA документация",
  2: "Список кейсов",
  3: "Детальные кейсы",
};

export default function StatusPanel({ events, progress, done, elapsed }: StatusPanelProps) {
  return (
    <div className="bg-white border border-border-main rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {done ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-green-500 animate-success flex-shrink-0" />
            <h3 className="text-sm font-semibold text-text-main">
              Готово
              {elapsed ? <span className="text-text-muted font-normal ml-1">за {elapsed}с</span> : ""}
            </h3>
          </>
        ) : (
          <>
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
            <h3 className="text-sm font-semibold text-text-main">Генерация...</h3>
          </>
        )}
      </div>

      {/* Event log */}
      <div className="space-y-2">
        {events.map((ev, i) => {
          if (ev.type === "layer_start") {
            return (
              <div key={i} className="flex items-center gap-2.5 text-sm animate-fade-in">
                <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Layers className="w-3 h-3 text-primary" />
                </div>
                <span className="text-text-muted">
                  Слой {ev.layer} — {ev.name ?? LAYER_NAMES[ev.layer ?? 0]}
                </span>
                <Loader2 className="w-3 h-3 text-primary animate-spin ml-auto flex-shrink-0" />
              </div>
            );
          }
          if (ev.type === "layer_done") {
            const label =
              ev.layer === 2 && ev.count
                ? `${ev.count} кейсов`
                : ev.layer === 1
                ? "готова"
                : "готовы";
            return (
              <div key={i} className="flex items-center gap-2.5 text-sm animate-fade-in">
                <div className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                </div>
                <span className="text-text-main">
                  Слой {ev.layer} — {LAYER_NAMES[ev.layer ?? 0]}:{" "}
                  <span className="font-medium">{label}</span>
                </span>
                <span className="ml-auto flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {ev.elapsed}с
                </span>
              </div>
            );
          }
          if (ev.type === "error") {
            return (
              <div key={i} className="flex items-center gap-2.5 text-sm animate-fade-in">
                <div className="w-5 h-5 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                  <XCircle className="w-3 h-3 text-red-500" />
                </div>
                <span className="text-red-600">{ev.message}</span>
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* Progress bar for layer 3 */}
      {progress && (
        <div className="mt-5 animate-fade-in">
          <div className="flex justify-between text-xs text-text-muted mb-1.5">
            <span className="truncate max-w-[220px]">
              Кейс {progress.current}/{progress.total}:{" "}
              <span className="text-text-main font-medium">{progress.name}</span>
            </span>
            <span className="font-semibold text-primary ml-2 flex-shrink-0">
              {Math.round((progress.current / progress.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-indigo-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-2.5 rounded-full transition-all duration-500 ease-out animate-progress-glow"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
                background: "linear-gradient(90deg, #6366F1, #818CF8)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
