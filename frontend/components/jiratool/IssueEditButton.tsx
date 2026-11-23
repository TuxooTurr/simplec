"use client";
import { useEffect, useState, useRef, useId } from "react";
import JiraUserField from "./JiraUserField";
import { Loader2, Pencil, Sparkles, X } from "lucide-react";
import { Button, Modal, Select } from "@/components/ui";
import { fetchJson, getJiraSettings, labelName, loadJiraEpics } from "@/lib/jiraApi";
import { loadState, projectKeyOfIssue, type Issue } from "@/lib/jiraTool";
import { readEpicsCache, writeEpicsCache } from "@/components/JiraRegisterPanel";
import { formatBug, formatTask } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import RequirementsPicker, { CONFLUENCE_REF_RE, type RequirementsSource } from "./RequirementsPicker";
export const JIRA_ISSUES_CHANGED = "shark-jira-issues-changed";
type Meta = { name: string; schema: { type?: string; items?: string }; required: boolean; allowed: { id: string; name: string }[]; primary?: boolean; value?: string; mixed?: boolean; displayValue?: string;
  /** epic — Epic Link (ключ эпика из списка); reference — справочное поле проекта (КЭ, ИТ-услуга) одним значением. */
  kind?: "epic" | "reference" };
type Mode = "set" | "replace";
/** «Заменить» — только для текста и меток: фрагмент меняется в текущем значении каждой задачи на сервере. */
const replaceable = (f: Meta) => !f.kind && !f.allowed.length && (f.schema.type === "string" || (f.schema.type === "array" && f.schema.items === "string"));
const isLabels = (id: string, f: Meta) => id === "labels" || (f.schema.type === "array" && f.schema.items === "string" && !f.allowed.length);
/** datetime Jira «2026-11-23T10:00:00.000+0300» ↔ поле datetime-local «2026-11-23T10:00» (часовой пояс браузера). */
const toLocal = (v: string) => v ? v.slice(0, 16) : "";
const fromLocal = (v: string) => {
  if (!v) return "";
  const m = -new Date(v).getTimezoneOffset(), sign = m >= 0 ? "+" : "-", a = Math.abs(m);
  return `${v}:00.000${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${String(a % 60).padStart(2, "0")}`;
};

/** Метки — как при регистрации: значки, Enter добавляет, подсказки из пресетов; пробелы Jira не принимает. */
function LabelsField({ id, value, onChange, disabled, presets }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean; presets: string[] }) {
  const [draft, setDraft] = useState("");
  const list = value.split("\n").filter(Boolean);
  const add = (raw: string) => {
    const l = labelName(raw); setDraft("");
    if (l && !list.includes(l)) onChange([...list, l].join("\n"));
  };
  return <div className={`border border-border-main rounded-lg p-2 bg-bg-card ${disabled ? "opacity-50" : ""}`}>
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {list.map(l => <span key={l} className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs text-primary">{l}
        {!disabled && <button type="button" aria-label={`Убрать метку ${l}`} onClick={() => onChange(list.filter(x => x !== l).join("\n"))}><X className="w-3 h-3" /></button>}</span>)}
      {!list.length && <span className="text-[11px] text-text-muted">Меток нет</span>}
    </div>
    <input id={id} value={draft} disabled={disabled} list={`${id}-presets`} placeholder="Метка · Enter — добавить"
      onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }}
      onBlur={() => { if (draft.trim()) add(draft); }} className="w-full bg-transparent text-sm outline-none" />
    <datalist id={`${id}-presets`}>{presets.filter(p => !list.includes(p)).map(p => <option key={p} value={p} />)}</datalist>
  </div>;
}

