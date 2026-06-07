"use client";

import type { ReactNode } from "react";

/* ── Variant definitions ──────────────────────────────────────── */

const badgeVariants = {
  default:  "bg-bg-subtle text-text-muted border-border-main",
  primary:  "bg-primary/10 text-primary border-primary/20",
  success:  "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
  warning:  "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800",
  danger:   "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
  info:     "bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800",
  orange:   "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800",
  lime:     "bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-900/20 dark:text-lime-400 dark:border-lime-800",
  amber:    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
} as const;

export type BadgeVariant = keyof typeof badgeVariants;

/* ── Component ────────────────────────────────────────────────── */

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  /** dot color class — prepends a small status dot */
  dot?: string;
}

export function Badge({ variant = "default", children, className = "", dot }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${badgeVariants[variant]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}

export default Badge;
