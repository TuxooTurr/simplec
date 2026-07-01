import { authHeaders } from "./authApi";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(authHeaders())) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const p = JSON.parse(text) as { detail?: string };
      message = p.detail ?? text;
    } catch { /* keep text */ }
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json() as Promise<T>;
}

export interface KafkaConnection {
  id: string;
  name: string;
  bootstrap_servers: string;
  security_protocol: "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";
  sasl_mechanism?: string;
  sasl_username?: string;
  sasl_password?: string;
  ssl_cafile?: string;
  ssl_certfile?: string;
  ssl_keyfile?: string;
  default_limit?: number;
  created_at?: string;
  updated_at?: string;
}

export interface KafkaMessage {
  offset: number;
  partition: number;
  timestamp: number;      // ms epoch
  key: string | null;
  value: string;
  headers: [string, string | null][];
}

export interface KafkaMessagesResult {
  topic: string;
  limit: number;
  scanned: number;
  matched: number;
  messages: KafkaMessage[];
}

export function listKafkaConnections(): Promise<KafkaConnection[]> {
  return fetchJson("/api/kafka/connections");
}

export function createKafkaConnection(body: Partial<KafkaConnection>): Promise<KafkaConnection> {
  return fetchJson("/api/kafka/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateKafkaConnection(id: string, body: Partial<KafkaConnection>): Promise<KafkaConnection> {
  return fetchJson(`/api/kafka/connections/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteKafkaConnection(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/kafka/connections/${id}`, { method: "DELETE" });
}

export function testKafkaConnection(id: string): Promise<{ status: string; topics_count: number }> {
  return fetchJson(`/api/kafka/connections/${id}/test`, { method: "POST" });
}

export function getKafkaTopics(connectionId: string): Promise<{ topics: string[] }> {
  return fetchJson(`/api/kafka/topics?connection_id=${encodeURIComponent(connectionId)}`);
}

export function fetchKafkaMessages(params: {
  connection_id: string;
  topic: string;
  limit?: number;
  filter?: string;
}): Promise<KafkaMessagesResult> {
  return fetchJson("/api/kafka/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connection_id: params.connection_id,
      topic: params.topic,
      limit: params.limit ?? 50,
      filter: params.filter ?? "",
    }),
  });
}
