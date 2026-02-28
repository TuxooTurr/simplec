"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { X, PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { SectionId } from "@/contexts/WorkspaceContext";

const SECTION_LABELS: Record<string, string> = {
  generation: "Генерация",
  etalons: "Эталоны",
  bugs: "Дефекты",
  alerts: "Алерты",
  metrics: "Метрики",
  revisor: "Ревизор",
};

// ─── Panel Chrome ─────────────────────────────────────────────────────────────
function PanelChrome({
  title,
  onClose,
  children,
  dropTarget,
  isDraggingSection,
  onDragOver,
  onDrop,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  dropTarget?: boolean;
  isDraggingSection?: boolean;
  onDragOver?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
}) {
  return (
    <div
      className={`flex flex-col h-full transition-all duration-150 ${
        dropTarget && isDraggingSection
          ? "ring-2 ring-inset ring-primary/40 bg-indigo-50/30"
          : ""
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-2 border-b border-border-main bg-white/90 backdrop-blur-sm flex-shrink-0">
        <span className="text-sm font-semibold text-text-secondary tracking-wide">
          {title}
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1 hover:bg-gray-100 text-text-muted hover:text-text-primary transition-colors"
          title="Закрыть панель"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
    </div>
  );
}

// ─── Restore strip ────────────────────────────────────────────────────────────
function RestoreStrip({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  const title = side === "left" ? "Восстановить левую панель" : "Восстановить правую панель";
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center w-10 h-full bg-bg-secondary border-r border-border-main hover:bg-indigo-50 transition-colors text-text-muted hover:text-primary flex-shrink-0"
      title={title}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface ResizablePanelsProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultSplit?: number; // 0-100
}

export default function ResizablePanels({
  left,
  right,
  defaultSplit = 55,
}: ResizablePanelsProps) {
  const [split, setSplit] = useState(defaultSplit);
  const [isDividerDragging, setIsDividerDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const {
    dragging: sectionDragging,
    rightSection,
    setRightSection,
    leftVisible,
    setLeftVisible,
    rightOpen,
    setRightOpen,
  } = useWorkspace();

  const leftTitle =
    SECTION_LABELS[pathname?.replace(/^\//, "") ?? ""] ?? "Рабочая зона";
  const rightTitle = rightSection
    ? SECTION_LABELS[rightSection] ?? rightSection
    : "Правая панель";

  // ── Divider drag ────────────────────────────────────────────────────────────
  const startDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDividerDragging(true);
  }, []);

  useEffect(() => {
    if (!isDividerDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.max(25, Math.min(75, pct)));
    };
    const onUp = () => setIsDividerDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDividerDragging]);

  // ── Drop handler ─────────────────────────────────────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("sectionId") as SectionId;
      if (id) {
        setRightSection(id);
        setRightOpen(true);
      }
    },
    [setRightSection, setRightOpen]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const closeRight = useCallback(() => {
    setRightOpen(false);
    setRightSection(null);
  }, [setRightOpen, setRightSection]);

  const openRight = useCallback(() => {
    setRightOpen(true);
  }, [setRightOpen]);

  // ── Render states ─────────────────────────────────────────────────────────
  const showLeft = leftVisible;
  const showRight = rightOpen;

  // Neither panel — should not normally happen (left starts visible)
  if (!showLeft && !showRight) {
    return (
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 h-full overflow-hidden"
      >
        <RestoreStrip side="left" onClick={() => setLeftVisible(true)} />
        <div
          className={`flex-1 flex items-center justify-center text-text-muted text-sm transition-all ${
            sectionDragging ? "ring-2 ring-inset ring-primary/40 bg-indigo-50/30" : ""
          }`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {sectionDragging
            ? "Отпустите для открытия"
            : "Нет открытых панелей — перетащите раздел сюда"}
        </div>
      </div>
    );
  }

  // Only right panel
  if (!showLeft && showRight) {
    return (
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 h-full overflow-hidden"
      >
        <RestoreStrip side="left" onClick={() => setLeftVisible(true)} />
        <div className="flex-1 h-full flex flex-col">
          <PanelChrome
            title={rightTitle}
            onClose={closeRight}
            dropTarget
            isDraggingSection={!!sectionDragging}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {right}
          </PanelChrome>
        </div>
      </div>
    );
  }

  // Only left panel
  if (showLeft && !showRight) {
    return (
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 h-full overflow-hidden"
      >
        <div
          className={`flex-1 h-full flex flex-col transition-all ${
            sectionDragging ? "ring-2 ring-inset ring-primary/40 bg-indigo-50/30" : ""
          }`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <PanelChrome
            title={leftTitle}
            onClose={() => setLeftVisible(false)}
          >
            {left}
          </PanelChrome>
        </div>
      </div>
    );
  }

  // Both panels — split view
  return (
    <div
      ref={containerRef}
      className={`flex flex-1 min-h-0 h-full overflow-hidden ${
        isDividerDragging ? "select-none cursor-col-resize" : ""
      }`}
    >
      {/* Left panel */}
      <div
        style={{ width: `${split}%` }}
        className="h-full flex flex-col flex-shrink-0"
      >
        <PanelChrome
          title={leftTitle}
          onClose={() => setLeftVisible(false)}
        >
          {left}
        </PanelChrome>
      </div>

      {/* Divider */}
      <div
        onMouseDown={startDividerDrag}
        className={`
          w-1 flex-shrink-0 cursor-col-resize transition-colors duration-150 relative z-10
          ${isDividerDragging ? "bg-primary/70" : "bg-border-main hover:bg-primary/40"}
        `}
        title="Перетащите для изменения размера"
      />

      {/* Right panel */}
      <div
        style={{ width: `calc(${100 - split}% - 4px)` }}
        className="h-full flex flex-col flex-1"
      >
        <PanelChrome
          title={rightTitle}
          onClose={closeRight}
          dropTarget
          isDraggingSection={!!sectionDragging}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {right}
        </PanelChrome>
      </div>
    </div>
  );
}
