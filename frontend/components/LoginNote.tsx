"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { takeLoginNote } from "@/lib/authApi";

/** Сообщение после входа: «Токены получены» или почему не вышло. Показывается один раз, гаснет само через 8 с. */
export default function LoginNote() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const n = takeLoginNote();
    if (!n) return;
    setNote(n);
    const t = setTimeout(() => setNote(null), n.ok ? 8000 : 20000);
    return () => clearTimeout(t);
  }, []);
  if (!note) return null;
  const Icon = note.ok ? CheckCircle2 : AlertTriangle;
  return (
    <div role="status" aria-live="polite"
      className={`fixed bottom-4 right-4 z-[70] flex max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg animate-fade-in
        ${note.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/80 dark:text-emerald-200"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/80 dark:text-amber-200"}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="min-w-0 flex-1 leading-relaxed">{note.text}</p>
      <button type="button" onClick={() => setNote(null)} aria-label="Закрыть сообщение" className="opacity-60 hover:opacity-100">
        <X className="h-4 w-4" /></button>
    </div>
  );
}
