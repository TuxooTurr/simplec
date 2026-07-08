"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  // Keep the dialog mounted briefly after `open` flips to false so the
  // close animation can play out.
  const [rendered, setRendered] = useState(open);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      setRendered(true);
    } else if (rendered) {
      closeTimer.current = window.setTimeout(() => setRendered(false), 160);
    }
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, [open, rendered]);

  /* ESC to close */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!rendered) return null;

  const closing = !open;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 t-modal-overlay ${closing ? "is-closing" : ""}`}
      style={{ backgroundColor: "var(--color-modal-overlay)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full ${size} flex-col rounded-xl shadow-2xl t-modal-panel ${closing ? "is-closing" : ""}
          bg-[var(--color-modal-bg)] border border-border-main`}
      >
        {/* Header — не скроллится, всегда виден крестик закрытия */}
        {title && (
          <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
            <h3 className="text-base font-semibold text-text-main">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="p-1 rounded-lg hover:bg-bg-subtle text-text-muted hover:text-text-main transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {/* Тело — скроллится, если контент выше окна: кнопки больше не уезжают за экран */}
        <div className={`overflow-y-auto px-6 pb-6 ${title ? "" : "pt-6"}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
