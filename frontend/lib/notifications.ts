/**
 * Уведомления Loom: «пуш» вверху справа и запись под колокольчиком.
 *
 * Хранилище — обычный модуль, а не контекст: вызвать notify() можно откуда угодно, в том числе из запроса, который
 * пережил уход с раздела (компонента уже нет, а результат надо показать). Журнал — в localStorage этого браузера.
 */

import { useSyncExternalStore } from "react";

const KEY = "st_notifications";
const MAX_NOTES = 100;
const TOAST_MS = { success: 7000, info: 7000, error: 15000 };

export type NoteKind = "success" | "error" | "info";
/** Ссылка записи: http(s) — в новой вкладке, «/…» — раздел Loom. */
export interface NoteLink { label: string; href: string }
export interface Note { id: string; at: number; kind: NoteKind; title: string; text?: string; links?: NoteLink[]; read: boolean }

interface Snapshot { notes: Note[]; toasts: Note[] }
const EMPTY: Snapshot = { notes: [], toasts: [] };

let snap: Snapshot | null = null;
const listeners = new Set<() => void>();

function load(): Snapshot {
  if (snap) return snap;
  let notes: Note[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) notes = raw as Note[];
  } catch { /* битая копия — начинаем с пустого журнала */ }
  snap = { notes, toasts: [] };
  return snap;
}

function commit(next: Snapshot, persist = true) {
  snap = next;
  if (persist) {
    try { localStorage.setItem(KEY, JSON.stringify(next.notes)); } catch { /* только до перезагрузки */ }
  }
  listeners.forEach(l => l());
}

/** Человек сейчас в этом разделе: результат он и так видит, всплывать незачем — достаточно записи в журнале. */
export const onPage = (path: string) => typeof window !== "undefined" && window.location.pathname.startsWith(path);

/** Новая запись. silent — без всплывающего сообщения и сразу прочитанная: человек видит результат на экране. */
export function notify(n: { kind: NoteKind; title: string; text?: string; links?: NoteLink[]; silent?: boolean }): void {
  if (typeof window === "undefined") return;
  const { silent, ...rest } = n;
  const note: Note = { ...rest, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), read: !!silent };
  const cur = load();
  commit({ notes: [note, ...cur.notes].slice(0, MAX_NOTES), toasts: silent ? cur.toasts : [note, ...cur.toasts] });
  if (!silent) window.setTimeout(() => dismissToast(note.id), TOAST_MS[note.kind]);
}

/** Сообщение ушло под колокольчик: запись остаётся в журнале непрочитанной. */
export function dismissToast(id: string): void {
  const cur = load();
  if (cur.toasts.some(t => t.id === id)) commit({ ...cur, toasts: cur.toasts.filter(t => t.id !== id) }, false);
}

export function markAllRead(): void {
  const cur = load();
  if (cur.notes.some(n => !n.read)) commit({ ...cur, notes: cur.notes.map(n => (n.read ? n : { ...n, read: true })) });
}

export function clearNotes(): void {
  commit({ notes: [], toasts: [] });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useNotifications(): Snapshot {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}
