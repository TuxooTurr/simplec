"use client";

import { useState } from "react";
import type { Case } from "@/lib/useGeneration";

interface CaseCardProps {
  index: number;
  case_: Case;
}

const PRIORITY_COLORS: Record<string, string> = {
  High: "bg-red-100 text-red-700",
  Normal: "bg-blue-100 text-blue-700",
  Low: "bg-gray-100 text-gray-600",
};

const TYPE_LABELS: Record<string, string> = {
  positive: "позитивный",
  negative: "негативный",
  boundary: "граничный",
  integration: "интеграционный",
  security: "безопасность",
};

export default function CaseCard({ index, case_ }: CaseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const prio = case_.priority ?? "Normal";
  const type = case_.case_type ?? "positive";

  return (
    <div className="bg-white border border-border-main rounded-xl mb-3 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-text-muted text-sm font-mono w-6 flex-shrink-0">{index}.</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${PRIORITY_COLORS[prio] ?? "bg-gray-100 text-gray-600"}`}
        >
          {prio}
        </span>
        <span className="text-sm font-medium text-text-main flex-1 truncate">{case_.name}</span>
        <span className="text-xs text-text-muted flex-shrink-0">{TYPE_LABELS[type] ?? type}</span>
        <span className="text-text-muted flex-shrink-0 ml-1">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded steps */}
      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main">
          {case_.steps.map((step, i) => (
            <div key={i} className="px-4 py-3">
              <p className="text-sm font-medium text-text-main mb-2">
                <span className="text-primary mr-2">Шаг {i + 1}.</span>
                {step.action}
              </p>
              <div className="grid grid-cols-1 gap-1 text-xs">
                {step.test_data && step.test_data !== "-" && (
                  <div className="flex gap-2">
                    <span className="text-text-muted w-24 flex-shrink-0">Данные:</span>
                    <span className="text-text-main">{step.test_data}</span>
                  </div>
                )}
                {step.ui && step.ui !== "-" && (
                  <div className="flex gap-2">
                    <span className="text-text-muted w-24 flex-shrink-0">UI:</span>
                    <span className="text-text-main">{step.ui}</span>
                  </div>
                )}
                {step.api && step.api !== "-" && (
                  <div className="flex gap-2">
                    <span className="text-text-muted w-24 flex-shrink-0">API:</span>
                    <span className="text-text-main font-mono text-xs">{step.api}</span>
                  </div>
                )}
                {step.db && step.db !== "-" && (
                  <div className="flex gap-2">
                    <span className="text-text-muted w-24 flex-shrink-0">БД:</span>
                    <span className="text-text-main">{step.db}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {case_.steps.length === 0 && (
            <p className="px-4 py-3 text-sm text-text-muted">Шаги не распарсились</p>
          )}
        </div>
      )}
    </div>
  );
}
