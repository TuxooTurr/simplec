"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Network, Search, X, Plus, Minus, Pencil, Trash2, Loader2, Check, RefreshCw, Copy, CheckCheck, Settings2,
  ArrowUp, ArrowDown, ArrowUpDown, Eye, EyeOff,
} from "lucide-react";
import { ConnectionsModal, ConnectionRow, Select } from "@/components/ui";
import {
  listKafkaConnections, createKafkaConnection, updateKafkaConnection, deleteKafkaConnection,
  testKafkaConnection, getKafkaTopics, fetchKafkaMessages,
  type KafkaConnection, type KafkaMessage,
} from "@/lib/kafkaApi";

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
type SortKey = "offset" | "timestamp";
type SortDir = "asc" | "desc";

/* Видимость необязательных колонок списка сообщений */
export interface ColumnVisibility {
  sender: boolean;
  recipient: boolean;
  value: boolean;
}

const COLS_STORAGE_KEY = "st_kafka_cols";
const DEFAULT_COLS: ColumnVisibility = { sender: true, recipient: true, value: true };

/* Выбор подключения и топиков живёт в sessionStorage: переживает навигацию между
   разделами и перезагрузку страницы, но сбрасывается при закрытии вкладки/браузера. */
const SESSION_KEY = "st_kafka_session";
interface KafkaSessionState {
  connId: string; t1: string; t2: string; t3: string; t4: string; limit: number; topicCount: number;
}
function readSession(): Partial<KafkaSessionState> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}"); }
  catch { return {}; }
}

const MIN_TOPIC_ZONES = 2;
const MAX_TOPIC_ZONES = 4;

/* Отправитель/получатель берутся из заголовков сообщения — распространённые ключи */
const SENDER_KEYS = ["from", "sender", "source", "producer", "отправитель"];
const RECIPIENT_KEYS = ["to", "recipient", "destination", "consumer", "получатель"];

function headerValue(m: KafkaMessage, keys: string[]): string {
  for (const [k, v] of m.headers ?? []) {
    if (keys.includes(String(k).toLowerCase())) return v ?? "";
  }
  return "";
}

/* grid-шаблон строки: последняя видимая колонка растягивается */
function rowTemplate(cols: ColumnVisibility): string {
  const parts = ["72px", "104px"];
  if (cols.sender) parts.push("110px");
  if (cols.recipient) parts.push("110px");
  if (cols.value) parts.push("minmax(0,1fr)");
  else parts[parts.length - 1] = "minmax(0,1fr)";
  return parts.join(" ");
}

