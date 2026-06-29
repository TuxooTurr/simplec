"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle, CheckCircle2, ChevronRight, FilePlus2, FolderOpen, Loader2, Pencil, Play,
  Plus, RefreshCw, Save, Search, Settings2, Sparkles, Trash2, Zap,
} from "lucide-react";
import { analyzeProject, type ProjectAnalysis } from "@/lib/api";
import { Modal } from "@/components/ui";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import TestTree from "@/components/autotest/TestTree";
import {
  analyzeAutotestTree, checkAutotestBuilds, createAutotestScenario, getAutotestRunConfig,
  getAutotestRunHistory, getAutotestScriptOptions, getAutotestTestTree, runAutotestScript,
  saveAutotestRunConfig,
  type AutotestRunConfig, type AutotestType, type AutorunRuleConfig,
  type RunResult, type RunScriptConfig, type ScriptOption, type TestTreeResult,
} from "@/lib/autotestRunsApi";

const TEST_TYPES: Array<{ id: AutotestType; label: string }> = [
  { id: "api", label: "API" },
  { id: "e2e", label: "E2E" },
  { id: "frontend", label: "Frontend" },
  { id: "mobile", label: "Mobile" },
  { id: "dt", label: "Desktop" },
];

const INPUT =
  "w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] px-3 py-2 text-sm text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow";
const SMALL_INPUT =
  "w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 text-xs text-text-main " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function splitCsv(v: string) {
  return v.split(",").map((s) => s.trim()).filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
}
function joinCsv(v: string[]) { return v.join(", "); }
function typeLabels(v: AutotestType[]) {
  return v.map((t) => TEST_TYPES.find((x) => x.id === t)?.label ?? t).join(", ") || "не указаны";
}
function emptyScript(): RunScriptConfig {
  return {
    id: newId("script"), name: "Новый сценарий", script_path: "", work_dir: "",
    default_tags: [], test_types: ["api", "e2e"], microservices: ["*"],
    enabled: true, timeout_sec: 1200, ui_size: "md", ui_order: 0,
  };
}
function emptyRule(scriptId = ""): AutorunRuleConfig {
  return {
    id: newId("rule"), name: "Новое правило", microservice: "*",
    script_ids: scriptId ? [scriptId] : [], tags: [], use_microservice_as_tag: true,
    test_types: ["api", "e2e"], enabled: true, ui_size: "md", ui_order: 0,
  };
}

/* ── Collapsible card ────────────────────────────────────────────── */
function Section({
  icon, title, subtitle, open, onToggle, right, children,
}: {
  icon: ReactNode; title: string; subtitle?: string; open: boolean;
  onToggle: () => void; right?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border-main bg-bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="shrink-0 text-primary">{icon}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-main">{title}</span>
            {subtitle && <span className="block truncate text-xs text-text-muted">{subtitle}</span>}
          </span>
        </button>
        {right}
      </div>
      {open && <div className="border-t border-border-main p-4">{children}</div>}
    </div>
  );
}

