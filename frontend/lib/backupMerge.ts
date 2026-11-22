/** Add missing JSON values; existing scalars win, collections match records by id/key/name. */
export function backupItemKey(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of ["id", "key", "name"]) {
    const field = (value as Record<string, unknown>)[key];
    if ((typeof field === "string" || typeof field === "number") && field !== "") return `${key}:${field}`;
  }
  return null;
}
export function mergeBackupValues(current: unknown, incoming: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(incoming)) {
    const out = [...current];
    const positions = new Map(current.flatMap((value, index) => { const key = backupItemKey(value); return key === null ? [] : [[key, index] as const]; }));
    const signature = (value: unknown) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    const seen = new Set(current.map(signature));
    for (const value of incoming) {
      const key = backupItemKey(value), at = key === null ? undefined : positions.get(key);
      if (at !== undefined) out[at] = mergeBackupValues(out[at], value);
      else if (!seen.has(signature(value))) {
        if (key !== null) positions.set(key, out.length);
        out.push(value); seen.add(signature(value));
      }
    }
    return out;
  }
  if (current && incoming && typeof current === "object" && typeof incoming === "object" && !Array.isArray(current) && !Array.isArray(incoming)) {
    const out: Record<string, unknown> = Object.assign(Object.create(null), current);
    for (const [key, value] of Object.entries(incoming)) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = value;
      else if (key === "nextKey" && typeof out[key] === "number" && typeof value === "number") out[key] = Math.max(out[key], value);
      else out[key] = mergeBackupValues(out[key], value);
    }
    return out;
  }
  return current;
}
