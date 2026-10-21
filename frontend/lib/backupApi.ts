/**
 * Резервная копия SimpleTest — клиент к /api/backup/* (бэкенд: backend/api/backup.py) плюс данные браузера.
 *
 * В файл: данные сервера (data/*.json, настройки и таблицы БД, эталоны) и данные этого браузера (localStorage
 * ключи st_*: списки Jira tool, история генераций и т. п.). Секреты не выгружаются — ни сервером, ни здесь.
 * Выгрузить можно один раздел (вкладку) или все.
 */

import { fetchJson } from "./jiraApi";

export const BACKUP_FORMAT = "simpletest.backup";
const REDACTED = "__SIMPLETEST_REDACTED__";

export interface BackupSummary { id: string; title: string; files: string[]; tables: string[]; settings: number; etalons: number }
export interface BackupFile {
  format: string; version: number; createdAt: string; scope: string; scopeTitle: string; secrets: string;
  server: Record<string, unknown>; summary: BackupSummary[];
  browser?: { localStorage: Record<string, string> };
}
export interface RestoreResult {
  restored: { files: string[]; tables: string[]; settings: string[]; etalons: string[] };
  errors: string[]; snapshot: string; browserKeys: number;
}

export const SECTIONS: { id: string; title: string }[] = [
  { id: "generation", title: "Тестовая модель" },
  { id: "test_data", title: "Тестовые данные" },
  { id: "bugs", title: "Jira tool" },
  { id: "zephyr", title: "Zephyr Tool" },
  { id: "stands", title: "График стендов" },
  { id: "logs", title: "Логи" },
  { id: "kafka", title: "Просмотр Kafka" },
  { id: "event_generators", title: "Генераторы событий" },
  { id: "etalons", title: "Данные" },
  { id: "model_bench", title: "Тестирование моделей LLM" },
  { id: "auto_model", title: "Автотесты" },
  { id: "settings", title: "Настройки и общее" },
];
export const sectionTitle = (id: string) => SECTIONS.find(s => s.id === id)?.title ?? id;

/** Раздел текущей страницы — по адресу. */
export function sectionOfPath(path: string): string {
  const p = path.split("/")[1] ?? "";
  const map: Record<string, string> = {
    generation: "generation", "test-data": "test_data", bugs: "bugs", zephyr: "zephyr", stands: "stands", logs: "logs",
    kafka: "kafka", "event-generators": "event_generators", alerts: "event_generators", jobs: "event_generators",
    metrics: "event_generators", etalons: "etalons", "model-bench": "model_bench", "auto-model": "auto_model",
    revisor: "auto_model", settings: "settings",
  };
  return map[p] ?? "settings";
}

/* ── Данные браузера ─────────────────────────────────────────────────────── */

/** Не переносим: вход, кэши и одноразовые передачи между разделами. */
const SKIP_KEYS = new Set(["st_auth_token", "st_jira_tool_cache", "st_zephyr_import", "st_automodel_prefill", "st_kafka_session"]);
const KEY_SECTION: [RegExp, string][] = [
  [/^st_(jira_|bug_|plan_unit|cell_icon)/, "bugs"], [/^st_zephyr_/, "zephyr"], [/^st_kafka_/, "kafka"],
  [/^st_(gen_|projects$|teams$|ke$|author$)/, "generation"], [/^st_automodel_|^st_autotest_/, "auto_model"],
  [/^st_testdata_/, "test_data"], [/^st_alert/, "event_generators"], [/^st_logs_/, "logs"],
];
export const keySection = (key: string) => KEY_SECTION.find(([re]) => re.test(key))?.[1] ?? "settings";

const SECRET = /(pass(word|wd)?|pwd|secret|token|api_?key|auth_?key|private|credential|cookie)/i;
const isSecret = (k: string) => SECRET.test(k) && !/path$|_type$/i.test(k);

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) =>
      [k, isSecret(k) && typeof x === "string" && x ? REDACTED : redact(x)]));
  }
  return v;
}
function unredact(v: unknown, old: unknown): unknown {
  if (v === REDACTED) return typeof old === "string" ? old : "";
  if (Array.isArray(v)) {
    const olds = Array.isArray(old) ? old : [];
    return v.map((x, i) => unredact(x, olds[i]));
  }
  if (v && typeof v === "object") {
    const o = old && typeof old === "object" ? old as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, unredact(x, o[k])]));
  }
  return v;
}

function browserData(scope: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("st_") || SKIP_KEYS.has(k) || (scope !== "all" && keySection(k) !== scope)) continue;
      const raw = localStorage.getItem(k) ?? "";
      try { out[k] = JSON.stringify(redact(JSON.parse(raw))); } catch { out[k] = raw; }
    }
  } catch { /* хранилище браузера недоступно — выгружаем только сервер */ }
  return out;
}

/** Ключи браузера из файла по разделам — для окна восстановления. */
export function browserSummary(b: BackupFile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(b.browser?.localStorage ?? {})) out[keySection(k)] = (out[keySection(k)] ?? 0) + 1;
  return out;
}

/* ── Выгрузка и восстановление ───────────────────────────────────────────── */

export async function makeBackup(scope: string): Promise<BackupFile> {
  const server = await fetchJson<BackupFile>(`/api/backup/export?scope=${encodeURIComponent(scope)}`);
  return { ...server, browser: { localStorage: browserData(scope) } };
}

export function downloadBackup(b: BackupFile): string {
  const name = `SimpleTest — ${b.scope === "all" ? "все разделы" : b.scopeTitle} — ${b.createdAt.slice(0, 16).replace("T", " ").replace(":", "-")}.json`;
  const blob = new Blob([JSON.stringify(b, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, "_");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return a.download;
}

/** Файл — резервная копия SimpleTest (а не, например, выгрузка списков Jira tool)? */
export function isBackup(raw: unknown): raw is BackupFile {
  return !!raw && typeof raw === "object" && (raw as { format?: string }).format === BACKUP_FORMAT;
}

export async function readBackup(file: File): Promise<BackupFile> {
  let raw: unknown;
  try { raw = JSON.parse(await file.text()); } catch { throw new Error("Файл не читается как JSON"); }
  if (!isBackup(raw)) throw new Error("Это не резервная копия SimpleTest");
  // Сводку по серверу пересчитывает бэкенд: файл могли править руками.
  const p = await fetchJson<{ summary: BackupSummary[] }>("/api/backup/preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backup: raw }),
  });
  return { ...raw, summary: p.summary };
}

/** Восстановить выбранные разделы: сервер (со снимком перед заменой) и данные браузера. */
export async function restoreBackup(b: BackupFile, sections: string[]): Promise<RestoreResult> {
  const r = await fetchJson<Omit<RestoreResult, "browserKeys">>("/api/backup/import", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backup: b, sections }),
  });
  let browserKeys = 0;
  for (const [k, v] of Object.entries(b.browser?.localStorage ?? {})) {
    if (!k.startsWith("st_") || SKIP_KEYS.has(k) || !sections.includes(keySection(k))) continue;
    try {
      let value = v;
      try { value = JSON.stringify(unredact(JSON.parse(v), JSON.parse(localStorage.getItem(k) ?? "null"))); } catch { /* не JSON — как есть */ }
      localStorage.setItem(k, value);
      browserKeys++;
    } catch { /* нет места — пропускаем ключ */ }
  }
  return { ...r, browserKeys };
}
