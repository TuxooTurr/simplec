"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Loader2, Plus, Sparkles, Target, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { getReqLinks, type Requirement } from "@/lib/api";

const INPUT = "w-full border border-border-main rounded-lg px-3 py-1.5 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

/**
 * Сборка документа QA: ИИ читает исходник документа и отмеченные страницы Confluence — ссылки, найденные в самом
 * документе, и добавленные здесь (+), — и собирает единый документ по функции из названия документа (и «Что нужно»).
 */
export default function QaGenerateModal({ open, doc, onClose, onGenerate }: {
  open: boolean;
  doc: Requirement;
  onClose: () => void;
  onGenerate: (links: string[], focus: string) => Promise<void>;
}) {
  const [found, setFound] = useState<{ title: string; url: string }[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [focus, setFocus] = useState(doc.focus ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!open) return;
    setFound(null); setErr(""); setExtra([]); setDraft(""); setFocus(doc.focus ?? "");
    getReqLinks(doc.id).then(r => { setFound(r.found); setChecked(new Set(r.found.map(f => f.url))); }, e => { setFound([]); setErr((e as Error).message); });
  }, [open, doc.id, doc.focus]);

  const addExtra = () => {
    const v = draft.trim();
    if (v && !extra.includes(v)) setExtra(x => [...x, v]);
    setDraft("");
  };
  const links = [...(found ?? []).filter(f => checked.has(f.url)).map(f => f.url), ...extra];
  const run = async () => {
    setBusy(true); setErr("");
    try { await onGenerate(links, focus); onClose(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const sources = doc.sources ?? [];

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Документ QA" size="max-w-2xl">
      <div className="space-y-4 text-sm">
        <p className="text-text-muted">ИИ соберёт единый документ по функции <b className="text-text-main">«{doc.name}»</b>: из исходника документа
          и отмеченных страниц Confluence — только то, что относится к этой функции.</p>

        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted"><Target className="w-3.5 h-3.5" /> Что именно нужно (необязательно)</span>
          <input value={focus} onChange={e => setFocus(e.target.value)} placeholder="Например: только выгрузка карточки в PDF" className={INPUT} />
        </label>

        <div>
          <p className="mb-1 text-xs font-medium text-text-muted">Исходник документа — всегда</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-border-main px-2 py-0.5 text-xs"><FileText className="w-3 h-3" /> {doc.name}</span>
            {sources.map(s => (
              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border-main px-2 py-0.5 text-xs text-text-muted hover:text-primary">
                <ExternalLink className="w-3 h-3" /> {s.title}</a>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-text-muted">Ссылки на страницы Confluence внутри документа</p>
          {found === null ? <p className="flex items-center gap-2 text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Ищу ссылки…</p>
            : !found.length ? <p className="text-text-muted text-xs">В тексте документа ссылок на другие страницы Confluence нет.</p>
            : (
              <ul className="max-h-48 overflow-y-auto scrollbar-thin rounded-lg border border-border-main divide-y divide-border-main">
                {found.map(f => (
                  <li key={f.url}>
                    <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-bg-subtle">
                      <input type="checkbox" checked={checked.has(f.url)}
                        onChange={() => setChecked(o => { const n = new Set(o); if (n.has(f.url)) n.delete(f.url); else n.add(f.url); return n; })} />
                      <span className="min-w-0 flex-1 truncate">{f.title}</span>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-text-muted hover:text-primary" aria-label={`Открыть ${f.title}`}>
                        <ExternalLink className="w-3.5 h-3.5" /></a>
                    </label>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-text-muted">Добавить ссылки</p>
          {extra.length > 0 && (
            <ul className="mb-2 space-y-1">
              {extra.map(x => (
                <li key={x} className="flex items-center gap-2 rounded-md border border-border-main px-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono">{x}</span>
                  <button type="button" onClick={() => setExtra(e => e.filter(y => y !== x))} aria-label="Убрать ссылку" className="text-text-muted hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}
              placeholder="Ссылка на страницу Confluence или её id" className={`${INPUT} font-mono text-xs`} />
            <button type="button" onClick={addExtra} disabled={!draft.trim()} className="inline-flex items-center gap-1 rounded-lg border border-border-main px-2.5 text-sm hover:bg-bg-subtle disabled:opacity-50">
              <Plus className="w-4 h-4" /></button>
          </div>
        </div>

        {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border-main pt-3">
          <span className="mr-auto text-xs text-text-muted">Прочитает страниц: {links.length}</span>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-border-main px-3 py-1.5 hover:bg-bg-subtle">Отмена</button>
          <button type="button" onClick={() => void run()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? "Собираю…" : "Собрать документ QA"}</button>
        </div>
      </div>
    </Modal>
  );
}
