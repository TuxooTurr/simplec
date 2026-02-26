"use client";

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
      <h3 className="text-sm font-semibold text-text-main mb-3">
        {done ? `Готово за ${elapsed}с` : "Генерация..."}
      </h3>

      <div className="space-y-2">
        {events.map((ev, i) => {
          if (ev.type === "layer_start") {
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-indigo-400 animate-spin inline-block">⟳</span>
                <span className="text-text-muted">
                  Слой {ev.layer} — {ev.name ?? LAYER_NAMES[ev.layer ?? 0]}
                </span>
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
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-text-main">
                  Слой {ev.layer} — {LAYER_NAMES[ev.layer ?? 0]}: {label}
                </span>
                <span className="text-text-muted ml-auto">{ev.elapsed}с</span>
              </div>
            );
          }
          if (ev.type === "error") {
            return (
              <div key={i} className="flex items-center gap-2 text-sm text-red-500">
                <span>✗</span>
                <span>{ev.message}</span>
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* Progress bar for layer 3 */}
      {progress && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>Кейс {progress.current}/{progress.total}: {progress.name}</span>
            <span>{Math.round((progress.current / progress.total) * 100)}%</span>
          </div>
          <div className="w-full bg-indigo-100 rounded-full h-2">
            <div
              className="bg-primary rounded-full h-2 transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
