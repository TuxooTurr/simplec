"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** max-w class (default: max-w-md) */
  size?: string;
  /** Кнопки в шапке рядом с крестиком (например, «Свернуть»). */
  headerExtra?: ReactNode;
}

/* Открытые окна по порядку открытия. Esc закрывает только верхнее: окно, открытое поверх другого
   (менеджер драйверов поверх подключений, подтверждение поверх формы), не закрывает заодно и нижнее. */
const openStack: number[] = [];
let nextId = 1;

export function Modal({ open, onClose, title, children, size = "max-w-md", headerExtra }: ModalProps) {
  // Keep the dialog mounted briefly after `open` flips to false so the
  // close animation can play out.
  const [rendered, setRendered] = useState(open);
  const closeTimer = useRef<number | null>(null);
  const idRef = useRef(0);
  if (!idRef.current) idRef.current = nextId++;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

  /* Esc закрывает верхнее окно; фокус — в окно при открытии и обратно на кнопку, которой открыли, после закрытия */
  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    const opener = document.activeElement as HTMLElement | null;
    openStack.push(id);
    // Фокус в окно, если внутри ещё ничего не взяло его само (autoFocus у поля).
    const t = window.setTimeout(() => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    }, 0);
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openStack[openStack.length - 1] !== id) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", h);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", h);
      const i = openStack.lastIndexOf(id);
      if (i >= 0) openStack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // На сервере (SSR) document нет — открытое окно появится после загрузки страницы.
  if (!rendered || typeof document === "undefined") return null;

  const closing = !open;

  // Окно — в document.body, а не там, где его открыли: у предка с transform, filter или backdrop-filter
  // (шапка панели с размытием фона) position: fixed считается от этого предка, а не от экрана, и окно уезжало
  // за верх экрана (кнопка «Резервная копия» в шапке панели).
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 t-modal-overlay ${closing ? "is-closing" : ""}`}
      style={{ backgroundColor: "var(--color-modal-overlay)" }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full ${size} flex-col rounded-xl shadow-2xl t-modal-panel ${closing ? "is-closing" : ""}
          bg-[var(--color-modal-bg)] border border-border-main outline-none`}
      >
        {/* Header — не скроллится, всегда виден крестик закрытия */}
        {title && (
          <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
            <h3 className="text-base font-semibold text-text-main">{title}</h3>
            <div className="flex items-center gap-1">
              {headerExtra}
              <button
                onClick={onClose}
                aria-label="Закрыть"
                className="p-1 rounded-lg hover:bg-bg-subtle text-text-muted hover:text-text-main transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        {/* Тело — скроллится, если контент выше окна: кнопки больше не уезжают за экран */}
        <div className={`overflow-y-auto px-6 pb-6 ${title ? "" : "pt-6"}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
