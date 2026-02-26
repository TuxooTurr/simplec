"use client";

import { useEffect, useState } from "react";
import { getProviders, type ProviderStatus } from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
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
    return <p className="text-xs text-text-muted">Проверка LLM...</p>;
  }

  return (
    <div>
      <p className="text-xs text-text-muted mb-1.5 font-medium">Статус LLM</p>
      <div className="flex flex-col gap-1">
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs text-text-muted">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLOR[p.status] ?? "bg-gray-400"}`}
              title={p.message}
            />
            <span className="font-medium text-text-main">{p.name}</span>
            <span className="truncate">{p.message}</span>
          </div>
        ))}
        {providers.length === 0 && (
          <p className="text-xs text-text-muted">Нет доступных провайдеров</p>
        )}
      </div>
    </div>
  );
}
