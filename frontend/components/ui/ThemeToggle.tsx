"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

/** Событие смены темы: переключатель в шапке и выбор в «Настройках» держат друг друга в курсе. */
const THEME_EVENT = "st-theme-change";

export function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Включить тему: плавная смена цветов, запоминание в st_theme, оповещение всех переключателей. */
export function applyTheme(next: Theme) {
  const root = document.documentElement;
  // Cross-fade colours for the duration of the switch, then drop the helper
  // class so it never slows ordinary hovers.
  root.classList.add("theme-transition");
  root.classList.toggle("dark", next === "dark");
  try { localStorage.setItem("st_theme", next); } catch { /* приватный режим — тема просто не запомнится */ }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  window.setTimeout(() => root.classList.remove("theme-transition"), 300);
}

/** Текущая тема с подпиской на смену из любого места. */
export function useTheme(): [Theme, boolean] {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
    const h = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, h);
    return () => window.removeEventListener(THEME_EVENT, h);
  }, []);
  return [theme, mounted];
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  // The real theme class is set pre-paint by the inline script in layout.tsx,
  // so we read it back from the DOM instead of guessing (no hydration flash).
  const [theme, mounted] = useTheme();
  const toggle = () => applyTheme(theme === "dark" ? "light" : "dark");

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={isDark ? "Светлая тема" : "Тёмная тема"}
      className={`relative grid place-items-center w-8 h-8 rounded-lg text-text-muted
        hover:bg-bg-subtle hover:text-text-main transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
    >
      {/* both icons share the same grid cell and cross-fade with a quarter-turn */}
      <Sun
        className={`col-start-1 row-start-1 w-4 h-4 transition-all duration-300 ${
          mounted && isDark
            ? "opacity-100 rotate-0 scale-100"
            : "opacity-0 -rotate-90 scale-50"
        }`}
      />
      <Moon
        className={`col-start-1 row-start-1 w-4 h-4 transition-all duration-300 ${
          mounted && !isDark
            ? "opacity-100 rotate-0 scale-100"
            : "opacity-0 rotate-90 scale-50"
        }`}
      />
    </button>
  );
}

export default ThemeToggle;
