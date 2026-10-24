"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { addReqSource, syncReqSources, type Requirement } from "@/lib/api";

const INPUT = "w-full border border-border-main rounded-lg px-3 py-1.5 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
const BTN = "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-border-main text-text-main " +
  "hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Страницы Confluence документа (СТ) со ссылками и версиями. «Добавить СТ» — ещё одна страница разделом документа
 * (сразу или новой версией); «Обновить из Confluence» — перечитать страницы: изменились — новая версия документа.
 */
export default function SourcesBar({ doc, onChanged, onError, onSettings }: {
  doc: Requirement;
  onChanged: (d: Requirement, note?: string) => void;
  onError: (m: string) => void;
  onSettings: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [ref, setRef] = useState("");
  const [asVersion, setAsVersion] = useState(!!doc.qa_doc);
  const [busy, setBusy] = useState<"" | "add" | "sync">("");
  const sources = doc.sources ?? [];

  const add = async () => {
    setBusy("add");
    try { onChanged(await addReqSource(doc.id, ref.trim(), asVersion)); setAdding(false); setRef(""); }
    catch (e) { onError((e as Error).message); }
    setBusy("");
  };
  const sync = async () => {
    setBusy("sync");
    try {
      const r = await syncReqSources(doc.id);
      onChanged(r.item, r.changed ? `Страницы изменились — создана версия ${r.item.version}` : "В Confluence изменений нет");
    } catch (e) { onError((e as Error).message); }
    setBusy("");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map(s => (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" title={`Открыть в Confluence · версия ${s.version}`}
            className="inline-flex items-center gap-1 rounded-md border border-border-main px-2 py-0.5 text-xs text-text-main hover:border-primary/50 hover:text-primary">
            <ExternalLink className="w-3 h-3" /> {s.title} <span className="text-text-muted">v{s.version}</span>
          </a>
        ))}
        {!sources.length && <span className="text-xs text-text-muted">не из Confluence</span>}
        <button type="button" className={BTN} onClick={() => setAdding(a => !a)} disabled={!!busy}><Plus className="w-3.5 h-3.5" /> Добавить СТ</button>
        {sources.length > 0 && (
          <button type="button" className={BTN} onClick={() => void sync()} disabled={!!busy} title="Перечитать страницы: если их изменили — новая версия документа">
            {busy === "sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Обновить из Confluence
          </button>
        )}
      </div>
      {adding && (
        <div className="rounded-lg border border-border-main bg-bg-subtle/50 p-2 space-y-2">
          <div className="flex gap-2">
            <input autoFocus value={ref} onChange={e => setRef(e.target.value)} placeholder="Ссылка на страницу Confluence или её id" aria-label="Страница Confluence"
              onKeyDown={e => { if (e.key === "Enter" && ref.trim()) void add(); if (e.key === "Escape") setAdding(false); }} className={INPUT} />
            <button type="button" className={BTN} disabled={!ref.trim() || busy === "add"} onClick={() => void add()}>
              {busy === "add" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Добавить</button>
            <button type="button" className={BTN} onClick={() => setAdding(false)} aria-label="Закрыть"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={asVersion} onChange={e => setAsVersion(e.target.checked)} /> Новой версией документа</label>
            <span>СТ встанет разделом в конец исходника.</span>
            <span className="flex-1" />
            <button type="button" className="hover:text-primary" onClick={onSettings}>Подключение к Confluence</button>
          </div>
        </div>
      )}
    </div>
  );
}
