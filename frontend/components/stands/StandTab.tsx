"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ExternalLink, Inbox, Link2, ListPlus, Loader2, Maximize2, Minimize2, Plus, RefreshCw, Settings2, Snowflake, Trash2, X } from "lucide-react";
import {
  addStandBookings, addStandFreeze, createStandPage, decideStandPending, deleteStandBooking, deleteStandFreeze, getStand,
  pullStandRequests, saveStandSettings, saveStandsConfig, addKe, saveKeCatalog,
  canonKe, keKey, type NewBooking, type StandPending, type StandSettings, type StandView,
} from "@/lib/standsApi";
import StandTimeline, { blocksOf, TEAM_CLS, ZOOM, type FeatureStage, type StandBlock } from "./StandTimeline";
import ImportFromList, { type PickedFeature } from "./ImportFromList";
import KePicker from "./KePicker";
import { useFeatureStage } from "./useFeatureStage";

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
 * на пустом месте строки (сразу несколько КЭ из справочника), карточка установки по щелчку на ней (все фичи КЭ
 * со статусом (st) и удалением по одной), заявки из комментариев Confluence, заморозки, настройки
 * окна и релизов. Любое изменение сохраняется в свойство страницы и пересобирает её текст.
 */
export default function StandTab({ stand, pageId, onPageBound }: { stand: string; pageId: string; onPageBound: () => void }) {
  const [v, setV] = useState<StandView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [width, setWidth] = useState<number>(ZOOM.week);
  const [cell, setCell] = useState<{ date: string; team: string } | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);   // установка: дата|команда|кэ
  const [settings, setSettings] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [full, setFull] = useState(false);       // график во весь экран
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

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
  const featureStage = useFeatureStage(v);
  /** Новый КЭ из формы брони — в справочник (файл на сервере); список в форме обновляется сразу. */
  const createKe = async (names: string[]) => {
    try {
      const r = await addKe(names);
      setV(x => (x ? { ...x, keCatalog: r.ke } : x));
    } catch (e) {
      setMsg({ ok: false, text: `КЭ не сохранился в справочник: ${(e as Error).message}` });
      throw e;
    }
  };
  // Выбранная установка — пересчитывается из свежих данных (удалили фичу — карточка обновилась, удалили все — закрылась).
  const picked = useMemo<StandBlock | null>(() => {
    if (!v || !pickedKey) return null;
    const [date, team] = pickedKey.split("|");
    const day = v.days.find(d => d.date === date);
    return day ? blocksOf(day.bookings, team, date).find(b => b.key === pickedKey) ?? null : null;
  }, [v, pickedKey]);

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
      {settings && <SettingsForm v={v} busy={busy} onSave={(s, ke) => run(async () => {
        if (ke) await saveKeCatalog(ke);
        return saveStandSettings(stand, s);
      }, () => "Настройки сохранены").then(ok => ok && setSettings(false))} />}
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
          <datalist id="stand-ke-catalog">{v.keCatalog.map(k => <option key={k} value={k} />)}</datalist>
          {v.pending.map(p => <PendingRow key={p.cid} p={p} teams={v.teams} busy={busy}
            onDecide={d => run(() => decideStandPending(stand, p.cid, d), () => d.accept ? "Заявка принята" : "Заявка отклонена")} />)}
        </section>
      )}

      {/* Во весь экран — слой поверх всей страницы (портал): внутри панели раздела fixed не перекрыл бы меню. */}
      {(() => { const block = (
      <div className={full ? "fixed inset-0 z-[100] bg-[var(--color-bg-main)] p-4 overflow-y-auto space-y-3" : "space-y-3"}>
        {full && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-main">{v.stand}</span>
            <Status s={v.today.status} />
            {msg && <span className={`text-xs ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span>}
          </div>
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
            <button type="button" onClick={() => setFull(f => !f)} title={full ? "Свернуть (Esc)" : "График во весь экран"}
              aria-label={full ? "Свернуть график" : "График во весь экран"}
              className="ml-1 p-1.5 rounded-md border border-border-main text-text-muted hover:text-text-main">
              {full ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
          </span>
        </div>

        <StandTimeline v={v} width={width} onWidth={setWidth} selected={picked?.key ?? null} featureStage={featureStage}
          onPickCell={(date, team) => { setPickedKey(null); setCell({ date, team }); }}
          onPickBlock={b => { setCell(null); setPickedKey(b.key); }} />

        {cell && cellDay && (
          <BookingForm key={`${cell.date}|${cell.team}`} date={cell.date} team={cell.team} teams={v.teams} freezes={v.freezes}
            window={v.window} catalog={v.keCatalog} onCreateKe={createKe} featureStage={featureStage} busy={busy} onCancel={() => setCell(null)}
            onPublish={items => run(() => addStandBookings(stand, items), r => {
              const x = r as StandView & { added: number; rejected: { service: string; task: string; reason: string }[] };
              return `Опубликовано броней: ${x.added}` + (x.rejected.length ? `; не встали ${x.rejected.length}: ${x.rejected.slice(0, 3).map(j => `${j.task || j.service} — ${j.reason}`).join("; ")}` : "");
            }).then(ok => ok && setCell(null))} />
        )}
      </div>
      ); return full ? createPortal(block, document.body) : block; })()}
      {picked && (
        <div className="rounded-xl border border-border-main bg-bg-card p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${teamCls(picked.team)}`}>{picked.team}</span>
            <b className="text-text-main">{picked.service}</b>
            <span className="text-text-muted">{ddmm(picked.date)} · фич {picked.items.length}</span>
            {picked.conflict && <span className="text-xs font-semibold text-red-600 dark:text-red-400">конфликт: этот КЭ в этот день ставит другая команда</span>}
            <button type="button" onClick={() => setPickedKey(null)} aria-label="Закрыть" className="ml-auto p-1 text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
          </div>
          <ul className="divide-y divide-border-main border border-border-main rounded-lg">
            {picked.items.map(it => {
              const st = it.task ? featureStage(it.task) : null;
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
                  <span className="font-mono text-primary">{it.task || "—"}</span>
                  <span className="min-w-0 flex-1 text-text-main">{it.features || <span className="text-text-muted">без названия</span>}
                    {it.dateTo && <span className="text-xs text-text-muted"> · {ddmm(it.date)}–{ddmm(it.dateTo)}</span>}</span>
                  <span className="text-xs text-text-muted whitespace-nowrap">{st ? `${st.dot} ${st.text}` : "статус (st) неизвестен"}</span>
                  <span className="text-[11px] text-text-muted whitespace-nowrap" title={it.createdAt}>{it.source === "comment" ? `заявка: ${it.by}` : "SimpleTest"}</span>
                  <button type="button" onClick={() => run(() => deleteStandBooking(stand, it.id), () => `Фича ${it.task || ""} снята с ${picked.service}`)} disabled={busy}
                    aria-label={`Удалить ${it.task || "бронь"}`} title={it.dateTo ? "Снять эту фичу с установки — со всего диапазона" : "Снять эту фичу с установки"}
                    className="p-1 text-text-muted hover:text-red-600 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => { setPickedKey(null); setCell({ date: picked.date, team: picked.team }); }}
            className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="w-3.5 h-3.5" /> фичу или КЭ на этот день</button>
        </div>
      )}
    </div>
  );
}

/** Строка черновика брони: фича (номер и название) и её КЭ. */
interface DraftRow { id: string; task: string; name: string; kes: string[] }
const newRow = (r: Partial<DraftRow> = {}): DraftRow => ({ id: Math.random().toString(36).slice(2), task: "", name: "", kes: [], ...r });

/** Рабочие дни диапазона (как на бэкенде: выходные пропускаются). */
function workDays(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to || to < from) return out;
  for (let d = new Date(`${from}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (iso > to || out.length > 70) break;
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(iso);
  }
  return out;
}

/**
 * Черновик брони: команда, дни «с — по», фичи с их КЭ. Фичи — руками или «Из списка Jira tool» (номер, название
 * и КЭ задачи подставляются, их можно поправить, добавить КЭ). «КЭ для всех фич» добавляется к каждой.
 * В Confluence ничего не уходит, пока не нажата «Опубликовать»: бронь на каждую пару фича × КЭ, одна на весь диапазон.
 */
function BookingForm({ date, team: team0, teams, freezes, window: win, catalog, onCreateKe, featureStage, busy, onPublish, onCancel }: {
  date: string; team: string; teams: string[]; freezes: StandView["freezes"]; window: StandView["window"]; catalog: string[];
  onCreateKe: (names: string[]) => Promise<void>; featureStage: FeatureStage; busy: boolean;
  onPublish: (items: NewBooking[]) => void; onCancel: () => void;
}) {
  const [fromList, setFromList] = useState(false);
  const [team, setTeam] = useState(team0);
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [rows, setRows] = useState<DraftRow[]>([newRow()]);
  const [common, setCommon] = useState<string[]>([]);
  const [hotfix, setHotfix] = useState(false);
  const setRow = (id: string, patch: Partial<DraftRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const norm = keKey;

  const days = workDays(from, to);
  const frozen = days.filter(d => freezes.some(f => f.from <= d && d <= f.to));
  const rangeTo = to > from ? to : "";
  const filled = rows.filter(r => r.task.trim() || r.name.trim() || r.kes.length);
  const kesOf = (r: DraftRow) => [...r.kes, ...common].filter((k, i, a) => a.findIndex(x => norm(x) === norm(k)) === i);
  const noKe = filled.filter(r => !kesOf(r).length);
  const items: NewBooking[] = filled.flatMap(r => kesOf(r).map(service => ({
    date: from, dateTo: rangeTo, team, service, features: r.name.trim(), task: r.task.trim().toUpperCase(), hotfix,
  })));
  const pick = (picked: PickedFeature[]) => setRows(rs => {
    const have = new Set(rs.map(r => r.task.trim().toUpperCase()).filter(Boolean));
    const base = rs.filter(r => r.task.trim() || r.name.trim() || r.kes.length);   // пустую строку-заготовку убираем
    // КЭ задачи — в написании справочника: из Jira он может прийти «Название (3521751)».
    return [...base, ...picked.filter(p => !have.has(p.task)).map(p => newRow({ ...p, kes: p.kes.map(k => canonKe(k, catalog)) }))];
  });
  const dd = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

  return (
    <form className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-3 text-sm"
      onSubmit={e => { e.preventDefault(); if (items.length && !noKe.length) onPublish(items); }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-text-main">Новая бронь</span>
        <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Команда" className={INPUT}>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">с
          <input type="date" value={from} min={win.from} max={win.to} aria-label="С даты"
            onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} className={INPUT} /></label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">по
          <input type="date" value={to} min={from} max={win.to} aria-label="По дату" onChange={e => setTo(e.target.value)} className={INPUT} /></label>
        <span className="text-xs text-text-muted">рабочих дней: {days.length}{days.length > 1 ? ` (${dd(days[0])}–${dd(days[days.length - 1])})` : ""}</span>
        {frozen.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
            <input type="checkbox" checked={hotfix} onChange={e => setHotfix(e.target.checked)} /> хотфикс — в заморозку ({frozen.map(dd).join(", ")})</label>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-start gap-2">
          <span className="text-xs text-text-muted pt-2 w-32">КЭ для всех фич</span>
          <KePicker value={common} onChange={setCommon} catalog={catalog} onCreate={onCreateKe} placeholder="добавится к каждой фиче" className="flex-1 min-w-[16rem]" />
        </div>
        {rows.map((r, n) => {
          const st = r.task.trim() ? featureStage(r.task.trim().toUpperCase()) : null;
          return (
            <div key={r.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-border-main bg-bg-card p-2">
              <input value={r.task} onChange={e => setRow(r.id, { task: e.target.value })} placeholder="SBER911-…" aria-label={`Номер фичи ${n + 1}`}
                className={`${INPUT} w-32 font-mono`} />
              <input value={r.name} onChange={e => setRow(r.id, { name: e.target.value })} placeholder="Название фичи" aria-label={`Название фичи ${n + 1}`}
                className={`${INPUT} flex-1 min-w-[12rem]`} />
              <KePicker value={r.kes} onChange={kes => setRow(r.id, { kes })} catalog={catalog} onCreate={onCreateKe} autoFocus={n === 0 && rows.length === 1}
                placeholder={common.length ? "свои КЭ (по желанию)" : "КЭ фичи"} className="flex-[2] min-w-[16rem]" />
              {st && <span className="text-xs text-text-muted whitespace-nowrap pt-2" title="Статус (st) в Jira tool">{st.dot} {st.text}</span>}
              <button type="button" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(x => x.id !== r.id) : [newRow()]))}
                aria-label={`Убрать фичу ${n + 1}`} className="p-2 text-text-muted hover:text-red-600"><X className="w-4 h-4" /></button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRows(rs => [...rs, newRow()])} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="w-3.5 h-3.5" /> фича</button>
          <button type="button" onClick={() => setFromList(o => !o)} aria-expanded={fromList}
            title="Номер, название и КЭ задач из списка Jira tool подставятся в форму"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle">
            <ListPlus className="w-3.5 h-3.5" /> Из списка Jira tool</button>
        </div>
        {fromList && <ImportFromList already={new Set(rows.map(r => r.task.trim().toUpperCase()).filter(Boolean))} onPick={rs => { pick(rs); setFromList(false); }} />}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-main pt-2">
        <button type="submit" disabled={busy || !items.length || !!noKe.length || !days.length}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          Опубликовать{items.length ? `: броней ${items.length}` : ""}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted">Отмена</button>
        <span className="text-xs text-text-muted">
          {filled.length ? `фич ${filled.length} × их КЭ` : "добавьте фичу или КЭ"}{days.length > 1 ? `, каждая — на ${days.length} рабочих дня(ей)` : ""}
        </span>
        {noKe.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">без КЭ: {noKe.map(r => r.task || r.name || "строка").join(", ")}</span>}
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
        <input value={service} onChange={e => setService(e.target.value)} placeholder="КЭ: a, b" aria-label="КЭ" list="stand-ke-catalog" className={`${INPUT} w-36`} />
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

function SettingsForm({ v, busy, onSave }: { v: StandView; busy: boolean; onSave: (s: StandSettings, ke: string[] | null) => void }) {
  const [from, setFrom] = useState(v.window.from);
  const [to, setTo] = useState(v.window.to);
  const [rels, setRels] = useState(v.releases.map(r => ({ name: r.name, date: r.date })));
  const [teams, setTeams] = useState(v.teams.join(", "));
  const [limit, setLimit] = useState(v.limit ? String(v.limit) : "");
  const [ke, setKe] = useState(v.keCatalog.join("\n"));
  const keList = Array.from(new Set(ke.split(/[\n,;]/).map(x => x.trim()).filter(Boolean)));
  return (
    <form className="rounded-xl border border-border-main bg-bg-card p-3 space-y-3 text-xs text-text-muted"
      onSubmit={e => {
        e.preventDefault();
        onSave({ windowFrom: from, windowTo: to, releases: rels.filter(r => r.name.trim() && r.date),
                 teams: teams.split(",").map(t => t.trim()).filter(Boolean), limit: Number(limit) || 0 },
               keList.join("\n") === v.keCatalog.join("\n") ? null : keList);   // справочник — только если правили
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
      <label className="block space-y-1">
        <span>Справочник КЭ — выпадающий список в форме брони, один на оба стенда; по одному на строку (или через запятую). Сейчас: {keList.length}</span>
        <textarea value={ke} onChange={e => setKe(e.target.value)} rows={5} placeholder={"rms-front\ngateway\nnotify"} className={`${INPUT} w-full font-mono`} />
      </label>
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
