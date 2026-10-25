"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, Eye, History, Loader2, Plus, Send, Settings2, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import NotionRenderer from "@/components/NotionRenderer";
import IncidentGenSettings from "@/components/incidents/IncidentGenSettings";
import { BTN, BTN_PRIMARY, INPUT } from "@/components/incidents/ui";
import {
  clearIncHistory, getIncCatalog, getIncHistory, getIncState, previewIncRows, sendIncRows,
  type IncCatalog, type IncPreviewItem, type IncPriority, type IncResult, type IncRow, type IncRun, type IncState,
} from "@/lib/incidentGenApi";

const ROWS_KEY = "st_incident_rows";   // строки формы — черновик одного браузера
const PRIORITY: Record<IncPriority, string> = { LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", CRITICAL: "Критический" };
const GRID = "grid grid-cols-[28px_minmax(0,2fr)_minmax(0,1fr)_150px_64px] items-center gap-2";

/** Результат отправки: по каждому инциденту — номер, сценарий, смещение в Kafka или ошибка, инструкция. */
function ResultTable({ results }: { results: IncResult[] }) {
  const [copied, setCopied] = useState(false);
  const ok = results.filter(r => !r.error);
  const copy = async () => {
    try { await navigator.clipboard.writeText(ok.map(r => r.inc).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* браузер не дал доступ к буферу */ }
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className="text-green-700 dark:text-green-400">Отправлено: {ok.length}</span>
        {results.length > ok.length && <span className="text-red-600 dark:text-red-400">Ошибок: {results.length - ok.length}</span>}
        <span className="flex-1" />
        {ok.length > 0 && <button type="button" className={BTN} onClick={() => void copy()}>
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />} Номера INC</button>}
      </div>
      <div className="max-h-[360px] overflow-auto scrollbar-thin rounded-lg border border-border-main">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
            <tr><th className="text-left px-3 py-2">Инцидент</th><th className="text-left px-3 py-2">КЭ</th>
              <th className="text-left px-3 py-2">Kafka</th><th className="text-left px-3 py-2">Инструкция</th></tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-border-main align-top">
                <td className="px-3 py-1.5"><span className="font-mono text-xs text-primary">{r.inc}</span>
                  <span className="block text-xs text-text-muted truncate max-w-[380px]" title={r.title}>{r.title}</span></td>
                <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{r.ci}</td>
                <td className="px-3 py-1.5 text-xs">{r.error ? <span className="text-red-600 dark:text-red-400">{r.error}</span>
                  : <span className="text-text-muted">p{r.partition} · offset {r.offset}</span>}</td>
                <td className="px-3 py-1.5 text-xs">{!r.hasInstruction ? <span className="text-text-muted">—</span>
                  : r.instruction_id ? <span className="text-green-700 dark:text-green-400">id {r.instruction_id}</span>
                  : <span className="text-amber-700 dark:text-amber-300">{r.instruction_error || "не записана"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Что уйдёт: заголовок, текст описания, инструкция и JSON сообщения. */
function PreviewList({ items }: { items: IncPreviewItem[] }) {
  return (
    <div className="max-h-[70vh] overflow-y-auto scrollbar-thin space-y-3 pr-1">
      <p className="text-xs text-text-muted">Пример: при отправке сценарий выберется заново случайно, время — момент отправки.</p>
      {items.map((it, i) => (
        <details key={i} className="rounded-lg border border-border-main" open={items.length === 1 || i === 0}>
          <summary className="cursor-pointer px-3 py-2 text-sm">
            <span className="font-mono text-xs text-primary">{it.ci}</span> · {String(it.message.title)}
            <span className="text-text-muted"> · {String(it.message.priorityCode)}</span>
          </summary>
          <pre className="mx-3 mb-2 whitespace-pre-wrap rounded-lg bg-bg-subtle p-3 text-xs leading-relaxed font-sans">{String(it.message.description)}</pre>
          {it.instruction && <div className="border-t border-border-main px-3 py-2"><p className="text-xs font-semibold text-text-muted mb-1">Инструкция</p><NotionRenderer text={it.instruction} /></div>}
          <details className="border-t border-border-main px-3 py-2">
            <summary className="cursor-pointer text-xs text-text-muted">Сообщение Sber ESM (JSON)</summary>
            <pre className="mt-2 text-[11px] leading-relaxed overflow-x-auto">{JSON.stringify(it.message, null, 2)}</pre>
          </details>
        </details>
      ))}
    </div>
  );
}

/**
 * Генератор инцидентов: «+ Инцидент» — строка (КЭ, приоритет, с инструкцией или без), «Отправить» — каждый инцидент
 * сообщением Sber ESM в Kafka. Сценарий текста (один хост, несколько, все узлы, хост не определён, обращение, алерт
 * Рефлекса — около 20) выбирается случайно, время — момент отправки. Подключение и SQL инструкций — «Настройки».
 */
export default function IncidentGenSection() {
  const [cat, setCat] = useState<IncCatalog | null>(null);
  const [st, setSt] = useState<IncState | null>(null);
  const [rows, setRowsState] = useState<IncRow[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [preview, setPreview] = useState<IncPreviewItem[] | null>(null);
  const [run, setRun] = useState<IncRun | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<IncRun[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const setRows = (next: IncRow[] | ((r: IncRow[]) => IncRow[])) => setRowsState(prev => {
    const v = typeof next === "function" ? next(prev) : next;
    try { localStorage.setItem(ROWS_KEY, JSON.stringify(v)); } catch { /* приватный режим */ }
    return v;
  });
  const load = useCallback(() => {
    getIncState().then(setSt, e => setErr((e as Error).message));
    getIncCatalog().then(c => {
      setCat(c);
      let saved: IncRow[] = [];
      try { saved = JSON.parse(localStorage.getItem(ROWS_KEY) || "[]"); } catch { /* черновика нет */ }
      const known = new Set(c.services.map(s => s.ci));
      saved = saved.filter(r => known.has(r.ci)).map(r => ({ ci: r.ci, priority: r.priority ?? "MEDIUM", instruction: !!r.instruction }));
      setRowsState(saved.length ? saved : [{ ci: c.services[0].ci, priority: "MEDIUM", instruction: false }]);
    }, e => setErr((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (historyOpen) getIncHistory().then(r => setHistory(r.history), e => setErr((e as Error).message)); }, [historyOpen]);

  const patch = (i: number, p: Partial<IncRow>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  /** Новая строка — копия последней (обычно шлют пачку на одну услугу), первая — на первую услугу. */
  const add = () => setRows(rs => [...rs, rs.length ? { ...rs[rs.length - 1] } : { ci: cat!.services[0].ci, priority: "MEDIUM", instruction: false }]);

  const doPreview = async (list: IncRow[]) => {
    setBusy("preview"); setErr("");
    try { setPreview((await previewIncRows(list)).items); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const doSend = async () => {
    if (!confirm(`Зарегистрировать в Sber911 инцидентов: ${rows.length} через топик ${st?.settings.topic}?`)) return;
    setBusy("send"); setErr(""); setRun(null);
    try { setRun(await sendIncRows(rows)); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };

  if (!cat || !st) return (
    <div className="flex items-center justify-center h-full">
      {err ? <p className="text-sm text-red-600">{err}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" />}
    </div>
  );
  const wantInstr = rows.some(r => r.instruction);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2">
          <p className="text-sm text-text-muted">Каждый инцидент — со случайным сценарием из {cat.scenarios} и временем отправки. Регистрируются по-настоящему
            (топик <code className="font-mono">{st.settings.topic}</code>).</p>
          <span className="flex-1" />
          <button type="button" className={BTN} onClick={() => setHistoryOpen(true)}><History className="w-4 h-4" /> История</button>
          <button type="button" className={BTN} onClick={() => setSettingsOpen(true)}><Settings2 className="w-4 h-4" /> Настройки</button>
        </div>
        {err && <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}</p>}

        <section className="rounded-xl border border-border-main bg-bg-card">
          <div className={`${GRID} border-b border-border-main px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted`}>
            <span>#</span><span>КЭ</span><span>Приоритет</span><span>Инструкция</span><span />
          </div>
          {!rows.length && <p className="px-3 py-4 text-sm text-text-muted">Нажмите «+ Инцидент».</p>}
          {rows.map((r, i) => (
            <div key={i} className={`${GRID} border-b border-border-main px-3 py-2 last:border-b-0`}>
              <span className="text-xs text-text-muted">{i + 1}</span>
              <select value={r.ci} onChange={e => patch(i, { ci: e.target.value })} aria-label={`КЭ, инцидент ${i + 1}`} className={INPUT}>
                {cat.services.map(s => <option key={s.ci} value={s.ci}>{s.ci} · {s.name}</option>)}
              </select>
              <select value={r.priority} onChange={e => patch(i, { priority: e.target.value as IncPriority })} aria-label={`Приоритет, инцидент ${i + 1}`} className={INPUT}>
                {cat.priorities.map(p => <option key={p} value={p}>{PRIORITY[p]}</option>)}
              </select>
              <label className="inline-flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
                <input type="checkbox" checked={r.instruction} onChange={e => patch(i, { instruction: e.target.checked })} />
                {r.instruction ? "с инструкцией" : "без инструкции"}
              </label>
              <span className="flex justify-end gap-0.5">
                <button type="button" title="Пример того, что уйдёт" aria-label={`Пример, инцидент ${i + 1}`} onClick={() => void doPreview([r])}
                  className="p-1.5 rounded text-text-muted hover:bg-bg-subtle hover:text-text-main"><Eye className="w-4 h-4" /></button>
                <button type="button" title="Убрать" aria-label={`Убрать инцидент ${i + 1}`} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                  className="p-1.5 rounded text-text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"><Trash2 className="w-4 h-4" /></button>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-main px-3 py-2.5">
            <button type="button" className={BTN} onClick={add}><Plus className="w-4 h-4" /> Инцидент</button>
            {wantInstr && st.instructionsBlocked && (
              <span className="text-xs text-amber-700 dark:text-amber-300">Инструкции не запишутся: {st.instructionsBlocked} — задать в «Настройках».</span>
            )}
            <span className="flex-1" />
            <button type="button" className={BTN} disabled={!rows.length || !!busy} onClick={() => void doPreview(rows)}>
              {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Пример</button>
            <button type="button" className={BTN_PRIMARY} disabled={!rows.length || !!busy} onClick={() => void doSend()}>
              {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {busy === "send" ? "Отправляю…" : `Отправить (${rows.length})`}</button>
          </div>
        </section>

        {run && (
          <section className="rounded-xl border border-border-main bg-bg-card p-4">
            <h3 className="text-sm font-semibold text-text-main mb-3">Результат отправки</h3>
            <ResultTable results={run.results} />
          </section>
        )}
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Пример · ${preview?.length ?? 0}`} size="max-w-4xl">
        {preview && <PreviewList items={preview} />}
      </Modal>
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Генератор инцидентов — настройки" size="max-w-3xl">
        <div className="max-h-[75vh] overflow-y-auto scrollbar-thin pr-1">
          <IncidentGenSettings initial={st.settings} onSaved={(settings, instructionsBlocked) => setSt({ ...st, settings, instructionsBlocked })} />
        </div>
      </Modal>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="История отправок" size="max-w-4xl">
        <div className="max-h-[75vh] overflow-y-auto scrollbar-thin space-y-2 pr-1">
          {history === null ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : !history.length ? <p className="text-sm text-text-muted">Отправок ещё не было.</p> : (
            <>
              <div className="flex justify-end">
                <button type="button" className={`${BTN} text-red-500`}
                  onClick={() => { if (confirm("Очистить историю отправок? Инциденты в Sber911 останутся.")) void clearIncHistory().then(r => setHistory(r.history)); }}>
                  <Trash2 className="w-4 h-4" /> Очистить</button>
              </div>
              {history.map(h => {
                const ok = h.results.filter(r => !r.error).length;
                return (
                  <div key={h.id} className="rounded-xl border border-border-main p-3">
                    <button type="button" onClick={() => setOpenRun(o => (o === h.id ? null : h.id))} aria-expanded={openRun === h.id}
                      className="w-full flex items-center gap-3 text-left text-sm">
                      <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${openRun === h.id ? "rotate-90" : ""}`} />
                      <span>{new Date(h.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
                      <span className="text-text-muted truncate">· {h.cis.join(", ")}</span>
                      <span className="flex-1" />
                      <span className="text-green-700 dark:text-green-400">{ok}</span>
                      {ok < h.results.length && <span className="text-red-600 dark:text-red-400">· ошибок {h.results.length - ok}</span>}
                    </button>
                    {openRun === h.id && <div className="mt-3"><ResultTable results={h.results} /></div>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
