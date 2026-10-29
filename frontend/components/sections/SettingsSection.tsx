"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Eye, EyeOff, Save, Settings, Plus, Trash2,
  Zap, Database, Shield, ChevronDown, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Play,
  Upload, RefreshCw,
} from "lucide-react";
import { Select } from "@/components/ui";
import {
  getSettings, saveSettings,
  getCustomLlmProviders, saveCustomLlmProvider, deleteCustomLlmProvider,
  testLlmConnection, testChromaDb, testPostgres,
  type CustomLlmProvider, type TestResult,
} from "@/lib/settingsApi";
import {
  getGigachatModels, testGigachatChat, uploadGigachatCert,
  getSystemConfig,
} from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// ── Style constants ───────────────────────────────────────────────────────────

const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";
const INPUT_CLS =
  "w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition";
const MASKED_PLACEHOLDER = "●●●●●●●●●●●●";

/* Три подключения GigaChat (бэкенд: GIGA_PROFILES в agents/llm_client.py).
   Личный и Corp — публичный API по ключу авторизации, различаются scope; IFT — стенд по сертификату.
   Везде порядок один: «Подключиться» (GET /models) → выбрать модель → сохранить. */
const GIGACHAT_IFT_URL = "https://gigachat-ift.sberdevices.delta.sbrf.ru/api/v1";
const GIGA_CORP_SCOPES = [
  { value: "GIGACHAT_API_CORP", label: "GIGACHAT_API_CORP — оплата по факту" },
  { value: "GIGACHAT_API_B2B", label: "GIGACHAT_API_B2B — пакеты токенов" },
];

interface GigaConn {
  id: string;
  name: string;
  auth: "api_key" | "certificate";
  modelField: string;
  keyField?: string;
  scopeField?: string;
  /** Подпись под названием: куда и как ходим. */
  note: string;
}

const GIGA_CONNS: GigaConn[] = [
  { id: "gigachat_pers", name: "Giga Личный", auth: "api_key", keyField: "gigachat_pers_auth_key",
    modelField: "gigachat_pers_model", note: "по ключу · GIGACHAT_API_PERS" },
  { id: "gigachat_corp", name: "Giga Corp", auth: "api_key", keyField: "gigachat_corp_auth_key",
    scopeField: "gigachat_corp_scope", modelField: "gigachat_corp_model", note: "по ключу" },
  { id: "gigachat", name: "Giga IFT", auth: "certificate", modelField: "gigachat_model", note: "по сертификату" },
];
const GIGA_BY_ID: Record<string, GigaConn> = Object.fromEntries(GIGA_CONNS.map(g => [g.id, g]));

// ── Field definitions ─────────────────────────────────────────────────────────

interface FieldDef {
  key: string; label: string;
  /** file — путь к файлу с кнопкой загрузки, как у сертификатов GigaChat. */
  type?: "text" | "password" | "select" | "file";
  options?: string[];
  /** Для type: "file" — что принимать в диалоге выбора. */
  accept?: string;
}

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
  ...GIGA_CONNS.map((g): ProviderPreset => ({
    id: g.id, name: g.name, color: "#21A038", iconLetter: "G",
    logo: "/logos/gigachat.svg",
    base_url: "", model: "", models: [],
    apiKeyLabel: "Ключ авторизации", builtin: true,
  })),
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

