import { fetchJson } from "./jiraApi";
export interface EtherState {
  state: "idle" | "waiting" | "connected" | "error" | "timeout";
  error: string;
  source: "cookie" | "env" | "broken" | "none";
  source_text: string;
}
export interface EtherMessage {
  id: string;
  author: string;
  text: string;
  date: string;
  dialog: string;
  title?: string;
  endDate?: string;
  location?: string;
  /** Чат: собеседник/диалог — по нему открывается переписка. */
  peer?: unknown;
  /** Почта: id письма в Эфире — по нему открывается письмо целиком. */
  sourceId?: string;
}
export type EtherChannel = "chat" | "mail" | "meetings";
export interface EtherFeed {
  configured: boolean;
  available: boolean;
  messages: EtherMessage[];
  reason?: string;
  demo?: boolean;
}
export const fetchEtherState = () => fetchJson<EtherState>("/api/ether/state");
export const connectEther = () =>
  fetchJson<EtherState>("/api/ether/connect", { method: "POST" });
export const disconnectEther = () =>
  fetchJson<EtherState>("/api/ether/connect", { method: "DELETE" });
export const etherFeed = (users: string[], keywords: string[] = [], channel: EtherChannel = "chat", signal?: AbortSignal) =>
  fetchJson<EtherFeed>(
    "/api/dashboard/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ users, keywords, channel }),
      signal,
    },
  );

const post = <T>(path: string, body: unknown) =>
  fetchJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Кого можно отслеживать: человек, личный чат или группа. */
export interface EtherParticipant { kind: "person" | "chat" | "group"; name: string; login?: string; email?: string; subtitle?: string }
export interface EtherSearchResult { items: EtherParticipant[]; people: boolean; reason?: string }
export const etherSearch = (q: string) => post<EtherSearchResult>("/api/dashboard/ether/search", { q });

export interface EtherThreadMessage { id: string; author: string; text: string; date: string; mine: boolean }
export interface EtherThread { messages: EtherThreadMessage[]; canSend: boolean; reason?: string }
export const etherThread = (peer: unknown) => post<EtherThread>("/api/dashboard/ether/thread", { peer });
export const etherSend = (peer: unknown, text: string) => post<{ sent: boolean }>("/api/dashboard/ether/send", { peer, text });

export interface EtherMail { available: boolean; reason?: string; canReply?: boolean; replyReason?: string; subject?: string; from?: string; to?: string; date?: string; text?: string }
export const etherMail = (id: string) => post<EtherMail>("/api/dashboard/ether/mail/message", { id });
export const etherMailReply = (id: string, text: string) => post<{ sent: boolean }>("/api/dashboard/ether/mail/reply", { id, text });
