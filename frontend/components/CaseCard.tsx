"use client";

import { useState } from "react";
import { ChevronDown, Database, Monitor, Globe, FlaskConical } from "lucide-react";
import type { Case } from "@/lib/useGeneration";

interface CaseCardProps {
  index: number;
  case_: Case;
  className?: string;
  style?: React.CSSProperties;
}

const PRIORITY_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
  High:   { bg: "bg-red-50",   text: "text-red-700",  dot: "bg-red-400" },
  Normal: { bg: "bg-blue-50",  text: "text-blue-700", dot: "bg-blue-400" },
  Low:    { bg: "bg-gray-50",  text: "text-gray-600", dot: "bg-gray-400" },
};

const TYPE_LABELS: Record<string, string> = {
  positive:    "позитивный",
  negative:    "негативный",
  boundary:    "граничный",
  integration: "интеграционный",
  security:    "безопасность",
};

const STEP_FIELDS = [
  { key: "test_data", label: "Данные",  Icon: FlaskConical, color: "text-violet-500" },
  { key: "ui",        label: "UI",      Icon: Monitor,      color: "text-blue-500" },
  { key: "api",       label: "API",     Icon: Globe,        color: "text-orange-500" },
  { key: "db",        label: "БД",      Icon: Database,     color: "text-green-600" },
] as const;

export default function CaseCard({ index, case_, className = "", style }: CaseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const prio = case_.priority ?? "Normal";
  const type = case_.case_type ?? "positive";
  const prioCfg = PRIORITY_CONFIG[prio] ?? PRIORITY_CONFIG.Normal;

  return (
    <div
      className={`bg-white border border-border-main rounded-xl mb-2.5 overflow-hidden
        transition-shadow duration-200 hover:shadow-sm animate-slide-up ${className}`}
      style={style}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/70 transition-colors"
      >
        <span className="text-xs text-text-muted font-mono w-5 flex-shrink-0 text-center">{index}</span>

        <span className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${prioCfg.bg} ${prioCfg.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${prioCfg.dot}`} />
          {prio}
        </span>

        <span className="text-sm font-medium text-text-main flex-1 truncate">{case_.name}</span>

        <span className="text-[11px] text-text-muted flex-shrink-0 hidden sm:block">
          {TYPE_LABELS[type] ?? type}
        </span>

        <ChevronDown
          className={`w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded steps */}
      {expanded && (
        <div className="border-t border-border-main animate-fade-in">
          {case_.steps.map((step, i) => (
            <div key={i} className="px-4 py-3.5 border-b border-border-main/60 last:border-0">
              {/* Step action */}
              <div className="flex items-start gap-2 mb-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-50 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm font-medium text-text-main leading-snug">{step.action}</p>
              </div>

              {/* Fields grid */}
              <div className="ml-7 grid grid-cols-1 gap-1.5">
                {STEP_FIELDS.map(({ key, label, Icon, color }) => {
                  const val = step[key as keyof typeof step];
                  if (!val || val === "-") return null;
                  return (
                    <div key={key} className="flex gap-2 text-xs">
                      <span className={`flex items-center gap-1 ${color} font-medium w-20 flex-shrink-0`}>
                        <Icon className="w-3 h-3" />
                        {label}
                      </span>
                      <span className="text-text-main">{val}</span>
                    </div>
                  );
                })}
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
