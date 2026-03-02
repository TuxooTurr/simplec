"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Bell, Plus, Send, Copy, CheckCheck, Trash2, Pencil,
  CircleCheck, CircleX, Loader2, ChevronDown, X, Sparkles,
} from "lucide-react";
import {
  getAlertScripts, saveAlertScript, deleteAlertScript,
  sendAlert, getAlertHistory,
  type AlertScript, type AlertParam, type AlertHistoryEntry,
} from "@/lib/api";

// ── Styles ──────────────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150 bg-white";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

// ── Template resolver (client-side preview) ─────────────────────────────────

function resolveTemplate(template: string, values: Record<string, string>): string {
  const now = new Date().toISOString();
  let result = template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = values[k] ?? "";
    return v === "__now__" ? now : v;
  });
  result = result.replace(/__now__/g, now);
  try {
    return JSON.stringify(JSON.parse(result), null, 2);
  } catch {
    return result;
  }
}

function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]);
  return [...found];
}

// ── Modal: Add / Edit script ─────────────────────────────────────────────────

interface ScriptModalProps {
  initial?: AlertScript | null;
  onSave:   (s: AlertScript) => void;
  onClose:  () => void;
}

function ScriptModal({ initial, onSave, onClose }: ScriptModalProps) {
  const editing = !!initial?.id;

  const [name,        setName]        = useState(initial?.name        ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [topic,       setTopic]       = useState(initial?.topic       ?? "");
  const [tmpl,        setTmpl]        = useState(initial?.payload_template ?? "{\n  \n}");
  const [params,      setParams]      = useState<AlertParam[]>(initial?.params ?? []);
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState("");

  const extractParams = () => {
    const keys = extractPlaceholders(tmpl);
    setParams(prev => keys.map(k => {
      const existing = prev.find(p => p.key === k);
      return existing ?? { key: k, label: k, type: "text" as const, required: false, default: "" };
    }));
  };

  const updateParam = (idx: number, field: keyof AlertParam, val: string | boolean | string[]) => {
    setParams(ps => ps.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  };

  const handleSave = async () => {
    if (!name.trim() || !topic.trim()) {
      setErr("Название и топик обязательны");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const saved = await saveAlertScript({
        id:               initial?.id,
        name:             name.trim(),
        description:      description.trim(),
        topic:            topic.trim(),
        payload_template: tmpl,
        params,
        builtin:          initial?.builtin ?? false,
      });
      onSave(saved as AlertScript);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-main flex-shrink-0">
          <h2 className="text-base font-semibold text-text-main">
            {editing ? "Редактировать скрипт" : "Новый скрипт"}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto scrollbar-thin p-6 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Название *</label>
              <input value={name} onChange={e => setName(e.target.value)} className={INPUT_CLS} placeholder="Мой алерт" />
            </div>
            <div>
              <label className={LABEL_CLS}>Kafka Topic *</label>
              <input value={topic} onChange={e => setTopic(e.target.value)} className={INPUT_CLS} placeholder="alerts.my.v1" />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Описание</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className={INPUT_CLS} placeholder="Краткое описание" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={LABEL_CLS} style={{ marginBottom: 0 }}>
                Payload Template{" "}
                <span className="normal-case font-normal text-text-muted">(JSON с {"{{param}}"})</span>
              </label>
              <button
                onClick={extractParams}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors font-medium"
              >
                <Sparkles className="w-3.5 h-3.5" /> Извлечь параметры
              </button>
            </div>
            <textarea
              value={tmpl}
              onChange={e => setTmpl(e.target.value)}
              rows={8}
              className={`${INPUT_CLS} font-mono text-xs resize-none`}
              placeholder={"{\n  \"as\": \"{{as}}\",\n  \"severity\": \"{{severity}}\"\n}"}
            />
          </div>

          {params.length > 0 && (
            <div>
              <label className={LABEL_CLS}>Параметры ({params.length})</label>
              <div className="space-y-2">
                {params.map((p, i) => (
                  <div key={p.key} className="grid grid-cols-[80px_1fr_100px_100px_72px] gap-2 items-center bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-xs font-mono text-text-muted truncate">{`{{${p.key}}}`}</span>
                    <input
                      value={p.label}
                      onChange={e => updateParam(i, "label", e.target.value)}
                      className={`${INPUT_CLS} text-xs py-1`}
                      placeholder="Метка"
                    />
                    <select
                      value={p.type}
                      onChange={e => updateParam(i, "type", e.target.value)}
                      className={`${INPUT_CLS} text-xs py-1`}
                    >
                      <option value="text">text</option>
                      <option value="select">select</option>
                      <option value="textarea">textarea</option>
                    </select>
                    <input
                      value={p.default}
                      onChange={e => updateParam(i, "default", e.target.value)}
                      className={`${INPUT_CLS} text-xs py-1`}
                      placeholder="default"
                    />
                    <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer justify-center">
                      <input
                        type="checkbox"
                        checked={p.required}
                        onChange={e => updateParam(i, "required", e.target.checked)}
                        className="accent-primary"
                      />
                      обяз.
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-main flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-main border border-border-main rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark transition-all disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History row ──────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: AlertHistoryEntry }) {
  const ts = new Date(entry.ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm ${
      entry.status === "ok" ? "bg-green-50" : "bg-red-50"
    }`}>
      {entry.status === "ok"
        ? <CircleCheck className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
        : <CircleX     className="w-4 h-4 text-red-500   flex-shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <span className={`font-medium ${entry.status === "ok" ? "text-green-800" : "text-red-700"}`}>
          {entry.script_name}
        </span>
        <span className="text-text-muted mx-1">→</span>
        <span className="font-mono text-xs text-text-muted">{entry.topic}</span>
        {entry.error && (
          <p className="text-xs text-red-600 mt-0.5 truncate" title={entry.error}>{entry.error}</p>
        )}
      </div>
      <span className="text-xs text-text-muted flex-shrink-0">{ts}</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AlertsSection() {
  const [scripts,       setScripts]       = useState<AlertScript[]>([]);
  const [selectedId,    setSelectedId]    = useState<string | null>(null);
  const [values,        setValues]        = useState<Record<string, string>>({});
  const [topicOverride, setTopicOverride] = useState("");
  const [sending,       setSending]       = useState(false);
  const [sendResult,    setSendResult]    = useState<{ ok: boolean; error?: string; offset?: number } | null>(null);
  const [history,       setHistory]       = useState<AlertHistoryEntry[]>([]);
  const [copied,        setCopied]        = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [editScript,    setEditScript]    = useState<AlertScript | null>(null);
  const [loadErr,       setLoadErr]       = useState("");

  const selected = scripts.find(s => s.id === selectedId) ?? null;

  const initValues = useCallback((s: AlertScript) => {
    const v: Record<string, string> = {};
    for (const p of s.params) {
      v[p.key] = p.default === "__now__" ? new Date().toISOString() : (p.default ?? "");
    }
    setValues(v);
    setTopicOverride(s.topic);
    setSendResult(null);
  }, []);

  useEffect(() => {
    getAlertScripts()
      .then(data => {
        setScripts(data);
        if (data.length > 0) {
          setSelectedId(data[0].id);
          initValues(data[0]);
        }
      })
      .catch(e => setLoadErr(String(e)));

    getAlertHistory()
      .then(setHistory)
      .catch(() => {});
  }, [initValues]);

  const handleSelectScript = (s: AlertScript) => {
    setSelectedId(s.id);
    initValues(s);
  };

  const payload = selected ? resolveTemplate(selected.payload_template, values) : "";

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await sendAlert({
        script_id:      selected.id,
        values,
        topic_override: topicOverride !== selected.topic ? topicOverride : "",
      });
      setSendResult({ ok: res.ok, error: res.error, offset: res.offset });
      getAlertHistory().then(setHistory).catch(() => {});
    } catch (e) {
      setSendResult({ ok: false, error: String(e) });
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleModalSave = (saved: AlertScript) => {
    setScripts(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setShowModal(false);
    setEditScript(null);
    setSelectedId(saved.id);
    initValues(saved);
  };

  const handleDelete = async (s: AlertScript) => {
    if (s.builtin) return;
    if (!confirm(`Удалить скрипт "${s.name}"?`)) return;
    try {
      await deleteAlertScript(s.id);
      const next = scripts.filter(x => x.id !== s.id);
      setScripts(next);
      if (selectedId === s.id && next.length > 0) {
        setSelectedId(next[0].id);
        initValues(next[0]);
      }
    } catch (e) {
      alert(String(e));
    }
  };

  if (loadErr) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">{loadErr}</p>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up h-full flex flex-col gap-4">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-main mb-1">Алерты</h1>
        <p className="text-sm text-text-muted">Отправка алертов в Kafka. Выберите сценарий, заполните параметры.</p>
      </div>

      {/* Script tabs */}
      <div className="bg-white border border-border-main rounded-xl p-4">
        <div className="flex flex-wrap gap-2">
          {scripts.map(s => (
            <div key={s.id} className="flex items-center gap-0.5 group relative">
              <button
                onClick={() => handleSelectScript(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150
                  ${selectedId === s.id
                    ? "border-primary bg-indigo-50 text-primary"
                    : "border-border-main text-text-muted hover:border-primary/40 hover:text-text-main"}`}
              >
                <Bell className="w-3.5 h-3.5" />
                {s.name}
                {s.script_type === "a2a" && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-600 leading-none">A2A</span>
                )}
              </button>
              <div className="hidden group-hover:flex items-center absolute -top-2 -right-2 gap-0.5 z-10">
                <button
                  onClick={() => { setEditScript(s); setShowModal(true); }}
                  className="w-5 h-5 bg-white border border-border-main rounded-full flex items-center justify-center text-text-muted hover:text-primary transition-colors shadow-sm"
                  title="Редактировать"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
                {!s.builtin && (
                  <button
                    onClick={() => handleDelete(s)}
                    className="w-5 h-5 bg-white border border-red-200 rounded-full flex items-center justify-center text-red-400 hover:text-red-600 transition-colors shadow-sm"
                    title="Удалить"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={() => { setEditScript(null); setShowModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-border-main text-text-muted hover:border-primary/40 hover:text-primary transition-all duration-150"
          >
            <Plus className="w-3.5 h-3.5" /> Добавить
          </button>
        </div>
      </div>

      {/* Two-column main area */}
      {selected ? (
        <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">

          {/* Left: form */}
          <div className="bg-white border border-border-main rounded-xl p-5 overflow-y-auto scrollbar-thin flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-text-main">{selected.name}</p>
              {selected.description && (
                <p className="text-xs text-text-muted mt-0.5">{selected.description}</p>
              )}
            </div>

            {selected.params.map(p => (
              <div key={p.key}>
                <label className={LABEL_CLS}>
                  {p.label}
                  {p.required && <span className="text-red-400 normal-case font-normal"> *</span>}
                  {p.hint && <span className="normal-case font-normal text-text-muted ml-1">— {p.hint}</span>}
                </label>

                {p.type === "select" && p.options ? (
                  <div className="relative">
                    <select
                      value={values[p.key] ?? p.default}
                      onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                      className={`${INPUT_CLS} appearance-none pr-8`}
                    >
                      {p.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                  </div>
                ) : p.type === "textarea" ? (
                  <textarea
                    value={values[p.key] ?? ""}
                    onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                    rows={3}
                    className={`${INPUT_CLS} resize-none`}
                    placeholder={p.hint ?? ""}
                  />
                ) : (
                  <input
                    value={values[p.key] ?? ""}
                    onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder={p.key === "as" ? "CI0000000" : (p.hint ?? p.default)}
                  />
                )}
              </div>
            ))}

            <div>
              <label className={LABEL_CLS}>Kafka Topic</label>
              <input
                value={topicOverride}
                onChange={e => setTopicOverride(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Right: payload + actions + history */}
          <div className="flex flex-col gap-4 min-h-0">
            <div className="bg-white border border-border-main rounded-xl p-5 flex flex-col gap-3 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-main">
                    {selected.script_type === "a2a" ? "Alert Content" : "Payload"}
                  </h3>
                  {selected.script_type === "a2a" && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 leading-none">
                      A2A · JWT · JSON-RPC
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-muted font-mono truncate max-w-[180px]">{topicOverride}</span>
              </div>

              {selected.script_type === "a2a" && (
                <p className="text-xs text-violet-600 bg-violet-50 rounded-lg px-3 py-1.5">
                  Контент алерта будет обёрнут в JSON-RPC 2.0 с JWT заголовками (Authorization, MessageToken, SystemCi…)
                </p>
              )}

              <pre className="text-xs font-mono text-text-main bg-gray-50 rounded-lg p-3 overflow-auto flex-1 min-h-[140px] whitespace-pre-wrap break-all">
                {payload || <span className="text-text-muted italic">Заполните параметры...</span>}
              </pre>

              {sendResult && (
                <div className={`rounded-lg border p-3 flex items-start gap-2 text-sm ${
                  sendResult.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                }`}>
                  {sendResult.ok
                    ? <CircleCheck className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                    : <CircleX     className="w-4 h-4 text-red-500   flex-shrink-0 mt-0.5" />}
                  {sendResult.ok
                    ? <span className="text-green-700 font-medium">
                        Отправлено{sendResult.offset !== undefined && sendResult.offset !== null
                          ? ` (offset: ${sendResult.offset})`
                          : ""}
                      </span>
                    : <span className="text-red-700">{sendResult.error}</span>}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  disabled={!payload}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg transition-all duration-150 active:scale-[0.97] disabled:opacity-40
                    ${copied
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "border-border-main text-text-muted hover:bg-gray-50 hover:text-text-main"}`}
                >
                  {copied
                    ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано</>
                    : <><Copy       className="w-3.5 h-3.5" /> Копировать</>}
                </button>

                <button
                  onClick={handleSend}
                  disabled={sending || !payload}
                  className="flex flex-1 items-center justify-center gap-2 px-4 py-1.5 bg-primary text-white
                    rounded-lg text-sm font-semibold hover:bg-primary-dark transition-all duration-150
                    disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] shadow-sm"
                >
                  {sending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Отправляю...</>
                    : <><Send    className="w-4 h-4" /> Отправить в Kafka</>}
                </button>
              </div>
            </div>

            {history.length > 0 && (
              <div className="bg-white border border-border-main rounded-xl p-4">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                  История отправок
                </h3>
                <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                  {history.slice(0, 10).map((e, i) => (
                    <HistoryRow key={i} entry={e} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 text-text-muted">
          <Bell className="w-12 h-12 opacity-20" />
          <p className="text-sm">Загружаем скрипты...</p>
        </div>
      )}

      {showModal && (
        <ScriptModal
          initial={editScript}
          onSave={handleModalSave}
          onClose={() => { setShowModal(false); setEditScript(null); }}
        />
      )}
    </div>
  );
}
