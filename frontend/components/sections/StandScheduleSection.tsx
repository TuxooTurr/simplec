"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCopy, ExternalLink, Link2, Loader2, MinusCircle, PenLine, RotateCcw, Settings2, Stethoscope, XCircle } from "lucide-react";
import {
  getConfluenceSettings, probeConfluenceRead, probeConfluenceWrite, testConfluence,
  type ConfProbeReport,
} from "@/lib/confluenceApi";
import { getStandsConfig, saveStandsConfig, type StandsConfig } from "@/lib/standsApi";
import StandTab from "@/components/stands/StandTab";
import ConfluenceSettingsModal from "@/components/settings/ConfluenceSettingsModal";
import Modal from "@/components/ui/Modal";

const STANDS = ["Major-Check", "Major-GO"];

const INPUT = "w-full text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

/**
 * График стендов — кто, когда и какие микросервисы ставит на Major-Check и Major-GO в выбранном окне релиза.
 * У каждого стенда своя страница Confluence: данные — в свойстве страницы (с версией — одновременные правки
 * не затирают друг друга), текст страницы собирает SimpleTest; заявки коллеги оставляют комментариями к странице.
 * Подключение к Confluence — как к Jira в Jira tool: плашка «не подключён», окно настроек, точка статуса;
 * проверка API — окном по кнопке, как в Zephyr Tool.
 */
type Conn = { state: "loading" } | { state: "ok"; user: string; baseUrl: string } | { state: "error"; message: string };

