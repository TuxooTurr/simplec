"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, BookOpen, Bug, LogOut, User } from "lucide-react";
import { useEffect, useState } from "react";
import LLMStatusBar from "./LLMStatusBar";
import { logout, getMe } from "@/lib/auth";

interface SidebarProps {
  controls?: React.ReactNode;
}

const NAV = [
  { href: "/generation", label: "Генерация", Icon: Zap },
  { href: "/etalons",    label: "Эталоны",   Icon: BookOpen },
  { href: "/bugs",       label: "Дефекты",   Icon: Bug },
];

export default function Sidebar({ controls }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    getMe().then((me) => setUsername(me?.username ?? null));
  }, []);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <aside className="w-72 min-h-screen bg-white border-r border-border-main flex flex-col flex-shrink-0">
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
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`
                relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium
                transition-all duration-200 group
                ${active
                  ? "bg-indigo-50 text-primary"
                  : "text-text-muted hover:bg-gray-50 hover:text-text-main"}
              `}
            >
              {/* Active indicator bar */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full animate-fade-in" />
              )}
              <Icon
                className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                  active ? "text-primary" : "text-text-muted group-hover:scale-110 group-hover:text-text-main"
                }`}
                strokeWidth={active ? 2.5 : 2}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Page-specific controls */}
      {controls && (
        <div className="px-4 py-4 border-b border-border-main flex-1 overflow-y-auto scrollbar-thin">
          {controls}
        </div>
      )}

      {/* LLM status at bottom */}
      <div className="mt-auto border-t border-border-main">
        <div className="px-4 py-3">
          <LLMStatusBar />
        </div>

        {/* User + logout */}
        {username && (
          <div className="px-4 pb-3 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-xs text-text-muted flex-1 truncate">{username}</span>
            <button
              onClick={handleLogout}
              title="Выйти"
              className="p-1 rounded hover:bg-gray-100 text-text-muted hover:text-red-500 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
