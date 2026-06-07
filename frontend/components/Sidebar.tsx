"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, BookOpen, Bug, Bell, BarChart2, Scale, FlaskConical, Database, Settings, LogOut, User, Play, ScrollText, Smartphone } from "lucide-react";
import type { ComponentType } from "react";
import LLMStatusBar from "./LLMStatusBar";
import { ThemeToggle } from "./ui";
import { useWorkspace, type SectionId } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";

const NAV: {
  id: SectionId;
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  ai?: boolean;
  superuserOnly?: boolean;
}[] = [
  { id: "generation",  href: "/generation",  label: "Ручное тестирование",   Icon: Zap,          ai: true },
  { id: "auto_model",  href: "/auto-model",  label: "Автотестирование",       Icon: FlaskConical, ai: true },
  { id: "test_data",   href: "/test-data",   label: "Тестовые данные",        Icon: Database,    ai: true },
  { id: "jobs",        href: "/jobs",        label: "Jobs",                     Icon: Play },
  { id: "bugs",        href: "/bugs",        label: "Дефекты",                 Icon: Bug,         ai: true },
  { id: "logs",        href: "/logs",        label: "Логи",                    Icon: ScrollText,  ai: true },
  { id: "device_farm", href: "/device-farm", label: "Ферма устройств",         Icon: Smartphone },
  { id: "alerts",      href: "/alerts",      label: "Генератор алертов",       Icon: Bell },
  { id: "metrics",     href: "/metrics",     label: "Генератор метрик",        Icon: BarChart2,   superuserOnly: true },
  { id: "revisor",     href: "/revisor",     label: "Ревизор",                 Icon: Scale },
  { id: "etalons",     href: "/etalons",     label: "Эталоны",                 Icon: BookOpen,    superuserOnly: true },
];

function AiBadge() {
  return (
    <sup
      className="inline-block text-[8px] font-bold leading-none px-[3px] py-[1px] rounded bg-[var(--color-badge-ai-bg)] text-[var(--color-badge-ai-text)]"
      style={{ verticalAlign: "super" }}
    >
      AI
    </sup>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setDragging } = useWorkspace();
  const { user, logout, isSuperuser } = useAuth();

  const filteredNav = NAV.filter(item => {
    if (item.superuserOnly && !isSuperuser) return false;
    return true;
  });

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <aside className="w-64 min-h-screen bg-[var(--color-sidebar-bg)] border-r border-border-main flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border-main">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm flex-shrink-0">
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <span className="text-[15px] font-bold text-text-main tracking-tight">SimpleTest</span>
            <p className="text-[11px] text-text-muted leading-none mt-0.5">AI-генератор тест-кейсов</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-3 border-b border-border-main">
        {filteredNav.map(({ id, href, label, Icon, ai }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("sectionId", id);
                e.dataTransfer.effectAllowed = "copy";
                setDragging(id);
              }}
              onDragEnd={() => setDragging(null)}
              className={`
                relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium
                transition-all duration-200 group cursor-grab active:cursor-grabbing
                ${active
                  ? "bg-[var(--color-active-bg)] text-primary"
                  : "text-text-muted hover:bg-[var(--color-sidebar-hover)] hover:text-text-main"}
              `}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full animate-fade-in" />
              )}
              <Icon
                className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                  active ? "text-primary" : "text-text-muted group-hover:scale-110 group-hover:text-text-main"
                }`}
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="flex-1 min-w-0">{label}</span>
              {ai && <AiBadge />}
              <span className="opacity-0 group-hover:opacity-40 transition-opacity text-[10px] text-text-muted select-none">
                ⠿
              </span>
            </Link>
          );
        })}
      </nav>

      {/* LLM status + User + Settings at bottom */}
      <div className="mt-auto border-t border-border-main">
        <div className="px-4 py-3">
          <LLMStatusBar />
        </div>
        {user && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <User className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              <span className="text-xs text-text-main font-medium truncate">{user.display_name}</span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                isSuperuser ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}>
                {isSuperuser ? "SU" : "MON"}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Выйти"
              className="p-1 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors flex-shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="px-4 pb-3 flex items-center justify-end gap-1">
          <ThemeToggle />
          {isSuperuser && (
            <Link
              href="/settings"
              title="Настройки"
              className="p-1.5 rounded-lg hover:bg-bg-subtle text-text-muted hover:text-primary transition-colors"
            >
              <Settings className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
