/**
 * API-клиент для фермы устройств (Device Farm).
 * Управление мобильными устройствами: захват, освобождение, скриншоты, сессии.
 */

import { authHeaders } from "./authApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const ah = authHeaders();
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(ah)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type DevicePlatform = "ANDROID" | "IOS";
export type DeviceStatus = "AVAILABLE" | "BUSY" | "OFFLINE" | "MAINTENANCE";

export interface FarmDevice {
  udid: string;
  platform: DevicePlatform;
  model: string;
  osVersion: string;
  status: DeviceStatus;
  battery: number | null;
  lastSeen: string | null;
  lockedBy?: string | null;
  agentHost?: string;
  appiumPort?: number;
}

export interface FarmSession {
  id: string;
  deviceUdid: string;
  userId: string;
  username?: string;
  type: "MANUAL" | "AUTOMATION";
  startedAt: string;
  endedAt: string | null;
  timeoutMin: number;
  status: string;
}

// ── API functions ──────────────────────────────────────────────────────────────

export async function getFarmDevices(platform?: string, status?: string): Promise<FarmDevice[]> {
  const qs = new URLSearchParams();
  if (platform) qs.set("platform", platform);
  if (status) qs.set("status", status);
  const query = qs.toString();
  return fetchJson(`/api/farm/devices${query ? `?${query}` : ""}`);
}

export async function lockFarmDevice(udid: string): Promise<{ sessionId: string; udid: string }> {
  return fetchJson(`/api/farm/devices/${encodeURIComponent(udid)}/lock`, { method: "POST" });
}

export async function unlockFarmDevice(udid: string): Promise<{ udid: string }> {
  return fetchJson(`/api/farm/devices/${encodeURIComponent(udid)}/unlock`, { method: "POST" });
}

export async function getFarmScreenshot(udid: string): Promise<string> {
  const ah = authHeaders();
  const headers = new Headers();
  for (const [k, v] of Object.entries(ah)) headers.set(k, v);

  const res = await fetch(`${API_BASE}/api/farm/devices/${encodeURIComponent(udid)}/screenshot`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function getFarmSessions(): Promise<FarmSession[]> {
  return fetchJson("/api/farm/sessions");
}

export async function getActiveFarmSessions(): Promise<FarmSession[]> {
  return fetchJson("/api/farm/sessions?active=true");
}

export async function forceReleaseFarmSession(id: string): Promise<void> {
  await fetchJson(`/api/farm/sessions/${encodeURIComponent(id)}/release`, { method: "POST" });
}

export async function getFarmStatus(): Promise<{ devices: { total: number; available: number; busy: number; offline: number } }> {
  return fetchJson("/api/farm/status");
}
