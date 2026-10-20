"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ClipboardCopy, ExternalLink, Loader2, MinusCircle, PenLine, Stethoscope, XCircle } from "lucide-react";
import {
  getConfluenceSettings, probeConfluenceRead, probeConfluenceWrite, saveConfluenceSettings, testConfluence,
  type ConfProbeReport, type ConfluenceSettings,
} from "@/lib/confluenceApi";

const INPUT = "w-full text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";
const MASK = "●●●●●●●●●●●●";

/**
 * График стендов — когда какая команда ставит какие КЭ (микросервисы) на Major-Check и Major-GO, на 2 спринта вперёд.
 * Оригинал графика — страница Confluence (данные в свойстве страницы, таблица на странице собирается из них).
 *
 * Этап 1 (сейчас): подключение к Confluence и проверка API — умеет ли Confluence банка то, на чём держится хранение:
 * свойства страницы с версией (защита от затирания), обновление тела, вложения. Отчёт присылают разработчику.
 * Сам график — следующим этапом, по результатам проверки.
 */
export default function StandScheduleSection() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-bold text-text-main"><CalendarDays className="w-5 h-5 text-primary" /> График стендов</h1>
          <p className="text-sm text-text-muted">
            Когда какая команда ставит какие КЭ на Major-Check и Major-GO — на 2 спринта вперёд. Ответ на вопрос
            «можно ставить сейчас?»: заморозка стенда и лимит установок в день. Оригинал графика — страница Confluence,
            чтобы его видели все 4 команды.
          </p>
        </header>

        <section className="rounded-xl border border-dashed border-border-main bg-bg-subtle/50 px-4 py-3 text-sm text-text-muted">
          <b className="text-text-main">Сейчас — этап 1: проверка Confluence.</b> Сам график появится здесь, когда станет ясно,
          что Confluence банка умеет хранить его без затирания чужих правок. Подключите Confluence, запустите обе проверки
          и пришлите отчёт.
        </section>

        <ConnectionCard />
        <ProbeCard />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-text-main">{title}</h2>
      {children}
    </section>
  );
}

function ConnectionCard() {
  const [s, setS] = useState<ConfluenceSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { getConfluenceSettings().then(setS, e => setMsg({ ok: false, text: (e as Error).message })); }, []);
  if (!s) return <Card title="Подключение к Confluence"><p className="text-sm text-text-muted">{msg?.text ?? "Загрузка…"}</p></Card>;
  const patch = (p: Partial<ConfluenceSettings>) => { setS({ ...s, ...p }); setMsg(null); };

  const save = async (andTest: boolean) => {
    setBusy(true); setMsg(null);
    try {
      setS(await saveConfluenceSettings(s));
      if (andTest) {
        const me = await testConfluence();
        setMsg({ ok: true, text: `Вход выполнен: ${me.user || me.name}` });
      } else setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <Card title="Подключение к Confluence">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-text-muted">Адрес
          <input value={s.base_url} onChange={e => patch({ base_url: e.target.value })} placeholder="https://confluence.sberbank.ru" className={`${INPUT} font-mono`} />
        </label>
        <label className="space-y-1 text-xs text-text-muted">Пространство для графика
          <input value={s.space} onChange={e => patch({ space: e.target.value })} placeholder="Ключ: QA911 или ~логин (личное)" className={`${INPUT} font-mono`} />
        </label>
      </div>
      <label className="block space-y-1 text-xs text-text-muted">Маркер доступа
        <input type="password" value={s.token} onChange={e => patch({ token: e.target.value })} autoComplete="new-password"
          placeholder="Профиль Confluence → Настройки → Маркеры доступа → Создать" className={`${INPUT} font-mono`} />
        <span className="block text-[11px]">{s.token === MASK ? "Маркер сохранён. Вставьте новый, чтобы заменить." : "Маркер Confluence свой — токен Jira сюда не подойдёт."}</span>
      </label>
      <label className="block space-y-1 text-xs text-text-muted">Или путь к файлу с маркером
        <input value={s.token_path} onChange={e => patch({ token_path: e.target.value })} placeholder="/Users/you/.secrets/confluence_token.txt" className={`${INPUT} font-mono`} />
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
        <input type="checkbox" checked={!s.ssl_verify} onChange={e => patch({ ssl_verify: !e.target.checked })} />
        Не проверять SSL-сертификат (корпоративный прокси)
      </label>
      {msg && (
        <p className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />} {msg.text}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => save(false)} disabled={busy}
          className="px-3.5 py-2 border border-border-main rounded-lg text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-40">Сохранить</button>
        <button type="button" onClick={() => save(true)} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-xs font-semibold disabled:opacity-40">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Сохранить и проверить вход</button>
      </div>
    </Card>
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
    <Card title="Проверка API Confluence">
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
    </Card>
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
