"use client";

import Sidebar from "./Sidebar";
import ResizablePanels from "./ResizablePanels";
import SectionRenderer from "./SectionRenderer";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { GenerationProvider } from "@/contexts/GenerationContext";
import { AlertsSchedulerProvider } from "@/contexts/AlertsSchedulerContext";
import { MetricsUiProvider } from "@/contexts/MetricsUiContext";

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <GenerationProvider>
        <AlertsSchedulerProvider>
          <MetricsUiProvider>
            <div className="flex h-screen bg-bg-main overflow-hidden">
              <Sidebar />
              <ResizablePanels
                left={children}
                right={<SectionRenderer />}
              />
            </div>
          </MetricsUiProvider>
        </AlertsSchedulerProvider>
      </GenerationProvider>
    </WorkspaceProvider>
  );
}
