"use client";

import { useEffect, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";

/**
 * Окно кейса поверх раздела. «Свернуть» (кнопка в шапке карточки, Esc, клик мимо окна) убирает его в плашку
 * внизу справа — карточка при этом не закрывается, начатая правка не теряется; клик по плашке разворачивает.
 */
export default function CaseDialog({ label, title, minimized, onMinimize, onRestore, onClose, children }: {
  /** Для чтения с экрана: «Кейс ICON-T1». */
  label: string;
  /** Текст плашки свёрнутого окна. */
  title: string;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (minimized) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onMinimize(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [minimized, onMinimize]);

  return (
    <>
      <div className={`fixed inset-0 z-40 flex items-center justify-center p-6 ${minimized ? "hidden" : ""}`}
        style={{ backgroundColor: "var(--color-modal-overlay)" }} onClick={onMinimize}>
        <div role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}
          className="flex flex-col w-full max-w-3xl h-[86vh] rounded-xl overflow-hidden shadow-2xl border border-border-main bg-bg-card">
          {children}
        </div>
      </div>
      {minimized && (
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 max-w-sm rounded-xl border border-border-main bg-bg-card shadow-lg pl-3 pr-1 py-1">
          <button type="button" onClick={onRestore} title="Развернуть" className="min-w-0 flex-1 flex items-center gap-2 py-1 text-left text-sm text-text-main hover:text-primary">
            <Maximize2 className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
            <span className="truncate">{title}</span>
          </button>
          <button type="button" onClick={onClose} aria-label="Закрыть кейс" className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle">
            <X className="w-4 h-4" /></button>
        </div>
      )}
    </>
  );
}
