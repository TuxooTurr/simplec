"use client";

import { backdropClose } from "@/lib/backdrop";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Minus, X } from "lucide-react";
import { FORM_DOCK_ID } from "@/components/FormHost";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** max-w class (default: max-w-md) */
  size?: string;
  /** Кнопки в шапке рядом с крестиком. */
  headerExtra?: ReactNode;
  /**
   * Кнопка «Свернуть» в шапке (по умолчанию — у любого окна с заголовком). Свёрнутое окно прячется ярлыком на полку
   * внизу справа, а содержимое остаётся смонтированным: запись в Jira, генерация и прочая работа идут дальше.
   * false — для окон со своим сворачиванием (форма задачи Jira tool через openForm).
   */
  minimizable?: boolean;
}

/* Открытые окна по порядку открытия. Esc закрывает только верхнее: окно, открытое поверх другого
   (менеджер драйверов поверх подключений, подтверждение поверх формы), не закрывает заодно и нижнее. */
const openStack: number[] = [];
let nextId = 1;

export function Modal({ open, onClose, title, children, size = "max-w-md", headerExtra, minimizable = true }: ModalProps) {
  const [minimized, setMinimized] = useState(false);
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
      closeTimer.current = window.setTimeout(() => { setRendered(false); setMinimized(false); }, 160);
    }
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, [open, rendered]);

  /* Esc закрывает верхнее окно; фокус — в окно при открытии и обратно на кнопку, которой открыли, после закрытия */
  useEffect(() => {
    if (!open || minimized) return;     // свёрнутое не держит фокус и не закрывается по Esc
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
  }, [open, minimized]);

  // На сервере (SSR) document нет — открытое окно появится после загрузки страницы.
  if (!rendered || typeof document === "undefined") return null;

  const closing = !open;
  const canMinimize = minimizable && !!title;

  // Ярлык свёрнутого окна — на полке форм (FormHost), а без неё — в своём углу.
  const dock = typeof document !== "undefined" ? document.getElementById(FORM_DOCK_ID) : null;
  const chip = minimized && open && (
    <div className="flex w-72 items-center gap-1 rounded-xl border border-border-main bg-[var(--color-modal-bg)] pl-3 pr-1 py-1.5 text-sm shadow-lg">
      <button type="button" onClick={() => setMinimized(false)} title="Развернуть окно"
        className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-text-main">{title}</span>
          <span className="block text-[11px] text-text-muted">Свёрнуто — работа продолжается</span>
        </span>
        <ChevronUp className="h-4 w-4 flex-shrink-0 text-text-muted" />
      </button>
      <button type="button" onClick={onClose} aria-label={`Закрыть «${title}»`} title="Закрыть"
        className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle"><X className="h-3.5 w-3.5" /></button>
    </div>
  );

  // Окно — в document.body, а не там, где его открыли: у предка с transform, filter или backdrop-filter
  // (шапка панели с размытием фона) position: fixed считается от этого предка, а не от экрана, и окно уезжало
  // за верх экрана (кнопка «Резервная копия» в шапке панели).
  return (<>
    {chip && createPortal(dock ? chip : <div className="fixed bottom-4 right-4 z-40">{chip}</div>, dock ?? document.body)}
    {createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 t-modal-overlay ${closing ? "is-closing" : ""} ${minimized ? "hidden" : ""}`}
      style={{ backgroundColor: "var(--color-modal-overlay)" }}
      {...backdropClose(onClose)}
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
              {canMinimize && (
                <button
                  onClick={() => setMinimized(true)}
                  aria-label="Свернуть окно"
                  title="Свернуть: окно уйдёт на полку внизу справа, работа в нём продолжится"
                  className="p-1 rounded-lg hover:bg-bg-subtle text-text-muted hover:text-text-main transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Minus className="w-4 h-4" />
                </button>
              )}
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
  )}
  </>);
}

export default Modal;
