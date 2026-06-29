"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight, FlaskConical, FolderTree, HelpCircle, Search, Tag as TagIcon, X,
} from "lucide-react";
import type { TestTreeClass } from "@/lib/autotestRunsApi";

/* ── Tri-state checkbox ──────────────────────────────────────────── */
function TriCheckbox({
  state,
  onChange,
  label,
}: {
  state: "on" | "off" | "mixed";
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "on"}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="h-4 w-4 shrink-0 rounded border-border-main text-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    />
  );
}

function TagBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
      <TagIcon className="h-2.5 w-2.5" />
      {value}
    </span>
  );
}

/* ── Component ───────────────────────────────────────────────────── */
export interface TestTreeProps {
  classes: TestTreeClass[];
  allTags: string[];
  total: number;
  /** selected test method ids (pkg.Class#method) */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export default function TestTree({ classes, allTags, total, selected, onChange }: TestTreeProps) {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const InfoButton = ({ id }: { id: string }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpenInfo(openInfo === id ? null : id); }}
      aria-label="Показать настоящее имя и путь"
      title="Настоящее имя и путь"
      className={`flex-shrink-0 rounded p-0.5 transition-colors ${
        openInfo === id ? "text-primary bg-primary/10" : "text-text-muted/40 hover:text-text-muted hover:bg-bg-muted"
      }`}
    >
      <HelpCircle className="h-3 w-3" />
    </button>
  );

  const InfoPanel = ({ rows }: { rows: Array<[string, string]> }) => (
    <div className="ml-9 mb-1 rounded-md border border-border-main bg-bg-subtle px-2.5 py-1.5 text-[11px] text-text-muted">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <span className="flex-shrink-0">{k}:</span>
          <span className="font-mono text-text-main break-all">{v}</span>
        </div>
      ))}
    </div>
  );

  const q = query.trim().toLowerCase();
  const searching = q.length > 0 || activeTags.size > 0;

  const methodMatches = (cls: TestTreeClass, m: TestTreeClass["methods"][number]) => {
    const tagOk =
      activeTags.size === 0 ||
      m.tags.some((t) => activeTags.has(t)) ||
      cls.tags.some((t) => activeTags.has(t));
    if (!tagOk) return false;
    if (!q) return true;
    return (
      m.display.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      cls.display.toLowerCase().includes(q) ||
      cls.name.toLowerCase().includes(q)
    );
  };

  // package -> [{ class, methods(filtered) }]
  const groups = useMemo(() => {
    const map = new Map<string, Array<{ cls: TestTreeClass; methods: TestTreeClass["methods"] }>>();
    for (const cls of classes) {
      const methods = cls.methods.filter((m) => methodMatches(cls, m));
      if (methods.length === 0) continue;
      const pkg = cls.package || "(без пакета)";
      if (!map.has(pkg)) map.set(pkg, []);
      map.get(pkg)!.push({ cls, methods });
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [classes, q, activeTags]);

  const visibleMethodIds = useMemo(
    () => groups.flatMap(([, items]) => items.flatMap((i) => i.methods.map((m) => m.id))),
    [groups],
  );
  const visibleSelectedCount = visibleMethodIds.filter((id) => selected.has(id)).length;

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    onChange(next);
  };

  const classState = (methods: TestTreeClass["methods"]): "on" | "off" | "mixed" => {
    const sel = methods.filter((m) => selected.has(m.id)).length;
    if (sel === 0) return "off";
    if (sel === methods.length) return "on";
    return "mixed";
  };

  const toggleTag = (tag: string) => {
    const next = new Set(activeTags);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    setActiveTags(next);
  };

  const isCollapsed = (key: string) => (searching ? false : collapsed.has(key));
  const toggleCollapsed = (key: string) => {
    const next = new Set(collapsed);
    next.has(key) ? next.delete(key) : next.add(key);
    setCollapsed(next);
  };

  return (
    <div className="rounded-xl border border-border-main bg-bg-card">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-border-main p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию теста или классу…"
              className="w-full rounded-lg border border-border-main bg-[var(--color-input-bg)] py-1.5 pl-8 pr-8 text-sm text-text-main
                placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:text-text-main"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs font-medium text-text-muted whitespace-nowrap">
            Выбрано <span className="text-primary font-semibold tabular-nums">{selected.size}</span> из {total}
          </span>
          <button
            type="button"
            onClick={() => setMany(visibleMethodIds, true)}
            className="rounded-lg border border-border-main px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle"
          >
            Выбрать всё{searching ? " (по фильтру)" : ""}
          </button>
          <button
            type="button"
            onClick={() => setMany(visibleMethodIds, false)}
            disabled={visibleSelectedCount === 0}
            className="rounded-lg border border-border-main px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-40"
          >
            Снять
          </button>
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Теги:</span>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  activeTags.has(tag)
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border-main text-text-muted hover:bg-bg-subtle"
                }`}
              >
                {tag}
              </button>
            ))}
            {activeTags.size > 0 && (
              <button
                type="button"
                onClick={() => setActiveTags(new Set())}
                className="text-[11px] text-text-muted hover:text-text-main underline"
              >
                сбросить
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tree */}
      <div className="max-h-[420px] overflow-y-auto scrollbar-thin p-2">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-text-muted">
            <FlaskConical className="h-7 w-7 opacity-30" />
            <p className="text-sm">Ничего не найдено по текущему фильтру</p>
          </div>
        ) : (
          groups.map(([pkg, items]) => {
            const pkgMethodIds = items.flatMap((i) => i.methods.map((m) => m.id));
            const pkgSel = pkgMethodIds.filter((id) => selected.has(id)).length;
            const pkgState: "on" | "off" | "mixed" =
              pkgSel === 0 ? "off" : pkgSel === pkgMethodIds.length ? "on" : "mixed";
            const pkgCollapsed = isCollapsed(`pkg:${pkg}`);
            return (
              <div key={pkg} className="mb-1">
                {/* package row */}
                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg-subtle/60">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(`pkg:${pkg}`)}
                    className="text-text-muted"
                    aria-label={pkgCollapsed ? "Развернуть пакет" : "Свернуть пакет"}
                  >
                    <ChevronRight className={`h-4 w-4 transition-transform ${pkgCollapsed ? "" : "rotate-90"}`} />
                  </button>
                  <TriCheckbox state={pkgState} onChange={() => setMany(pkgMethodIds, pkgState !== "on")} label={`Пакет ${pkg}`} />
                  <FolderTree className="h-3.5 w-3.5 text-text-muted" />
                  <span className="truncate font-mono text-xs text-text-muted">{pkg}</span>
                  <span className="ml-auto text-[10px] text-text-muted tabular-nums">{pkgMethodIds.length}</span>
                </div>

                {!pkgCollapsed && items.map(({ cls, methods }) => {
                  const clsState = classState(methods);
                  const clsMethodIds = methods.map((m) => m.id);
                  const clsCollapsed = isCollapsed(`cls:${cls.id}`);
                  return (
                    <div key={cls.id} className="ml-5">
                      {/* class row */}
                      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg-subtle/60">
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(`cls:${cls.id}`)}
                          className="text-text-muted"
                          aria-label={clsCollapsed ? "Развернуть класс" : "Свернуть класс"}
                        >
                          <ChevronRight className={`h-4 w-4 transition-transform ${clsCollapsed ? "" : "rotate-90"}`} />
                        </button>
                        <TriCheckbox state={clsState} onChange={() => setMany(clsMethodIds, clsState !== "on")} label={`Группа ${cls.label || cls.display}`} />
                        <span className="truncate text-sm font-medium text-text-main">{cls.label || cls.display}</span>
                        <InfoButton id={cls.id} />
                        {cls.tags.map((t) => <TagBadge key={t} value={t} />)}
                        <span className="ml-auto text-[10px] text-text-muted tabular-nums">{methods.length}</span>
                      </div>
                      {openInfo === cls.id && (
                        <InfoPanel rows={[
                          ["Настоящее имя", cls.name],
                          ["Пакет", cls.package || "—"],
                          ["Файл", cls.file],
                        ]} />
                      )}

                      {!clsCollapsed && (
                        <div className="ml-7 border-l border-border-main">
                          {methods.map((m) => {
                            const on = selected.has(m.id);
                            return (
                              <div key={m.id}>
                                <label className="flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 hover:bg-bg-subtle/60">
                                  <TriCheckbox
                                    state={on ? "on" : "off"}
                                    onChange={() => setMany([m.id], !on)}
                                    label={m.label || m.display}
                                  />
                                  <span className={`truncate text-sm ${on ? "text-text-main" : "text-text-muted"}`}>{m.label || m.display}</span>
                                  <InfoButton id={m.id} />
                                  {m.tags.map((t) => <TagBadge key={t} value={t} />)}
                                </label>
                                {openInfo === m.id && (
                                  <InfoPanel rows={[
                                    ["Настоящее имя", m.name],
                                    ["Путь", `${cls.file} · ${m.id}`],
                                  ]} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
