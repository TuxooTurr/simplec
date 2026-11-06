"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, ExternalLink, Info, Trash2, X } from "lucide-react";
import { clearNotes, dismissToast, markAllRead, useNotifications, type Note, type NoteKind, type NoteLink } from "@/lib/notifications";

const KIND_ICON: Record<NoteKind, { Icon: typeof Info; cls: string }> = {
  success: { Icon: CheckCircle2, cls: "text-emerald-500" },
  error: { Icon: AlertTriangle, cls: "text-red-500" },
  info: { Icon: Info, cls: "text-primary" },
};

function when(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const d = new Date(at);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `сегодня, ${time}` : `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}, ${time}`;
}

function NoteLinks({ links, onGo }: { links?: NoteLink[]; onGo?: () => void }) {
  if (!links?.length) return null;
  const cls = "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      {links.map(l => (/^https?:/.test(l.href)
        ? <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={cls}>{l.label} <ExternalLink className="h-3 w-3" /></a>
        : <Link key={l.href} href={l.href} onClick={onGo} className={cls}>{l.label}</Link>))}
    </span>
  );
}

function NoteBody({ note, onGo }: { note: Note; onGo?: () => void }) {
  const { Icon, cls } = KIND_ICON[note.kind];
  return (
    <>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${cls}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-text-main break-words">{note.title}</p>
        {note.text && <p className="mt-0.5 line-clamp-3 text-xs text-text-muted break-words">{note.text}</p>}
        <NoteLinks links={note.links} onGo={onGo} />
      </div>
    </>
  );
}

/** Колокольчик: счётчик непрочитанного и журнал результатов с активными ссылками. Открыли журнал — всё прочитано. */
export default function NotificationBell() {
  const { notes, toasts } = useNotifications();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const unread = notes.filter(n => !n.read).length;

  // Открыли журнал — всё прочитано, а всплывшие сообщения убираем: они легли бы поверх него.
  useEffect(() => { if (open) { markAllRead(); toasts.forEach(t => dismissToast(t.id)); } }, [open, notes.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? `Уведомления: непрочитанных ${unread}` : "Уведомления"} title="Уведомления"
        className="relative rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-subtle hover:text-primary">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {/* В body: у шапки панели размытый фон, а внутри такого предка position: fixed считается от него, а не от экрана */}
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label="Уведомления"
          className="fixed right-3 top-12 z-[75] flex max-h-[70vh] w-[400px] max-w-[calc(100vw-24px)] flex-col rounded-xl border border-border-main bg-[var(--color-modal-bg)] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border-main px-4 py-2.5">
            <h3 className="text-sm font-semibold text-text-main">Уведомления</h3>
            {notes.length > 0 && (
              <button type="button" onClick={clearNotes} className="ml-auto inline-flex items-center gap-1 text-xs text-text-muted hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" /> Очистить</button>
            )}
          </div>
          {notes.length === 0
            ? <p className="p-6 text-center text-sm text-text-muted">Пока пусто. Здесь появятся результаты генераций, запусков и регистрации задач.</p>
            : (
              <ul className="divide-y divide-border-main overflow-y-auto scrollbar-thin">
                {notes.map(n => (
                  <li key={n.id} className="flex items-start gap-2.5 px-4 py-2.5">
                    <NoteBody note={n} onGo={() => setOpen(false)} />
                    <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-muted">{when(n.at)}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Всплывающие сообщения вверху справа: гаснут сами и остаются под колокольчиком. */
export function Toasts() {
  const { toasts } = useNotifications();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-12 z-[80] flex w-[380px] max-w-[calc(100vw-24px)] flex-col gap-2" aria-live="polite">
      {toasts.slice(0, 4).map(t => (
        <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border-main bg-[var(--color-modal-bg)] px-3.5 py-3 shadow-xl animate-fade-in">
          <NoteBody note={t} onGo={() => dismissToast(t.id)} />
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Скрыть" className="flex-shrink-0 rounded p-0.5 text-text-muted hover:text-text-main"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
