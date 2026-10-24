"use client";

import { useState } from "react";
import { ChevronRight, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";
import { BTN, BTN_PRIMARY, INPUT } from "@/components/incidents/ui";
import { addIncLib, deleteIncLib, editIncLib, type IncLibItem } from "@/lib/incidentGenApi";

type Draft = Omit<IncLibItem, "id">;
const EMPTY: Draft = { system: "", description: "", summary: "", instruction: "" };

function Editor({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-bg-card p-4">
      <input value={d.system} onChange={e => setD({ ...d, system: e.target.value })} placeholder="Система (для подписи)" aria-label="Система" className={INPUT} />
      <textarea value={d.description} onChange={e => setD({ ...d, description: e.target.value })} rows={4} placeholder="Описание инцидента" aria-label="Описание инцидента"
        className={`${INPUT} resize-y`} />
      <input value={d.summary} onChange={e => setD({ ...d, summary: e.target.value })} placeholder="Краткое описание (суммаризация для инструкции)" aria-label="Краткое описание" className={INPUT} />
      <textarea value={d.instruction} onChange={e => setD({ ...d, instruction: e.target.value })} rows={8} placeholder="Инструкция (Markdown), можно пусто" aria-label="Инструкция"
        className={`${INPUT} resize-y font-mono text-[13px]`} />
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={onCancel} disabled={busy}><X className="w-4 h-4" /> Отмена</button>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !d.description.trim()}
          onClick={async () => { setBusy(true); try { await onSave(d); } finally { setBusy(false); } }}>
          <Save className="w-4 h-4" /> Сохранить</button>
      </div>
    </div>
  );
}

/** Библиотека описаний инцидентов и инструкций к ним — из неё генератор берёт случайный пример. */
export default function IncidentLibrary({ library, onChange, onError }: {
  library: IncLibItem[]; onChange: (l: IncLibItem[]) => void; onError: (m: string) => void;
}) {
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const shown = s ? library.filter(x => `${x.system} ${x.description}`.toLowerCase().includes(s)) : library;
  const wrap = (p: Promise<{ library: IncLibItem[] }>) => p.then(r => { onChange(r.library); setEdit(null); }, e => onError((e as Error).message));

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти пример" aria-label="Найти пример" className={`${INPUT} max-w-xs`} />
        <span className="text-sm text-text-muted">{shown.length} из {library.length}</span>
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={() => setEdit("new")}><Plus className="w-4 h-4" /> Пример</button>
      </div>
      {!library.length && edit !== "new" && (
        <p className="text-sm text-text-muted">Библиотека пуста. «Импорт» вверху принимает incident_instruction_examples.json — поля о сотрудниках при импорте отбрасываются.</p>
      )}
      {edit === "new" && <Editor initial={EMPTY} onCancel={() => setEdit(null)} onSave={d => wrap(addIncLib(d))} />}
      {shown.map(x => edit === x.id ? (
        <Editor key={x.id} initial={x} onCancel={() => setEdit(null)} onSave={d => wrap(editIncLib(x.id, d))} />
      ) : (
        <div key={x.id} className="rounded-xl border border-border-main bg-bg-card">
          <div className="flex items-start gap-2 px-3 py-2">
            <button type="button" onClick={() => setOpen(o => (o === x.id ? null : x.id))} aria-expanded={open === x.id} className="flex-1 min-w-0 text-left">
              <span className="flex items-center gap-1.5 text-sm font-medium text-text-main">
                <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${open === x.id ? "rotate-90" : ""}`} />
                <span className="truncate">{x.system || "Без системы"}</span>
                {x.instruction ? <span className="text-xs font-normal text-emerald-600">· с инструкцией</span> : <span className="text-xs font-normal text-text-muted">· без инструкции</span>}
              </span>
              <span className="mt-0.5 pl-5 text-xs text-text-muted line-clamp-2 break-words">{x.description}</span>
            </button>
            <button type="button" className="p-1.5 rounded text-text-muted hover:bg-bg-subtle" title="Править" aria-label="Править пример" onClick={() => setEdit(x.id)}><Pencil className="w-4 h-4" /></button>
            <button type="button" className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40" title="Удалить" aria-label="Удалить пример"
              onClick={() => { if (confirm("Удалить пример из библиотеки?")) void wrap(deleteIncLib(x.id)); }}><Trash2 className="w-4 h-4" /></button>
          </div>
          {open === x.id && (
            <div className="border-t border-border-main px-4 py-3 space-y-3">
              <pre className="text-xs whitespace-pre-wrap font-sans text-text-main">{x.description}</pre>
              {x.instruction && <div className="border-t border-border-main pt-3"><NotionRenderer text={x.instruction} /></div>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
