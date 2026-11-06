"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, FileText, Loader2 } from "lucide-react";
import { fmtDur, statusOf } from "@/components/aqa/widgets";
import { getAqaAttachment, getAqaResult, type AqaAttachment, type AqaAttachmentContent, type AqaResultDetails, type AqaStep } from "@/lib/aqaApi";

const PRE = "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-subtle p-2.5 font-mono text-[11px] leading-relaxed text-text-main scrollbar-thin";
const H = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/** Описание в TestOps бывает только в HTML: показываем текст. */
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").trim();
/** Сформатированный JSON читается легче; не JSON — как есть. */
function pretty(a: AqaAttachmentContent): string {
  if (!a.contentType.includes("json")) return a.text;
  try { return JSON.stringify(JSON.parse(a.text), null, 2); } catch { return a.text; }
}
const hasFailed = (s: AqaStep): boolean => s.failed || s.steps.some(hasFailed);

/** Вложение: запрос, ответ, лог. Текст грузится по щелчку; HTML (отчёт Rest Assured) — в песочнице без скриптов. */
function Attachment({ a, autoOpen }: { a: AqaAttachment; autoOpen?: boolean }) {
  const [open, setOpen] = useState(!!autoOpen);
  const [data, setData] = useState<AqaAttachmentContent | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (open && !data && !err) getAqaAttachment(a.id).then(setData, e => setErr((e as Error).message));
  }, [open, data, err, a.id]);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1 rounded border border-border-main px-1.5 py-0.5 text-[11px] text-text-main hover:bg-bg-subtle">
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} /><FileText className="h-3 w-3 text-text-muted" /> {a.name}
      </button>
      {open && (err ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{err}</p>
        : !data ? <p className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Загружаю…</p>
        : data.binary ? <p className="mt-1 text-[11px] text-text-muted">Файл «{data.contentType || "неизвестный тип"}» здесь не показать — откройте его в TestOps.</p>
        : data.contentType.includes("html") ? <iframe title={a.name} sandbox="" srcDoc={data.text} className="mt-1 h-80 w-full rounded-md border border-border-main bg-white" />
        : (
          <>
            <pre className={`mt-1 ${PRE}`}>{pretty(data)}</pre>
            {data.truncated && <p className="mt-0.5 text-[11px] text-text-muted">Показано начало: вложение слишком большое, целиком — в TestOps.</p>}
          </>
        ))}
    </div>
  );
}

function Step({ s, depth, nearFailure }: { s: AqaStep; depth: number; nearFailure?: boolean }) {
  const onPath = hasFailed(s);
  const hasBody = s.steps.length > 0 || s.attachments.length > 0 || s.parameters.length > 0 || !!s.message || !!s.trace;
  // Путь к упавшему шагу и его соседи раскрыты сразу: запрос и ответ лежат рядом с проверкой, которая упала.
  const [open, setOpen] = useState(onPath || !!nearFailure);
  const st = statusOf(s.status || "unknown");
  return (
    <li>
      <button type="button" onClick={() => hasBody && setOpen(o => !o)} aria-expanded={hasBody ? open : undefined}
        style={{ paddingLeft: depth * 16 + 6 }}
        className={`flex w-full items-start gap-1.5 rounded py-1 pr-2 text-left text-xs ${s.failed ? "bg-red-50 font-semibold dark:bg-red-950/40" : hasBody ? "hover:bg-bg-subtle" : "cursor-default"}`}>
        <ChevronRight className={`mt-0.5 h-3 w-3 flex-shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""} ${hasBody ? "" : "invisible"}`} />
        <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${st.cls}`} title={st.label} />
        <span className="min-w-0 flex-1 break-words text-text-main">{s.name || "Шаг без названия"}</span>
        {s.failed && <span className="flex-shrink-0 rounded bg-red-600 px-1.5 text-[10px] font-semibold text-white">упало здесь</span>}
        {s.duration > 0 && <span className="flex-shrink-0 tabular-nums text-text-muted">{fmtDur(s.duration)}</span>}
      </button>
      {open && hasBody && (
        <div style={{ paddingLeft: depth * 16 + 25 }} className="pb-1 pr-2">
          {s.parameters.length > 0 && <p className="text-[11px] text-text-muted">{s.parameters.join(" · ")}</p>}
          {s.message && <pre className={`mt-1 ${PRE}`}>{s.message}</pre>}
          {s.trace && (
            <details className="mt-1 text-[11px] text-text-muted"><summary className="cursor-pointer">Стек ошибки</summary><pre className={`mt-1 ${PRE}`}>{s.trace}</pre></details>
          )}
          {s.attachments.map(a => <Attachment key={a.id} a={a} autoOpen={s.failed} />)}
        </div>
      )}
      {open && s.steps.length > 0 && <ul>{s.steps.map((c, i) => <Step key={i} s={c} depth={depth + 1} nearFailure={onPath} />)}</ul>}
    </li>
  );
}

/** Результат кейса: описание, на каком шаге упало, ошибка, параметры, шаги с вложениями (запрос и ответ). */
export default function TestResultDetail({ id }: { id: number }) {
  const [data, setData] = useState<AqaResultDetails | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    getAqaResult(id).then(d => { if (alive) setData(d); }, e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [id]);

  if (err) return <p className="p-3 text-xs text-red-600 dark:text-red-400">{err}</p>;
  if (!data) return <p className="flex items-center gap-2 p-3 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю кейс из TestOps…</p>;
  const description = data.description || plain(data.descriptionHtml);
  const b = [data.behavior.epic, data.behavior.feature, data.behavior.story].filter(Boolean);
  return (
    <div className="space-y-3 bg-bg-subtle/40 p-3">
      {b.length > 0 && <p className="text-[11px] text-text-muted">{b.join(" › ")}</p>}
      {data.failedStep && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> Упало на шаге: {data.failedStep}</p>
      )}
      {description && <section><h5 className={H}>Описание</h5><p className="whitespace-pre-wrap break-words text-xs text-text-main">{description}</p></section>}
      {(data.message || data.trace) && (
        <section>
          <h5 className={H}>Ошибка</h5>
          {data.message && <pre className={PRE}>{data.message}</pre>}
          {data.trace && <details className="mt-1 text-[11px] text-text-muted"><summary className="cursor-pointer">Стек ошибки</summary><pre className={`mt-1 ${PRE}`}>{data.trace}</pre></details>}
        </section>
      )}
      {data.parameters.length > 0 && <section><h5 className={H}>Параметры</h5><p className="text-xs text-text-main">{data.parameters.join(" · ")}</p></section>}
      <section>
        <h5 className={H}>Шаги</h5>
        {data.steps.length > 0 ? <ul>{data.steps.map((s, i) => <Step key={i} s={s} depth={0} />)}</ul>
          : <p className="text-xs text-amber-700 dark:text-amber-400">{data.stepsNote || "Шагов нет"}</p>}
      </section>
      {data.attachments.length > 0 && <section><h5 className={H}>Вложения кейса</h5>{data.attachments.map(a => <Attachment key={a.id} a={a} />)}</section>}
    </div>
  );
}
