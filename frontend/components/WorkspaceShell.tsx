"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ResizablePanels from "./ResizablePanels";
import SectionRenderer from "./SectionRenderer";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Login page: no shell, no sidebar, no panels
  if (pathname === "/login") return <>{children}</>;

  return (
    <WorkspaceProvider>
      <div className="flex h-screen bg-bg-main overflow-hidden">
        <Sidebar />
        <ResizablePanels
          left={children}
          right={<SectionRenderer />}
        />
      </div>
    </WorkspaceProvider>
  );
}
