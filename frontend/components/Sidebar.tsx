"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LLMStatusBar from "./LLMStatusBar";

interface SidebarProps {
  controls?: React.ReactNode;
}

const NAV = [
  { href: "/generation", label: "Генерация", icon: "⚡" },
  { href: "/etalons", label: "Эталоны", icon: "📚" },
  { href: "/bugs", label: "Дефекты", icon: "🐛" },
];

export default function Sidebar({ controls }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-72 min-h-screen bg-white border-r border-border-main flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border-main">
        <span className="text-2xl font-bold text-primary tracking-tight">SimpleTest</span>
        <p className="text-xs text-text-muted mt-0.5">AI-генератор тест-кейсов</p>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-3 border-b border-border-main">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg mb-1 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-50 text-primary"
                  : "text-text-muted hover:bg-gray-50 hover:text-text-main"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
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
