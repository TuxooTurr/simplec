"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Eye, EyeOff, Save, Settings, Plus, Trash2,
  Zap, Database, Radio, Server, Shield, ChevronDown, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Play, ScrollText, Pencil,
  Check, Settings2, Upload, RefreshCw, Bug,
} from "lucide-react";
import { ConnectionsModal, ConnectionRow, Tabs, Select } from "@/components/ui";
import JiraSettingsBlock from "@/components/JiraSettingsBlock";
import {
  getSettings, saveSettings,
  getCustomLlmProviders, saveCustomLlmProvider, deleteCustomLlmProvider,
  getRevisorStands, saveRevisorStand, deleteRevisorStand,
  getLogsVpsConnections, saveLogsVpsConnection, deleteLogsVpsConnection,
  testLlmConnection, testKafkaMetrics, testChromaDb, testPostgres,
  testRevisorStand, testLogsVpsConnection,
  type SettingsMap, type CustomLlmProvider, type RevisorStandConfig, type RevisorMethodDef,
  type TestResult, type LogsVpsConnection,
} from "@/lib/settingsApi";
import {
  getProviders, type ProviderStatus,
  listTestDataConnections, createTestDataConnection, updateTestDataConnection,
  deleteTestDataConnection, testTestDataConnection, introspectTestDataConnection,
  listJdbcDrivers, createJdbcDriver, updateJdbcDriver, deleteJdbcDriver,
  uploadJdbcDriverLibrary, setJdbcDriverLibraryPath, removeJdbcDriverLibrary, testJdbcDriver,
  getGigachatModels, testGigachatChat, uploadGigachatCert,
  type TestDataConnection, type TestDataConnectionCreate, type JdbcDriver, type JdbcDriverSettings,
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

/* GigaChat: публичный API (по ключу) и ИФТ-стенд (по сертификату, дефолт) */
const GIGACHAT_PUBLIC_URL = "https://gigachat.devices.sberbank.ru/api/v1";
const GIGACHAT_IFT_URL = "https://gigachat-ift.sberdevices.delta.sbrf.ru/api/v1";

const SECRET_KEYS = new Set([
  "gigachat_auth_key",
  "kafka_sasl_password", "kafka_ssl_password",
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
    apiKeyLabel: "API Key",
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
  const color = result.status === "green" ? "tone-success-text" : result.status === "yellow" ? "tone-warning-text" : "tone-danger-text";
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
        <Select  value={val} onChange={(value) => onChange(f.key, value)}>
          {f.options.map((o) => <option key={o} value={o}>{o || "— не задано —"}</option>)}
        </Select>
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
  builtinValues, customProviders, onSaveBuiltin, onSaveBuiltinBatch, onSaveCustom, onDeleteCustom, onRefresh,
}: {
  builtinValues: Record<string, string>;
  customProviders: CustomLlmProvider[];
  onSaveBuiltin: (key: string, value: string) => Promise<void>;
  onSaveBuiltinBatch: (values: Record<string, string>) => Promise<void>;
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
  const [editAuthType, setEditAuthType] = useState<"api_key" | "certificate">("api_key");
  const [editCaCertPath, setEditCaCertPath] = useState("");
  const [editClientCertPath, setEditClientCertPath] = useState("");
  const [editClientKeyPath, setEditClientKeyPath] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editNoVerify, setEditNoVerify] = useState(true);
  const [gigaModels, setGigaModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsErr, setModelsErr] = useState("");
  const [chatTesting, setChatTesting] = useState(false);
  const [chatTestResult, setChatTestResult] = useState<TestResult | null>(null);
  const [uploadingKind, setUploadingKind] = useState<"cert" | "key" | "ca" | null>(null);

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
    allIds.push("gigachat");
    for (const cp of customProviders) allIds.push(cp.id ?? cp.name);
    runStatusChecks(allIds);

    // Auto-refresh every 60s
    autoRefreshRef.current = setInterval(() => {
      const ids: string[] = ["gigachat"];
      for (const cp of customProviders) ids.push(cp.id ?? cp.name);
      runStatusChecks(ids);
    }, 60000);

    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [customProviders, runStatusChecks]);

  // Build list of active providers
  type ActiveProvider = { id: string; name: string; model: string; hasKey: boolean; builtin?: boolean; preset?: ProviderPreset; authType?: string };
  const activeProviders: ActiveProvider[] = [];

  // Built-in: GigaChat — по API-ключу или по клиентскому сертификату
  const gcPreset = PROVIDER_PRESETS.find(p => p.id === "gigachat")!;
  const gcAuthType = builtinValues["gigachat_auth_type"] || "api_key";
  const gcHasKey = gcAuthType === "certificate"
    ? !!(builtinValues["gigachat_client_cert_path"] && builtinValues["gigachat_client_key_path"])
    : !!(builtinValues["gigachat_auth_key"] && builtinValues["gigachat_auth_key"] !== "");
  activeProviders.push({ id: "gigachat", name: gcPreset.name, model: builtinValues["gigachat_model"] || gcPreset.model, hasKey: gcHasKey, builtin: true, preset: gcPreset, authType: gcAuthType });

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

  function resetEditFields() {
    setEditKey(""); setEditAuthType("api_key");
    setEditCaCertPath(""); setEditClientCertPath(""); setEditClientKeyPath("");
    setEditBaseUrl("");
  }

  function openEdit(provider: ActiveProvider) {
    if (editingId === provider.id) { setEditingId(null); resetEditFields(); return; }
    setEditingId(provider.id);
    setEditKey("");
    setGigaModels([]); setModelsErr(""); setChatTestResult(null);
    if (provider.id === "gigachat") {
      setEditAuthType((builtinValues["gigachat_auth_type"] as "api_key" | "certificate") || "api_key");
      setEditCaCertPath(builtinValues["gigachat_ca_cert_path"] || "");
      setEditClientCertPath(builtinValues["gigachat_client_cert_path"] || "");
      setEditClientKeyPath(builtinValues["gigachat_client_key_path"] || "");
      setEditBaseUrl(builtinValues["gigachat_base_url"] || GIGACHAT_PUBLIC_URL);
      setEditModel(builtinValues["gigachat_model"] || "");
      // no_verify по умолчанию включён (корп. BIG IP), если настройка ещё не задана
      setEditNoVerify(builtinValues["gigachat_no_verify"] !== "");
    } else {
      setEditAuthType("api_key");
      setEditCaCertPath(""); setEditClientCertPath(""); setEditClientKeyPath("");
      setEditBaseUrl("");
    }
  }

  /* Переключение режима GigaChat: по сертификату по умолчанию идём на ИФТ-стенд,
     по API-ключу — на публичный API (если пользователь не задал свой URL) */
  function switchGigachatAuthType(next: "api_key" | "certificate") {
    setEditAuthType(next);
    if (next === "certificate" && (!editBaseUrl || editBaseUrl === GIGACHAT_PUBLIC_URL)) {
      setEditBaseUrl(GIGACHAT_IFT_URL);
    } else if (next === "api_key" && editBaseUrl === GIGACHAT_IFT_URL) {
      setEditBaseUrl(GIGACHAT_PUBLIC_URL);
    }
  }

  /* Автоподгрузка списка моделей со стенда (GET {base_url}/models) по текущим полям формы. */
  async function loadGigaModels() {
    setLoadingModels(true); setModelsErr("");
    try {
      const r = await getGigachatModels({
        base_url: editBaseUrl.trim(),
        auth_type: editAuthType,
        client_cert_path: editClientCertPath.trim(),
        client_key_path: editClientKeyPath.trim(),
        ca_cert_path: editCaCertPath.trim(),
        no_verify: editNoVerify,
      });
      setGigaModels(r.models);
      if (r.models.length && !r.models.includes(editModel)) setEditModel(r.models[0]);
      if (!r.models.length) setModelsErr("Стенд вернул пустой список моделей");
    } catch (e) {
      setModelsErr(e instanceof Error ? e.message : String(e));
    } finally { setLoadingModels(false); }
  }

  /* Загрузка файла сертификата (cert|key|ca) → сохраняется в защищённую папку 0600,
     возвращённый путь пишем в соответствующее поле формы. */
  async function handleCertUpload(kind: "cert" | "key" | "ca", file: File) {
    setUploadingKind(kind); setModelsErr("");
    try {
      const { path } = await uploadGigachatCert(kind, file);
      if (kind === "cert") setEditClientCertPath(path);
      else if (kind === "key") setEditClientKeyPath(path);
      else setEditCaCertPath(path);
    } catch (e) {
      setModelsErr(e instanceof Error ? e.message : String(e));
    } finally { setUploadingKind(null); }
  }

  /* Тест чата по живым параметрам формы (единый источник с «Загрузить модели»). */
  async function handleTestChat() {
    setChatTesting(true); setChatTestResult(null);
    try {
      const r = await testGigachatChat({
        model: editModel.trim(),
        base_url: editBaseUrl.trim(),
        auth_type: editAuthType,
        client_cert_path: editClientCertPath.trim(),
        client_key_path: editClientKeyPath.trim(),
        ca_cert_path: editCaCertPath.trim(),
        no_verify: editNoVerify,
      });
      setChatTestResult(r);
    } catch (e) {
      setChatTestResult({ status: "red", message: e instanceof Error ? e.message : String(e) });
    } finally { setChatTesting(false); }
  }

  async function handleSaveConnection(provider: ActiveProvider) {
    setSaving(true); setErrMsg("");
    try {
      if (provider.id === "gigachat") {
        if (editAuthType === "certificate") {
          if (!editClientCertPath.trim() || !editClientKeyPath.trim()) {
            setErrMsg("Укажите путь к клиентскому сертификату и приватному ключу");
            setSaving(false);
            return;
          }
          await onSaveBuiltinBatch({
            gigachat_auth_type: "certificate",
            gigachat_base_url: editBaseUrl.trim() || GIGACHAT_IFT_URL,
            gigachat_ca_cert_path: editCaCertPath.trim(),
            gigachat_client_cert_path: editClientCertPath.trim(),
            gigachat_client_key_path: editClientKeyPath.trim(),
            gigachat_no_verify: editNoVerify ? "1" : "",
            ...(editModel.trim() ? { gigachat_model: editModel.trim() } : {}),
          });
        } else {
          if (!editKey.trim()) { setErrMsg("Введите AUTH_KEY"); setSaving(false); return; }
          await onSaveBuiltinBatch({
            gigachat_auth_type: "api_key",
            gigachat_auth_key: editKey.trim(),
            gigachat_base_url: editBaseUrl.trim() || GIGACHAT_PUBLIC_URL,
          });
        }
      } else if (provider.builtin && provider.preset?.settingsKey) {
        if (!editKey.trim()) { setSaving(false); return; }
        await onSaveBuiltin(provider.preset.settingsKey, editKey.trim());
      } else {
        if (!editKey.trim()) { setSaving(false); return; }
        const cp = customProviders.find(c => c.id === provider.id);
        if (cp) await onSaveCustom({ ...cp, api_key: editKey.trim() });
      }
      await onRefresh();
      setEditingId(null); resetEditFields();
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
                    <Select
                      bare
                      className="text-xs text-text-muted hover:text-primary transition-colors"
                      value={p.model}
                      onChange={(value) => handleModelChange(p, value)}
                    >
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </Select>
                  ) : (
                    <p className="text-xs text-text-muted">
                      {p.model}{!hasKeyOrNoNeed ? " · нет ключа" : ""}
                      {p.id === "gigachat" && hasKeyOrNoNeed ? (p.authType === "certificate" ? " · по сертификату" : " · по API-ключу") : ""}
                    </p>
                  )}
                </div>
                <StatusBadge result={tr ?? null} loading={testing === p.id} />
                {/* Пока панель подключения этого провайдера раскрыта — тест только
                    там (по живым параметрам формы, «Тест чата» для сертификата);
                    строчная «Тест» дублировала бы его — показываем только когда
                    панель свёрнута (быстрая проверка сохранённой конфигурации). */}
                {editingId !== p.id && (
                  <TestButton onClick={() => handleTest(p.id)} loading={testing === p.id} />
                )}
                <button
                  onClick={() => openEdit(p)}
                  className="px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle"
                >
                  {editingId === p.id ? "Отмена" : "Подключение"}
                </button>
                {!p.builtin && (
                  <button onClick={() => handleDelete(p.id)}
                    className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {editingId === p.id && (
                <div className="mt-2 pl-8 space-y-2">
                  {p.id === "gigachat" && (
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-text-main cursor-pointer">
                        <input type="radio" checked={editAuthType === "api_key"} onChange={() => switchGigachatAuthType("api_key")}
                          className="text-primary focus:ring-primary/30" />
                        По API-ключу
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-text-main cursor-pointer">
                        <input type="radio" checked={editAuthType === "certificate"} onChange={() => switchGigachatAuthType("certificate")}
                          className="text-primary focus:ring-primary/30" />
                        По сертификату
                      </label>
                    </div>
                  )}
                  {p.id === "gigachat" && editAuthType === "certificate" ? (
                    <div className="space-y-1.5">
                      <div>
                        <label className={LABEL_CLS}>Куда обращаемся (Base URL стенда)</label>
                        <input className={`${INPUT_CLS} font-mono`} value={editBaseUrl} onChange={(e) => setEditBaseUrl(e.target.value)}
                          placeholder={GIGACHAT_IFT_URL} spellCheck={false} />
                      </div>
                      {([
                        { kind: "ca" as const, value: editCaCertPath, set: setEditCaCertPath, ph: "Путь к CA bundle (опционально)", accept: ".pem,.crt,.cer,.txt" },
                        { kind: "cert" as const, value: editClientCertPath, set: setEditClientCertPath, ph: "Путь к клиентскому сертификату (.pem/.crt)", accept: ".pem,.crt,.cer,.txt" },
                        { kind: "key" as const, value: editClientKeyPath, set: setEditClientKeyPath, ph: "Путь к приватному ключу сертификата", accept: ".pem,.key,.txt" },
                      ]).map((f) => (
                        <div key={f.kind} className="flex gap-2">
                          <input className={`${INPUT_CLS} flex-1`} value={f.value} onChange={(e) => f.set(e.target.value)}
                            placeholder={f.ph} spellCheck={false} />
                          <label className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-xs font-medium text-text-main hover:bg-bg-subtle cursor-pointer">
                            {uploadingKind === f.kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Файл
                            <input type="file" accept={f.accept} className="hidden"
                              onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCertUpload(f.kind, file); e.target.value = ""; }} />
                          </label>
                        </div>
                      ))}
                      <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none pt-0.5">
                        <input type="checkbox" checked={editNoVerify} onChange={(e) => setEditNoVerify(e.target.checked)}
                          className="rounded border-border-main accent-primary" />
                        Не проверять серверный сертификат (корп. BIG IP)
                      </label>
                      {/* Модель: список тянется со стенда GET {base_url}/models */}
                      <div>
                        <label className={LABEL_CLS}>Модель</label>
                        <div className="flex gap-2">
                          {gigaModels.length > 0 ? (
                            <Select className="flex-1" value={editModel} onChange={setEditModel}>
                              {gigaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                            </Select>
                          ) : (
                            <input className={`${INPUT_CLS} flex-1 font-mono`} value={editModel} onChange={(e) => setEditModel(e.target.value)}
                              placeholder="напр. GigaChat-2-Max" spellCheck={false} />
                          )}
                          <button type="button" onClick={loadGigaModels} disabled={loadingModels || !editClientCertPath.trim()}
                            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-xs font-medium text-text-main hover:bg-bg-subtle disabled:opacity-50">
                            {loadingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Загрузить модели
                          </button>
                        </div>
                        {modelsErr && <p className="mt-1 text-xs text-red-500">{modelsErr}</p>}
                      </div>
                      {/* Тест чата — POST /chat/completions теми же живыми параметрами формы */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <button type="button" onClick={handleTestChat} disabled={chatTesting || !editModel.trim() || !editClientCertPath.trim()}
                          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-xs font-medium text-text-main hover:bg-bg-subtle disabled:opacity-50">
                          {chatTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          Тест чата
                        </button>
                        {chatTestResult && (
                          <span className={`text-xs ${chatTestResult.status === "green" ? "text-green-600" : chatTestResult.status === "yellow" ? "text-amber-600" : "text-red-500"}`}>
                            {chatTestResult.message}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <PasswordInput fieldKey="edit_key" value={editKey} onChange={(_, v) => setEditKey(v)}
                      placeholder={p.preset?.apiKeyLabel ?? "API Key"} />
                  )}
                  {errMsg && editingId === p.id && <p className="text-xs text-red-500">{errMsg}</p>}
                  <div className="flex justify-end">
                    <button onClick={() => handleSaveConnection(p)} disabled={saving}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                      <Save className="w-3 h-3" /> Сохранить
                    </button>
                  </div>
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
            <Select  value={selectedPreset} onChange={(value) => { setSelectedPreset(value); setApiKey(""); setErrMsg(""); }}>
              <option value="">— Выберите —</option>
              {availablePresets.map(p => (
                <option key={p.id} value={p.id}>{p.iconLetter} {p.name}</option>
              ))}
            </Select>
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

function RevisorConnectionsModal({ open, onClose, methods, stands, onSave, onDelete }: {
  open: boolean; onClose: () => void;
  methods: RevisorMethodDef[]; stands: RevisorStandConfig[];
  onSave: (s: RevisorStandConfig) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const defs = methods.length ? methods : DEFAULT_REVISOR_METHODS;
  const [form, setForm] = useState<RevisorStandConfig>(() => emptyRevisorStand(defs));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function resetForm() { setForm(emptyRevisorStand(defs)); setMsg(null); }

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

  const save = async () => {
    if (!form.name.trim() || !form.base_url.trim() || enabledMethods === 0) { setMsg({ ok: false, text: "Укажите имя, base URL и хотя бы один метод" }); return; }
    setBusy(true); setMsg(null);
    try { await onSave(form); resetForm(); setMsg({ ok: true, text: "Сохранено" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await testRevisorStand(id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить стенд?")) return;
    setBusy(true);
    try { await onDelete(id); if (form.id === id) resetForm(); }
    finally { setBusy(false); }
  };

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Ревизор — подключения к стендам" message={msg}
      listTitle={`Сохранённые (${stands.length})`}
      list={<>
        {stands.length === 0 && <p className="text-xs text-text-muted/60">Пока нет стендов.</p>}
        {stands.map((s) => {
          const active = Object.entries(s.methods ?? {}).filter(([, c]) => c.enabled).map(([k, c]) => c.label || defs.find(m => m.key === k)?.label || k);
          return (
            <ConnectionRow
              key={s.id ?? s.name}
              name={s.name}
              subtitle={`${active.join(", ") || "методы не выбраны"} · ${s.base_url}`}
              actions={[
                { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(s.id ?? ""), disabled: busy, hoverClass: "hover:text-emerald-600" },
                { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { const next = emptyRevisorStand(defs); setForm({ ...next, ...s, token: s.token ?? "", methods: { ...next.methods, ...(s.methods ?? {}) } }); setMsg(null); }, hoverClass: "hover:text-primary" },
                { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(s.id ?? ""), hoverClass: "hover:bg-red-50 hover:text-red-500" },
              ]}
            />
          );
        })}
      </>}
      formTitle={form.id ? "Изменить" : "Новый стенд"}
      form={<>
        <input className={INPUT_CLS} value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Имя стенда (напр. НТ)" />
        <input className={INPUT_CLS} value={form.namespace ?? ""} onChange={(e) => setField("namespace", e.target.value)} placeholder="Namespace (опц.)" spellCheck={false} />
        <input className={INPUT_CLS} value={form.base_url} onChange={(e) => setField("base_url", e.target.value)} placeholder="Base URL — https://stand.example.ru" spellCheck={false} />
        <Select  value={form.auth_type} onChange={(value) => setField("auth_type", value as RevisorStandConfig["auth_type"])}>
          <option value="none">Без токена</option><option value="bearer">Bearer token</option><option value="api_key">API key header</option>
        </Select>
        {form.auth_type !== "none" && (
          <PasswordInput fieldKey="token" value={form.token ?? ""} onChange={(_, v) => setField("token", v)} placeholder="Token" />
        )}

        <div className="rounded-lg border border-border-main overflow-hidden">
          <div className="grid grid-cols-[1fr,52px,minmax(90px,1fr)] bg-bg-subtle/80 border-b border-border-main">
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted">Метод</div>
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted border-l border-border-main">Вкл.</div>
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted border-l border-border-main">API path</div>
          </div>
          {defs.map((method) => {
            const cfg = form.methods[method.key] ?? { enabled: false, path: "", label: method.label };
            return (
              <div key={method.key} className="grid grid-cols-[1fr,52px,minmax(90px,1fr)] border-b border-border-main last:border-0">
                <div className="px-2.5 py-1.5 text-xs text-text-main truncate">{method.label}</div>
                <div className="px-2.5 py-1.5 border-l border-border-main flex items-center justify-center">
                  <input type="checkbox" checked={cfg.enabled} onChange={(e) => setMethod(method.key, { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-primary" />
                </div>
                <div className="px-1.5 py-1 border-l border-border-main">
                  <input className={`${INPUT_CLS} text-xs px-1.5 py-1`} value={cfg.path} onChange={(e) => setMethod(method.key, { path: e.target.value, enabled: cfg.enabled || !!e.target.value })} placeholder={`/api/${method.key}`} spellCheck={false} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          {form.id && <button type="button" onClick={resetForm} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
          <button type="button" onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </>}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Test Data Connections (единый выбор драйвера — postgresql/mysql/oracle/свой) ─

const EMPTY_TD_CONN: TestDataConnectionCreate = {
  display_name: "", driver_id: "", host: "localhost", port: 5432, db_name: "", login: "", password: "",
};

function TestDataConnectionsModal({ open, onClose, connections, drivers, onRefresh, onManageDrivers }: {
  open: boolean; onClose: () => void;
  connections: TestDataConnection[];
  drivers: JdbcDriver[];
  onRefresh: () => Promise<void>;
  onManageDrivers: () => void;
}) {
  const [form, setForm] = useState<TestDataConnectionCreate & { id?: string }>(EMPTY_TD_CONN);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [introspecting, setIntrospecting] = useState<string | null>(null);

  function setField<K extends keyof (TestDataConnectionCreate & { id?: string })>(key: K, value: (TestDataConnectionCreate & { id?: string })[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const reset = () => { setForm(EMPTY_TD_CONN); setMsg(null); };

  const save = async () => {
    if (!form.display_name.trim() || !form.host.trim() || !form.db_name.trim()) { setMsg({ ok: false, text: "Укажите название, хост и имя БД" }); return; }
    if (!form.driver_id) { setMsg({ ok: false, text: "Выберите драйвер" }); return; }
    setBusy(true); setMsg(null);
    try {
      if (form.id) await updateTestDataConnection(form.id, form);
      else await createTestDataConnection(form);
      await onRefresh(); reset();
      setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await testTestDataConnection(id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const introspect = async (id: string) => {
    setIntrospecting(id); setMsg(null);
    try {
      const r = await introspectTestDataConnection(id);
      setMsg({ ok: true, text: `Схема получена: ${r.table_count} таблиц, ${r.column_count} колонок` });
      await onRefresh();
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setIntrospecting(null); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить подключение?")) return;
    setBusy(true);
    try { await deleteTestDataConnection(id); await onRefresh(); if (form.id === id) reset(); }
    finally { setBusy(false); }
  };

  const selectedDriver = drivers.find(d => d.id === form.driver_id);

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Тестовые данные — подключения к БД" message={msg}
      listTitle={`Сохранённые (${connections.length})`}
      list={<>
        {connections.length === 0 && <p className="text-xs text-text-muted/60">Пока нет подключений.</p>}
        {connections.map((c) => {
          const dbLabel = drivers.find(d => d.id === c.driver_id)?.name ?? "неизвестный драйвер";
          const schemaNote = c.cached_schema ? ` · схема: ${Object.keys(c.cached_schema).length} таблиц` : "";
          return (
            <ConnectionRow
              key={c.id}
              name={c.display_name}
              subtitle={`${dbLabel} · ${c.host}:${c.port}/${c.db_name}${schemaNote}`}
              actions={[
                { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(c.id), disabled: busy, hoverClass: "hover:text-emerald-600" },
                { key: "schema", icon: <Database className="h-3.5 w-3.5" />, title: "Получить схему", onClick: () => introspect(c.id), disabled: introspecting === c.id, hoverClass: "hover:text-teal-600" },
                { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { setForm({ ...EMPTY_TD_CONN, ...c, id: c.id, password: c.password }); setMsg(null); }, hoverClass: "hover:text-primary" },
                { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(c.id), hoverClass: "hover:bg-red-50 hover:text-red-500" },
              ]}
            />
          );
        })}
      </>}
      formTitle={form.id ? "Изменить" : "Новое подключение"}
      form={<>
        <input className={INPUT_CLS} value={form.display_name} onChange={e => setField("display_name", e.target.value)} placeholder="Название (напр. Продуктовая БД)" />
        <div className="flex gap-2">
          <Select className="flex-1" value={form.driver_id}
            onChange={(value) => {
              const driverId = value;
              const drv = drivers.find(d => d.id === driverId);
              setForm(prev => ({
                ...prev, driver_id: driverId,
                port: drv?.default_port ?? prev.port,
                db_name: prev.db_name || drv?.default_db_name || "",
                login: prev.login || drv?.default_login || "",
              }));
            }}>
            <option value="">— выберите драйвер —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}{d.built_in ? "" : " (свой)"}</option>)}
          </Select>
          <button type="button" onClick={onManageDrivers} title="Настройка драйверов"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-main px-2.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="h-3.5 w-3.5" /> Настройка драйверов
          </button>
        </div>
        {selectedDriver && !selectedDriver.jar_path && !selectedDriver.jar_filename && (
          <p className="text-xs text-amber-600">У драйвера «{selectedDriver.name}» не подключена библиотека — укажите .jar в «Настройке драйверов».</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input className={INPUT_CLS} value={form.host} onChange={e => setField("host", e.target.value)} placeholder="Хост" spellCheck={false} />
          <input className={INPUT_CLS} type="number" value={form.port} onChange={e => setField("port", parseInt(e.target.value) || 0)} placeholder="Порт" />
        </div>
        <input className={INPUT_CLS} value={form.db_name} onChange={e => setField("db_name", e.target.value)} placeholder="Имя БД" spellCheck={false} />
        <input className={INPUT_CLS} value={form.login} onChange={e => setField("login", e.target.value)} placeholder="Логин" spellCheck={false} />
        <PasswordInput fieldKey="password" value={form.password} onChange={(_, v) => setField("password", v)} placeholder="Пароль" />
        {selectedDriver?.sql_dialect === "oracle" && (
          <input className={INPUT_CLS} value={form.schema_name ?? ""} onChange={e => setField("schema_name" as "display_name", e.target.value)} placeholder="Schema name" spellCheck={false} />
        )}
        <div className="flex justify-end gap-2 pt-1">
          {form.id && <button type="button" onClick={reset} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
          <button type="button" onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </>}
    />
  );
}

// ── Настройка драйверов (DBeaver-style: список + вкладки Настройки/Библиотека) ──

const NEW_DRIVER_ID = "__new__";
const EMPTY_DRIVER_SETTINGS: JdbcDriverSettings = {
  name: "", driver_class: "", url_template: "", default_port: null, default_db_name: "", default_login: "",
};

function DriverManagerModal({ open, onClose, drivers, onRefresh }: {
  open: boolean; onClose: () => void;
  drivers: JdbcDriver[];
  onRefresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<"settings" | "library">("settings");
  const [settingsForm, setSettingsForm] = useState<JdbcDriverSettings>(EMPTY_DRIVER_SETTINGS);
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = selectedId === NEW_DRIVER_ID ? undefined : drivers.find(d => d.id === selectedId);
  const hasLibrary = (d: JdbcDriver) => !!(d.jar_path || d.jar_filename);

  useEffect(() => {
    if (open && !selectedId && drivers.length > 0) setSelectedId(drivers[0].id);
  }, [open, drivers, selectedId]);

  useEffect(() => {
    if (selected) {
      setSettingsForm({
        name: selected.name, driver_class: selected.driver_class, url_template: selected.url_template,
        default_port: selected.default_port, default_db_name: selected.default_db_name, default_login: selected.default_login,
      });
      setPathInput(selected.jar_path ?? "");
    } else if (selectedId === NEW_DRIVER_ID) {
      setSettingsForm(EMPTY_DRIVER_SETTINGS);
      setPathInput("");
    }
    setMsg(null);
  }, [selectedId]);

  const saveSettings = async () => {
    if (!settingsForm.name.trim() || !settingsForm.driver_class.trim() || !settingsForm.url_template.trim()) {
      setMsg({ ok: false, text: "Укажите имя, класс драйвера и шаблон URL" }); return;
    }
    setBusy(true); setMsg(null);
    try {
      if (selectedId === NEW_DRIVER_ID) {
        const r = await createJdbcDriver(settingsForm);
        await onRefresh();
        setSelectedId(r.driver.id);
        setActiveTab("library");
        setMsg({ ok: true, text: "Драйвер создан — теперь добавьте библиотеку" });
      } else if (selected) {
        await updateJdbcDriver(selected.id, settingsForm);
        await onRefresh();
        setMsg({ ok: true, text: "Настройки сохранены" });
      }
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const uploadLibrary = async (file: File) => {
    if (!selected) return;
    setBusy(true); setMsg(null);
    try { await uploadJdbcDriverLibrary(selected.id, file); await onRefresh(); setMsg({ ok: true, text: "Библиотека загружена" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const saveLibraryPath = async () => {
    if (!selected) return;
    const p = pathInput.trim();
    if (!p) { setMsg({ ok: false, text: "Укажите путь к .jar-файлу" }); return; }
    setBusy(true); setMsg(null);
    try { await setJdbcDriverLibraryPath(selected.id, p); await onRefresh(); setMsg({ ok: true, text: "Путь к библиотеке сохранён" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const removeLibrary = async () => {
    if (!selected) return;
    setBusy(true); setMsg(null);
    try { await removeJdbcDriverLibrary(selected.id); await onRefresh(); setMsg({ ok: true, text: "Библиотека удалена" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const testDriver = async () => {
    if (!selected) return;
    setTesting(true); setMsg(null);
    try { const r = await testJdbcDriver(selected.id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setTesting(false); }
  };

  const deleteDriver = async () => {
    if (!selected || selected.built_in) return;
    if (!window.confirm("Удалить драйвер? Подключения, использующие его, перестанут работать.")) return;
    setBusy(true);
    try {
      await deleteJdbcDriver(selected.id);
      await onRefresh();
      setSelectedId(drivers.find(d => d.id !== selected.id)?.id ?? "");
    } finally { setBusy(false); }
  };

  const showForm = !!selected || selectedId === NEW_DRIVER_ID;

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Настройка драйверов" message={msg} size="max-w-3xl"
      listTitle={`Драйверы (${drivers.length})`}
      list={<>
        {drivers.map((d) => (
          <button key={d.id} type="button" onClick={() => setSelectedId(d.id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
              selectedId === d.id ? "border-primary bg-primary/5" : "border-border-main hover:bg-bg-subtle"
            }`}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-main">{d.name}</p>
              <p className="truncate text-[11px] text-text-muted">
                {d.built_in ? "Встроенный" : "Свой"} · {hasLibrary(d) ? (d.original_filename ?? "библиотека") : "библиотека не подключена"}
              </p>
            </div>
            {!hasLibrary(d) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          </button>
        ))}
        <button type="button" onClick={() => setSelectedId(NEW_DRIVER_ID)}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-2.5 py-2 text-xs font-semibold transition-colors ${
            selectedId === NEW_DRIVER_ID ? "border-primary bg-primary/5 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"
          }`}>
          <Plus className="h-3.5 w-3.5" /> Новый драйвер
        </button>
      </>}
      formTitle={selected ? selected.name : selectedId === NEW_DRIVER_ID ? "Новый драйвер" : "Выберите драйвер слева"}
      form={showForm ? <>
        <Tabs tabs={[{ id: "settings", label: "Настройки" }, { id: "library", label: "Библиотека" }]}
          active={activeTab} onChange={(id) => setActiveTab(id as "settings" | "library")} />
        {activeTab === "settings" ? (
          <div className="space-y-2 pt-3">
            <input className={INPUT_CLS} value={settingsForm.name} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))} placeholder="Имя драйвера" />
            <input className={`${INPUT_CLS} font-mono`} value={settingsForm.driver_class} onChange={e => setSettingsForm(f => ({ ...f, driver_class: e.target.value }))} placeholder="Класс драйвера (напр. org.postgresql.Driver)" spellCheck={false} />
            <input className={`${INPUT_CLS} font-mono`} value={settingsForm.url_template} onChange={e => setSettingsForm(f => ({ ...f, url_template: e.target.value }))} placeholder="jdbc:postgresql://{host}:{port}/{db_name}" spellCheck={false} />
            <div className="grid grid-cols-3 gap-2">
              <input className={INPUT_CLS} type="number" value={settingsForm.default_port ?? ""} onChange={e => setSettingsForm(f => ({ ...f, default_port: e.target.value ? parseInt(e.target.value) : null }))} placeholder="Порт" />
              <input className={INPUT_CLS} value={settingsForm.default_db_name ?? ""} onChange={e => setSettingsForm(f => ({ ...f, default_db_name: e.target.value }))} placeholder="БД по умолчанию" />
              <input className={INPUT_CLS} value={settingsForm.default_login ?? ""} onChange={e => setSettingsForm(f => ({ ...f, default_login: e.target.value }))} placeholder="Логин по умолчанию" />
            </div>
            <div className="flex items-center justify-between pt-1">
              {selected && !selected.built_in ? (
                <button type="button" onClick={deleteDriver} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Удалить драйвер
                </button>
              ) : <span />}
              <button type="button" onClick={saveSettings} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-3">
            {selectedId === NEW_DRIVER_ID ? (
              <p className="text-xs text-text-muted/70">Сначала сохраните настройки драйвера во вкладке «Настройки» — библиотеку можно будет подключить сразу после.</p>
            ) : selected && (
              <>
                {/* Текущее состояние библиотеки */}
                <div className="flex items-center justify-between rounded-lg border border-border-main px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text-main">{hasLibrary(selected) ? (selected.original_filename ?? "библиотека") : "Библиотека не подключена"}</p>
                    {hasLibrary(selected) && (
                      <p className="truncate text-[11px] text-text-muted">{selected.jar_path ? `по пути: ${selected.jar_path}` : "загруженный файл"}</p>
                    )}
                  </div>
                  {hasLibrary(selected) && (
                    <button type="button" onClick={removeLibrary} title="Отключить библиотеку" className="rounded p-1 text-text-muted hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Способ 1 (рекомендуется): указать путь к .jar на машине */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-main">Путь к .jar на этом компьютере <span className="text-text-muted/70">(рекомендуется)</span></label>
                  <div className="flex gap-2">
                    <input className={`${INPUT_CLS} font-mono`} value={pathInput} spellCheck={false}
                      onChange={e => setPathInput(e.target.value)}
                      placeholder="/Users/you/drivers/postgresql-42.7.jar" />
                    <button type="button" onClick={saveLibraryPath} disabled={busy || !pathInput.trim()}
                      className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
                      Указать
                    </button>
                  </div>
                  <p className="text-[11px] text-text-muted/70">Файл не копируется — драйвер читается по пути. Заменить версию = положить новый .jar по тому же пути, перезапуск бэкенда не нужен.</p>
                </div>

                {/* Способ 2: загрузить .jar в приложение */}
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-border-main px-3 py-2 text-sm text-text-muted cursor-pointer hover:bg-bg-subtle">
                  <Upload className="h-4 w-4 shrink-0" />
                  <span className="truncate">Или загрузить .jar в приложение…</span>
                  <input type="file" accept=".jar" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadLibrary(f); }} />
                </label>

                <div className="flex justify-end">
                  <button type="button" onClick={testDriver} disabled={testing || !hasLibrary(selected)}
                    className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-xs font-medium text-text-main hover:bg-bg-subtle disabled:opacity-50">
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Проверить загрузку класса
                  </button>
                </div>
              </>
            )}
            <p className="text-[11px] text-text-muted/70">
              Драйвер загружается «на лету» при каждом подключении — заменённую библиотеку не нужно ждать до перезапуска бэкенда.
            </p>
          </div>
        )}
      </> : <p className="text-xs text-text-muted/60">Выберите драйвер слева или создайте новый.</p>}
    />
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

function LogsVpsConnectionsModal({
  open, onClose, connections, onRefresh,
}: {
  open: boolean; onClose: () => void;
  connections: LogsVpsConnection[];
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<LogsVpsConnection>>({ vps_type: "graylog", auth_type: "none", ssl_verify: true, enabled: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => { setForm({ vps_type: "graylog", auth_type: "none", ssl_verify: true, enabled: true }); setMsg(null); };

  const save = async () => {
    if (!form.name?.trim() || !form.base_url?.trim()) { setMsg({ ok: false, text: "Укажите название и base URL" }); return; }
    setBusy(true); setMsg(null);
    try {
      await saveLogsVpsConnection(form as LogsVpsConnection & { name: string; base_url: string });
      await onRefresh(); reset();
      setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await testLogsVpsConnection(id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить подключение?")) return;
    setBusy(true);
    try { await deleteLogsVpsConnection(id); await onRefresh(); if (form.id === id) reset(); }
    finally { setBusy(false); }
  };

  const needsToken = form.auth_type === "bearer" || form.auth_type === "api_key";
  const needsBasic = form.auth_type === "basic";

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Логи — подключения к VPS" message={msg}
      listTitle={`Сохранённые (${connections.length})`}
      list={<>
        {connections.length === 0 && <p className="text-xs text-text-muted/60">Пока нет подключений.</p>}
        {connections.map((c) => (
          <ConnectionRow
            key={c.id}
            name={`${c.name}${c.enabled === false ? " (выкл.)" : ""}`}
            subtitle={`${VPS_TYPE_OPTIONS.find(o => o.value === c.vps_type)?.label ?? c.vps_type} · ${c.base_url}`}
            actions={[
              { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(c.id!), disabled: busy, hoverClass: "hover:text-emerald-600" },
              { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { setForm({ ...c }); setMsg(null); }, hoverClass: "hover:text-primary" },
              { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(c.id!), hoverClass: "hover:bg-red-50 hover:text-red-500" },
            ]}
          />
        ))}
      </>}
      formTitle={form.id ? "Изменить" : "Новое подключение"}
      form={<>
        <input className={INPUT_CLS} value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Название (напр. Graylog Production)" />
        <Select  value={form.vps_type || "graylog"} onChange={(value) => setForm(f => ({ ...f, vps_type: value as LogsVpsConnection["vps_type"] }))}>
          {VPS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <input className={`${INPUT_CLS} font-mono`} value={form.base_url || ""} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://graylog.company.ru/api" />
        <Select  value={form.auth_type || "none"} onChange={(value) => setForm(f => ({ ...f, auth_type: value as LogsVpsConnection["auth_type"] }))}>
          {VPS_AUTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        {needsToken && (
          <PasswordInput fieldKey="token" value={form.token || ""} onChange={(_, v) => setForm(f => ({ ...f, token: v }))} placeholder={form.auth_type === "bearer" ? "Bearer токен" : "API ключ"} />
        )}
        {needsBasic && <div className="grid grid-cols-2 gap-2">
          <input className={INPUT_CLS} value={form.username || ""} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="Логин" spellCheck={false} />
          <PasswordInput fieldKey="password" value={form.password || ""} onChange={(_, v) => setForm(f => ({ ...f, password: v }))} placeholder="Пароль" />
        </div>}
        <input className={INPUT_CLS} value={form.default_index || ""} onChange={e => setForm(f => ({ ...f, default_index: e.target.value }))} placeholder="Индекс / Стрим (опционально)" />
        <div className="flex items-center gap-3 pt-1">
          <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
            <input type="checkbox" checked={form.ssl_verify !== false} onChange={e => setForm(f => ({ ...f, ssl_verify: e.target.checked }))} className="rounded border-border-main text-primary focus:ring-primary/30" />
            SSL verify
          </label>
          <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
            <input type="checkbox" checked={form.enabled !== false} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="rounded border-border-main text-primary focus:ring-primary/30" />
            Активно
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {form.id && <button type="button" onClick={reset} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
          <button type="button" onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </>}
    />
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
  const [jdbcDrivers, setJdbcDrivers] = useState<JdbcDriver[]>([]);

  const [revisorModalOpen, setRevisorModalOpen] = useState(false);
  const [tdModalOpen, setTdModalOpen] = useState(false);
  const [logsVpsModalOpen, setLogsVpsModalOpen] = useState(false);
  const [jdbcModalOpen, setJdbcModalOpen] = useState(false);

  // LLM provider statuses
  const [llmStatuses, setLlmStatuses] = useState<Record<string, TestResult>>({});
  const [llmTesting, setLlmTesting] = useState<string | null>(null);

  // Section test results
  const [kafkaMetricsResult, setKafkaMetricsResult] = useState<TestResult | null>(null);
  const [kafkaMetricsTesting, setKafkaMetricsTesting] = useState(false);
  const [chromaResult, setChromaResult] = useState<TestResult | null>(null);
  const [chromaTesting, setChromaTesting] = useState(false);
  const [pgResult, setPgResult] = useState<TestResult | null>(null);
  const [pgTesting, setPgTesting] = useState(false);

  // Save statuses per section
  const [llmSave, setLlmSave] = useState<{ status: SaveStatus; err: string }>({ status: "idle", err: "" });
  const [kafkaMetricsSave, setKafkaMetricsSave] = useState<{ status: SaveStatus; err: string }>({ status: "idle", err: "" });

  const loadSettings = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [map, custom, revisor, tdConns, logsVps, drivers] = await Promise.all([
        getSettings(), getCustomLlmProviders(), getRevisorStands(),
        listTestDataConnections().catch(() => [] as TestDataConnection[]),
        getLogsVpsConnections().catch(() => ({ connections: [] as LogsVpsConnection[] })),
        listJdbcDrivers().catch(() => [] as JdbcDriver[]),
      ]);
      const vals: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const [k, v] of Object.entries(map)) { vals[k] = v.value; descs[k] = v.description; }
      setValues(vals); setDescriptions(descs);
      setCustomProviders(custom);
      setRevisorMethods(revisor.methods); setRevisorStands(revisor.stands);
      setTdConnections(tdConns);
      setLogsVpsConns(logsVps.connections || []);
      setJdbcDrivers(drivers);
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
      await handleSaveFields(GIGACHAT_FIELDS.map(f => f.key), true);
      setLlmSave({ status: "saved", err: "" }); setTimeout(() => setLlmSave({ status: "idle", err: "" }), 3000);
    } catch (e) { setLlmSave({ status: "error", err: e instanceof Error ? e.message : String(e) }); }
  }

  async function saveKafkaMetrics() {
    setKafkaMetricsSave({ status: "saving", err: "" });
    try {
      await handleSaveFields(METRICS_KAFKA_FIELDS.map(f => f.key));
      setKafkaMetricsSave({ status: "saved", err: "" }); setTimeout(() => setKafkaMetricsSave({ status: "idle", err: "" }), 3000);
    } catch (e) { setKafkaMetricsSave({ status: "error", err: e instanceof Error ? e.message : String(e) }); }
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
    <div className="max-w-5xl mx-auto p-6 space-y-4 overflow-y-auto scrollbar-thin">
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
          onSaveBuiltinBatch={async (vals) => {
            await saveSettings(vals);
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

      {/* ═══ 2. Kafka — Метрики ═══ */}
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

      {/* ═══ 3. Ревизор — API стенды ═══ */}
      <SectionCard
        icon={<Server className="w-4 h-4 text-teal-500" />}
        title="Ревизор — API стенды"
        subtitle="Подключения к стендам для сравнения сборок, версий и статусов"
        headerRight={
          <button type="button" onClick={() => setRevisorModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="h-3.5 w-3.5" /> Подключения
          </button>
        }
      >
        <p className="text-sm text-text-muted">
          {revisorStands.length === 0
            ? "Подключений пока нет — добавьте стенд, чтобы Ревизор мог сравнивать сборки."
            : `Настроено стендов: ${revisorStands.length} — ${revisorStands.map(s => s.name).join(", ")}`}
        </p>
      </SectionCard>

      {/* ═══ 4. Тестовые данные — внешние БД ═══ */}
      <SectionCard
        icon={<Server className="w-4 h-4 text-cyan-500" />}
        title="Тестовые данные — подключения к БД"
        subtitle="Внешние базы данных для поиска и генерации тестовых данных — PostgreSQL, MySQL, Oracle или свой JDBC-драйвер"
        headerRight={
          <button type="button" onClick={() => setTdModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="h-3.5 w-3.5" /> Подключения
          </button>
        }
      >
        <p className="text-sm text-text-muted">
          {tdConnections.length === 0
            ? "Подключений пока нет — добавьте внешнюю БД для генерации тестовых данных."
            : `Настроено подключений: ${tdConnections.length} — ${tdConnections.map(c => c.display_name).join(", ")}`}
        </p>
      </SectionCard>

      {/* ═══ Jira — регистрация дефектов ═══ */}
      <SectionCard
        icon={<Bug className="w-4 h-4 text-red-500" />}
        title="Jira — регистрация дефектов"
        subtitle="Токен по логину/паролю Сигмы, файлом или строкой; проект и лейблы — на вкладке Дефекты"
      >
        <JiraSettingsBlock />
      </SectionCard>

      {/* ═══ 5. Логи (VPS) ═══ */}
      <SectionCard
        icon={<ScrollText className="w-4 h-4 text-indigo-500" />}
        title="Логи — подключения к VPS"
        subtitle="Graylog, Elasticsearch, Loki или произвольный REST API для анализа логов микросервисов"
        headerRight={
          <button type="button" onClick={() => setLogsVpsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="h-3.5 w-3.5" /> Подключения
          </button>
        }
      >
        <p className="text-sm text-text-muted">
          {logsVpsConns.length === 0
            ? "Подключений пока нет — добавьте VPS-платформу для анализа логов."
            : `Настроено подключений: ${logsVpsConns.length} — ${logsVpsConns.map(c => c.name).join(", ")}`}
        </p>
      </SectionCard>

      {/* ═══ 6. Базы данных ═══ */}
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

      <RevisorConnectionsModal
        open={revisorModalOpen} onClose={() => setRevisorModalOpen(false)}
        methods={revisorMethods} stands={revisorStands}
        onSave={async (s) => { await saveRevisorStand(s); await loadSettings(); }}
        onDelete={async (id) => { await deleteRevisorStand(id); await loadSettings(); }}
      />
      <TestDataConnectionsModal
        open={tdModalOpen} onClose={() => setTdModalOpen(false)}
        connections={tdConnections}
        drivers={jdbcDrivers}
        onManageDrivers={() => setJdbcModalOpen(true)}
        onRefresh={async () => {
          const conns = await listTestDataConnections().catch(() => [] as TestDataConnection[]);
          setTdConnections(conns);
        }}
      />
      <DriverManagerModal
        open={jdbcModalOpen} onClose={() => setJdbcModalOpen(false)}
        drivers={jdbcDrivers}
        onRefresh={async () => {
          const drivers = await listJdbcDrivers().catch(() => [] as JdbcDriver[]);
          setJdbcDrivers(drivers);
        }}
      />
      <LogsVpsConnectionsModal
        open={logsVpsModalOpen} onClose={() => setLogsVpsModalOpen(false)}
        connections={logsVpsConns}
        onRefresh={async () => {
          const res = await getLogsVpsConnections().catch(() => ({ connections: [] as LogsVpsConnection[] }));
          setLogsVpsConns(res.connections || []);
        }}
      />
    </div>
  );
}
