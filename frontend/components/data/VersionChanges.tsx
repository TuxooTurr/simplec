"use client";

import { useEffect, useState } from "react";
import { ChevronRight, CornerDownRight, Loader2 } from "lucide-react";
import { reqDiff, type ReqDiff, type ReqDiffItem } from "@/lib/api";

const KIND: Record<ReqDiffItem["kind"], { label: string; cls: string }> = {
  added: { label: "добавлено", cls: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" },
  changed: { label: "изменено", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  removed: { label: "убрано", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
};

/**
 * Свод: что изменилось в версии b по сравнению с a — по разделам документа. Раздел — ссылка: щелчок прокручивает
 * документ к этому месту и подсвечивает его (onJump). Сравнивается QA-документ, если он есть у обеих версий,
 * иначе исходник.
 */
export default function VersionChanges({ docId, a, b, onJump }: { docId: string; a: number; b: number; onJump: (section: string) => void }) {
  const [d, setD] = useState<ReqDiff | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let alive = true;
    setD(null); setErr("");
    reqDiff(docId, a, b).then(r => { if (alive) setD(r); }, e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [docId, a, b]);

  // Пункты по разделам — в порядке документа.
  const groups: { section: string; items: ReqDiffItem[] }[] = [];
  for (const it of d?.items ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.section === it.section) last.items.push(it);
    else groups.push({ section: it.section, items: [it] });
  }

  return (
    <section className="mt-4 rounded-xl border border-border-main bg-bg-subtle/40">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <ChevronRight className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-sm font-semibold text-text-main">Что изменилось в версии {b}</span>
        <span className="text-xs text-text-muted">по сравнению с {a}{d && ` · ${d.field === "qa_doc" ? "документ QA" : "исходник"}`}</span>
        <span className="flex-1" />
        {d && (
          <span className="flex gap-2 text-xs">
            {d.added > 0 && <span className="text-green-700 dark:text-green-400">+{d.added}</span>}
            {d.changed > 0 && <span className="text-amber-700 dark:text-amber-300">~{d.changed}</span>}
            {d.removed > 0 && <span className="text-red-600 dark:text-red-400">−{d.removed}</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border-main px-3 py-2 max-h-[360px] overflow-y-auto scrollbar-thin">
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          {!d && !err && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Сравниваю…</p>}
          {d && !d.items.length && <p className="text-sm text-text-muted">Отличий нет.</p>}
          {groups.map((g, gi) => (
            <div key={gi} className="py-1.5">
              <button type="button" onClick={() => onJump(g.section)} title="Показать это место в документе"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                <CornerDownRight className="w-3.5 h-3.5" /> {g.section || "Начало документа"}
              </button>
              <ul className="mt-1 space-y-1">
                {g.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] ${KIND[it.kind].cls}`}>{it.heading ? `${KIND[it.kind].label} раздел` : KIND[it.kind].label}</span>
                    <span className="min-w-0">
                      <span className={it.kind === "removed" ? "text-text-muted line-through" : "text-text-main"}>{it.text}</span>
                      {it.kind === "changed" && it.old && <span className="block text-xs text-text-muted">было: {it.old}</span>}
                      {it.kind === "removed" && it.was && it.was !== it.section && <span className="block text-xs text-text-muted">из раздела «{it.was}»</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
