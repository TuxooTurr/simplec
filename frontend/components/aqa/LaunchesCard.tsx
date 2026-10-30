"use client";

import { ChevronRight, Loader2, Rocket } from "lucide-react";
import { Card, Kpi, Problem, StatsBar, ago, passRate, statsTotal } from "@/components/aqa/widgets";
import type { AqaLaunch, AqaTestops } from "@/lib/aqaApi";

type Load<T> = { data: T | null; err: string; busy: boolean };

/** Состояние запуска точкой: идёт — синяя мигающая; есть упавшие — красная; сломанные — жёлтая; иначе — зелёная. */
export function LaunchDot({ l }: { l: AqaLaunch }) {
  const [cls, label] = !l.closed ? ["bg-blue-500 animate-pulse", "идёт"]
    : l.stats.failed ? ["bg-red-500", "есть упавшие"]
    : l.stats.broken ? ["bg-amber-500", "есть сломанные"]
    : statsTotal(l.stats) ? ["bg-emerald-500", "все успешно"] : ["bg-slate-400", "кейсов нет"];
  return <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${cls}`} title={label} aria-label={label} />;
}

/**
 * Виджет запусков Allure TestOps: сегодня, успешность последнего, кейсы за день и список последних запусков.
 * Щелчок по запуску — окно с подробностями (onOpen).
 */
export default function LaunchesCard({ ok, state, onRefresh, onSettings, onOpen }: {
  ok: boolean; state: Load<AqaTestops>; onRefresh: () => void; onSettings: () => void; onOpen: (id: number) => void;
}) {
  const d = state.data;
  const recent = d?.recent ?? (d?.last ? [d.last] : []);
  const rate = d?.last ? passRate(d.last.stats) : null;
  return (
    <Card icon={<Rocket className="h-4 w-4 text-primary" />} title="Запуски Allure TestOps" link={d?.projectUrl} onRefresh={onRefresh} busy={state.busy}>
      {!ok ? <Problem err="Проект Allure TestOps не подключён." onSettings={onSettings} />
        : state.err ? <Problem err={state.err} onSettings={onSettings} />
        : !d ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю запуски…</p>
        : (
          <div className={`space-y-4 transition-opacity ${state.busy ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-3 gap-2">
              <Kpi value={d.todayLaunches} label="запусков сегодня" />
              <Kpi value={rate === null ? "—" : `${rate}%`} label="успешно в последнем"
                tone={rate === null ? undefined : rate >= 95 ? "text-emerald-600 dark:text-emerald-400" : rate >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}
                hint={d.last ? ago(d.last.date) : undefined} />
              <Kpi value={statsTotal(d.todayStats)} label="кейсов за сегодня" hint={d.todayStatsPartial ? "по первым 30 запускам" : undefined} />
            </div>
            {d.todayLaunches > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Все запуски за сегодня</p>
                <StatsBar stats={d.todayStats} />
              </div>
            )}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Последние запуски</p>
              {!recent.length ? <p className="text-xs text-text-muted">Запусков нет</p> : (
                <ul className="max-h-60 divide-y divide-border-main overflow-y-auto rounded-lg border border-border-main scrollbar-thin">
                  {recent.map(l => {
                    const r = passRate(l.stats);
                    return (
                      <li key={l.id}>
                        <button type="button" onClick={() => onOpen(l.id)} title="Подробности запуска"
                          className="group flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-bg-subtle">
                          <LaunchDot l={l} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-text-main">{l.name || `Запуск #${l.id}`}</span>
                            <span className="block text-[11px] text-text-muted">#{l.id} · {ago(l.date)}{!l.closed && " · идёт"}</span>
                          </span>
                          <span className="w-24 flex-shrink-0"><StatsBar stats={l.stats} legend={false} className="h-1.5" /></span>
                          <span className="w-10 flex-shrink-0 text-right tabular-nums text-text-main">{r === null ? "—" : `${r}%`}</span>
                          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-muted group-hover:text-primary" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
    </Card>
  );
}
