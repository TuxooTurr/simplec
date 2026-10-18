"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCheck, ChevronDown, ExternalLink, Loader2, PlayCircle, Plus, Rocket, Search, SlidersHorizontal, X } from "lucide-react";
import {
  DEFAULT_CRITERIA, createRun, findCritCases, getFieldValues, getRelease, saveResults,
  type CritCase, type CritCriteria, type CritStats, type ZRelease,
} from "@/lib/zephyrApi";
import Player from "./Player";

const CRIT_KEY = "st_zephyr_crit";

function readCriteria(): CritCriteria {
  try {
    const saved = JSON.parse(localStorage.getItem(CRIT_KEY) ?? "{}") as Partial<CritCriteria>;
    // Прежнее значение по умолчанию «КЭ» — у кейсов SBER911 КЭ лежит в поле «АС».
    if (saved.ke_field === "КЭ") delete saved.ke_field;
    return { ...DEFAULT_CRITERIA, ...saved };
  } catch { return DEFAULT_CRITERIA; }
}

const today = () => new Date().toLocaleDateString("ru-RU");
/** Имя поля без регистра, точек и пробелов — как сравнивает бэкенд («Крит. регресс» = «Крит регресс»). */
const norm = (n: string) => n.toLowerCase().replace(/[^0-9a-zа-яё]/g, "");
/** 1 кейс, 2 кейса, 5 кейсов. */
const cases_ = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "кейс" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "кейса" : "кейсов"}`;
const INPUT = "text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${done ? "bg-green-600 text-white" : "bg-primary/10 text-primary"}`}>{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Крит регресс релиза: номер релиза → его КЭ → кейсы с признаком «Крит регресс», статусом «Утверждено»,
 * типом «Регресс» и КЭ релиза → прогон, привязанный к задаче релиза (отслеживание) → прохождение
 * в плеере или кнопкой «Пройти все». С releaseKey — встроен в строку релиза: релиз загружается сам.
 */
export default function CritRegressView({ project, baseUrl, releaseKey, onRunCreated }: {
  project: string;
  baseUrl: string;
  releaseKey?: string;
  onRunCreated?: (key: string) => void;
}) {
  const embedded = !!releaseKey;
  const [relKey, setRelKey] = useState(releaseKey ?? "");
  const [rel, setRel] = useState<ZRelease | null>(null);
  const [relBusy, setRelBusy] = useState(false);
  const [relErr, setRelErr] = useState("");
  const [keOn, setKeOn] = useState<Set<string>>(new Set());
  const [extraKe, setExtraKe] = useState("");
  const [crit, setCrit] = useState<CritCriteria>(DEFAULT_CRITERIA);
  const [critOpen, setCritOpen] = useState(false);

  const [cases, setCases] = useState<CritCase[] | null>(null);
  const [stats, setStats] = useState<CritStats | null>(null);
  const [findBusy, setFindBusy] = useState(false);
  const [findErr, setFindErr] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const [runName, setRunName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [run, setRun] = useState<{ key: string; url: string; caseKeys: string[] } | null>(null);
  const [passAsk, setPassAsk] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [passNote, setPassNote] = useState("");
  const [player, setPlayer] = useState(false);
  const [passed, setPassed] = useState<Record<string, string>>({});

  const [values, setValues] = useState<{ statuses: string[]; fields: Record<string, string[]> } | null>(null);
  const [valuesErr, setValuesErr] = useState("");

  useEffect(() => setCrit(readCriteria()), []);
  const saveCrit = (c: CritCriteria) => { setCrit(c); try { localStorage.setItem(CRIT_KEY, JSON.stringify(c)); } catch { /* не запомнится */ } };
  useEffect(() => {
    if (!critOpen || values) return;
    getFieldValues(project).then(setValues).catch(e => setValuesErr((e as Error).message));
  }, [critOpen, values, project]);

  const loadRelease = async (keyArg?: string) => {
    const k = (keyArg ?? relKey).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(k)) { setRelErr("Номер релиза — в формате SBER911-12345"); return; }
    setRelBusy(true); setRelErr(""); setRel(null); setCases(null); setStats(null); setRun(null); setPassNote("");
    try {
      const r = await getRelease(k);
      setRel(r); setKeOn(new Set(r.ke.map(x => x.label)));
      setRunName(`Крит регресс ${r.key} · ${today()}`);
    } catch (e) { setRelErr((e as Error).message); }
    setRelBusy(false);
  };
  useEffect(() => { if (releaseKey) void loadRelease(releaseKey); }, [releaseKey]);

  const keList = rel ? [...rel.ke.map(x => x.label), ...[...keOn].filter(l => !rel.ke.some(x => x.label === l))] : [];
  const addKe = () => { const v = extraKe.trim(); if (v) { setKeOn(s => new Set(s).add(v)); setExtraKe(""); } };

  const find = async () => {
    setFindBusy(true); setFindErr(""); setCases(null); setStats(null); setRun(null);
    try {
      const r = await findCritCases(project, [...keOn], crit);
      setCases(r.cases); setStats(r.stats); setChosen(new Set(r.cases.map(c => c.key)));
    } catch (e) { setFindErr((e as Error).message); }
    setFindBusy(false);
  };

  const s = q.trim().toLowerCase();
  const shown = useMemo(() => (cases ?? []).filter(c => !s || c.name.toLowerCase().includes(s) || c.key.toLowerCase().includes(s)), [cases, s]);
  const allOn = !!cases?.length && cases.every(c => chosen.has(c.key));

  const create = async () => {
    if (!rel) return;
    setCreating(true); setCreateErr("");
    try {
      const keys = (cases ?? []).filter(c => chosen.has(c.key)).map(c => c.key);
      const r = await createRun({ project, name: runName.trim(), issueKey: rel.key, caseKeys: keys });
      setRun({ ...r, caseKeys: keys }); setConfirm(false); setPassed({}); onRunCreated?.(r.key);
    } catch (e) { setCreateErr((e as Error).message); }
    setCreating(false);
  };

  const passAll = async () => {
    if (!run) return;
    setPassBusy(true); setPassNote("");
    try {
      const r = await saveResults(run.key, run.caseKeys.map(k => ({ testCaseKey: k, status: "Pass" as const })));
      setPassed(Object.fromEntries(run.caseKeys.filter(k => !r.errors.some(e => e.testCaseKey === k)).map(k => [k, "Pass"])));
      setPassNote(r.errors.length ? `Pass проставлен: ${r.saved}; ошибки: ${r.errors.length} — ${r.errors[0].testCaseKey}: ${r.errors[0].error}` : `Pass проставлен: ${cases_(r.saved)}.`);
    } catch (e) { setPassNote(`Не сохранилось: ${(e as Error).message}`); }
    setPassBusy(false); setPassAsk(false);
  };

  /** Выпадающий список: варианты — из модели проекта; текущее значение остаётся в списке, даже если его там нет. */
  const select = (k: keyof CritCriteria, label: string, options: string[]) => {
    const opts = crit[k] && !options.includes(crit[k]) ? [crit[k], ...options] : options;
    return (
      <label className="block text-xs text-text-muted">
        {label}
        <select value={crit[k]} onChange={e => saveCrit({ ...crit, [k]: e.target.value })} className={`${INPUT} w-full mt-1`}>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  };
  const fieldNames = values ? Object.keys(values.fields) : [];
  const valuesOf = (f: string) => values?.fields[Object.keys(values.fields).find(n => norm(n) === norm(f)) ?? ""] ?? [];

  const keBlock = rel && (
<div className="space-y-2">
              <p className="text-xs text-text-muted">
                КЭ релиза{rel.keSources.length ? ` (поле: ${rel.keSources.join(", ")})` : ""} — снимите лишние или добавьте недостающие:
              </p>
              {rel.ke.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-300">В задаче релиза КЭ не найдены — добавьте их вручную ниже.</p>}
              <div className="flex flex-wrap gap-1.5">
                {keList.map(l => (
                  <label key={l} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs cursor-pointer select-none
                    ${keOn.has(l) ? "border-primary bg-primary/10 text-primary" : "border-border-main text-text-muted"}`}>
                    <input type="checkbox" className="sr-only" checked={keOn.has(l)}
                      onChange={() => setKeOn(o => { const n = new Set(o); if (n.has(l)) n.delete(l); else n.add(l); return n; })} />
                    {l}
                  </label>
                ))}
                <span className="flex items-center gap-1">
                  <input value={extraKe} onChange={e => setExtraKe(e.target.value)} onKeyDown={e => e.key === "Enter" && addKe()}
                    placeholder="+ КЭ или её id" aria-label="Добавить КЭ" className={`${INPUT} w-40 py-1 text-xs`} />
                  <button type="button" onClick={addKe} disabled={!extraKe.trim()} aria-label="Добавить КЭ" className="p-1 rounded text-text-muted hover:text-primary disabled:opacity-40"><Plus className="w-4 h-4" /></button>
                </span>
              </div>
            </div>
  );

  const body = (
      <div className={embedded ? "space-y-4" : "max-w-5xl mx-auto p-5 space-y-4"}>
        {!embedded && <Step n={1} title="Релиз" done={!!rel}>
          <div className="flex items-center gap-2">
            <input value={relKey} onChange={e => setRelKey(e.target.value)} onKeyDown={e => e.key === "Enter" && loadRelease()}
              placeholder="SBER911-12345" aria-label="Номер релиза" className={`${INPUT} w-48 font-mono`} />
            <button type="button" onClick={() => loadRelease()} disabled={relBusy || !relKey.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
              {relBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Загрузить</button>
            {rel && (
              <a href={rel.url} target="_blank" rel="noopener noreferrer" className="ml-2 min-w-0 flex items-center gap-1.5 text-sm text-text-main hover:text-primary">
                <span className="font-mono text-primary">{rel.key}</span><span className="truncate">{rel.summary}</span>
                {rel.status && <span className="text-xs text-text-muted">· {rel.status}</span>}<ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              </a>
            )}
          </div>
          {relErr && <p className="text-sm text-red-600 dark:text-red-400">{relErr}</p>}
          {keBlock}
        </Step>}
        {embedded && relErr && <p className="text-sm text-red-600 dark:text-red-400">{relErr}</p>}
        {embedded && relBusy && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю релиз…</p>}

        {rel && (
          <Step n={embedded ? 1 : 2} title="Кейсы крит регресса" done={!!cases?.length}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-text-muted">
                «{crit.crit_field}» = {crit.crit_value} · статус «{crit.status}» · «{crit.type_field}» = {crit.type_value} · «{crit.ke_field}» из релиза ({keOn.size})
              </p>
              <button type="button" onClick={() => setCritOpen(o => !o)} aria-expanded={critOpen}
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Условия <ChevronDown className={`w-3 h-3 transition-transform ${critOpen ? "rotate-180" : ""}`} /></button>
              <button type="button" onClick={find} disabled={findBusy || keOn.size === 0}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
                {findBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Найти кейсы</button>
            </div>
            {embedded && keBlock}
            {critOpen && !values && !valuesErr && <p className="flex items-center gap-2 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Собираю значения полей по модели…</p>}
            {critOpen && valuesErr && <p className="text-xs text-red-600 dark:text-red-400">Значения полей не загрузились: {valuesErr}</p>}
            {critOpen && values && (
              <div className="grid grid-cols-3 gap-3 rounded-lg bg-bg-subtle p-3">
                {select("status", "Статус кейса", values.statuses)}
                {select("crit_field", "Поле признака", fieldNames)}
                {select("crit_value", "Значение признака", valuesOf(crit.crit_field))}
                {select("type_field", "Поле вида тестирования", fieldNames)}
                {select("type_value", "Вид тестирования", valuesOf(crit.type_field))}
                {select("ke_field", "Поле КЭ в кейсе", fieldNames)}
                <button type="button" onClick={() => saveCrit(DEFAULT_CRITERIA)} className="col-span-3 justify-self-start text-xs text-text-muted hover:text-text-main underline">
                  Вернуть по умолчанию</button>
              </div>
            )}
            {findErr && <p className="text-sm text-red-600 dark:text-red-400">Кейсы не нашлись: {findErr}</p>}
            {stats && (
              <p className="text-xs text-text-muted">
                Кейсов в статусе «{crit.status}»: {stats.checked} (другой статус — {stats.no_status}). Отсеяно: без признака крит — {stats.no_crit},
                другой вид тестирования — {stats.no_type}, КЭ не из релиза — {stats.no_ke}. <b className="text-text-main">Подходит: {cases?.length ?? 0}</b>.
              </p>
            )}
            {stats && !cases?.length && stats.fields.length > 0 && (
              <p className="text-xs text-text-muted">
                Пользовательские поля у кейсов: {stats.fields.join(", ")}. Если признак, вид тестирования или КЭ называются иначе — поправьте в «Условиях».
              </p>
            )}
            {cases && cases.length > 0 && (
              <>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
                    <input type="checkbox" checked={allOn} onChange={() => setChosen(allOn ? new Set() : new Set(cases.map(c => c.key)))} />
                    Выбрать все · выбрано {chosen.size} из {cases.length}
                  </label>
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти кейс" aria-label="Найти кейс" className={`${INPUT} ml-auto w-56`} />
                </div>
                <div className="max-h-[420px] overflow-y-auto scrollbar-thin border border-border-main rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-bg-card text-[11px] uppercase tracking-wide text-text-muted">
                      <tr><th className="w-10" /><th className="text-left px-3 py-2 w-36">Ключ</th><th className="text-left px-3 py-2">Название</th><th className="text-left px-3 py-2 w-64">КЭ</th></tr>
                    </thead>
                    <tbody>
                      {shown.map(c => (
                        <tr key={c.key} className="border-t border-border-main hover:bg-bg-subtle/60">
                          <td className="text-center"><input type="checkbox" checked={chosen.has(c.key)} aria-label={`Выбрать ${c.key}`}
                            onChange={() => setChosen(o => { const n = new Set(o); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} /></td>
                          <td className="px-3 py-1.5 font-mono text-xs text-primary whitespace-nowrap">{c.key}</td>
                          <td className="px-3 py-1.5 text-text-main"><span className="block truncate max-w-[480px]">{c.name}</span>
                            {c.folder && <span className="block text-[11px] text-text-muted truncate">{c.folder}</span>}</td>
                          <td className="px-3 py-1.5 text-xs text-text-muted truncate">{c.ke.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Step>
        )}

        {rel && cases && cases.length > 0 && (
          <Step n={embedded ? 2 : 3} title="Прогон" done={!!run}>
            {!run ? (
              <>
                <div className="flex items-center gap-2">
                  <input value={runName} onChange={e => setRunName(e.target.value)} aria-label="Название прогона" className={`${INPUT} flex-1`} />
                  <button type="button" onClick={() => setConfirm(true)} disabled={!chosen.size || !runName.trim() || creating}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
                    <Rocket className="w-4 h-4" /> Создать прогон ({chosen.size})</button>
                </div>
                <p className="text-xs text-text-muted">В отслеживании прогона будет задача релиза {rel.key}.</p>
                {confirm && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                    <span className="text-text-main">Создать в Jira прогон «{runName.trim()}» ({cases_(chosen.size)}) с отслеживанием {rel.key}?</span>
                    <button type="button" onClick={create} disabled={creating}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-white font-semibold disabled:opacity-50">
                      {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Создать</button>
                    <button type="button" onClick={() => setConfirm(false)} className="px-3 py-1 rounded-md border border-border-main text-text-muted">Отмена</button>
                  </div>
                )}
                {createErr && <p className="text-sm text-red-600 dark:text-red-400">Прогон не создался: {createErr}</p>}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-text-main">
                  Прогон <a href={run.url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">{run.key}</a> создан:
                  {" "}{cases_(run.caseKeys.length)}, отслеживание — <span className="font-mono">{rel.key}</span>. Пройдите его:
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setPlayer(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90">
                    <PlayCircle className="w-4 h-4" /> Пройти в плеере</button>
                  {!passAsk ? (
                    <button type="button" onClick={() => setPassAsk(true)} disabled={passBusy}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
                      <CheckCheck className="w-4 h-4 text-green-600" /> Пройти все</button>
                  ) : (
                    <span className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-sm">
                      Проставить Pass в Jira: {cases_(run.caseKeys.length)}?
                      <button type="button" onClick={passAll} disabled={passBusy} className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-green-600 text-white font-semibold">
                        {passBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Да, Pass</button>
                      <button type="button" onClick={() => setPassAsk(false)} aria-label="Отмена" className="p-0.5 text-text-muted"><X className="w-4 h-4" /></button>
                    </span>
                  )}
                </div>
                {passNote && <p className={`text-sm ${/ошибк|Не сохран/.test(passNote) ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{passNote}</p>}
              </div>
            )}
          </Step>
        )}
      </div>
  );

  const player_ = player && run && (
    <Player runKey={run.key} project={project} baseUrl={baseUrl}
      items={run.caseKeys.map(k => ({ testCaseKey: k, status: passed[k] ?? "Not Executed" }))}
      onClose={() => setPlayer(false)} />
  );
  if (embedded) return <>{body}{player_}</>;
  return <div className="h-full overflow-y-auto scrollbar-thin">{body}{player_}</div>;
}