function SortHeader({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
        active ? "text-primary" : "text-text-muted hover:text-text-main"
      }`}>
      {label}
      {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
    </button>
  );
}

function TopicColumn({
  label, topics, topic, onTopic, messages, loading, selectedId, onSelect, cols, onRemove,
}: {
  label: string;
  topics: string[];
  topic: string;
  onTopic: (t: string) => void;
  messages: KafkaMessage[];
  loading: boolean;
  selectedId: string;
  onSelect: (m: KafkaMessage) => void;
  cols: ColumnVisibility;
  onRemove?: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("offset");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    const arr = [...messages];
    arr.sort((a, b) => {
      const va = sortKey === "offset" ? a.offset : a.timestamp;
      const vb = sortKey === "offset" ? b.offset : b.timestamp;
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return arr;
  }, [messages, sortKey, sortDir]);

  const gridStyle = { gridTemplateColumns: rowTemplate(cols) };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-main bg-bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-main p-2">
        <span className="shrink-0 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">{label}</span>
        <Select
          value={topic}
          onChange={onTopic}
          placeholder="— выберите топик —"
          className="min-w-0 flex-1"
          searchable
          searchPlaceholder="Поиск топика по имени…"
        >
          <option value="">— выберите топик —</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />}
        {onRemove && (
          <button type="button" onClick={onRemove} title="Убрать эту рабочую зону"
            className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-red-500">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Заголовок таблицы: сортировка по offset и дате */}
      <div style={gridStyle} className="grid shrink-0 gap-x-2 border-b border-border-main bg-bg-subtle/60 py-1 pl-3 pr-2.5">
        <SortHeader label="Offset" active={sortKey === "offset"} dir={sortDir} onClick={() => toggleSort("offset")} />
        <SortHeader label="Дата" active={sortKey === "timestamp"} dir={sortDir} onClick={() => toggleSort("timestamp")} />
        {cols.sender && <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Отправитель</span>}
        {cols.recipient && <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Получатель</span>}
        {cols.value && <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Value</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {!topic ? (
          <p className="p-4 text-center text-xs text-text-muted">Выберите топик в списке выше.</p>
        ) : messages.length === 0 && !loading ? (
          <p className="p-4 text-center text-xs text-text-muted">Нет сообщений (по текущему фильтру).</p>
        ) : (
          sorted.map((m) => {
            // Offset/partition — Kafka присваивает их ПО ТОПИКУ, поэтому разные топики
            // легко имеют одинаковую пару partition:offset. Топик обязателен в id,
            // иначе подсветка выбора «протекает» в другую колонку.
            const id = `${topic}::${m.partition}-${m.offset}`;
            const on = selectedId === id;
            const sender = headerValue(m, SENDER_KEYS);
            const recipient = headerValue(m, RECIPIENT_KEYS);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(m)}
                title={`p${m.partition} · offset ${m.offset} · ${fmtTime(m.timestamp)}${m.key ? ` · key:${m.key}` : ""}${sender ? ` · от:${sender}` : ""}${recipient ? ` · кому:${recipient}` : ""}`}
                style={gridStyle}
                className={`relative grid w-full items-center gap-x-2 border-b border-border-main/60 py-1.5 pl-3 pr-2.5 text-left transition-colors ${
                  on ? "bg-[var(--color-active-bg)]" : "hover:bg-bg-subtle/60"
                }`}
              >
                {on && <span className="absolute inset-y-0 left-0 w-1 bg-primary" />}
                <span className={`truncate text-xs tabular-nums ${on ? "font-semibold text-primary" : "text-text-muted"}`}>{m.offset}</span>
                <span className={`truncate text-xs tabular-nums ${on ? "text-primary/80" : "text-text-muted"}`}>{fmtTime(m.timestamp)}</span>
                {cols.sender && (
                  <span className={`truncate font-mono text-xs ${on ? "text-primary/80" : "text-text-muted"}`}>{sender || "—"}</span>
                )}
                {cols.recipient && (
                  <span className={`truncate font-mono text-xs ${on ? "text-primary/80" : "text-text-muted"}`}>{recipient || "—"}</span>
                )}
                {cols.value && (
                  <span className={`min-w-0 truncate font-mono text-xs ${on ? "font-semibold text-primary" : "text-text-main"}`}>
                    {m.value || "—"}
                  </span>
                )}
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
  const initial = useRef<Partial<KafkaSessionState>>(readSession());

  const [connections, setConnections] = useState<KafkaConnection[]>([]);
  const [connId, setConnId] = useState(initial.current.connId ?? "");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicsErr, setTopicsErr] = useState("");
  const [topicsLoading, setTopicsLoading] = useState(false);

  const [limit, setLimit] = useState(initial.current.limit ?? 50);
  const [search, setSearch] = useState("");
  const debounced = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [effSearch, setEffSearch] = useState("");

  const [t1, setT1] = useState(initial.current.t1 ?? ""); const [m1, setM1] = useState<KafkaMessage[]>([]); const [l1, setL1] = useState(false);
  const [t2, setT2] = useState(initial.current.t2 ?? ""); const [m2, setM2] = useState<KafkaMessage[]>([]); const [l2, setL2] = useState(false);
  const [t3, setT3] = useState(initial.current.t3 ?? ""); const [m3, setM3] = useState<KafkaMessage[]>([]); const [l3, setL3] = useState(false);
  const [t4, setT4] = useState(initial.current.t4 ?? ""); const [m4, setM4] = useState<KafkaMessage[]>([]); const [l4, setL4] = useState(false);

  // Кол-во активных рабочих зон для топиков: 2 (по умолчанию) — 4
  const [topicCount, setTopicCount] = useState(() => {
    const n = initial.current.topicCount ?? MIN_TOPIC_ZONES;
    return Math.min(MAX_TOPIC_ZONES, Math.max(MIN_TOPIC_ZONES, n));
  });

  const addTopicZone = () => setTopicCount((n) => Math.min(MAX_TOPIC_ZONES, n + 1));
  const removeLastTopicZone = () => {
    setTopicCount((n) => {
      if (n <= MIN_TOPIC_ZONES) return n;
      const removed = n; // индекс (1-based) удаляемой зоны
      if (removed === 3) { setT3(""); setM3([]); }
      if (removed === 4) { setT4(""); setM4([]); }
      return n - 1;
    });
  };

  // Сохраняем выбор в sessionStorage при любом изменении подключения/топиков/лимита
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ connId, t1, t2, t3, t4, limit, topicCount })); }
    catch { /* ignore */ }
  }, [connId, t1, t2, t3, t4, limit, topicCount]);

  const [selected, setSelected] = useState<(KafkaMessage & { topic: string }) | null>(null);
  const [detailView, setDetailView] = useState<"json" | "raw">("json");
  const [copied, setCopied] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);

  // Видимость колонок Отправитель/Получатель/Value (общая для обоих топиков)
  const [cols, setColsState] = useState<ColumnVisibility>(() => {
    try { return { ...DEFAULT_COLS, ...JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) ?? "{}") }; }
    catch { return DEFAULT_COLS; }
  });
  const toggleCol = (key: keyof ColumnVisibility) => {
    setColsState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const reloadConnections = useCallback(async () => {
    try {
      const list = await listKafkaConnections();
      setConnections(list);
      // сохраняем восстановленный из сессии connId, если он ещё существует; иначе — первый
      setConnId((prev) => (prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? "")));
    } catch { /* show empty */ }
  }, []);

  useEffect(() => { reloadConnections(); }, [reloadConnections]);

  // load topics when connection changes
  useEffect(() => {
    if (!connId) { setTopics([]); return; }
    let alive = true;
    setTopicsLoading(true); setTopicsErr("");
    getKafkaTopics(connId)
      .then((r) => { if (alive) setTopics([...(r.topics ?? [])].sort((a, b) => a.localeCompare(b))); })
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
  useEffect(() => { loadColumn(t3, setM3, setL3); }, [t3, loadColumn]);
  useEffect(() => { loadColumn(t4, setM4, setL4); }, [t4, loadColumn]);

  const refresh = () => {
    loadColumn(t1, setM1, setL1); loadColumn(t2, setM2, setL2);
    loadColumn(t3, setM3, setL3); loadColumn(t4, setM4, setL4);
  };

  // Собираем активные зоны в массив — упрощает рендер и подсчёт колонок сетки.
  const topicSlots = useMemo(() => ([
    { label: "Топик 1", topic: t1, setTopic: setT1, messages: m1, loading: l1 },
    { label: "Топик 2", topic: t2, setTopic: setT2, messages: m2, loading: l2 },
    { label: "Топик 3", topic: t3, setTopic: setT3, messages: m3, loading: l3 },
    { label: "Топик 4", topic: t4, setTopic: setT4, messages: m4, loading: l4 },
  ].slice(0, topicCount)), [t1, m1, l1, t2, m2, l2, t3, m3, l3, t4, m4, l4, topicCount]);

  // При 4 зонах на колонку остаётся мало места — оставляем только Offset и Дату,
  // Отправитель/Получатель/Value гасим независимо от пользовательских тумблеров.
  const effectiveCols: ColumnVisibility = topicCount >= MAX_TOPIC_ZONES
    ? { sender: false, recipient: false, value: false }
    : cols;

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
        <Select
          value={connId}
          onChange={(v) => { setConnId(v); setT1(""); setT2(""); setT3(""); setT4(""); setSelected(null); }}
          placeholder="— подключение —"
          className="w-56"
        >
          <option value="">— подключение —</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <button type="button" onClick={() => setManageOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
          <Settings2 className="h-3.5 w-3.5" /> Подключения
        </button>
        {/* Кол-во рабочих зон для топиков: 2–4 */}
        <div className="flex items-center gap-1 rounded-lg border border-border-main px-1.5 py-1">
          <span className="px-1 text-[11px] text-text-muted">Топики</span>
          <button type="button" onClick={removeLastTopicZone} disabled={topicCount <= MIN_TOPIC_ZONES}
            title="Убрать рабочую зону" className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-main disabled:cursor-not-allowed disabled:opacity-30">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-4 text-center text-xs font-semibold tabular-nums text-text-main">{topicCount}</span>
          <button type="button" onClick={addTopicZone} disabled={topicCount >= MAX_TOPIC_ZONES}
            title="Добавить рабочую зону для топика" className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-main disabled:cursor-not-allowed disabled:opacity-30">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Переключатели видимости колонок списка — при 4 зонах места не остаётся,
              поэтому гасим до Offset/Дата и блокируем тумблеры. */}
          <div className="flex items-center gap-1">
            {([
              { key: "sender" as const, label: "Отправитель" },
              { key: "recipient" as const, label: "Получатель" },
              { key: "value" as const, label: "Value" },
            ]).map(({ key, label: colLabel }) => (
              <button key={key} type="button" onClick={() => toggleCol(key)} disabled={topicCount >= MAX_TOPIC_ZONES}
                title={topicCount >= MAX_TOPIC_ZONES ? "При 4 рабочих зонах остаются только Offset и Дата" : (cols[key] ? `Скрыть колонку «${colLabel}»` : `Показать колонку «${colLabel}»`)}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                  effectiveCols[key]
                    ? "border-primary/40 bg-[var(--color-active-bg)] text-primary"
                    : "border-border-main text-text-muted hover:text-text-main"
                }`}>
                {effectiveCols[key] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                {colLabel}
              </button>
            ))}
          </div>
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
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Верхний ряд: рабочие зоны топиков (2–4) — сжимаются равномерно по ширине.
              При 4 зонах effectiveCols гасит Отправителя/Получателя/Value, остаются Offset и Дата. */}
          <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${topicCount}, minmax(0, 1fr))` }}>
            {topicSlots.map((slot, i) => (
              <TopicColumn key={slot.label} label={slot.label} topics={topics} topic={slot.topic} onTopic={slot.setTopic}
                messages={slot.messages} loading={slot.loading || topicsLoading} selectedId={selectedId}
                onSelect={(m) => setSelected({ ...m, topic: slot.topic })} cols={effectiveCols}
                onRemove={i === topicCount - 1 && topicCount > MIN_TOPIC_ZONES ? removeLastTopicZone : undefined} />
            ))}
          </div>

          {/* Нижний ряд: тело сообщения + адресаты/метаданные — фиксированные 2 колонки */}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {/* Field 3 — message body */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-main bg-bg-card">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-main p-2">
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
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border-main bg-bg-card">
            <div className="shrink-0 border-b border-border-main p-2">
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
        </div>
      )}

      <p className="mt-2 text-center text-[11px] text-text-muted/70">
        Снапшот последних {limit} сообщений (не realtime). Kafka не индексирует содержимое — поиск идёт по этому окну.
      </p>

      <KafkaConnectionsModal open={manageOpen} onClose={() => setManageOpen(false)}
        connections={connections} onChanged={reloadConnections} />
    </div>
  );
}

/* ── Connections manager modal ───────────────────────────────────── */
function emptyConn(): Partial<KafkaConnection> {
  return { name: "", bootstrap_servers: "", security_protocol: "PLAINTEXT", ssl_verify: true, default_limit: 50 };
}

/* Тумблер с подписями слева/справа: CLEARTEXT —●— SSL, нет —●— да */
function SideSwitch({
  label, left, right, on, onChange,
}: {
  label: string; left: string; right: string; on: boolean; onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-1.5">
        <span className={`text-xs font-semibold ${!on ? "text-primary" : "text-text-muted"}`}>{left}</span>
        <span className={`relative inline-block h-4 w-8 rounded-full transition-colors ${on ? "bg-primary" : "bg-bg-muted"}`}>
          <span className={`absolute top-0.5 left-0 h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </span>
        <span className={`text-xs font-semibold ${on ? "text-primary" : "text-text-muted"}`}>{right}</span>
      </button>
    </div>
  );
}

