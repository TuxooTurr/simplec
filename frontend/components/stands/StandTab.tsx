"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Inbox, Link2, Loader2, Plus, RefreshCw, Settings2, Snowflake, Trash2, X } from "lucide-react";
import {
  addStandBooking, addStandFreeze, createStandPage, decideStandPending, deleteStandBooking, deleteStandFreeze, getStand,
  pullStandRequests, saveStandSettings, saveStandsConfig, type StandDay, type StandPending, type StandView,
} from "@/lib/standsApi";

const INPUT = "text-sm border border-border-main rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
/** Цвета команд — по порядку в настройках стенда (чип брони и легенда). */
const TEAM_CLS = [
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  "bg-lime-100 text-lime-800 dark:bg-lime-900/50 dark:text-lime-200",
];
const STATUS_CLS: Record<string, string> = {
  "МОЖНО": "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/40",
  "ЛИМИТ": "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40",
  "ЗАМОРОЗКА": "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40",
  "ПРОШЁЛ": "bg-bg-subtle text-text-muted border-border-main",
  "ВЫХОДНОЙ": "bg-bg-subtle text-text-muted border-border-main",
};
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function Status({ s }: { s: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS_CLS[s] ?? STATUS_CLS["ПРОШЁЛ"]}`}>{s}</span>;
}

/**
 * Вкладка стенда: «сегодня», сетка всех рабочих дней двух спринтов (брони цветом команды, счётчик от лимита,
 * заморозка), заявки из комментариев Confluence («Забрать заявки» → приняты по правилам или «На рассмотрении»).
 * Любое изменение сохраняется в свойство страницы и пересобирает её текст.
 */
export default function StandTab({ stand, pageId, onPageBound }: { stand: string; pageId: string; onPageBound: () => void }) {
  const [v, setV] = useState<StandView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);     // день, в который добавляют бронь
  const [settings, setSettings] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);

  const run = async (fn: () => Promise<StandView>, ok?: (r: StandView) => string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setV(r);
      const warn = [r.publishError && `страница не пересобралась: ${r.publishError}`, ...(r.replyErrors ?? []), ...(r.pulled?.replyErrors ?? [])].filter(Boolean);
      setMsg(warn.length ? { ok: false, text: `Сохранено, но ${warn.join("; ")}` } : ok ? { ok: true, text: ok(r) } : null);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  useEffect(() => { if (pageId) void run(() => getStand(stand)); else setV(null); }, [stand, pageId]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!pageId) return <BindPage stand={stand} onBound={onPageBound} />;
  if (!v) return <p className="flex items-center gap-2 text-sm text-text-muted">{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Читаю график из Confluence…</> : msg?.text}</p>;

  const teamCls = (t: string) => TEAM_CLS[Math.max(0, v.teams.indexOf(t)) % TEAM_CLS.length];
  const sprints = Array.from(new Set(v.days.map(d => d.sprint)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-main">Сегодня, {ddmm(v.today.date)}:</span>
        <Status s={v.today.status} />
        <span className="text-sm text-text-muted">установок {v.today.count}/{v.limit}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => run(() => pullStandRequests(stand), r => `Заявок: принято ${r.pulled?.accepted ?? 0}, на рассмотрении ${r.pulled?.pending ?? 0}`)}
            disabled={busy} title="Прочитать новые комментарии-заявки на странице стенда и ответить на них итогом"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />} Забрать заявки</button>
          <button type="button" onClick={() => run(() => getStand(stand))} disabled={busy} title="Перечитать график из Confluence"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"><RefreshCw className="w-4 h-4" /></button>
          <button type="button" onClick={() => setFreezeOpen(o => !o)} aria-expanded={freezeOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
            <Snowflake className="w-4 h-4" /> Заморозка</button>
          <button type="button" onClick={() => setSettings(o => !o)} aria-expanded={settings} title="Лимит, спринты, команды"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main"><Settings2 className="w-4 h-4" /></button>
          <a href={v.url} target="_blank" rel="noopener noreferrer" title="Страница стенда в Confluence"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
            <ExternalLink className="w-4 h-4" /> Confluence</a>
        </span>
      </div>
      {msg && (
        <p className={`flex items-start gap-1.5 text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.ok ? <Check className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}{msg.text}</p>
      )}
      {settings && <SettingsForm v={v} busy={busy} onSave={s => run(() => saveStandSettings(stand, s), () => "Настройки сохранены").then(() => setSettings(false))} />}
      {freezeOpen && <FreezeForm busy={busy} onAdd={f => run(() => addStandFreeze(stand, f), () => "Заморозка добавлена").then(() => setFreezeOpen(false))} />}
      {v.freezes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {v.freezes.map(f => (
            <span key={f.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300">
              <Snowflake className="w-3.5 h-3.5" /> {ddmm(f.from)}–{ddmm(f.to)}{f.reason && ` · ${f.reason}`}
              <button type="button" onClick={() => run(() => deleteStandFreeze(stand, f.id))} aria-label="Снять заморозку" className="hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
        </div>
      )}
      {v.pending.length > 0 && (
        <section className="rounded-xl border border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
          <p className="text-sm font-semibold text-text-main">На рассмотрении: {v.pending.length}</p>
          {v.pending.map(p => <PendingRow key={p.cid} p={p} teams={v.teams} busy={busy}
            onDecide={d => run(() => decideStandPending(stand, p.cid, d), () => d.accept ? "Заявка принята" : "Заявка отклонена")} />)}
        </section>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        {v.teams.map(t => <span key={t} className={`px-2 py-0.5 rounded-md ${teamCls(t)}`}>{t}</span>)}
        <span>· лимит {v.limit} в день</span>
      </div>

      {sprints.map(sp => (
        <section key={sp} className="rounded-xl border border-border-main bg-bg-card overflow-hidden">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted border-b border-border-main bg-bg-subtle/50">
            Спринт с {ddmm(v.days.find(d => d.sprint === sp)!.date)}</p>
          <ul className="divide-y divide-border-main">
            {v.days.filter(d => d.sprint === sp).map(d => (
              <DayRow key={d.date} d={d} limit={v.limit} teams={v.teams} teamCls={teamCls} busy={busy} adding={adding === d.date}
                onAdd={() => setAdding(a => (a === d.date ? null : d.date))}
                onSubmit={b => run(() => addStandBooking(stand, { ...b, date: d.date }), r => `Бронь на ${ddmm(d.date)} добавлена`).then(() => setAdding(null))}
                onDelete={id => run(() => deleteStandBooking(stand, id))} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DayRow({ d, limit, teams, teamCls, busy, adding, onAdd, onSubmit, onDelete }: {
  d: StandDay; limit: number; teams: string[]; teamCls: (t: string) => string; busy: boolean; adding: boolean;
  onAdd: () => void; onSubmit: (b: { team: string; service: string; task: string; hotfix: boolean }) => void; onDelete: (id: string) => void;
}) {
  const [team, setTeam] = useState(teams[0] ?? "");
  const [service, setService] = useState("");
  const [task, setTask] = useState("");
  const [hotfix, setHotfix] = useState(false);
  const past = d.status === "ПРОШЁЛ";
  return (
    <li className={`px-3 py-2 ${d.today ? "bg-primary/5" : ""} ${d.freeze && !past ? "bg-amber-500/5" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-20 text-sm ${d.today ? "font-semibold text-primary" : past ? "text-text-muted" : "text-text-main"}`}>{d.weekday} {ddmm(d.date)}</span>
        <span className="w-24"><Status s={d.status} /></span>
        <span className={`w-10 text-xs tabular-nums ${d.bookings.length >= limit ? "text-red-600 dark:text-red-400 font-semibold" : "text-text-muted"}`}>{d.bookings.length}/{limit}</span>
        <span className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {d.freeze?.reason && <span className="text-xs text-amber-800 dark:text-amber-300">заморозка: {d.freeze.reason}</span>}
          {d.bookings.map(b => (
            <span key={b.id} className={`group/b flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${teamCls(b.team)}`}
              title={`${b.team} · ${b.service}${b.task ? ` · ${b.task}` : ""} — ${b.source === "comment" ? `заявка ${b.by}` : "из SimpleTest"}, ${b.createdAt}`}>
              <b className="font-semibold">{b.team}</b> · {b.service}{b.task && <span className="font-mono opacity-80">· {b.task}</span>}
              {!past && <button type="button" onClick={() => onDelete(b.id)} disabled={busy} aria-label={`Удалить бронь ${b.service}`}
                className="opacity-0 group-hover/b:opacity-100 focus-visible:opacity-100 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>}
            </span>
          ))}
        </span>
        {!past && (
          <button type="button" onClick={onAdd} aria-expanded={adding} aria-label={`Забронировать ${ddmm(d.date)}`}
            className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-bg-subtle"><Plus className="w-4 h-4" /></button>
        )}
      </div>
      {adding && (
        <form className="mt-2 ml-0 sm:ml-[13.5rem] flex flex-wrap items-center gap-2"
          onSubmit={e => { e.preventDefault(); if (service.trim()) onSubmit({ team, service: service.trim(), task: task.trim(), hotfix }); }}>
          <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Команда" className={INPUT}>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input autoFocus value={service} onChange={e => setService(e.target.value)} placeholder="Сервис (КЭ): notify" aria-label="Сервис" className={`${INPUT} w-44`} />
          <input value={task} onChange={e => setTask(e.target.value)} placeholder="Задача: SBER911-…" aria-label="Задача" className={`${INPUT} w-40 font-mono`} />
          {d.freeze && (
            <label className="flex items-center gap-1 text-xs text-text-main"><input type="checkbox" checked={hotfix} onChange={e => setHotfix(e.target.checked)} /> хотфикс</label>
          )}
          <button type="submit" disabled={busy || !service.trim()} className="px-3 py-1 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Забронировать</button>
        </form>
      )}
    </li>
  );
}

function PendingRow({ p, teams, busy, onDecide }: {
  p: StandPending; teams: string[]; busy: boolean;
  onDecide: (d: { accept: boolean; date?: string; team?: string; service?: string; task?: string; note?: string }) => void;
}) {
  const [date, setDate] = useState(p.date);
  const [team, setTeam] = useState(teams.includes(p.team) ? p.team : "");
  const [service, setService] = useState(p.service);
  const [note, setNote] = useState("");
  return (
    <div className="rounded-lg border border-border-main bg-bg-card p-2.5 space-y-2 text-sm">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-text-main font-medium">{p.author || "без автора"}</span>
        <span className="text-amber-800 dark:text-amber-300">{p.reason}</span>
      </div>
      <pre className="whitespace-pre-wrap text-xs text-text-muted bg-bg-subtle rounded-md p-2">{p.text}</pre>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Дата" className={INPUT} />
        <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Команда" className={INPUT}>
          <option value="">команда…</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={service} onChange={e => setService(e.target.value)} placeholder="Сервис" aria-label="Сервис" className={`${INPUT} w-36`} />
        <button type="button" disabled={busy || !date || !team || !service.trim()} onClick={() => onDecide({ accept: true, date, team, service })}
          title="Принять (правила не блокируют: решение ваше)"
          className="px-3 py-1 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Принять</button>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Причина отказа" aria-label="Причина отказа" className={`${INPUT} w-44`} />
        <button type="button" disabled={busy} onClick={() => onDecide({ accept: false, note })}
          className="px-3 py-1 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-50">Отклонить</button>
      </div>
    </div>
  );
}

function SettingsForm({ v, busy, onSave }: { v: StandView; busy: boolean; onSave: (s: { limit: number; sprintStart: string; sprintDays: number; teams: string[] }) => void }) {
  const [limit, setLimit] = useState(String(v.limit));
  const [start, setStart] = useState(v.sprintStart);
  const [days, setDays] = useState(String(v.sprintDays));
  const [teams, setTeams] = useState(v.teams.join(", "));
  return (
    <form className="rounded-xl border border-border-main bg-bg-card p-3 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-text-muted"
      onSubmit={e => { e.preventDefault(); onSave({ limit: Number(limit) || 1, sprintStart: start, sprintDays: Number(days) || 14, teams: teams.split(",").map(t => t.trim()).filter(Boolean) }); }}>
      <label className="space-y-1">Установок в день<input value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={`${INPUT} w-full`} /></label>
      <label className="space-y-1">Начало любого спринта<input type="date" value={start} onChange={e => setStart(e.target.value)} className={`${INPUT} w-full`} /></label>
      <label className="space-y-1">Длина спринта, дней<input value={days} onChange={e => setDays(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={`${INPUT} w-full`} /></label>
      <label className="space-y-1">Команды через запятую<input value={teams} onChange={e => setTeams(e.target.value)} className={`${INPUT} w-full`} /></label>
      <div className="sm:col-span-4 flex justify-end">
        <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Сохранить</button>
      </div>
    </form>
  );
}

function FreezeForm({ busy, onAdd }: { busy: boolean; onAdd: (f: { start: string; end: string; reason: string }) => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={e => { e.preventDefault(); if (start) onAdd({ start, end: end || start, reason }); }}>
      <Snowflake className="w-4 h-4 text-amber-600" />
      <input type="date" value={start} onChange={e => setStart(e.target.value)} aria-label="С даты" className={INPUT} />
      <span className="text-text-muted">—</span>
      <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} aria-label="По дату" className={INPUT} />
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Причина: регресс D-10.076" aria-label="Причина" className={`${INPUT} w-60`} />
      <button type="submit" disabled={busy || !start} className="px-3 py-1 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Заморозить</button>
      <span className="text-xs text-text-muted">в заморозку ставят только хотфиксы</span>
    </form>
  );
}

function BindPage({ stand, onBound }: { stand: string; onBound: () => void }) {
  const [link, setLink] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr("");
    try { await fn(); onBound(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3 text-sm">
      <p className="text-text-main">У стенда {stand} пока нет страницы в Confluence. Создайте её или привяжите существующую.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={parent} onChange={e => setParent(e.target.value)} placeholder="Родительская страница (ссылка, необязательно)" className={`${INPUT} w-80`} />
        <button type="button" disabled={busy} onClick={() => act(() => createStandPage(stand, parent))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Создать страницу</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={link} onChange={e => setLink(e.target.value)} placeholder="Ссылка на готовую страницу: …pageId=123456" className={`${INPUT} w-80`} />
        <button type="button" disabled={busy || !link.trim()} onClick={() => act(() => saveStandsConfig({ [stand]: link }))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-text-main disabled:opacity-50">
          <Link2 className="w-4 h-4" /> Привязать</button>
      </div>
      <p className="text-xs text-text-muted">Страница создаётся в пространстве из вкладки «Подключение». Коллегам, у которых свой SimpleTest, достаточно привязать ту же ссылку.</p>
      {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}
