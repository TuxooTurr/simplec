"use client";

/**
 * Глобальный индикатор активных алертов — виден с ЛЮБОЙ вкладки (рендерится
 * в Sidebar, а не внутри секции «Алерты»). Ядра/планировщики живут в
 * AlertsSchedulerContext на уровне WorkspaceShell и продолжают работать при
 * переключении разделов — этот виджет даёт увидеть их, не заходя в «Алерты».
 */

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useAlertsScheduler } from "@/contexts/AlertsSchedulerContext";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}ч ${String(m).padStart(2, "0")}м`;
  if (m > 0) return `${m}м ${String(s).padStart(2, "0")}с`;
  return `${s}с`;
}

export default function RunningAlertsIndicator() {
  const { scripts, sessions, setSelectedId } = useAlertsScheduler();
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState(() => Date.now());

  const active = Object.entries(sessions)
    .filter(([, s]) => s.kernelAlive || s.schedActive || s.executing)
    .map(([id, s]) => ({
      id,
      name: scripts.find((sc) => sc.id === id)?.name ?? id,
      session: s,
      // Планировщик — самое релевантное "работает уже X" время; иначе — время жизни ядра
      startedAt: s.schedActive ? s.schedStartedAt : s.kernelStartedAt,
    }));

  // Тикаем раз в секунду, только пока есть что показывать (не тратим таймер впустую)
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active.length]);

  if (active.length === 0) return null;

  const openAlert = (id: string) => {
    setSelectedId(id);
    if (pathname !== "/alerts") router.push("/alerts");
  };

  return (
    <div className="border-b border-border-main px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        <Bell className="h-3 w-3" />
        Активные алерты ({active.length})
      </div>
      <div className="space-y-0.5">
        {active.map(({ id, name, session, startedAt }) => {
          const label = session.schedActive
            ? `работает · #${session.schedCount}`
            : session.executing
            ? "выполняется…"
            : "ядро активно";
          return (
            <button
              key={id}
              type="button"
              onClick={() => openAlert(id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle"
              title={`${name} — ${label}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                session.executing ? "bg-amber-400 animate-pulse" : "bg-emerald-500 animate-pulse"
              }`} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-main">{name}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                {startedAt ? formatElapsed(now - startedAt) : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