function TypeChips({ value, onChange }: { value: AutotestType[]; onChange: (n: AutotestType[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TEST_TYPES.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
              on ? "border-primary/40 bg-primary/10 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function AutotestRunPanel() {
  const { provider } = useWorkspace();
  const [config, setConfig] = useState<AutotestRunConfig | null>(null);
  const [history, setHistory] = useState<RunResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // framework
  const [frameworkDraft, setFrameworkDraft] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);

  // test tree
  const [tree, setTree] = useState<TestTreeResult | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [llmAnalyzing, setLlmAnalyzing] = useState(false);
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());

  // run
  const [runnerId, setRunnerId] = useState("");
  const [runningId, setRunningId] = useState("");
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // create-scenario modal
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const [creatingScenario, setCreatingScenario] = useState(false);

  // runner editor
  const [discovered, setDiscovered] = useState<ScriptOption[]>([]);
  const [editingScriptId, setEditingScriptId] = useState("");
  const [editingRuleId, setEditingRuleId] = useState("");

  // section open states
  const [frameworkOpen, setFrameworkOpen] = useState(false);
  const [autorunOpen, setAutorunOpen] = useState(false);
  const [autorunAdvanced, setAutorunAdvanced] = useState(false);
  const [runnersOpen, setRunnersOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, hist] = await Promise.all([getAutotestRunConfig(), getAutotestRunHistory(12)]);
        if (!alive) return;
        setConfig(cfg);
        setFrameworkDraft(cfg.framework_path ?? "");
        setHistory(hist);
        if (!cfg.framework_path?.trim()) setFrameworkOpen(true);
      } catch (err) {
        if (alive) setMessage({ type: "error", text: String(err) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const frameworkPath = config?.framework_path?.trim() ?? "";

  // load test tree + discovered scripts when framework bound
  useEffect(() => {
    if (!frameworkPath) { setTree(null); setDiscovered([]); return; }
    let alive = true;
    setTreeLoading(true); setTreeError("");
    Promise.all([getAutotestTestTree(), getAutotestScriptOptions().catch(() => ({ root: "", options: [] }))])
      .then(([t, opts]) => {
        if (!alive) return;
        setTree(t);
        setDiscovered(opts.options ?? []);
      })
      .catch((err) => { if (alive) { setTree(null); setTreeError(err instanceof Error ? err.message : String(err)); } })
      .finally(() => { if (alive) setTreeLoading(false); });
    return () => { alive = false; };
  }, [frameworkPath]);

  const enabledRunners = useMemo(
    () => (config?.scripts ?? []).filter((s) => s.enabled && s.script_path.trim()),
    [config?.scripts],
  );
  // keep a valid runner selected
  useEffect(() => {
    if (enabledRunners.length === 0) { setRunnerId(""); return; }
    if (!enabledRunners.some((s) => s.id === runnerId)) setRunnerId(enabledRunners[0].id);
  }, [enabledRunners, runnerId]);

  if (loading || !config) {
    return (
      <div className="rounded-xl border border-border-main bg-bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаю запуск автотестов…
        </div>
      </div>
    );
  }

  const updateConfig = (patch: Partial<AutotestRunConfig>) =>
    setConfig((p) => (p ? { ...p, ...patch } : p));
  const updateScript = (id: string, patch: Partial<RunScriptConfig>) =>
    setConfig((p) => (p ? { ...p, scripts: p.scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : p));
  const updateRule = (id: string, patch: Partial<AutorunRuleConfig>) =>
    setConfig((p) => (p ? { ...p, autorun: { ...p.autorun, rules: p.autorun.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } } : p));

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const saved = await saveAutotestRunConfig(config);
      setConfig(saved); setFrameworkDraft(saved.framework_path ?? "");
      setMessage({ type: "ok", text: "Настройки сохранены" });
    } catch (err) { setMessage({ type: "error", text: String(err) }); }
    finally { setSaving(false); }
  };

  // LLM описывает найденные тесты понятными названиями (и кэширует их на сервере).
  const runAnalysis = async () => {
    if (!provider) {
      setMessage({ type: "error", text: "Выберите LLM-провайдера в левой панели, чтобы AI описал тесты." });
      return;
    }
    setLlmAnalyzing(true); setMessage(null);
    try {
      const res = await analyzeAutotestTree(provider);
      const t = await getAutotestTestTree();
      setTree(t);
      setMessage({
        type: "ok",
        text: res.analyzed ? `AI описал тест-кейсы понятными названиями (${res.total})` : "Подходящих тестов для анализа не найдено",
      });
    } catch (err) { setMessage({ type: "error", text: `Не удалось проанализировать тесты: ${err}` }); }
    finally { setLlmAnalyzing(false); }
  };

  const bindFramework = async () => {
    const next = frameworkDraft.trim();
    if (!next) return;
    setAnalyzing(true); setMessage(null);
    try {
      const data = await analyzeProject(next);
      const saved = await saveAutotestRunConfig({ ...config, framework_path: next });
      setConfig(saved); setFrameworkDraft(saved.framework_path ?? next); setAnalysis(data);
      setFrameworkOpen(false);
      setMessage({ type: "ok", text: `Папка с автотестами подключена (${data.build_tool})` });
      // Первое подключение — просим AI описать тесты понятными названиями.
      if (!saved.test_labels || Object.keys(saved.test_labels).length === 0) {
        void runAnalysis();
      }
    } catch (err) { setMessage({ type: "error", text: String(err) }); }
    finally { setAnalyzing(false); }
  };

  const detachFramework = async () => {
    if (!window.confirm("Отключить папку с автотестами?")) return;
    setSaving(true); setMessage(null);
    try {
      const saved = await saveAutotestRunConfig({ ...config, framework_path: "" });
      setConfig(saved); setFrameworkDraft(""); setAnalysis(null); setTree(null); setFrameworkOpen(true);
      setMessage({ type: "ok", text: "Папка отключена" });
    } catch (err) { setMessage({ type: "error", text: String(err) }); }
    finally { setSaving(false); }
  };

  const run = async () => {
    const runner = enabledRunners.find((s) => s.id === runnerId);
    if (!runner) { setMessage({ type: "error", text: "Нет включённого сценария запуска — добавьте его в «Настройке запуска»." }); setRunnersOpen(true); return; }
    setRunningId(runner.id); setMessage(null); setLogOpen(false);
    try {
      const saved = await saveAutotestRunConfig(config);
      setConfig(saved);
      const tests = [...selectedTests];
      const result = await runAutotestScript({
        script_id: runner.id, tags: runner.default_tags, test_types: runner.test_types, tests,
      });
      setLastRun(result);
      setHistory((prev) => [result, ...prev].slice(0, 12));
      setMessage({ type: result.status === "ok" ? "ok" : "error", text: result.status === "ok" ? "Прогон завершён успешно" : "Прогон завершился с ошибкой" });
    } catch (err) { setMessage({ type: "error", text: String(err) }); }
    finally { setRunningId(""); }
  };

  const createScenario = async () => {
    const name = scenarioName.trim();
    if (!name || selectedTests.size === 0) return;
    setCreatingScenario(true); setMessage(null);
    try {
      const res = await createAutotestScenario({
        name, tests: [...selectedTests],
        test_types: enabledRunners.find((s) => s.id === runnerId)?.test_types,
      });
      setConfig(res.config);
      setRunnerId(res.script.id);
      setScenarioOpen(false); setScenarioName("");
      setMessage({ type: "ok", text: `Сценарий «${res.script.name}» создан — скрипт: ${res.path}` });
    } catch (err) { setMessage({ type: "error", text: String(err) }); }
    finally { setCreatingScenario(false); }
  };

  const checkBuilds = async () => {
    setChecking(true); setMessage(null);
    try {
      const res = await checkAutotestBuilds(true);
      const runs = res.runs ?? [];
      if (runs.length > 0) { setLastRun(runs[0]); setHistory((prev) => [...runs, ...prev].slice(0, 12)); }
      setConfig((p) => (p ? { ...p, autorun: { ...p.autorun, last_seen: res.detected, last_check_at: res.checked_at } } : p));
      setMessage({ type: "ok", text: `Проверка завершена: изменений ${res.changes.length}, запусков ${runs.length}` });
    } catch (err) { setMessage({ type: "error", text: String(err) }); }
    finally { setChecking(false); }
  };

  const selectedCount = selectedTests.size;
  const runnerMissing = enabledRunners.length === 0;
  const runDisabled = Boolean(runningId) || runnerMissing;

  return (
    <div>
      {message && (
        <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
          message.type === "ok" ? "tone-success" : "tone-danger"
        }`}>
          {message.type === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* 1 — Framework folder */}
      <Section
        icon={<FolderOpen className="h-4 w-4" />}
        title="Папка с автотестами"
        subtitle={frameworkPath ? frameworkPath : "Не подключена — укажите путь к проекту автотестов"}
        open={frameworkOpen}
        onToggle={() => setFrameworkOpen((v) => !v)}
        right={
          frameworkPath ? (
            <span className="tone-success rounded-full border px-2 py-0.5 text-[11px] font-semibold">подключена</span>
          ) : (
            <span className="tone-warning rounded-full border px-2 py-0.5 text-[11px] font-semibold">нужна настройка</span>
          )
        }
      >
        <p className="mb-2 text-xs text-text-muted">
          Папка с Java/Kotlin-проектом автотестов. SimpleTest прочитает тест-классы и покажет их деревом ниже.
        </p>
        <div className="flex gap-2">
          <input value={frameworkDraft} onChange={(e) => setFrameworkDraft(e.target.value)}
            placeholder="/Users/team/autotests" className={`${INPUT} font-mono`} />
          <button type="button" onClick={bindFramework} disabled={analyzing || !frameworkDraft.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {frameworkPath ? "Переподключить" : "Подключить"}
          </button>
          {frameworkPath && (
            <button type="button" onClick={detachFramework} disabled={saving}
              className="rounded-lg border border-border-main px-3 py-2 text-sm font-semibold text-text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
              Отключить
            </button>
          )}
        </div>
        {analysis && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="tone-success rounded-full border px-2 py-0.5">{analysis.build_tool}</span>
            {analysis.test_dirs.slice(0, 3).map((d) => (
              <span key={d} className="tone-info rounded-full border px-2 py-0.5 font-mono">{d}</span>
            ))}
          </div>
        )}
      </Section>

      {!frameworkPath && (
        <div className="rounded-xl border border-dashed border-border-main bg-bg-card px-4 py-10 text-center text-sm text-text-muted">
          Подключите папку с автотестами выше — после этого появятся дерево тест-кейсов,
          запуск и автозапуск.
        </div>
      )}

      {frameworkPath && (<>
      {/* 2 — Test tree */}
      <div className="mb-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-text-main">Какие тесты запускать</h3>
          </div>
          {tree && tree.parseable && (
            <button type="button" onClick={runAnalysis} disabled={llmAnalyzing}
              title="AI опишет тесты понятными названиями"
              className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-50">
              {llmAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {llmAnalyzing ? "AI описывает…" : tree.analyzed ? "Обновить названия (AI)" : "Понятные названия (AI)"}
            </button>
          )}
        </div>
        {treeLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border-main bg-bg-card px-4 py-6 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Читаю тест-кейсы из фреймворка…
          </div>
        ) : treeError ? (
          <div className="tone-danger rounded-xl border px-4 py-4 text-sm">{treeError}</div>
        ) : tree && tree.parseable ? (
          <TestTree classes={tree.classes} allTags={tree.tags} total={tree.total} selected={selectedTests} onChange={setSelectedTests} />
        ) : (
          <div className="tone-warning rounded-xl border px-4 py-4 text-sm">
            JUnit-тесты не найдены автоматически. Можно запустить весь набор кнопкой ниже —
            сценарий запуска выполнит свою логику целиком.
          </div>
        )}
      </div>

      {/* 3 — Run */}
      <div className="mb-3 rounded-xl border border-border-main bg-bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">Чем запускать:</span>
            {runnerMissing ? (
              <button type="button" onClick={() => setRunnersOpen(true)} className="text-sm font-semibold text-primary hover:underline">
                добавить сценарий запуска →
              </button>
            ) : enabledRunners.length === 1 ? (
              <span className="text-sm font-semibold text-text-main">{enabledRunners[0].name}</span>
            ) : (
              <select value={runnerId} onChange={(e) => setRunnerId(e.target.value)}
                className="rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30">
                {enabledRunners.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <button type="button" onClick={() => { setScenarioName(""); setScenarioOpen(true); }}
                disabled={!frameworkPath}
                title="Создать скрипт-сценарий в папке автотестов из выбранных кейсов"
                className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2.5 text-sm font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-40
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <FilePlus2 className="h-4 w-4" /> Создать сценарий
              </button>
            )}
            <button type="button" onClick={run} disabled={runDisabled}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-dark hover:shadow-md active:scale-[0.98] disabled:opacity-40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-card">
              {runningId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {selectedCount > 0 ? `Запустить выбранное (${selectedCount})` : "Запустить весь набор"}
            </button>
          </div>
        </div>

        {lastRun && (
          <div className="mt-4 rounded-lg border border-border-main bg-bg-subtle p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${lastRun.status === "ok" ? "tone-success" : "tone-danger"}`}>
                {lastRun.status === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {lastRun.status === "ok" ? "Успешно" : "Ошибка"}
              </span>
              <span className="font-medium text-text-main">{lastRun.script_name}</span>
              <span className="text-text-muted">· {Math.round(lastRun.duration_ms / 1000)} сек</span>
              {(lastRun.tests?.length ?? 0) > 0 && <span className="text-text-muted">· кейсов: {lastRun.tests!.length}</span>}
              {lastRun.exit_code !== null && <span className="text-text-muted">· код выхода: {lastRun.exit_code}</span>}
            </div>
            {(lastRun.stdout || lastRun.stderr) && (
              <>
                <button type="button" onClick={() => setLogOpen((v) => !v)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text-main">
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${logOpen ? "rotate-90" : ""}`} />
                  {logOpen ? "Скрыть лог" : "Показать лог"}
                </button>
                {logOpen && (
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-bg-card p-3 text-[11px] leading-relaxed text-text-main">
                    {[lastRun.stdout, lastRun.stderr].filter(Boolean).join("\n")}
                  </pre>
                )}
              </>
            )}
            {lastRun.history_warning && (
              <p className="tone-warning mt-2 rounded-lg border px-3 py-2 text-xs">{lastRun.history_warning}</p>
            )}
          </div>
        )}
      </div>

      {/* 4 — Autorun */}
      <Section
        icon={<RefreshCw className="h-4 w-4" />}
        title="Автозапуск при новой сборке"
        subtitle={config.autorun.enabled ? `Включён · правил: ${config.autorun.rules.length}` : "Выключен"}
        open={autorunOpen}
        onToggle={() => setAutorunOpen((v) => !v)}
        right={
          <button type="button"
            onClick={() => updateConfig({ autorun: { ...config.autorun, enabled: !config.autorun.enabled } })}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${config.autorun.enabled ? "tone-success border" : "tone-neutral border"}`}>
            {config.autorun.enabled ? "включён" : "выключен"}
          </button>
        }
      >
        <p className="mb-3 text-xs text-text-muted">
          SimpleTest следит за версиями сборок и сам запускает нужный сценарий, когда выходит новая сборка сервиса.
        </p>

        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Правила</h4>
          <button type="button"
            onClick={() => {
              const rule = emptyRule(enabledRunners[0]?.id ?? "");
              updateConfig({ autorun: { ...config.autorun, rules: [...config.autorun.rules, rule] } });
              setEditingRuleId(rule.id);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Plus className="h-3.5 w-3.5" /> Добавить правило
          </button>
        </div>

        <div className="space-y-2">
          {config.autorun.rules.length === 0 && (
            <p className="rounded-lg bg-bg-subtle px-3 py-2 text-xs text-text-muted">Правил пока нет.</p>
          )}
          {config.autorun.rules.map((rule) => {
            const runnerNames = rule.script_ids
              .map((id) => config.scripts.find((s) => s.id === id)?.name ?? id)
              .join(", ") || "сценарий не выбран";
            const editing = editingRuleId === rule.id;
            return (
              <div key={rule.id} className="rounded-lg border border-border-main bg-bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-text-main">
                    Когда выходит новая сборка сервиса{" "}
                    <span className="font-semibold text-primary">{rule.microservice || "*"}</span>{" "}
                    → запускать <span className="font-semibold">{runnerNames}</span>
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setEditingRuleId(editing ? "" : rule.id)}
                      className={`rounded-md border p-1.5 ${editing ? "border-primary/40 bg-primary/10 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"}`}
                      aria-label="Настроить правило"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button"
                      onClick={() => updateConfig({ autorun: { ...config.autorun, rules: config.autorun.rules.filter((r) => r.id !== rule.id) } })}
                      className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500" aria-label="Удалить правило">
                      <Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {editing && (
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border-main pt-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Название правила</label>
                      <input value={rule.name} onChange={(e) => updateRule(rule.id, { name: e.target.value })} className={SMALL_INPUT} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Имя сервиса (или * для любого)</label>
                      <input value={rule.microservice} onChange={(e) => updateRule(rule.id, { microservice: e.target.value })} className={SMALL_INPUT} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Чем запускать</label>
                      <select value="" onChange={(e) => {
                        const id = e.target.value;
                        if (id && !rule.script_ids.includes(id)) updateRule(rule.id, { script_ids: [...rule.script_ids, id] });
                      }} className={SMALL_INPUT}>
                        <option value="">Добавить сценарий…</option>
                        {config.scripts.filter((s) => !rule.script_ids.includes(s.id)).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {rule.script_ids.map((id) => {
                          const s = config.scripts.find((x) => x.id === id);
                          return (
                            <span key={id} className="tone-success inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold">
                              {s?.name ?? id}
                              <button type="button" onClick={() => updateRule(rule.id, { script_ids: rule.script_ids.filter((x) => x !== id) })}
                                className="hover:text-red-500" aria-label="Убрать">×</button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                        className="h-4 w-4 rounded border-border-main text-primary" />
                      Правило включено
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Advanced autorun */}
        <button type="button" onClick={() => setAutorunAdvanced((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text-main">
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${autorunAdvanced ? "rotate-90" : ""}`} />
          Продвинутая настройка (источник версий, интервал, формат)
        </button>
        {autorunAdvanced && (
          <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-border-main bg-bg-subtle p-3 lg:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-muted">Где смотреть версии</label>
              <div className="flex rounded-lg bg-bg-muted p-1">
                {(["url", "file"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => updateConfig({ autorun: { ...config.autorun, source_type: t } })}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${config.autorun.source_type === t ? "bg-bg-card text-primary shadow-sm" : "text-text-muted"}`}>
                    {t === "url" ? "URL" : "Файл"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-muted">Интервал проверки, сек</label>
              <input type="number" min={30} value={config.autorun.poll_interval_sec}
                onChange={(e) => updateConfig({ autorun: { ...config.autorun, poll_interval_sec: Number(e.target.value) || 120 } })} className={SMALL_INPUT} />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-text-muted">
                {config.autorun.source_type === "url" ? "URL источника версий" : "Путь до файла версий"}
              </label>
              <input value={config.autorun.source_type === "url" ? config.autorun.source_url : config.autorun.source_file_path}
                onChange={(e) => updateConfig({ autorun: config.autorun.source_type === "url"
                  ? { ...config.autorun, source_url: e.target.value }
                  : { ...config.autorun, source_file_path: e.target.value } })}
                placeholder={config.autorun.source_type === "url" ? "https://stand.local/builds" : "/opt/stand/builds.txt"}
                className={`${SMALL_INPUT} font-mono`} />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-text-muted">Формат версий (регулярное выражение)</label>
              <input value={config.autorun.version_regex}
                onChange={(e) => updateConfig({ autorun: { ...config.autorun, version_regex: e.target.value } })} className={`${SMALL_INPUT} font-mono`} />
            </div>
            <label className="flex items-center gap-2 text-xs text-text-muted lg:col-span-2">
              <input type="checkbox" checked={config.autorun.run_on_first_seen}
                onChange={(e) => updateConfig({ autorun: { ...config.autorun, run_on_first_seen: e.target.checked } })}
                className="h-4 w-4 rounded border-border-main text-primary" />
              Запускать уже при первом обнаружении сервиса
            </label>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={checkBuilds} disabled={checking}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-50">
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Проверить сейчас
          </button>
          {config.autorun.last_check_at && (
            <span className="text-xs text-text-muted">
              последняя проверка: {new Date(config.autorun.last_check_at).toLocaleString("ru-RU")}
            </span>
          )}
        </div>
      </Section>

      {/* 5 — Runner setup (advanced) */}
      <Section
        icon={<Settings2 className="h-4 w-4" />}
        title="Настройка запуска"
        subtitle={`Сценарии запуска: ${config.scripts.length}`}
        open={runnersOpen}
        onToggle={() => setRunnersOpen((v) => !v)}
        right={
          <button type="button" onClick={(e) => { e.stopPropagation();
            const s = emptyScript(); updateConfig({ scripts: [...config.scripts, s] }); setEditingScriptId(s.id); setRunnersOpen(true);
          }} className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Plus className="h-3.5 w-3.5" /> Сценарий
          </button>
        }
      >
        <p className="mb-3 text-xs text-text-muted">
          Сценарий запуска — это команда/скрипт фреймворка, который реально выполняет тесты. Выбранные в дереве кейсы
          передаются ему через переменную <span className="font-mono">AUTOTEST_TESTS</span>.
        </p>
        <div className="space-y-2">
          {config.scripts.length === 0 && (
            <p className="rounded-lg bg-bg-subtle px-3 py-2 text-xs text-text-muted">Сценариев пока нет — добавьте первый.</p>
          )}
          {config.scripts.map((script) => {
            const editing = editingScriptId === script.id;
            return (
              <div key={script.id} className="rounded-lg border border-border-main bg-bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${script.enabled ? "bg-emerald-500" : "bg-bg-muted"}`} />
                    <span className="truncate text-sm font-medium text-text-main">{script.name}</span>
                    <span className="truncate text-xs text-text-muted">· {typeLabels(script.test_types)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setEditingScriptId(editing ? "" : script.id)}
                      className={`rounded-md border p-1.5 ${editing ? "border-primary/40 bg-primary/10 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"}`}
                      aria-label="Настроить сценарий"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => updateConfig({ scripts: config.scripts.filter((s) => s.id !== script.id) })}
                      className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500" aria-label="Удалить сценарий">
                      <Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {editing && (
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border-main pt-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Название</label>
                      <input value={script.name} onChange={(e) => updateScript(script.id, { name: e.target.value })} className={SMALL_INPUT} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Скрипт запуска</label>
                      {discovered.length > 0 && (
                        <select value={discovered.find((o) => o.relative_path === script.script_path || o.path === script.script_path)?.relative_path ?? ""}
                          onChange={(e) => {
                            const opt = discovered.find((o) => o.relative_path === e.target.value);
                            updateScript(script.id, { script_path: e.target.value, name: opt && script.name === "Новый сценарий" ? opt.name : script.name });
                          }} className={`${SMALL_INPUT} mb-2 font-mono`}>
                          <option value="">Выбрать из фреймворка…</option>
                          {discovered.map((o) => <option key={o.relative_path} value={o.relative_path}>{o.relative_path}</option>)}
                        </select>
                      )}
                      <input value={script.script_path} onChange={(e) => updateScript(script.id, { script_path: e.target.value })}
                        placeholder="scripts/run.sh" className={`${SMALL_INPUT} font-mono`} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Рабочая папка (необязательно)</label>
                      <input value={script.work_dir} onChange={(e) => updateScript(script.id, { work_dir: e.target.value })}
                        placeholder="по умолчанию — папка фреймворка" className={`${SMALL_INPUT} font-mono`} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Таймаут, сек</label>
                      <input type="number" min={10} max={86400} value={script.timeout_sec}
                        onChange={(e) => updateScript(script.id, { timeout_sec: Number(e.target.value) || 1200 })} className={SMALL_INPUT} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Виды тестов</label>
                      <TypeChips value={script.test_types} onChange={(n) => updateScript(script.id, { test_types: n })} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-text-muted">Доп. теги (через запятую, необязательно)</label>
                      <input value={joinCsv(script.default_tags)} onChange={(e) => updateScript(script.id, { default_tags: splitCsv(e.target.value) })}
                        placeholder="smoke, payments" className={SMALL_INPUT} />
                    </div>
                    <button type="button" onClick={() => updateScript(script.id, { enabled: !script.enabled })}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${script.enabled ? "tone-success border" : "tone-neutral border"}`}>
                      {script.enabled ? "Включён" : "Выключен"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Save bar */}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-card">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить настройки
        </button>
      </div>
      </>)}

      <Modal open={scenarioOpen} onClose={() => setScenarioOpen(false)} title="Создать сценарий запуска">
        <p className="mb-3 text-sm text-text-muted">
          В папке автотестов будет создан скрипт, запускающий выбранные кейсы
          (<span className="font-semibold text-text-main">{selectedCount}</span>), и добавлен сюда как сценарий.
        </p>
        <label className="mb-1 block text-xs font-semibold text-text-muted">Название сценария</label>
        <input
          autoFocus
          value={scenarioName}
          onChange={(e) => setScenarioName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createScenario(); }}
          placeholder="Например: Smoke оплаты"
          className={INPUT}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setScenarioOpen(false)}
            className="rounded-lg border border-border-main px-3 py-2 text-sm font-semibold text-text-muted hover:bg-bg-subtle">
            Отмена
          </button>
          <button type="button" onClick={createScenario} disabled={creatingScenario || !scenarioName.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {creatingScenario ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
            Создать
          </button>
        </div>
      </Modal>
    </div>
  );
}
