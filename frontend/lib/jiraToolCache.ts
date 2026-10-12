/**
 * Кэш задач Jira tool на активную сессию.
 *
 * Задачи из Jira держим в памяти модуля (переживает переходы между разделами — раздел
 * размонтируется, модуль нет) и копией в sessionStorage (переживает перезагрузку вкладки).
 * Открыли раздел — список виден сразу из кэша, а свежие данные подтягиваются фоном:
 * раз в 30 минут и при открытии, если кэш старше 30 минут.
 *
 * Кэш привязан к адресу Jira: поменяли сервер в настройках — старые задачи не показываем.
 */

import type { Issue } from "./jiraModel";

const KEY = "st_jira_tool_cache";
export const REFRESH_MS = 30 * 60 * 1000;

interface Stored {
  baseUrl: string;
  issues: Record<string, Issue>;
  related: string[];
  missing: string[];
  refreshedAt: number;
}

export interface IssueCache {
  baseUrl: string;
  issues: Record<string, Issue>;
  /** Задачи, у которых уже подтянуты связанные (стори эпика, дефекты). */
  related: Set<string>;
  /** Ключи, которых нет в Jira. */
  missing: Set<string>;
  /** Когда кэш последний раз полностью обновлялся из Jira (0 — ни разу). */
  refreshedAt: number;
}

let mem: IssueCache | null = null;

/** Кэш сессии (из памяти, иначе из sessionStorage). Вызывать только на клиенте. */
export function issueCache(): IssueCache {
  if (mem) return mem;
  mem = { baseUrl: "", issues: {}, related: new Set(), missing: new Set(), refreshedAt: 0 };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      mem = { baseUrl: s.baseUrl ?? "", issues: s.issues ?? {}, related: new Set(s.related ?? []),
              missing: new Set(s.missing ?? []), refreshedAt: s.refreshedAt ?? 0 };
    }
  } catch { /* битая копия — начинаем с пустого кэша */ }
  return mem;
}

/** Другой сервер Jira — кэш от старого не годится. */
export function bindCacheTo(baseUrl: string): IssueCache {
  const c = issueCache();
  if (c.baseUrl && c.baseUrl !== baseUrl) {
    c.issues = {}; c.related.clear(); c.missing.clear(); c.refreshedAt = 0;
  }
  c.baseUrl = baseUrl;
  return c;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Сохранить копию в sessionStorage (с задержкой — задачи приходят пачками). Не влезло — живём в памяти. */
export function persistCache(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!mem) return;
    const s: Stored = { baseUrl: mem.baseUrl, issues: mem.issues, related: [...mem.related], missing: [...mem.missing], refreshedAt: mem.refreshedAt };
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); }
    catch { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }   // переполнено — копии нет, память есть
  }, 500);
}
