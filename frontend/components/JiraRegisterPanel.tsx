"use client";

/**
 * Панель «Зарегистрировать в Jira» — под готовым баг-репортом.
 * Проект фиксирован (SBER911). Критичность/лейблы/эпик(выгрузка)/компонент/стенд —
 * всё из справочников Jira. КЭ подставляется автоматически по компоненту,
 * среда обнаружения всегда «СТ» — оба поля на фронте не показываются.
 * Исполнитель не задаётся из инструмента — назначается в Jira вручную.
 */

import { useEffect, useState } from "react";
import {
  Loader2, Plus, X, ExternalLink, Send, AlertTriangle, CheckCircle2, Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import {
  getJiraSettings, saveJiraSettings, getJiraMeta, loadJiraEpics,
  createJiraDefect,
  type JiraProjectMeta, type JiraEpic, type JiraSettings,
} from "@/lib/jiraApi";

const PROJECT = "SBER911";

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

const LBL = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

/* Приоритет от ИИ (рус.) → варианты названий в Jira (рус./англ.).
   Основы слов: в SBER911 приоритет называется «Критичный», ИИ пишет «Критический». */
const PRIORITY_SYNONYMS: Record<string, string[]> = {
  "критический": ["критичн", "критическ", "critical", "блокирующ", "blocker"],
  "высокий":     ["высок", "high", "major"],
  "средний":     ["средн", "medium", "normal"],
  "низкий":      ["низк", "low", "minor", "trivial"],
};

function matchPriority(hint: string, jiraPriorities: string[]): string {
  const h = hint.trim().toLowerCase();
  if (!h) return "";
  const exact = jiraPriorities.find(p => p.toLowerCase() === h);
  if (exact) return exact;
  // порядок синонимов = приоритет совпадения («критичн» раньше запасного «блокирующ»)
  const syns = PRIORITY_SYNONYMS[h] ?? [h];
  for (const s of syns) {
    const hit = jiraPriorities.find(p => p.toLowerCase().includes(s));
    if (hit) return hit;
  }
  return "";
}

export default function JiraRegisterPanel({
  summary, description, priorityHint = "",
}: { summary: string; description: string; priorityHint?: string }) {
  const router = useRouter();

  const [settings, setSettings] = useState<JiraSettings | null>(null);
  const [settingsErr, setSettingsErr] = useState("");

  const [meta, setMeta] = useState<JiraProjectMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaErr, setMetaErr] = useState("");

  const [issueSummary, setIssueSummary] = useState(summary);
  const [priority, setPriority] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [components, setComponents] = useState<string[]>([]);
  const [stand, setStand] = useState("");

  // Эпик: кнопка «Выгрузить» → полный список активных эпиков → Select с поиском
  const [epicKey, setEpicKey] = useState("");
  const [epics, setEpics] = useState<JiraEpic[]>([]);
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [epicsErr, setEpicsErr] = useState("");

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: string; url: string; warnings?: string[] } | null>(null);
  const [createErr, setCreateErr] = useState("");

  useEffect(() => { setIssueSummary(summary); setCreated(null); }, [summary]);

  // Новый отчёт → пере-подставить приоритет из ИИ (если мета уже загружена)
  useEffect(() => {
    if (!priorityHint || !meta) return;
    const m = matchPriority(priorityHint, meta.priorities);
    if (m) setPriority(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityHint, meta]);

  useEffect(() => {
    getJiraSettings().then(setSettings).catch(e => setSettingsErr(String(e)));
  }, []);

  const tokenConfigured = Boolean(settings && (settings.token || settings.token_path));

  /* ── Мета проекта (приоритеты, компоненты, поля) — проект фиксирован ─── */
  useEffect(() => {
    if (!tokenConfigured) return;
    setMetaLoading(true); setMetaErr("");
    getJiraMeta(PROJECT)
      .then(m => {
        setMeta(m);
        setPriority(prev => prev || matchPriority(priorityHint, m.priorities));
      })
      .catch(e => setMetaErr(String(e)))
      .finally(() => setMetaLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenConfigured]);

  /* ── Выгрузка эпиков по кнопке ───────────────────────────────────── */
  const handleLoadEpics = async () => {
    setEpicsLoading(true); setEpicsErr("");
    try {
      const r = await loadJiraEpics(PROJECT);
      setEpics(r.epics);
      if (r.epics.length === 0) setEpicsErr("Активных эпиков не найдено");
    } catch (e) { setEpicsErr(String(e)); }
    setEpicsLoading(false);
  };

  /* ── Компоненты: до 2, второй — только если выбран мобильный ────── */
  const toggleComponent = (c: string) => {
    setComponents(prev => {
      if (prev.includes(c)) return prev.filter(x => x !== c);
      if (prev.length === 0) return [c];
      const mobiles = new Set(meta?.mobile_components ?? []);
      const anyMobile = prev.some(x => mobiles.has(x)) || mobiles.has(c);
      if (prev.length === 1 && anyMobile) return [...prev, c]; // МП + второй
      return [c]; // иначе заменяем выбор
    });
  };

  /* ── Лейблы ──────────────────────────────────────────────────────── */
  const labelPresets = meta?.labels_presets ?? settings?.labels ?? [];
  const toggleLabel = (l: string) =>
    setLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);

  const addNewLabel = async () => {
    const l = newLabel.trim();
    if (!l) return;
    setNewLabel("");
    if (!labels.includes(l)) setLabels(prev => [...prev, l]);
    // новый пресет — сохраняем в настройки, чтобы был в списке в следующий раз
    if (settings && !labelPresets.includes(l)) {
      const next = { ...settings, labels: [...labelPresets, l] };
      setSettings(next);
      try { await saveJiraSettings(next); } catch { /* не критично */ }
    }
  };

  /* ── Создание ────────────────────────────────────────────────────── */
  const handleCreate = async () => {
    setCreating(true); setCreateErr(""); setCreated(null);
    try {
      const res = await createJiraDefect({
        project: PROJECT,
        summary: issueSummary.trim(),
        description,
        priority,
        labels,
        epic_key: epicKey,
        components,
        assignee: "",     // исполнитель назначается в Jira вручную
        ke: "",           // КЭ подставляется бэкендом из компонентов
        environment: "", // Среда обнаружения — всегда СТ (дефолт справочника)
        stand,
      });
      setCreated({ key: res.key, url: res.url, warnings: res.warnings });
    } catch (e) { setCreateErr(String(e)); }
    setCreating(false);
  };

  /* ── Нет токена — подсказка ──────────────────────────────────────── */
  if (settings && !tokenConfigured) return (
    <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-main mb-1">Jira не подключена</p>
          <p className="text-sm text-text-muted mb-3">
            Чтобы регистрировать дефекты в Jira, получите токен по логину/паролю Сигмы
            или укажите путь к файлу токена в настройках.
          </p>
          <button onClick={() => router.push("/settings")}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border-main rounded-lg text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="w-3.5 h-3.5" /> Открыть настройки
          </button>
        </div>
      </div>
    </div>
  );

  if (settingsErr) return null;
  if (!settings) return null;

  const standField = meta?.fields?.stand;

  return (
    <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" /> Регистрация в Jira
        </h3>
        <span className="text-xs text-text-muted">
          Проект: <span className="font-mono text-text-main">{PROJECT}</span>
          {metaLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-1.5" />}
          {meta && !metaLoading && <span className="text-green-600 ml-1.5">· {meta.issuetype}</span>}
        </span>
      </div>
      {metaErr && <p className="text-xs text-red-500 mb-3">{metaErr}</p>}
      {meta && meta.warnings.length > 0 && (
        <p className="text-xs text-amber-600 mb-3">{meta.warnings.join(" · ")}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
        {/* Критичность */}
        <div>
          <label className={LBL}>Критичность</label>
          <Select value={priority} onChange={setPriority} placeholder="— приоритет —">
            <option value="">— приоритет —</option>
            {(meta?.priorities ?? []).map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>

        {/* Название */}
        <div>
          <label className={LBL}>Название дефекта *</label>
          <input value={issueSummary} onChange={e => setIssueSummary(e.target.value)}
            placeholder="Краткое название дефекта" className={INPUT_CLS} />
        </div>

        {/* Лейблы */}
        <div className="sm:col-span-2">
          <label className={LBL}>Лейблы</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {labelPresets.map(l => (
              <button key={l} type="button" onClick={() => toggleLabel(l)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  labels.includes(l)
                    ? "border-primary/50 bg-[var(--color-active-bg)] text-primary"
                    : "border-border-main text-text-muted hover:text-text-main"
                }`}>
                {l}
              </button>
            ))}
            {labels.filter(l => !labelPresets.includes(l)).map(l => (
              <span key={l} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-primary/50 bg-[var(--color-active-bg)] text-primary">
                {l}
                <button onClick={() => toggleLabel(l)}><X className="w-3 h-3" /></button>
              </span>
            ))}
            <span className="flex items-center gap-1">
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addNewLabel()}
                placeholder="+ новый лейбл" className="w-28 border border-dashed border-border-main rounded-full px-2.5 py-1 text-xs bg-transparent text-text-main placeholder:text-text-muted/60 focus:outline-none focus:border-primary/50" />
              {newLabel.trim() && (
                <button onClick={addNewLabel} className="p-1 rounded-full text-primary hover:bg-bg-subtle">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          </div>
        </div>

        {/* Эпик: кнопка «Выгрузить» + выпадающий список с поиском */}
        <div>
          <label className={LBL}>Эпик</label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Select value={epicKey} onChange={setEpicKey}
                placeholder={epics.length ? "— выберите эпик —" : "сначала выгрузите эпики"}
                disabled={epics.length === 0}
                searchable searchPlaceholder="Поиск эпика по названию…">
                <option value="">— без эпика —</option>
                {epics.map(ep => <option key={ep.key} value={ep.key}>{`${ep.key} — ${ep.summary}`}</option>)}
              </Select>
            </div>
            <button onClick={handleLoadEpics} disabled={epicsLoading}
              className="px-3 py-2 border border-border-main rounded-lg text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-40 whitespace-nowrap flex-shrink-0">
              {epicsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Выгрузить"}
            </button>
          </div>
          {epicsErr && <p className="text-xs text-red-500 mt-1">{epicsErr}</p>}
          {epics.length > 0 && <p className="text-xs text-text-muted mt-1">Активных эпиков: {epics.length}</p>}
        </div>

        {/* Компоненты: до 2 (второй — при выборе мобильного), КЭ подставляется сам */}
        <div>
          <label className={LBL}>Компонент</label>
          <div className="flex flex-wrap gap-1.5">
            {(meta?.components ?? []).map(c => (
              <button key={c} type="button" onClick={() => toggleComponent(c)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  components.includes(c)
                    ? "border-primary/50 bg-[var(--color-active-bg)] text-primary"
                    : "border-border-main text-text-muted hover:text-text-main"
                }`}>
                {c}
              </button>
            ))}
            {(meta?.components ?? []).length === 0 && (
              <span className="text-xs text-text-muted py-1">
                {metaLoading ? "загрузка…" : "нет доступных компонентов"}
              </span>
            )}
          </div>
          {components.length === 2 && (
            <p className="text-xs text-text-muted mt-1">Передаются 2 компонента и 2 КЭ</p>
          )}
        </div>

        {/* Исполнитель, КЭ и Среда обнаружения на фронте не задаются:
            исполнитель назначается в Jira вручную, КЭ — автоматом из компонента,
            среда — всегда СТ (дефолты справочника на бэкенде) */}

        {/* Стенд */}
        <div>
          <label className={LBL}>Стенд</label>
          {standField && standField.allowed.length > 0 ? (
            <Select value={stand} onChange={setStand} placeholder="— стенд —">
              <option value="">— стенд —</option>
              {standField.allowed.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          ) : (
            <input value={stand} onChange={e => setStand(e.target.value)}
              placeholder="Название стенда" className={INPUT_CLS} />
          )}
        </div>
      </div>

      {/* Результат / ошибка / кнопка */}
      {createErr && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {createErr}
        </div>
      )}
      {created && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Дефект создан:
            <a href={created.url} target="_blank" rel="noreferrer"
              className="font-semibold underline flex items-center gap-1">
              {created.key} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {created.warnings && created.warnings.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">{created.warnings.join(" · ")}</p>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button onClick={handleCreate}
          disabled={creating || !issueSummary.trim() || Boolean(created)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-40 transition-all">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {creating ? "Создаю…" : created ? "Создано" : "Зарегистрировать в Jira"}
        </button>
      </div>
    </div>
  );
}