/** Эпик — только из эпиков проекта (выгружаются один раз и кэшируются, как в форме регистрации). */
function EpicField({ id, project, value, onChange, disabled }: { id: string; project: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [epics, setEpics] = useState(() => readEpicsCache(project)?.epics ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (epics) return;
    loadJiraEpics(project).then(r => setEpics(writeEpicsCache(project, r.epics).epics), e => setError((e as Error).message));
  }, [project]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <Select id={id} aria-label="Эпик" searchable value={value} disabled={disabled || !epics} onChange={onChange}>
      <option value="">{epics ? "Без эпика" : "Загружаю эпики…"}</option>
      {value && !(epics ?? []).some(e => e.key === value) && <option value={value}>{value}</option>}
      {(epics ?? []).map(e => <option key={e.key} value={e.key}>{e.key} · {e.summary}</option>)}
    </Select>
    {error && <p className="text-[11px] tone-danger mt-1">Эпики не загрузились: {error}</p>}
  </>;
}
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
  const [results, setResults] = useState<{ key: string; ok: boolean; error?: string; skipped?: boolean }[]>([]);
  const job = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const [mode, setMode] = useState<Mode>("set");
  /** «Заменить»: строки «поле свободного ввода → что → на что»; поле выбирается, а не показываются все. */
  const [rows, setRows] = useState<{ id: number; field: string; find: string; to: string }[]>([{ id: 1, field: "", find: "", to: "" }]);
  const replace: Record<string, [string, string]> = Object.fromEntries(rows.filter(r => r.field).map(r => [r.field, [r.find, r.to]]));
  const setRow = (id: number, patch: Partial<{ field: string; find: string; to: string }>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  /** Предпросмотр «что на что» по каждой задаче — перед записью (массовая правка). */
  const [preview, setPreview] = useState<{ items: { key: string; changes: { field: string; name: string; before: string; after: string }[] }[]; affected: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  async function showPreview() {
    setPreviewBusy(true); setError("");
    try { setPreview(await post("/api/jira/tool/edit-preview", { keys: issues.map(i => i.key).slice(0, 200), replace: replacing })); }
    catch (e) { setError((e as Error).message); }
    finally { setPreviewBusy(false); }
  }
  const [presets, setPresets] = useState<string[]>([]);
  const project = projectKeyOfIssue(issues[0]?.key ?? "");
  useEffect(() => { getJiraSettings().then(s => setPresets(s.labels ?? []), () => {}); }, []);
  const replacing = Object.fromEntries(Object.entries(replace).filter(([, [find]]) => find));

  /* ── ИИ: переписать название и описание по стандарту (одна задача), с требованиями — как при создании ── */
  const { provider } = useWorkspace();
  const single = issues.length === 1 ? issues[0] : null;
  const isDefect = /дефект|bug/i.test(String(single?.fields.issuetype ?? ""));
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiNeedsReqs, setAiNeedsReqs] = useState(false);
  const [aiReqs, setAiReqs] = useState<RequirementsSource>(() => {
    const epic = String(single?.fields.customfield_10006 ?? "").toUpperCase();
    const { reqLinks, reqUrls } = loadState();
    const ref = reqUrls[epic]?.trim() ?? "";
    return { ref: CONFLUENCE_REF_RE.test(ref) ? ref : "", ids: reqLinks[epic] ?? [] };
  });
  const canAi = !!single && "summary" in fields && "description" in fields;
  async function rewrite(withoutRequirements = false) {
    if (!single) return;
    setAiBusy(true); setAiNote(null); setAiNeedsReqs(false);
    try {
      const current = (id: string) => (id in changes ? changes[id] : fields[id]?.value) ?? "";
      const ref = withoutRequirements || !CONFLUENCE_REF_RE.test(aiReqs.ref.trim()) ? "" : aiReqs.ref.trim();
      const res = await (isDefect ? formatBug : formatTask)({
        feature: "", description: current("description") || String(single.fields.description ?? ""), provider,
        requirementIds: withoutRequirements ? [] : aiReqs.ids,
        jiraContext: {
          summary: current("summary").slice(0, 250), epic: String(single.fields.customfield_10006 ?? ""), epic_summary: "",
          components: [], selected_components: [], attachment_names: [], confluence_ref: ref, allow_without_requirements: withoutRequirements,
        },
      });
      if (res.needs_requirements) { setAiNeedsReqs(true); setAiNote({ ok: false, text: "ИИ не нашёл требований. Укажите ссылку или документы «Данных» — или перепишите без них." }); return; }
      setMode("set");
      if (res.title) change("summary", res.title);
      if (res.description) change("description", res.description);
      setAiNote({ ok: true, text: "Название и описание переписаны по стандарту. Проверьте и нажмите «Сохранить в Jira»." });
      setAiOpen(false);
    } catch (e) { setAiNote({ ok: false, text: `ИИ не ответил: ${(e as Error).message.slice(0, 300)}` }); }
    finally { setAiBusy(false); }
  }
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
        const started = await post<{ id: string }>("/api/jira/tool/edit-jobs", { keys: issues.slice(i, i + 200).map(x => x.key),
          fields: mode === "set" ? changes : {}, replace: mode === "replace" ? replacing : {} });
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
        setChanges({}); setRows([{ id: 1, field: "", find: "", to: "" }]);
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
    footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Закрыть</Button>
      {mode === "set"
        ? <Button loading={busy} disabled={!Object.keys(changes).length || Object.entries(changes).some(([id, v]) => v === "" && !isLabels(id, fields[id]))}
            onClick={() => void save()}>Сохранить в Jira</Button>
        : <Button loading={previewBusy} disabled={busy || !Object.keys(replacing).length} onClick={() => void showPreview()}>Показать изменения</Button>}</div>}>
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Как менять" className="flex flex-wrap items-center gap-2">
        {([["set", "Переписать", "Задать значение поля целиком"], ["replace", "Заменить", "Заменить фрагмент текста в названии, описании, метках и текстовых полях каждой задачи"]] as const).map(([id, label, hint]) =>
          <button type="button" key={id} role="radio" aria-checked={mode === id} title={hint} disabled={busy} onClick={() => setMode(id)}
            className={`px-3 py-1.5 rounded-lg border text-sm ${mode === id ? "border-primary bg-primary/5 text-primary" : "border-border-main hover:bg-bg-subtle"}`}>{label}</button>)}
        {canAi && <button type="button" onClick={() => setAiOpen(o => !o)} disabled={busy || aiBusy} aria-expanded={aiOpen}
          title={`Переписать название и описание ${isDefect ? "дефекта" : "задачи"} по стандарту — с учётом требований`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50">
          {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}<span role="status">{aiBusy ? "Переписываю…" : "ИИ"}</span></button>}
      </div>
      {aiOpen && canAi && <section aria-label="ИИ: переписать по стандарту" className="rounded-lg border border-border-main bg-bg-subtle p-3 space-y-3">
        <p className="text-xs text-text-muted">ИИ перепишет название и описание по стандарту оформления {isDefect ? "дефектов" : "задач"}. Требования — ссылка Confluence и документы «Данных» (по умолчанию — привязанные к эпику).</p>
        <RequirementsPicker value={aiReqs} onChange={setAiReqs} disabled={aiBusy} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void rewrite()} loading={aiBusy} icon={<Sparkles className="w-3.5 h-3.5" />}>Переписать</Button>
          {aiNeedsReqs && <Button variant="ghost" disabled={aiBusy} onClick={() => void rewrite(true)}>Переписать без требований</Button>}
        </div>
      </section>}
      {aiNote && <p role={aiNote.ok ? "status" : "alert"} className={`text-xs ${aiNote.ok ? "tone-success-text" : "tone-danger"}`}>{aiNote.text}</p>}
      <p className="text-xs text-text-muted">{mode === "set"
        ? "Поля уже открыты. Сохранятся только изменённые значения. При массовой правке разные значения останутся без изменений, пока вы не введёте новые. Статус меняется отдельной кнопкой."
        : "Фрагмент заменяется в текущем значении каждой задачи; где фрагмента нет, задача не меняется. Пустое «на что» — удалить фрагмент."}</p>
      {error && <p role="alert" className="text-sm tone-danger rounded-lg p-2">{error}</p>}
      {busy && !job.current && !Object.keys(fields).length && <p role="status" className="text-sm text-text-muted">Получаю поля и текущие значения…</p>}
      {!busy && !Object.keys(fields).length && !error && <p className="text-sm text-text-muted">Нет общих используемых полей, доступных на экранах редактирования выбранных задач.</p>}
      {mode === "replace" && <div className="space-y-3">
        {ordered.some(([, f]) => replaceable(f)) ? <>
          {rows.map(r => <div key={r.id} className="grid grid-cols-[minmax(0,12rem)_1fr_1fr_auto] gap-2 items-center">
            <Select aria-label="Поле" value={r.field} disabled={busy} onChange={v => setRow(r.id, { field: v })}>
              <option value="">Поле…</option>
              {ordered.filter(([id, f]) => replaceable(f) && (id === r.field || !rows.some(x => x.field === id))).map(([id, f]) => <option key={id} value={id}>{f.name}</option>)}
            </Select>
            <input aria-label="Что заменить" placeholder="что заменить" disabled={busy || !r.field} value={r.find} onChange={e => setRow(r.id, { find: e.target.value })} className={input} />
            <input aria-label="На что" placeholder="на что (пусто — удалить)" disabled={busy || !r.field} value={r.to} onChange={e => setRow(r.id, { to: e.target.value })} className={input} />
            <button type="button" aria-label="Убрать строку" onClick={() => setRows(rs => rs.length > 1 ? rs.filter(x => x.id !== r.id) : [{ id: r.id, field: "", find: "", to: "" }])}
              className="p-2 text-text-muted hover:text-red-500"><X className="w-4 h-4" /></button>
          </div>)}
          <button type="button" onClick={() => setRows(rs => [...rs, { id: Math.max(...rs.map(x => x.id)) + 1, field: "", find: "", to: "" }])}
            className="text-xs text-primary hover:underline">+ поле</button>
          <p className="text-[11px] text-text-muted">Только поля свободного ввода: текст и метки. Перед записью покажем, что на что заменится в каждой задаче.</p>
        </> : !busy && <p className="text-sm text-text-muted">Нет полей свободного ввода на экранах редактирования выбранных задач.</p>}
      </div>}
      {preview && <Modal open title={`Что заменится · задач ${preview.affected} из ${preview.items.length}`} onClose={() => setPreview(null)} size="max-w-3xl"
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPreview(null)}>Назад</Button>
          <Button loading={busy} disabled={!preview.affected} onClick={() => { setPreview(null); void save(); }}>Применить к {preview.affected}</Button></div>}>
        {!preview.affected ? <p className="text-sm text-text-muted">Фрагмент не найден ни в одной задаче — менять нечего.</p>
          : <div className="max-h-[60vh] overflow-y-auto"><table className="w-full text-xs">
            <thead className="text-text-muted text-left"><tr><th className="py-1 pr-2">Задача</th><th className="py-1 pr-2">Поле</th><th className="py-1 pr-2">Было</th><th className="py-1">Станет</th></tr></thead>
            <tbody>{preview.items.filter(i => i.changes.length).flatMap(i => i.changes.map((c, n) => <tr key={i.key + c.field} className={n === 0 ? "border-t border-border-main" : ""}>
              <td className="py-1 pr-2 align-top font-mono text-primary whitespace-nowrap">{n === 0 ? i.key : ""}</td>
              <td className="py-1 pr-2 align-top text-text-muted whitespace-nowrap">{c.name}</td>
              <td className="py-1 pr-2 align-top line-through text-text-muted whitespace-pre-wrap break-words">{c.before || "—"}</td>
              <td className="py-1 align-top font-medium whitespace-pre-wrap break-words">{c.after || "—"}</td></tr>))}</tbody></table>
            {preview.items.length - preview.affected > 0 && <p className="mt-2 text-[11px] text-text-muted">Без изменений: {preview.items.length - preview.affected} — фрагмента нет.</p>}</div>}
      </Modal>}
      {mode === "set" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ordered.map(([id, f]) => {
          const value = id in changes ? changes[id] : f.value ?? "";
          const controlId = prefix + "-" + id;
          const placeholder = f.mixed && !(id in changes) ? "Разные значения · без изменений" : "";
          return <div key={id} className={id === "summary" || id === "description" ? "sm:col-span-2" : ""}>
            <label className="text-sm block mb-1" htmlFor={controlId}>{f.name}{f.required ? " *" : ""}{id in changes && <span className="ml-2 text-[10px] text-primary">Изменено</span>}</label>
            {f.kind === "epic" ? <EpicField id={controlId} project={project} value={value ?? ""} disabled={busy || value === null} onChange={v => change(id, v)} />
              : f.kind === "reference" ? <Select id={controlId} aria-label={f.name} value={(value ?? "").split("\n")[0]} disabled={busy || value === null} onChange={v => change(id, v)}>
                <option value="">{placeholder || "Не задано"}</option>
                {value && !f.allowed.some(x => x.id === value) && <option value={value}>{f.displayValue || value}</option>}
                {f.allowed.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              : isLabels(id, f) ? <LabelsField id={controlId} value={value ?? ""} disabled={busy || value === null} presets={presets} onChange={v => change(id, v)} />
              : f.schema.type === "datetime" ? <input id={controlId} aria-label={f.name} type="datetime-local" value={toLocal(value ?? "")} disabled={busy || value === null} onChange={e => change(id, fromLocal(e.target.value))} className={input} />
              : f.schema.type === "user" ? <fieldset disabled={busy || value === null}><JiraUserField id={controlId} label="" jiraOk name={value ?? ""} display={id in changes ? userDisplays[id] ?? "" : f.displayValue ?? ""} onChange={v => { change(id, v.jiraName); setUserDisplays(old => ({ ...old, [id]: v.jiraDisplay })); }} /></fieldset>
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
      </div>}
      {progress && <p role="status" className="text-xs text-text-muted">{progress}{busy ? " · закрытие окна не отменяет операцию" : ""}</p>}
      {busy && job.current && <Button variant="danger" onClick={() => void fetchJson(`/api/jira/tool/edit-jobs/${job.current}`, { method: "DELETE" })}>Отменить оставшиеся</Button>}
      {!!results.length && <ul className="max-h-48 overflow-auto text-sm">{results.map(r => <li key={r.key} className={r.ok ? "tone-success-text" : "text-red-600"}>{r.key}: {r.ok ? (r.skipped ? "без изменений" : "сохранено") : r.error}</li>)}</ul>}
    </div>
  </Modal>;
}
