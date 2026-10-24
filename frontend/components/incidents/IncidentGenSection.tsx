"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, Check, ChevronRight, Copy, Eye, History, Loader2, Save, Send, Settings2,
  Trash2, Upload, X,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import NotionRenderer from "@/components/NotionRenderer";
import IncidentGenSettings from "@/components/incidents/IncidentGenSettings";
import IncidentLibrary from "@/components/incidents/IncidentLibrary";
import { BTN, BTN_PRIMARY, INPUT } from "@/components/incidents/ui";
import {
  clearIncHistory, DEFAULT_SPEC, deleteIncPreset, getIncHistory, getIncState, getKeCatalog, importIncFile, parseKe,
  previewIncidents, saveIncPreset, sendIncidents,
  type IncCi, type IncPreviewItem, type IncResult, type IncRun, type IncSpec, type IncState,
} from "@/lib/incidentGenApi";

const LABEL = "block text-xs font-medium text-text-muted mb-1";
const CARD = "rounded-xl border border-border-main bg-bg-card p-4";
const SPEC_KEY = "st_incident_spec";   // черновик формы — удобство одного браузера

type Tab = "send" | "library" | "history" | "settings";

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-bg-subtle p-0.5" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded-md text-xs ${value === o.id ? "bg-bg-card text-text-main font-medium shadow-sm" : "text-text-muted hover:text-text-main"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Num({ label, value, onChange, min = 0, max, hint }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; hint?: string }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input type="number" min={min} max={max} value={value} title={hint}
        onChange={e => onChange(Math.max(min, Math.min(max ?? Infinity, Number(e.target.value) || 0)))} className={INPUT} />
    </label>
  );
}

/** Результат отправки: по каждому инциденту — номер, вид, смещение в Kafka или ошибка, инструкция. */
export function ResultTable({ results }: { results: IncResult[] }) {
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
      <div className="max-h-[420px] overflow-auto scrollbar-thin rounded-lg border border-border-main">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[11px] uppercase tracking-wide text-text-muted">
            <tr><th className="text-left px-3 py-2">CI</th><th className="text-left px-3 py-2">Инцидент</th><th className="text-left px-3 py-2">Вид</th>
              <th className="text-left px-3 py-2">Kafka</th><th className="text-left px-3 py-2">Инструкция</th></tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-border-main align-top">
                <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{r.ci}</td>
                <td className="px-3 py-1.5"><span className="font-mono text-xs text-primary">{r.inc}</span>
                  <span className="block text-xs text-text-muted truncate max-w-[320px]" title={r.title}>{r.title}</span></td>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap">{r.main ? "основной" : "доп."}</td>
                <td className="px-3 py-1.5 text-xs">{r.error
                  ? <span className="text-red-600 dark:text-red-400">{r.error}</span>
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

/** Поле CI: чипы, ввод с подсказками из справочника КЭ; вставка списком (через пробел, запятую, перенос). */
function CiPicker({ value, onChange, catalog }: { value: IncCi[]; onChange: (v: IncCi[]) => void; catalog: string[] }) {
  const [q, setQ] = useState("");
  const add = (raw: string) => {
    const found: IncCi[] = [];
    for (const part of raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)) {
      const fromCat = catalog.find(k => k === part);
      const parsed = parseKe(fromCat ?? part);
      if (parsed) found.push(parsed);
      else for (const code of part.match(/CI\d{5,}/gi) ?? []) found.push({ code: code.toUpperCase(), name: "" });
    }
    const have = new Set(value.map(c => c.code));
    const next = [...value, ...found.filter(c => !have.has(c.code) && (have.add(c.code), true))];
    if (next.length !== value.length) onChange(next);
    setQ("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map(c => (
          <span key={c.code} className="inline-flex items-center gap-1 rounded-full border border-border-main bg-bg-subtle px-2 py-0.5 text-xs">
            <span className="font-mono">{c.code}</span>{c.name && <span className="text-text-muted">· {c.name}</span>}
            <button type="button" aria-label={`Убрать ${c.code}`} onClick={() => onChange(value.filter(x => x.code !== c.code))}
              className="text-text-muted hover:text-red-500"><X className="w-3 h-3" /></button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-text-muted">CI не выбраны</span>}
      </div>
      <input value={q} list="inc-ke-catalog" onChange={e => { const v = e.target.value; if (catalog.includes(v)) add(v); else setQ(v); }}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(q); } }}
        onPaste={e => { const t = e.clipboardData.getData("text"); if (/[\n,;]/.test(t)) { e.preventDefault(); add(t); } }}
        placeholder="CI00233293 или название КЭ из справочника, Enter" aria-label="Добавить CI" className={INPUT} />
      <datalist id="inc-ke-catalog">{catalog.map(k => <option key={k} value={k} />)}</datalist>
    </div>
  );
}

