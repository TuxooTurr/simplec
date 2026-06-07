"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Eye, EyeOff, Save, Settings, Plus, Trash2,
  Zap, Database, Radio, Server, Shield, ChevronDown, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Play, ScrollText, Pencil,
  Smartphone,
} from "lucide-react";
import {
  getSettings, saveSettings,
  getCustomLlmProviders, saveCustomLlmProvider, deleteCustomLlmProvider,
  getRevisorStands, saveRevisorStand, deleteRevisorStand,
  getLogsVpsConnections, saveLogsVpsConnection, deleteLogsVpsConnection,
  testLlmConnection, testKafkaAlerts, testKafkaMetrics, testChromaDb, testPostgres,
  testRevisorStand, testLogsVpsConnection, testFarm,
  type SettingsMap, type CustomLlmProvider, type RevisorStandConfig, type RevisorMethodDef,
  type TestResult, type LogsVpsConnection,
} from "@/lib/settingsApi";
import {
  getProviders, type ProviderStatus,
  listTestDataConnections, createTestDataConnection, updateTestDataConnection,
  deleteTestDataConnection, testTestDataConnection, introspectTestDataConnection,
  type TestDataConnection, type TestDataConnectionCreate,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// ── Style constants ───────────────────────────────────────────────────────────

const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";
const INPUT_CLS =
  "w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition";
const SELECT_CLS =
  "w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg bg-bg-card " +
  "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition";

const MASKED_PLACEHOLDER = "●●●●●●●●●●●●";

const SECRET_KEYS = new Set([
  "gigachat_auth_key", "deepseek_api_key",
  "kafka_sasl_password", "kafka_ssl_password",
  "alerts_kafka_sasl_password", "alerts_kafka_ssl_password",
]);

// ── Field definitions ─────────────────────────────────────────────────────────

interface FieldDef {
  key: string; label: string;
  type?: "text" | "password" | "select";
  options?: string[];
}

const GIGACHAT_FIELDS: FieldDef[] = [
  { key: "gigachat_auth_key", label: "AUTH_KEY", type: "password" },
];

const DEEPSEEK_FIELDS: FieldDef[] = [
  { key: "deepseek_api_key", label: "API Key", type: "password" },
];

// ── Provider presets — Top-10 нейросетей ─────────────────────────────────────

interface ProviderPreset {
  id: string;
  name: string;
  color: string;
  iconLetter: string;
  logo: string;           // path to /logos/{id}.svg
  base_url: string;
  model: string;
  models: string[];       // available models for selection
  apiKeyLabel: string;
  builtin?: boolean;
  settingsKey?: string;
  modelSettingsKey?: string;
  noKeyNeeded?: boolean;
}

/* Brand logo from /public/logos/ — real SVG logos */
function ProviderIcon({ preset, size = 20 }: { preset: ProviderPreset; size?: number }) {
  return (
    <img
      src={preset.logo}
      alt={preset.name}
      width={size}
      height={size}
      className="flex-shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "gigachat", name: "GigaChat", color: "#21A038", iconLetter: "G",
    logo: "/logos/gigachat.svg",
    base_url: "", model: "GigaChat",
    models: ["GigaChat", "GigaChat-Pro", "GigaChat-Max"],
    apiKeyLabel: "AUTH_KEY (Base64 из СберID)", builtin: true, settingsKey: "gigachat_auth_key", modelSettingsKey: "gigachat_model",
  },
  {
    id: "deepseek", name: "DeepSeek", color: "#4D6BFE", iconLetter: "D",
    logo: "/logos/deepseek.svg",
    base_url: "https://api.deepseek.com/v1", model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    apiKeyLabel: "API Key", builtin: true, settingsKey: "deepseek_api_key", modelSettingsKey: "deepseek_model",
  },
  {
    id: "openai", name: "OpenAI", color: "#000000", iconLetter: "O",
    logo: "/logos/openai.svg",
    base_url: "https://api.openai.com/v1", model: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3-mini", "gpt-3.5-turbo"],
    apiKeyLabel: "API Key",
  },
  {
    id: "gemini", name: "Google Gemini", color: "#1A73E8", iconLetter: "G",
    logo: "/logos/gemini.svg",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    apiKeyLabel: "API Key",
  },
  {
    id: "mistral", name: "Mistral AI", color: "#FF7000", iconLetter: "M",
    logo: "/logos/mistral.svg",
    base_url: "https://api.mistral.ai/v1", model: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest", "pixtral-large-latest"],
    apiKeyLabel: "API Key",
  },
  {
    id: "groq", name: "Groq", color: "#F55036", iconLetter: "G",
    logo: "/logos/groq.svg",
    base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    apiKeyLabel: "API Key",
  },
  {
    id: "xai", name: "xAI Grok", color: "#000000", iconLetter: "X",
    logo: "/logos/xai.svg",
    base_url: "https://api.x.ai/v1", model: "grok-3-mini",
    models: ["grok-3-mini", "grok-3", "grok-2"],
    apiKeyLabel: "API Key",
  },
  {
    id: "together", name: "Together AI", color: "#6366F1", iconLetter: "T",
    logo: "/logos/together.svg",
    base_url: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "meta-llama/Llama-3.1-8B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
    apiKeyLabel: "API Key",
  },
  {
    id: "openrouter", name: "OpenRouter", color: "#6C3AED", iconLetter: "R",
    logo: "/logos/openrouter.svg",
    base_url: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct"],
    apiKeyLabel: "API Key",
  },
  {
    id: "ollama", name: "Ollama (локально)", color: "#333333", iconLetter: "🦙",
    logo: "/logos/ollama.svg",
    base_url: "http://localhost:11434/v1", model: "llama3.1:latest",
    models: ["llama3.1:latest", "llama3.2:latest", "mistral:latest", "gemma2:latest", "qwen2.5:latest", "codellama:latest"],
    apiKeyLabel: "Не требуется", noKeyNeeded: true,
  },
];

/* Status priority for sorting: green=0, yellow=1, unknown=2, red=3 */
function statusOrder(s?: string): number {
  if (s === "green") return 0;
  if (s === "yellow") return 1;
  if (s === "red") return 3;
  return 2; // unknown
}

const METRICS_KAFKA_FIELDS: FieldDef[] = [
  { key: "kafka_bootstrap_servers", label: "Bootstrap servers" },
  { key: "kafka_security_protocol", label: "Security protocol", type: "select", options: ["PLAINTEXT", "SASL_PLAINTEXT", "SASL_SSL", "SSL"] },
  { key: "kafka_sasl_mechanism", label: "SASL механизм", type: "select", options: ["", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "GSSAPI"] },
  { key: "kafka_sasl_username", label: "SASL логин" },
  { key: "kafka_sasl_password", label: "SASL пароль", type: "password" },
  { key: "kafka_ssl_cafile", label: "SSL CA файл" },
  { key: "kafka_ssl_certfile", label: "SSL client cert" },
  { key: "kafka_ssl_keyfile", label: "SSL client key" },
  { key: "kafka_ssl_password", label: "SSL key password", type: "password" },
  { key: "kafka_topic_data", label: "Топик DATA" },
  { key: "kafka_topic_metadata", label: "Топик METADATA" },
  { key: "kafka_topic_thresholds", label: "Топик THRESHOLDS" },
];

const ALERTS_KAFKA_FIELDS: FieldDef[] = [
  { key: "alerts_kafka_bootstrap_servers", label: "Bootstrap servers" },
  { key: "alerts_kafka_security_protocol", label: "Security protocol", type: "select", options: ["PLAINTEXT", "SASL_PLAINTEXT", "SASL_SSL", "SSL"] },
  { key: "alerts_kafka_sasl_mechanism", label: "SASL механизм", type: "select", options: ["", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "GSSAPI"] },
  { key: "alerts_kafka_sasl_username", label: "SASL логин" },
  { key: "alerts_kafka_sasl_password", label: "SASL пароль", type: "password" },
  { key: "alerts_kafka_ssl_cafile", label: "SSL CA файл" },
  { key: "alerts_kafka_ssl_certfile", label: "SSL client cert" },
  { key: "alerts_kafka_ssl_keyfile", label: "SSL client key" },
  { key: "alerts_kafka_ssl_password", label: "SSL key password", type: "password" },
];

const FARM_FIELDS: FieldDef[] = [
  { key: "farm_max_sessions_per_user", label: "Макс. сессий на пользователя" },
  { key: "farm_session_timeout_min", label: "Таймаут сессии (мин)" },
];

// ── Shared components ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "green" | "yellow" | "red" | "unknown" }) {
  const cls = {
    green: "bg-green-500",
    yellow: "bg-yellow-400",
    red: "bg-red-500",
    unknown: "bg-bg-muted",
  }[status];
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${cls}`} />;
}

function StatusBadge({ result, loading }: { result: TestResult | null; loading: boolean }) {
  if (loading) return (
    <span className="flex items-center gap-1.5 text-xs text-text-muted">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Проверка...
    </span>
  );
  if (!result) return null;
  const icon = result.status === "green"
    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
    : result.status === "yellow"
    ? <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
    : <XCircle className="w-3.5 h-3.5 text-red-500" />;
  const color = result.status === "green" ? "text-green-600" : result.status === "yellow" ? "text-yellow-600" : "text-red-500";
  return (
    <span className={`flex items-center gap-1.5 text-xs ${color}`}>
      {icon} {result.message}
    </span>
  );
}

function TestButton({ onClick, loading, label }: { onClick: () => void; loading: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border-main rounded-lg
        text-text-main hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
      {label ?? "Тест"}
    </button>
  );
}

function PasswordInput({ fieldKey, value, onChange, placeholder }: {
  fieldKey: string; value: string; onChange: (key: string, val: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} className={INPUT_CLS + " pr-8"}
        value={value}
        onChange={(e) => { if (e.target.value !== MASKED_PLACEHOLDER) onChange(fieldKey, e.target.value); }}
        onFocus={(e) => { if (e.target.value === MASKED_PLACEHOLDER) onChange(fieldKey, ""); }}
        placeholder={placeholder ?? ""} autoComplete="off" spellCheck={false} />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
        title={show ? "Скрыть" : "Показать"}>
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function renderField(f: FieldDef, values: Record<string, string>, descriptions: Record<string, string>, onChange: (k: string, v: string) => void) {
  const val = values[f.key] ?? "";
  const isSecret = SECRET_KEYS.has(f.key);
  const desc = descriptions[f.key] ?? "";
  return (
    <div key={f.key}>
      <label className={LABEL_CLS}>
        {f.label}
        {isSecret && <span className="ml-1 text-[10px] text-text-muted/60 font-normal">(секрет)</span>}
      </label>
      {isSecret || f.type === "password" ? (
        <PasswordInput fieldKey={f.key} value={val} onChange={onChange} placeholder={desc} />
      ) : f.type === "select" && f.options ? (
        <select className={SELECT_CLS} value={val} onChange={(e) => onChange(f.key, e.target.value)}>
          {f.options.map((o) => <option key={o} value={o}>{o || "— не задано —"}</option>)}
        </select>
      ) : (
        <input type="text" className={INPUT_CLS} value={val} onChange={(e) => onChange(f.key, e.target.value)}
          placeholder={desc} spellCheck={false} />
      )}
    </div>
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── Section wrapper ─────────────────────────────────────────────────────────

function SectionCard({
  icon, title, subtitle, status, children, defaultOpen = false,
  headerRight,
}: {
  icon: React.ReactNode; title: string; subtitle?: string;
  status?: "green" | "yellow" | "red" | "unknown";
  children: React.ReactNode;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-bg-subtle/50 transition-colors cursor-pointer select-none"
      >
        <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-main">{title}</h2>
            {status && <StatusDot status={status} />}
          </div>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {headerRight && <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>{headerRight}</div>}
        <ChevronDown className={`w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </div>
      {open && <div className="border-t border-border-main px-5 py-4">{children}</div>}
    </div>
  );
}

