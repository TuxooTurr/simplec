"use client";

/**
 * Ответ ядра в виде мессенджера.
 *
 * Контакт = топик Kafka, куда ушло сообщение. В сообщении — тело и получатели;
 * технические детали (ключ, partition, offset, заголовки) спрятаны за кнопкой
 * «i», служебный вывод ячеек свёрнут в серые плашки. Сырой вывод целиком —
 * во вкладке «Лог». Разбор вывода — lib/kernelMessages.ts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronDown, ChevronUp, Copy, Eraser, Info, Loader2, MessageSquare, Terminal, Users,
} from "lucide-react";
import {
  chatContacts, parseKernelOutput,
  type ChatItem, type ChatMessage, type ChatService, type KernelLine,
} from "@/lib/kernelMessages";

const AVATAR_TONES = [
  "from-indigo-500 to-violet-500",
  "from-emerald-500 to-teal-500",
  "from-sky-500 to-blue-600",
  "from-amber-500 to-orange-500",
  "from-fuchsia-500 to-pink-500",
  "from-slate-500 to-slate-700",
];

function toneFor(topic: string): string {
  let h = 0;
  for (const ch of topic) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Две буквы для аватара: «REPL.PKAP1173.911_ZNO» → «ZN», «mcp-in» → «MI». */
function initials(topic: string): string {
  const last = topic.split(".").pop() || topic;
  const parts = last.split(/[-_\s]+/).filter(p => /[A-Za-zА-Яа-я]/.test(p));
  const letters = parts.length >= 2
    ? parts[0][0] + parts[1][0]
    : (parts[0] ?? last).replace(/[^A-Za-zА-Яа-я]/g, "").slice(0, 2);
  return letters.toUpperCase() || "#";
}

function Avatar({ topic, size = "md" }: { topic: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-6 h-6 text-[9px]" : "w-8 h-8 text-[11px]";
  return (
    <span className={`${box} flex-shrink-0 rounded-full bg-gradient-to-br ${toneFor(topic)}
      text-white font-bold flex items-center justify-center shadow-sm`} aria-hidden>
      {initials(topic)}
    </span>
  );
}

const BODY_PREVIEW_LINES = 12;

function MessageBubble({ m, showTopic }: { m: ChatMessage; showTopic: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = m.bodyText.split("\n");
  const long = lines.length > BODY_PREVIEW_LINES;
  const shown = expanded || !long ? m.bodyText : lines.slice(0, BODY_PREVIEW_LINES).join("\n");
  const headerEntries = Object.entries(m.headers);
  const hasDetails = !!(m.key || m.partition || m.offset || headerEntries.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.bodyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* буфер недоступен — молча */ }
  };

  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] min-w-0 rounded-2xl rounded-br-md border border-primary/20
        bg-[var(--color-active-bg)] px-3.5 py-2.5 shadow-sm">

        <div className="flex items-center gap-2 mb-1.5">
          {showTopic && <Avatar topic={m.topic} size="sm" />}
          {showTopic && <span className="text-xs font-semibold text-text-main truncate">{m.topic}</span>}
          <span className="ml-auto text-[10px] tabular-nums text-text-muted flex-shrink-0">{m.ts}</span>
          {hasDetails && (
            <button type="button" onClick={() => setDetails(v => !v)}
              aria-label="Технические детали" aria-expanded={details}
              className={`p-0.5 rounded transition-colors ${details ? "text-primary" : "text-text-muted hover:text-text-main"}`}>
              <Info className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {m.recipients.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mb-2">
            <Users className="w-3 h-3 text-text-muted" aria-hidden />
            <span className="text-[10px] text-text-muted mr-0.5">Кому:</span>
            {m.recipients.map(r => (
              <span key={r} className="px-1.5 py-0.5 rounded-md bg-bg-card border border-border-main
                text-[11px] text-text-main break-all">{r}</span>
            ))}
          </div>
        )}

        {details && (
          <div className="mb-2 rounded-lg bg-bg-card border border-border-main px-2.5 py-1.5 text-[10px] text-text-muted space-y-0.5">
            {(m.key || m.partition || m.offset) && (
              <p className="font-mono">
                {m.key && <>key {m.key} · </>}
                {m.partition && <>partition {m.partition} · </>}
                {m.offset && <>offset {m.offset}</>}
              </p>
            )}
            {headerEntries.map(([k, v]) => (
              <p key={k} className="font-mono break-all"><span className="text-text-main">{k}</span> {v}</p>
            ))}
          </div>
        )}

        {m.bodyText ? (
          <div className="relative group/body">
            <pre className="text-[11px] leading-[1.45] font-mono text-text-main whitespace-pre-wrap break-all
              bg-bg-card border border-border-main rounded-lg px-2.5 py-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
              {shown}{!expanded && long ? "\n…" : ""}
            </pre>
            <button type="button" onClick={copy} aria-label="Скопировать тело"
              className="absolute top-1.5 right-1.5 p-1 rounded-md bg-bg-card border border-border-main text-text-muted
                opacity-0 group-hover/body:opacity-100 focus:opacity-100 hover:text-text-main transition-opacity">
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
            </button>
            {long && (
              <button type="button" onClick={() => setExpanded(v => !v)}
                className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                {expanded
                  ? <><ChevronUp className="w-3 h-3" /> Свернуть</>
                  : <><ChevronDown className="w-3 h-3" /> Показать всё ({lines.length} строк)</>}
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] italic text-text-muted">Тело не напечатано скриптом</p>
        )}
      </div>
    </div>
  );
}

function ServiceNote({ s }: { s: ChatService }) {
  const [open, setOpen] = useState(false);
  const meaningful = s.lines.filter(l => l.trim() && !/^[=─-]{6,}$/.test(l.trim()));
  if (meaningful.length === 0) return null;
  const first = meaningful[0].trim();
  const more = meaningful.length - 1;

  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={() => more > 0 && setOpen(v => !v)} aria-expanded={more > 0 ? open : undefined}
        className={`max-w-[92%] truncate px-3 py-1 rounded-full text-[11px] border transition-colors ${
          s.error
            ? "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300"
            : "border-border-main bg-bg-card text-text-muted"
        } ${more > 0 ? "hover:text-text-main cursor-pointer" : "cursor-default"}`}>
        <span className="tabular-nums opacity-70 mr-1.5">{s.ts}</span>
        {first}
        {more > 0 && <span className="ml-1.5 opacity-70">{open ? "▲" : `+${more}`}</span>}
      </button>
      {open && (
        <pre className="w-[92%] text-[10px] leading-4 font-mono whitespace-pre-wrap break-all text-text-muted
          bg-bg-card border border-border-main rounded-lg px-2.5 py-2 max-h-64 overflow-y-auto scrollbar-thin">
          {meaningful.join("\n")}
        </pre>
      )}
    </div>
  );
}

