"use client";

import { FilePathInput, INPUT_CLS, PasswordInput, Select } from "@/components/ui";

const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

/** Ключи, которые бэкенд отдаёт замаскированными — подписываем их как секреты. */
export const SECRET_KEYS = new Set([
  "gigachat_auth_key",
  "kafka_sasl_password", "kafka_ssl_password",
]);

export interface FieldDef {
  key: string; label: string;
  /** file — путь к файлу с кнопкой загрузки, как у сертификатов GigaChat. */
  type?: "text" | "password" | "select" | "file";
  options?: string[];
  /** Для type: "file" — что принимать в диалоге выбора. */
  accept?: string;
}

/** Один ряд настроек: вид поля выбирается по type, секреты всегда под маской. */
export function renderField(
  f: FieldDef,
  values: Record<string, string>,
  descriptions: Record<string, string>,
  onChange: (k: string, v: string) => void,
) {
  const val = values[f.key] ?? "";
  const isSecret = SECRET_KEYS.has(f.key);
  const desc = descriptions[f.key] ?? "";
  return (
    <div key={f.key}>
      <label className={LABEL_CLS}>
        {f.label}
        {isSecret && <span className="ml-1 text-[10px] text-text-muted/60 font-normal">(секрет)</span>}
      </label>
      {f.type === "file" ? (
        <FilePathInput
          value={val}
          onChange={(path) => onChange(f.key, path)}
          purpose={f.key}
          placeholder={desc || "Путь к файлу на сервере"}
          accept={f.accept}
        />
      ) : isSecret || f.type === "password" ? (
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

/** Kafka, из которой раздел «Метрики ОД» читает данные, метаданные и пороги. */
export const METRICS_KAFKA_FIELDS: FieldDef[] = [
  { key: "kafka_bootstrap_servers", label: "Bootstrap servers" },
  { key: "kafka_security_protocol", label: "Security protocol", type: "select", options: ["PLAINTEXT", "SASL_PLAINTEXT", "SASL_SSL", "SSL"] },
  { key: "kafka_sasl_mechanism", label: "SASL механизм", type: "select", options: ["", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "GSSAPI"] },
  { key: "kafka_sasl_username", label: "SASL логин" },
  { key: "kafka_sasl_password", label: "SASL пароль", type: "password" },
  { key: "kafka_ssl_cafile", label: "SSL CA файл", type: "file", accept: ".pem,.crt,.cer,.txt" },
  { key: "kafka_ssl_certfile", label: "SSL client cert", type: "file", accept: ".pem,.crt,.cer,.txt" },
  { key: "kafka_ssl_keyfile", label: "SSL client key", type: "file", accept: ".pem,.key,.txt" },
  { key: "kafka_ssl_password", label: "SSL key password", type: "password" },
  { key: "kafka_topic_data", label: "Топик DATA" },
  { key: "kafka_topic_metadata", label: "Топик METADATA" },
  { key: "kafka_topic_thresholds", label: "Топик THRESHOLDS" },
];
