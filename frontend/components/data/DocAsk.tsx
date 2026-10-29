"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, MessageCircleQuestion, Search, X } from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";
import { askRequirement } from "@/lib/api";

const INPUT = "w-full border border-border-main rounded-lg pl-9 pr-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";
const BTN = "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-border-main text-text-main " +
  "hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all";
const ICON_BTN = "p-1.5 rounded-md text-text-muted hover:text-text-main hover:bg-bg-subtle disabled:opacity-40";

/** Все вхождения строки в тексте блока (без учёта регистра) — диапазонами для подсветки. */
function findRanges(root: HTMLElement, q: string): Range[] {
  const needle = q.toLowerCase();
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").toLowerCase();
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

/** Стили подсветки. Не в globals.css: сборщик CSS Next не разбирает ::highlight, а браузеру он понятен. */
const HIGHLIGHT_CSS = "::highlight(doc-search){background-color:rgb(253 230 138);color:inherit}" +
  "::highlight(doc-search-cur){background-color:rgb(251 146 60);color:#111}";

/** Подсветка через CSS Custom Highlight API; где его нет — только прокрутка к месту. */
function paint(all: Range[], cur: Range | null) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  CSS.highlights.delete("doc-search"); CSS.highlights.delete("doc-search-cur");
  if (all.length) CSS.highlights.set("doc-search", new Highlight(...all));
  if (cur) CSS.highlights.set("doc-search-cur", new Highlight(cur));
}

/**
 * Поле над «Преобразовать в документ QA». Выбранная LLM работает — вопрос к документу («Спросить»): модель отвечает
 * только по его тексту. LLM недоступна — то же поле ищет по документу: подсветка, «N из M», стрелки и Enter.
 */
export default function DocAsk({ docId, provider, llmOk, root, contentKey }: {
  docId: string;
  provider: string;
  llmOk: boolean;
  /** Блок с содержимым документа — по нему ищем. */
  root: React.RefObject<HTMLDivElement | null>;
  /** Меняется вместе с содержимым (версия, документ QA, правка) — поиск пересчитывается. */
  contentKey: string;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; text: string } | null>(null);
  const [err, setErr] = useState("");
  const [hits, setHits] = useState<Range[]>([]);
  const [at, setAt] = useState(0);
  const askSeq = useRef(0);

  useEffect(() => { setQ(""); setAnswer(null); setErr(""); }, [docId]);

  // Поиск — только когда LLM недоступна; пересчёт при смене строки и содержимого.
  useEffect(() => {
    const el = root.current;
    const found = !llmOk && el && q.trim().length >= 2 ? findRanges(el, q.trim()) : [];
    setHits(found); setAt(0);
  }, [q, llmOk, contentKey, root]);
  useEffect(() => {
    const cur = hits[at] ?? null;
    paint(hits, cur);
    cur?.startContainer.parentElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hits, at]);
  useEffect(() => () => paint([], null), []);

  const step = (d: number) => { if (hits.length) setAt(i => (i + d + hits.length) % hits.length); };

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    const seq = ++askSeq.current;
    setBusy(true); setErr("");
    try {
      const r = await askRequirement(docId, provider, question);
      if (seq === askSeq.current) setAnswer({ q: question, text: r.answer || "Модель не ответила." });
    } catch (e) { if (seq === askSeq.current) setErr((e as Error).message); }
    if (seq === askSeq.current) setBusy(false);
  };

  return (
    <div className="space-y-2">
      {!llmOk && <style>{HIGHLIGHT_CSS}</style>}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {llmOk
            ? <MessageCircleQuestion className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            : <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />}
          <input value={q} onChange={e => setQ(e.target.value)} className={INPUT}
            aria-label={llmOk ? "Вопрос по документу" : "Поиск по документу"}
            title={llmOk ? undefined : "Выбранная LLM не работает — поле ищет по документу. Когда модель заработает, здесь можно будет задать вопрос"}
            placeholder={llmOk ? "Вопрос по документу — ответ только по его тексту"
              : "Поиск по документу — LLM недоступна"}
            onKeyDown={e => {
              if (e.key === "Escape") { setQ(""); return; }
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (llmOk) void ask(); else step(e.shiftKey ? -1 : 1);
            }} />
        </div>
        {llmOk ? (
          <button type="button" className={BTN} onClick={() => void ask()} disabled={busy || !q.trim()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircleQuestion className="w-4 h-4" />} Спросить
          </button>
        ) : q.trim().length >= 2 && (
          <div className="flex items-center gap-0.5 text-xs text-text-muted tabular-nums">
            <span className="px-1.5">{hits.length ? `${at + 1} из ${hits.length}` : "не найдено"}</span>
            <button type="button" className={ICON_BTN} onClick={() => step(-1)} disabled={!hits.length} aria-label="Предыдущее совпадение"><ChevronUp className="w-4 h-4" /></button>
            <button type="button" className={ICON_BTN} onClick={() => step(1)} disabled={!hits.length} aria-label="Следующее совпадение"><ChevronDown className="w-4 h-4" /></button>
          </div>
        )}
      </div>
      {llmOk && err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {llmOk && answer && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="mb-1 flex items-start gap-2">
            <p className="flex-1 text-xs font-medium text-text-muted">Ответ по документу · {answer.q}</p>
            <button type="button" className={ICON_BTN} onClick={() => setAnswer(null)} aria-label="Скрыть ответ"><X className="w-3.5 h-3.5" /></button>
          </div>
          <NotionRenderer text={answer.text} />
        </div>
      )}
    </div>
  );
}
