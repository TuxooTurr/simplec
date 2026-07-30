"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { ConnectionsModal, ConnectionRow, INPUT_CLS, PasswordInput, Select } from "@/components/ui";
import {
  getRevisorStands, saveRevisorStand, deleteRevisorStand, testRevisorStand,
  type RevisorStandConfig, type RevisorMethodDef,
} from "@/lib/settingsApi";

export const DEFAULT_REVISOR_METHODS: RevisorMethodDef[] = [
  { key: "build", label: "Сборка" }, { key: "version", label: "Версия" },
  { key: "status", label: "Статус" }, { key: "pods", label: "Поды" }, { key: "health", label: "Health" },
];

function emptyRevisorStand(methods: RevisorMethodDef[]): RevisorStandConfig {
  const m: RevisorStandConfig["methods"] = {};
  for (const method of methods) m[method.key] = { enabled: false, path: "", label: method.label };
  return { name: "", base_url: "", auth_type: "bearer", token: "", api_key_header: "Authorization", namespace: "", enabled: true, methods: m };
}

export function RevisorConnectionsModal({ open, onClose, methods, stands, onSave, onDelete }: {
  open: boolean; onClose: () => void;
  methods: RevisorMethodDef[]; stands: RevisorStandConfig[];
  onSave: (s: RevisorStandConfig) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const defs = methods.length ? methods : DEFAULT_REVISOR_METHODS;
  const [form, setForm] = useState<RevisorStandConfig>(() => emptyRevisorStand(defs));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function resetForm() { setForm(emptyRevisorStand(defs)); setMsg(null); }

  function setField<K extends keyof RevisorStandConfig>(key: K, value: RevisorStandConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function setMethod(key: string, patch: Partial<{ enabled: boolean; path: string; label: string }>) {
    setForm(prev => ({
      ...prev,
      methods: { ...prev.methods, [key]: {
        enabled: prev.methods[key]?.enabled ?? false,
        path: prev.methods[key]?.path ?? "",
        label: prev.methods[key]?.label ?? defs.find(m => m.key === key)?.label ?? key,
        ...patch,
      }},
    }));
  }

  const enabledMethods = Object.values(form.methods).filter(m => m.enabled && m.path.trim()).length;

  const save = async () => {
    if (!form.name.trim() || !form.base_url.trim() || enabledMethods === 0) { setMsg({ ok: false, text: "Укажите имя, base URL и хотя бы один метод" }); return; }
    setBusy(true); setMsg(null);
    try { await onSave(form); resetForm(); setMsg({ ok: true, text: "Сохранено" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await testRevisorStand(id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить стенд?")) return;
    setBusy(true);
    try { await onDelete(id); if (form.id === id) resetForm(); }
    finally { setBusy(false); }
  };

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Ревизор — подключения к стендам" message={msg}
      listTitle={`Сохранённые (${stands.length})`}
      list={<>
        {stands.length === 0 && <p className="text-xs text-text-muted/60">Пока нет стендов.</p>}
        {stands.map((s) => {
          const active = Object.entries(s.methods ?? {}).filter(([, c]) => c.enabled).map(([k, c]) => c.label || defs.find(m => m.key === k)?.label || k);
          return (
            <ConnectionRow
              key={s.id ?? s.name}
              name={s.name}
              subtitle={`${active.join(", ") || "методы не выбраны"} · ${s.base_url}`}
              actions={[
                { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(s.id ?? ""), disabled: busy, hoverClass: "hover:text-emerald-600" },
                { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { const next = emptyRevisorStand(defs); setForm({ ...next, ...s, token: s.token ?? "", methods: { ...next.methods, ...(s.methods ?? {}) } }); setMsg(null); }, hoverClass: "hover:text-primary" },
                { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(s.id ?? ""), hoverClass: "hover:bg-red-50 hover:text-red-500" },
              ]}
            />
          );
        })}
      </>}
      formTitle={form.id ? "Изменить" : "Новый стенд"}
      form={<>
        <input className={INPUT_CLS} value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Имя стенда (напр. НТ)" />
        <input className={INPUT_CLS} value={form.namespace ?? ""} onChange={(e) => setField("namespace", e.target.value)} placeholder="Namespace (опц.)" spellCheck={false} />
        <input className={INPUT_CLS} value={form.base_url} onChange={(e) => setField("base_url", e.target.value)} placeholder="Base URL — https://stand.example.ru" spellCheck={false} />
        <Select  value={form.auth_type} onChange={(value) => setField("auth_type", value as RevisorStandConfig["auth_type"])}>
          <option value="none">Без токена</option><option value="bearer">Bearer token</option><option value="api_key">API key header</option>
        </Select>
        {form.auth_type !== "none" && (
          <PasswordInput fieldKey="token" value={form.token ?? ""} onChange={(_, v) => setField("token", v)} placeholder="Token" />
        )}

        <div className="rounded-lg border border-border-main overflow-hidden">
          <div className="grid grid-cols-[1fr,52px,minmax(90px,1fr)] bg-bg-subtle/80 border-b border-border-main">
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted">Метод</div>
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted border-l border-border-main">Вкл.</div>
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-text-muted border-l border-border-main">API path</div>
          </div>
          {defs.map((method) => {
            const cfg = form.methods[method.key] ?? { enabled: false, path: "", label: method.label };
            return (
              <div key={method.key} className="grid grid-cols-[1fr,52px,minmax(90px,1fr)] border-b border-border-main last:border-0">
                <div className="px-2.5 py-1.5 text-xs text-text-main truncate">{method.label}</div>
                <div className="px-2.5 py-1.5 border-l border-border-main flex items-center justify-center">
                  <input type="checkbox" checked={cfg.enabled} onChange={(e) => setMethod(method.key, { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-primary" />
                </div>
                <div className="px-1.5 py-1 border-l border-border-main">
                  <input className={`${INPUT_CLS} text-xs px-1.5 py-1`} value={cfg.path} onChange={(e) => setMethod(method.key, { path: e.target.value, enabled: cfg.enabled || !!e.target.value })} placeholder={`/api/${method.key}`} spellCheck={false} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          {form.id && <button type="button" onClick={resetForm} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
          <button type="button" onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </>}
    />
  );
}

/** Готовая к встраиванию версия: сама грузит стенды и список методов. */
export default function RevisorSettingsModal({ open, onClose, onChanged }: {
  open: boolean; onClose: () => void;
  onChanged?: () => void;
}) {
  const [stands, setStands] = useState<RevisorStandConfig[]>([]);
  const [methods, setMethods] = useState<RevisorMethodDef[]>(DEFAULT_REVISOR_METHODS);

  // Колбэк держим в ref: вызывающий часто передаёт inline-стрелку, и зависимость
  // от неё заставляла refresh меняться каждый рендер — загрузка зацикливалась.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const refresh = useCallback(async () => {
    const r = await getRevisorStands();
    setStands(r.stands ?? []);
    if (r.methods?.length) setMethods(r.methods);
    onChangedRef.current?.();
  }, []);

  useEffect(() => { if (open) refresh().catch(() => {}); }, [open, refresh]);

  return (
    <RevisorConnectionsModal
      open={open} onClose={onClose} methods={methods} stands={stands}
      onSave={async (s) => { await saveRevisorStand(s); await refresh(); }}
      onDelete={async (id) => { await deleteRevisorStand(id); await refresh(); }}
    />
  );
}
