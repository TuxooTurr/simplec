"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("st_theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getInitialTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("st_theme", theme);
  }, [theme, mounted]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  if (!mounted) {
    return (
      <button className={`p-1.5 rounded-lg text-text-muted ${className}`} disabled>
        <Sun className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      className={`p-1.5 rounded-lg text-text-muted hover:bg-bg-subtle hover:text-text-main transition-colors ${className}`}
    >
      {theme === "dark"
        ? <Sun  className="w-4 h-4" />
        : <Moon className="w-4 h-4" />}
    </button>
  );
}

export default ThemeToggle;
