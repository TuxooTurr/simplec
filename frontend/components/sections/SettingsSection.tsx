"use client";

import { useEffect, useState, useCallback } from "react";
import { Eye, EyeOff, Save, Settings } from "lucide-react";
import { getSettings, saveSettings, type SettingsMap } from "@/lib/settingsApi";

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
  "openai_api_key",
  "anthropic_api_key",
  "alerts_kafka_sasl_password",
  "kafka_sasl_password",
]);

// ── Section definitions ───────────────────────────────────────────────────────

interface FieldDef {
  key:     string;
  label:   string;
  type?:   "text" | "password" | "select";
  options?: string[];
}

const LLM_FIELDS: FieldDef[] = [
  { key: "gigachat_auth_key", label: "GigaChat AUTH_KEY", type: "password" },
  {
    key: "gigachat_scope", label: "GigaChat Scope", type: "select",
    options: ["GIGACHAT_API_PERS", "GIGACHAT_API_CORP"],
  },
  { key: "deepseek_api_key",   label: "DeepSeek API Key",  type: "password" },
  { key: "deepseek_model",     label: "Модель DeepSeek" },
  { key: "openai_api_key",     label: "OpenAI API Key",    type: "password" },
  { key: "openai_model",       label: "Модель OpenAI" },
  { key: "anthropic_api_key",  label: "Anthropic API Key", type: "password" },
  { key: "anthropic_model",    label: "Модель Claude" },
  { key: "ollama_model",       label: "Модель Ollama" },
  { key: "lmstudio_url",       label: "LM Studio URL" },
  { key: "lmstudio_model",     label: "Модель LM Studio" },
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
  { key: "alerts_kafka_sasl_password", label: "SASL пароль",  type: "password" },
  { key: "alerts_kafka_ssl_cafile",    label: "SSL CA файл" },
];

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
  { key: "kafka_topic_data",        label: "Топик DATA" },
  { key: "kafka_topic_metadata",    label: "Топик METADATA" },
  { key: "kafka_topic_thresholds",  label: "Топик THRESHOLDS" },
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

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsSection() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const map = await getSettings();
      const vals: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const [k, v] of Object.entries(map)) {
        vals[k]  = v.value;
        descs[k] = v.description;
      }
      setValues(vals);
      setDescriptions(descs);
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

  async function handleSave(keys: string[]) {
    const payload: Record<string, string> = {};
    for (const k of keys) {
      payload[k] = values[k] ?? "";
    }
    await saveSettings(payload);
    // Reload to get fresh masked values from backend
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
      <SettingsCard
        title="LLM — API ключи и модели"
        fields={LLM_FIELDS}
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

      {/* Kafka — Метрики */}
      <SettingsCard
        title="Kafka — Метрики"
        fields={METRICS_KAFKA_FIELDS}
        values={values}
        descriptions={descriptions}
        onChange={handleChange}
        onSave={handleSave}
      />
    </div>
  );
}