function KafkaConnectionsModal({
  open, onClose, connections, onChanged,
}: {
  open: boolean; onClose: () => void; connections: KafkaConnection[]; onChanged: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<Partial<KafkaConnection>>(emptyConn());
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    <ConnectionsModal
      open={open} onClose={onClose} title="Kafka-подключения" message={msg}
      listTitle={`Сохранённые (${connections.length})`}
      list={<>
        {connections.length === 0 && <p className="text-xs text-text-muted/60">Пока нет подключений.</p>}
        {connections.map((c) => (
          <ConnectionRow
            key={c.id}
            name={c.name}
            subtitle={`${c.bootstrap_servers} · ${c.security_protocol}`}
            actions={[
              { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(c.id), disabled: busy, hoverClass: "hover:text-emerald-600" },
              { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { setEditingId(c.id); setForm({ ...c, sasl_password: "" }); setMsg(null); }, hoverClass: "hover:text-primary" },
              { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(c.id), hoverClass: "hover:bg-red-50 hover:text-red-500" },
            ]}
          />
        ))}
      </>}
      formTitle={editingId ? "Изменить" : "Новое подключение"}
      form={<>
        <input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Имя (напр. ИФТ стенд)" className={INPUT} />
        <input value={form.bootstrap_servers ?? ""} onChange={(e) => setForm({ ...form, bootstrap_servers: e.target.value })}
          placeholder="host:9092 (можно несколько через запятую)" className={`${INPUT} font-mono`} />
        <SideSwitch label="Подключение по:" left="CLEARTEXT" right="SSL" on={ssl}
          onChange={(on) => setForm({ ...form, security_protocol: on ? "SSL" : "PLAINTEXT" })} />
        {ssl && (
          <div className="space-y-2 rounded-lg border border-border-main/70 bg-bg-subtle/40 p-2.5">
            <SideSwitch label="Валидировать сертификат:" left="нет" right="да" on={form.ssl_verify !== false}
              onChange={(on) => setForm({ ...form, ssl_verify: on })} />
            <input value={form.ssl_keyfile ?? ""} onChange={(e) => setForm({ ...form, ssl_keyfile: e.target.value })}
              placeholder="Закрытый ключ — путь на компьютере (опц.)" className={`${INPUT} font-mono`} spellCheck={false} />
            <input value={form.ssl_certfile ?? ""} onChange={(e) => setForm({ ...form, ssl_certfile: e.target.value })}
              placeholder="Сертификат — путь на компьютере (опц.)" className={`${INPUT} font-mono`} spellCheck={false} />
            <input value={form.ssl_cafile ?? ""} onChange={(e) => setForm({ ...form, ssl_cafile: e.target.value })}
              placeholder="Сертификаты доверенных CA (опц.)" className={`${INPUT} font-mono`} spellCheck={false} />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {editingId && <button type="button" onClick={reset} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
          <button type="button" onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {editingId ? "Сохранить" : "Добавить"}
          </button>
        </div>
        <p className="text-[11px] text-text-muted/70">
          Для ИФТ-стенда без сертификатов достаточно имени и bootstrap servers (CLEARTEXT).
          Если есть сертификат — включите SSL и укажите пути к файлам на компьютере, где запущен бэкенд.
        </p>
      </>}
    />
  );
}
