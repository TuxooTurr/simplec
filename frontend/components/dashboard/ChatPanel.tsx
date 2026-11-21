"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { CalendarDays, ChevronRight, CircleHelp, Mail, Maximize2, MessageSquare, Minimize2, Plug, RefreshCw, Search, Settings2, Sparkles, Users } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import EtherSettingsModal from "@/components/settings/EtherSettingsModal";
import { etherFeed, type EtherChannel, type EtherFeed, type EtherMessage } from "@/lib/etherApi";
const CHANNELS: { id: EtherChannel; label: string; Icon: typeof Mail }[] = [
  { id: "chat", label: "Чат", Icon: MessageSquare }, { id: "mail", label: "Почта", Icon: Mail }, { id: "meetings", label: "Встречи", Icon: CalendarDays },
];
type Tracking = { users: string; keywords: string };
type Profiles = Record<EtherChannel, Tracking>;
const EMPTY: Profiles = { chat: { users: "", keywords: "" }, mail: { users: "", keywords: "" }, meetings: { users: "", keywords: "" } };
const split = (text: string) => [...new Set(text.split(/[\n,;]/).map(s => s.trim()).filter(Boolean))].slice(0, 100);
const STORAGE = "st_ether_tracking_v2";
function highlight(text: string, words: string[]): ReactNode {
  if (!words.length) return text;
  const lower = text.toLocaleLowerCase("ru");
  const nodes: ReactNode[] = [];
  let position = 0;
  while (position < text.length && nodes.length < 500) {
    let first = -1, length = 0;
    for (const word of words) {
      const at = lower.indexOf(word.toLocaleLowerCase("ru"), position);
      if (at >= 0 && (first < 0 || at < first || at === first && word.length > length)) { first = at; length = word.length; }
    }
    if (first < 0) break;
    if (first > position) nodes.push(text.slice(position, first));
    nodes.push(<mark key={first}>{text.slice(first, first + length)}</mark>);
    position = first + length;
  }
  if (position < text.length) nodes.push(text.slice(position));
  return nodes;
}
export default function ChatPanel({ demo = false, expanded = false, onExpand }: { demo?: boolean; expanded?: boolean; onExpand?: () => void }) {
  const panelId = useId();
  const [channel, setChannel] = useState<EtherChannel>("chat");
  const [profiles, setProfiles] = useState<Profiles>(EMPTY);
  const [initialized, setInitialized] = useState(false);
  const [feeds, setFeeds] = useState<Partial<Record<EtherChannel, EtherFeed>>>({});
  const [errors, setErrors] = useState<Partial<Record<EtherChannel, string>>>({});
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<EtherMessage | null>(null);
  const profile = profiles[channel];
  const words = split(profile.keywords);
  const people = split(profile.users);
  const ready = !!(words.length || people.length);
  const feed = feeds[channel];
  const current = CHANNELS.find(c => c.id === channel)!;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      const next = structuredClone(EMPTY);
      if (saved) {
        const parsed = JSON.parse(saved);
        for (const { id } of CHANNELS) {
          if (typeof parsed[id]?.users === "string") next[id].users = parsed[id].users;
          if (typeof parsed[id]?.keywords === "string") next[id].keywords = parsed[id].keywords;
        }
      } else {
        next.chat.users = localStorage.getItem("st_ether_feed_users") ?? "";
        if (demo) for (const { id } of CHANNELS) next[id].keywords = id === "meetings" ? "релиз, ошибка, ПСИ" : "релиз, ошибка, ИФТ";
      }
      setProfiles(next);
    } catch { setProfiles(structuredClone(EMPTY)); }
    setInitialized(true);
  }, [demo]);
  useEffect(() => {
    if (!initialized || !ready) { setLoading(false); return; }
    let live = true, running = false;
    const abort = new AbortController();
    async function read() {
      if (running) return;
      running = true; setLoading(true);
      try {
        const value = await etherFeed(split(profile.users), split(profile.keywords), channel, abort.signal);
        if (live) { setFeeds(s => ({ ...s, [channel]: value })); setErrors(s => ({ ...s, [channel]: "" })); }
      } catch (e) {
        if (live && !abort.signal.aborted) setErrors(s => ({ ...s, [channel]: (e as Error).message }));
      } finally { running = false; if (live) setLoading(false); }
    }
    void read();
    const timer = setInterval(read, 30000);
    return () => { live = false; abort.abort(); clearInterval(timer); };
  }, [initialized, ready, channel, profile, revision]);
  const messages = (feed?.messages ?? []).filter(message => [message.title, message.author, message.dialog, message.text].join(" ").toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")));
  const error = errors[channel];
  const displayTime = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";
  };
  return <aside className="flex flex-col flex-1 min-h-0 min-w-0" aria-label="Эфир · коммуникации">
    <header className="px-4 pt-4 pb-3 shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Sparkles className="w-4 h-4" /></span>
        <div className="flex-1 min-w-0"><h2 className="font-semibold text-sm">Эфир</h2><p className="text-[10px] text-text-muted">{demo ? "Демонстрационные данные" : feed?.configured ? "Подключён · только чтение" : "Коммуникации команды"}</p></div>
        <Button variant="icon" title="Подключение Эфира" onClick={() => setConnection(true)} icon={<Plug className="w-4 h-4" />} />
        {onExpand && <Button variant="icon" title={expanded ? "Вернуть панели" : "Развернуть Эфир"} onClick={onExpand} icon={expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} />}
      </div>
      <div className="dashboard-ether-tabs" role="tablist" aria-label="Каналы Эфира">
        {CHANNELS.map(({ id, label, Icon }) => <button type="button" key={id} role="tab" aria-selected={channel === id} aria-controls={`${panelId}-ether-${id}`} id={`${panelId}-ether-tab-${id}`}
          className="dashboard-ether-tab focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { setChannel(id); setQuery(""); }}
          onKeyDown={e => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const index = e.key === "Home" ? 0 : e.key === "End" ? 2 : (CHANNELS.findIndex(c => c.id === channel) + (e.key === "ArrowRight" ? 1 : 2)) % 3;
            setChannel(CHANNELS[index].id); document.getElementById(`${panelId}-ether-tab-${CHANNELS[index].id}`)?.focus(); setQuery("");
          }} tabIndex={channel === id ? 0 : -1}><Icon className="w-3.5 h-3.5 shrink-0" />{label}</button>)}
      </div>
    </header>
    <div className="px-4 pb-3 border-b border-border-main shrink-0">
      <div className="flex items-center gap-2 justify-between">
        <button type="button" onClick={() => setTracking({ ...profile })} className="min-w-0 flex items-center gap-1.5 text-xs text-text-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-primary rounded py-1">
          <Users className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{people.length ? `Коллеги: ${people.length}` : "Все авторы"}{words.length ? ` · слов: ${words.length}` : ""}</span><Settings2 className="w-3 h-3 shrink-0" />
        </button>
        <Button variant="icon" title={`Настроить отслеживание: ${current.label}`} onClick={() => setTracking({ ...profile })} icon={<Settings2 className="w-3.5 h-3.5" />} />
      </div>
      {words.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{words.slice(0, 5).map(word => <span key={word} className="text-[10px] rounded-md bg-primary/5 border border-primary/15 text-primary px-1.5 py-0.5 max-w-full truncate">{word}</span>)}{words.length > 5 && <span className="text-[10px] text-text-muted">+{words.length - 5}</span>}</div>}
      {ready && <label className="mt-3 flex items-center gap-2 bg-bg-subtle rounded-lg px-2.5 py-2"><Search className="w-3.5 h-3.5 text-text-muted shrink-0" /><input aria-label={`Поиск: ${current.label}`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск в найденном" className="w-full min-w-0 bg-transparent text-xs outline-none" /></label>}
    </div>
    <div id={`${panelId}-ether-${channel}`} role="tabpanel" aria-labelledby={`${panelId}-ether-tab-${channel}`} className="flex-1 min-h-0 overflow-auto p-3 space-y-2.5" aria-busy={loading}>
      {error && <p role="alert" className="text-xs tone-danger rounded-lg bg-bg-subtle p-3">{error}{feed?.messages.length ? " Последние данные сохранены." : ""}</p>}
      {!ready ? <div className="px-3 py-10 text-center">
        <current.Icon className="w-7 h-7 text-text-muted mx-auto mb-3" /><h3 className="text-sm font-medium">Только важное для вас</h3>
        <p className="text-xs text-text-muted mt-2 mb-4">Выберите коллег или слова, которые нужно отслеживать в разделе «{current.label}».</p>
        <Button variant="ghost" onClick={() => setTracking({ ...profile })}>Настроить</Button>
      </div> : feed?.configured === false ? <div className="p-4 text-center"><p className="text-sm mb-3">Подключите Эфир для чтения {channel === "mail" ? "почты" : channel === "meetings" ? "встреч" : "чатов"}.</p><Button variant="ghost" onClick={() => setConnection(true)} icon={<Plug className="w-4 h-4" />}>Подключение</Button></div>
        : feed?.available === false ? <div className="p-4"><CircleHelp className="w-6 h-6 text-text-muted mb-3" /><p className="text-sm">{feed.reason ?? "Этот раздел недоступен в текущем подключении Эфира."}</p><p className="text-xs text-text-muted mt-2">Проверьте доступность раздела и права учётной записи в Эфире.</p></div>
        : !messages.length ? <div role="status" className="text-center p-7 text-xs text-text-muted">{loading && !feed ? "Получаю данные из Эфира…" : query ? "По этому запросу ничего не найдено." : "Совпадений пока нет. Новые записи появятся автоматически."}</div>
        : messages.map(message => {
          const matched = words.some(word => [message.title, message.text, message.dialog].join(" ").toLocaleLowerCase("ru").includes(word.toLocaleLowerCase("ru")));
          const author = message.author.toLocaleLowerCase("ru").trim();
          const matchedPerson = people.some(person => {
            const tracked = person.toLocaleLowerCase("ru").trim();
            return author === tracked || tracked.length >= 3 && author.length >= 3 && (author.includes(tracked) || tracked.includes(author));
          });
          return <article key={message.id} className="dashboard-feed-row" data-match={matched || matchedPerson}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-bg-subtle text-primary text-[10px] font-semibold flex items-center justify-center shrink-0">{message.author.split(" ").map(s => s[0]).slice(0, 2).join("") || "Э"}</span>
              <div className="flex-1 min-w-0"><p className="text-[11px] font-medium truncate" title={message.author}>{message.author || "Эфир"}</p>{message.dialog && <p className="text-[10px] text-text-muted truncate">{highlight(message.dialog, words)}</p>}</div>
              <time dateTime={message.date} className="text-[10px] text-text-muted whitespace-nowrap">{displayTime(message.date)}</time>
            </div>
            {channel === "meetings" && <p className="text-[11px] text-primary mb-2 flex items-center gap-1"><CalendarDays className="w-3 h-3" />{new Date(message.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · {displayTime(message.date)}{message.endDate ? "–" + displayTime(message.endDate) : ""}</p>}
            {message.title && <h3 className="text-xs font-semibold mb-1.5 break-words">{highlight(message.title, words)}</h3>}
            <p className="text-xs leading-relaxed text-text-main whitespace-pre-wrap break-words line-clamp-4">{highlight(message.text, words)}</p>
            <button type="button" className="mt-2.5 text-[11px] text-text-muted hover:text-primary inline-flex gap-1 items-center rounded focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setDetail(message)}>
              {channel === "meetings" ? "Детали встречи" : "Подробнее"}<ChevronRight className="w-3 h-3" />
            </button>
          </article>;
        })}
    </div>
    <footer className="border-t border-border-main px-4 py-2 flex items-center justify-between gap-2 text-[10px] text-text-muted shrink-0">
      <span>{loading ? "Обновление…" : ready ? `Найдено: ${messages.length}` : "Настройте отслеживание"} · только чтение</span>
      <Button variant="icon" title="Обновить Эфир" disabled={!ready || loading} onClick={() => setRevision(v => v + 1)} icon={<RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />} />
    </footer>
    {tracking && <Modal open title={`Отслеживание · ${current.label}`} onClose={() => setTracking(null)}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setTracking(null)}>Отмена</Button><Button onClick={() => {
        const next = { ...profiles, [channel]: tracking };
        setProfiles(next); localStorage.setItem(STORAGE, JSON.stringify(next)); setTracking(null); setQuery("");
        setFeeds(s => ({ ...s, [channel]: undefined }));
      }}>Применить</Button></div>}>
      <p className="text-xs text-text-muted mb-4">Настройки личные и отдельные для каждой вкладки. Запись попадёт в ленту, если совпадёт коллега или хотя бы одно слово.</p>
      <label className="block text-sm mb-4">Кого отслеживать<textarea aria-label="Кого отслеживать" rows={3} maxLength={10000} value={tracking.users} onChange={e => setTracking({ ...tracking, users: e.target.value })}
        placeholder="ФИО, логин или почта · по одному на строку" className="w-full mt-1 border border-border-main rounded-lg p-2.5 bg-bg-card text-sm" /></label>
      <label className="block text-sm">Слова и фразы<textarea aria-label="Слова и фразы" rows={3} maxLength={10000} value={tracking.keywords} onChange={e => setTracking({ ...tracking, keywords: e.target.value })}
        placeholder="релиз, ошибка, ИФТ" className="w-full mt-1 border border-border-main rounded-lg p-2.5 bg-bg-card text-sm" /></label>
      <p className="mt-2 text-xs text-text-muted">Разделяйте запятой или новой строкой. Совпадения выделяются в тексте и подсвечивают карточку.</p>
    </Modal>}
    {detail && <Modal open title={detail.title || detail.dialog || "Сообщение Эфира"} onClose={() => setDetail(null)} size="max-w-2xl" footer={<Button variant="ghost" onClick={() => setDetail(null)}>Закрыть</Button>}>
      <p className="text-xs text-text-muted mb-4">{detail.author} · {new Date(detail.date).toLocaleString("ru-RU")}</p>
      {detail.location && <p className="text-xs text-primary mb-3">{detail.location}</p>}
      <div className="dashboard-feed-row text-sm whitespace-pre-wrap break-words">{highlight(detail.text, words)}</div>
    </Modal>}
    <EtherSettingsModal open={connection} onClose={() => { setConnection(false); setRevision(v => v + 1); }} onChanged={() => setRevision(v => v + 1)} />
  </aside>;
}
