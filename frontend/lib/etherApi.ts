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
