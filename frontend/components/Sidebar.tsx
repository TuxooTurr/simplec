"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Zap, BookOpen, Bug, Bell, BarChart2, Scale, FlaskConical, Database, Settings,
  LogOut, User, Play, ScrollText, GripVertical, Eye, EyeOff,
  SlidersHorizontal, Check, Network, SplitSquareHorizontal,
} from "lucide-react";
import type { ComponentType } from "react";
import LLMStatusBar from "./LLMStatusBar";
import RunningAlertsIndicator from "./RunningAlertsIndicator";
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
  { id: "alerts",      href: "/alerts",      label: "Генератор алертов",       Icon: Bell },
  { id: "kafka",       href: "/kafka",       label: "Просмотр Kafka",          Icon: Network },
  { id: "metrics",     href: "/metrics",     label: "Генератор метрик",        Icon: BarChart2,   superuserOnly: true },
  { id: "revisor",     href: "/revisor",     label: "Ревизор",                 Icon: Scale },
  { id: "etalons",     href: "/etalons",     label: "Эталоны",                 Icon: BookOpen,    superuserOnly: true },
  { id: "model_bench", href: "/model-bench", label: "Тестирование моделей LLM", Icon: SplitSquareHorizontal, ai: true },
];

const ORDER_KEY = "st_nav_order";
const HIDDEN_KEY = "st_nav_hidden";

function loadList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(key) ?? "[]") as string[]; } catch { return []; }
}

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

  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setOrder(loadList(ORDER_KEY));
    setHidden(loadList(HIDDEN_KEY));
    setMounted(true);
  }, []);

  const persist = (nextOrder: string[], nextHidden: string[]) => {
    setOrder(nextOrder); setHidden(nextHidden);
    localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(nextHidden));
  };

  const baseNav = useMemo(
    () => NAV.filter((item) => !(item.superuserOnly && !isSuperuser)),
    [isSuperuser],
  );

  const orderedNav = useMemo(() => {
    const pos = (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...baseNav].sort((a, b) => pos(a.id) - pos(b.id));
  }, [baseNav, order]);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visibleNav = mounted && !editMode ? orderedNav.filter((n) => !hiddenSet.has(n.id)) : orderedNav;

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const reorder = (drag: string, target: string) => {
    if (drag === target) return;
    const ids: string[] = orderedNav.map((n) => n.id);
    const from = ids.indexOf(drag);
    if (from < 0) return;
    ids.splice(from, 1);
    const to = ids.indexOf(target);
    if (to < 0) return;
    ids.splice(to, 0, drag);  // insert dragged item before the target
    persist(ids, hidden);
  };

  const toggleHidden = (id: string) => {
    const fullOrder: string[] = order.length ? order : orderedNav.map((n) => n.id);
    persist(fullOrder, hiddenSet.has(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
  };

  return (
    <aside className="w-64 h-screen bg-[var(--color-sidebar-bg)] border-r border-border-main flex flex-col flex-shrink-0">
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
      <nav className="px-3 py-3 border-b border-border-main flex-1 overflow-y-auto min-h-0">
        {editMode && (
          <p className="px-2 pb-2 text-[11px] text-text-muted">
            Перетащите за <GripVertical className="inline h-3 w-3 align-text-bottom" />, чтобы изменить порядок.
            Глазом — скрыть или показать раздел.
          </p>
        )}
        {visibleNav.map(({ id, href, label, Icon, ai }) => {
          const active = pathname.startsWith(href);
          const isHidden = hiddenSet.has(id);

          if (editMode) {
            return (
              <div
                key={href}
                draggable
                onDragStart={() => setDragId(id)}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDragOver={(e) => { e.preventDefault(); if (overId !== id) setOverId(id); }}
                onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, id); setOverId(null); }}
                className={`relative flex items-center gap-2 px-2 py-2 rounded-lg mb-0.5 text-sm
                  border border-transparent cursor-grab active:cursor-grabbing transition-colors
                  ${overId === id && dragId !== id ? "border-primary/40 bg-primary/5" : "hover:bg-bg-subtle"}
                  ${isHidden ? "opacity-50" : ""}`}
              >
                <GripVertical className="h-4 w-4 flex-shrink-0 text-text-muted/60" />
                <Icon className="w-4 h-4 flex-shrink-0 text-text-muted" strokeWidth={2} />
                <span className="flex-1 min-w-0 truncate text-text-main">{label}</span>
                <button
                  type="button"
                  onClick={() => toggleHidden(id)}
                  aria-label={isHidden ? `Показать ${label}` : `Скрыть ${label}`}
                  title={isHidden ? "Показать раздел" : "Скрыть раздел"}
                  className="p-1 rounded text-text-muted hover:bg-bg-muted hover:text-text-main"
                >
                  {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          }

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
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset
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

        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={`mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
            ${editMode
              ? "bg-primary/10 text-primary"
              : "text-text-muted hover:bg-[var(--color-sidebar-hover)] hover:text-text-main"}`}
        >
          {editMode ? <Check className="w-4 h-4" /> : <SlidersHorizontal className="w-4 h-4" />}
          <span className="flex-1 text-left">{editMode ? "Готово" : "Настроить разделы"}</span>
        </button>
      </nav>

      {/* LLM status + User + Settings at bottom */}
      <div className="border-t border-border-main flex-shrink-0">
        <RunningAlertsIndicator />
        <div className="px-4 py-3 max-h-[38vh] overflow-y-auto">
          <LLMStatusBar />
        </div>
        {user && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <User className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              <span className="text-xs text-text-main font-medium truncate">{user.display_name}</span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                isSuperuser
                  ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30"
                  : "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30"
              }`}>
                {isSuperuser ? "SU" : "MON"}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Выйти"
              aria-label="Выйти из аккаунта"
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-text-muted hover:text-red-500 transition-colors flex-shrink-0"
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
