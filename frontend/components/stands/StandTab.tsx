"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ExternalLink, Inbox, Link2, ListPlus, Loader2, Maximize2, Minimize2, Plus, RefreshCw, Settings2, Snowflake, Trash2, X } from "lucide-react";
import {
  addStandBookings, addStandFreeze, createStandPage, decideStandPending, deleteStandBooking, deleteStandFreeze, getStand,
  pullStandRequests, saveStandSettings, saveStandsConfig, addMs, saveMsCatalog,
  keKey, type NewBooking, type StandPending, type StandSettings, type StandView,
} from "@/lib/standsApi";
import { msChipStyle } from "@/lib/msColor";
import StandTimeline, { barWhen, barsOf, bookingWhen, TEAM_CLS, ZOOM, type FeatureStage, type StandBlock } from "./StandTimeline";
import ImportFromList, { type PickedFeature } from "./ImportFromList";
import ServicePicker from "./ServicePicker";
import { useFeatureStage } from "./useFeatureStage";

const INPUT = "text-sm border border-border-main rounded-lg px-2 py-1 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const STATUS_CLS: Record<string, string> = {
  "МОЖНО": "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/40",
  "КОНФЛИКТ": "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40",
  "ЛИМИТ": "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40",
  "ЗАМОРОЗКА": "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40",
};
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** «3 месяца»: от сегодня минус 3 месяца до конца окна планирования (или сегодня, если окно уже закончилось). */
function quarterRange(v: StandView): { from: string; to: string } {
  const t = new Date(`${v.today.date}T00:00:00`);
  const from = new Date(t); from.setMonth(from.getMonth() - 3);
  return { from: isoOf(from), to: v.window.to > v.today.date ? v.window.to : v.today.date };
}
type Note = { ok: boolean; text: string };

