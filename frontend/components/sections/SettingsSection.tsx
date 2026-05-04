"use client";

import { useEffect, useState, useCallback } from "react";
import { Eye, EyeOff, Save, Settings, Plus, Trash2 } from "lucide-react";
import {
  getSettings, saveSettings,
  getCustomLlmProviders, saveCustomLlmProvider, deleteCustomLlmProvider,
  getRevisorStands, saveRevisorStand, deleteRevisorStand,
  type SettingsMap, type CustomLlmProvider, type RevisorStandConfig, type RevisorMethodDef,
} from "@/lib/settingsApi";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// ── Style constants ───────────────────────────────────────────────────────────

const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";
const INPUT_CLS =
  "w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg bg-white " +
  "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition";
const SELECT_CLS =
  "w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg bg-white " +
  "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition";

const MASKED_PLACEHOLDER = "●●●●●●●●●●●●";

// ── Secret field keys ─────────────────────────────────────────────────────────

const SECRET_KEYS = new Set([
  "gigachat_auth_key",
  "deepseek_api_key",
  "kafka_sasl_password",
  "kafka_ssl_password",
  "alerts_kafka_sasl_password",
  "alerts_kafka_ssl_password",
]);

// ── Section definitions ───────────────────────────────────────────────────────

interface FieldDef {
  key:     string;
  label:   string;
  type?:   "text" | "password" | "select";
  options?: string[];
}

const GIGACHAT_FIELDS: FieldDef[] = [
  {
    key: "gigachat_auth_type", label: "Тип подключения", type: "select",
    options: ["api_key", "certificate"],
  },
  { key: "gigachat_auth_key", label: "AUTH_KEY", type: "password" },
  { key: "gigachat_base_url", label: "Base URL" },
  { key: "gigachat_model", label: "Модель" },
  { key: "gigachat_ca_cert_path", label: "CA certificate path" },
  { key: "gigachat_client_cert_path", label: "Client certificate path" },
  { key: "gigachat_client_key_path", label: "Client key path" },
  {
    key: "gigachat_scope", label: "Scope", type: "select",
    options: ["GIGACHAT_API_PERS", "GIGACHAT_API_CORP"],
  },
  { key: "gigachat_auth_url", label: "OAuth URL" },
];

const DEEPSEEK_FIELDS: FieldDef[] = [
  {
    key: "deepseek_auth_type", label: "Тип подключения", type: "select",
    options: ["api_key", "certificate"],
  },
  { key: "deepseek_api_key", label: "API Key", type: "password" },
  { key: "deepseek_base_url", label: "Base URL" },
  {
    key: "deepseek_model", label: "Модель", type: "select",
    options: ["deepseek-chat", "deepseek-reasoner"],
  },
  { key: "deepseek_ca_cert_path", label: "CA certificate path" },
  { key: "deepseek_client_cert_path", label: "Client certificate path" },
  { key: "deepseek_client_key_path", label: "Client key path" },
];

const BUILTIN_LLM_FIELDS = [...GIGACHAT_FIELDS, ...DEEPSEEK_FIELDS];

const METRICS_KAFKA_FIELDS: FieldDef[] = [
  { key: "kafka_bootstrap_servers", label: "Bootstrap servers" },
  {
    key: "kafka_security_protocol", label: "Security protocol", type: "select",
    options: ["PLAINTEXT", "SASL_PLAINTEXT", "SASL_SSL", "SSL"],
  },
  {
    key: "kafka_sasl_mechanism", label: "SASL механизм", type: "select",
    options: ["", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "GSSAPI"],
  },
  { key: "kafka_sasl_username", label: "SASL логин" },
  { key: "kafka_sasl_password", label: "SASL пароль", type: "password" },
  { key: "kafka_ssl_cafile",    label: "SSL CA файл" },
  { key: "kafka_ssl_certfile",  label: "SSL client cert" },
  { key: "kafka_ssl_keyfile",   label: "SSL client key" },
  { key: "kafka_ssl_password",  label: "SSL key password", type: "password" },
  { key: "kafka_topic_data",        label: "Топик DATA" },
  { key: "kafka_topic_metadata",    label: "Топик METADATA" },
  { key: "kafka_topic_thresholds",  label: "Топик THRESHOLDS" },
];

