"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import WorkspaceShell from "@/components/WorkspaceShell";
import LoginNote from "@/components/LoginNote";
import { SharkLoader } from "@/components/ui/RefreshButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="h-screen bg-bg-main">
        <SharkLoader size={48} label="Проверка входа" />
      </div>
    );
  }

  if (!user) return null;

  return <WorkspaceShell>{children}<LoginNote /></WorkspaceShell>;
}
