"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Inbox, Link2, Loader2, Plus, RefreshCw, Settings2, Snowflake, Trash2, X } from "lucide-react";
import {
  addStandBooking, addStandFreeze, createStandPage, decideStandPending, deleteStandBooking, deleteStandFreeze, getStand,
  pullStandRequests, saveStandSettings, saveStandsConfig,
  type NewBooking, type StandBooking, type StandPending, type StandSettings, type StandView,
} from "@/lib/standsApi";
import StandTimeline, { TEAM_CLS, ZOOM } from "./StandTimeline";

const INPUT = "text-sm border border-border-main rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const STATUS_CLS: Record<string, string> = {
  "МОЖНО": "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/40",
  "КОНФЛИКТ": "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40",
  "ЛИМИТ": "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40",
  "ЗАМОРОЗКА": "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40",
};
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function Status({ s }: { s: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS_CLS[s] ?? "bg-bg-subtle text-text-muted border-border-main"}`}>{s}</span>;
}

/**
 * Вкладка стенда: «сегодня», график (строки — команды, дни окна планирования, масштаб), форма брони по щелчку
 * на пустом месте строки, карточка брони по щелчку на ней, заявки из комментариев Confluence, заморозки, настройки
 * окна и релизов. Любое изменение сохраняется в свойство страницы и пересобирает её текст.
 */
export default function StandTab({ stand, pageId, onPageBound }: { stand: string; pageId: string; onPageBound: () => void }) {
  const [v, setV] = useState<StandView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [width, setWidth] = useState<number>(ZOOM.week);
  const [cell, setCell] = useState<{ date: string; team: string } | null>(null);
  const [picked, setPicked] = useState<StandBooking | null>(null);
  const [settings, setSettings] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);

  const run = async (fn: () => Promise<StandView>, ok?: (r: StandView) => string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setV(r);
      const warn = [r.publishError && `страница не пересобралась: ${r.publishError}`, ...(r.replyErrors ?? []), ...(r.pulled?.replyErrors ?? [])].filter(Boolean);
      setMsg(warn.length ? { ok: false, text: `Сохранено, но ${warn.join("; ")}` } : ok ? { ok: true, text: ok(r) } : null);
      return true;
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  };
  useEffect(() => { if (pageId) void run(() => getStand(stand)); else setV(null); }, [stand, pageId]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!pageId) return <BindPage stand={stand} onBound={onPageBound} />;
  if (!v) return <p className="flex items-center gap-2 text-sm text-text-muted">{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Читаю график из Confluence…</> : msg?.text}</p>;

  const teamCls = (t: string) => TEAM_CLS[Math.max(0, v.teams.indexOf(t)) % TEAM_CLS.length];
  const conflicts = v.days.reduce((n, d) => n + d.conflicts.length, 0);
  const cellDay = cell ? v.days.find(d => d.date === cell.date) : undefined;
  // «Всё окно» — день такой ширины, чтобы окно поместилось в видимую часть (примерно 820 px).
  const fit = Math.max(10, Math.floor(820 / Math.max(1, v.days.length)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-main">Сегодня, {ddmm(v.today.date)}:</span>
        <Status s={v.today.status} />
        <span className="text-sm text-text-muted">установок {v.today.count}</span>
        {conflicts > 0 && <span className="text-sm font-semibold text-red-600 dark:text-red-400">конфликтов в окне: {conflicts}</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => run(() => pullStandRequests(stand), r => `Заявок: принято ${r.pulled?.accepted ?? 0}, на рассмотрении ${r.pulled?.pending ?? 0}`)}
            disabled={busy} title="Прочитать новые комментарии-заявки на странице стенда и ответить на них итогом"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />} Забрать заявки</button>
          <button type="button" onClick={() => run(() => getStand(stand))} disabled={busy} title="Перечитать график из Confluence" aria-label="Обновить"
            className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main disabled:opacity-50"><RefreshCw className="w-4 h-4" /></button>
          <button type="button" onClick={() => setFreezeOpen(o => !o)} aria-expanded={freezeOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
            <Snowflake className="w-4 h-4" /> Заморозка</button>
          <button type="button" onClick={() => setSettings(o => !o)} aria-expanded={settings} title="Окно планирования, релизы, команды" aria-label="Настройки стенда"
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
      {settings && <SettingsForm v={v} busy={busy} onSave={s => run(() => saveStandSettings(stand, s), () => "Настройки сохранены").then(ok => ok && setSettings(false))} />}
      {freezeOpen && <FreezeForm busy={busy} onAdd={f => run(() => addStandFreeze(stand, f), () => "Заморозка добавлена").then(ok => ok && setFreezeOpen(false))} />}
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

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span>Окно {ddmm(v.window.from)}.{v.window.from.slice(0, 4)} — {ddmm(v.window.to)}.{v.window.to.slice(0, 4)}</span>
        {v.releases.map(r => <span key={r.id} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-700 dark:text-red-400">{r.name} · {ddmm(r.date)}</span>)}
        <span className="ml-auto flex items-center gap-1" role="group" aria-label="Масштаб">
          {([["День", ZOOM.day], ["Неделя", ZOOM.week], ["Всё окно", fit]] as const).map(([label, w]) => (
            <button key={label} type="button" onClick={() => setWidth(w)} aria-pressed={width === w}
              className={`px-2.5 py-1 rounded-md border text-xs ${width === w ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>{label}</button>
          ))}
          <span className="ml-1">Ctrl + колесо — масштаб · тянуть — прокрутка</span>
        </span>
      </div>

      <StandTimeline v={v} width={width} onWidth={setWidth} selected={picked?.id ?? null}
        onPickCell={(date, team) => { setPicked(null); setCell({ date, team }); }}
        onPickBooking={b => { setCell(null); setPicked(b); }} />

      {cell && cellDay && (
        <BookingForm key={`${cell.date}|${cell.team}`} date={cell.date} weekday={cellDay.weekday} team={cell.team} teams={v.teams}
          freeze={!!cellDay.freeze} busy={busy} onCancel={() => setCell(null)}
          onSubmit={b => run(() => addStandBooking(stand, b), () => `Бронь на ${ddmm(b.date)} добавлена`).then(ok => ok && setCell(null))} />
      )}
      {picked && (
        <div className="rounded-xl border border-border-main bg-bg-card p-3 text-sm space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${teamCls(picked.team)}`}>{picked.team}</span>
            <b className="text-text-main">{picked.service}</b>
            <span className="text-text-muted">{ddmm(picked.date)}{picked.task && ` · ${picked.task}`}</span>
            {picked.conflict && <span className="text-xs font-semibold text-red-600 dark:text-red-400">конфликт: этот КЭ в этот день ставит другая команда</span>}
            <span className="ml-auto flex gap-2">
              <button type="button" onClick={() => run(() => deleteStandBooking(stand, picked.id), () => "Бронь удалена").then(ok => ok && setPicked(null))} disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-main text-xs text-text-main hover:text-red-600 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Удалить</button>
              <button type="button" onClick={() => setPicked(null)} aria-label="Закрыть" className="p-1 text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
            </span>
          </div>
          <p className="text-xs text-text-muted">{picked.source === "comment" ? `Заявка из комментария: ${picked.by}` : "Поставлено в SimpleTest"} · {picked.createdAt}</p>
          {picked.features
            ? <ul className="list-disc pl-5 text-text-main">{picked.features.split(/[;\n]/).map(x => x.trim()).filter(Boolean).map(x => <li key={x}>{x}</li>)}</ul>
            : <p className="text-text-muted">Фичи не указаны.</p>}
        </div>
      )}
    </div>
  );
}

