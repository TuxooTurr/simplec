"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface ResizablePanelsProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultSplit?: number; // 0-100, default 55
}

export default function ResizablePanels({
  left,
  right,
  defaultSplit = 55,
}: ResizablePanelsProps) {
  const [split, setSplit] = useState(defaultSplit);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { dragging: sectionDragging, setRightSection } = useWorkspace();

  const startDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.max(25, Math.min(75, pct)));
    };
    const onUp = () => setIsDragging(false);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 min-h-0 h-full overflow-hidden ${isDragging ? "select-none cursor-col-resize" : ""}`}
    >
      {/* Left panel */}
      <div
        style={{ width: `${split}%` }}
        className="overflow-y-auto h-full scrollbar-thin flex-shrink-0"
      >
        {left}
      </div>

      {/* Divider */}
      <div
        onMouseDown={startDividerDrag}
        className={`
          w-1 flex-shrink-0 cursor-col-resize transition-colors duration-150 relative z-10
          ${isDragging ? "bg-primary/70" : "bg-border-main hover:bg-primary/40"}
        `}
        title="Перетащите для изменения размера"
      />

      {/* Right panel — drop target */}
      <div
        style={{ width: `calc(${100 - split}% - 4px)` }}
        className={`
          overflow-y-auto h-full scrollbar-thin flex flex-col flex-1 relative transition-all duration-150
          ${sectionDragging ? "ring-2 ring-inset ring-primary/40 bg-indigo-50/30" : ""}
        `}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("sectionId") as SectionId;
          if (id) setRightSection(id);
        }}
      >
        {right}
      </div>
    </div>
  );
}

// Re-export type for DnD
type SectionId = import("@/contexts/WorkspaceContext").SectionId;