const PH_HINT = "{ci} — код КЭ, {system} — название, {n} — номер в отправке, {inc} — номер инцидента, {now} — дата и время";

/**
 * Генератор инцидентов: тестовые инциденты в Sber911 сообщением Sber ESM в Kafka. На каждый CI — основные
 * и дополнительные инциденты, описание шаблоном или из библиотеки, инструкция к основным (если задан SQL-шаблон).
 */
export default function IncidentGenSection() {
  const [st, setSt] = useState<IncState | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("send");
  const [spec, setSpecState] = useState<IncSpec>(DEFAULT_SPEC);
  const [preset, setPreset] = useState("");
  const [presetName, setPresetName] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ total: number; main: number; items: IncPreviewItem[] } | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [run, setRun] = useState<IncRun | null>(null);
  const [history, setHistory] = useState<IncRun[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const setSpec = (patch: Partial<IncSpec>) => setSpecState(s => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(SPEC_KEY, JSON.stringify(next)); } catch { /* приватный режим */ }
    return next;
  });
  const load = useCallback(() => getIncState().then(setSt, e => setErr((e as Error).message)), []);
  useEffect(() => {
    void load();
    getKeCatalog().then(r => setCatalog(r.ke), () => undefined);
    try { const s = localStorage.getItem(SPEC_KEY); if (s) setSpecState({ ...DEFAULT_SPEC, ...JSON.parse(s) }); } catch { /* черновика нет */ }
  }, [load]);
  useEffect(() => { if (tab === "history") getIncHistory().then(r => setHistory(r.history), e => setErr((e as Error).message)); }, [tab]);

  const counts = useMemo(() => {
    const n = spec.cis.length;
    return { main: n * spec.main_count, extraMin: n * spec.extra_min, extraMax: n * Math.max(spec.extra_min, spec.extra_max) };
  }, [spec]);
  const nothing = !spec.cis.length || counts.main + counts.extraMax === 0;

  const doPreview = async () => {
    setBusy("preview"); setErr("");
    try { setPreview(await previewIncidents(spec)); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const doSend = async () => {
    const total = counts.main + (counts.extraMax ? ` + ${counts.extraMin}–${counts.extraMax} доп.` : "");
    if (!confirm(`Зарегистрировать в Sber911 инциденты: ${total} через топик ${st?.settings.topic}?`)) return;
    setBusy("send"); setErr(""); setRun(null);
    try { setRun(await sendIncidents(spec, preset)); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const onImport = async (f: File | undefined) => {
    if (!f) return;
    setErr(""); setNote("");
    try {
      const r = await importIncFile(f);
      setNote(r.kind === "library" ? `В библиотеку добавлено примеров: ${r.added}` : r.kind === "presets" ? `Добавлено пресетов: ${r.added}` : "SQL-шаблон инструкции сохранён в настройках");
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  if (!st) return (
    <div className="flex items-center justify-center h-full">
      {err ? <p className="text-sm text-red-600">{err}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" />}
    </div>
  );

  const tabs: { id: Tab; label: string; Icon: typeof Send }[] = [
    { id: "send", label: "Отправка", Icon: Send },
    { id: "library", label: `Библиотека · ${st.library.length}`, Icon: BookOpen },
    { id: "history", label: "История", Icon: History },
    { id: "settings", label: "Настройки", Icon: Settings2 },
  ];

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-bg-muted rounded-xl p-1">
            {tabs.map(t => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t.id ? "bg-bg-card text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}>
                <t.Icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e => { void onImport(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className={BTN} onClick={() => fileRef.current?.click()}
            title="incident_instruction_examples.json — в библиотеку, test_sc.json — в пресеты, test_sql_templates.json — SQL инструкции">
            <Upload className="w-4 h-4" /> Импорт
          </button>
        </div>
        {err && <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}</p>}
        {note && <p className="text-sm text-green-700 dark:text-green-400">{note}</p>}

        {tab === "send" && (
          <>
            <div className="tone-warning border rounded-xl px-4 py-3 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>Инциденты регистрируются по-настоящему: сообщение Sber ESM уходит в топик <code className="font-mono">{st.settings.topic}</code>.
                Проверьте подключение во вкладке «Настройки».</p>
            </div>

            {/* Пресеты */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={preset} aria-label="Пресет" className={INPUT.replace("w-full", "w-80")}
                onChange={e => { const p = st.presets.find(x => x.name === e.target.value); setPreset(e.target.value); if (p) setSpec({ ...DEFAULT_SPEC, ...p.spec }); }}>
                <option value="">— пресет не выбран —</option>
                {st.presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
              {presetName === null ? (
                <button type="button" className={BTN} onClick={() => setPresetName(preset)}><Save className="w-4 h-4" /> Сохранить как пресет</button>
              ) : (
                <>
                  <input autoFocus value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Название пресета" aria-label="Название пресета"
                    className={INPUT.replace("w-full", "w-56")} onKeyDown={e => { if (e.key === "Escape") setPresetName(null); }} />
                  <button type="button" className={BTN_PRIMARY} disabled={!presetName.trim()}
                    onClick={() => void saveIncPreset(presetName.trim(), spec).then(r => { setSt({ ...st, presets: r.presets }); setPreset(presetName.trim()); setPresetName(null); }, e => setErr((e as Error).message))}>
                    <Check className="w-4 h-4" /> Сохранить</button>
                  <button type="button" className={BTN} onClick={() => setPresetName(null)}><X className="w-4 h-4" /></button>
                </>
              )}
              {preset && presetName === null && (
                <button type="button" className={`${BTN} text-red-500`} title="Удалить пресет"
                  onClick={() => { const p = st.presets.find(x => x.name === preset); if (p && confirm(`Удалить пресет «${p.name}»?`)) void deleteIncPreset(p.id).then(r => { setSt({ ...st, presets: r.presets }); setPreset(""); }); }}>
                  <Trash2 className="w-4 h-4" /></button>
              )}
            </div>

            <section className={CARD}>
              <h3 className="text-sm font-semibold text-text-main mb-3">КЭ (CI), по которым регистрировать</h3>
              <CiPicker value={spec.cis} onChange={cis => setSpec({ cis })} catalog={catalog} />
            </section>

            <section className={CARD}>
              <h3 className="text-sm font-semibold text-text-main mb-3">Количество на каждый CI</h3>
              <div className="grid grid-cols-4 gap-3">
                <Num label="Основных" value={spec.main_count} max={50} onChange={v => setSpec({ main_count: v })} />
                <Num label="Доп. от" value={spec.extra_min} max={20} onChange={v => setSpec({ extra_min: v, extra_max: Math.max(v, spec.extra_max) })} />
                <Num label="Доп. до" value={spec.extra_max} max={20} onChange={v => setSpec({ extra_max: v, extra_min: Math.min(v, spec.extra_min) })} />
                <Num label="Доп. раньше на, мин" value={spec.extra_spread_min} max={1440} onChange={v => setSpec({ extra_spread_min: v })}
                  hint="Дополнительные инциденты — «раньше» основных на случайное число минут от 1 до этого значения" />
              </div>
              <p className="mt-2 text-xs text-text-muted">Дополнительные — другие инциденты на той же ИТ-услуге: их число случайно в пределах «от–до», инструкций у них нет.</p>
            </section>

            <section className={CARD}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-semibold text-text-main">Описание</h3>
                <Segmented label="Источник описания" value={spec.description_mode} onChange={v => setSpec({ description_mode: v })}
                  options={[{ id: "template", label: "Шаблон" }, { id: "library", label: `Из библиотеки (${st.library.length})` }]} />
              </div>
              {spec.description_mode === "template" ? (
                <>
                  <textarea value={spec.description} onChange={e => setSpec({ description: e.target.value })} rows={4} aria-label="Шаблон описания"
                    className={`${INPUT} resize-y font-mono text-[13px]`} />
                  <p className="mt-1 text-xs text-text-muted">{PH_HINT}</p>
                </>
              ) : (
                <p className="text-sm text-text-muted">Каждому инциденту — случайный пример из библиотеки{!st.library.length && " (сейчас пусто — импортируйте incident_instruction_examples.json)"}.</p>
              )}
              <label className="block mt-3">
                <span className={LABEL}>Заголовок (шаблон; пусто — начало описания, до 255 символов)</span>
                <input value={spec.title} onChange={e => setSpec({ title: e.target.value })} className={INPUT} placeholder="ТЕСТОВЫЙ ИНЦИДЕНТ #kafka {ci}" />
              </label>
            </section>

            <section className={CARD}>
              <h3 className="text-sm font-semibold text-text-main mb-3">Поля инцидента</h3>
              <div className="grid grid-cols-4 gap-3">
                {([["inc_type", "Тип (incType)", ["AVAILABILITY_INC"]], ["priority", "Приоритет", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]],
                   ["state", "Статус", ["REGISTERED"]], ["creation_type", "Способ создания", ["MONITORING_SYSTEM"]]] as const).map(([k, label, opts]) => (
                  <label key={k} className="block">
                    <span className={LABEL}>{label}</span>
                    <input value={spec[k]} list={`inc-${k}`} onChange={e => setSpec({ [k]: e.target.value } as Partial<IncSpec>)} className={`${INPUT} font-mono text-xs`} />
                    <datalist id={`inc-${k}`}>{opts.map(o => <option key={o} value={o} />)}</datalist>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {([["potential_vpi", "Потенциальный ВПИ"], ["large_scale", "Массовый"], ["impact_custom_service", "Влияет на клиентский сервис"]] as const).map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={spec[k]} onChange={e => setSpec({ [k]: e.target.checked } as Partial<IncSpec>)} /> {label}
                  </label>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-3">
                <Num label="Создан, мин назад" value={spec.created_ago_min} onChange={v => setSpec({ created_ago_min: v })} />
                <Num label="Начало, мин назад" value={spec.start_ago_min} onChange={v => setSpec({ start_ago_min: v })} />
                <Num label="Факт. начало, мин назад" value={spec.fact_start_ago_min} onChange={v => setSpec({ fact_start_ago_min: v })} />
                <Num label="Срок, дней вперёд" value={spec.target_days} max={365} onChange={v => setSpec({ target_days: v })} />
              </div>
            </section>

            <section className={CARD}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-semibold text-text-main">Инструкция к основным инцидентам</h3>
                <Segmented label="Инструкция" value={spec.instruction_mode} onChange={v => setSpec({ instruction_mode: v })}
                  options={[{ id: "none", label: "Нет" }, { id: "library", label: "Из библиотеки" }, { id: "text", label: "Свой текст" }]} />
              </div>
              {spec.instruction_mode !== "none" && st.instructionsBlocked && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">Инциденты уйдут без инструкций: {st.instructionsBlocked}. Задать — во вкладке «Настройки» или импортом test_sql_templates.json.</p>
              )}
              {spec.instruction_mode === "library" && <p className="text-sm text-text-muted">Инструкция — из того же примера, что и описание (если описание шаблоном — из случайного примера).</p>}
              {spec.instruction_mode === "text" && (
                <>
                  <textarea value={spec.instruction} onChange={e => setSpec({ instruction: e.target.value })} rows={6} aria-label="Текст инструкции (Markdown)"
                    placeholder={"# Найденные варианты\n## Вариант 1\n…"} className={`${INPUT} resize-y font-mono text-[13px]`} />
                  <p className="mt-1 text-xs text-text-muted">Markdown. {PH_HINT}</p>
                </>
              )}
              {spec.instruction_mode === "none" && <p className="text-sm text-text-muted">Инструкции не создаются.</p>}
            </section>

            <div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 bg-bg-main/90 backdrop-blur border-t border-border-main flex items-center gap-3">
              <p className="text-sm text-text-main">
                Будет: <b>{counts.main}</b> основных{counts.extraMax > 0 && <> + <b>{counts.extraMin === counts.extraMax ? counts.extraMin : `${counts.extraMin}–${counts.extraMax}`}</b> доп.</>}
                <span className="text-text-muted"> · CI: {spec.cis.length}</span>
              </p>
              <span className="flex-1" />
              <button type="button" className={BTN} disabled={nothing || !!busy} onClick={() => void doPreview()}>
                {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Предпросмотр</button>
              <button type="button" className={BTN_PRIMARY} disabled={nothing || !!busy} onClick={() => void doSend()}>
                {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {busy === "send" ? "Отправляю…" : "Отправить"}</button>
            </div>

            {run && (
              <section className={CARD}>
                <h3 className="text-sm font-semibold text-text-main mb-3">Результат отправки</h3>
                <ResultTable results={run.results} />
              </section>
            )}
          </>
        )}

        {tab === "library" && <IncidentLibrary library={st.library} onChange={library => setSt({ ...st, library })} onError={setErr} />}

        {tab === "history" && (
          <section className="space-y-2">
            <div className="flex items-center">
              <p className="text-sm text-text-muted">Последние {history?.length ?? 0} отправок</p>
              <span className="flex-1" />
              {!!history?.length && <button type="button" className={`${BTN} text-red-500`}
                onClick={() => { if (confirm("Очистить историю отправок? Инциденты в Sber911 останутся.")) void clearIncHistory().then(r => setHistory(r.history)); }}>
                <Trash2 className="w-4 h-4" /> Очистить</button>}
            </div>
            {history === null ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : !history.length ? <p className="text-sm text-text-muted">Отправок ещё не было.</p> : history.map(h => {
              const ok = h.results.filter(r => !r.error).length;
              return (
                <div key={h.id} className={CARD}>
                  <button type="button" onClick={() => setOpenRun(o => (o === h.id ? null : h.id))} aria-expanded={openRun === h.id}
                    className="w-full flex items-center gap-3 text-left text-sm">
                    <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${openRun === h.id ? "rotate-90" : ""}`} />
                    <span className="text-text-main">{new Date(h.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
                    {h.preset && <span className="text-text-muted">· {h.preset}</span>}
                    <span className="text-text-muted truncate">· {h.cis.join(", ")}</span>
                    <span className="flex-1" />
                    <span className="text-green-700 dark:text-green-400">{ok}</span>
                    {ok < h.results.length && <span className="text-red-600 dark:text-red-400">· ошибок {h.results.length - ok}</span>}
                  </button>
                  {openRun === h.id && <div className="mt-3"><ResultTable results={h.results} /></div>}
                </div>
              );
            })}
          </section>
        )}

        {tab === "settings" && <IncidentGenSettings initial={st.settings} onSaved={(settings, instructionsBlocked) => setSt({ ...st, settings, instructionsBlocked })} />}
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Предпросмотр · ${preview?.total ?? 0} инцидентов`} size="max-w-4xl">
        {preview && (
          <div className="max-h-[70vh] overflow-y-auto scrollbar-thin space-y-3 pr-1">
            <p className="text-xs text-text-muted">Номера, время и случайные примеры при отправке будут другими. {preview.total > preview.items.length && `Показаны первые ${preview.items.length}.`}</p>
            {preview.items.map((it, i) => (
              <details key={i} className="rounded-lg border border-border-main" open={i === 0}>
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-primary">{String(it.message.businessId)}</span> · {it.ci} · {it.main ? "основной" : "доп."}
                  <span className="text-text-muted"> · {String(it.message.title).slice(0, 80)}</span>
                </summary>
                <pre className="px-3 pb-3 text-[11px] leading-relaxed overflow-x-auto">{JSON.stringify(it.message, null, 2)}</pre>
                {it.instruction && <div className="border-t border-border-main px-3 py-2"><p className="text-xs font-semibold text-text-muted mb-1">Инструкция</p><NotionRenderer text={it.instruction} /></div>}
              </details>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

