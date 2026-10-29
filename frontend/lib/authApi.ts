const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const TOKEN_KEY = "st_auth_token";

export interface AuthUser {
  login: string;
  role: "superuser" | "monitoring";
  display_name: string;
  /** jira — вошёл логином Jira; local — универсальная учётная запись. */
  source?: "jira" | "local";
}

/** Что стало с маркером системы при входе по логину Jira: свой рабочий остался, выпущен новый или не вышло. */
export interface LoginToken { state: "reused" | "new" | "error"; text?: string }
export type LoginTokens = Partial<Record<"jira" | "confluence", LoginToken>>;

const NAMES = { jira: "Jira", confluence: "Confluence" } as const;
const NOTE_KEY = "st_login_note";

/** Сообщение после входа о маркерах: новые получены — сказать; не вышло — сказать почему; свои рабочие — молчать. */
export function loginTokensNote(tokens?: LoginTokens): { ok: boolean; text: string } | null {
  if (!tokens) return null;
  const all = Object.entries(tokens) as [keyof typeof NAMES, LoginToken][];
  const fresh = all.filter(([, t]) => t.state === "new").map(([k]) => NAMES[k]);
  const bad = all.filter(([, t]) => t.state === "error");
  if (!fresh.length && !bad.length) return null;
  const parts = [
    fresh.length ? `Токены получены: ${fresh.join(", ")} (действуют 180 дней)` : "",
    ...bad.map(([k, t]) => `${NAMES[k]}: токен не получен — ${t.text ?? "причина неизвестна"}. Получить можно в настройках ${NAMES[k]}`),
  ].filter(Boolean);
  return { ok: !bad.length, text: parts.join(". ") };
}

/** Сообщение переживает переход со страницы входа в приложение — до первого показа. */
export function stashLoginNote(note: { ok: boolean; text: string } | null): void {
  try { if (note) sessionStorage.setItem(NOTE_KEY, JSON.stringify(note)); else sessionStorage.removeItem(NOTE_KEY); } catch { /* без сообщения */ }
}

export function takeLoginNote(): { ok: boolean; text: string } | null {
  try {
    const raw = sessionStorage.getItem(NOTE_KEY);
    sessionStorage.removeItem(NOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loginApi(login: string, password: string): Promise<AuthUser & { token: string; tokens?: LoginTokens }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).detail ?? text;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

export async function logoutApi(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {}
  clearStoredToken();
}

export async function getMeApi(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Не авторизован");
  return res.json();
}
