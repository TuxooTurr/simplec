import type { Config } from "tailwindcss";

/**
 * Цвет темы из CSS-переменной — с поддержкой прозрачности вида `bg-primary/40`.
 *
 * Просто "var(--color-primary)" тут не годится: Tailwind для модификатора /N
 * подставляет цвет в rgb(... / alpha), а в переменной лежит готовый hex —
 * получается невалидный CSS, и правило молча отбрасывается. Из-за этого
 * bg-primary/10, border-primary/40, ring-primary/30 и подобные (сотни мест
 * по приложению) не давали никакого цвета: рамки оставались серыми по
 * умолчанию, фокусные кольца не рисовались.
 *
 * color-mix решает это, не требуя переписывать переменные в каналы;
 * в globals.css он уже используется, так что поддержка и так предполагается.
 */
function themeColor(variable: string): string {
  const resolve = ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${variable})`
      : `color-mix(in srgb, var(${variable}) ${Number(opacityValue) * 100}%, transparent)`;
  // Tailwind принимает функцию-резолвер в рантайме, но в его типах у цвета
  // объявлена только строка — отсюда приведение.
  return resolve as unknown as string;
}

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary:       themeColor("--color-primary"),
        "primary-dark":themeColor("--color-primary-dark"),
        "bg-main":     themeColor("--color-bg-main"),
        "bg-card":     themeColor("--color-bg-card"),
        "bg-subtle":   themeColor("--color-bg-subtle"),
        "bg-muted":    themeColor("--color-bg-muted"),
        "text-main":   themeColor("--color-text-main"),
        "text-muted":  themeColor("--color-text-muted"),
        "border-main": themeColor("--color-border-main"),
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
