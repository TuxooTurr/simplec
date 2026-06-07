"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** max-w class (default: max-w-md) */
  size?: string;
}

export function Modal({ open, onClose, title, children, size = "max-w-md" }: ModalProps) {
  /* ESC to close */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--color-modal-overlay)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${size} rounded-xl shadow-2xl p-6 animate-slide-up
          bg-[var(--color-modal-bg)] border border-border-main`}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-text-main">{title}</h3>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-bg-subtle text-text-muted hover:text-text-main transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default Modal;
