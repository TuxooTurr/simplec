import { fetchJson } from "./api";

const PATH = "/api/settings/pixso";
export const getPixso = () => fetchJson<{ configured: boolean }>(PATH);
export const savePixso = (token: string) => fetchJson<{ configured: boolean }>(PATH, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
});
export const sourceLinks = (text: string) => [...new Set(text.match(/https:\/\/[^\s<>\])]+/g) ?? [])];