function BookingForm({ date, weekday, team: team0, teams, freeze, busy, onSubmit, onCancel }: {
  date: string; weekday: string; team: string; teams: string[]; freeze: boolean; busy: boolean;
  onSubmit: (b: NewBooking) => void; onCancel: () => void;
}) {
  const [team, setTeam] = useState(team0);
  const [service, setService] = useState("");
  const [features, setFeatures] = useState("");
  const [task, setTask] = useState("");
  const [hotfix, setHotfix] = useState(false);
  return (
    <form className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm"
      onSubmit={e => { e.preventDefault(); if (service.trim()) onSubmit({ date, team, service: service.trim(), features: features.trim(), task: task.trim(), hotfix }); }}>
      <p className="font-semibold text-text-main">Бронь на {weekday} {ddmm(date)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Команда" className={INPUT}>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input autoFocus value={service} onChange={e => setService(e.target.value)} placeholder="КЭ (сервис): notify" aria-label="КЭ" className={`${INPUT} w-48`} />
        <input value={task} onChange={e => setTask(e.target.value)} placeholder="Задача: SBER911-…" aria-label="Задача" className={`${INPUT} w-40 font-mono`} />
        {freeze && <label className="flex items-center gap-1 text-xs text-text-main"><input type="checkbox" checked={hotfix} onChange={e => setHotfix(e.target.checked)} /> хотфикс (день в заморозке)</label>}
      </div>
      <textarea value={features} onChange={e => setFeatures(e.target.value)} rows={2} aria-label="Фичи"
        placeholder="Фичи — каждая с новой строки или через «;»: тема инцидента на карточке; фильтр по статусу" className={`${INPUT} w-full`} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !service.trim()} className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Забронировать</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted">Отмена</button>
      </div>
    </form>
  );
}

