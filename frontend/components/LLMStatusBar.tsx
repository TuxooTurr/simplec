"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { getProviders, type ProviderStatus } from "@/lib/api";

const STATUS_CONFIG: Record<string, { dot: string; ring: string; label: string }> = {
  green:  { dot: "bg-green-500",  ring: "bg-green-400/30",  label: "Работает" },
  yellow: { dot: "bg-yellow-400", ring: "bg-yellow-300/40", label: "Ограничен" },
  red:    { dot: "bg-red-500",    ring: "bg-red-400/30",    label: "Недоступен" },
};

export default function LLMStatusBar() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProviders()
      .then(setProviders)
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Activity className="w-3 h-3 animate-pulse" />
        <span>Проверка LLM...</span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Статус LLM</p>
      <div className="flex flex-col gap-1.5">
        {providers.map((p) => {
          const cfg = STATUS_CONFIG[p.status] ?? { dot: "bg-gray-400", ring: "bg-gray-300/30", label: "—" };
          const isPulsing = p.status === "green" || p.status === "yellow";
          return (
            <div key={p.id} className="flex items-center gap-2 text-xs">
              {/* Pulsing dot */}
              <span className="relative flex-shrink-0 w-2.5 h-2.5">
                {isPulsing && (
                  <span className={`absolute inset-0 rounded-full ${cfg.ring} animate-ping`} />
                )}
                <span className={`relative block w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
              </span>
              <span className="font-medium text-text-main">{p.name}</span>
              <span className="ml-auto text-[10px] text-text-muted truncate max-w-[80px]" title={p.message}>
                {cfg.label}
              </span>
            </div>
          );
        })}
        {providers.length === 0 && (
          <p className="text-xs text-text-muted">Нет провайдеров</p>
        )}
      </div>
    </div>
  );
}
