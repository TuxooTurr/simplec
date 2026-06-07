"use client";

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

/* ── Shared classes ───────────────────────────────────────────── */

const inputBase =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150";

const inputSm =
  "w-full border border-border-main rounded-md px-2 py-1 text-xs " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-1 focus:ring-primary/30";

/* ── Input ────────────────────────────────────────────────────── */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  sm?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ sm, className = "", ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`${sm ? inputSm : inputBase} ${className}`}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";

/* ── Textarea ────────────────────────────────────────────────── */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  sm?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ sm, className = "", ...rest }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`${sm ? inputSm : inputBase} resize-y ${className}`}
        {...rest}
      />
    );
  },
);
Textarea.displayName = "Textarea";

/* ── Select ───────────────────────────────────────────────────── */

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  sm?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ sm, className = "", children, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        className={`${sm ? inputSm : inputBase} ${className}`}
        {...rest}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";

/* ── Label ────────────────────────────────────────────────────── */

export function Label({
  children,
  className = "",
  ...rest
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5 ${className}`}
      {...rest}
    >
      {children}
    </label>
  );
}

/* ── Style constants (backward compat) ────────────────────────── */

export const INPUT_CLS = inputBase;
export const INPUT_SM  = inputSm;
export const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

export default Input;