export default function KernelChat({ output, executing, onClear }: {
  output:    KernelLine[];
  executing: boolean;
  onClear:   () => void;
}) {
  const [view, setView] = useState<"chat" | "log">("chat");
  const [topic, setTopic] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const items: ChatItem[] = useMemo(() => parseKernelOutput(output), [output]);
  const contacts = useMemo(() => chatContacts(items), [items]);
  const messageCount = contacts.reduce((n, c) => n + c.count, 0);

  // Выбранный топик пропал (очистили вывод) — возвращаемся к «Все».
  useEffect(() => {
    if (topic && !contacts.some(c => c.topic === topic)) setTopic(null);
  }, [contacts, topic]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items, view, topic]);

  const visible = topic
    ? items.filter(i => i.type === "message" && i.topic === topic)
    : items;
  const active = topic ? contacts.find(c => c.topic === topic) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* Шапка: вид и очистка */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-text-main flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-text-muted" aria-hidden /> Ответ ядра
          {executing && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-1" aria-label="Выполняется" />}
        </h3>
        <div className="ml-auto flex items-center gap-1 bg-bg-muted rounded-lg p-0.5" role="tablist">
          {([["chat", "Чат", MessageSquare], ["log", "Лог", Terminal]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                view === id ? "bg-bg-card text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}>
              <Icon className="w-3 h-3" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClear} aria-label="Очистить вывод" title="Очистить"
          className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors">
          <Eraser className="w-3.5 h-3.5" />
        </button>
      </div>

      {view === "log" ? (
        <div className="flex-1 min-h-0 border border-border-main rounded-lg bg-gray-950 overflow-y-auto scrollbar-thin">
          <div className="text-xs font-mono p-2 min-h-full">
            {output.length === 0 ? (
              <p className="text-gray-400 italic p-2">— ожидание вывода —</p>
            ) : output.map((line, i) => (
              <div key={i} className={`flex gap-2 leading-5 ${
                line.kind === "error" ? "text-red-400" : line.kind === "system" ? "text-blue-400" : "text-green-300"}`}>
                <span className="text-gray-500 flex-shrink-0 select-none">{line.ts}</span>
                <pre className="whitespace-pre-wrap break-all flex-1">{line.text}</pre>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col border border-border-main rounded-xl overflow-hidden bg-bg-subtle">
          {/* Контакты — топики */}
          {contacts.length > 0 && (
            <div className="flex gap-1.5 px-2 py-2 border-b border-border-main bg-bg-card overflow-x-auto scrollbar-thin flex-shrink-0">
              <button type="button" onClick={() => setTopic(null)} aria-pressed={topic === null}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border flex-shrink-0 transition-colors ${
                  topic === null ? "border-primary/40 bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:text-text-main"}`}>
                Все <span className="tabular-nums opacity-70">{messageCount}</span>
              </button>
              {contacts.map(c => (
                <button key={c.topic} type="button" onClick={() => setTopic(c.topic)} aria-pressed={topic === c.topic}
                  title={c.topic}
                  className={`flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 max-w-[220px] transition-colors ${
                    topic === c.topic ? "border-primary/40 bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-main hover:border-primary/30"}`}>
                  <Avatar topic={c.topic} size="sm" />
                  <span className="truncate">{c.topic}</span>
                  <span className="tabular-nums text-text-muted">{c.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Шапка диалога — выбранный контакт */}
          {active && (
            <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border-main bg-bg-card flex-shrink-0">
              <Avatar topic={active.topic} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-main truncate">{active.topic}</p>
                <p className="text-[11px] text-text-muted">
                  {active.count} сообщ. · последнее в {active.lastTs}
                </p>
              </div>
            </div>
          )}

          {/* Лента */}
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 py-3 space-y-2.5">
            {visible.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-text-muted">
                <MessageSquare className="w-8 h-8 opacity-20" aria-hidden />
                <p className="text-xs">Сообщений пока нет — подключите ядро и запустите алерт</p>
              </div>
            ) : visible.map((it, i) =>
              it.type === "message"
                ? <MessageBubble key={i} m={it} showTopic={!topic} />
                : <ServiceNote key={i} s={it} />,
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
