"use client";

import { PanelRight } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import GenerationSection from "./sections/GenerationSection";
import EtalonsSection from "./sections/EtalonsSection";
import BugsSection from "./sections/BugsSection";
import AlertsSection from "./sections/AlertsSection";
import MetricsSection from "./sections/MetricsSection";
import RevisorSection from "./sections/RevisorSection";

export default function SectionRenderer() {
  const { rightSection, dragging } = useWorkspace();

  if (!rightSection) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center select-none">
        <div
          className={`
            w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center
            transition-all duration-200
            ${dragging
              ? "border-primary/60 bg-indigo-50/60 scale-110"
              : "border-border-main bg-white/60"}
          `}
        >
          <PanelRight
            className={`w-9 h-9 transition-colors duration-200 ${dragging ? "text-primary/70" : "text-border-main"}`}
          />
        </div>
        <div>
          <p className={`text-sm font-medium transition-colors duration-200 ${dragging ? "text-primary" : "text-text-muted"}`}>
            {dragging ? "Отпустите для открытия" : "Перетащите раздел сюда"}
          </p>
          <p className="text-xs text-text-muted/60 mt-0.5">
            Поддерживается одновременная работа с несколькими разделами
          </p>
        </div>
      </div>
    );
  }

  const sections: Record<string, React.ReactNode> = {
    generation: <GenerationSection />,
    etalons:    <EtalonsSection />,
    bugs:       <BugsSection />,
    alerts:     <AlertsSection />,
    metrics:    <MetricsSection />,
    revisor:    <RevisorSection />,
  };

  return <>{sections[rightSection] ?? null}</>;
}
