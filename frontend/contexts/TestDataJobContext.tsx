"use client";

/**
 * Контекст задачи «Тестовые данные».
 *
 * Живёт в WorkspaceShell (над роутами), поэтому запущенный запрос НЕ прерывается
 * при переходе на другой раздел — вернувшись, пользователь видит тот же процесс
 * с кнопкой «Отменить», а по завершении — результат.
 *
 * Плюс держит архив выполненных запросов в localStorage (переживает перезагрузку
 * и закрытие браузера): время, список БД, сам запрос и снимок результата.
 */

import {
  createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode,
} from "react";
import {
  executeTestDataQuery, generateTestDataQuery, type TestDataQueryResult,
} from "@/lib/api";

export type TdPhase = "idle" | "generating" | "executing";
export type TdMode = "sql" | "natural";

export interface TdArchiveEntry {
  id: string;
  ts: number;                                        // момент завершения
  mode: TdMode;
  requirement: string;                               // текст на естественном языке (для natural)
  sql: string;                                       // выполненный SQL
  connNames: string[];                               // имена БД (снимок)
  results: Record<string, TestDataQueryResult> | null;
  error?: string;
}

export interface TdJob {
  phase: TdPhase;
  running: boolean;
  results: Record<string, TestDataQueryResult> | null;
  error: string;
  startedAt: number | null;
  sql: string;
  requirement: string;
  mode: TdMode;
  connIds: string[];
  connNames: string[];
}

interface RunSqlParams { connIds: string[]; connNames: string[]; sql: string }
interface RunNaturalParams { connIds: string[]; connNames: string[]; requirement: string; provider: string }

interface TdCtx {
  job: TdJob;
  archive: TdArchiveEntry[];
  runSql: (p: RunSqlParams) => void;
  runNatural: (p: RunNaturalParams) => void;
  cancel: () => void;
  reset: () => void;
  clearArchive: () => void;
  removeArchiveEntry: (id: string) => void;
}

const ARCHIVE_KEY = "st_testdata_archive";
const MAX_ENTRIES = 30;        // максимум записей в архиве
const MAX_ROWS_SNAPSHOT = 500; // максимум строк на БД в снимке (защита от разрастания localStorage)

const IDLE_JOB: TdJob = {
  phase: "idle", running: false, results: null, error: "",
  startedAt: null, sql: "", requirement: "", mode: "sql", connIds: [], connNames: [],
};

function loadArchive(): TdArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function saveArchive(entries: TdArchiveEntry[]) {
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(entries)); }
  catch { /* переполнение localStorage — пропускаем */ }
}

/** Обрезаем строки в снимке, чтобы не раздувать localStorage. */
function snapshotResults(
  results: Record<string, TestDataQueryResult> | null,
): Record<string, TestDataQueryResult> | null {
  if (!results) return null;
  const out: Record<string, TestDataQueryResult> = {};
  for (const [k, r] of Object.entries(results)) {
    out[k] = r.rows.length > MAX_ROWS_SNAPSHOT ? { ...r, rows: r.rows.slice(0, MAX_ROWS_SNAPSHOT) } : r;
  }
  return out;
}

const Ctx = createContext<TdCtx>({
  job: IDLE_JOB, archive: [],
  runSql: () => {}, runNatural: () => {}, cancel: () => {}, reset: () => {},
  clearArchive: () => {}, removeArchiveEntry: () => {},
});

export function TestDataJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<TdJob>(IDLE_JOB);
  const [archive, setArchive] = useState<TdArchiveEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setArchive(loadArchive()); }, []);

  const pushArchive = useCallback((entry: TdArchiveEntry) => {
    setArchive((prev) => {
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      saveArchive(next);
      return next;
    });
  }, []);

  const finish = useCallback((
    base: RunSqlParams | RunNaturalParams,
    mode: TdMode,
    sql: string,
    requirement: string,
    results: Record<string, TestDataQueryResult> | null,
    error: string,
  ) => {
    setJob({
      phase: "idle", running: false, results, error,
      startedAt: null, sql, requirement, mode,
      connIds: base.connIds, connNames: base.connNames,
    });
    pushArchive({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(), mode, requirement, sql,
      connNames: base.connNames,
      results: snapshotResults(results),
      error: error || undefined,
    });
  }, [pushArchive]);

  const runSql = useCallback((p: RunSqlParams) => {
    if (!p.sql.trim() || p.connIds.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({
      phase: "executing", running: true, results: null, error: "",
      startedAt: Date.now(), sql: p.sql, requirement: "", mode: "sql",
      connIds: p.connIds, connNames: p.connNames,
    });
    executeTestDataQuery({ connection_ids: p.connIds, sql: p.sql }, ctrl.signal)
      .then((res) => { if (!ctrl.signal.aborted) finish(p, "sql", p.sql, "", res.results, ""); })
      .catch((e) => {
        if (ctrl.signal.aborted || (e as Error)?.name === "AbortError") return; // отмена — состояние уже сброшено
        finish(p, "sql", p.sql, "", null, e instanceof Error ? e.message : String(e));
      });
  }, [finish]);

  const runNatural = useCallback((p: RunNaturalParams) => {
    if (!p.requirement.trim() || p.connIds.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({
      phase: "generating", running: true, results: null, error: "",
      startedAt: Date.now(), sql: "", requirement: p.requirement, mode: "natural",
      connIds: p.connIds, connNames: p.connNames,
    });
    (async () => {
      try {
        const gen = await generateTestDataQuery(
          { connection_ids: p.connIds, requirement: p.requirement, provider: p.provider },
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        if (!gen.sql.trim()) {
          // Бэкенд теперь сам не пропускает пустой SQL (502), но не полагаемся
          // только на это — иначе пользователь снова увидит голый pydantic 422.
          finish(p, "natural", "", p.requirement, null, "LLM вернул пустой SQL-запрос — переформулируйте требование");
          return;
        }
        setJob((j) => ({ ...j, phase: "executing", sql: gen.sql }));
        const res = await executeTestDataQuery({ connection_ids: p.connIds, sql: gen.sql }, ctrl.signal);
        if (ctrl.signal.aborted) return;
        finish(p, "natural", gen.sql, p.requirement, res.results, "");
      } catch (e) {
        if (ctrl.signal.aborted || (e as Error)?.name === "AbortError") return;
        finish(p, "natural", "", p.requirement, null, e instanceof Error ? e.message : String(e));
      }
    })();
  }, [finish]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setJob((j) => ({ ...j, phase: "idle", running: false, error: "Запрос отменён" }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setJob(IDLE_JOB);
  }, []);

  const clearArchive = useCallback(() => { setArchive([]); saveArchive([]); }, []);
  const removeArchiveEntry = useCallback((id: string) => {
    setArchive((prev) => { const next = prev.filter((e) => e.id !== id); saveArchive(next); return next; });
  }, []);

  return (
    <Ctx.Provider value={{ job, archive, runSql, runNatural, cancel, reset, clearArchive, removeArchiveEntry }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTestDataJob() { return useContext(Ctx); }
