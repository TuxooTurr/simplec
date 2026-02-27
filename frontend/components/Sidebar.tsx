"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, BookOpen, Bug } from "lucide-react";
import LLMStatusBar from "./LLMStatusBar";

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
      <div className="mt-auto px-4 py-3 border-t border-border-main">
        <LLMStatusBar />
      </div>
    </aside>
  );
}
