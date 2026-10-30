/**
 * Кэш «Трекинга AQA» на активную сессию — как у Jira tool (lib/jiraToolCache.ts).
 *
 * Подключения, коммиты (по ветке), запуски TestOps и роадмап держим в памяти модуля (переживает переходы между
 * разделами) и копией в sessionStorage (переживает перезагрузку вкладки). Открыли раздел — всё видно сразу из кэша,
 * а свежие данные подтягиваются фоном: при открытии, если кэш старше 30 минут, и раз в 30 минут, пока раздел открыт.
 * «Обновить» — мимо кэша.
 *
 * Запись привязана к источнику (ссылка на репозиторий и ветка, ссылка на проект TestOps, список эпиков): поменяли
 * его в настройках — старое не показываем. Секретов в кэше нет — маркеры в настройках приходят масками.
 */

import type { AqaCommits, AqaRoadmap, AqaSettings, AqaTestops } from "./aqaApi";

const KEY = "st_aqa_cache";
export const AQA_REFRESH_MS = 30 * 60 * 1000;
/** Веток в кэше коммитов — последние по времени загрузки. */
const MAX_BRANCHES = 5;

export interface Entry<T> { key: string; data: T; at: number }

export interface AqaCache {
  settings: AqaSettings | null;
  /** Коммиты по ключу «ссылка|ветка». */
  commits: Record<string, Entry<AqaCommits>>;
  testops: Entry<AqaTestops> | null;
  roadmap: Entry<AqaRoadmap> | null;
}

let mem: AqaCache | null = null;

/** Кэш сессии (из памяти, иначе из sessionStorage). Вызывать только на клиенте. */
export function aqaCache(): AqaCache {
  if (mem) return mem;
  mem = { settings: null, commits: {}, testops: null, roadmap: null };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<AqaCache>;
      mem = { settings: s.settings ?? null, commits: s.commits ?? {}, testops: s.testops ?? null, roadmap: s.roadmap ?? null };
    }
  } catch { /* битая копия — начинаем с пустого кэша */ }
  return mem;
}

/** Запись годится: тот же источник и не старше 30 минут. */
export const isFresh = <T,>(e: Entry<T> | null | undefined, key: string) => !!e && e.key === key && Date.now() - e.at < AQA_REFRESH_MS;

/** Запись того же источника (может быть устаревшей — её показываем, пока грузятся свежие данные). */
export const sameSource = <T,>(e: Entry<T> | null | undefined, key: string): Entry<T> | null => (e && e.key === key ? e : null);

export function putCommits(key: string, data: AqaCommits): void {
  const c = aqaCache();
  c.commits[key] = { key, data, at: Date.now() };
  const keys = Object.values(c.commits).sort((a, b) => b.at - a.at).map(e => e.key);
  for (const k of keys.slice(MAX_BRANCHES)) delete c.commits[k];
  persistAqaCache();
}

/** Копия в sessionStorage. Не влезло — живём в памяти. */
export function persistAqaCache(): void {
  if (!mem) return;
  try { sessionStorage.setItem(KEY, JSON.stringify(mem)); }
  catch { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
}
