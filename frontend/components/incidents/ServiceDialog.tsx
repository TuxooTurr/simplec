"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { BTN, BTN_PRIMARY, INPUT } from "@/components/incidents/ui";
import { addIncService, editIncService, type IncService, type IncServiceBody } from "@/lib/incidentGenApi";

const EMPTY: IncServiceBody = { ci: "", name: "", crit: "Business Critical", hosts: [], app: "", db: "", topic: "", logs: null, metrics: null };
const LABEL = "block text-xs font-medium text-text-muted mb-1";

/** Есть / нет / не отмечено — для логов и метрик на стенде. */
function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opts: { v: boolean | null; text: string }[] = [{ v: true, text: "Есть" }, { v: false, text: "Нет" }, { v: null, text: "Не знаю" }];
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border-main p-0.5">
        {opts.map(o => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors
              ${value === o.v ? "bg-primary text-white" : "text-text-muted hover:bg-bg-subtle hover:text-text-main"}`}>
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Своя КЭ: код и название обязательны по смыслу, остальное — по желанию. Пустые хосты, приложение, БД и топик сервер
 * заполнит сам (pvlsb-<приложение>01…04 и т.п.) — тексты событий всё равно соберутся.
 */
export default function ServiceDialog({ open, editing, crits, onClose, onSaved }: {
  open: boolean;
  /** Правка своей КЭ; null — новая. */
  editing: IncService | null;
  crits: string[];
  onClose: () => void;
  onSaved: (services: IncService[], ci: string) => void;
}) {
  const [f, setF] = useState<IncServiceBody>(EMPTY);
  const [hosts, setHosts] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const base = editing ? { ...editing } : EMPTY;
    setF(base); setHosts(base.hosts.join("\n")); setErr("");
  }, [open, editing]);

  const save = async () => {
    const body: IncServiceBody = { ...f, ci: f.ci.trim(), name: f.name.trim(),
      hosts: hosts.split(/[\s,;]+/).map(h => h.trim()).filter(Boolean) };
    setBusy(true); setErr("");
    try {
      const r = editing ? await editIncService(editing.ci, body) : await addIncService(body);
      onSaved(r.services, body.ci);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `КЭ ${editing.ci}` : "Новая КЭ"} size="max-w-lg">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <label className="block">
            <span className={LABEL}>Код КЭ</span>
            <input autoFocus value={f.ci} onChange={e => setF({ ...f, ci: e.target.value })} placeholder="CI01234567"
              className={`${INPUT} font-mono`} required />
          </label>
          <label className="block">
            <span className={LABEL}>Название услуги</span>
            <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Как в Sber911" className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className={LABEL}>Критичность</span>
          <select value={f.crit} onChange={e => setF({ ...f, crit: e.target.value })} className={INPUT}>
            {crits.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-4">
          <TriState label="Логи на стенде" value={f.logs} onChange={logs => setF({ ...f, logs })} />
          <TriState label="Метрики мониторинга" value={f.metrics} onChange={metrics => setF({ ...f, metrics })} />
        </div>
        <p className="text-[11px] text-text-muted">Логи и метрики сам генератор не создаёт — отметка подсказывает, на какой КЭ проверять сценарии «без логов» и «без метрик».</p>
        <details className="rounded-lg border border-border-main px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-text-muted">Хосты, приложение, БД, топик — для текстов событий</summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className={LABEL}>Хосты (по одному в строке; пусто — придумаются)</span>
              <textarea value={hosts} onChange={e => setHosts(e.target.value)} rows={3} placeholder="pvlsb-app0101" className={`${INPUT} font-mono text-xs`} />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className={LABEL}>Приложение</span>
                <input value={f.app} onChange={e => setF({ ...f, app: e.target.value })} className={`${INPUT} font-mono text-xs`} /></label>
              <label className="block"><span className={LABEL}>БД</span>
                <input value={f.db} onChange={e => setF({ ...f, db: e.target.value })} className={`${INPUT} font-mono text-xs`} /></label>
              <label className="block"><span className={LABEL}>Топик Kafka</span>
                <input value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} className={`${INPUT} font-mono text-xs`} /></label>
            </div>
          </div>
        </details>
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={BTN} onClick={onClose}>Отмена</button>
          <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.ci.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? "Сохранить" : "Добавить"}</button>
        </div>
      </form>
    </Modal>
  );
}
