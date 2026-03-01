import WorkspaceShell from "@/components/WorkspaceShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
