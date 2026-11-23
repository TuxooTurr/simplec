"use client";
import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { listRequirements, type Requirement } from "@/lib/api";

/** Ссылка на страницу Confluence: pageId=…, /pages/123 или /display/SPACE/… — как ожидает загрузка требований. */
export const CONFLUENCE_REF_RE = /(?:[?&]pageId=\d+|\/pages\/\d+|\/display\/[^/]+\/)/i;

export interface RequirementsSource { ref: string; ids: string[] }

/**
 * Требования для ИИ: ссылка на Confluence и документы из «Данных» (несколько). Одинаково при создании задачи
 * и при ИИ-переписывании в окне правки.
 */
export default function RequirementsPicker({ value, onChange, disabled }: {
  value: RequirementsSource; onChange: (next: RequirementsSource) => void; disabled?: boolean;
}) {
  const [docs, setDocs] = useState<Requirement[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { listRequirements().then(setDocs, e => setError((e as Error).message)); }, []);
  const s = q.trim().toLocaleLowerCase("ru");
  const byId = new Map((docs ?? []).map(d => [d.id, d]));
  const shown = (docs ?? []).filter(d => !s || d.name.toLocaleLowerCase("ru").includes(s) || (d.feature ?? "").toLocaleLowerCase("ru").includes(s)).slice(0, 50);
  const toggle = (id: string) => onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter(x => x !== id) : [...value.ids, id] });
  const badRef = !!value.ref.trim() && !CONFLUENCE_REF_RE.test(value.ref);
  return (
    <fieldset disabled={disabled} className="space-y-2 text-xs">
      <label className="block">
        <span className="block mb-1 text-text-muted">Ссылка на требования в Confluence</span>
        <input type="text" value={value.ref} onChange={e => onChange({ ...value, ref: e.target.value })} placeholder="https://confluence…/pages/123…"
          aria-invalid={badRef} className={`w-full rounded-lg border px-2.5 py-1.5 bg-[var(--color-input-bg)] text-sm ${badRef ? "border-red-400" : "border-border-main"}`} />
        {badRef && <span className="block mt-0.5 text-red-600 dark:text-red-400">Нужна ссылка на страницу: …pageId=123, …/pages/123 или …/display/ПРОСТРАНСТВО/…</span>}
      </label>
      <div>
        <span className="block mb-1 text-text-muted">Документы из «Данных» · {value.ids.length}</span>
        {value.ids.length > 0 && <div className="flex flex-wrap gap-1.5 mb-1.5">
          {value.ids.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-primary">
            <FileText className="w-3 h-3" />{byId.get(id)?.name ?? "Документ"}
            <button type="button" aria-label={`Убрать ${byId.get(id)?.name ?? id}`} onClick={() => toggle(id)}><X className="w-3 h-3" /></button></span>)}
        </div>}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти документ" aria-label="Найти документ в «Данных»"
          className="w-full rounded-lg border border-border-main px-2.5 py-1.5 bg-[var(--color-input-bg)] text-sm" />
        <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-border-main" role="listbox" aria-multiselectable="true" aria-label="Документы «Данных»">
          {error && <p className="px-2.5 py-1.5 text-red-600 dark:text-red-400">{error}</p>}
          {!docs && !error && <p className="px-2.5 py-1.5 text-text-muted">Загружаю документы…</p>}
          {docs && !shown.length && <p className="px-2.5 py-1.5 text-text-muted">Ничего не найдено</p>}
          {shown.map(d => <label key={d.id} className="flex items-center gap-2 px-2.5 py-1 hover:bg-bg-subtle cursor-pointer">
            <input type="checkbox" checked={value.ids.includes(d.id)} onChange={() => toggle(d.id)} />
            <span className="truncate">{d.name}</span>{d.feature && <span className="ml-auto text-text-muted truncate max-w-[40%]">{d.feature}</span>}
          </label>)}
        </div>
      </div>
    </fieldset>
  );
}