function PendingRow({ p, teams, busy, onDecide }: {
  p: StandPending; teams: string[]; busy: boolean;
  onDecide: (d: { accept: boolean; date?: string; team?: string; service?: string; features?: string; note?: string }) => void;
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
        <input value={service} onChange={e => setService(e.target.value)} placeholder="КЭ" aria-label="КЭ" className={`${INPUT} w-36`} />
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

function SettingsForm({ v, busy, onSave }: { v: StandView; busy: boolean; onSave: (s: StandSettings) => void }) {
  const [from, setFrom] = useState(v.window.from);
  const [to, setTo] = useState(v.window.to);
  const [rels, setRels] = useState(v.releases.map(r => ({ name: r.name, date: r.date })));
  const [teams, setTeams] = useState(v.teams.join(", "));
  const [limit, setLimit] = useState(v.limit ? String(v.limit) : "");
  return (
    <form className="rounded-xl border border-border-main bg-bg-card p-3 space-y-3 text-xs text-text-muted"
      onSubmit={e => {
        e.preventDefault();
        onSave({ windowFrom: from, windowTo: to, releases: rels.filter(r => r.name.trim() && r.date),
                 teams: teams.split(",").map(t => t.trim()).filter(Boolean), limit: Number(limit) || 0 });
      }}>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <label className="space-y-1">Окно с<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${INPUT} w-full`} /></label>
        <label className="space-y-1">по<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={`${INPUT} w-full`} /></label>
        <label className="space-y-1">Команды через запятую<input value={teams} onChange={e => setTeams(e.target.value)} className={`${INPUT} w-full`} /></label>
        <label className="space-y-1">Лимит установок в день<input value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ""))} inputMode="numeric"
          placeholder="без лимита" className={`${INPUT} w-full`} /></label>
      </div>
      <div className="space-y-1.5">
        <p>Даты релизов — пунктиром на графике и отметкой в Confluence:</p>
        {rels.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={r.name} onChange={e => setRels(x => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} placeholder="Release 26 · D-10.076"
              aria-label="Название релиза" className={`${INPUT} w-56`} />
            <input type="date" value={r.date} onChange={e => setRels(x => x.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} aria-label="Дата релиза" className={INPUT} />
            <button type="button" onClick={() => setRels(x => x.filter((_, j) => j !== i))} aria-label="Убрать релиз" className="p-1 hover:text-red-500"><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRels(x => [...x, { name: "", date: to }])} className="flex items-center gap-1 text-primary hover:underline">
          <Plus className="w-3.5 h-3.5" /> релиз</button>
      </div>
      <div className="flex justify-end">
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
      <p className="text-xs text-text-muted">Страница создаётся в пространстве из настроек Confluence (шестерёнка вверху). Коллегам, у которых свой SimpleTest, достаточно привязать ту же ссылку.</p>
      {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}
