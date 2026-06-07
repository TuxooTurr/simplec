"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, HelpCircle, Loader2,
  Pencil, Play, Plus, RefreshCw, Save, Search, Settings2, Trash2,
} from "lucide-react";
import { analyzeProject, type ProjectAnalysis } from "@/lib/api";
import {
  checkAutotestBuilds,
  getAutotestScriptOptions,
  getAutotestRunConfig,
  getAutotestRunHistory,
  runAutotestScript,
  saveAutotestRunConfig,
  type AutotestRunConfig,
  type AutotestType,
  type AutorunRuleConfig,
  type LayoutSize,
  type RunResult,
  type RunScriptConfig,
  type ScriptOption,
} from "@/lib/autotestRunsApi";

const TEST_TYPES: Array<{ id: AutotestType; label: string }> = [
  { id: "api", label: "API" },
  { id: "e2e", label: "E2E" },
  { id: "frontend", label: "Frontend" },
  { id: "mobile", label: "Mobile" },
  { id: "dt", label: "Desktop" },
];

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow";

const SMALL_INPUT_CLS =
  "w-full border border-border-main rounded-lg px-2.5 py-1.5 text-xs bg-[var(--color-input-bg)] text-text-main focus:outline-none " +
  "focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow";

const SIZE_OPTIONS: Array<{ id: LayoutSize; label: string; help: string }> = [
  { id: "sm", label: "S", help: "Компактная ширина" },
  { id: "md", label: "M", help: "Стандартная ширина" },
  { id: "lg", label: "L", help: "Расширенная ширина" },
  { id: "wide", label: "Широкая", help: "На всю строку" },
];

const SCRIPT_SIZE_CLASS: Record<LayoutSize, string> = {
  sm: "basis-[170px] max-w-[190px]",
  md: "basis-[250px] max-w-[280px]",
  lg: "basis-[340px] max-w-[380px]",
  wide: "basis-full max-w-full",
};

const SCRIPT_CONTROL_WIDTH_CLASS: Record<LayoutSize, string> = {
  sm: "w-[170px] max-w-full",
  md: "w-[250px] max-w-full",
  lg: "w-[340px] max-w-full",
  wide: "w-full",
};

const SCRIPT_SETTINGS_GRID_CLASS =
  "mb-3 grid max-w-[760px] grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-[minmax(0,360px)_minmax(0,360px)]";

