"use client";

import { ToggleLeft, ToggleRight } from "lucide-react";

export interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}

export function Toggle({ label, value, onChange, className = "" }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2 text-sm font-medium transition-colors ${
        value ? "text-primary" : "text-text-muted"
      } ${className}`}
    >
      {value
        ? <ToggleRight className="w-5 h-5" />
        : <ToggleLeft  className="w-5 h-5" />}
      {label}
    </button>
  );
}

export default Toggle;
