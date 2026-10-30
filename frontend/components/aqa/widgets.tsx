"use client";

import type { ReactNode } from "react";
import { ExternalLink, RefreshCw, Settings2 } from "lucide-react";
import type { AqaStats } from "@/lib/aqaApi";

/** Общие кирпичики виджетов «Трекинга AQA»: карточка, показатель, полоса статусов кейсов, форматы дат. */

/** Порядок и цвета статусов кейсов TestOps. */
export const STATUS: { id: string; label: string; cls: string; text: string }[] = [
  { id: "failed", label: "упало", cls: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  { id: "broken", label: "сломано", cls: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { id: "passed", label: "успешно", cls: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { id: "skipped", label: "пропущено", cls: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" },
  { id: "unknown", label: "неизвестно", cls: "bg-violet-400", text: "text-violet-600 dark:text-violet-400" },
];
const BY_ID = new Map(STATUS.map(s => [s.id, s]));
export const statusOf = (id: string) => BY_ID.get(id) ?? { id, label: id, cls: "bg-slate-300", text: "text-text-muted" };

export const statsTotal = (s: AqaStats) => Object.values(s).reduce((a, b) => a + b, 0);
/** Доля успешных, %; кейсов нет — null. */
export const passRate = (s: AqaStats) => { const t = statsTotal(s); return t ? Math.round(((s.passed ?? 0) / t) * 100) : null; };
/** Статусы по порядку STATUS, незнакомые — в конце. */
export const statusItems = (s: AqaStats) => [
  ...STATUS.filter(x => s[x.id]),
  ...Object.keys(s).filter(k => !BY_ID.has(k) && s[k]).map(statusOf),
];

export const fmtWhen = (iso: string) =>
  (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** «5 мин назад», «3 ч назад», «вчера, 14:05», дальше — дата. */
export function ago(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso), min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  if (min < 12 * 60) return `${Math.floor(min / 60)} ч назад`;
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `сегодня, ${time}`;
  if (days === 1) return `вчера, ${time}`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: days > 300 ? "numeric" : undefined }) + `, ${time}`;
}

export function fmtDur(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} с`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  if (s < 3600) return `${Math.floor(s / 60)} мин ${s % 60} с`;
  return `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`;
}

export function Card({ icon, title, extra, link, onRefresh, busy, children }: {
  icon: ReactNode; title: string; extra?: ReactNode; link?: string; onRefresh: () => void; busy: boolean; children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-border-main bg-bg-card">
      <div className="flex items-center gap-2 border-b border-border-main px-4 py-2.5">
        {icon}
        <h2 className="text-sm font-semibold text-text-main">{title}</h2>
        {extra}
        <span className="flex-1" />
        {link && <a href={link} target="_blank" rel="noopener noreferrer" title="Открыть в браузере" aria-label={`Открыть: ${title}`}
          className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle"><ExternalLink className="w-3.5 h-3.5" /></a>}
        <button type="button" onClick={onRefresh} disabled={busy} title="Обновить" aria-label={`Обновить: ${title}`}
          className="p-1 rounded-md text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </section>
  );
}

/** Показатель плиткой: число крупно, подпись мелко, под ней — пояснение. */
export function Kpi({ value, label, hint, tone }: { value: ReactNode; label: string; hint?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-bg-subtle/60 px-3 py-2.5">
      <p className={`text-2xl font-bold leading-tight tabular-nums ${tone ?? "text-text-main"}`}>{value}</p>
      <p className="text-[11px] text-text-muted">{label}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

/** Полоса кейсов по статусам; legend — подписи с числами под полосой. */
export function StatsBar({ stats, legend = true, className = "h-2" }: { stats: AqaStats; legend?: boolean; className?: string }) {
  const total = statsTotal(stats);
  if (!total) return legend ? <p className="text-xs text-text-muted">Кейсов нет</p> : <div className={`${className} rounded-full bg-bg-subtle`} />;
  const items = statusItems(stats);
  return (
    <div className="space-y-1">
      <div className={`flex overflow-hidden rounded-full bg-bg-subtle ${className}`}>
        {items.map(s => <div key={s.id} className={s.cls} style={{ width: `${(stats[s.id] / total) * 100}%` }} title={`${s.label}: ${stats[s.id]}`} />)}
      </div>
      {legend && (
        <p className="flex flex-wrap gap-x-3 text-[11px] text-text-muted">
          {items.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${s.cls}`} />{s.label} <b className="text-text-main tabular-nums">{stats[s.id]}</b></span>
          ))}
        </p>
      )}
    </div>
  );
}

export function Problem({ err, onSettings }: { err: string; onSettings: () => void }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-red-600 dark:text-red-400">{err}</p>
      <button type="button" onClick={onSettings} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
        <Settings2 className="w-3.5 h-3.5" /> Подключения</button>
    </div>
  );
}
