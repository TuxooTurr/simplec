"use client";

import { useState } from "react";
import { Check, ChevronRight, Copy, Mic } from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";

/** Заголовок раздела речи — тот же, что в промте (agents/layered_generator.py, SPEECH_HEADING). */
export const SPEECH_HEADING = "Текст для рассказа";

/** QA-документ → основная часть и текст речи (раздел «Текст для рассказа» до следующего заголовка того же уровня). */
export function splitSpeech(doc: string): { main: string; speech: string } {
  const lines = doc.split("\n");
  const at = lines.findIndex(l => /^\s{0,3}#{1,3}\s+/.test(l) && l.replace(/^[\s#]+/, "").trim().toLowerCase().startsWith(SPEECH_HEADING.toLowerCase()));
  if (at < 0) return { main: doc, speech: "" };
  const level = (lines[at].match(/#+/) ?? ["##"])[0].length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(#{1,6})\s+/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  const main = [...lines.slice(0, at), ...lines.slice(end)].join("\n").replace(/\n?-{3,}\s*$/, "").trimEnd();
  return { main, speech: lines.slice(at + 1, end).join("\n").trim() };
}

/**
 * QA-документ: основная часть — разметкой, речь для краткого рассказа о функционале — внизу свёрнутым блоком
 * (раскрыть, скопировать). Старые документы без этого раздела показываются как есть.
 */
export default function QaDocView({ doc }: { doc: string }) {
  const { main, speech } = splitSpeech(doc);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(speech); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* браузер не дал доступ к буферу — текст можно выделить вручную */ }
  };
  return (
    <div>
      <NotionRenderer text={main} />
      {speech && (
        <div className="mt-6 rounded-xl border border-border-main bg-bg-subtle/50">
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
              className="flex flex-1 items-center gap-2 text-left text-sm font-semibold text-text-main">
              <ChevronRight className={`w-4 h-4 text-text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
              <Mic className="w-4 h-4 text-primary" /> {SPEECH_HEADING}
              <span className="text-xs font-normal text-text-muted">— коротко рассказать о функционале</span>
            </button>
            <button type="button" onClick={() => void copy()} title="Скопировать текст речи"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-bg-card hover:text-text-main">
              {copied ? <><Check className="w-3.5 h-3.5 text-green-600" /> Скопировано</> : <><Copy className="w-3.5 h-3.5" /> Копировать</>}
            </button>
          </div>
          {open && (
            <div className="border-t border-border-main px-4 py-3">
              <NotionRenderer text={speech} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
