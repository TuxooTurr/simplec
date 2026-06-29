"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  // The real theme class is set pre-paint by the inline script in layout.tsx,
  // so we read it back from the DOM instead of guessing (no hydration flash).
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;

    // Cross-fade colours for the duration of the switch, then drop the helper
    // class so it never slows ordinary hovers.
    root.classList.add("theme-transition");
    root.classList.toggle("dark", next === "dark");
    localStorage.setItem("st_theme", next);
    setTheme(next);
    window.setTimeout(() => root.classList.remove("theme-transition"), 300);
  };

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
