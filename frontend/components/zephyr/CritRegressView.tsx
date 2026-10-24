"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, ChevronDown, ExternalLink, Loader2, PlayCircle, Plus, Rocket, Search, SlidersHorizontal, Unlink, X } from "lucide-react";
import {
  DEFAULT_CRITERIA, createRun, findCritCases, getFieldValues, getRelease, getRun, saveResults,
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
 * modal — в окне «Собрать регресс»: кейсы ищутся сразу, отмечает их пользователь («Выбрать все»), прогон создаётся
 * без доп. подтверждения, и окно закрывает раздел (onRunCreated).
 *
 * Ревизия (existingRuns — у релиза уже есть прогон регресса): кейсы этих прогонов читаются из Zephyr; КЭ релиза,
 * которых нет ни у одного кейса прогонов, подсвечены как новые; список — только недобавленные кейсы (их собирают
 * в дополнительный прогон: в готовый прогон API кейсы не добавляет). Или «Открепить» прогон и собрать новый.
 */
export default function CritRegressView({ project, baseUrl, releaseKey, modal, onRunCreated, existingRuns, onDetach }: {
  project: string;
  baseUrl: string;
  releaseKey?: string;
  modal?: boolean;
  onRunCreated?: (key: string, warnings: string[]) => void;
  /** Прогоны регресса, уже привязанные к релизу, — ревизия вместо сборки с нуля. */
  existingRuns?: { key: string; name: string }[];
  /** Открепить прогон регресса от релиза (в SimpleTest) — чтобы собрать новый. */
  onDetach?: (run: string) => Promise<void>;
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
  const [run, setRun] = useState<{ key: string; url: string; caseKeys: string[]; issueKey: string; warnings: string[] } | null>(null);
  const [passAsk, setPassAsk] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [passNote, setPassNote] = useState("");
  const [player, setPlayer] = useState(false);
  const [passed, setPassed] = useState<Record<string, string>>({});

  const [values, setValues] = useState<{ statuses: string[]; fields: Record<string, string[]> } | null>(null);
  const [valuesErr, setValuesErr] = useState("");

  /* ── Ревизия: кейсы уже собранных прогонов регресса ── */
  const [revRuns, setRevRuns] = useState(existingRuns ?? []);
  const [inRun, setInRun] = useState<Set<string> | null>(null);
  const [revErr, setRevErr] = useState("");
  const [onlyNew, setOnlyNew] = useState(true);
  const [detaching, setDetaching] = useState("");
  const revision = revRuns.length > 0;
  const revKeys = revRuns.map(r => r.key).join(",");
  useEffect(() => {
    if (!revKeys) { setInRun(null); return; }
    let live = true;
    setRevErr("");
    Promise.all(revKeys.split(",").map(k => getRun(k)))
      .then(rs => { if (live) setInRun(new Set(rs.flatMap(r => r.items.map(i => i.testCaseKey)))); })
      .catch(e => { if (live) setRevErr((e as Error).message); });
    return () => { live = false; };
  }, [revKeys]);
  // КЭ, которых нет ни у одного кейса уже собранных прогонов, — новые (появились у релиза после сборки).
  const coveredKe = useMemo(() => new Set((cases ?? []).filter(c => inRun?.has(c.key)).flatMap(c => c.ke)), [cases, inRun]);
  const isNewKe = (l: string) => revision && !!inRun && !!cases && !coveredKe.has(l);
  const detach = async (run: string) => {
    if (!onDetach) return;
    setDetaching(run);
    try { await onDetach(run); setRevRuns(rs => rs.filter(r => r.key !== run)); } catch (e) { setRevErr((e as Error).message); }
    setDetaching("");
  };

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
      setRunName(`${readCriteria().only_crit ? "Крит регресс" : "Регресс"} ${r.key} · ${today()}${existingRuns?.length ? " · доп." : ""}`);
      if (modal && r.ke.length) void find(r.ke.map(x => x.label), readCriteria());   // набор кейсов — сразу
    } catch (e) { setRelErr((e as Error).message); }
    setRelBusy(false);
  };
  useEffect(() => { if (releaseKey) void loadRelease(releaseKey); }, [releaseKey]);

  const keList = rel ? [...rel.ke.map(x => x.label), ...[...keOn].filter(l => !rel.ke.some(x => x.label === l))] : [];
  const addKe = () => { const v = extraKe.trim(); if (v) { setKeOn(s => new Set(s).add(v)); setExtraKe(""); } };

  const find = async (ke: string[] = [...keOn], criteria: CritCriteria = crit) => {
    setFindBusy(true); setFindErr(""); setCases(null); setStats(null); setRun(null);
    try {
      const r = await findCritCases(project, ke, criteria);
      // В окне кейсы отмечает сам пользователь («Выбрать все»), чтобы привычный клик не снял все отметки.
      setCases(r.cases); setStats(r.stats); setChosen(new Set(modal ? [] : r.cases.map(c => c.key)));
    } catch (e) { setFindErr((e as Error).message); }
    setFindBusy(false);
  };

  const s = q.trim().toLowerCase();
  const notAdded = (c: CritCase) => !inRun?.has(c.key);
  const pool = useMemo(() => (cases ?? []).filter(c => !(revision && onlyNew && inRun) || notAdded(c)), [cases, revision, onlyNew, inRun]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => pool.filter(c => !s || c.name.toLowerCase().includes(s) || c.key.toLowerCase().includes(s)), [pool, s]);
  const allOn = pool.length > 0 && pool.every(c => chosen.has(c.key));

  const create = async () => {
    if (!rel) return;
    setCreating(true); setCreateErr("");
    try {
      const keys = (cases ?? []).filter(c => chosen.has(c.key)).map(c => c.key);
      const r = await createRun({ project, name: runName.trim(), issueKey: rel.key, caseKeys: keys, type: crit.type_value });
      setRun({ ...r, caseKeys: keys }); setConfirm(false); setPassed({}); onRunCreated?.(r.key, r.warnings);
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
  const select = (k: Exclude<keyof CritCriteria, "only_crit">, label: string, options: string[]) => {
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
                  <label key={l} title={isNewKe(l) ? "Новая КЭ: ни у одного кейса уже собранного прогона её нет" : undefined}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs cursor-pointer select-none
                    ${keOn.has(l) ? "border-primary bg-primary/10 text-primary" : "border-border-main text-text-muted"}
                    ${isNewKe(l) ? "ring-2 ring-amber-400" : ""}`}>
                    <input type="checkbox" className="sr-only" checked={keOn.has(l)}
                      onChange={() => setKeOn(o => { const n = new Set(o); if (n.has(l)) n.delete(l); else n.add(l); return n; })} />
                    {l}{isNewKe(l) && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">новая</span>}
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
        {revision && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2 text-sm">
            <p className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Регресс уже собран — ревизия: новые КЭ релиза подсвечены, ниже — только кейсы, которых в прогоне нет. Их можно собрать
                в дополнительный прогон (в готовый прогон API Zephyr кейсы не добавляет) или открепить прогон и собрать регресс заново.</span>
            </p>
            <ul className="space-y-1">
              {revRuns.map(r => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-primary">{r.key}</span>
                  <span className="min-w-0 flex-1 truncate text-text-main">{r.name}</span>
                  {onDetach && (
                    <button type="button" onClick={() => detach(r.key)} disabled={!!detaching}
                      title="Открепить от релиза в SimpleTest — строка релиза перестанет его учитывать; в Zephyr отслеживание не меняется"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-main bg-bg-card text-xs text-text-main hover:bg-bg-subtle disabled:opacity-40">
                      {detaching === r.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />} Открепить</button>
                  )}
                </li>
              ))}
            </ul>
            {!inRun && !revErr && <p className="flex items-center gap-1.5 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Читаю кейсы прогона…</p>}
            {revErr && <p className="text-xs text-red-600 dark:text-red-400">Кейсы прогона не прочитались: {revErr}</p>}
          </div>
        )}
        {embedded && relBusy && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю релиз…</p>}

        {rel && (
          <Step n={embedded ? 1 : 2} title="Кейсы крит регресса" done={!!cases?.length}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-text-muted">
                {crit.only_crit && <>«{crit.crit_field}» = {crit.crit_value} · </>}статус «{crit.status}» · «{crit.type_field}» = {crit.type_value} · «{crit.ke_field}» = КЭ релиза ({keOn.size})
              </p>
              <button type="button" onClick={() => setCritOpen(o => !o)} aria-expanded={critOpen}
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Условия <ChevronDown className={`w-3 h-3 transition-transform ${critOpen ? "rotate-180" : ""}`} /></button>
              <button type="button" onClick={() => find()} disabled={findBusy || keOn.size === 0}
                className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40
                  ${modal ? "border border-border-main text-text-main hover:bg-bg-subtle" : "bg-primary text-white"}`}>
                {findBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {modal && cases ? "Обновить список" : "Найти кейсы"}</button>
            </div>
            {embedded && keBlock}
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer select-none w-fit">
              <input type="checkbox" checked={crit.only_crit} onChange={e => {
                saveCrit({ ...crit, only_crit: e.target.checked });
                setRunName(n => n.replace(/^(Крит регресс|Регресс)/, e.target.checked ? "Крит регресс" : "Регресс"));
              }} />
              Только кейсы с признаком «{crit.crit_field}» <span className="text-xs text-text-muted">(снимите — весь регресс по КЭ)</span>
            </label>
            {critOpen && !values && !valuesErr && <p className="flex items-center gap-2 text-xs text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Собираю значения полей по модели…</p>}
            {critOpen && valuesErr && <p className="text-xs text-red-600 dark:text-red-400">Значения полей не загрузились: {valuesErr}</p>}
            {critOpen && values && (
              <div className="grid grid-cols-3 gap-3 rounded-lg bg-bg-subtle p-3">
                {select("status", "Статус кейса", values.statuses)}
                {crit.only_crit ? select("crit_field", "Поле признака", fieldNames) : <span />}
                {crit.only_crit ? select("crit_value", "Значение признака", valuesOf(crit.crit_field)) : <span />}
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
                Кейсов в статусе «{crit.status}»: {stats.checked} (другой статус — {stats.no_status}). Отсеяно: {crit.only_crit && <>без признака крит — {stats.no_crit}, </>}
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
                    <input type="checkbox" checked={allOn} onChange={() => setChosen(allOn ? new Set() : new Set(pool.map(c => c.key)))} />
                    Выбрать все · выбрано {chosen.size} из {pool.length}
                  </label>
                  {revision && inRun && (
                    <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer select-none">
                      <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} />
                      Только недобавленные · {cases.filter(notAdded).length} из {cases.length}
                    </label>
                  )}
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
                          <td className="px-3 py-1.5 text-xs text-text-muted truncate">
                            {c.ke.map((k, i) => <span key={k} className={isNewKe(k) ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>{i ? ", " : ""}{k}</span>)}
                            {revision && inRun?.has(c.key) && <span className="ml-1 text-green-700 dark:text-green-400">· в прогоне</span>}</td>
                        </tr>
                      ))}
                      {shown.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-text-muted">
                          {revision && onlyNew && pool.length === 0 ? "Все подходящие кейсы уже в прогонах регресса — добавлять нечего." : "Ничего не найдено."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Step>
        )}

        {rel && cases && cases.length > 0 && (
          // В окне строка прогона прилипает к низу — до «Создать прогон» не нужно листать сотни кейсов.
          <div className={modal ? "sticky bottom-0 z-10 shadow-[0_-8px_16px_-8px_rgba(0,0,0,0.25)] rounded-xl" : ""}>
          <Step n={embedded ? 2 : 3} title="Прогон" done={!!run}>
            {!run ? (
              <>
                <div className="flex items-center gap-2">
                  <input value={runName} onChange={e => setRunName(e.target.value)} aria-label="Название прогона" className={`${INPUT} flex-1`} />
                  <button type="button" onClick={modal ? create : () => setConfirm(true)} disabled={!chosen.size || !runName.trim() || creating}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} {revision ? "Создать доп. прогон" : "Создать прогон"} ({chosen.size})</button>
                </div>
                <p className="text-xs text-text-muted">В отслеживании прогона будет задача релиза {rel.key}, «{crit.type_field}» прогона — {crit.type_value}.</p>
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
                  {" "}{cases_(run.caseKeys.length)}, в отслеживании — <span className="font-mono">{run.issueKey || "—"}</span>. Пройдите его:
                </p>
                {run.warnings.map(w => (
                  <p key={w} className="rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-sm text-amber-800 dark:text-amber-200">{w}</p>
                ))}
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
          </div>
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
