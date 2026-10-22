"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookmarkPlus, Bookmark, ChevronDown, ListChecks, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import ColumnFilter from "@/components/jiratool/ColumnFilter";
import Floating from "@/components/jiratool/Floating";
import { DRAG_CASES, fmtDate, fmtDuration, type ZCase } from "@/lib/zephyrApi";
import {
  caseValues, colLabel, describeFilters, filterOptions, isCfCol, loadTemplates, passes, saveTemplates, sortCases,
  type CaseColId, type CaseFilters, type CaseSort, type FilterTemplate,
} from "@/lib/zephyrCaseFilter";
import { CaseStatus } from "./CaseBulk";

/** Строк в таблице за раз: модель целиком — тысячи кейсов; фильтры и сортировка работают по всем. */
const RENDER_LIMIT = 1000;

/* Ширины и закреплённые колонки — как в Jira tool: тянуть за край заголовка, булавка — колонка не уезжает вбок.
   Запоминаются в браузере (st_zephyr_col_widths, st_zephyr_pinned). Флажок и ключ закреплены всегда. */
const WIDTHS_KEY = "st_zephyr_col_widths";
const PINNED_KEY = "st_zephyr_pinned";
const SELECT_W = 36, KEY_W = 150, MIN_W = 60;
const defaultWidth = (c: CaseColId) => (c === "name" ? 480 : c === "folder" ? 220 : c === "labels" || c === "issueLinks" ? 180 : 140);
const EDGE = "shadow-[inset_-1px_0_0_0_var(--color-border-main,#e2e8f0)]";

function readJson<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); return v ?? fallback; } catch { return fallback; }
}
function writeJson(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* не запомнится */ }
}

/**
 * Список кейсов выбранной папки: сортировка по щелчку на заголовок и фильтр по значениям в заголовке каждой
 * колонки (как в Jira tool), шаблоны фильтров, панель действий с выбранными — над таблицей.
 * Фильтр работает на уровне выбранной папки: по кейсам, что сейчас в списке (с тумблером — и вложенных папок).
 */