export default function StandScheduleSection() {
  const [tab, setTab] = useState<string>(STANDS[0]);
  const [cfg, setCfg] = useState<StandsConfig | null>(null);
  const pages = cfg?.pages ?? null;
  const [conn, setConn] = useState<Conn>({ state: "loading" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);

  const connect = () => {
    setConn({ state: "loading" });
    Promise.all([testConfluence(), getConfluenceSettings(), getStandsConfig()])
      .then(([me, st, c]) => { setConn({ state: "ok", user: me.user || me.name, baseUrl: st.base_url }); setCfg(c); })
      .catch(e => setConn({ state: "error", message: (e as Error).message }));
  };
  useEffect(connect, []);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="px-6 py-6 space-y-5">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="flex items-center gap-2 text-lg font-bold text-text-main"><CalendarDays className="w-5 h-5 text-primary" /> График стендов</h1>
            <p className="text-sm text-text-muted">
              Кто, когда и какие микросервисы ставит на стенд: дни, период и время установки. Один микросервис у двух команд
              в пересекающееся время — конфликт.
              Оригинал — страница стенда в Confluence; заявки коллеги оставляют там комментарием.
            </p>
          </div>
          <span className="flex items-center gap-2">
            <span title={conn.state === "ok" ? `Confluence подключён: ${conn.baseUrl} (${conn.user})` : conn.state === "error" ? `Confluence не подключён: ${conn.message}` : "Подключение к Confluence…"}
              className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className={`block w-2.5 h-2.5 rounded-full ${conn.state === "ok" ? "bg-emerald-500" : conn.state === "error" ? "bg-red-500" : "bg-amber-400 animate-pulse"}`} />
              {conn.state === "ok" ? conn.baseUrl.replace(/^https?:\/\//, "") : conn.state === "error" ? "не подключён" : "подключение…"}
            </span>
            <button type="button" onClick={() => setProbeOpen(true)} title="Проверка API Confluence: чтение и запись на тестовой странице"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
              <Stethoscope className="w-4 h-4" /> Проверить API</button>
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Настройки Confluence" title="Настройки Confluence"
              className="p-2 rounded-lg border border-border-main text-text-muted hover:text-text-main"><Settings2 className="w-4 h-4" /></button>
          </span>
        </header>

        {conn.state === "error" && (
          <div role="alert" className="flex items-center gap-3 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="min-w-0 flex-1 text-text-main"><b>Confluence не подключён.</b> {conn.message}</span>
            <button type="button" onClick={() => setSettingsOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold whitespace-nowrap">Настроить Confluence</button>
            <button type="button" onClick={connect}
              className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-main whitespace-nowrap">Повторить</button>
          </div>
        )}
        {conn.state === "loading" && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Подключение к Confluence…</p>}

        {conn.state === "ok" && pages && (
          <>
            <div role="tablist" aria-label="Стенды" className="flex gap-1 border-b border-border-main">
              {STANDS.map(t => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`px-4 py-2 -mb-px border-b-2 text-sm ${tab === t ? "border-primary text-primary font-semibold" : "border-transparent text-text-muted hover:text-text-main"}`}>
                  {t}</button>
              ))}
            </div>
            {cfg && <PageLink stand={tab} cfg={cfg} onSaved={setCfg} />}
            <StandTab key={`${tab}:${pages[tab] ?? ""}`} stand={tab} pageId={pages[tab] ?? ""} onPageBound={connect} defaultUrl={cfg?.defaults?.[tab] ?? ""} />
          </>
        )}
      </div>

      <ConfluenceSettingsModal open={settingsOpen} title="График стендов — подключение к Confluence" onClose={() => { setSettingsOpen(false); connect(); }} />
      {probeOpen && (
        <Modal open onClose={() => setProbeOpen(false)} title="Проверка API Confluence" size="max-w-3xl">
          <ProbeCard />
        </Modal>
      )}
    </div>
  );
}

function ProbeCard() {
  const [space, setSpace] = useState("");
  const [page, setPage] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState<"read" | "write" | null>(null);
  const [askWrite, setAskWrite] = useState(false);
  const [reports, setReports] = useState<{ read?: ConfProbeReport; write?: ConfProbeReport }>({});
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { getConfluenceSettings().then(s => setSpace(v => v || s.space), () => {}); }, []);

  const run = async (kind: "read" | "write") => {
    setBusy(kind); setErr(""); setCopied(false); setAskWrite(false);
    try {
      const rep = kind === "read" ? await probeConfluenceRead(space.trim(), page.trim()) : await probeConfluenceWrite(space.trim(), parent.trim());
      setReports(r => ({ ...r, [kind]: rep }));
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(reports, null, 2)); setCopied(true); }
    catch { setErr("Не удалось скопировать — браузер не дал доступ к буферу"); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        <b className="text-text-main">Чтение</b> ничего не меняет: вход, пространство, страница и её свойства.{" "}
        <b className="text-text-main">Запись</b> создаёт в пространстве новую тестовую страницу и проверяет на ней всё, на чём
        будет держаться график. Существующие страницы не трогаются, тестовую потом можно удалить.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1 text-xs text-text-muted">Пространство
          <input value={space} onChange={e => setSpace(e.target.value)} placeholder="QA911 или ~логин" className={`${INPUT} font-mono`} />
        </label>
        <label className="space-y-1 text-xs text-text-muted">Страница для чтения (необязательно)
          <input value={page} onChange={e => setPage(e.target.value)} placeholder="Ссылка, id или название" className={INPUT} />
        </label>
        <label className="space-y-1 text-xs text-text-muted">Родитель тестовой (необязательно)
          <input value={parent} onChange={e => setParent(e.target.value)} placeholder="Ссылка или id страницы" className={INPUT} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => run("read")} disabled={!!busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          {busy === "read" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />} Проверить чтение</button>
        {!askWrite ? (
          <button type="button" onClick={() => setAskWrite(true)} disabled={!!busy || !space.trim()}
            title={space.trim() ? undefined : "Укажите пространство"}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-50">
            {busy === "write" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />} Проверить запись…</button>
        ) : (
          <span className="flex items-center gap-2 text-sm text-text-main">
            Создать тестовую страницу в «{space.trim()}»?
            <button type="button" onClick={() => run("write")} className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold">Создать</button>
            <button type="button" onClick={() => setAskWrite(false)} className="px-3 py-1.5 rounded-lg border border-border-main text-sm text-text-muted">Отмена</button>
          </span>
        )}
        {(reports.read || reports.write) && (
          <button type="button" onClick={copy}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle">
            <ClipboardCopy className="w-4 h-4" /> {copied ? "Скопировано" : "Скопировать отчёт"}</button>
        )}
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {reports.read && <ReportList title="Чтение" rep={reports.read} />}
      {reports.write && <ReportList title="Запись" rep={reports.write} />}
    </div>
  );
}

