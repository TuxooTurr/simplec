"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Problem, ago, fmtDur } from "@/components/aqa/widgets";
import { getJenkinsJob, runJenkins, type JenkinsJob, type JenkinsParam, type JenkinsQueue } from "@/lib/aqaApi";
import { watchJenkinsRun } from "@/lib/jenkinsWatch";

const VALUES_KEY = "st_aqa_jenkins_params";
const BUILDS_POLL_MS = 15_000;

const INPUT = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
const LBL = "block font-mono text-xs font-semibold text-text-main mb-1";

type Values = Record<string, string | boolean>;

const RESULT: Record<string, { label: string; cls: string }> = {
  RUNNING: { label: "идёт", cls: "text-blue-600 dark:text-blue-400" },
  SUCCESS: { label: "успешно", cls: "text-emerald-600 dark:text-emerald-400" },
  FAILURE: { label: "упал", cls: "text-red-600 dark:text-red-400" },
  UNSTABLE: { label: "нестабильно", cls: "text-amber-600 dark:text-amber-400" },
  ABORTED: { label: "прерван", cls: "text-text-muted" },
};

function readSaved(): Values {
  try { return JSON.parse(localStorage.getItem(VALUES_KEY) ?? "{}") as Values; } catch { return {}; }
}

/** Прошлое значение годится, пока параметр в джобе того же вида и значение в списке вариантов. */
function usable(p: JenkinsParam, v: unknown): v is string | boolean {
  if (p.kind === "password" || p.kind === "file") return false;
  if (p.kind === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  return p.kind !== "choice" || p.choices.includes(v);
}

/**
 * Запуск автотестов в Jenkins. Форма строится из описания джоба: какой параметр есть в Jenkinsfile, такой и в окне.
 * Значения прошлого запуска подставляются сами (кроме паролей). Запуск отслеживается отдельно от окна (lib/jenkinsWatch.ts):
 * окно можно закрыть, старт и итог сборки придут уведомлением. Пока сборки идут, окно обновляет их статусы.
 */
export default function JenkinsRunModal({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const [job, setJob] = useState<JenkinsJob | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [run, setRun] = useState<(JenkinsQueue & { id: number | null }) | null>(null);

  const load = useCallback(() => getJenkinsJob().then(setJob), []);
  useEffect(() => {
    load().then(() => {}, e => setLoadErr((e as Error).message));
    setValues(readSaved());
  }, [load]);

  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);

  const running = !!job?.builds.some(b => b.result === "RUNNING");
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load().catch(() => {}), BUILDS_POLL_MS);
    return () => window.clearInterval(t);
  }, [running, load]);

  const valueOf = (p: JenkinsParam) => (usable(p, values[p.name]) || p.kind === "password" ? values[p.name] ?? p.default : p.default);
  const set = (name: string, v: string | boolean) => setValues(x => ({ ...x, [name]: v }));

  const start = async () => {
    if (!job) return;
    setBusy(true); setErr(""); setRun(null);
    const params: Values = {};
    for (const p of job.params) if (p.kind !== "file") params[p.name] = valueOf(p);
    try {
      const r = await runJenkins(params);
      const queueId = r.queueId;
      setRun({ state: queueId === null ? "gone" : "queued", id: queueId });
      if (queueId !== null) {
        void watchJenkinsRun(queueId, job.name, q => setRun({ ...q, id: queueId }), () => void load().catch(() => {}), () => open.current);
      }
      const keep = Object.fromEntries(job.params.filter(p => p.kind !== "password" && p.kind !== "file").map(p => [p.name, params[p.name]]));
      try { localStorage.setItem(VALUES_KEY, JSON.stringify(keep)); } catch { /* только на этот раз */ }
      void load().catch(() => {});
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} size="max-w-2xl" title={job ? `Запуск автотестов · ${job.name}` : "Запуск автотестов"}>
      {!job ? (
        loadErr ? <Problem err={loadErr} onSettings={onSettings} />
          : <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю параметры из Jenkins…</p>
      ) : (
        <div className="space-y-4">
          {!job.buildable && <p className="text-sm text-amber-700 dark:text-amber-400">Джоб отключён в Jenkins — запустить его нельзя.</p>}
          {job.params.length === 0 && <p className="text-sm text-text-muted">У джоба нет параметров — запустится как есть.</p>}
          {job.params.length > 0 && (
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
              {job.params.map(p => <ParamField key={p.name} p={p} value={valueOf(p)} onChange={v => set(p.name, v)} />)}
            </div>
          )}

          {err && <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40">{err}</p>}
          {run && <RunNote run={run} />}

          <div className="flex items-center gap-2 border-t border-border-main pt-3">
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              Открыть в Jenkins <ExternalLink className="h-3.5 w-3.5" /></a>
            <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:text-text-main">Закрыть</button>
            <button type="button" onClick={() => void start()} disabled={busy || !job.buildable || run?.state === "queued"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Запустить</button>
          </div>

          {job.builds.length > 0 && (
            <section aria-label="Последние запуски" className="border-t border-border-main pt-3">
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Последние запуски</h3>
                <button type="button" onClick={() => void load().catch(() => {})} aria-label="Обновить запуски" title="Обновить запуски"
                  className="rounded p-0.5 text-text-muted hover:text-text-main"><RefreshCw className="h-3 w-3" /></button>
              </div>
              <ul className="divide-y divide-border-main text-sm">
                {job.builds.map(b => {
                  const r = RESULT[b.result] ?? { label: b.result || "—", cls: "text-text-muted" };
                  return (
                    <li key={b.number} className="flex items-center gap-3 py-1">
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">#{b.number} ↗</a>
                      <span className={`text-xs font-semibold ${r.cls}`}>{r.label}</span>
                      <span className="ml-auto text-xs text-text-muted">{ago(b.started)}</span>
                      <span className="w-24 text-right text-xs tabular-nums text-text-muted">{b.result === "RUNNING" ? "" : fmtDur(b.duration)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function ParamField({ p, value, onChange }: { p: JenkinsParam; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const id = `jk-${p.name}`;
  // Описание в Jenkins бывает с HTML-разметкой: показываем только текст.
  const hint = p.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const note = hint ? <p className="mt-1 text-[11px] text-text-muted">{hint}</p> : null;
  if (p.kind === "boolean") {
    return (
      <div>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-xs font-semibold text-text-main">
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {p.name}</label>
        {note}
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className={LBL}>{p.name}</label>
      {p.kind === "choice" ? (
        <select id={id} value={String(value)} onChange={e => onChange(e.target.value)} className={INPUT}>
          {p.choices.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : p.kind === "multiline" ? (
        <textarea id={id} value={String(value)} onChange={e => onChange(e.target.value)} rows={3} className={`${INPUT} resize-y font-mono text-[13px]`} />
      ) : p.kind === "password" ? (
        <input id={id} type="password" value={String(value)} onChange={e => onChange(e.target.value)} autoComplete="off" placeholder="Пусто — значение из Jenkins" className={INPUT} />
      ) : p.kind === "file" ? (
        <p id={id} className="text-xs text-text-muted">Файл отсюда не передать — такой запуск только в самом Jenkins.</p>
      ) : (
        <input id={id} value={String(value)} onChange={e => onChange(e.target.value)} className={`${INPUT} font-mono text-[13px]`} />
      )}
      {note}
    </div>
  );
}

function RunNote({ run }: { run: JenkinsQueue }) {
  const box = "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm";
  if (run.state === "started") {
    return (
      <p className={`${box} border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300`}>
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Запущена сборка
        <a href={run.url} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold hover:underline">#{run.number} ↗</a>
      </p>
    );
  }
  if (run.state === "cancelled") {
    return <p className={`${box} border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40`}><XCircle className="h-4 w-4 flex-shrink-0" /> Запуск отменён в очереди Jenkins.</p>;
  }
  const text = run.state === "queued" ? `В очереди Jenkins${run.why ? `: ${run.why}` : "…"}`
    : run.state === "slow" ? "Всё ещё в очереди Jenkins — дальше следите в самом Jenkins."
    : "Jenkins принял запуск — сборка появится в списке ниже.";
  return (
    <p className={`${box} border-border-main bg-bg-subtle text-text-main`}>
      {run.state === "queued" && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />} {text}
    </p>
  );
}
