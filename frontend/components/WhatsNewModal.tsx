"use client";

import { Modal } from "@/components/ui";
import {
  KIND_LABEL, LATEST_RELEASE,
  type ChangeKind, type ReleaseEntry, type ReleaseSection,
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

/** Окно «Что нового» — показывается при входе после релиза и по кнопке в меню. */
export default function WhatsNewModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  const release = LATEST_RELEASE;
  const total = release.sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <Modal open={open} onClose={onClose} title="Что нового" size="max-w-2xl">
      <div className="space-y-6">
        {/* Шапка релиза */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[11px]
              font-semibold text-primary">
              {release.date}
            </span>
            <span className="text-[11px] text-text-muted tabular-nums">
              {total} изменений в {release.sections.length} разделах
            </span>
          </div>
          <h2 className="text-lg font-bold leading-snug text-text-main text-balance">
            {release.title}
          </h2>
          <p className="text-[13px] leading-relaxed text-text-muted">{release.summary}</p>
        </div>

        <div className="space-y-7 border-t border-border-main pt-6">
          {release.sections.map((s, i) => <Section key={s.area} section={s} index={i} />)}
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
