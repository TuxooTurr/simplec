"use client";
import { useSyncExternalStore } from "react";

const KEY = "st_issue_type_display";
let memory = false;
function read() {
  try { return localStorage.getItem(KEY) === "icon"; } catch { return memory; }
}
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === KEY) callback(); };
  window.addEventListener(KEY, callback); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(KEY, callback); window.removeEventListener("storage", storage); };
}
export function useIssueTypeDisplay() {
  const iconOnly = useSyncExternalStore(subscribe, read, () => false);
  return [iconOnly, () => {
    memory = !read();
    try { localStorage.setItem(KEY, memory ? "icon" : "label"); } catch { /* Keep the setting for this session. */ }
    window.dispatchEvent(new Event(KEY));
  }] as const;
}
