"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Network, Search, X, Plus, Pencil, Trash2, Loader2, Check, RefreshCw, Copy, CheckCheck, Settings2,
} from "lucide-react";
import { Modal } from "@/components/ui";
import {
  listKafkaConnections, createKafkaConnection, updateKafkaConnection, deleteKafkaConnection,
  testKafkaConnection, getKafkaTopics, fetchKafkaMessages,
  type KafkaConnection, type KafkaMessage,
} from "@/lib/kafkaApi";

const PROTOCOLS = ["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"] as const;
const INPUT = "w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] px-3 py-2 text-sm text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

function fmtTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    " " + d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function prettyJson(value: string): { text: string; isJson: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(value), null, 2), isJson: true };
  } catch {
    return { text: value, isJson: false };
  }
}

/* ── One topic column (field 1 / field 2) ────────────────────────── */
function TopicColumn({
  label, topics, topic, onTopic, messages, loading, selectedId, onSelect,
}: {
  label: string;
  topics: string[];
  topic: string;
  onTopic: (t: string) => void;
  messages: KafkaMessage[];
  loading: boolean;
  selectedId: string;
  onSelect: (m: KafkaMessage) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border-main bg-bg-card">
      <div className="flex items-center gap-2 border-b border-border-main p-2">
        <span className="shrink-0 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">{label}</span>
        <select
          value={topic}
          onChange={(e) => onTopic(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">— выберите топик —</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {!topic ? (
          <p className="p-4 text-center text-xs text-text-muted">Выберите топик в списке выше.</p>
        ) : messages.length === 0 && !loading ? (
          <p className="p-4 text-center text-xs text-text-muted">Нет сообщений (по текущему фильтру).</p>
        ) : (
          messages.map((m) => {
            // Offset/partition — Kafka присваивает их ПО ТОПИКУ, поэтому разные топики
            // легко имеют одинаковую пару partition:offset. Топик обязателен в id,
            // иначе подсветка выбора «протекает» в другую колонку.
            const id = `${topic}::${m.partition}-${m.offset}`;
            const on = selectedId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(m)}
                className={`relative flex w-full flex-col gap-0.5 border-b border-border-main/60 py-1.5 pl-3 pr-2.5 text-left transition-colors ${
                  on ? "bg-[var(--color-active-bg)]" : "hover:bg-bg-subtle/60"
                }`}
              >
                {on && <span className="absolute inset-y-0 left-0 w-1 bg-primary" />}
                <div className={`flex items-center gap-2 text-[10px] ${on ? "text-primary/80" : "text-text-muted"}`}>
                  <span className="tabular-nums">{fmtTime(m.timestamp)}</span>
                  <span className={`rounded px-1 ${on ? "bg-primary/15 text-primary" : "bg-bg-muted"}`}>p{m.partition}·{m.offset}</span>
                  {m.key && <span className={`truncate font-mono ${on ? "text-primary/70" : "text-text-muted/80"}`}>key:{m.key}</span>}
                </div>
                <span className={`truncate font-mono text-xs ${on ? "font-semibold text-primary" : "text-text-muted"}`}>
                  {m.value.slice(0, 90) || "—"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────── */
export default function KafkaSection() {
  const [connections, setConnections] = useState<KafkaConnection[]>([]);
  const [connId, setConnId] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicsErr, setTopicsErr] = useState("");
  const [topicsLoading, setTopicsLoading] = useState(false);

  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const debounced = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [effSearch, setEffSearch] = useState("");

  const [t1, setT1] = useState(""); const [m1, setM1] = useState<KafkaMessage[]>([]); const [l1, setL1] = useState(false);
  const [t2, setT2] = useState(""); const [m2, setM2] = useState<KafkaMessage[]>([]); const [l2, setL2] = useState(false);

  const [selected, setSelected] = useState<(KafkaMessage & { topic: string }) | null>(null);
  const [detailView, setDetailView] = useState<"json" | "raw">("json");
  const [copied, setCopied] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);

  const reloadConnections = useCallback(async () => {
    try {
      const list = await listKafkaConnections();
      setConnections(list);
      setConnId((prev) => prev || (list[0]?.id ?? ""));
    } catch { /* show empty */ }
  }, []);

  useEffect(() => { reloadConnections(); }, [reloadConnections]);

  // load topics when connection changes
  useEffect(() => {
    if (!connId) { setTopics([]); return; }
    let alive = true;
    setTopicsLoading(true); setTopicsErr("");
    getKafkaTopics(connId)
      .then((r) => { if (alive) setTopics(r.topics ?? []); })
      .catch((e) => { if (alive) { setTopics([]); setTopicsErr(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (alive) setTopicsLoading(false); });
    return () => { alive = false; };
  }, [connId]);

  // debounce search (min 3 chars → auto-fire)
  useEffect(() => {
    if (debounced.current) clearTimeout(debounced.current);
    debounced.current = setTimeout(() => {
      const q = search.trim();
      setEffSearch(q.length >= 3 ? q : "");
    }, 450);
    return () => { if (debounced.current) clearTimeout(debounced.current); };
  }, [search]);

  const loadColumn = useCallback((topic: string, setM: (m: KafkaMessage[]) => void, setL: (b: boolean) => void) => {
    if (!connId || !topic) { setM([]); return; }
    setL(true);
    fetchKafkaMessages({ connection_id: connId, topic, limit, filter: effSearch })
      .then((r) => setM(r.messages))
      .catch(() => setM([]))
      .finally(() => setL(false));
  }, [connId, limit, effSearch]);

  useEffect(() => { loadColumn(t1, setM1, setL1); }, [t1, loadColumn]);
  useEffect(() => { loadColumn(t2, setM2, setL2); }, [t2, loadColumn]);

  const refresh = () => { loadColumn(t1, setM1, setL1); loadColumn(t2, setM2, setL2); };

  const selectedId = selected ? `${selected.topic}::${selected.partition}-${selected.offset}` : "";
  const body = useMemo(() => selected ? prettyJson(selected.value) : null, [selected]);

  const copyValue = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.value);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-text-main">Просмотр Kafka</h1>
        </div>
        <select
          value={connId}
          onChange={(e) => { setConnId(e.target.value); setT1(""); setT2(""); setSelected(null); }}
          className="rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">— подключение —</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" onClick={() => setManageOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
          <Settings2 className="h-3.5 w-3.5" /> Подключения
        </button>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-text-muted">
            последние
            <input type="number" min={1} max={1000} value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 50)))}
              className="w-16 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
            сообщений
          </label>
          <button type="button" onClick={refresh} title="Обновить"
            className="rounded-lg border border-border-main p-1.5 text-text-muted hover:bg-bg-subtle">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по содержимому (contextId, любой текст)…"
          className={`${INPUT} pl-9 pr-24`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted/70">
          {search.trim().length > 0 && search.trim().length < 3 ? "от 3 символов" : "авто-поиск"}
        </span>
      </div>

      {!connId ? (
        <div className="rounded-xl border border-dashed border-border-main bg-bg-card px-4 py-10 text-center text-sm text-text-muted">
          Добавьте Kafka-подключение (кнопка «Подключения») и выберите его — это сделает инструмент доступным и другим командам.
        </div>
      ) : topicsErr ? (
        <div className="tone-danger rounded-xl border px-4 py-4 text-sm">{topicsErr}</div>
      ) : (
        <>
          {/* Fields 1 & 2 — two topic lists */}
          <div className="flex min-h-0 flex-1 gap-3">
            <TopicColumn label="Топик 1" topics={topics} topic={t1} onTopic={setT1}
              messages={m1} loading={l1 || topicsLoading} selectedId={selectedId}
              onSelect={(m) => setSelected({ ...m, topic: t1 })} />
            <TopicColumn label="Топик 2" topics={topics} topic={t2} onTopic={setT2}
              messages={m2} loading={l2 || topicsLoading} selectedId={selectedId}
              onSelect={(m) => setSelected({ ...m, topic: t2 })} />
          </div>

          {/* Fields 3 & 4 — detail (appear on selection) */}
          <div className="mt-3 grid min-h-[180px] grid-cols-1 gap-3 md:grid-cols-2">
            {/* Field 3 — message body */}
            <div className="flex min-h-0 flex-col rounded-xl border border-border-main bg-bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-border-main p-2">
                <span className="text-xs font-semibold text-text-main">Сообщение</span>
                {selected && (
                  <div className="flex items-center gap-1">
                    {(["json", "raw"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setDetailView(v)}
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          detailView === v ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-bg-subtle"
                        }`}>
                        {v === "json" ? "JSON" : "Текст"}
                      </button>
                    ))}
                    <button type="button" onClick={copyValue} title="Копировать"
                      className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-main">
                      {copied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-3">
                {!selected ? (
                  <p className="text-center text-xs text-text-muted">Выберите сообщение в любом топике.</p>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-text-main">
                    {detailView === "json" ? body?.text : selected.value}
                  </pre>
                )}
              </div>
            </div>

            {/* Field 4 — metadata / recipients */}
            <div className="flex min-h-0 flex-col rounded-xl border border-border-main bg-bg-card">
              <div className="border-b border-border-main p-2">
                <span className="text-xs font-semibold text-text-main">Адресаты и метаданные</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-3 text-xs">
                {!selected ? (
                  <p className="text-center text-text-muted">Выберите сообщение — здесь появятся ключ, заголовки и адресаты.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-text-muted">
                      <span>Ключ:</span><span className="break-all font-mono text-text-main">{selected.key ?? "—"}</span>
                      <span>Партиция:</span><span className="font-mono text-text-main">{selected.partition}</span>
                      <span>Offset:</span><span className="font-mono text-text-main">{selected.offset}</span>
                      <span>Время:</span><span className="font-mono text-text-main">{fmtTime(selected.timestamp)}</span>
                    </div>
                    <div>
                      <p className="mb-1 font-semibold text-text-muted">Заголовки (адресаты от/кому):</p>
                      {selected.headers.length === 0 ? (
                        <p className="text-text-muted/60">нет заголовков</p>
                      ) : (
                        <div className="space-y-0.5">
                          {selected.headers.map(([k, v], i) => (
                            <div key={`${k}-${i}`} className="grid grid-cols-[minmax(0,140px),1fr] gap-x-3">
                              <span className="truncate font-mono text-primary">{k}</span>
                              <span className="break-all font-mono text-text-main">{v ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <p className="mt-2 text-center text-[11px] text-text-muted/70">
        Снапшот последних {limit} сообщений (не realtime). Kafka не индексирует содержимое — поиск идёт по этому окну.
      </p>

      <ConnectionsModal open={manageOpen} onClose={() => setManageOpen(false)}
        connections={connections} onChanged={reloadConnections} />
    </div>
  );
}

/* ── Connections manager modal ───────────────────────────────────── */
function emptyConn(): Partial<KafkaConnection> {
  return { name: "", bootstrap_servers: "", security_protocol: "PLAINTEXT", default_limit: 50 };
}

function ConnectionsModal({
  open, onClose, connections, onChanged,
}: {
  open: boolean; onClose: () => void; connections: KafkaConnection[]; onChanged: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<Partial<KafkaConnection>>(emptyConn());
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sasl = form.security_protocol === "SASL_PLAINTEXT" || form.security_protocol === "SASL_SSL";
  const ssl = form.security_protocol === "SSL" || form.security_protocol === "SASL_SSL";

  const reset = () => { setForm(emptyConn()); setEditingId(""); setMsg(null); };

  const save = async () => {
    if (!form.bootstrap_servers?.trim()) { setMsg({ ok: false, text: "Укажите bootstrap servers" }); return; }
    setBusy(true); setMsg(null);
    try {
      if (editingId) await updateKafkaConnection(editingId, form);
      else await createKafkaConnection(form);
      await onChanged(); reset();
      setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await testKafkaConnection(id);
      setMsg({ ok: true, text: `Подключение работает — топиков: ${r.topics_count}` });
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить подключение?")) return;
    setBusy(true);
    try { await deleteKafkaConnection(id); await onChanged(); if (editingId === id) reset(); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Kafka-подключения" size="max-w-2xl">
      {msg && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "tone-success" : "tone-danger"}`}>{msg.text}</div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* list */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-text-muted">Сохранённые ({connections.length})</p>
          {connections.length === 0 && <p className="text-xs text-text-muted/60">Пока нет подключений.</p>}
          {connections.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border-main px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-main">{c.name}</p>
                <p className="truncate font-mono text-[11px] text-text-muted">{c.bootstrap_servers} · {c.security_protocol}</p>
              </div>
              <button type="button" onClick={() => test(c.id)} disabled={busy} title="Проверить"
                className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-emerald-600"><Check className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => { setEditingId(c.id); setForm({ ...c, sasl_password: "" }); setMsg(null); }}
                title="Изменить" className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => remove(c.id)} title="Удалить"
                className="rounded p-1 text-text-muted hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>

        {/* form */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-text-muted">{editingId ? "Изменить" : "Новое подключение"}</p>
          <input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Имя (напр. ИФТ стенд)" className={INPUT} />
          <input value={form.bootstrap_servers ?? ""} onChange={(e) => setForm({ ...form, bootstrap_servers: e.target.value })}
            placeholder="host:9092 (можно несколько через запятую)" className={`${INPUT} font-mono`} />
          <select value={form.security_protocol ?? "PLAINTEXT"}
            onChange={(e) => setForm({ ...form, security_protocol: e.target.value as KafkaConnection["security_protocol"] })}
            className={INPUT}>
            {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {sasl && (
            <div className="grid grid-cols-2 gap-2">
              <input value={form.sasl_mechanism ?? ""} onChange={(e) => setForm({ ...form, sasl_mechanism: e.target.value })} placeholder="SASL mechanism (PLAIN)" className={INPUT} />
              <input value={form.sasl_username ?? ""} onChange={(e) => setForm({ ...form, sasl_username: e.target.value })} placeholder="SASL username" className={INPUT} />
              <input type="password" value={form.sasl_password ?? ""} onChange={(e) => setForm({ ...form, sasl_password: e.target.value })} placeholder="SASL password" className={`${INPUT} col-span-2`} />
            </div>
          )}
          {ssl && (
            <input value={form.ssl_cafile ?? ""} onChange={(e) => setForm({ ...form, ssl_cafile: e.target.value })} placeholder="Путь до CA файла (опц.)" className={`${INPUT} font-mono`} />
          )}
          <div className="flex justify-end gap-2 pt-1">
            {editingId && <button type="button" onClick={reset} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
            <button type="button" onClick={save} disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editingId ? "Сохранить" : "Добавить"}
            </button>
          </div>
          <p className="text-[11px] text-text-muted/70">Для ИФТ-стенда (без сертов) достаточно имени и bootstrap servers с протоколом PLAINTEXT.</p>
        </div>
      </div>
    </Modal>
  );
}