const ALERTS_KAFKA_FIELDS: FieldDef[] = [
  { key: "alerts_kafka_bootstrap_servers", label: "Bootstrap servers" },
  {
    key: "alerts_kafka_security_protocol", label: "Security protocol", type: "select",
    options: ["PLAINTEXT", "SASL_PLAINTEXT", "SASL_SSL", "SSL"],
  },
  {
    key: "alerts_kafka_sasl_mechanism", label: "SASL механизм", type: "select",
    options: ["", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "GSSAPI"],
  },
  { key: "alerts_kafka_sasl_username", label: "SASL логин" },
  { key: "alerts_kafka_sasl_password", label: "SASL пароль", type: "password" },
  { key: "alerts_kafka_ssl_cafile",    label: "SSL CA файл" },
  { key: "alerts_kafka_ssl_certfile",  label: "SSL client cert" },
  { key: "alerts_kafka_ssl_keyfile",   label: "SSL client key" },
  { key: "alerts_kafka_ssl_password",  label: "SSL key password", type: "password" },
];

// ── PasswordInput ─────────────────────────────────────────────────────────────

function PasswordInput({
  fieldKey,
  value,
  onChange,
  placeholder,
}: {
  fieldKey: string;
  value: string;
  onChange: (key: string, val: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    // If user starts editing a masked placeholder — clear it first
    if (v === MASKED_PLACEHOLDER) return;
    onChange(fieldKey, v);
  }

  // When user focuses a masked field — clear it so they can type fresh value
  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    if (e.target.value === MASKED_PLACEHOLDER) {
      onChange(fieldKey, "");
    }
  }

  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className={INPUT_CLS + " pr-8"}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder={placeholder ?? ""}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
        tabIndex={-1}
        title={show ? "Скрыть" : "Показать"}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── SettingsCard ──────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

function SettingsCard({
  title,
  fields,
  values,
  descriptions,
  onChange,
  onSave,
}: {
  title:        string;
  fields:       FieldDef[];
  values:       Record<string, string>;
  descriptions: Record<string, string>;
  onChange:     (key: string, val: string) => void;
  onSave:       (keys: string[]) => Promise<void>;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSave() {
    setStatus("saving");
    setErrMsg("");
    try {
      await onSave(fields.map((f) => f.key));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <div className="bg-white border border-border-main rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-text-main">{title}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {fields.map((f) => {
          const val = values[f.key] ?? "";
          const isSecret = SECRET_KEYS.has(f.key);
          const desc = descriptions[f.key] ?? "";

          return (
            <div key={f.key}>
              <label className={LABEL_CLS}>
                {f.label}
                {isSecret && (
                  <span className="ml-1 text-[10px] text-text-muted font-normal">(секрет)</span>
                )}
              </label>
              {isSecret || f.type === "password" ? (
                <PasswordInput
                  fieldKey={f.key}
                  value={val}
                  onChange={onChange}
                  placeholder={desc}
                />
              ) : f.type === "select" && f.options ? (
                <select
                  className={SELECT_CLS}
                  value={val}
                  onChange={(e) => onChange(f.key, e.target.value)}
                >
                  {f.options.map((o) => (
                    <option key={o} value={o}>{o || "— не задано —"}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className={INPUT_CLS}
                  value={val}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={desc}
                  spellCheck={false}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {status === "saved" && (
          <span className="text-xs text-green-600 font-medium">Сохранено ✓</span>
        )}
        {status === "error" && (
          <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>
        )}
        <button
          onClick={handleSave}
          disabled={status === "saving"}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
            bg-primary text-white rounded-lg hover:bg-primary-dark
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-3 h-3" />
          {status === "saving" ? "Сохраняем..." : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function BuiltinLlmCard({
  values,
  descriptions,
  onChange,
  onSave,
}: {
  values:       Record<string, string>;
  descriptions: Record<string, string>;
  onChange:     (key: string, val: string) => void;
  onSave:       (keys: string[]) => Promise<void>;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSave() {
    setStatus("saving");
    setErrMsg("");
    try {
      await onSave(BUILTIN_LLM_FIELDS.map((f) => f.key));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function renderField(f: FieldDef) {
    const val = values[f.key] ?? "";
    const isSecret = SECRET_KEYS.has(f.key);
    const desc = descriptions[f.key] ?? "";

    return (
      <div key={f.key}>
        <label className={LABEL_CLS}>
          {f.label}
          {isSecret && (
            <span className="ml-1 text-[10px] text-text-muted font-normal">(секрет)</span>
          )}
        </label>
        {isSecret || f.type === "password" ? (
          <PasswordInput
            fieldKey={f.key}
            value={val}
            onChange={onChange}
            placeholder={desc}
          />
        ) : f.type === "select" && f.options ? (
          <select
            className={SELECT_CLS}
            value={val}
            onChange={(e) => onChange(f.key, e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o} value={o}>{o || "— не задано —"}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className={INPUT_CLS}
            value={val}
            onChange={(e) => onChange(f.key, e.target.value)}
            placeholder={desc}
            spellCheck={false}
          />
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-border-main rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-text-main">LLM — встроенные провайдеры</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">GigaChat</h3>
          {GIGACHAT_FIELDS.map(renderField)}
        </section>

        <section className="space-y-3 lg:border-l lg:border-border-main lg:pl-8">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">DeepSeek</h3>
          {DEEPSEEK_FIELDS.map(renderField)}
        </section>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {status === "saved" && (
          <span className="text-xs text-green-600 font-medium">Сохранено ✓</span>
        )}
        {status === "error" && (
          <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>
        )}
        <button
          onClick={handleSave}
          disabled={status === "saving"}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
            bg-primary text-white rounded-lg hover:bg-primary-dark
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-3 h-3" />
          {status === "saving" ? "Сохраняем..." : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

const EMPTY_CUSTOM_PROVIDER: CustomLlmProvider = {
  name: "",
  base_url: "",
  model: "",
  auth_type: "api_key",
  api_key: "",
  ca_cert_path: "",
  client_cert_path: "",
  client_key_path: "",
};

function CustomLlmCard({
  providers,
  onSave,
  onDelete,
}: {
  providers: CustomLlmProvider[];
  onSave: (provider: CustomLlmProvider) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState<CustomLlmProvider>(EMPTY_CUSTOM_PROVIDER);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [saved, setSaved] = useState(false);

  function setField<K extends keyof CustomLlmProvider>(key: K, value: CustomLlmProvider[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function editProvider(provider: CustomLlmProvider) {
    setForm({
      ...EMPTY_CUSTOM_PROVIDER,
      ...provider,
      api_key: provider.api_key ?? "",
      ca_cert_path: provider.ca_cert_path ?? "",
      client_cert_path: provider.client_cert_path ?? "",
      client_key_path: provider.client_key_path ?? "",
    });
    setErrMsg("");
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setErrMsg("");
    setSaved(false);
    try {
      await onSave(form);
      setForm({ ...EMPTY_CUSTOM_PROVIDER });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-border-main rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-main">Дополнительные LLM</h2>
        <p className="text-xs text-text-muted mt-1">
          Подключаются как chat/completions-compatible endpoint через API key или сертификат.
        </p>
      </div>

      {providers.length > 0 && (
        <div className="border border-border-main rounded-lg divide-y divide-border-main overflow-hidden">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-main truncate">{p.name}</p>
                <p className="text-xs text-text-muted truncate">
                  {p.model} · {p.auth_type === "certificate" ? "сертификат" : "API key"} · {p.base_url}
                </p>
              </div>
              <button
                type="button"
                onClick={() => editProvider(p)}
                className="px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle"
              >
                Изменить
              </button>
              <button
                type="button"
                onClick={() => p.id && onDelete(p.id)}
                className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50"
                title="Удалить"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <label className={LABEL_CLS}>Название</label>
          <input
            className={INPUT_CLS}
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="Например: Корп LLM"
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Модель</label>
          <input
            className={INPUT_CLS}
            value={form.model}
            onChange={(e) => setField("model", e.target.value)}
            placeholder="model-id"
            spellCheck={false}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS}>Base URL</label>
          <input
            className={INPUT_CLS}
            value={form.base_url}
            onChange={(e) => setField("base_url", e.target.value)}
            placeholder="https://llm.example.ru/v1"
            spellCheck={false}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Тип подключения</label>
          <select
            className={SELECT_CLS}
            value={form.auth_type}
            onChange={(e) => setField("auth_type", e.target.value as "api_key" | "certificate")}
          >
            <option value="api_key">API key</option>
            <option value="certificate">Сертификат</option>
          </select>
        </div>
        {form.auth_type === "api_key" ? (
          <div>
            <label className={LABEL_CLS}>API key <span className="text-[10px] text-text-muted">(секрет)</span></label>
            <PasswordInput
              fieldKey="api_key"
              value={form.api_key ?? ""}
              onChange={(_, val) => setField("api_key", val)}
              placeholder="Bearer token"
            />
          </div>
        ) : (
          <>
            <div>
              <label className={LABEL_CLS}>CA certificate path</label>
              <input
                className={INPUT_CLS}
                value={form.ca_cert_path ?? ""}
                onChange={(e) => setField("ca_cert_path", e.target.value)}
                placeholder="/path/to/ca.pem"
                spellCheck={false}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Client certificate path</label>
              <input
                className={INPUT_CLS}
                value={form.client_cert_path ?? ""}
                onChange={(e) => setField("client_cert_path", e.target.value)}
                placeholder="/path/to/client.crt"
                spellCheck={false}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Client key path</label>
              <input
                className={INPUT_CLS}
                value={form.client_key_path ?? ""}
                onChange={(e) => setField("client_key_path", e.target.value)}
                placeholder="/path/to/client.key"
                spellCheck={false}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-green-600 font-medium">Сохранено ✓</span>}
        {errMsg && <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>}
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.base_url.trim() || !form.model.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
            bg-primary text-white rounded-lg hover:bg-primary-dark
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-3 h-3" />
          {saving ? "Сохраняем..." : form.id ? "Обновить LLM" : "Добавить LLM"}
        </button>
      </div>
    </div>
  );
}

const DEFAULT_REVISOR_METHODS: RevisorMethodDef[] = [
  { key: "build", label: "Сборка" },
  { key: "version", label: "Версия" },
  { key: "status", label: "Статус" },
  { key: "pods", label: "Поды" },
  { key: "health", label: "Health" },
];

function emptyRevisorStand(methods: RevisorMethodDef[]): RevisorStandConfig {
  const methodMap: RevisorStandConfig["methods"] = {};
  for (const method of methods) {
    methodMap[method.key] = { enabled: false, path: "", label: method.label };
  }
  return {
    name: "",
    base_url: "",
    auth_type: "bearer",
    token: "",
    api_key_header: "Authorization",
    namespace: "",
    enabled: true,
    methods: methodMap,
  };
}

function RevisorApiCard({
  methods,
  stands,
  onSave,
  onDelete,
}: {
  methods: RevisorMethodDef[];
  stands: RevisorStandConfig[];
  onSave: (stand: RevisorStandConfig) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const methodDefs = methods.length ? methods : DEFAULT_REVISOR_METHODS;
  const [form, setForm] = useState<RevisorStandConfig>(() => emptyRevisorStand(methodDefs));
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [saved, setSaved] = useState(false);

  function resetForm() {
    setForm(emptyRevisorStand(methodDefs));
    setErrMsg("");
    setSaved(false);
  }

  function editStand(stand: RevisorStandConfig) {
    const next = emptyRevisorStand(methodDefs);
    setForm({
      ...next,
      ...stand,
      token: stand.token ?? "",
      api_key_header: stand.api_key_header ?? "Authorization",
      namespace: stand.namespace ?? "",
      enabled: stand.enabled ?? true,
      methods: {
        ...next.methods,
        ...(stand.methods ?? {}),
      },
    });
    setErrMsg("");
    setSaved(false);
  }

  function setField<K extends keyof RevisorStandConfig>(key: K, value: RevisorStandConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setMethod(key: string, patch: Partial<{ enabled: boolean; path: string; label: string }>) {
    setForm((prev) => ({
      ...prev,
      methods: {
        ...prev.methods,
        [key]: {
          enabled: prev.methods[key]?.enabled ?? false,
          path: prev.methods[key]?.path ?? "",
          label: prev.methods[key]?.label ?? methodDefs.find((m) => m.key === key)?.label ?? key,
          ...patch,
        },
      },
    }));
  }

  const enabledMethods = Object.values(form.methods).filter((m) => m.enabled && m.path.trim()).length;
  const canSave = form.name.trim() && form.base_url.trim() && enabledMethods > 0;

  async function handleSave() {
    setSaving(true);
    setErrMsg("");
    setSaved(false);
    try {
      await onSave(form);
      resetForm();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-border-main rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-main">Ревизор — API стенды</h2>
        <p className="text-xs text-text-muted mt-1">
          Соберите сравнительный интерфейс из методов: сборки, версии, статусы, поды и health.
        </p>
      </div>

      {stands.length > 0 && (
        <div className="border border-border-main rounded-lg divide-y divide-border-main overflow-hidden">
          {stands.map((s) => {
            const activeMethods = Object.entries(s.methods ?? {})
              .filter(([, cfg]) => cfg.enabled)
              .map(([key, cfg]) => cfg.label || methodDefs.find((m) => m.key === key)?.label || key);
            return (
              <div key={s.id ?? s.name} className="flex items-center gap-3 px-3 py-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-main truncate">{s.name}</p>
                  <p className="text-xs text-text-muted truncate">
                    {activeMethods.join(", ") || "методы не выбраны"} · {s.base_url}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => editStand(s)}
                  className="px-2 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-subtle"
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => s.id && onDelete(s.id)}
                  className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50"
                  title="Удалить"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <label className={LABEL_CLS}>Имя стенда</label>
          <input
            className={INPUT_CLS}
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="Например: НТ"
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Namespace / контур</label>
          <input
            className={INPUT_CLS}
            value={form.namespace ?? ""}
            onChange={(e) => setField("namespace", e.target.value)}
            placeholder="production"
            spellCheck={false}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL_CLS}>Base URL API стенда</label>
          <input
            className={INPUT_CLS}
            value={form.base_url}
            onChange={(e) => setField("base_url", e.target.value)}
            placeholder="https://stand.example.ru"
            spellCheck={false}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Авторизация</label>
          <select
            className={SELECT_CLS}
            value={form.auth_type}
            onChange={(e) => setField("auth_type", e.target.value as RevisorStandConfig["auth_type"])}
          >
            <option value="none">Без токена</option>
            <option value="bearer">Bearer token</option>
            <option value="api_key">API key header</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Включён</label>
          <select
            className={SELECT_CLS}
            value={form.enabled ? "1" : "0"}
            onChange={(e) => setField("enabled", e.target.value === "1")}
          >
            <option value="1">Да</option>
            <option value="0">Нет</option>
          </select>
        </div>
        {form.auth_type === "api_key" && (
          <div>
            <label className={LABEL_CLS}>Header для API key</label>
            <input
              className={INPUT_CLS}
              value={form.api_key_header ?? "Authorization"}
              onChange={(e) => setField("api_key_header", e.target.value)}
              placeholder="X-API-Key"
              spellCheck={false}
            />
          </div>
        )}
        {form.auth_type !== "none" && (
          <div>
            <label className={LABEL_CLS}>Token <span className="text-[10px] text-text-muted">(секрет)</span></label>
            <PasswordInput
              fieldKey="token"
              value={form.token ?? ""}
              onChange={(_, val) => setField("token", val)}
              placeholder={form.auth_type === "bearer" ? "Bearer token" : "API key value"}
            />
          </div>
        )}
      </div>

      <div className="border border-border-main rounded-lg overflow-hidden">
        <div className="grid grid-cols-[96px,64px,minmax(120px,1fr)] bg-gray-50/80 border-b border-border-main">
          <div className="px-3 py-2 text-xs font-semibold text-text-muted">Метод</div>
          <div className="px-3 py-2 text-xs font-semibold text-text-muted border-l border-border-main">Вкл.</div>
          <div className="px-3 py-2 text-xs font-semibold text-text-muted border-l border-border-main">API path</div>
        </div>
        {methodDefs.map((method) => {
          const cfg = form.methods[method.key] ?? { enabled: false, path: "", label: method.label };
          return (
            <div key={method.key} className="grid grid-cols-[96px,64px,minmax(120px,1fr)] border-b border-border-main last:border-0">
              <div className="px-3 py-2 text-sm text-text-main">{method.label}</div>
              <div className="px-3 py-2 border-l border-border-main flex items-center">
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => setMethod(method.key, { enabled: e.target.checked })}
                  className="w-4 h-4 accent-primary"
                />
              </div>
              <div className="px-3 py-2 border-l border-border-main">
                <input
                  className={INPUT_CLS}
                  value={cfg.path}
                  onChange={(e) => setMethod(method.key, { path: e.target.value, enabled: cfg.enabled || !!e.target.value })}
                  placeholder={`/api/${method.key}`}
                  spellCheck={false}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-green-600 font-medium">Сохранено ✓</span>}
        {errMsg && <span className="text-xs text-red-500 font-medium truncate max-w-xs">{errMsg}</span>}
        {form.id && (
          <button
            type="button"
            onClick={resetForm}
            className="px-3 py-1.5 text-xs font-medium border border-border-main rounded-lg text-text-muted hover:bg-bg-subtle"
          >
            Новый стенд
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
            bg-primary text-white rounded-lg hover:bg-primary-dark
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-3 h-3" />
          {saving ? "Сохраняем..." : form.id ? "Обновить стенд" : "Добавить стенд"}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsSection() {
  const { bumpProviders } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = useState<CustomLlmProvider[]>([]);
  const [revisorMethods, setRevisorMethods] = useState<RevisorMethodDef[]>(DEFAULT_REVISOR_METHODS);
  const [revisorStands, setRevisorStands] = useState<RevisorStandConfig[]>([]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [map, custom] = await Promise.all([
        getSettings(),
        getCustomLlmProviders(),
      ]);
      const revisor = await getRevisorStands();
      const vals: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const [k, v] of Object.entries(map)) {
        vals[k]  = v.value;
        descs[k] = v.description;
      }
      setValues(vals);
      setDescriptions(descs);
      setCustomProviders(custom);
      setRevisorMethods(revisor.methods);
      setRevisorStands(revisor.stands);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSave(keys: string[], isLlm = false) {
    const payload: Record<string, string> = {};
    for (const k of keys) {
      payload[k] = values[k] ?? "";
    }
    await saveSettings(payload);
    // Reload to get fresh masked values from backend
    await loadSettings();
    // After saving LLM keys — refresh providers in sidebar and status bar
    if (isLlm) bumpProviders();
  }

  async function handleSaveCustomProvider(provider: CustomLlmProvider) {
    await saveCustomLlmProvider(provider);
    await loadSettings();
    bumpProviders();
  }

  async function handleDeleteCustomProvider(id: string) {
    await deleteCustomLlmProvider(id);
    await loadSettings();
    bumpProviders();
  }

  async function handleSaveRevisorStand(stand: RevisorStandConfig) {
    await saveRevisorStand(stand);
    await loadSettings();
  }

  async function handleDeleteRevisorStand(id: string) {
    await deleteRevisorStand(id);
    await loadSettings();
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center text-text-muted text-sm">
        Загрузка настроек...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          Ошибка загрузки: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold text-text-main">Настройки</h1>
      </div>

      {/* LLM */}
      <BuiltinLlmCard
        values={values}
        descriptions={descriptions}
        onChange={handleChange}
        onSave={(keys) => handleSave(keys, true)}
      />

      <CustomLlmCard
        providers={customProviders}
        onSave={handleSaveCustomProvider}
        onDelete={handleDeleteCustomProvider}
      />

      <RevisorApiCard
        methods={revisorMethods}
        stands={revisorStands}
        onSave={handleSaveRevisorStand}
        onDelete={handleDeleteRevisorStand}
      />

      {/* Kafka — Метрики */}
      <SettingsCard
        title="Kafka — Метрики"
        fields={METRICS_KAFKA_FIELDS}
        values={values}
        descriptions={descriptions}
        onChange={handleChange}
        onSave={handleSave}
      />

      {/* Kafka — Алерты */}
      <SettingsCard
        title="Kafka — Алерты"
        fields={ALERTS_KAFKA_FIELDS}
        values={values}
        descriptions={descriptions}
        onChange={handleChange}
        onSave={handleSave}
      />
    </div>
  );
}
