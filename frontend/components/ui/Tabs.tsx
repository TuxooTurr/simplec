"use client";

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  /** "line" (default) or "pills" */
  variant?: "line" | "pills";
}

export function Tabs({ tabs, active, onChange, className = "", variant = "line" }: TabsProps) {
  if (variant === "pills") {
    return (
      <div className={`flex gap-1 ${className}`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              active === t.id
                ? "bg-primary text-white"
                : "text-text-muted hover:bg-bg-subtle hover:text-text-main"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  /* line variant (default) */
  return (
    <div className={`flex border-b border-border-main ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-xs font-semibold transition-colors relative flex items-center gap-1.5 ${
            active === t.id
              ? "text-primary"
              : "text-text-muted hover:text-text-main"
          }`}
        >
          {t.icon}
          {t.label}
          {active === t.id && (
            <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-t-full" />
          )}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