function Status({ s }: { s: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS_CLS[s] ?? "bg-bg-subtle text-text-muted border-border-main"}`}>{s}</span>;
}

/**
 * Вкладка стенда: «сегодня», график (строки — команды; период — окно планирования или последние 3 месяца; масштаб
 * от часов до квартала), форма брони по щелчку на пустом месте строки (второй щелчок в той же строке — конец
 * периода; микросервисы из справочника, время установки), карточка установки по щелчку на ней (все фичи
 * со статусом (st) и удалением по одной), заявки из комментариев Confluence, заморозки, настройки окна, релизов
 * и справочника микросервисов. Любое изменение сохраняется в свойство страницы и пересобирает её текст.
 */
export default function StandTab({ stand, pageId, onPageBound }: { stand: string; pageId: string; onPageBound: () => void }) {
  const [v, setV] = useState<StandView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [width, setWidth] = useState<number>(ZOOM.week);
  const [cell, setCell] = useState<{ date: string; team: string; minute: number | null } | null>(null);
  /** Второй щелчок в той же строке при открытой форме — конец (или начало) периода; n — чтобы повтор тоже сработал. */
  const [cellEnd, setCellEnd] = useState<{ date: string; n: number } | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);   // установка: дата|команда|микросервис
  /** Период графика: окно планирования или последние 3 месяца (только просмотр того, что вне окна). */
  const [period, setPeriod] = useState<"window" | "quarter">("window");
  const periodRef = useRef(period);
  periodRef.current = period;
  const [settings, setSettings] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [full, setFull] = useState(false);       // график во весь экран
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  /** Изменение (или чтение) графика. ok — сообщение об успехе; вернуть {ok: false} — показать как предупреждение. */
  const run = async (fn: () => Promise<StandView>, ok?: (r: StandView) => string | Note) => {
    setBusy(true); setMsg(null);
    try {
      let r = await fn();
      // Изменения отвечают графиком окна — в режиме «3 месяца» перечитываем свой период.
      if (periodRef.current === "quarter") {
        const q = quarterRange(r);
        if (r.range.from !== q.from) {
          // Свежий график за 3 месяца, а итог изменения (добавлено, не встали, ошибки публикации) — из ответа.
          const { days, range, ...rest } = r;
          void days; void range;
          const fresh = await getStand(stand, q);
          r = { ...rest, days: fresh.days, range: fresh.range };
        }
      }
      setV(r);
      const warn = [r.publishError && `страница не пересобралась: ${r.publishError}`, ...(r.replyErrors ?? []), ...(r.pulled?.replyErrors ?? [])].filter(Boolean);
      const note = ok?.(r);
      setMsg(warn.length ? { ok: false, text: `Сохранено, но ${warn.join("; ")}` } : typeof note === "string" ? { ok: true, text: note } : note ?? null);
      return true;
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  };
  useEffect(() => { if (pageId) void run(() => getStand(stand)); else setV(null); }, [stand, pageId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const featureStage = useFeatureStage(v);
  /** Новый микросервис из формы брони — в справочник (файл на сервере); список в форме обновляется сразу. */
  const createMs = async (names: string[]) => {
    try {
      const r = await addMs(names);
      setV(x => (x ? { ...x, msCatalog: r.ms } : x));
    } catch (e) {
      setMsg({ ok: false, text: `Микросервис не сохранился в справочник: ${(e as Error).message}` });
      throw e;
    }
  };
  const showPeriod = (p: "window" | "quarter", w?: number) => {
    if (!v) return;
    setPeriod(p); periodRef.current = p;
    void run(() => getStand(stand, p === "quarter" ? quarterRange(v) : null)).then(ok => { if (ok && w) setWidth(w); });
  };
  // Выбранная установка — пересчитывается из свежих данных (удалили фичу — карточка обновилась, удалили все — закрылась).
  const picked = useMemo<StandBlock | null>(() => {
    if (!v || !pickedKey) return null;
    return barsOf(v).find(b => b.key === pickedKey) ?? null;
  }, [v, pickedKey]);

  if (!pageId) return <BindPage stand={stand} onBound={onPageBound} />;
  if (!v) return <p className="flex items-center gap-2 text-sm text-text-muted">{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Читаю график из Confluence…</> : msg?.text}</p>;

  const teamCls = (t: string) => TEAM_CLS[Math.max(0, v.teams.indexOf(t)) % TEAM_CLS.length];
  const conflicts = v.days.filter(d => d.inWindow).reduce((n, d) => n + d.conflicts.length, 0);
  const cellDay = cell ? v.days.find(d => d.date === cell.date) : undefined;
  // «Окно» / «3 месяца» — день такой ширины, чтобы период поместился в видимую часть (примерно 820 px).
  const fitOf = (days: number) => Math.max(6, Math.floor(820 / Math.max(1, days)));
  const winDays = Math.round((Date.parse(v.window.to) - Date.parse(v.window.from)) / 864e5) + 1;
  const q = quarterRange(v);
  const qDays = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 864e5) + 1;

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
      {settings && <SettingsForm v={v} busy={busy} onSave={(s, ms) => run(async () => {
        if (ms) await saveMsCatalog(ms);
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
          <datalist id="stand-ms-catalog">{v.msCatalog.map(k => <option key={k} value={k} />)}</datalist>
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
          <span>Окно {ddmm(v.window.from)}.{v.window.from.slice(0, 4)} — {ddmm(v.window.to)}.{v.window.to.slice(0, 4)}
            {period === "quarter" && <> · показано {ddmm(v.range.from)}.{v.range.from.slice(0, 4)} — {ddmm(v.range.to)}.{v.range.to.slice(0, 4)}</>}</span>
          {v.releases.map(r => <span key={r.id} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-700 dark:text-red-400">{r.name} · {ddmm(r.date)}</span>)}
          <span className="ml-auto flex items-center gap-1" role="group" aria-label="Масштаб">
            {([["Часы", ZOOM.hours], ["День", ZOOM.day], ["Неделя", ZOOM.week]] as const).map(([label, w]) => (
              <button key={label} type="button" onClick={() => setWidth(w)} aria-pressed={width === w}
                title={label === "Часы" ? "День по часам: бронь со временем — на своих часах" : undefined}
                className={`px-2.5 py-1 rounded-md border text-xs ${width === w ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>{label}</button>
            ))}
            <span className="w-px h-4 bg-border-main mx-0.5" />
            <button type="button" onClick={() => (period === "window" ? setWidth(fitOf(winDays)) : showPeriod("window", fitOf(winDays)))}
              aria-pressed={period === "window" && width === fitOf(winDays)} title="Всё окно планирования на экране"
              className={`px-2.5 py-1 rounded-md border text-xs ${period === "window" && width === fitOf(winDays) ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>Окно</button>
            <button type="button" onClick={() => showPeriod("quarter", fitOf(qDays))} aria-pressed={period === "quarter"}
              title="Последние 3 месяца от сегодня и всё окно планирования; дни вне окна — только просмотр"
              className={`px-2.5 py-1 rounded-md border text-xs ${period === "quarter" ? "border-primary text-primary bg-primary/10" : "border-border-main text-text-muted hover:text-text-main"}`}>3 месяца</button>
            <span className="ml-1">Ctrl + колесо — масштаб · тянуть — прокрутка</span>
            <button type="button" onClick={() => setFull(f => !f)} title={full ? "Свернуть (Esc)" : "График во весь экран"}
              aria-label={full ? "Свернуть график" : "График во весь экран"}
              className="ml-1 p-1.5 rounded-md border border-border-main text-text-muted hover:text-text-main">
              {full ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
          </span>
        </div>

        <StandTimeline v={v} width={width} onWidth={setWidth} selected={picked?.key ?? null} featureStage={featureStage}
          onPickCell={(date, team, minute) => {
            setPickedKey(null);
            // Форма уже открыта для этой команды — щелчок по другому дню задаёт период.
            if (cell && cell.team === team && date !== cell.date) setCellEnd({ date, n: Date.now() });
            else { setCell({ date, team, minute }); setCellEnd(null); }
          }}
          onPickBlock={b => { setCell(null); setPickedKey(b.key); }} />

        {cell && cellDay && (
          <BookingForm key={`${cell.date}|${cell.team}`} date={cell.date} minute={cell.minute} end={cellEnd} team={cell.team} teams={v.teams}
            freezes={v.freezes} window={v.window} catalog={v.msCatalog} info={v.msInfo ?? {}} onCreate={createMs} featureStage={featureStage} busy={busy}
            onCancel={() => { setCell(null); setCellEnd(null); }}
            onPublish={items => run(() => addStandBookings(stand, items), r => {
              const x = r as StandView & { added?: number; rejected?: { service: string; task: string; reason: string }[] };
              const rejected = x.rejected ?? [];
              const text = `Опубликовано броней: ${x.added ?? items.length - rejected.length}` + (rejected.length
                ? `; не встали ${rejected.length}: ${rejected.slice(0, 3).map(j => `${j.task || j.service} — ${j.reason}`).join("; ")}` : "");
              // Защита от старого бэкенда: он молча ставит бронь на первый день и без времени.
              const all = r.days.flatMap(d => d.bookings);
              const lost = items.filter(it => (it.dateTo || it.timeFrom || it.timeTo) && !rejected.some(j => j.service === it.service && j.task === it.task)
                && !all.some(b => b.team === it.team && b.service === it.service && b.date === it.date
                  && (b.dateTo ?? "") === (it.dateTo ?? "") && (b.timeFrom ?? "") === (it.timeFrom ?? "") && (b.timeTo ?? "") === (it.timeTo ?? "")));
              return lost.length
                ? { ok: false, text: `${text}. Но сервер сохранил их без периода или времени — бэкенд старой версии: перезапустите его (start.sh) и поставьте брони заново.` }
                : text;
            }).then(ok => { if (ok) { setCell(null); setCellEnd(null); } })} />
        )}
      </div>
      ); return full ? createPortal(block, document.body) : block; })()}
      {picked && (
        <div className="rounded-xl border border-border-main bg-bg-card p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${teamCls(picked.team)}`}>{picked.team}</span>
            <b style={msChipStyle(picked.service).style} className="ms-chip px-1.5 py-0.5 rounded-md">{picked.service}</b>
            <span className="text-text-muted">{barWhen(v.range.from, picked)} · фич {picked.items.length}</span>
            {picked.conflict && <span className="text-xs font-semibold text-red-600 dark:text-red-400">конфликт: этот микросервис в это время ставит другая команда</span>}
            <button type="button" onClick={() => setPickedKey(null)} aria-label="Закрыть" className="ml-auto p-1 text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
          </div>
          <ul className="divide-y divide-border-main border border-border-main rounded-lg">
            {picked.items.map(it => {
              const st = it.task ? featureStage(it.task) : null;
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
                  <span className="font-mono text-primary">{it.task || "—"}</span>
                  <span className="min-w-0 flex-1 text-text-main">{it.features || <span className="text-text-muted">без названия</span>}
                    <span className="text-xs text-text-muted"> · {bookingWhen(it)}</span></span>
                  <span className="text-xs text-text-muted whitespace-nowrap">{st ? `${st.dot} ${st.text}` : "статус (st) неизвестен"}</span>
                  <span className="text-[11px] text-text-muted whitespace-nowrap" title={it.createdAt}>{it.source === "comment" ? `заявка: ${it.by}` : "SimpleTest"}</span>
                  <button type="button" onClick={() => run(() => deleteStandBooking(stand, it.id), () => `Фича ${it.task || ""} снята с ${picked.service}`)} disabled={busy}
                    aria-label={`Удалить ${it.task || "бронь"}`} title={it.dateTo ? "Снять эту фичу с установки — со всего диапазона" : "Снять эту фичу с установки"}
                    className="p-1 text-text-muted hover:text-red-600 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => { setPickedKey(null); setCell({ date: picked.date, team: picked.team, minute: null }); setCellEnd(null); }}
            className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="w-3.5 h-3.5" /> фичу или микросервис на этот день</button>
        </div>
      )}
    </div>
  );
}

