"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Moon, Settings, SlidersHorizontal, Sparkles, Sun } from "lucide-react";
import { NAV_EDIT_EVENT } from "./Sidebar";
import NotificationBell from "./NotificationBell";
import WhatsNewModal from "./WhatsNewModal";
import { applyTheme, useTheme } from "./ui";
import { useAuth } from "@/contexts/AuthContext";
import { CURRENT_VERSION, LATEST_RELEASE, isReleaseSeen, markReleaseSeen } from "@/lib/releaseNotes";

const ITEM = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-main transition-colors hover:bg-bg-subtle " +
  "focus-visible:bg-bg-subtle focus-visible:outline-none";

/**
 * Верхний правый угол всего окна: колокольчик и ФИО. По ФИО — меню: настроить разделы, тема, настройки, «Что нового», выход.
 * Резервная копия — в «Настройках». Стоит в шапке крайней справа панели: отдельная полоса над панелями
 * отняла бы высоту у рабочих зон. `section` оставлен для совместимости с ResizablePanels.
 */
export default function TopActions({ section: _section }: { section: string }) {
  const { user, logout, isSuperuser } = useAuth();
  const router = useRouter();
  const [theme] = useTheme();
  const [menu, setMenu] = useState(false);
  const [whatsNew, setWhatsNew] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Окно релиза открывается само один раз; дальше — пункт меню. localStorage читаем здесь: на сервере его нет.
  useEffect(() => {
    if (!isReleaseSeen(LATEST_RELEASE.id)) { setUnseen(true); setWhatsNew(true); }
  }, []);

  // Меню закрывается кликом мимо и по Esc (фокус — обратно на ФИО).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  const handleLogout = async () => { setMenu(false); await logout(); router.replace("/login"); };
  const isDark = theme === "dark";

  return (
    <div className="flex min-w-0 items-center gap-1">
      <NotificationBell />
      {user && (
        <div ref={wrap} className="relative min-w-0">
          <button ref={trigger} type="button" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu}
            title={user.display_name}
            className="relative flex min-w-0 items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 text-xs font-medium text-text-main transition-colors
              hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span aria-hidden className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
              {initials(user.display_name)}
            </span>
            <span className="max-w-[180px] truncate">{user.display_name}</span>
            <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform duration-200 ${menu ? "rotate-180" : ""}`} />
            {unseen && <span aria-label="Есть новая версия" className="absolute left-5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-bg-card" />}
          </button>

          {menu && (
            <div role="menu" aria-label="Меню пользователя"
              className="t-rise absolute right-0 top-full z-[75] mt-1.5 w-60 overflow-hidden rounded-xl border border-border-main
                bg-[var(--color-modal-bg)] py-1 shadow-2xl">
              <div className="border-b border-border-main px-3 pb-2 pt-1.5">
                <p className="truncate text-sm font-semibold text-text-main">{user.display_name}</p>
                {user.login && user.login !== user.display_name && <p className="truncate text-xs text-text-muted">{user.login}</p>}
              </div>
              <div className="py-1">
                <button role="menuitem" type="button" onClick={() => { setMenu(false); window.dispatchEvent(new Event(NAV_EDIT_EVENT)); }}
                  className={ITEM}>
                  <SlidersHorizontal className="h-4 w-4 text-text-muted" /> Настроить разделы
                </button>
                <button role="menuitem" type="button" onClick={() => applyTheme(isDark ? "light" : "dark")} className={ITEM}>
                  {isDark ? <Sun className="h-4 w-4 text-text-muted" /> : <Moon className="h-4 w-4 text-text-muted" />}
                  {isDark ? "Светлая тема" : "Тёмная тема"}
                </button>
                {isSuperuser && (
                  <Link role="menuitem" href="/settings" onClick={() => setMenu(false)} className={ITEM}>
                    <Settings className="h-4 w-4 text-text-muted" /> Настройки
                  </Link>
                )}
                <button role="menuitem" type="button" onClick={() => { setMenu(false); setWhatsNew(true); }} className={ITEM}>
                  <Sparkles className="h-4 w-4 text-text-muted" /> Что нового
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
                    {unseen && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />}{CURRENT_VERSION}
                  </span>
                </button>
              </div>
              <div className="border-t border-border-main pt-1">
                <button role="menuitem" type="button" onClick={() => void handleLogout()}
                  className={`${ITEM} hover:!bg-red-50 hover:text-red-600 dark:hover:!bg-red-900/30 dark:hover:text-red-400`}>
                  <LogOut className="h-4 w-4" /> Выйти
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <WhatsNewModal open={whatsNew} onClose={() => { setWhatsNew(false); markReleaseSeen(LATEST_RELEASE.id); setUnseen(false); }} />
    </div>
  );
}

/** Две буквы для кружка: «Иванов Иван» → «ИИ», «Sber911» → «S». */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map(p => p[0]).join("").toUpperCase();
}
