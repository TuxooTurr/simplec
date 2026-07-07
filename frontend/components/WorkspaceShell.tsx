"use client";

import Sidebar from "./Sidebar";
import ResizablePanels from "./ResizablePanels";
import SectionRenderer from "./SectionRenderer";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { GenerationProvider } from "@/contexts/GenerationContext";
import { AlertsSchedulerProvider } from "@/contexts/AlertsSchedulerContext";
import { MetricsUiProvider } from "@/contexts/MetricsUiContext";
import { TestDataJobProvider } from "@/contexts/TestDataJobContext";

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <GenerationProvider>
        <AlertsSchedulerProvider>
          <MetricsUiProvider>
            <TestDataJobProvider>
              <div className="flex h-screen bg-bg-main overflow-hidden">
                <Sidebar />
                <ResizablePanels
                  left={children}
                  right={<SectionRenderer />}
                />
              </div>
            </TestDataJobProvider>
          </MetricsUiProvider>
        </AlertsSchedulerProvider>
      </GenerationProvider>
    </WorkspaceProvider>
  );
}
