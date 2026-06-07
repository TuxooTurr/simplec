"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { getProviders, type ProviderStatus } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const STATUS_CONFIG: Record<string, { dot: string; ring: string; label: string }> = {
  green:  { dot: "bg-green-500",  ring: "bg-green-400/30",  label: "Работает" },
  yellow: { dot: "bg-yellow-400", ring: "bg-yellow-300/40", label: "Ограничен" },
  red:    { dot: "bg-red-500",    ring: "bg-red-400/30",    label: "Недоступен" },
};

export default function LLMStatusBar() {
  const { provider, setProvider, providersRefreshKey } = useWorkspace();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const providerRef = useRef(provider);

  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useEffect(() => {
    let cancelled = false;

    getProviders()
      .then((statuses) => {
        if (cancelled) return;

        setProviders(statuses);
        const providerIds = new Set(statuses.map((s) => s.id));
        if (statuses.length > 0 && !providerIds.has(providerRef.current)) {
          setProvider(statuses[0].id);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHasLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [providersRefreshKey, setProvider]);

  return (
    <div>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Статус LLM</p>
      <div className="flex flex-col gap-1.5">
        {providers.map((p) => {
          const cfg = STATUS_CONFIG[p.status] ?? { dot: "bg-gray-400", ring: "bg-bg-muted/30", label: "—" };
          const isPulsing = p.status === "green" || p.status === "yellow";
          const isActive = provider === p.id;

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setProvider(p.id)}
              title={`${p.name}: ${p.message}`}
              className={`
                flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-xs
                transition-colors text-left
                ${isActive
                  ? "border-primary bg-[var(--color-active-bg)] text-primary"
                  : "border-transparent text-text-main hover:border-border-main hover:bg-[var(--color-sidebar-hover)]"}
                cursor-pointer
              `}
            >
              <span className="relative flex-shrink-0 w-2.5 h-2.5">
                {isPulsing && (
                  <span className={`absolute inset-0 rounded-full ${cfg.ring} animate-ping`} />
                )}
                <span className={`relative block w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
              </span>
              <span className={`font-medium truncate ${isActive ? "text-primary" : "text-text-main"}`}>
                {p.name}
              </span>
              {isActive && <Check className="w-3 h-3 flex-shrink-0" />}
              <span className="ml-auto text-[10px] text-text-muted truncate max-w-[72px]">
                {cfg.label}
              </span>
            </button>
          );
        })}
        {hasLoaded && providers.length === 0 && (
          <p className="text-xs text-text-muted">Нет провайдеров</p>
        )}
      </div>
    </div>
  );
}