function ReportList({ title, rep }: { title: string; rep: ConfProbeReport }) {
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-2 text-sm text-text-main">
        <b>{title}:</b> сработало {rep.ok} из {rep.total} · {rep.checkedAt}
        {rep.page && (
          <a href={rep.page} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> тестовая страница</a>
        )}
      </p>
      <ul className="border border-border-main rounded-xl divide-y divide-border-main">
        {rep.results.map(r => (
          <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm">
            {r.skipped ? <MinusCircle className="w-4 h-4 mt-0.5 text-text-muted flex-shrink-0" />
              : r.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
              : <XCircle className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block text-text-main">{r.label}</span>
              <span className="block text-[11px] text-text-muted font-mono truncate">{r.skipped ? r.reason : `${r.method} ${r.path}`}</span>
              {r.error && <span className="block text-[11px] text-red-600 dark:text-red-400">{r.error}</span>}
              {r.note && <span className="block text-[11px] text-text-main">{r.note}</span>}
            </span>
            {!r.skipped && <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">{r.status} · {r.ms} мс</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}


/**
 * Страница стенда в Confluence — ссылкой, с правкой, как ссылки источников в «Трекинге AQA»: «Изменить» — вставить
 * другую ссылку (или id), пусто — отвязать; «По умолчанию» — вернуть постоянную страницу стенда (если она задана).
 */
function PageLink({ stand, cfg, onSaved }: { stand: string; cfg: StandsConfig; onSaved: (c: StandsConfig) => void }) {
  const url = cfg.urls[stand] ?? "";
  const def = cfg.defaults?.[stand] ?? "";
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setEdit(null); setErr(""); }, [stand]);
  const save = async (link: string) => {
    setBusy(true); setErr("");
    try { onSaved(await saveStandsConfig({ [stand]: link })); setEdit(null); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  if (!url && edit === null) return null;          // не привязана — форма привязки ниже, в самой вкладке
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Link2 className="w-3.5 h-3.5 text-text-muted" />
      <span className="text-text-muted">Страница стенда:</span>
      {edit === null ? (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" className="max-w-[520px] truncate text-primary hover:underline">{url}</a>
          {def && url !== def && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">не по умолчанию</span>}
          <button type="button" onClick={() => setEdit(url)} className="text-text-muted hover:text-primary underline">Изменить</button>
        </>
      ) : (
        <>
          <input autoFocus value={edit} onChange={e => setEdit(e.target.value)} placeholder="Ссылка на страницу: …pageId=123456 (пусто — отвязать)"
            onKeyDown={e => { if (e.key === "Enter") void save(edit); if (e.key === "Escape") setEdit(null); }}
            aria-label={`Ссылка на страницу стенда ${stand}`} className={`${INPUT} w-[460px]`} />
          <button type="button" disabled={busy} onClick={() => void save(edit)}
            className="px-2.5 py-1 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Сохранить"}</button>
          {def && (
            <button type="button" disabled={busy} onClick={() => setEdit(def)} title={def}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-main text-text-main hover:bg-bg-subtle disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> По умолчанию</button>
          )}
          <button type="button" onClick={() => setEdit(null)} className="text-text-muted hover:text-text-main">Отмена</button>
        </>
      )}
      {err && <span className="text-red-600 dark:text-red-400">{err}</span>}
    </div>
  );
}
