import { fmtMinutes, isCommonReserve, type LoadRow } from "@/lib/jiraTool";

/** Строка нагрузки человека: план / ёмкость, полоса (bars), перегрузка, переработка в выходные, без плана, резервы. */
export default function LoadRowView({ r, bars }: { r: LoadRow; bars: boolean }) {
  const pct = r.capacity ? Math.min(100, Math.round((r.planned / r.capacity) * 100)) : r.planned ? 100 : 0;
  return (
    <li title={`Задач в нагрузке: ${r.tasks}${r.unplanned ? `, без плана: ${r.unplanned}` : ""}${r.skipped ? `, не учтено: ${r.skipped}` : ""}`
      + (r.reserves.length ? `\nРезервы: ${r.reserves.map(x => `${x.name} ${fmtMinutes(x.minutes, "hm")}/день`).join(", ")} — за период ${fmtMinutes(r.reserved)}` : "")}>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.participant.color }} />
        <span className="min-w-0 flex-1 truncate text-text-main">{r.participant.name}</span>
        <span className={`whitespace-nowrap tabular-nums ${r.over ? "text-red-600 dark:text-red-400 font-semibold" : "text-text-muted"}`}>
          {fmtMinutes(r.planned)} / {fmtMinutes(r.capacity)}
        </span>
      </div>
      {bars && (
        <div className="mt-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden" aria-hidden>
          <div className={`h-full rounded-full ${r.over ? "bg-red-500" : r.overtime ? "bg-amber-500" : "bg-primary/70"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {r.reserves.some(x => !isCommonReserve(x)) && (
        <p className="mt-0.5 text-[10px] text-text-muted">
          резерв: {r.reserves.filter(x => !isCommonReserve(x)).map(x => `${x.name} ${fmtMinutes(x.minutes, "hm")}/день`).join(", ")}
        </p>
      )}
      {(r.over || r.overtime > 0 || r.unplanned > 0) && (
        <p className="mt-0.5 text-[10px] text-text-muted">
          {[
            r.over && <span key="o" className="text-red-600 dark:text-red-400">перегрузка {fmtMinutes(r.planned - r.capacity)}</span>,
            r.overtime > 0 && <span key="w" className="text-amber-700 dark:text-amber-300">в выходные {fmtMinutes(r.overtime)}</span>,
            r.unplanned > 0 && <span key="u">без плана: {r.unplanned}</span>,
          ].filter(Boolean).flatMap((el, i) => (i ? [" · ", el] : [el]))}
        </p>
      )}
    </li>
  );
}
