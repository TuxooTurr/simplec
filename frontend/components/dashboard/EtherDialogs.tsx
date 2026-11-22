"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, MessageSquare, Send, User, Users, X } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import {
  etherMail, etherMailReply, etherSearch, etherSend, etherThread,
  type EtherMail, type EtherMessage, type EtherParticipant, type EtherSearchResult, type EtherThread,
} from "@/lib/etherApi";

const KIND_ICON = { person: User, chat: MessageSquare, group: Users } as const;
const KIND_LABEL = { person: "Коллега", chat: "Личный чат", group: "Группа" } as const;
const fmt = (value: string) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

/**
 * Кого отслеживать: начните вводить фамилию, чат или группу — Эфир предложит варианты. Добавить можно только найденное
 * (проверка, что такой участник есть). Если поиск людей в подключении не объявлен, свой вариант добавляется с пометкой.
 */
export function ParticipantPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<EtherSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setRes(null); setError(""); return; }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try { const r = await etherSearch(text); if (id === seq.current) { setRes(r); setError(""); } }
      catch (e) { if (id === seq.current) { setRes(null); setError((e as Error).message); } }
      finally { if (id === seq.current) setBusy(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  const add = (name: string) => {
    const n = name.trim();
    if (n && !value.some(v => v.toLocaleLowerCase("ru") === n.toLocaleLowerCase("ru"))) onChange([...value, n]);
    setQ(""); setRes(null);
  };
  const manual = !!res && !res.people && q.trim().length >= 2;
  return <div>
    {value.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">
      {value.map(v => <span key={v} className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs text-primary">
        {v}<button type="button" aria-label={`Убрать ${v}`} onClick={() => onChange(value.filter(x => x !== v))} className="hover:text-red-500"><X className="w-3 h-3" /></button>
      </span>)}
    </div>}
    <div className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} aria-label="Найти коллегу, чат или группу"
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (res?.items.length === 1) add(res.items[0].name);
          else if (manual) add(q);
        }}
        placeholder="Начните вводить: фамилия, чат или группа" className="w-full border border-border-main rounded-lg px-2.5 py-2 bg-bg-card text-sm" />
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted absolute right-2.5 top-2.5" />}
      {(res || error) && q.trim().length >= 2 && <div role="listbox" aria-label="Найдено в Эфире"
        className="absolute z-40 left-0 right-0 mt-1 rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-xl max-h-64 overflow-y-auto">
        {error && <p className="px-3 py-2 text-xs tone-danger">{error}</p>}
        {res?.items.map(it => {
          const Icon = KIND_ICON[it.kind] ?? User;
          return <button type="button" role="option" aria-selected={false} key={it.kind + it.name} onClick={() => add(it.name)}
            className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-bg-subtle">
            <Icon className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <span className="min-w-0"><span className="block text-sm truncate">{it.name}</span>
              <span className="block text-[11px] text-text-muted truncate">{KIND_LABEL[it.kind]}{it.subtitle ? ` · ${it.subtitle}` : ""}</span></span>
          </button>;
        })}
        {res && !res.items.length && !manual && <p className="px-3 py-2 text-xs text-text-muted">В Эфире не найдено. Уточните фамилию или название чата.</p>}
        {manual && <button type="button" onClick={() => add(q)} className="w-full text-left px-3 py-2 text-xs text-text-muted hover:bg-bg-subtle border-t border-border-main">
          Добавить «{q.trim()}» без проверки — {res?.reason || "поиск коллег в подключении Эфира недоступен"}</button>}
      </div>}
    </div>
  </div>;
}

/** Переписка чата: сообщения диалога и ответ (если подключение позволяет и вы — тот, кто подключил Эфир). */
export function ThreadModal({ message, onClose }: { message: EtherMessage; onClose: () => void }) {
  const [thread, setThread] = useState<EtherThread | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = async () => {
    try { setThread(await etherThread(message.peer)); setError(""); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [message.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [thread]);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true); setError("");
    try { await etherSend(message.peer, text.trim()); setText(""); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  };
  return <Modal open title={message.dialog || message.author || "Переписка"} onClose={onClose} size="max-w-2xl"
    footer={thread?.canSend ? <div className="flex items-end gap-2">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000} aria-label="Ответ"
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        placeholder="Ответ · Ctrl/⌘+Enter — отправить" className="flex-1 border border-border-main rounded-lg p-2.5 bg-bg-card text-sm resize-none" />
      <Button onClick={() => void send()} loading={sending} disabled={!text.trim()} icon={<Send className="w-3.5 h-3.5" />}>Отправить</Button>
    </div> : <p className="text-xs text-text-muted">{thread ? thread.reason || "Ответ недоступен." : "Загружаю переписку…"} Можно ответить в самом Эфире.</p>}>
    {error && <p role="alert" className="text-xs tone-danger mb-3">{error}</p>}
    {!thread && !error && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю переписку…</p>}
    <div className="space-y-2">
      {thread?.messages.map(m => <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.mine ? "bg-primary text-white" : "bg-bg-subtle text-text-main"}`}>
          {!m.mine && <p className="text-[11px] font-semibold mb-0.5 opacity-80">{m.author}</p>}
          {m.text}
          <p className={`text-[10px] mt-1 ${m.mine ? "text-white/70" : "text-text-muted"}`}>{fmt(m.date)}</p>
        </div>
      </div>)}
      {thread && !thread.messages.length && <p className="text-sm text-text-muted">Сообщений нет.</p>}
      <div ref={end} />
    </div>
  </Modal>;
}

/** Письмо целиком и ответ на него. Если чтение письма в подключении не объявлено — текст из ленты. */
export function MailModal({ message, onClose }: { message: EtherMessage; onClose: () => void }) {
  const [mail, setMail] = useState<EtherMail | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!message.sourceId) { setMail({ available: false }); return; }
    etherMail(message.sourceId).then(setMail, e => setError((e as Error).message));
  }, [message.sourceId]);
  const full = mail?.available ? mail : null;
  const reply = async () => {
    if (!text.trim() || !message.sourceId) return;
    setSending(true); setError("");
    try { await etherMailReply(message.sourceId, text.trim()); setText(""); setSent(true); }
    catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  };
  return <Modal open title={full?.subject || message.title || "Письмо"} onClose={onClose} size="max-w-2xl"
    footer={full?.canReply ? <div className="space-y-2">
      {sent && <p role="status" className="text-xs tone-success-text">Ответ отправлен.</p>}
      <div className="flex items-end gap-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={20000} aria-label="Ответ на письмо"
          placeholder="Ответ на письмо" className="flex-1 border border-border-main rounded-lg p-2.5 bg-bg-card text-sm resize-none" />
        <Button onClick={() => void reply()} loading={sending} disabled={!text.trim()} icon={<Send className="w-3.5 h-3.5" />}>Ответить</Button>
      </div>
    </div> : <p className="text-xs text-text-muted">{mail ? (full ? full.replyReason : mail.reason) || "Ответ недоступен." : "Загружаю письмо…"} Можно ответить в самом Эфире.</p>}>
    {error && <p role="alert" className="text-xs tone-danger mb-3">{error}</p>}
    <p className="text-xs text-text-muted mb-3 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />
      {full?.from || message.author}{full?.to ? ` → ${full.to}` : ""} · {fmt(full?.date || message.date)}</p>
    <div className="dashboard-feed-row text-sm whitespace-pre-wrap break-words">{full?.text || message.text}</div>
  </Modal>;
}
