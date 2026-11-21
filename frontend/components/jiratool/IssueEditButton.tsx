"use client";
import { useEffect, useState, useRef, useId } from "react";
import JiraUserField from "./JiraUserField";
import { Pencil } from "lucide-react";
import { Button, Modal, Select } from "@/components/ui";
import { fetchJson } from "@/lib/jiraApi";
import { loadState, type Issue } from "@/lib/jiraTool";
export const JIRA_ISSUES_CHANGED = "shark-jira-issues-changed";
type Meta = { name: string; schema: { type?: string }; required: boolean; allowed: { id: string; name: string }[]; primary?: boolean; value?: string; mixed?: boolean; displayValue?: string };
const BASE = ["summary", "description", "issuetype", "priority", "assignee", "reporter", "components", "labels", "environment", "fixVersions", "duedate"];
const post = <T,>(path: string, body: unknown) => fetchJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export default function IssueEditButton({ issues, onDone, compact = false }: { issues: Issue[]; onDone?: (keys: string[]) => void; compact?: boolean }) {
  const [targets, setTargets] = useState<Issue[] | null>(null);
  const valid = issues.filter(i => !i.local);
  return <><Button variant={compact ? "icon" : "ghost"} disabled={!valid.length} onClick={() => setTargets([...valid])} title="Изменить поля задач" icon={<Pencil className="w-3.5 h-3.5" />}>{!compact && "Изменить"}</Button>
    {targets && <IssueEditModal issues={targets} onClose={() => setTargets(null)} onDone={onDone} />}</>;
}
export function IssueEditModal({ issues, onClose, onDone }: { issues: Issue[]; onClose: () => void; onDone?: (keys: string[]) => void }) {
  const prefix = useId();
  const [fields, setFields] = useState<Record<string, Meta>>({});
  const [changes, setChanges] = useState<Record<string, string | null>>({});
  const [userDisplays, setUserDisplays] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [results, setResults] = useState<{ key: string; ok: boolean; error?: string }[]>([]);
  const job = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  useEffect(() => {
    let live = true;
    post<{ fields: Record<string, Meta>; errors: Record<string, string> }>("/api/jira/tool/edit-meta", { keys: issues.map(i => i.key).slice(0, 200) }).then(r => {
      if (!live) return;
      const used = new Set(BASE);
      const keys = new Set(issues.map(i => i.key));
      for (const list of loadState().lists.filter(l => l.keys.some(k => keys.has(k)))) {
        for (const ref of [...list.columns, ...list.groupBy, ...(list.views ?? []).flatMap(v => v.columns)]) if (ref.startsWith("jira:")) used.add(ref.slice(5));
      }
      setFields(Object.fromEntries(Object.entries(r.fields).filter(([id, f]) => used.has(id) || f.primary || f.required)));
      setError(Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join("; "));
    }, e => { if (live) setError(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function change(id: string, value: string | null) {
    setChanges(old => {
      const next = { ...old };
      if (value !== null && !fields[id].mixed && value === (fields[id].value ?? "")) delete next[id];
      else next[id] = value;
      return next;
    });
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const all: typeof results = [];
      for (let i = 0; i < issues.length; i += 200) {
        const started = await post<{ id: string }>("/api/jira/tool/edit-jobs", { keys: issues.slice(i, i + 200).map(x => x.key), fields: changes });
        job.current = started.id;
        let state: { status: string; results: typeof results; total: number; error?: string };
        do {
          await new Promise(resolve => setTimeout(resolve, 800));
          state = await fetchJson(`/api/jira/tool/edit-jobs/${started.id}`);
          setProgress(`Обработано ${i + state.results.length} из ${issues.length}`); setResults([...all, ...state.results]);
        } while (state.status === "running");
        all.push(...state.results); job.current = null;
        if (state.error) setError(state.error);
        if (state.status !== "done") break;
      }
      setResults(all);
      const keys = all.filter(x => x.ok).map(x => x.key);
      if (keys.length) { window.dispatchEvent(new CustomEvent(JIRA_ISSUES_CHANGED, { detail: keys })); onDone?.(keys); }
      if (all.length === issues.length && all.every(result => result.ok)) {
        setFields(old => Object.fromEntries(Object.entries(old).map(([id, field]) => [id, id in changes ? { ...field, value: changes[id] ?? "", mixed: false, displayValue: changes[id] === null ? "" : userDisplays[id] ?? field.displayValue } : field])));
        setChanges({});
      }
    } catch (e) { setError((e as Error).message); }
    finally { job.current = null; setBusy(false); }
  }
  const ordered = Object.entries(fields).sort(([a, av], [b, bv]) => {
    const ai = BASE.indexOf(a), bi = BASE.indexOf(b);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || av.name.localeCompare(bv.name, "ru");
  });
  const input = "w-full border border-border-main bg-bg-card rounded-lg px-3 py-2 text-sm";
  return <Modal open onClose={onClose} title={issues.length === 1 ? `Изменить · ${issues[0].key}` : `Изменить · задач ${issues.length}`} size="max-w-3xl"
    footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Закрыть</Button><Button loading={busy} disabled={!Object.keys(changes).length || Object.values(changes).some(v => v === "")} onClick={() => void save()}>Сохранить в Jira</Button></div>}>
    <div className="space-y-4">
      <p className="text-xs text-text-muted">Поля уже открыты. Сохранятся только изменённые значения. При массовой правке разные значения останутся без изменений, пока вы не введёте новые. Статус меняется отдельной кнопкой.</p>
      {error && <p role="alert" className="text-sm tone-danger rounded-lg p-2">{error}</p>}
      {busy && !job.current && !Object.keys(fields).length && <p role="status" className="text-sm text-text-muted">Получаю поля и текущие значения…</p>}
      {!busy && !Object.keys(fields).length && !error && <p className="text-sm text-text-muted">Нет общих используемых полей, доступных на экранах редактирования выбранных задач.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ordered.map(([id, f]) => {
          const value = id in changes ? changes[id] : f.value ?? "";
          const controlId = prefix + "-" + id;
          const placeholder = f.mixed && !(id in changes) ? "Разные значения · без изменений" : "";
          return <div key={id} className={id === "summary" || id === "description" ? "sm:col-span-2" : ""}>
            <label className="text-sm block mb-1" htmlFor={controlId}>{f.name}{f.required ? " *" : ""}{id in changes && <span className="ml-2 text-[10px] text-primary">Изменено</span>}</label>
            {f.schema.type === "user" ? <fieldset disabled={busy || value === null}><JiraUserField id={controlId} label="" jiraOk name={value ?? ""} display={id in changes ? userDisplays[id] ?? "" : f.displayValue ?? ""} onChange={v => { change(id, v.jiraName); setUserDisplays(old => ({ ...old, [id]: v.jiraDisplay })); }} /></fieldset>
              : f.allowed.length && f.schema.type !== "array" ? <Select id={controlId} aria-label={f.name} value={value ?? ""} disabled={busy || value === null} onChange={v => change(id, v)}>
                <option value="">{placeholder || "Не задано"}</option>
                {value && !f.allowed.some(x => x.id === value) && <option value={value}>{value}</option>}
                {f.allowed.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              : f.allowed.length && f.schema.type === "array" ? <fieldset disabled={busy || value === null} className="border border-border-main rounded-lg p-2 max-h-40 overflow-auto space-y-1">
                {placeholder && <p className="text-[11px] text-text-muted mb-1">{placeholder}</p>}
                {f.allowed.map(option => <label key={option.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={(value ?? "").split("\n").includes(option.id)} onChange={e => {
                  const next = new Set((value ?? "").split("\n").filter(Boolean)); if (e.target.checked) next.add(option.id); else next.delete(option.id); change(id, [...next].join("\n"));
                }} />{option.name}</label>)}
              </fieldset>
              : id === "description" || f.schema.type === "array" ? <textarea id={controlId} aria-label={f.name} rows={id === "description" ? 6 : 3} value={value ?? ""} disabled={busy || value === null} placeholder={placeholder || (f.schema.type === "array" ? "По одному значению на строку" : "")} onChange={e => change(id, e.target.value)} className={input} />
              : <input id={controlId} aria-label={f.name} type={f.schema.type === "date" ? "date" : f.schema.type === "number" ? "number" : "text"} step="any" value={value ?? ""} disabled={busy || value === null} placeholder={placeholder} onChange={e => change(id, e.target.value)} className={input} />}
            {f.mixed && <p className="text-[10px] text-text-muted mt-1">У выбранных задач разные значения</p>}
            {!f.required && <label className="flex items-center gap-2 text-[11px] text-text-muted mt-1.5"><input type="checkbox" aria-label={`Очистить ${f.name}`} disabled={busy} checked={value === null} onChange={e => {
              if (e.target.checked) change(id, null);
              else setChanges(old => { const next = { ...old }; delete next[id]; return next; });
            }} />Очистить значение</label>}
          </div>;
        })}
      </div>
      {progress && <p role="status" className="text-xs text-text-muted">{progress}{busy ? " · закрытие окна не отменяет операцию" : ""}</p>}
      {busy && job.current && <Button variant="danger" onClick={() => void fetchJson(`/api/jira/tool/edit-jobs/${job.current}`, { method: "DELETE" })}>Отменить оставшиеся</Button>}
      {!!results.length && <ul className="max-h-48 overflow-auto text-sm">{results.map(r => <li key={r.key} className={r.ok ? "tone-success-text" : "text-red-600"}>{r.key}: {r.ok ? "сохранено" : r.error}</li>)}</ul>}
    </div>
  </Modal>;
}
