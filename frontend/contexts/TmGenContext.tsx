"use client";

/**
 * Тестовая модель по этапам: какие сессии на экране и в очереди. Работа идёт на сервере (backend/api/tm_gen.py),
 * здесь — только номера сессий и опрос. Провайдер живёт выше разделов: уход со страницы ничего не прерывает,
 * о готовом плане и замечаниях сообщает колокольчик. Номера — в sessionStorage, чтобы пережить перезагрузку.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { notify, onPage } from "@/lib/notifications";
import {
  TM_RUNNING, tmAccept, tmApprove, tmCancel, tmFix, tmGet, tmRecheck, tmRetry, tmStart,
  type TmPlan, type TmSession, type TmStart, type TmStatus,
} from "@/lib/tmApi";

const KEY = "st_tm_gen";
const POLL_MS = 2500;

interface Saved { active: string | null; ids: string[] }

interface Ctx {
  /** Сессии этого экрана: одна (свободный ввод, документы) или очередь задач. */
  sessions: TmSession[];
  active: TmSession | null;
  open: (id: string) => void;
  startOne: (b: TmStart) => Promise<void>;
  startBatch: (items: TmStart[]) => Promise<void>;
  approve: (id: string, plan: TmPlan, answers: Record<string, string>) => Promise<void>;
  fix: (id: string, remarkIds: string[]) => Promise<void>;
  recheck: (id: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clear: () => void;
  error: string;
}

const TmGenContext = createContext<Ctx | null>(null);

function load(): Saved {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "") as Saved; } catch { return { active: null, ids: [] }; }
}

export function TmGenProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [byId, setById] = useState<Record<string, TmSession>>({});
  const [error, setError] = useState("");
  const prevStatus = useRef<Record<string, TmStatus>>({});

  // Копию пишем только после того, как прочитали: иначе первый проход (и повторный монтаж в dev) затрёт её пустой.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const s = load(); setIds(s.ids ?? []); setActiveId(s.active ?? null); setLoaded(true); }, []);
  useEffect(() => {
    if (!loaded) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ active: activeId, ids })); } catch { /* приватный режим */ }
  }, [ids, activeId, loaded]);

  const put = useCallback((s: TmSession) => {
    setById(cur => ({ ...cur, [s.id]: s }));
    const was = prevStatus.current[s.id];
    prevStatus.current[s.id] = s.status;
    if (!was || was === s.status) return;
    const links = [{ label: "Открыть", href: "/generation" }];
    const silent = onPage("/generation");
    const who = s.task ? `${s.task.key} · ${s.feature}` : s.feature;
    if (s.status === "plan_ready") notify({ kind: "info", title: "План тестовой модели готов — нужно утвердить", text: who, links, silent });
    else if (s.status === "review_ready" && was === "reviewing")
      notify({ kind: s.review?.verdict === "ready" ? "success" : "info", title: s.review?.verdict === "ready" ? "Набор готов к загрузке" : `Арбитр: замечаний ${s.review?.remarks.length ?? 0}`, text: who, links, silent });
    else if (s.status === "error") notify({ kind: "error", title: "Тестовая модель: этап не удался", text: `${who}: ${s.error ?? ""}`, links, silent });
  }, []);

  const refresh = useCallback(async (id: string) => {
    try { put(await tmGet(id)); } catch (e) {
      if (String((e as Error).message).includes("не найдена")) {
        setIds(cur => cur.filter(x => x !== id));
        setActiveId(cur => (cur === id ? null : cur));
      }
    }
  }, [put]);

  // Опрос: всё, что идёт сейчас, и открытая сессия, если о ней ещё ничего не знаем.
  const idsRef = useRef(ids); idsRef.current = ids;
  const byIdRef = useRef(byId); byIdRef.current = byId;
  useEffect(() => {
    ids.filter(id => !byIdRef.current[id]).forEach(id => void refresh(id));
    const t = window.setInterval(() => {
      idsRef.current.forEach(id => {
        const s = byIdRef.current[id];
        // идущие — каждый раз; ждущие человека — тоже: их могли утвердить в другой вкладке. Готовые не опрашиваем.
        if (!s || TM_RUNNING.includes(s.status) || s.status === "plan_ready" || s.status === "review_ready") void refresh(id);
      });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [ids, refresh]);

  const wrap = useCallback(async (fn: () => Promise<TmSession>) => {
    setError("");
    try { put(await fn()); } catch (e) { setError((e as Error).message); throw e; }
  }, [put]);

  const startOne = useCallback(async (b: TmStart) => {
    setError("");
    try {
      const s = await tmStart(b);
      put(s); setIds([s.id]); setActiveId(s.id);
    } catch (e) { setError((e as Error).message); throw e; }
  }, [put]);

  const startBatch = useCallback(async (items: TmStart[]) => {
    setError("");
    const batch = `b${Date.now().toString(36)}`;
    const made: string[] = [];
    try {
      for (const it of items) { const s = await tmStart({ ...it, batch }); put(s); made.push(s.id); }
    } catch (e) { setError((e as Error).message); }
    if (made.length) { setIds(made); setActiveId(made[0]); }
  }, [put]);

  const value: Ctx = {
    sessions: ids.map(id => byId[id]).filter((s): s is TmSession => !!s),
    active: activeId ? byId[activeId] ?? null : null,
    open: id => { setIds(cur => (cur.includes(id) ? cur : [id])); setActiveId(id); void refresh(id); },
    startOne, startBatch,
    approve: (id, plan, answers) => wrap(() => tmApprove(id, plan, answers)),
    fix: (id, r) => wrap(() => tmFix(id, r)),
    recheck: id => wrap(() => tmRecheck(id)),
    accept: id => wrap(() => tmAccept(id)),
    retry: id => wrap(() => tmRetry(id)),
    cancel: id => wrap(() => tmCancel(id)),
    clear: () => { setIds([]); setActiveId(null); setError(""); },
    error,
  };
  return <TmGenContext.Provider value={value}>{children}</TmGenContext.Provider>;
}

export function useTmGen(): Ctx {
  const c = useContext(TmGenContext);
  if (!c) throw new Error("useTmGen вне TmGenProvider");
  return c;
}
