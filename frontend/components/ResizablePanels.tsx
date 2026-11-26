"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { X, PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { SectionId } from "@/contexts/WorkspaceContext";
import TopActions from "./TopActions";
import { usePanelRefreshSlot } from "./ui/RefreshButton";
import { PanelAuditContext, type PanelAudit, type SetPanelAudit } from "./PanelAudit";

/** Название раздела в шапке панели — единственный заголовок раздела (внутри раздела его не повторяем).
 *  Ключи — путь страницы (test-data) и id раздела правой панели (test_data). */
const SECTION_LABELS: Record<string, string> = {
  dashboard: "Главная",
  generation: "Тестовая модель",
  "test-data": "Тестовые данные", test_data: "Тестовые данные",
  etalons: "Данные",
  bugs: "Jira tool",
  zephyr: "Zephyr Tool",
  stands: "График стендов",
  aqa: "Трекинг AQA",
  logs: "Логи",
  kafka: "Просмотр Kafka",
  "event-generators": "Генераторы событий", event_generators: "Генераторы событий",
  "model-bench": "Тестирование моделей LLM", model_bench: "Тестирование моделей LLM",
  settings: "Настройки",
  alerts: "Алерты",
  metrics: "Метрики",
  jobs: "Jobs",
  revisor: "Ревизор",
  "auto-model": "Автотестирование", auto_model: "Автотестирование",
};

// ─── Panel Chrome ─────────────────────────────────────────────────────────────
function PanelChrome({
  title,
  actions,
  onClose,
  onActivate,
  setAudit,
  children,
  dropTarget,
  isDraggingSection,
  onDragOver,
  onDrop,
}: {
  title: string;
  /** Верхний правый угол окна — только у крайней справа панели. */
  actions?: React.ReactNode;
  onClose: () => void;
  onActivate: () => void;
  setAudit: SetPanelAudit;
  children: React.ReactNode;
  dropTarget?: boolean;
  isDraggingSection?: boolean;
  onDragOver?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
}) {
  // «Обновить» раздела — всегда здесь, справа от названия панели (раздел передаёт его через usePanelRefresh).
  const [refreshButton, provideRefresh] = usePanelRefreshSlot();
  return (
    <div
      className={`flex flex-col h-full transition-all duration-150 ${
        dropTarget && isDraggingSection
          ? "ring-2 ring-inset ring-primary/40 bg-primary/5"
          : ""
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-20 flex h-11 items-center justify-between gap-3 px-6 border-b border-border-main bg-[var(--color-chrome)] flex-shrink-0">
        <div className="flex min-w-0 items-center gap-1.5" onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
          <span className="truncate text-sm font-semibold text-text-main tracking-wide">
            {title}
          </span>
          {refreshButton}
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1 hover:bg-bg-subtle text-text-muted hover:text-text-main transition-colors"
            title="Закрыть панель"
            aria-label="Закрыть панель"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {actions}
      </div>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin"
        onPointerDownCapture={e => { if (e.currentTarget.contains(e.target as Node)) onActivate(); }}
        onFocusCapture={e => { if (e.currentTarget.contains(e.target as Node)) onActivate(); }}>
        <PanelAuditContext.Provider value={setAudit}>{provideRefresh(children)}</PanelAuditContext.Provider>
      </div>
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
      className="flex flex-col items-center justify-center w-10 h-full bg-bg-card border-r border-border-main hover:bg-primary/10 transition-colors text-text-muted hover:text-primary flex-shrink-0"
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
  const [leftAudit, setLeftAudit] = useState<PanelAudit | null>(null);
  const [rightAudit, setRightAudit] = useState<PanelAudit | null>(null);

  const {
    activePane,
    setActivePane,
    dragging: sectionDragging,
    rightSection,
    setRightSection,
    leftVisible,
    setLeftVisible,
    rightOpen,
    setRightOpen,
  } = useWorkspace();

  useEffect(() => setActivePane("left"), [pathname, setActivePane]);

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
        setActivePane("right");
      }
    },
    [setRightSection, setRightOpen, setActivePane]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const useRightAudit = rightOpen && (!leftVisible || activePane === "right");
  const audit = useRightAudit ? rightAudit : leftVisible ? leftAudit : null;
  const activeSection = useRightAudit ? `right:${rightSection ?? ""}` : `left:${leftVisible ? pathname : ""}`;
  const actions = <TopActions audit={audit} auditContext={activeSection}
    sectionTitle={useRightAudit ? rightTitle : leftVisible ? leftTitle : "Рабочая область"} />;

  const closeRight = useCallback(() => {
    setRightOpen(false);
    setRightSection(null);
  }, [setRightOpen, setRightSection]);

  // ── Render states ─────────────────────────────────────────────────────────
  const showLeft = leftVisible;
  const showRight = rightOpen;

  // Neither panel — should not normally happen (left starts visible)
  if (!showLeft && !showRight) {
    return (
      <div
        ref={containerRef}
        className="relative flex flex-1 min-h-0 h-full overflow-hidden"
      >
        <RestoreStrip side="left" onClick={() => { setLeftVisible(true); setActivePane("left"); }} />
        <div className="absolute right-6 top-2 z-20">{actions}</div>
        <div
          className={`flex-1 flex items-center justify-center text-text-muted text-sm transition-all ${
            sectionDragging ? "ring-2 ring-inset ring-primary/40 bg-primary/5" : ""
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
        <RestoreStrip side="left" onClick={() => { setLeftVisible(true); setActivePane("left"); }} />
        <div className="flex-1 h-full flex flex-col animate-panel-in-right">
          <PanelChrome
            title={rightTitle}
            onActivate={() => setActivePane("right")}
            setAudit={setRightAudit}
            actions={actions}
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
          className={`flex-1 min-w-0 h-full flex flex-col transition-all ${
            sectionDragging ? "ring-2 ring-inset ring-primary/40 bg-primary/5" : ""
          }`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <PanelChrome
            title={leftTitle}
            onActivate={() => setActivePane("left")}
            setAudit={setLeftAudit}
            actions={actions}
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
          onActivate={() => setActivePane("left")}
          setAudit={setLeftAudit}
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
        className="h-full flex flex-col flex-1 animate-panel-in-right"
      >
        <PanelChrome
          title={rightTitle}
          onActivate={() => setActivePane("right")}
          setAudit={setRightAudit}
          actions={actions}
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