export default function CaseTable({ cases, cols, folder, withChildren, text, checked, setChecked, caseKey, onOpen, onEdit, onDelete }: {
  cases: ZCase[];
  cols: CaseColId[];
  folder: string;
  withChildren: boolean;
  /** Поиск по названию (на сервере) — для текста пустого списка. */
  text: string;
  checked: Set<string>;
  setChecked: (fn: (prev: Set<string>) => Set<string>) => void;
  caseKey: string | null;
  onOpen: (key: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [filters, setFilters] = useState<CaseFilters>({});
  const [sort, setSort] = useState<CaseSort>(null);
  const [tpls, setTpls] = useState<FilterTemplate[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<CaseColId[]>([]);
  useEffect(() => {
    setTpls(loadTemplates());
    setWidths(readJson<Record<string, number>>(WIDTHS_KEY, {}));
    setPins(readJson<CaseColId[]>(PINNED_KEY, []));
  }, []);

  /* ── Ширина колонок: тянем за край заголовка (двойной щелчок — по умолчанию) ── */
  const [live, setLive] = useState<{ col: CaseColId; w: number } | null>(null);
  const resizing = useRef<{ col: CaseColId; x: number; w: number } | null>(null);
  const colW = (c: CaseColId) => (live?.col === c ? live.w : widths[c] ?? defaultWidth(c));
  const setWidth = (c: CaseColId, w: number | null) => setWidths(o => {
    const n = { ...o };
    if (w === null) delete n[c]; else n[c] = w;
    writeJson(WIDTHS_KEY, n);
    return n;
  });
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizing.current;
      if (r) setLive({ col: r.col, w: Math.max(MIN_W, Math.round(r.w + e.clientX - r.x)) });
    };
    const up = (e: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      resizing.current = null;
      setLive(null);
      setWidth(r.col, Math.max(MIN_W, Math.round(r.w + e.clientX - r.x)));
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Колонки после ключа: закреплённые — первыми (не уезжают при прокрутке вбок), дальше остальные.
  const rest = ["name", ...cols];
  const order = [...rest.filter(c => pins.includes(c)), ...rest.filter(c => !pins.includes(c))];
  const lastPinned = [...order].reverse().find(c => pins.includes(c));
  const leftOf = (c: CaseColId) => {
    let x = SELECT_W + KEY_W;
    for (const k of order) { if (k === c) break; if (pins.includes(k)) x += colW(k); }
    return x;
  };
  const togglePin = (c: CaseColId) => setPins(o => { const n = o.includes(c) ? o.filter(x => x !== c) : [...o, c]; writeJson(PINNED_KEY, n); return n; });
  const tableW = SELECT_W + KEY_W + order.reduce((n, c) => n + colW(c), 0);

  // Фильтр колонки, которую скрыли, не действует (как в Jira tool): иначе список «пропадает» без видимой причины.
  const shownCols = useMemo(() => ["key", "name", ...cols], [cols]);
  const active = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([c]) => shownCols.includes(c))), [filters, shownCols]);
  const filtered = useMemo(() => sortCases(cases.filter(c => passes(c, active)), sort), [cases, active, sort]);
  const rows = filtered.slice(0, RENDER_LIMIT);
  const nActive = Object.keys(active).length;

  // Отмечать можно только видимое по фильтру: иначе «Удалить» задело бы скрытые фильтром кейсы.
  useEffect(() => {
    const vis = new Set(filtered.map(c => c.key));
    setChecked(prev => (prev.size && [...prev].some(k => !vis.has(k)) ? new Set([...prev].filter(k => vis.has(k))) : prev));
  }, [filtered]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (col: CaseColId, values: string[] | null) => setFilters(f => {
    const n = { ...f };
    if (values === null) delete n[col]; else n[col] = values;
    return n;
  });
  const cycleSort = (col: CaseColId) => setSort(s => (s?.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));
  const allOn = filtered.length > 0 && filtered.every(c => checked.has(c.key));

  const head = (col: CaseColId) => {
    const pinned = col === "key" || pins.includes(col);
    const style: React.CSSProperties | undefined = col === "key" ? { position: "sticky", left: SELECT_W, zIndex: 3 }
      : pinned ? { position: "sticky", left: leftOf(col), zIndex: 3 } : undefined;
    return (
      <th key={col} style={style}
        className={`group/th relative text-left px-3 py-2 bg-bg-card ${col === (lastPinned ?? "key") ? EDGE : ""}`}>
        <span className="flex items-center gap-0.5 min-w-0">
          <button type="button" onClick={() => cycleSort(col)} title="Сортировать: по возрастанию → по убыванию → без сортировки"
            className={`flex items-center gap-1 min-w-0 uppercase tracking-wide hover:text-text-main ${sort?.col === col ? "text-primary" : ""}`}>
            <span className="truncate">{colLabel(col)}</span>
            {sort?.col === col && (sort.dir === 1 ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />)}
          </button>
          {col !== "key" && (
            <button type="button" onClick={() => togglePin(col)} aria-pressed={pins.includes(col)}
              aria-label={pins.includes(col) ? `Открепить колонку ${colLabel(col)}` : `Закрепить колонку ${colLabel(col)}`}
              title={pins.includes(col) ? "Открепить" : "Закрепить: колонка не уедет при прокрутке вбок"}
              className={`ml-0.5 p-0.5 rounded flex-shrink-0 ${pins.includes(col) ? "text-primary" : "text-text-muted opacity-0 group-hover/th:opacity-100 hover:text-text-main"}`}>
              {pins.includes(col) ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}
          <ColumnFilter label={colLabel(col)} active={col in active} selected={active[col] ?? []}
            options={() => filterOptions(cases, col, active)} onChange={v => setFilter(col, v)} />
        </span>
        {col !== "key" && (
          // Край для изменения ширины; двойной щелчок — стандартная ширина.
          <span role="separator" aria-orientation="vertical" aria-label={`Ширина колонки ${colLabel(col)}`}
            title="Тяните — ширина колонки; двойной щелчок — по умолчанию"
            onMouseDown={e => {
              e.preventDefault(); e.stopPropagation();
              resizing.current = { col, x: e.clientX, w: colW(col) };
              setLive({ col, w: colW(col) });
              document.body.style.cursor = "col-resize";
            }}
            onDoubleClick={e => { e.stopPropagation(); setWidth(col, null); }}
            className="group/rs absolute top-0 right-0 h-full w-3 cursor-col-resize flex justify-end">
            <span aria-hidden className={`my-1.5 rounded-full transition-all ${live?.col === col
              ? "w-[3px] bg-primary" : "w-px bg-text-muted/40 group-hover/rs:w-[3px] group-hover/rs:bg-primary/70"}`} />
          </span>
        )}
      </th>
    );
  };

  const cell = (c: ZCase, col: CaseColId) => {
    if (col === "status") return <CaseStatus status={c.status} />;
    if (col === "duration") return <span className="whitespace-nowrap tabular-nums">{fmtDuration(c.estimatedTime)}</span>;
    if (col === "updated") return <span className="text-xs text-text-muted whitespace-nowrap">{c.updated ? fmtDate(c.updated) : "—"}</span>;
    if (col === "folder") return <span className="block truncate text-xs text-text-muted" title={c.folder}>{c.folder || "—"}</span>;
    if (col === "name") {
      return (
        <>
          <span className="block truncate text-text-main" title={c.name}>{c.name}</span>
          {(!folder || (withChildren && c.folder !== folder)) && c.folder && !cols.includes("folder") && (
            <span className="block text-[11px] text-text-muted truncate">{folder && c.folder.startsWith(folder + "/") ? `…${c.folder.slice(folder.length)}` : c.folder}</span>
          )}
        </>
      );
    }
    const v = caseValues(c, col);
    return <span className={`block truncate ${isCfCol(col) || col === "labels" || col === "issueLinks" ? "text-xs" : ""} ${v.length ? "text-text-main" : "text-text-muted"}`}
      title={v.join(", ")}>{v.join(", ") || "—"}</span>;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Над таблицей: фильтры и шаблоны; с выбранными кейсами — действия (как панель выбора в Jira tool) */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border-main min-h-[44px]">
        {checked.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 w-full px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 animate-fade-in [&_button]:whitespace-nowrap">
            <ListChecks className="w-4 h-4 text-primary" />
            <span className="text-sm text-text-main">Выбрано: <b>{checked.size}</b></span>
            <button type="button" onClick={onEdit}
              className="ml-2 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90">
              <Pencil className="w-3.5 h-3.5" /> Изменить</button>
            <button type="button" onClick={onDelete}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-900 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40">
              <Trash2 className="w-3.5 h-3.5" /> Удалить</button>
            <span className="text-xs text-text-muted">или перетащите на папку в дереве</span>
            <button type="button" onClick={() => setChecked(() => new Set())} className="ml-auto text-xs text-text-muted hover:text-text-main underline">Снять выбор</button>
          </div>
        ) : (
          <>
            <span className="text-xs text-text-muted">
              {nActive ? <>Фильтр: <span className="text-text-main" title={describeFilters(active)}>{Object.keys(active).map(colLabel).join(", ")}</span> · кейсов {filtered.length} из {cases.length}</>
                : <>Кейсов: {cases.length}{sort ? ` · сортировка: ${colLabel(sort.col)}` : ""} · фильтр — значок в заголовке колонки</>}
            </span>
            {(nActive > 0 || sort) && (
              <button type="button" onClick={() => { setFilters({}); setSort(null); }} className="flex items-center gap-0.5 text-xs text-primary hover:underline">
                <X className="w-3 h-3" /> Сбросить</button>
            )}
            <span className="ml-auto" />
            <TemplatesMenu tpls={tpls} canSave={nActive > 0 || !!sort}
              onApply={t => { setFilters(t.filters); setSort(t.sort); }}
              onSave={name => { const n = [...tpls, { id: `ft${Date.now().toString(36)}`, name, filters: active, sort }]; setTpls(n); saveTemplates(n); }}
              onDelete={id => { const n = tpls.filter(t => t.id !== id); setTpls(n); saveTemplates(n); }} />
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {/* Ширины — фиксированные (тянутся мышью), последняя пустая колонка забирает остаток места */}
        <table className="text-sm table-fixed" style={{ width: "100%", minWidth: tableW }}>
          <colgroup>
            <col style={{ width: SELECT_W }} /><col style={{ width: KEY_W }} />
            {order.map(c => <col key={c} style={{ width: colW(c) }} />)}
            <col />
          </colgroup>
          <thead className="sticky top-0 z-[4] bg-bg-card text-[11px] text-text-muted">
            <tr>
              <th className="pl-3 bg-bg-card" style={{ position: "sticky", left: 0, zIndex: 3 }} title="Отметить все кейсы по фильтру">
                <input type="checkbox" aria-label="Выбрать все кейсы по фильтру" checked={allOn}
                  onChange={e => setChecked(() => (e.target.checked ? new Set(filtered.map(c => c.key)) : new Set()))} /></th>
              {head("key")}
              {order.map(c => head(c))}
              <th className="bg-bg-card" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={order.length + 3} className="px-4 py-6 text-left text-text-muted">
                {nActive ? "По фильтру кейсов нет." : text ? `По «${text}» кейсов нет.` : folder
                  ? (withChildren ? "В этой папке и вложенных кейсов нет." : "В этой папке кейсов нет. Кейсы вложенных папок — включите «Кейсы вложенных папок» над деревом.")
                  : "Кейсов нет."}</td></tr>
            )}
            {rows.map(c => {
              const on = caseKey === c.key || checked.has(c.key);
              // Закреплённые ячейки — непрозрачные (под ними уезжает остальное), цвет — как у строки.
              const bg = on ? "bg-[var(--color-active-bg)]" : "bg-bg-card group-hover/row:bg-bg-subtle";
              return (
                <tr key={c.key} onClick={() => onOpen(c.key)} aria-selected={caseKey === c.key}
                  // Перетащить на папку дерева: отмеченные кейсы (если строка среди них) или только эту строку.
                  draggable onDragStart={e => {
                    const keys = checked.has(c.key) ? [...checked] : [c.key];
                    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(DRAG_CASES, JSON.stringify(keys)); e.dataTransfer.setData("text/plain", keys.join(", "));
                  }}
                  title="Перетащите на папку в дереве, чтобы перенести"
                  className={`group/row border-t border-border-main cursor-pointer ${on ? "bg-[var(--color-active-bg)]" : "hover:bg-bg-subtle"}`}>
                  <td className={`pl-3 ${bg}`} style={{ position: "sticky", left: 0, zIndex: 2 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Выбрать ${c.key}`} checked={checked.has(c.key)}
                      onChange={() => setChecked(o => { const n = new Set(o); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} /></td>
                  <td className={`px-3 py-1.5 font-mono text-xs text-primary whitespace-nowrap ${bg} ${lastPinned ? "" : EDGE}`}
                    style={{ position: "sticky", left: SELECT_W, zIndex: 2 }}>{c.key}</td>
                  {order.map(col => (
                    <td key={col} className={`px-3 py-1.5 overflow-hidden ${pins.includes(col) ? bg : ""} ${col === lastPinned ? EDGE : ""}`}
                      style={pins.includes(col) ? { position: "sticky", left: leftOf(col), zIndex: 2 } : undefined}>{cell(c, col)}</td>
                  ))}
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > rows.length && (
          <p className="px-4 py-2 text-xs text-text-muted">Показаны первые {rows.length} из {filtered.length} — уточните фильтром.
            «Выбрать все» отмечает все {filtered.length}.</p>
        )}
      </div>
    </div>
  );
}

/** Шаблоны фильтров: применить, сохранить текущий набор фильтров и сортировку под именем, удалить. */
function TemplatesMenu({ tpls, canSave, onApply, onSave, onDelete }: {
  tpls: FilterTemplate[]; canSave: boolean;
  onApply: (t: FilterTemplate) => void; onSave: (name: string) => void; onDelete: (id: string) => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const save = () => { if (!name.trim()) return; onSave(name.trim()); setName(""); };
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Шаблоны фильтров: применить к выбранной папке или сохранить текущий"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle whitespace-nowrap">
        <Bookmark className="w-3.5 h-3.5" /> Шаблоны фильтров{tpls.length ? ` · ${tpls.length}` : ""} <ChevronDown className="w-3 h-3 text-text-muted" /></button>
      {open && (
        <Floating anchor={btn} onClose={() => setOpen(false)} width={340} role="dialog" ariaLabel="Шаблоны фильтров" className="p-1.5 space-y-1.5">
          {tpls.length === 0 && <p className="px-1.5 py-1 text-xs text-text-muted">Шаблонов пока нет. Настройте фильтры в заголовках колонок и сохраните.</p>}
          {tpls.length > 0 && (
            <ul className="max-h-64 overflow-y-auto scrollbar-thin">
              {tpls.map(t => (
                <li key={t.id} className="group flex items-start gap-1 rounded hover:bg-bg-subtle">
                  <button type="button" onClick={() => { onApply(t); setOpen(false); }} className="min-w-0 flex-1 text-left px-2 py-1.5"
                    title="Применить к выбранной папке">
                    <span className="block text-sm text-text-main truncate">{t.name}</span>
                    <span className="block text-[11px] text-text-muted truncate">
                      {describeFilters(t.filters) || "без фильтров"}{t.sort ? ` · сортировка: ${colLabel(t.sort.col)} ${t.sort.dir === 1 ? "↑" : "↓"}` : ""}</span>
                  </button>
                  <button type="button" onClick={() => onDelete(t.id)} aria-label={`Удалить шаблон ${t.name}`}
                    className="p-1.5 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5 border-t border-border-main pt-1.5">
            <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} maxLength={60}
              disabled={!canSave} placeholder={canSave ? "Название шаблона" : "Сначала задайте фильтр или сортировку"} aria-label="Название шаблона"
              className="min-w-0 flex-1 text-sm px-2 py-1 rounded border border-border-main bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
            <button type="button" onClick={save} disabled={!canSave || !name.trim()} title="Сохранить текущие фильтры и сортировку"
              className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-white text-xs font-semibold disabled:opacity-40">
              <BookmarkPlus className="w-3.5 h-3.5" /> Сохранить</button>
          </div>
        </Floating>
      )}
    </>
  );
}
