import type { Config } from "tailwindcss";

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
        primary:       "var(--color-primary)",
        "primary-dark":"var(--color-primary-dark)",
        "bg-main":     "var(--color-bg-main)",
        "bg-card":     "var(--color-bg-card)",
        "bg-subtle":   "var(--color-bg-subtle)",
        "bg-muted":    "var(--color-bg-muted)",
        "text-main":   "var(--color-text-main)",
        "text-muted":  "var(--color-text-muted)",
        "border-main": "var(--color-border-main)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