function SaveBar({ status, errMsg, onSave, saving }: {
  status: SaveStatus; errMsg: string; onSave: () => void; saving: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-main mt-4">
      {status === "saved" && <span className="text-xs text-green-600 font-medium">Сохранено</span>}
      {status === "error" && <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>}
      <button onClick={onSave} disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary text-white rounded-lg
          hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
        <Save className="w-3 h-3" /> {saving ? "Сохраняю..." : "Сохранить"}
      </button>
    </div>
  );
}

// ── Unified LLM Providers ──────────────────────────────────────────────────

function UnifiedLlmProviders({
  builtinValues, customProviders, onSaveBuiltin, onSaveCustom, onDeleteCustom, onRefresh,
}: {
  builtinValues: Record<string, string>;
  customProviders: CustomLlmProvider[];
  onSaveBuiltin: (key: string, value: string) => Promise<void>;
  onSaveCustom: (p: CustomLlmProvider) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [selectedPreset, setSelectedPreset] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");

  // ─── Auto-refresh: poll statuses on same interval as status requests ───
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runStatusChecks = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      try {
        const r = await testLlmConnection(id);
        setTestResults(prev => ({ ...prev, [id]: r }));
      } catch {
        // silent fail for auto-refresh
      }
    }
  }, []);

  useEffect(() => {
    // Initial status check for all providers
    const allIds: string[] = [];
    allIds.push("gigachat", "deepseek");
    for (const cp of customProviders) allIds.push(cp.id ?? cp.name);
    runStatusChecks(allIds);

    // Auto-refresh every 60s
    autoRefreshRef.current = setInterval(() => {
      const ids: string[] = ["gigachat", "deepseek"];
      for (const cp of customProviders) ids.push(cp.id ?? cp.name);
      runStatusChecks(ids);
    }, 60000);

    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [customProviders, runStatusChecks]);

  // Build list of active providers
  type ActiveProvider = { id: string; name: string; model: string; hasKey: boolean; builtin?: boolean; preset?: ProviderPreset };
  const activeProviders: ActiveProvider[] = [];

  // Built-in: GigaChat
  const gcPreset = PROVIDER_PRESETS.find(p => p.id === "gigachat")!;
  const gcHasKey = !!(builtinValues["gigachat_auth_key"] && builtinValues["gigachat_auth_key"] !== "");
  activeProviders.push({ id: "gigachat", name: gcPreset.name, model: builtinValues["gigachat_model"] || gcPreset.model, hasKey: gcHasKey, builtin: true, preset: gcPreset });

  // Built-in: DeepSeek
  const dsPreset = PROVIDER_PRESETS.find(p => p.id === "deepseek")!;
  const dsHasKey = !!(builtinValues["deepseek_api_key"] && builtinValues["deepseek_api_key"] !== "");
  activeProviders.push({ id: "deepseek", name: dsPreset.name, model: builtinValues["deepseek_model"] || dsPreset.model, hasKey: dsHasKey, builtin: true, preset: dsPreset });

  // Custom providers
  for (const cp of customProviders) {
    const preset = PROVIDER_PRESETS.find(p => "custom_" + p.id === cp.id);
    activeProviders.push({
      id: cp.id ?? cp.name,
      name: preset?.name ?? cp.name,
      model: cp.model,
      hasKey: !!(cp.api_key && cp.api_key !== MASKED_PLACEHOLDER),
      preset,
    });
  }

  // Sort: green → yellow → unknown → red (by actual test result)
  const sortedProviders = [...activeProviders].sort((a, b) => {
    const orderA = statusOrder(testResults[a.id]?.status);
    const orderB = statusOrder(testResults[b.id]?.status);
    return orderA - orderB;
  });

  // Available presets (not yet added as custom — exclude builtin as they're always shown)
  const addedCustomIds = new Set(customProviders.map(cp => cp.id));
  const availablePresets = PROVIDER_PRESETS.filter(p =>
    !p.builtin && !addedCustomIds.has("custom_" + p.id)
  );

  async function handleTest(providerId: string) {
    setTesting(providerId);
    try {
      const r = await testLlmConnection(providerId);
      setTestResults(prev => ({ ...prev, [providerId]: r }));
      // On successful test — immediately refresh provider statuses in sidebar
      if (r.status === "green") await onRefresh();
    } catch {
      setTestResults(prev => ({ ...prev, [providerId]: { status: "red", message: "Ошибка запроса" } }));
    } finally { setTesting(null); }
  }

  async function handleAdd() {
    if (!selectedPreset) return;
    const preset = PROVIDER_PRESETS.find(p => p.id === selectedPreset);
    if (!preset) return;
    if (!preset.noKeyNeeded && !apiKey.trim()) { setErrMsg("Введите API-ключ"); return; }

    setSaving(true); setErrMsg(""); setSaved(false);
    try {
      if (preset.builtin && preset.settingsKey) {
        await onSaveBuiltin(preset.settingsKey, apiKey.trim());
      } else {
        await onSaveCustom({
          id: "custom_" + preset.id,
          name: preset.name,
          base_url: preset.base_url,
          model: preset.model,
          auth_type: "api_key",
          api_key: preset.noKeyNeeded ? "ollama" : apiKey.trim(),
        });
      }
      await onRefresh();
      setSelectedPreset(""); setApiKey("");
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function handleUpdateKey(provider: ActiveProvider, newKey: string) {
    if (!newKey.trim()) return;
    setSaving(true); setErrMsg("");
    try {
      if (provider.builtin && provider.preset?.settingsKey) {
        await onSaveBuiltin(provider.preset.settingsKey, newKey.trim());
      } else {
        const cp = customProviders.find(c => c.id === provider.id);
        if (cp) await onSaveCustom({ ...cp, api_key: newKey.trim() });
      }
      await onRefresh();
      setEditingId(null); setEditKey("");
    } catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function handleModelChange(provider: ActiveProvider, newModel: string) {
    setSaving(true); setErrMsg("");
    try {
      if (provider.builtin && provider.preset?.modelSettingsKey) {
        await onSaveBuiltin(provider.preset.modelSettingsKey, newModel);
      } else {
        const cp = customProviders.find(c => c.id === provider.id);
        if (cp) await onSaveCustom({ ...cp, model: newModel });
      }
      await onRefresh();
    } catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function handleDelete(providerId: string) {
    try { await onDeleteCustom(providerId); await onRefresh(); }
    catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
  }

  const curPreset = PROVIDER_PRESETS.find(p => p.id === selectedPreset);

  return (
    <div className="space-y-4">
      {/* Active providers — sorted by status */}
      <div className="border border-border-main rounded-lg divide-y divide-border-main overflow-hidden">
        {sortedProviders.map((p) => {
          const tr = testResults[p.id];
          const hasKeyOrNoNeed = p.hasKey || p.preset?.noKeyNeeded;
          const providerStatus = hasKeyOrNoNeed ? (tr?.status ?? "unknown") : "red";
          const models = p.preset?.models ?? [];
          return (
            <div key={p.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                {p.preset ? <ProviderIcon preset={p.preset} /> : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-400 text-white text-[10px] font-bold">?</span>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-main">{p.name}</p>
                  {/* Model selector or plain text */}
                  {models.length > 1 ? (
                    <select
                      className="text-xs text-text-muted bg-transparent border-none p-0 focus:outline-none focus:ring-0 cursor-pointer hover:text-primary transition-colors"
                      value={p.model}
                      onChange={(e) => handleModelChange(p, e.target.value)}
                    >
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <p className="text-xs text-text-muted">{p.model}{!hasKeyOrNoNeed ? " · нет ключа" : ""}</p>
                  )}
                </div>
                <StatusBadge result={tr ?? null} loading={testing === p.id} />
                <TestButton onClick={() => handleTest(p.id)} loading={testing === p.id} />
                <button
                  onClick={() => { setEditingId(editingId === p.id ? null : p.id); setEditKey(""); }}
                  className="px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle"
                >
                  {editingId === p.id ? "Отмена" : "Ключ"}
                </button>
                {!p.builtin && (
                  <button onClick={() => handleDelete(p.id)}
                    className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {editingId === p.id && (
                <div className="mt-2 flex items-center gap-2 pl-8">
                  <div className="flex-1">
                    <PasswordInput fieldKey="edit_key" value={editKey} onChange={(_, v) => setEditKey(v)}
                      placeholder={p.preset?.apiKeyLabel ?? "API Key"} />
                  </div>
                  <button onClick={() => handleUpdateKey(p, editKey)} disabled={saving || !editKey.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    <Save className="w-3 h-3" /> Сохранить
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new provider */}
      <div className="bg-bg-subtle border border-border-main rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Добавить провайдер</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Нейросеть</label>
            <select className={SELECT_CLS} value={selectedPreset} onChange={e => { setSelectedPreset(e.target.value); setApiKey(""); setErrMsg(""); }}>
              <option value="">— Выберите —</option>
              {availablePresets.map(p => (
                <option key={p.id} value={p.id}>{p.iconLetter} {p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>{curPreset?.apiKeyLabel ?? "API Key"} {curPreset?.noKeyNeeded ? "" : <span className="text-[10px] text-text-muted">(секрет)</span>}</label>
            {curPreset?.noKeyNeeded ? (
              <input className={INPUT_CLS} disabled value="Не требуется" />
            ) : (
              <PasswordInput fieldKey="new_api_key" value={apiKey} onChange={(_, v) => setApiKey(v)} placeholder={curPreset?.apiKeyLabel ?? "Вставьте API-ключ"} />
            )}
          </div>
        </div>
        {curPreset && (
          <p className="text-[11px] text-text-muted">
            {curPreset.base_url && <>Endpoint: <code className="bg-bg-card px-1 py-0.5 rounded text-[10px]">{curPreset.base_url}</code> · </>}
            Модель: <code className="bg-bg-card px-1 py-0.5 rounded text-[10px]">{curPreset.model}</code>
            {curPreset.models.length > 1 && <> · <span className="text-primary">{curPreset.models.length} моделей</span></>}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-green-600 font-medium">Добавлено!</span>}
          {errMsg && <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>}
          <button onClick={handleAdd} disabled={saving || !selectedPreset || (!curPreset?.noKeyNeeded && !apiKey.trim())}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <Plus className="w-3 h-3" /> {saving ? "Сохраняю..." : "Добавить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Revisor inline ──────────────────────────────────────────────────────────

const DEFAULT_REVISOR_METHODS: RevisorMethodDef[] = [
  { key: "build", label: "Сборка" }, { key: "version", label: "Версия" },
  { key: "status", label: "Статус" }, { key: "pods", label: "Поды" }, { key: "health", label: "Health" },
];

function emptyRevisorStand(methods: RevisorMethodDef[]): RevisorStandConfig {
  const m: RevisorStandConfig["methods"] = {};
  for (const method of methods) m[method.key] = { enabled: false, path: "", label: method.label };
  return { name: "", base_url: "", auth_type: "bearer", token: "", api_key_header: "Authorization", namespace: "", enabled: true, methods: m };
}

function RevisorInline({ methods, stands, onSave, onDelete }: {
  methods: RevisorMethodDef[]; stands: RevisorStandConfig[];
  onSave: (s: RevisorStandConfig) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const defs = methods.length ? methods : DEFAULT_REVISOR_METHODS;
  const [form, setForm] = useState<RevisorStandConfig>(() => emptyRevisorStand(defs));
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  function resetForm() { setForm(emptyRevisorStand(defs)); setErrMsg(""); setSaved(false); }

  function setField<K extends keyof RevisorStandConfig>(key: K, value: RevisorStandConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function setMethod(key: string, patch: Partial<{ enabled: boolean; path: string; label: string }>) {
    setForm(prev => ({
      ...prev,
      methods: { ...prev.methods, [key]: {
        enabled: prev.methods[key]?.enabled ?? false,
        path: prev.methods[key]?.path ?? "",
        label: prev.methods[key]?.label ?? defs.find(m => m.key === key)?.label ?? key,
        ...patch,
      }},
    }));
  }

  const enabledMethods = Object.values(form.methods).filter(m => m.enabled && m.path.trim()).length;

  async function handleSave() {
    setSaving(true); setErrMsg(""); setSaved(false);
    try { await onSave(form); resetForm(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function handleTest(id: string) {
    setTesting(id);
    try { const r = await testRevisorStand(id); setTestResults(prev => ({ ...prev, [id]: r })); }
    catch { setTestResults(prev => ({ ...prev, [id]: { status: "red", message: "Ошибка запроса" } })); }
    finally { setTesting(null); }
  }

  return (
    <div className="space-y-3">
      {stands.length > 0 && (
        <div className="border border-border-main rounded-lg divide-y divide-border-main overflow-hidden">
          {stands.map((s) => {
            const active = Object.entries(s.methods ?? {}).filter(([, c]) => c.enabled).map(([k, c]) => c.label || defs.find(m => m.key === k)?.label || k);
            return (
              <div key={s.id ?? s.name} className="flex items-center gap-3 px-3 py-2">
                <StatusDot status={testResults[s.id ?? ""]?.status ?? (s.enabled ? "unknown" : "red")} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-main truncate">{s.name}</p>
                  <p className="text-xs text-text-muted truncate">{active.join(", ") || "методы не выбраны"} · {s.base_url}</p>
                </div>
                <StatusBadge result={testResults[s.id ?? ""] ?? null} loading={testing === s.id} />
                <TestButton onClick={() => handleTest(s.id ?? "")} loading={testing === s.id} />
                <button onClick={() => { const next = emptyRevisorStand(defs); setForm({ ...next, ...s, token: s.token ?? "", methods: { ...next.methods, ...(s.methods ?? {}) } }); setErrMsg(""); setSaved(false); }}
                  className="px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle">Изменить</button>
                <button onClick={() => s.id && onDelete(s.id)}
                  className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <div><label className={LABEL_CLS}>Имя стенда</label><input className={INPUT_CLS} value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="НТ" /></div>
        <div><label className={LABEL_CLS}>Namespace</label><input className={INPUT_CLS} value={form.namespace ?? ""} onChange={(e) => setField("namespace", e.target.value)} placeholder="production" spellCheck={false} /></div>
        <div className="sm:col-span-2"><label className={LABEL_CLS}>Base URL</label><input className={INPUT_CLS} value={form.base_url} onChange={(e) => setField("base_url", e.target.value)} placeholder="https://stand.example.ru" spellCheck={false} /></div>
        <div><label className={LABEL_CLS}>Авторизация</label>
          <select className={SELECT_CLS} value={form.auth_type} onChange={(e) => setField("auth_type", e.target.value as RevisorStandConfig["auth_type"])}>
            <option value="none">Без токена</option><option value="bearer">Bearer token</option><option value="api_key">API key header</option>
          </select>
        </div>
        {form.auth_type !== "none" && (
          <div><label className={LABEL_CLS}>Token <span className="text-[10px] text-text-muted">(секрет)</span></label>
            <PasswordInput fieldKey="token" value={form.token ?? ""} onChange={(_, v) => setField("token", v)} placeholder="Token" /></div>
        )}
      </div>

      <div className="border border-border-main rounded-lg overflow-hidden">
        <div className="grid grid-cols-[96px,64px,minmax(120px,1fr)] bg-bg-subtle/80 border-b border-border-main">
          <div className="px-3 py-2 text-xs font-semibold text-text-muted">Метод</div>
          <div className="px-3 py-2 text-xs font-semibold text-text-muted border-l border-border-main">Вкл.</div>
          <div className="px-3 py-2 text-xs font-semibold text-text-muted border-l border-border-main">API path</div>
        </div>
        {defs.map((method) => {
          const cfg = form.methods[method.key] ?? { enabled: false, path: "", label: method.label };
          return (
            <div key={method.key} className="grid grid-cols-[96px,64px,minmax(120px,1fr)] border-b border-border-main last:border-0">
              <div className="px-3 py-2 text-sm text-text-main">{method.label}</div>
              <div className="px-3 py-2 border-l border-border-main flex items-center">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => setMethod(method.key, { enabled: e.target.checked })} className="w-4 h-4 accent-primary" />
              </div>
              <div className="px-3 py-2 border-l border-border-main">
                <input className={INPUT_CLS} value={cfg.path} onChange={(e) => setMethod(method.key, { path: e.target.value, enabled: cfg.enabled || !!e.target.value })} placeholder={`/api/${method.key}`} spellCheck={false} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-green-600 font-medium">Сохранено</span>}
        {errMsg && <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>}
        {form.id && <button onClick={resetForm} className="px-3 py-1.5 text-xs font-medium border border-border-main rounded-lg text-text-muted hover:bg-bg-subtle">Новый стенд</button>}
        <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.base_url.trim() || enabledMethods === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          <Plus className="w-3 h-3" /> {saving ? "Сохраняю..." : form.id ? "Обновить" : "Добавить стенд"}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Test Data Connections inline ──────────────────────────────────────────────

const DB_TYPES = [
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql",      label: "MySQL",      defaultPort: 3306 },
  { value: "oracle",     label: "Oracle",     defaultPort: 1521 },
] as const;

const EMPTY_TD_CONN: TestDataConnectionCreate = {
  display_name: "", db_type: "postgresql", host: "localhost", port: 5432, db_name: "", login: "", password: "",
};

function TestDataConnectionsInline({ connections, onRefresh }: {
  connections: TestDataConnection[];
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<TestDataConnectionCreate & { id?: string }>(EMPTY_TD_CONN);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { status: string; message: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [introspecting, setIntrospecting] = useState<string | null>(null);
  const [introspectResults, setIntrospectResults] = useState<Record<string, { table_count: number; column_count: number }>>({});

  function setField<K extends keyof (TestDataConnectionCreate & { id?: string })>(key: K, value: (TestDataConnectionCreate & { id?: string })[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true); setErrMsg(""); setSaved(false);
    try {
      if (form.id) {
        await updateTestDataConnection(form.id, form);
      } else {
        await createTestDataConnection(form);
      }
      setForm(EMPTY_TD_CONN);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await onRefresh();
    } catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function handleTest(id: string) {
    setTesting(id);
    try { const r = await testTestDataConnection(id); setTestResults(prev => ({ ...prev, [id]: r })); }
    catch { setTestResults(prev => ({ ...prev, [id]: { status: "red", message: "Ошибка запроса" } })); }
    finally { setTesting(null); }
  }

  async function handleIntrospect(id: string) {
    setIntrospecting(id);
    try {
      const r = await introspectTestDataConnection(id);
      setIntrospectResults(prev => ({ ...prev, [id]: { table_count: r.table_count, column_count: r.column_count } }));
      await onRefresh();
    } catch { setIntrospectResults(prev => ({ ...prev, [id]: { table_count: -1, column_count: 0 } })); }
    finally { setIntrospecting(null); }
  }

  async function handleDelete(id: string) {
    try { await deleteTestDataConnection(id); await onRefresh(); }
    catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Подключения к внешним БД</h3>

      {connections.length > 0 && (
        <div className="border border-border-main rounded-lg divide-y divide-border-main overflow-hidden">
          {connections.map(c => {
            const tr = testResults[c.id];
            const ir = introspectResults[c.id];
            const dbLabel = DB_TYPES.find(d => d.value === c.db_type)?.label ?? c.db_type;
            return (
              <div key={c.id} className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <StatusDot status={(tr?.status as "green"|"yellow"|"red"|"unknown") ?? (c.cached_schema ? "green" : "unknown")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-main truncate">{c.display_name}</p>
                    <p className="text-xs text-text-muted truncate">{dbLabel} · {c.host}:{c.port}/{c.db_name}</p>
                  </div>
                  {tr && <StatusBadge result={tr as TestResult} loading={testing === c.id} />}
                  {ir && ir.table_count >= 0 && (
                    <span className="text-xs text-green-600 whitespace-nowrap">{ir.table_count} таблиц, {ir.column_count} колонок</span>
                  )}
                  {c.cached_schema && !ir && (
                    <span className="text-[10px] text-text-muted whitespace-nowrap">{Object.keys(c.cached_schema).length} таблиц</span>
                  )}
                  <TestButton onClick={() => handleTest(c.id)} loading={testing === c.id} />
                  <button onClick={() => handleIntrospect(c.id)} disabled={introspecting === c.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border-main rounded-lg
                      text-text-main hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    title="Получить схему таблиц">
                    {introspecting === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                    Схема
                  </button>
                  <button onClick={() => { setForm({ ...EMPTY_TD_CONN, ...c, id: c.id, password: c.password }); setErrMsg(""); setSaved(false); }}
                    className="px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle">
                    Изменить
                  </button>
                  <button onClick={() => handleDelete(c.id)}
                    className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <label className={LABEL_CLS}>Название</label>
          <input className={INPUT_CLS} value={form.display_name} onChange={e => setField("display_name", e.target.value)} placeholder="Продуктовая БД" />
        </div>
        <div>
          <label className={LABEL_CLS}>Тип БД</label>
          <select className={SELECT_CLS} value={form.db_type}
            onChange={e => {
              const t = e.target.value as "postgresql" | "mysql" | "oracle";
              const dp = DB_TYPES.find(d => d.value === t)?.defaultPort ?? 5432;
              setForm(prev => ({ ...prev, db_type: t, port: dp }));
            }}>
            {DB_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Хост</label>
          <input className={INPUT_CLS} value={form.host} onChange={e => setField("host", e.target.value)} placeholder="localhost" spellCheck={false} />
        </div>
        <div>
          <label className={LABEL_CLS}>Порт</label>
          <input className={INPUT_CLS} type="number" value={form.port} onChange={e => setField("port", parseInt(e.target.value) || 5432)} />
        </div>
        <div>
          <label className={LABEL_CLS}>Имя БД</label>
          <input className={INPUT_CLS} value={form.db_name} onChange={e => setField("db_name", e.target.value)} placeholder="mydb" spellCheck={false} />
        </div>
        <div>
          <label className={LABEL_CLS}>Логин</label>
          <input className={INPUT_CLS} value={form.login} onChange={e => setField("login", e.target.value)} placeholder="postgres" spellCheck={false} />
        </div>
        <div>
          <label className={LABEL_CLS}>Пароль <span className="text-[10px] text-text-muted">(секрет)</span></label>
          <PasswordInput fieldKey="password" value={form.password} onChange={(_, v) => setField("password", v)} placeholder="••••••••" />
        </div>
        {form.db_type === "oracle" && (
          <div>
            <label className={LABEL_CLS}>Schema name</label>
            <input className={INPUT_CLS} value={form.schema_name ?? ""} onChange={e => setField("schema_name" as "display_name", e.target.value)} placeholder="MYSCHEMA" spellCheck={false} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-green-600 font-medium">Сохранено</span>}
        {errMsg && <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>}
        <button onClick={handleSave} disabled={saving || !form.display_name.trim() || !form.host.trim() || !form.db_name.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          <Plus className="w-3 h-3" /> {saving ? "Сохраняю..." : form.id ? "Обновить" : "Добавить подключение"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inline Logs VPS connections
// ═══════════════════════════════════════════════════════════════════════════════

const VPS_TYPE_OPTIONS = [
  { value: "graylog", label: "Graylog" },
  { value: "elastic", label: "Elasticsearch" },
  { value: "loki",    label: "Grafana Loki" },
  { value: "generic", label: "Другой (REST)" },
];

const VPS_AUTH_OPTIONS = [
  { value: "none",    label: "Без авторизации" },
  { value: "bearer",  label: "Bearer токен" },
  { value: "basic",   label: "Basic (логин/пароль)" },
  { value: "api_key", label: "API ключ" },
];

function LogsVpsInline({
  connections,
  onRefresh,
}: {
  connections: LogsVpsConnection[];
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<LogsVpsConnection>>({});
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  function startNew() {
    setForm({ vps_type: "graylog", auth_type: "none", ssl_verify: true, enabled: true });
    setEditing(true);
  }

  function startEdit(c: LogsVpsConnection) {
    setForm({ ...c });
    setEditing(true);
  }

  async function handleSave() {
    if (!form.name?.trim() || !form.base_url?.trim()) return;
    setSaving(true);
    try {
      await saveLogsVpsConnection(form as LogsVpsConnection & { name: string; base_url: string });
      await onRefresh();
      setEditing(false);
      setForm({});
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await deleteLogsVpsConnection(id);
    await onRefresh();
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const result = await testLogsVpsConnection(id);
      setTestResults(prev => ({ ...prev, [id]: result }));
    } catch {
      setTestResults(prev => ({ ...prev, [id]: { status: "red", message: "Ошибка" } }));
    }
    setTesting(null);
  }

  if (editing) {
    const needsToken = form.auth_type === "bearer" || form.auth_type === "api_key";
    const needsBasic = form.auth_type === "basic";

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label className={LABEL_CLS}>Название</label>
            <input className={INPUT_CLS} value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Graylog Production" />
          </div>
          <div>
            <label className={LABEL_CLS}>Тип VPS</label>
            <select className={SELECT_CLS} value={form.vps_type || "graylog"} onChange={e => setForm(f => ({ ...f, vps_type: e.target.value as LogsVpsConnection["vps_type"] }))}>
              {VPS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Base URL</label>
            <input className={INPUT_CLS} value={form.base_url || ""} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://graylog.company.ru/api" />
          </div>
          <div>
            <label className={LABEL_CLS}>Авторизация</label>
            <select className={SELECT_CLS} value={form.auth_type || "none"} onChange={e => setForm(f => ({ ...f, auth_type: e.target.value as LogsVpsConnection["auth_type"] }))}>
              {VPS_AUTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {needsToken && (
            <div>
              <label className={LABEL_CLS}>{form.auth_type === "bearer" ? "Bearer токен" : "API ключ"}</label>
              <input className={INPUT_CLS} type="password" value={form.token || ""} onChange={e => setForm(f => ({ ...f, token: e.target.value }))} />
            </div>
          )}
          {needsBasic && <>
            <div>
              <label className={LABEL_CLS}>Логин</label>
              <input className={INPUT_CLS} value={form.username || ""} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL_CLS}>Пароль</label>
              <input className={INPUT_CLS} type="password" value={form.password || ""} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
          </>}
          <div>
            <label className={LABEL_CLS}>Индекс / Стрим (опционально)</label>
            <input className={INPUT_CLS} value={form.default_index || ""} onChange={e => setForm(f => ({ ...f, default_index: e.target.value }))} placeholder="graylog_stream_id" />
          </div>
          <div className="flex items-center gap-3 pt-5">
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
              <input type="checkbox" checked={form.ssl_verify !== false} onChange={e => setForm(f => ({ ...f, ssl_verify: e.target.checked }))} className="rounded border-border-main text-primary focus:ring-primary/30" />
              SSL verify
            </label>
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
              <input type="checkbox" checked={form.enabled !== false} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="rounded border-border-main text-primary focus:ring-primary/30" />
              Активно
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleSave} disabled={saving || !form.name?.trim() || !form.base_url?.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            {form.id ? "Обновить" : "Добавить"}
          </button>
          <button onClick={() => { setEditing(false); setForm({}); }} className="px-3 py-1.5 text-xs font-medium rounded-lg text-text-muted hover:bg-bg-subtle transition-colors">
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {connections.length === 0 && (
        <p className="text-sm text-text-muted py-2">Нет подключений. Добавьте VPS-платформу для анализа логов.</p>
      )}
      {connections.map(c => {
        const tr = testResults[c.id || ""];
        return (
          <div key={c.id} className="flex items-center justify-between bg-bg-subtle rounded-lg px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text-main">{c.name}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-muted text-text-muted">
                  {VPS_TYPE_OPTIONS.find(o => o.value === c.vps_type)?.label || c.vps_type}
                </span>
                {c.enabled === false && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">выкл</span>
                )}
              </div>
              <p className="text-xs text-text-muted truncate">{c.base_url}</p>
              {tr && (
                <p className={`text-xs mt-1 ${tr.status === "green" ? "text-green-600" : "text-red-500"}`}>
                  {tr.message}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => handleTest(c.id!)} disabled={testing === c.id} className="p-1.5 rounded-lg hover:bg-bg-muted transition-colors" title="Тест">
                {testing === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> : <Play className="w-3.5 h-3.5 text-text-muted" />}
              </button>
              <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-bg-muted transition-colors" title="Редактировать">
                <Pencil className="w-3.5 h-3.5 text-text-muted" />
              </button>
              <button onClick={() => handleDelete(c.id!)} className="p-1.5 rounded-lg hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors" title="Удалить">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
      <button onClick={startNew} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-primary hover:bg-primary/5 transition-colors mt-1">
        <Plus className="w-3 h-3" /> Добавить подключение
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsSection() {
  const { bumpProviders } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = useState<CustomLlmProvider[]>([]);
  const [revisorMethods, setRevisorMethods] = useState<RevisorMethodDef[]>(DEFAULT_REVISOR_METHODS);
  const [revisorStands, setRevisorStands] = useState<RevisorStandConfig[]>([]);
  const [tdConnections, setTdConnections] = useState<TestDataConnection[]>([]);
  const [logsVpsConns, setLogsVpsConns] = useState<LogsVpsConnection[]>([]);

  // LLM provider statuses
  const [llmStatuses, setLlmStatuses] = useState<Record<string, TestResult>>({});
  const [llmTesting, setLlmTesting] = useState<string | null>(null);

  // Section test results
  const [kafkaAlertsResult, setKafkaAlertsResult] = useState<TestResult | null>(null);
  const [kafkaAlertsTesting, setKafkaAlertsTesting] = useState(false);
  const [kafkaMetricsResult, setKafkaMetricsResult] = useState<TestResult | null>(null);
  const [kafkaMetricsTesting, setKafkaMetricsTesting] = useState(false);
  const [chromaResult, setChromaResult] = useState<TestResult | null>(null);
  const [chromaTesting, setChromaTesting] = useState(false);
  const [pgResult, setPgResult] = useState<TestResult | null>(null);
  const [pgTesting, setPgTesting] = useState(false);

  // Ферма устройств — тест
  const [farmResult, setFarmResult] = useState<TestResult | null>(null);
  const [farmTesting, setFarmTesting] = useState(false);

  // Save statuses per section
  const [llmSave, setLlmSave] = useState<{ status: SaveStatus; err: string }>({ status: "idle", err: "" });
  const [kafkaAlertsSave, setKafkaAlertsSave] = useState<{ status: SaveStatus; err: string }>({ status: "idle", err: "" });
  const [kafkaMetricsSave, setKafkaMetricsSave] = useState<{ status: SaveStatus; err: string }>({ status: "idle", err: "" });
  const [farmSave, setFarmSave] = useState<{ status: SaveStatus; err: string }>({ status: "idle", err: "" });

  const loadSettings = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [map, custom, revisor, tdConns, logsVps] = await Promise.all([
        getSettings(), getCustomLlmProviders(), getRevisorStands(),
        listTestDataConnections().catch(() => [] as TestDataConnection[]),
        getLogsVpsConnections().catch(() => ({ connections: [] as LogsVpsConnection[] })),
      ]);
      const vals: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const [k, v] of Object.entries(map)) { vals[k] = v.value; descs[k] = v.description; }
      setValues(vals); setDescriptions(descs);
      setCustomProviders(custom);
      setRevisorMethods(revisor.methods); setRevisorStands(revisor.stands);
      setTdConnections(tdConns);
      setLogsVpsConns(logsVps.connections || []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSaveFields(keys: string[], isLlm = false) {
    const payload: Record<string, string> = {};
    for (const k of keys) payload[k] = values[k] ?? "";
    await saveSettings(payload);
    await loadSettings();
    if (isLlm) bumpProviders();
  }

  // LLM test
  async function handleTestLlm(providerId: string) {
    setLlmTesting(providerId);
    try { const r = await testLlmConnection(providerId); setLlmStatuses(prev => ({ ...prev, [providerId]: r })); }
    catch { setLlmStatuses(prev => ({ ...prev, [providerId]: { status: "red", message: "Ошибка" } })); }
    finally { setLlmTesting(null); }
  }

  // Save handlers for sections
  async function saveLlm() {
    setLlmSave({ status: "saving", err: "" });
    try {
      await handleSaveFields([...GIGACHAT_FIELDS, ...DEEPSEEK_FIELDS].map(f => f.key), true);
      setLlmSave({ status: "saved", err: "" }); setTimeout(() => setLlmSave({ status: "idle", err: "" }), 3000);
    } catch (e) { setLlmSave({ status: "error", err: e instanceof Error ? e.message : String(e) }); }
  }

  async function saveKafkaAlerts() {
    setKafkaAlertsSave({ status: "saving", err: "" });
    try {
      await handleSaveFields(ALERTS_KAFKA_FIELDS.map(f => f.key));
      setKafkaAlertsSave({ status: "saved", err: "" }); setTimeout(() => setKafkaAlertsSave({ status: "idle", err: "" }), 3000);
    } catch (e) { setKafkaAlertsSave({ status: "error", err: e instanceof Error ? e.message : String(e) }); }
  }

  async function saveKafkaMetrics() {
    setKafkaMetricsSave({ status: "saving", err: "" });
    try {
      await handleSaveFields(METRICS_KAFKA_FIELDS.map(f => f.key));
      setKafkaMetricsSave({ status: "saved", err: "" }); setTimeout(() => setKafkaMetricsSave({ status: "idle", err: "" }), 3000);
    } catch (e) { setKafkaMetricsSave({ status: "error", err: e instanceof Error ? e.message : String(e) }); }
  }

  async function saveFarm() {
    setFarmSave({ status: "saving", err: "" });
    try {
      await handleSaveFields([...FARM_FIELDS.map(f => f.key), "farm_enabled"]);
      setFarmSave({ status: "saved", err: "" }); setTimeout(() => setFarmSave({ status: "idle", err: "" }), 3000);
    } catch (e) { setFarmSave({ status: "error", err: e instanceof Error ? e.message : String(e) }); }
  }

  // Compute overall LLM status
  const llmOverall = Object.values(llmStatuses).length === 0 ? "unknown" as const
    : Object.values(llmStatuses).every(r => r.status === "green") ? "green" as const
    : Object.values(llmStatuses).some(r => r.status === "green") ? "yellow" as const
    : "red" as const;

  if (loading) return (
    <div className="p-6 flex items-center justify-center gap-2 text-text-muted text-sm">
      <Loader2 className="w-4 h-4 animate-spin text-primary" /> Загрузка настроек...
    </div>
  );

  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">Ошибка загрузки: {error}</div>
    </div>
  );

  return (
    <div className="p-6 space-y-4 overflow-y-auto scrollbar-thin">
      {/* Header */}
      <div className="mb-2">
        <div className="flex items-center gap-2 mb-1">
          <Settings className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-text-main">Настройки</h1>
        </div>
        <p className="text-sm text-text-muted">Все подключения и конфигурации в одном месте. Используйте кнопки «Тест» для проверки.</p>
      </div>

      {/* ═══ 1. LLM Провайдеры ═══ */}
      <SectionCard
        icon={<Zap className="w-4 h-4 text-primary" />}
        title="LLM Провайдеры"
        subtitle="Выберите нейросеть и вставьте API-ключ"
        status={llmOverall}
        defaultOpen={true}
      >
        <UnifiedLlmProviders
          builtinValues={values}
          customProviders={customProviders}
          onSaveBuiltin={async (key, value) => {
            await saveSettings({ [key]: value });
            await loadSettings();
            bumpProviders();
          }}
          onSaveCustom={async (p) => {
            await saveCustomLlmProvider(p);
            await loadSettings();
            bumpProviders();
          }}
          onDeleteCustom={async (id) => {
            await deleteCustomLlmProvider(id);
            await loadSettings();
            bumpProviders();
          }}
          onRefresh={async () => {
            await loadSettings();
            bumpProviders();
          }}
        />
      </SectionCard>

      {/* ═══ 2. Kafka — Алерты ═══ */}
      <SectionCard
        icon={<Radio className="w-4 h-4 text-orange-500" />}
        title="Kafka — Алерты"
        subtitle="Брокер для отправки алертов из Jupyter скриптов"
        status={kafkaAlertsResult?.status ?? "unknown"}
        headerRight={
          <div className="flex items-center gap-2">
            <StatusBadge result={kafkaAlertsResult} loading={kafkaAlertsTesting} />
            <TestButton onClick={async () => { setKafkaAlertsTesting(true); try { setKafkaAlertsResult(await testKafkaAlerts()); } catch { setKafkaAlertsResult({ status: "red", message: "Ошибка" }); } finally { setKafkaAlertsTesting(false); } }} loading={kafkaAlertsTesting} />
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {ALERTS_KAFKA_FIELDS.map(f => renderField(f, values, descriptions, handleChange))}
        </div>
        <SaveBar status={kafkaAlertsSave.status} errMsg={kafkaAlertsSave.err} onSave={saveKafkaAlerts} saving={kafkaAlertsSave.status === "saving"} />
      </SectionCard>

      {/* ═══ 3. Kafka — Метрики ═══ */}
      <SectionCard
        icon={<Radio className="w-4 h-4 text-violet-500" />}
        title="Kafka — Метрики"
        subtitle="Брокер для генератора метрик (DATA, METADATA, THRESHOLDS)"
        status={kafkaMetricsResult?.status ?? "unknown"}
        headerRight={
          <div className="flex items-center gap-2">
            <StatusBadge result={kafkaMetricsResult} loading={kafkaMetricsTesting} />
            <TestButton onClick={async () => { setKafkaMetricsTesting(true); try { setKafkaMetricsResult(await testKafkaMetrics()); } catch { setKafkaMetricsResult({ status: "red", message: "Ошибка" }); } finally { setKafkaMetricsTesting(false); } }} loading={kafkaMetricsTesting} />
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {METRICS_KAFKA_FIELDS.map(f => renderField(f, values, descriptions, handleChange))}
        </div>
        <SaveBar status={kafkaMetricsSave.status} errMsg={kafkaMetricsSave.err} onSave={saveKafkaMetrics} saving={kafkaMetricsSave.status === "saving"} />
      </SectionCard>

      {/* ═══ 4. Ревизор — API стенды ═══ */}
      <SectionCard
        icon={<Server className="w-4 h-4 text-teal-500" />}
        title="Ревизор — API стенды"
        subtitle="Подключения к стендам для сравнения сборок, версий и статусов"
      >
        <RevisorInline
          methods={revisorMethods}
          stands={revisorStands}
          onSave={async (s) => { await saveRevisorStand(s); await loadSettings(); }}
          onDelete={async (id) => { await deleteRevisorStand(id); await loadSettings(); }}
        />
      </SectionCard>

      {/* ═══ 5. Тестовые данные — внешние БД ═══ */}
      <SectionCard
        icon={<Server className="w-4 h-4 text-cyan-500" />}
        title="Тестовые данные — подключения к БД"
        subtitle="Внешние базы данных для поиска и генерации тестовых данных (PostgreSQL, MySQL, Oracle)"
      >
        <TestDataConnectionsInline
          connections={tdConnections}
          onRefresh={async () => {
            const conns = await listTestDataConnections().catch(() => [] as TestDataConnection[]);
            setTdConnections(conns);
          }}
        />
      </SectionCard>

      {/* ═══ 6. Логи (VPS) ═══ */}
      <SectionCard
        icon={<ScrollText className="w-4 h-4 text-indigo-500" />}
        title="Логи — подключения к VPS"
        subtitle="Graylog, Elasticsearch, Loki или произвольный REST API для анализа логов микросервисов"
      >
        <LogsVpsInline
          connections={logsVpsConns}
          onRefresh={async () => {
            const res = await getLogsVpsConnections().catch(() => ({ connections: [] as LogsVpsConnection[] }));
            setLogsVpsConns(res.connections || []);
          }}
        />
      </SectionCard>

      {/* ═══ 7. Ферма устройств ═══ */}
      <SectionCard
        icon={<Smartphone className="w-4 h-4 text-green-500" />}
        title="Ферма устройств"
        subtitle="Встроенный сервер управления мобильными устройствами"
        status={farmResult?.status ?? "unknown"}
        headerRight={
          <div className="flex items-center gap-2">
            <StatusBadge result={farmResult} loading={farmTesting} />
            <TestButton onClick={async () => {
              setFarmTesting(true);
              try {
                setFarmResult(await testFarm());
              } catch {
                setFarmResult({ status: "red", message: "Ошибка подключения" });
              } finally { setFarmTesting(false); }
            }} loading={farmTesting} />
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {FARM_FIELDS.map(f => renderField(f, values, descriptions, handleChange))}
          <div className="flex items-center gap-3 pt-5">
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
              <input
                type="checkbox"
                checked={values["farm_enabled"] === "true" || values["farm_enabled"] === "1"}
                onChange={(e) => handleChange("farm_enabled", e.target.checked ? "true" : "false")}
                className="rounded border-border-main text-primary focus:ring-primary/30"
              />
              Включено
            </label>
          </div>
        </div>
        <SaveBar status={farmSave.status} errMsg={farmSave.err} onSave={saveFarm} saving={farmSave.status === "saving"} />
      </SectionCard>

      {/* ═══ 8. Базы данных ═══ */}
      <SectionCard
        icon={<Database className="w-4 h-4 text-emerald-500" />}
        title="Базы данных"
        subtitle="ChromaDB (векторное хранилище) и PostgreSQL (метрики)"
        status={
          chromaResult && pgResult
            ? chromaResult.status === "green" && pgResult.status === "green" ? "green"
              : chromaResult.status === "red" && pgResult.status === "red" ? "red" : "yellow"
            : "unknown"
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-bg-subtle rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-text-main">ChromaDB</p>
              <p className="text-xs text-text-muted">Векторное хранилище для RAG (эталоны, документы)</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge result={chromaResult} loading={chromaTesting} />
              <TestButton onClick={async () => { setChromaTesting(true); try { setChromaResult(await testChromaDb()); } catch { setChromaResult({ status: "red", message: "Ошибка" }); } finally { setChromaTesting(false); } }} loading={chromaTesting} />
            </div>
          </div>

          <div className="flex items-center justify-between bg-bg-subtle rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-text-main">PostgreSQL</p>
              <p className="text-xs text-text-muted">Хранение метрик и настроек приложения</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge result={pgResult} loading={pgTesting} />
              <TestButton onClick={async () => { setPgTesting(true); try { setPgResult(await testPostgres()); } catch { setPgResult({ status: "red", message: "Ошибка" }); } finally { setPgTesting(false); } }} loading={pgTesting} />
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