/** Строка черновика брони: фича (номер и название) и её микросервисы. */
interface DraftRow { id: string; task: string; name: string; ms: string[] }
const newRow = (r: Partial<DraftRow> = {}): DraftRow => ({ id: Math.random().toString(36).slice(2), task: "", name: "", ms: [], ...r });

/** Рабочие дни диапазона (как на бэкенде: выходные пропускаются). */
function workDays(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to || to < from) return out;
  for (let d = new Date(`${from}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
    const iso = isoOf(d);
    if (iso > to || out.length > 70) break;
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(iso);
  }
  return out;
}
const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Черновик брони: команда, дни «с — по» (или второй щелчок по графику в той же строке), время установки «с — до»
 * (необязательно; начало — в первый день, конец — в последний: стоит непрерывно; без него — весь день), фичи с их
 * микросервисами. Фичи — руками или
 * «Из списка Jira tool» (номер и название подставляются). «Микросервисы для всех фич» добавляются к каждой.
 * В Confluence ничего не уходит, пока не нажата «Опубликовать»: бронь на пару фича × микросервис, одна на весь период.
 */
function BookingForm({ date, minute, end, team: team0, teams, freezes, window: win, catalog, info, onCreate, featureStage, busy, onPublish, onCancel }: {
  date: string; minute: number | null; end: { date: string; n: number } | null; team: string; teams: string[];
  freezes: StandView["freezes"]; window: StandView["window"]; catalog: string[]; info: Record<string, string>;
  onCreate: (names: string[]) => Promise<void>; featureStage: FeatureStage; busy: boolean;
  onPublish: (items: NewBooking[]) => void; onCancel: () => void;
}) {
  const [fromList, setFromList] = useState(false);
  const [team, setTeam] = useState(team0);
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  // Щелчок по часу в часовом масштабе — время с этого часа на час.
  const [tFrom, setTFrom] = useState(minute != null ? hm(minute) : "");
  const [tTo, setTTo] = useState(minute != null ? hm(Math.min(minute + 60, 23 * 60 + 59)) : "");
  const [rows, setRows] = useState<DraftRow[]>([newRow()]);
  const [common, setCommon] = useState<string[]>([]);
  const [hotfix, setHotfix] = useState(false);
  const setRow = (id: string, patch: Partial<DraftRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const norm = keKey;

  // Второй щелчок по графику в строке этой команды: позже начала — конец периода, раньше — новое начало.
  useEffect(() => {
    if (!end) return;
    if (end.date > from) setTo(end.date);
    else { setFrom(end.date); if (to < end.date) setTo(end.date); }
  }, [end?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

  const days = workDays(from, to);
  const frozen = days.filter(d => freezes.some(f => f.from <= d && d <= f.to));
  const rangeTo = to > from ? to : "";
  // Время: начало — в первый день, конец — в последний (можно одно из двух). В один день конец позже начала.
  const timeErr = !rangeTo && tFrom && tTo && tFrom >= tTo ? "конец раньше начала" : "";
  // Фичи не заполнены, а микросервисы для всех указаны — бронь микросервиса без фичи (одна пустая строка).
  const touched = rows.filter(r => r.task.trim() || r.name.trim() || r.ms.length);
  const filled = touched.length ? touched : common.length ? rows.slice(0, 1) : [];
  const msOf = (r: DraftRow) => [...r.ms, ...common].filter((k, i, a) => a.findIndex(x => norm(x) === norm(k)) === i);
  const noMs = filled.filter(r => !msOf(r).length);
  const items: NewBooking[] = filled.flatMap(r => msOf(r).map(service => ({
    date: from, dateTo: rangeTo, ...(tFrom ? { timeFrom: tFrom } : {}), ...(tTo ? { timeTo: tTo } : {}),
    team, service, features: r.name.trim(), task: r.task.trim().toUpperCase(), hotfix,
  })));
  const pick = (picked: PickedFeature[]) => setRows(rs => {
    const have = new Set(rs.map(r => r.task.trim().toUpperCase()).filter(Boolean));
    const base = rs.filter(r => r.task.trim() || r.name.trim() || r.ms.length);   // пустую строку-заготовку убираем
    return [...base, ...picked.filter(p => !have.has(p.task)).map(p => newRow(p))];
  });
  const dd = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

  return (
    <form className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-3 text-sm"
      onSubmit={e => { e.preventDefault(); if (items.length && !noMs.length && !timeErr) onPublish(items); }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-text-main">Новая бронь</span>
        <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Команда" className={INPUT}>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">с
          <input type="date" value={from} min={win.from} max={win.to} aria-label="С даты"
            onChange={e => { const x = e.target.value; setFrom(x); if (x && to < x) setTo(x); }} className={INPUT} /></label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">по
          <input type="date" value={to} min={from} max={win.to} aria-label="По дату" onChange={e => { if (e.target.value) setTo(e.target.value); }} className={INPUT} /></label>
        <span className="text-xs text-text-muted" title="Конец периода можно задать и щелчком по другому дню в этой же строке графика">
          рабочих дней: {days.length}{days.length > 1 ? ` (${dd(days[0])}–${dd(days[days.length - 1])})` : " · щёлкните другой день в строке — будет период"}</span>
        {frozen.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
            <input type="checkbox" checked={hotfix} onChange={e => setHotfix(e.target.checked)} /> хотфикс — в заморозку ({frozen.map(dd).join(", ")})</label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted w-32">Время установки</span>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">с
          <input type="time" step={900} value={tFrom} onChange={e => setTFrom(e.target.value)} aria-label="Время с" className={INPUT} /></label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">до
          <input type="time" step={900} value={tTo} onChange={e => setTTo(e.target.value)} aria-label="Время до" className={INPUT} /></label>
        {(tFrom || tTo) && <button type="button" onClick={() => { setTFrom(""); setTTo(""); }} className="text-xs text-primary hover:underline">весь день</button>}
        <span className={`text-xs ${timeErr ? "text-red-600 dark:text-red-400" : "text-text-muted"}`}>
          {timeErr || (!tFrom && !tTo ? (rangeTo ? "не указано — весь период, сплошной полосой" : "не указано — весь день")
            : rangeTo ? `стоит непрерывно: ${bookingWhen({ date: from, dateTo: rangeTo, timeFrom: tFrom, timeTo: tTo })}`
            : !tFrom ? "с начала дня" : !tTo ? "до конца дня" : "")}</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-start gap-2">
          <span className="text-xs text-text-muted pt-2 w-32">Микросервисы для всех фич</span>
          <ServicePicker value={common} onChange={setCommon} catalog={catalog} info={info} onCreate={onCreate} placeholder="добавятся к каждой фиче"
            className="flex-1 min-w-[16rem]" />
        </div>
        {rows.map((r, n) => {
          const st = r.task.trim() ? featureStage(r.task.trim().toUpperCase()) : null;
          return (
            <div key={r.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-border-main bg-bg-card p-2">
              <input value={r.task} onChange={e => setRow(r.id, { task: e.target.value })} placeholder="SBER911-…" aria-label={`Номер фичи ${n + 1}`}
                className={`${INPUT} w-32 font-mono`} />
              <input value={r.name} onChange={e => setRow(r.id, { name: e.target.value })} placeholder="Название фичи" aria-label={`Название фичи ${n + 1}`}
                className={`${INPUT} flex-1 min-w-[12rem]`} />
              <ServicePicker value={r.ms} onChange={ms => setRow(r.id, { ms })} catalog={catalog} info={info} onCreate={onCreate} autoFocus={n === 0 && rows.length === 1}
                placeholder={common.length ? "свои микросервисы (по желанию)" : "микросервисы фичи"} className="flex-[2] min-w-[16rem]" />
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
            title="Номер и название задач из списка Jira tool подставятся в форму"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle">
            <ListPlus className="w-3.5 h-3.5" /> Из списка Jira tool</button>
        </div>
        {fromList && <ImportFromList already={new Set(rows.map(r => r.task.trim().toUpperCase()).filter(Boolean))} onPick={rs => { pick(rs); setFromList(false); }} />}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-main pt-2">
        <button type="submit" disabled={busy || !items.length || !!noMs.length || !days.length || !!timeErr}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          Опубликовать{items.length ? `: броней ${items.length}` : ""}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted">Отмена</button>
        <span className="text-xs text-text-muted">
          {touched.length ? `фич ${touched.length} × их микросервисы` : filled.length ? "без фичи — только микросервисы" : "добавьте фичу или микросервис"}
          {days.length > 1 ? `, каждая — на ${days.length} рабочих дня(ей)` : ""}{tFrom && tTo && !timeErr ? `, ${tFrom}–${tTo}` : ""}
        </span>
        {noMs.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">без микросервиса: {noMs.map(r => r.task || r.name || "строка").join(", ")}</span>}
      </div>
    </form>
  );
}

function PendingRow({ p, teams, busy, onDecide }: {
  p: StandPending; teams: string[]; busy: boolean;
  onDecide: (d: { accept: boolean; date?: string; dateTo?: string; timeFrom?: string; timeTo?: string; team?: string; service?: string;
                  features?: string; note?: string }) => void;
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
      {(p.dateTo || p.timeFrom) && (
        <p className="text-xs text-text-muted">Из заявки: {p.dateTo ? `период до ${ddmm(p.dateTo)}` : ""}{p.dateTo && p.timeFrom ? ", " : ""}
          {p.timeFrom || p.timeTo ? `время ${bookingWhen(p)}` : ""} — при принятии сохранятся</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Дата" className={INPUT} />
        <select value={team} onChange={e => setTeam(e.target.value)} aria-label="Команда" className={INPUT}>
          <option value="">команда…</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={service} onChange={e => setService(e.target.value)} placeholder="микросервис: a, b" aria-label="Микросервис" list="stand-ms-catalog" className={`${INPUT} w-44`} />
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

function SettingsForm({ v, busy, onSave }: { v: StandView; busy: boolean; onSave: (s: StandSettings, ms: string[] | null) => void }) {
  const [from, setFrom] = useState(v.window.from);
  const [to, setTo] = useState(v.window.to);
  const [rels, setRels] = useState(v.releases.map(r => ({ name: r.name, date: r.date })));
  const [teams, setTeams] = useState(v.teams.join(", "));
  const [limit, setLimit] = useState(v.limit ? String(v.limit) : "");
  const [ms, setMs] = useState(v.msCatalog.join("\n"));
  const msList = Array.from(new Set(ms.split(/[\n,;]/).map(x => x.trim()).filter(Boolean)));
  return (
    <form className="rounded-xl border border-border-main bg-bg-card p-3 space-y-3 text-xs text-text-muted"
      onSubmit={e => {
        e.preventDefault();
        onSave({ windowFrom: from, windowTo: to, releases: rels.filter(r => r.name.trim() && r.date),
                 teams: teams.split(",").map(t => t.trim()).filter(Boolean), limit: Number(limit) || 0 },
               msList.join("\n") === v.msCatalog.join("\n") ? null : msList);   // справочник — только если правили
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
        <span>Справочник микросервисов — выпадающий список в форме брони, один на оба стенда; по одному на строку (или через запятую). Сейчас: {msList.length}</span>
        <textarea value={ms} onChange={e => setMs(e.target.value)} rows={5} placeholder={"rms-front\nincident-gateway\nnotify-service"} className={`${INPUT} w-full font-mono`} />
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
