"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui";
import {
  KIND_LABEL, VERSIONS,
  type ChangeKind, type Release, type ReleaseEntry, type ReleaseSection,
} from "@/lib/releaseNotes";

/* Метка типа изменения. Цвета семантические и не пересекаются с акцентом
   приложения: иначе «Новое» сливалось бы с обычными кнопками. */
const CHIP: Record<ChangeKind, string> = {
  new:      "bg-emerald-50 text-emerald-700 border-emerald-200 " +
            "dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  improved: "bg-blue-50 text-blue-700 border-blue-200 " +
            "dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  fixed:    "bg-amber-50 text-amber-700 border-amber-200 " +
            "dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
};

function Entry({ entry }: { entry: ReleaseEntry }) {
  return (
    <div className="border-t border-border-main pt-3.5 first:border-0 first:pt-0">
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold
          uppercase tracking-wide ${CHIP[entry.kind]}`}>
          {KIND_LABEL[entry.kind]}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <h4 className="text-sm font-semibold text-text-main">{entry.title}</h4>

          {entry.text && (
            <p className="text-[13px] leading-relaxed text-text-muted">{entry.text}</p>
          )}

          {/* «Было → стало» — самый быстрый способ показать смысл правки */}
          {entry.before && entry.after && (
            <div className="space-y-1.5">
              <p className="rounded-lg border border-border-main bg-bg-subtle px-2.5 py-1.5
                font-mono text-[11px] leading-relaxed text-text-muted line-through">
                {entry.before}
              </p>
              <p className="rounded-lg border border-primary/40 bg-[var(--color-active-bg)] px-2.5 py-1.5
                font-mono text-[11px] leading-relaxed text-text-main">
                {entry.after}
              </p>
            </div>
          )}

          {/* Длинный пример скроллится сам — страница вбок не едет */}
          {entry.sample && (
            <pre className="overflow-x-auto rounded-lg border border-border-main bg-bg-subtle
              px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-main">
              {entry.sample}
            </pre>
          )}

          {entry.points && (
            <ul className="space-y-1">
              {entry.points.map((p) => (
                <li key={p} className="relative pl-3.5 text-[13px] leading-relaxed text-text-muted">
                  <span className="absolute left-0 top-[0.55em] h-1 w-1 rounded-full bg-primary/60" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ section, index }: { section: ReleaseSection; index: number }) {
  return (
    <section className="space-y-3.5">
      <div className="space-y-0.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted/70">
          Раздел {String(index + 1).padStart(2, "0")}
        </p>
        <h3 className="text-base font-bold text-text-main">{section.area}</h3>
        <p className="text-xs text-text-muted">{section.subtitle}</p>
      </div>
      <div className="space-y-3.5">
        {section.entries.map((e) => <Entry key={e.title} entry={e} />)}
      </div>
    </section>
  );
}

/** Одна заметка версии: заголовок, суть и разделы. */
function ReleaseBlock({ release }: { release: Release }) {
  return (
    <article className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold leading-snug text-text-main text-balance">{release.title}</h2>
        <p className="text-[13px] leading-relaxed text-text-muted">{release.summary}</p>
      </div>
      <div className="space-y-7">
        {release.sections.map((s, i) => <Section key={`${s.area}-${s.subtitle}-${i}`} section={s} index={i} />)}
      </div>
    </article>
  );
}

/**
 * Окно «Что нового» — показывается при входе после релиза и по кнопке в меню.
 * Сверху — версии (свежая первой): чипами и стрелками можно пролистать прошлые и посмотреть, что в них сделали.
 */
export default function WhatsNewModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  // Открыли заново — снова с последней версии.
  useEffect(() => { if (open) setIdx(0); }, [open]);
  const v = VERSIONS[idx];
  if (!v) return null;
  const total = v.releases.reduce((n, r) => n + r.sections.reduce((m, s) => m + s.entries.length, 0), 0);
  const ARROW = "p-1.5 rounded-lg border border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle " +
    "disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <Modal open={open} onClose={onClose} title="Что нового" size="max-w-2xl">
      <div className="space-y-6">
        {/* Версии: стрелка влево — более ранняя, вправо — более новая */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setIdx(i => Math.min(VERSIONS.length - 1, i + 1))} disabled={idx >= VERSIONS.length - 1}
            aria-label="Предыдущая версия" title="Предыдущая версия" className={ARROW}>
            <ChevronLeft className="w-4 h-4" /></button>
          <div role="tablist" aria-label="Версии" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scrollbar-thin">
            {VERSIONS.map((x, i) => (
              <button key={x.version} type="button" role="tab" aria-selected={i === idx} onClick={() => setIdx(i)}
                title={x.date}
                className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${i === idx
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle"}`}>
                {x.version}{i === 0 && <span className="ml-1 font-sans font-normal">· новая</span>}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
            aria-label="Следующая версия" title="Следующая версия" className={ARROW}>
            <ChevronRight className="w-4 h-4" /></button>
        </div>

        {/* Шапка версии */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-2xl font-bold text-text-main">{v.version}</span>
          <span className="text-[13px] text-text-muted">{v.date}</span>
          <span className="text-[11px] text-text-muted tabular-nums">
            · {v.releases.length > 1 ? `${v.releases.length} обновления, ` : ""}{total} изменений
          </span>
        </div>

        <div className="space-y-8 border-t border-border-main pt-6">
          {v.releases.map((r, i) => (
            <div key={r.id} className={i ? "border-t border-dashed border-border-main pt-8" : ""}>
              <ReleaseBlock release={r} />
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t border-border-main pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white
              transition-colors hover:bg-primary-dark"
          >
            Понятно
          </button>
        </div>
      </div>
    </Modal>
  );
}