function UnifiedLlmProviders({
  builtinValues, customProviders, gigachatOnly, onSaveBuiltin, onSaveBuiltinBatch, onSaveCustom, onDeleteCustom, onRefresh,
}: {
  builtinValues: Record<string, string>;
  customProviders: CustomLlmProvider[];
  gigachatOnly: boolean;
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
  const [editScope, setEditScope] = useState("GIGACHAT_API_CORP");
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
    const allIds: string[] = GIGA_CONNS.map(g => g.id);
    for (const cp of customProviders) allIds.push(cp.id ?? cp.name);
    runStatusChecks(allIds);

    // Auto-refresh every 60s
    autoRefreshRef.current = setInterval(() => {
      const ids: string[] = GIGA_CONNS.map(g => g.id);
      for (const cp of customProviders) ids.push(cp.id ?? cp.name);
      runStatusChecks(ids);
    }, 60000);

    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [customProviders, runStatusChecks]);

  // Build list of active providers
  type ActiveProvider = { id: string; name: string; model: string; hasKey: boolean; builtin?: boolean; preset?: ProviderPreset; giga?: GigaConn };
  const activeProviders: ActiveProvider[] = [];

  // Встроенные: три подключения GigaChat — Личный и Corp по ключу, IFT по сертификату
  for (const g of GIGA_CONNS) {
    const hasKey = g.auth === "certificate"
      ? !!(builtinValues["gigachat_client_cert_path"] && builtinValues["gigachat_client_key_path"])
      : !!builtinValues[g.keyField!];
    activeProviders.push({ id: g.id, name: g.name, model: builtinValues[g.modelField] || "", hasKey, builtin: true,
      preset: PROVIDER_PRESETS.find(p => p.id === g.id), giga: g });
  }

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
    setEditKey(""); setEditAuthType("api_key"); setEditModel(""); setGigaModels([]);
    setEditCaCertPath(""); setEditClientCertPath(""); setEditClientKeyPath("");
    setEditBaseUrl("");
  }

  function openEdit(provider: ActiveProvider) {
    if (editingId === provider.id) { setEditingId(null); resetEditFields(); return; }
    setEditingId(provider.id);
    setEditKey("");
    setGigaModels([]); setModelsErr(""); setChatTestResult(null);
    const g = provider.giga;
    if (g) {
      setEditAuthType(g.auth);
      setEditModel(builtinValues[g.modelField] || "");
      setEditScope((g.scopeField && builtinValues[g.scopeField]) || "GIGACHAT_API_CORP");
      setEditCaCertPath(builtinValues["gigachat_ca_cert_path"] || "");
      setEditClientCertPath(builtinValues["gigachat_client_cert_path"] || "");
      setEditClientKeyPath(builtinValues["gigachat_client_key_path"] || "");
      setEditBaseUrl(builtinValues["gigachat_base_url"] || GIGACHAT_IFT_URL);
      // no_verify по умолчанию включён (корп. BIG IP), если настройка ещё не задана
      setEditNoVerify(builtinValues["gigachat_no_verify"] !== "");
    } else {
      setEditAuthType("api_key");
      setEditCaCertPath(""); setEditClientCertPath(""); setEditClientKeyPath("");
      setEditBaseUrl("");
    }
  }

  /* Живые поля формы подключения GigaChat: пустой ключ — бэкенд возьмёт сохранённый. */
  function gigaParams(g: GigaConn) {
    return g.auth === "api_key"
      ? { provider: g.id, credentials: editKey.trim(), scope: g.scopeField ? editScope : "" }
      : { provider: g.id, base_url: editBaseUrl.trim(), client_cert_path: editClientCertPath.trim(),
          client_key_path: editClientKeyPath.trim(), ca_cert_path: editCaCertPath.trim(), no_verify: editNoVerify };
  }

  /* «Подключиться» — GET /models по текущим полям формы: дозвонились — выбираем модель из списка. */
  async function loadGigaModels(g: GigaConn) {
    setLoadingModels(true); setModelsErr(""); setGigaModels([]); setChatTestResult(null);
    try {
      const r = await getGigachatModels(gigaParams(g));
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
  async function handleTestChat(g: GigaConn) {
    setChatTesting(true); setChatTestResult(null);
    try {
      const r = await testGigachatChat({ ...gigaParams(g), model: editModel.trim() });
      setChatTestResult(r);
    } catch (e) {
      setChatTestResult({ status: "red", message: e instanceof Error ? e.message : String(e) });
    } finally { setChatTesting(false); }
  }

  async function handleSaveConnection(provider: ActiveProvider) {
    setSaving(true); setErrMsg("");
    try {
      const g = provider.giga;
      if (g) {
        // Сохраняем только то, до чего дозвонились: модель — из списка, полученного «Подключиться»
        if (!gigaModels.includes(editModel)) {
          setErrMsg("Сначала нажмите «Подключиться» и выберите модель"); setSaving(false); return;
        }
        if (g.auth === "certificate") {
          await onSaveBuiltinBatch({
            gigachat_base_url: editBaseUrl.trim() || GIGACHAT_IFT_URL,
            gigachat_ca_cert_path: editCaCertPath.trim(),
            gigachat_client_cert_path: editClientCertPath.trim(),
            gigachat_client_key_path: editClientKeyPath.trim(),
            gigachat_no_verify: editNoVerify ? "1" : "",
            gigachat_model: editModel,
          });
        } else {
          await onSaveBuiltinBatch({
            [g.modelField]: editModel,
            ...(editKey.trim() ? { [g.keyField!]: editKey.trim() } : {}),   // пусто — ключ прежний
            ...(g.scopeField ? { [g.scopeField]: editScope } : {}),
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
                      {p.giga ? (p.model || "модель не выбрана") : p.model}{!hasKeyOrNoNeed ? (p.giga?.auth === "certificate" ? " · нет сертификата" : " · нет ключа") : ""}
                      {p.giga && ` · ${p.giga.note}${p.giga.scopeField && builtinValues[p.giga.scopeField] ? " · " + builtinValues[p.giga.scopeField] : ""}`}
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
                  {p.giga ? (
                    <div className="space-y-1.5">
                      {p.giga.auth === "api_key" ? (
                        <>
                          <div>
                            <label className={LABEL_CLS}>Ключ авторизации {p.giga.id === "gigachat_corp" ? "(кабинет юрлица)" : "(личный кабинет)"}</label>
                            <PasswordInput fieldKey="edit_key" value={editKey} onChange={(_, v) => { setEditKey(v); setGigaModels([]); }}
                              placeholder={p.hasKey ? "Сохранён — оставьте пустым или вставьте новый" : "Studio → GigaChat API → проект → Настройки API"} />
                          </div>
                          {p.giga.scopeField && (
                            <div>
                              <label className={LABEL_CLS}>Scope</label>
                              <Select value={editScope} onChange={(v) => { setEditScope(v); setGigaModels([]); }}>
                                {GIGA_CORP_SCOPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </Select>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                      {/* Сначала дозвониться: GET /models; модель выбирается только из полученного списка */}
                      <div>
                        <label className={LABEL_CLS}>Модель</label>
                        <div className="flex gap-2">
                          {gigaModels.length > 0 ? (
                            <Select className="flex-1" value={editModel} onChange={(v) => { setEditModel(v); setChatTestResult(null); }}>
                              {gigaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                            </Select>
                          ) : (
                            <p className={`${INPUT_CLS} flex-1 text-text-muted`}>
                              {editModel ? `${editModel} — подключитесь, чтобы сменить` : "Нажмите «Подключиться» — появится список моделей"}</p>
                          )}
                          <button type="button" onClick={() => loadGigaModels(p.giga!)}
                            disabled={loadingModels || (p.giga.auth === "api_key" ? !(editKey.trim() || p.hasKey) : !editClientCertPath.trim())}
                            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-xs font-medium text-text-main hover:bg-bg-subtle disabled:opacity-50">
                            {loadingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Подключиться
                          </button>
                        </div>
                        {modelsErr && <p className="mt-1 text-xs text-red-500">{modelsErr}</p>}
                        {gigaModels.length > 0 && !modelsErr && (
                          <p className="mt-1 text-xs text-green-600">Подключено — моделей: {gigaModels.length}</p>
                        )}
                      </div>
                      {/* Тест чата — POST /chat/completions теми же живыми параметрами формы */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <button type="button" onClick={() => handleTestChat(p.giga!)} disabled={chatTesting || !gigaModels.includes(editModel)}
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
                    <button onClick={() => handleSaveConnection(p)} disabled={saving || (!!p.giga && !gigaModels.includes(editModel))}
                      title={p.giga && !gigaModels.includes(editModel) ? "Сначала «Подключиться» и выбрать модель" : undefined}
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

      {/* Add new provider — скрыто на контурах с ограничением GIGACHAT_ONLY */}
      {/* Потолок TLS 1.2 — для всех провайдеров; включён по умолчанию (корп. прокси рвёт TLS 1.3 → Errno 54) */}
      <label className="flex items-start gap-2.5 bg-bg-subtle border border-border-main rounded-lg p-3 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={builtinValues["ssl_max_tls12"] !== ""}
          onChange={e => { void onSaveBuiltin("ssl_max_tls12", e.target.checked ? "1" : ""); }} />
        <span className="text-xs">
          <span className="font-semibold text-text-main">Корпоративный прокси: TLS 1.2</span>
          <span className="block text-text-muted mt-0.5">
            Соединения с моделями — не выше TLS 1.2. Корпоративный прокси рвёт TLS 1.3, и подключение падает
            с «[Errno 54] Connection reset by peer». Все провайдеры поддерживают TLS 1.2 — выключать незачем.</span>
        </span>
      </label>
      {gigachatOnly ? (
        <div className="bg-bg-subtle border border-border-main rounded-lg p-4 flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted">
            На этом контуре разрешён только GigaChat — подключение сторонних LLM-провайдеров отключено политикой безопасности.
          </p>
        </div>
      ) : (
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
      )}
    </div>
  );
}

// ── Revisor inline ──────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsSection() {
  const { bumpProviders } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = useState<CustomLlmProvider[]>([]);
  const [gigachatOnly, setGigachatOnly] = useState(false);

  // LLM provider statuses
  const [llmStatuses, setLlmStatuses] = useState<Record<string, TestResult>>({});
  const [llmTesting, setLlmTesting] = useState<string | null>(null);

  // Section test results
  const [chromaResult, setChromaResult] = useState<TestResult | null>(null);
  const [chromaTesting, setChromaTesting] = useState(false);
  const [pgResult, setPgResult] = useState<TestResult | null>(null);
  const [pgTesting, setPgTesting] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [map, custom, config] = await Promise.all([
        getSettings(), getCustomLlmProviders(),
        getSystemConfig().catch(() => ({ gigachat_only: false })),
      ]);
      const vals: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const [k, v] of Object.entries(map)) { vals[k] = v.value; descs[k] = v.description; }
      setValues(vals); setDescriptions(descs);
      setCustomProviders(custom);
      setGigachatOnly(config.gigachat_only);
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
          gigachatOnly={gigachatOnly}
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

    </div>
  );
}