const RULE_SIZE_CLASS: Record<LayoutSize, string> = {
  sm: "basis-[260px] max-w-[300px]",
  md: "basis-[380px] max-w-[440px]",
  lg: "basis-[520px] max-w-[620px]",
  wide: "basis-full max-w-full",
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyScript(): RunScriptConfig {
  return {
    id: newId("script"),
    name: "Новый прогон",
    script_path: "",
    work_dir: "",
    default_tags: ["smoke"],
    test_types: ["api", "e2e"],
    microservices: ["*"],
    enabled: true,
    timeout_sec: 1200,
    ui_size: "md",
    ui_order: 0,
  };
}

function emptyRule(scriptId = ""): AutorunRuleConfig {
  return {
    id: newId("rule"),
    name: "Правило автозапуска",
    microservice: "*",
    script_ids: scriptId ? [scriptId] : [],
    tags: [],
    use_microservice_as_tag: true,
    test_types: ["api", "e2e"],
    enabled: true,
    ui_size: "md",
    ui_order: 0,
  };
}

function FieldHelp({ label, help }: { label: string; help: string }) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
      <span>{label}</span>
      <span title={help} aria-label={help}>
        <HelpCircle className="h-3.5 w-3.5 text-text-muted" />
      </span>
    </label>
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map(v => v.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

function joinCsv(values: string[]): string {
  return values.join(", ");
}

function testTypeLabels(values: AutotestType[]): string {
  const labels = values
    .map(value => TEST_TYPES.find(type => type.id === value)?.label ?? value)
    .filter(Boolean);
  return labels.length ? labels.join(", ") : "Типы не выбраны";
}

function ruleTagsLabel(rule: AutorunRuleConfig): string {
  const tags = [...rule.tags];
  if (rule.use_microservice_as_tag ?? true) {
    tags.push("тег сервиса");
  }
  return tags.join(", ") || "без тегов";
}

function ruleScriptTypesLabel(rule: AutorunRuleConfig, scripts: RunScriptConfig[]): string {
  const values = rule.script_ids
    .flatMap(id => scripts.find(script => script.id === id)?.test_types ?? [])
    .filter((value, index, arr) => arr.indexOf(value) === index);
  return testTypeLabels(values as AutotestType[]);
}

function toggleType(values: AutotestType[], type: AutotestType): AutotestType[] {
  return values.includes(type) ? values.filter(t => t !== type) : [...values, type];
}

function TypeChips({
  value,
  onChange,
}: {
  value: AutotestType[];
  onChange: (next: AutotestType[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TEST_TYPES.map(type => (
        <button
          key={type.id}
          type="button"
          onClick={() => onChange(toggleType(value, type.id))}
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
            value.includes(type.id)
              ? "border-indigo-200 bg-[var(--color-active-bg)] text-indigo-700"
              : "border-border-main bg-bg-card text-text-muted hover:border-indigo-200"
          }`}
        >
          {type.label}
        </button>
      ))}
    </div>
  );
}

function sortByOrder<T extends { ui_order?: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byOrder = (a.ui_order ?? 0) - (b.ui_order ?? 0);
    return byOrder || a.id.localeCompare(b.id);
  });
}

function moveById<T extends { id: string; ui_order?: number }>(items: T[], id: string, direction: -1 | 1): T[] {
  const sorted = sortByOrder(items);
  const index = sorted.findIndex(item => item.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) {
    return sorted.map((item, order) => ({ ...item, ui_order: order }));
  }
  const copy = [...sorted];
  const current = copy[index];
  copy[index] = copy[nextIndex];
  copy[nextIndex] = current;
  return copy.map((item, order) => ({ ...item, ui_order: order }));
}

function SizePicker({
  value,
  onChange,
}: {
  value: LayoutSize;
  onChange: (next: LayoutSize) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SIZE_OPTIONS.map(option => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          title={option.help}
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
            value === option.id
              ? "border-indigo-200 bg-[var(--color-active-bg)] text-indigo-700"
              : "border-border-main bg-bg-card text-text-muted hover:border-indigo-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function formatAuditTime(item: RunResult): string {
  const value = item.started_at || item.ts;
  if (!value) return "время не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function auditKindLabel(item: RunResult): string {
  if ((item.audit_type ?? item.trigger) === "autorun") return "Автозапуск";
  return "Кнопка";
}

function auditName(item: RunResult): string {
  if ((item.audit_type ?? item.trigger) === "autorun") {
    return item.rule_name || item.audit_name || "Автозапуск";
  }
  return item.button_name || item.audit_name || item.script_name;
}

function selectedScriptOptionValue(value: string, options: ScriptOption[]): string {
  const clean = value.trim();
  if (!clean) return "";
  const option = options.find(item => item.relative_path === clean || item.path === clean);
  return option?.relative_path ?? "";
}

export default function AutotestRunPanel() {
  const [config, setConfig] = useState<AutotestRunConfig | null>(null);
  const [history, setHistory] = useState<RunResult[]>([]);
  const [frameworkDraft, setFrameworkDraft] = useState("");
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [discoveredScripts, setDiscoveredScripts] = useState<ScriptOption[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [editingScriptId, setEditingScriptId] = useState("");
  const [editingRuleId, setEditingRuleId] = useState("");
  const [autorunSettingsOpen, setAutorunSettingsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, hist] = await Promise.all([
          getAutotestRunConfig(),
          getAutotestRunHistory(12),
        ]);
        if (!alive) return;
        setConfig(cfg);
        setFrameworkDraft(cfg.framework_path ?? "");
        setHistory(hist);
      } catch (err) {
        if (alive) setMessage({ type: "error", text: String(err) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const sortedScripts = useMemo(() => sortByOrder(config?.scripts ?? []), [config?.scripts]);
  const sortedRules = useMemo(() => sortByOrder(config?.autorun.rules ?? []), [config?.autorun.rules]);
  const launchScriptOptions = sortedScripts;

  useEffect(() => {
    const frameworkPath = config?.framework_path?.trim() ?? "";
    if (!frameworkPath) {
      setDiscoveredScripts([]);
      setScriptsError("");
      setScriptsLoading(false);
      return;
    }

    let alive = true;
    setScriptsLoading(true);
    setScriptsError("");
    getAutotestScriptOptions()
      .then(result => {
        if (!alive) return;
        setDiscoveredScripts(result.options ?? []);
      })
      .catch(err => {
        if (!alive) return;
        setDiscoveredScripts([]);
        setScriptsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setScriptsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [config?.framework_path]);

  const updateConfig = (patch: Partial<AutotestRunConfig>) => {
    setConfig(prev => prev ? { ...prev, ...patch } : prev);
  };

  const updateScript = (scriptId: string, patch: Partial<RunScriptConfig>) => {
    setConfig(prev => prev ? {
      ...prev,
      scripts: prev.scripts.map(script => script.id === scriptId ? { ...script, ...patch } : script),
    } : prev);
  };

  const updateRule = (ruleId: string, patch: Partial<AutorunRuleConfig>) => {
    setConfig(prev => prev ? {
      ...prev,
      autorun: {
        ...prev.autorun,
        rules: prev.autorun.rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule),
      },
    } : prev);
  };

  const moveScript = (scriptId: string, direction: -1 | 1) => {
    setConfig(prev => prev ? { ...prev, scripts: moveById(prev.scripts, scriptId, direction) } : prev);
  };

  const moveRule = (ruleId: string, direction: -1 | 1) => {
    setConfig(prev => prev ? {
      ...prev,
      autorun: {
        ...prev.autorun,
        rules: moveById(prev.autorun.rules, ruleId, direction),
      },
    } : prev);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveAutotestRunConfig(config);
      setConfig(saved);
      setFrameworkDraft(saved.framework_path ?? "");
      setMessage({ type: "ok", text: "Настройки панели запуска сохранены" });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const bindFramework = async () => {
    if (!config) return;
    const nextPath = frameworkDraft.trim();
    if (!nextPath) return;
    setAnalyzing(true);
    setMessage(null);
    try {
      const data = await analyzeProject(nextPath);
      const saved = await saveAutotestRunConfig({ ...config, framework_path: nextPath });
      setConfig(saved);
      setFrameworkDraft(saved.framework_path ?? nextPath);
      setAnalysis(data);
      setMessage({ type: "ok", text: `Фреймворк привязан и доступен всем: ${data.build_tool}` });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setAnalyzing(false);
    }
  };

  const detachFramework = async () => {
    if (!config) return;
    if (!window.confirm("Открепить общий путь до фреймворка для всех пользователей?")) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveAutotestRunConfig({ ...config, framework_path: "" });
      setConfig(saved);
      setFrameworkDraft("");
      setAnalysis(null);
      setMessage({ type: "ok", text: "Фреймворк откреплен" });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const runScript = async (script: RunScriptConfig) => {
    if (!config) return;
    setRunningId(script.id);
    setMessage(null);
    try {
      const saved = await saveAutotestRunConfig(config);
      setConfig(saved);
      const scriptToRun = saved.scripts.find(item => item.id === script.id) ?? script;
      const result = await runAutotestScript({
        script_id: scriptToRun.id,
        tags: scriptToRun.default_tags,
        test_types: scriptToRun.test_types,
      });
      setLastRun(result);
      setHistory(prev => [result, ...prev].slice(0, 12));
      setMessage({ type: result.status === "ok" ? "ok" : "error", text: `Прогон завершен: ${result.script_name}` });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setRunningId("");
    }
  };

  const checkBuilds = async () => {
    setChecking(true);
    setMessage(null);
    try {
      const result = await checkAutotestBuilds(true);
      const runs = result.runs ?? [];
      if (runs.length > 0) {
        setLastRun(runs[0]);
        setHistory(prev => [...runs, ...prev].slice(0, 12));
      }
      setConfig(prev => prev ? {
        ...prev,
        autorun: {
          ...prev.autorun,
          last_seen: result.detected,
          last_check_at: result.checked_at,
        },
      } : prev);
      setMessage({
        type: "ok",
        text: `Проверка завершена: изменений ${result.changes.length}, запусков ${runs.length}`,
      });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setChecking(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="mb-4 rounded-xl border border-border-main bg-bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаю панель запуска автотестов...
        </div>
      </div>
    );
  }

  const frameworkAttached = Boolean(config.framework_path.trim());
  const frameworkDraftChanged = frameworkDraft.trim() !== config.framework_path.trim();

  return (
    <div className="mb-4 rounded-xl border border-border-main bg-bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-bold text-text-main">Панель запуска автотестов</h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">Настройка фреймворка, кнопок запуска и автопрогона по обновлению сборок.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={checkBuilds}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Проверить сборки
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Сохранить
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
          message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="mb-4">
        <div>
          <FieldHelp
            label="Путь до фреймворка автотестов"
            help="Абсолютный путь до папки Java/Kotlin фреймворка. SimpleTest анализирует build-файл, пакеты, тестовые директории и импорты, чтобы подсказать структуру и передать путь в скрипты через AUTOTEST_FRAMEWORK_PATH."
          />
          <div className="flex gap-2">
            <input
              value={frameworkDraft}
              onChange={e => setFrameworkDraft(e.target.value)}
              placeholder="/Users/team/autotests/framework"
              className={`${INPUT_CLS} font-mono`}
            />
            <button
              type="button"
              onClick={bindFramework}
              disabled={analyzing || !frameworkDraft.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-sm font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-40"
            >
              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {frameworkAttached && !frameworkDraftChanged ? "Переизучить" : "Привязать"}
            </button>
            {frameworkAttached && (
              <button
                type="button"
                onClick={detachFramework}
                disabled={saving}
                className="rounded-lg border border-border-main px-3 py-2 text-sm font-semibold text-text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              >
                Открепить
              </button>
            )}
          </div>
          {frameworkAttached ? (
            <p className="mt-2 text-xs text-emerald-700">
              Общий путь привязан и хранится на сервере: <span className="font-mono">{config.framework_path}</span>
              {frameworkDraftChanged && " · есть несохраненное изменение в поле"}
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-muted">
              Путь будет сохранен для всех пользователей после нажатия `Привязать`.
            </p>
          )}
          {analysis && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">{analysis.build_tool}</span>
              {analysis.test_dirs.slice(0, 3).map(dir => (
                <span key={dir} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-blue-700">{dir}</span>
              ))}
              {analysis.base_packages.slice(0, 3).map(pkg => (
                <span key={pkg} className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-violet-700">{pkg}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 border-t border-border-main pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-text-muted" />
            <h3 className="text-sm font-semibold text-text-main">Кнопки запуска</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              const script = emptyScript();
              script.ui_order = sortedScripts.length;
              updateConfig({ scripts: [...config.scripts, script] });
              setEditingScriptId(script.id);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить кнопку
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          {sortedScripts.map((script, index) => {
            const scriptSize = script.ui_size ?? "md";
            const isEditingScript = editingScriptId === script.id;

            return (
            <div
              key={script.id}
              className={`${
                isEditingScript ? "basis-full max-w-full" : SCRIPT_SIZE_CLASS[scriptSize]
              } min-w-[160px] rounded-lg border border-border-main bg-bg-card p-2.5 transition-all`}
            >
              <div className={isEditingScript ? SCRIPT_CONTROL_WIDTH_CLASS[scriptSize] : "w-full"}>
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => runScript(script)}
                  disabled={runningId === script.id || !script.enabled || !script.script_path.trim()}
                  className={`min-h-[42px] min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-40 ${
                    script.enabled ? "bg-indigo-600 hover:bg-indigo-700" : "bg-bg-muted"
                  }`}
                  title={!script.script_path.trim() ? "Выберите скрипт запуска в настройках кнопки" : "Запустить скрипт"}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {runningId === script.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    <span className="min-w-0 truncate">{script.name}</span>
                  </span>
                  <span className="mt-1 block truncate text-[10px] font-normal text-white/75">
                    {testTypeLabels(script.test_types)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingScriptId(editingScriptId === script.id ? "" : script.id)}
                  className={`rounded-lg border p-2 transition-colors ${
                    editingScriptId === script.id
                      ? "border-indigo-200 bg-[var(--color-active-bg)] text-indigo-700"
                      : "border-border-main text-text-muted hover:bg-bg-subtle"
                  }`}
                  aria-label={`Настройки кнопки ${script.name}`}
                  title="Открыть настройки кнопки"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${
                  script.enabled ? "bg-emerald-50 text-emerald-700" : "bg-bg-muted text-text-muted"
                }`}>
                  {script.enabled ? "Включена" : "Выключена"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveScript(script.id, -1)}
                    disabled={index === 0}
                    className="rounded-md p-1 text-text-muted hover:bg-bg-subtle disabled:opacity-30"
                    aria-label="Сдвинуть кнопку левее"
                    title="Сдвинуть левее"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScript(script.id, 1)}
                    disabled={index === sortedScripts.length - 1}
                    className="rounded-md p-1 text-text-muted hover:bg-bg-subtle disabled:opacity-30"
                    aria-label="Сдвинуть кнопку правее"
                    title="Сдвинуть правее"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateConfig({ scripts: config.scripts.filter(s => s.id !== script.id) })}
                    className="rounded-md p-1 text-text-muted hover:bg-red-50 hover:text-red-500"
                    aria-label="Удалить кнопку запуска"
                    title="Удалить кнопку"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              </div>

              {isEditingScript && (
                <div className="mt-3 border-t border-border-main pt-3">
                  <div className={SCRIPT_SETTINGS_GRID_CLASS}>
                    <div>
                      <FieldHelp
                        label="Имя кнопки"
                        help="Название, которое видно прямо на кнопке запуска."
                      />
                      <input
                        value={script.name}
                        onChange={e => updateScript(script.id, { name: e.target.value })}
                        className={SMALL_INPUT_CLS}
                      />
                    </div>
                    <div>
                      <FieldHelp
                        label="Размер кнопки"
                        help="Меняет визуальную ширину кнопки в панели. Порядок меняется стрелками рядом с кнопкой."
                      />
                      <SizePicker
                        value={script.ui_size ?? "md"}
                        onChange={next => updateScript(script.id, { ui_size: next })}
                      />
                    </div>
                    <div>
                      <FieldHelp
                        label="Скрипт запуска"
                        help="Выберите найденный во фреймворке .sh, .py, .bat/.cmd или исполняемый файл. Можно оставить относительный путь: backend запустит его от привязанной папки фреймворка."
                      />
                      {discoveredScripts.length > 0 && (
                        <select
                          value={selectedScriptOptionValue(script.script_path, discoveredScripts)}
                          onChange={e => {
                            const option = discoveredScripts.find(item => item.relative_path === e.target.value);
                            updateScript(script.id, {
                              script_path: e.target.value,
                              name: option && script.name === "Новый прогон" ? option.name : script.name,
                            });
                          }}
                          className={`${SMALL_INPUT_CLS} mb-2 font-mono`}
                        >
                          <option value="">Выберите скрипт из фреймворка</option>
                          {discoveredScripts.map(option => (
                            <option key={option.relative_path} value={option.relative_path}>
                              {option.relative_path}
                            </option>
                          ))}
                        </select>
                      )}
                      {scriptsLoading && (
                        <p className="mb-2 text-[11px] text-text-muted">Ищу скрипты в привязанном фреймворке...</p>
                      )}
                      {!scriptsLoading && frameworkAttached && discoveredScripts.length === 0 && (
                        <p className="mb-2 text-[11px] text-amber-700">
                          Скрипты не найдены автоматически. Укажите путь вручную или положите .sh/.py файл в папку фреймворка.
                        </p>
                      )}
                      {scriptsError && (
                        <p className="mb-2 text-[11px] text-red-600">{scriptsError}</p>
                      )}
                      <input
                        value={script.script_path}
                        onChange={e => updateScript(script.id, { script_path: e.target.value })}
                        placeholder={frameworkAttached ? "scripts/run-smoke.sh или /abs/path/run-smoke.sh" : "/Users/team/autotests/run-smoke.sh"}
                        className={`${SMALL_INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div>
                      <FieldHelp
                        label="Рабочая папка"
                        help="Папка, из которой будет выполнен скрипт. Если оставить пустой, используется путь фреймворка, а затем папка самого скрипта."
                      />
                      <input
                        value={script.work_dir}
                        onChange={e => updateScript(script.id, { work_dir: e.target.value })}
                        placeholder="/Users/team/autotests"
                        className={`${SMALL_INPUT_CLS} font-mono`}
                      />
                    </div>
                    <div>
                      <FieldHelp
                        label="Теги / фильтры скрипта"
                        help="Дополнительные теги, которые будут переданы в AUTOTEST_TAGS, если скрипт фреймворка умеет их читать. На кнопке показываются не они, а виды автотестов."
                      />
                      <input
                        value={joinCsv(script.default_tags)}
                        onChange={e => updateScript(script.id, { default_tags: splitCsv(e.target.value) })}
                        placeholder="smoke, payments"
                        className={SMALL_INPUT_CLS}
                      />
                    </div>
                    <div>
                      <FieldHelp
                        label="Микросервисы"
                        help="Список микросервисов, для которых кнопка применима. Значение * означает любой микросервис."
                      />
                      <input
                        value={joinCsv(script.microservices)}
                        onChange={e => updateScript(script.id, { microservices: splitCsv(e.target.value) })}
                        placeholder="payments, catalog, *"
                        className={SMALL_INPUT_CLS}
                      />
                    </div>
                    <div>
                      <FieldHelp
                        label="Что проверяет кнопка"
                        help="Виды автотестов, которые дежурный увидит на кнопке запуска. Эти значения также уходят в AUTOTEST_TYPES, но сам скрипт фреймворка остается главным источником логики запуска."
                      />
                      <TypeChips value={script.test_types} onChange={next => updateScript(script.id, { test_types: next })} />
                    </div>
                    <div>
                      <FieldHelp
                        label="Таймаут, сек"
                        help="Максимальное время ожидания завершения скрипта. Если прогон зависнет, backend остановит ожидание и вернет ошибку таймаута."
                      />
                      <input
                        type="number"
                        min={10}
                        max={86400}
                        value={script.timeout_sec}
                        onChange={e => updateScript(script.id, { timeout_sec: Number(e.target.value) || 1200 })}
                        className={SMALL_INPUT_CLS}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateScript(script.id, { enabled: !script.enabled })}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                      script.enabled ? "bg-emerald-50 text-emerald-700" : "bg-bg-muted text-text-muted"
                    }`}
                  >
                    {script.enabled ? "Выключить кнопку" : "Включить кнопку"}
                  </button>
                </div>
              )}
            </div>
          );
          })}
        </div>
      </div>

      <div className="border-t border-border-main pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-text-main">Автозапуск по обновлению сборки</h3>
            </div>
            <p className="mt-1 text-xs text-text-muted">SimpleTest смотрит на источник версий и запускает правила по имени микросервиса.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateConfig({ autorun: { ...config.autorun, enabled: !config.autorun.enabled } })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                config.autorun.enabled ? "bg-emerald-50 text-emerald-700" : "bg-bg-muted text-text-muted"
              }`}
            >
              {config.autorun.enabled ? "Автозапуск включен" : "Автозапуск выключен"}
            </button>
            <button
              type="button"
              onClick={() => setAutorunSettingsOpen(v => !v)}
              className={`rounded-lg border p-2 transition-colors ${
                autorunSettingsOpen
                  ? "border-teal-200 bg-teal-50 text-teal-700"
                  : "border-border-main text-text-muted hover:bg-bg-subtle"
              }`}
              aria-label="Настройки автозапуска"
              title="Открыть настройки автозапуска"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="rounded-lg bg-bg-muted px-2 py-1">
            Источник: {config.autorun.source_type === "url" ? "URL" : "Файл"}
          </span>
          <span className="rounded-lg bg-bg-muted px-2 py-1">
            Интервал: {config.autorun.poll_interval_sec} сек
          </span>
          <span className="rounded-lg bg-bg-muted px-2 py-1">
            Правил: {config.autorun.rules.length}
          </span>
          {config.autorun.last_check_at && (
            <span className="rounded-lg bg-bg-muted px-2 py-1">
              Последняя проверка: {new Date(config.autorun.last_check_at).toLocaleString("ru-RU")}
            </span>
          )}
        </div>

        {autorunSettingsOpen && (
          <div className="mb-4 rounded-lg border border-teal-100 bg-teal-50/40 p-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div>
                <FieldHelp
                  label="Где смотреть версии"
                  help="URL: SimpleTest делает GET-запрос. Файл: SimpleTest читает локальный файл на виртуальной машине. Формат источника разбирается регулярным выражением ниже."
                />
                <div className="flex rounded-lg bg-bg-muted p-1">
                  {(["url", "file"] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateConfig({ autorun: { ...config.autorun, source_type: type } })}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${
                        config.autorun.source_type === type ? "bg-bg-card text-primary shadow-sm" : "text-text-muted"
                      }`}
                    >
                      {type === "url" ? "URL" : "Файл"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lg:col-span-2">
                <FieldHelp
                  label={config.autorun.source_type === "url" ? "URL источника версий" : "Путь до файла версий"}
                  help="Источник должен содержать пары микросервис-версия. Например: payments=2.7.14 или catalog: 2026.05.02-18."
                />
                <input
                  value={config.autorun.source_type === "url" ? config.autorun.source_url : config.autorun.source_file_path}
                  onChange={e => updateConfig({
                    autorun: config.autorun.source_type === "url"
                      ? { ...config.autorun, source_url: e.target.value }
                      : { ...config.autorun, source_file_path: e.target.value },
                  })}
                  placeholder={config.autorun.source_type === "url" ? "https://stand.local/builds" : "/opt/stand/builds.txt"}
                  className={`${INPUT_CLS} bg-bg-card font-mono`}
                />
              </div>
              <div>
                <FieldHelp
                  label="Интервал проверки, сек"
                  help="Как часто backend будет проверять источник версий при включенном автозапуске. Минимально применяется 30 секунд."
                />
                <input
                  type="number"
                  min={30}
                  value={config.autorun.poll_interval_sec}
                  onChange={e => updateConfig({ autorun: { ...config.autorun, poll_interval_sec: Number(e.target.value) || 120 } })}
                  className={`${SMALL_INPUT_CLS} bg-bg-card`}
                />
              </div>
              <div className="lg:col-span-2">
                <FieldHelp
                  label="Регулярное выражение версии"
                  help="Regex должен вернуть группы microservice и version. По умолчанию подходят строки вида payments=1.2.3 или catalog: build-45."
                />
                <input
                  value={config.autorun.version_regex}
                  onChange={e => updateConfig({ autorun: { ...config.autorun, version_regex: e.target.value } })}
                  className={`${SMALL_INPUT_CLS} bg-bg-card font-mono`}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={config.autorun.run_on_first_seen}
                  onChange={e => updateConfig({ autorun: { ...config.autorun, run_on_first_seen: e.target.checked } })}
                  className="h-4 w-4 rounded border-border-main"
                />
                <span>Запускать при первом обнаружении сервиса</span>
                <span
                  title="Если выключено, первый найденный version baseline только запоминается. Следующий change уже запустит правила."
                  aria-label="Если выключено, первый найденный version baseline только запоминается. Следующий change уже запустит правила."
                >
                  <HelpCircle className="h-3.5 w-3.5 text-text-muted" />
                </span>
              </label>
            </div>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Правила микросервисов</h4>
          <button
            type="button"
            onClick={() => {
              const rule = emptyRule(config.scripts[0]?.id ?? "");
              rule.ui_order = sortedRules.length;
              updateConfig({
                autorun: {
                  ...config.autorun,
                  rules: [...config.autorun.rules, rule],
                },
              });
              setEditingRuleId(rule.id);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить правило
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {sortedRules.map((rule, index) => (
            <div
              key={rule.id}
              className={`${RULE_SIZE_CLASS[rule.ui_size ?? "md"]} min-w-[240px] rounded-lg border border-border-main bg-bg-card p-3`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${rule.enabled ? "bg-emerald-400" : "bg-bg-muted"}`} />
                    <p className="truncate text-sm font-semibold text-text-main">{rule.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {rule.microservice || "*"} · {ruleTagsLabel(rule)} · {ruleScriptTypesLabel(rule, launchScriptOptions)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-text-muted/80">
                    Кнопки: {rule.script_ids.map(id => launchScriptOptions.find(script => script.id === id)?.name ?? id).join(", ") || "не выбраны"}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveRule(rule.id, -1)}
                    disabled={index === 0}
                    className="rounded-md p-1 text-text-muted hover:bg-bg-subtle disabled:opacity-30"
                    aria-label="Сдвинуть правило левее"
                    title="Сдвинуть левее"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRule(rule.id, 1)}
                    disabled={index === sortedRules.length - 1}
                    className="rounded-md p-1 text-text-muted hover:bg-bg-subtle disabled:opacity-30"
                    aria-label="Сдвинуть правило правее"
                    title="Сдвинуть правее"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingRuleId(editingRuleId === rule.id ? "" : rule.id)}
                    className={`rounded-md border p-1.5 ${
                      editingRuleId === rule.id
                        ? "border-teal-200 bg-teal-50 text-teal-700"
                        : "border-border-main text-text-muted hover:bg-bg-subtle"
                    }`}
                    aria-label={`Настройки правила ${rule.name}`}
                    title="Открыть настройки правила"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateConfig({
                      autorun: {
                        ...config.autorun,
                        rules: config.autorun.rules.filter(r => r.id !== rule.id),
                      },
                    })}
                    className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500"
                    aria-label="Удалить правило"
                    title="Удалить правило"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {editingRuleId === rule.id && (
                <div className="mt-3 border-t border-border-main pt-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <FieldHelp
                        label="Имя правила"
                        help="Понятное название правила, чтобы джуниор видел, какой набор запускается при обновлении сборки."
                      />
                      <input value={rule.name} onChange={e => updateRule(rule.id, { name: e.target.value })} className={SMALL_INPUT_CLS} />
                    </div>
                    <div>
                      <FieldHelp
                        label="Размер карточки"
                        help="Меняет ширину карточки правила в списке. Положение меняется стрелками рядом с правилом."
                      />
                      <SizePicker value={rule.ui_size ?? "md"} onChange={next => updateRule(rule.id, { ui_size: next })} />
                    </div>
                    <div>
                      <FieldHelp
                        label="Микросервис"
                        help="Имя из источника версий. Значение * подходит для любого микросервиса."
                      />
                      <input value={rule.microservice} onChange={e => updateRule(rule.id, { microservice: e.target.value })} className={SMALL_INPUT_CLS} />
                    </div>
                    <div>
                      <FieldHelp
                        label="Теги правила"
                        help="Дополнительные теги для автозапуска. Если включен тег сервиса, при обновлении payments в AUTOTEST_TAGS автоматически добавится payments."
                      />
                      <input value={joinCsv(rule.tags)} onChange={e => updateRule(rule.id, { tags: splitCsv(e.target.value) })} className={SMALL_INPUT_CLS} />
                      <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                        <input
                          type="checkbox"
                          checked={rule.use_microservice_as_tag ?? true}
                          onChange={e => updateRule(rule.id, { use_microservice_as_tag: e.target.checked })}
                          className="h-4 w-4 rounded border-border-main"
                        />
                        <span>Добавлять имя сервиса как тег</span>
                        <span
                          title="Если источник сборок нашел payments=1.2.3, SimpleTest передаст тег payments в AUTOTEST_TAGS. Так запускаются кейсы, помеченные тем же тегом."
                          aria-label="Если источник сборок нашел payments=1.2.3, SimpleTest передаст тег payments в AUTOTEST_TAGS. Так запускаются кейсы, помеченные тем же тегом."
                        >
                          <HelpCircle className="h-3.5 w-3.5 text-text-muted" />
                        </span>
                      </label>
                    </div>
                    <div>
                      <FieldHelp
                        label="Какие кнопки запускать"
                        help="Выберите одну или несколько пользовательских кнопок запуска, которые будут вызваны при изменении версии этого микросервиса."
                      />
                      <select
                        value=""
                        onChange={e => {
                          const scriptId = e.target.value;
                          if (!scriptId || rule.script_ids.includes(scriptId)) return;
                          updateRule(rule.id, { script_ids: [...rule.script_ids, scriptId] });
                        }}
                        className={SMALL_INPUT_CLS}
                      >
                        <option value="">Добавить кнопку запуска</option>
                        {launchScriptOptions
                          .filter(script => !rule.script_ids.includes(script.id))
                          .map(script => (
                          <option key={script.id} value={script.id}>
                            {script.name} · {testTypeLabels(script.test_types)}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {rule.script_ids.map(scriptId => {
                          const selectedScript = launchScriptOptions.find(script => script.id === scriptId);
                          return (
                            <span
                              key={scriptId}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700"
                            >
                              <span>{selectedScript?.name ?? scriptId}</span>
                              <button
                                type="button"
                                onClick={() => updateRule(rule.id, { script_ids: rule.script_ids.filter(id => id !== scriptId) })}
                                className="rounded text-teal-500 hover:text-red-500"
                                aria-label={`Убрать ${selectedScript?.name ?? scriptId}`}
                                title="Убрать из правила"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                        {rule.script_ids.length === 0 && (
                          <span className="text-xs text-text-muted">Кнопки запуска не выбраны</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                    className={`mt-3 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                      rule.enabled ? "bg-emerald-50 text-emerald-700" : "bg-bg-muted text-text-muted"
                    }`}
                  >
                    {rule.enabled ? "Выключить правило" : "Включить правило"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-border-main bg-bg-subtle p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Аудит запусков</h4>
              {lastRun && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  lastRun.status === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}>
                  {auditName(lastRun)}: {lastRun.status}
                </span>
              )}
            </div>
            {(lastRun || history.length > 0) ? (
              <div className="space-y-1.5">
                {(lastRun ? [lastRun, ...history.filter(item => item.id !== lastRun.id)] : history).slice(0, 8).map(item => (
                <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-card px-2.5 py-2 text-xs text-text-muted">
                  <span className="font-mono text-[11px] text-text-muted">{formatAuditTime(item)}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${
                    (item.audit_type ?? item.trigger) === "autorun"
                      ? "bg-teal-50 text-teal-700"
                      : "bg-[var(--color-active-bg)] text-indigo-700"
                  }`}>
                    {auditKindLabel(item)}
                  </span>
                  <span className={item.status === "ok" ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
                    {item.status}
                  </span>
                  <span className="font-medium text-text-main">{auditName(item)}</span>
                  {(item.audit_type ?? item.trigger) === "autorun" && item.button_name && (
                    <span>кнопка: {item.button_name}</span>
                  )}
                  <span>{item.test_types?.join(", ") || "types -"}</span>
                  {(item.tags?.length ?? 0) > 0 && <span>теги: {item.tags.join(", ")}</span>}
                  {item.microservice && <span>{item.microservice}@{item.build_version}</span>}
                  <span>{Math.round(item.duration_ms / 1000)} сек</span>
                </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-bg-card px-2.5 py-2 text-xs text-text-muted">
                Запусков пока нет. Здесь появятся дата, время, кнопка или правило автозапуска после первого прогона.
              </p>
            )}
            {lastRun && lastRun.history_warning && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {lastRun.history_warning}
              </p>
            )}
            {lastRun && (lastRun.stdout || lastRun.stderr) && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-bg-card p-3 text-[11px] leading-relaxed text-text-main">
                {[lastRun.stdout, lastRun.stderr].filter(Boolean).join("\n")}
              </pre>
            )}
          </div>
      </div>
    </div>
  );
}
