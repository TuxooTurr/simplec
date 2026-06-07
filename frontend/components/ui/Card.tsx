"use client";

import type { ReactNode, HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Add padding — true by default */
  padded?: boolean;
}

export function Card({ children, padded = true, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`bg-bg-card border border-border-main rounded-xl shadow-sm ${
        padded ? "p-5" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Section page header — title + optional actions row */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title:     string;
  subtitle?: string;
  icon?:     ReactNode;
  actions?:  ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-5">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            {icon}
          </div>
        )}
        <div>
          <h2 className="text-lg font-bold text-text-main leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default Card;
