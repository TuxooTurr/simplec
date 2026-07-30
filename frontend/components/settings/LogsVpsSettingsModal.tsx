"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  ConnectionsModal, ConnectionRow, FilePathInput, INPUT_CLS, PasswordInput, Select,
} from "@/components/ui";
import {
  getLogsVpsConnections, saveLogsVpsConnection, deleteLogsVpsConnection, testLogsVpsConnection,
  type LogsVpsConnection,
} from "@/lib/settingsApi";

export const VPS_TYPE_OPTIONS = [
  { value: "graylog", label: "Graylog" },
  { value: "elastic", label: "Elasticsearch" },
  { value: "loki",    label: "Grafana Loki" },
  { value: "generic", label: "Другой (REST)" },
];

const VPS_AUTH_OPTIONS = [
  { value: "none",    label: "Без авторизации" },
  { value: "bearer",  label: "Bearer токен" },
  { value: "basic",   label: "Basic (логин/пароль)" },
  { value: "api_key", label: "API ключ" },
];

export function LogsVpsConnectionsModal({
  open, onClose, connections, onRefresh,
}: {
  open: boolean; onClose: () => void;
  connections: LogsVpsConnection[];
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<LogsVpsConnection>>({ vps_type: "graylog", auth_type: "none", ssl_verify: true, enabled: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => { setForm({ vps_type: "graylog", auth_type: "none", ssl_verify: true, enabled: true }); setMsg(null); };

  const save = async () => {
    if (!form.name?.trim() || !form.base_url?.trim()) { setMsg({ ok: false, text: "Укажите название и base URL" }); return; }
    setBusy(true); setMsg(null);
    try {
      await saveLogsVpsConnection(form as LogsVpsConnection & { name: string; base_url: string });
      await onRefresh(); reset();
      setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await testLogsVpsConnection(id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить подключение?")) return;
    setBusy(true);
    try { await deleteLogsVpsConnection(id); await onRefresh(); if (form.id === id) reset(); }
    finally { setBusy(false); }
  };

  const needsToken = form.auth_type === "bearer" || form.auth_type === "api_key";
  const needsBasic = form.auth_type === "basic";

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Логи — подключения к VPS" message={msg}
      listTitle={`Сохранённые (${connections.length})`}
      list={<>
        {connections.length === 0 && <p className="text-xs text-text-muted/60">Пока нет подключений.</p>}
        {connections.map((c) => (
          <ConnectionRow
            key={c.id}
            name={`${c.name}${c.enabled === false ? " (выкл.)" : ""}`}
            subtitle={`${VPS_TYPE_OPTIONS.find(o => o.value === c.vps_type)?.label ?? c.vps_type} · ${c.base_url}`}
            actions={[
              { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(c.id!), disabled: busy, hoverClass: "hover:text-emerald-600" },
              { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { setForm({ ...c }); setMsg(null); }, hoverClass: "hover:text-primary" },
              { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(c.id!), hoverClass: "hover:bg-red-50 hover:text-red-500" },
            ]}
          />
        ))}
      </>}
      formTitle={form.id ? "Изменить" : "Новое подключение"}
      form={<>
        <input className={INPUT_CLS} value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Название (напр. Graylog Production)" />
        <Select  value={form.vps_type || "graylog"} onChange={(value) => setForm(f => ({ ...f, vps_type: value as LogsVpsConnection["vps_type"] }))}>
          {VPS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <input className={`${INPUT_CLS} font-mono`} value={form.base_url || ""} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://graylog.company.ru/api" />
        <Select  value={form.auth_type || "none"} onChange={(value) => setForm(f => ({ ...f, auth_type: value as LogsVpsConnection["auth_type"] }))}>
          {VPS_AUTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        {needsToken && (
          <PasswordInput fieldKey="token" value={form.token || ""} onChange={(_, v) => setForm(f => ({ ...f, token: v }))} placeholder={form.auth_type === "bearer" ? "Bearer токен" : "API ключ"} />
        )}
        {needsBasic && <div className="grid grid-cols-2 gap-2">
          <input className={INPUT_CLS} value={form.username || ""} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="Логин" spellCheck={false} />
          <PasswordInput fieldKey="password" value={form.password || ""} onChange={(_, v) => setForm(f => ({ ...f, password: v }))} placeholder="Пароль" />
        </div>}
        <input className={INPUT_CLS} value={form.default_index || ""} onChange={e => setForm(f => ({ ...f, default_index: e.target.value }))} placeholder="Индекс / Стрим (опционально)" />
        <div className="flex items-center gap-3 pt-1">
          <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
            <input type="checkbox" checked={form.ssl_verify !== false} onChange={e => setForm(f => ({ ...f, ssl_verify: e.target.checked }))} className="rounded border-border-main text-primary focus:ring-primary/30" />
            SSL verify
          </label>
          <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
            <input type="checkbox" checked={form.enabled !== false} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="rounded border-border-main text-primary focus:ring-primary/30" />
            Активно
          </label>
        </div>
        {/* CA-сертификат: поле есть в модели подключения, но в форме его не было —
            задать корпоративный CA через интерфейс было нельзя. */}
        <FilePathInput
          label="CA-сертификат (для самоподписанных)"
          value={form.ca_cert_path || ""}
          onChange={(path) => setForm(f => ({ ...f, ca_cert_path: path }))}
          purpose={`vps_ca_${form.id || "new"}`}
          placeholder="Путь к CA bundle — или выберите файл"
          accept=".pem,.crt,.cer,.txt"
          hint="Нужен, когда SSL verify включён, а сертификат платформы подписан своим центром."
        />
        <div className="flex justify-end gap-2 pt-1">
          {form.id && <button type="button" onClick={reset} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
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

/** Готовая к встраиванию версия: сама грузит список подключений. */
export default function LogsVpsSettingsModal({ open, onClose, onChanged }: {
  open: boolean; onClose: () => void;
  onChanged?: () => void;
}) {
  const [connections, setConnections] = useState<LogsVpsConnection[]>([]);

  // Колбэк держим в ref: вызывающий часто передаёт inline-стрелку, и зависимость
  // от неё заставляла refresh меняться каждый рендер — загрузка зацикливалась.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const refresh = useCallback(async () => {
    const r = await getLogsVpsConnections();
    setConnections(r.connections || []);
    onChangedRef.current?.();
  }, []);

  useEffect(() => { if (open) refresh().catch(() => {}); }, [open, refresh]);

  return (
    <LogsVpsConnectionsModal
      open={open} onClose={onClose} connections={connections} onRefresh={refresh}
    />
  );
}
