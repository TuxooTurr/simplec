"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/* ── Variant styles ───────────────────────────────────────────── */

const base =
  "inline-flex items-center justify-center gap-1.5 font-medium " +
  "transition-[color,background-color,border-color,transform] duration-150 " +
  "disabled:opacity-50 disabled:cursor-not-allowed select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-card " +
  "active:scale-[0.98]";

const variants = {
  primary:
    "bg-primary text-white hover:bg-primary/90 " +
    "rounded-lg px-3 py-1.5 text-sm",
  ghost:
    "border border-border-main text-text-main hover:bg-bg-subtle " +
    "rounded-lg px-3 py-1.5 text-sm",
  danger:
    "border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30 " +
    "rounded-lg px-3 py-1.5 text-sm",
  sm:
    "border border-border-main text-text-muted hover:bg-bg-subtle " +
    "rounded-md px-2 py-1 text-xs",
  icon:
    "p-1.5 rounded-lg text-text-muted hover:bg-bg-subtle hover:text-text-main " +
    "transition-colors",
} as const;

export type ButtonVariant = keyof typeof variants;

/* ── Component ───────────────────────────────────────────────── */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, icon, children, className = "", disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${variants[variant]} ${className}`}
        {...rest}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
export default Button;
