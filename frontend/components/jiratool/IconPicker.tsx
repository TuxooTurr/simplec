"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Shuffle } from "lucide-react";
import { EMOJI_GROUPS, searchEmoji } from "@/lib/emoji";
import {
  ICON_COLORS, emojiCode, filterIcons, iconCode, lastIconColor, parseCellIcon, recentIcons,
  rememberIcon, rememberIconColor, useIcons,
} from "@/lib/cellIcon";

const W = 360;
const H = 400;
const PAGE = 240;

/**
 * Выбор ярлычка ячейки как иконки в Notion: вкладки «Иконки» (Lucide, с цветом) и «Эмодзи»,
 * фильтр, случайная иконка, недавние. Рисуется в body (fixed) — прокрутка таблицы и анимации окон
 * его не обрезают. Кнопки не забирают фокус (mousedown → preventDefault): поле остаётся в редактировании.
 */
export default function IconPicker({ anchor, value, boxRef, onPick, onClose }: {
  anchor: DOMRect;
  value?: string;
  boxRef: React.RefObject<HTMLDivElement | null>;
  /** code — новый ярлык; null — убрать. */
  onPick: (code: string | null) => void;
  onClose: () => void;
}) {
  const icons = useIcons();
  const current = parseCellIcon(value);
  const [tab, setTab] = useState<"icons" | "emoji">(current?.kind === "emoji" ? "emoji" : "icons");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState(() => (current?.kind === "icon" ? current.color : lastIconColor()));
  const [palette, setPalette] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const recent = useMemo(() => recentIcons(), []);
  const scroller = useRef<HTMLDivElement>(null);

  const names = useMemo(() => (icons ? Object.keys(icons) : []), [icons]);
  const foundIcons = useMemo(() => filterIcons(names, query), [names, query]);
  const foundEmoji = searchEmoji(query);
  useEffect(() => { setShown(PAGE); if (scroller.current) scroller.current.scrollTop = 0; }, [query, tab]);

  // Под полем, а если не влезает — над ним; по горизонтали не выходим за экран.
  const top = anchor.bottom + 4 + H > window.innerHeight ? Math.max(8, anchor.top - 4 - H) : anchor.bottom + 4;
  const left = Math.min(Math.max(8, anchor.right - W), window.innerWidth - W - 8);

  const pick = (code: string) => { rememberIcon(code); onPick(code); };
  const pickIcon = (name: string) => pick(iconCode(name, color));
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const chooseColor = (hex: string) => { setColor(hex); rememberIconColor(hex); setPalette(false); };
  const cell = "h-9 w-9 flex items-center justify-center rounded-md hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const iconStyle = { color: color || undefined };

  const iconGrid = (list: string[], prefix: string) => (
    <div className="grid grid-cols-9 gap-0.5">
      {list.map(n => {
        const I = icons?.[n];
        return I ? (
          <button key={prefix + n} type="button" onMouseDown={keep} onClick={() => pickIcon(n)} title={n} aria-label={`Иконка ${n}`} className={cell}>
            <I className="w-5 h-5 text-text-main" style={iconStyle} strokeWidth={2.2} />
          </button>
        ) : null;
      })}
    </div>
  );
  const emojiGrid = (list: string[], prefix: string) => (
    <div className="grid grid-cols-9 gap-0.5">
      {list.map(e => (
        <button key={prefix + e} type="button" onMouseDown={keep} onClick={() => pick(emojiCode(e))} aria-label={`Эмодзи ${e}`}
          className={`${cell} text-xl leading-none`}>{e}</button>
      ))}
    </div>
  );
  const recentIconNames = recent.filter(c => c.startsWith("i:")).map(c => c.slice(2)).filter(n => icons?.[n]);
  const recentEmoji = recent.filter(c => c.startsWith("e:")).map(c => c.slice(2));
  const heading = (t: string) => <p className="text-[11px] font-semibold text-text-muted mb-1">{t}</p>;
  const tabCls = (on: boolean) => `px-2 py-1 rounded-md text-sm ${on ? "text-text-main font-medium bg-bg-subtle" : "text-text-muted hover:text-text-main"}`;

  return createPortal(
    <div ref={boxRef} role="dialog" aria-label="Выбор ярлычка"
      style={{ position: "fixed", top, left, width: W, height: H, zIndex: 70 }}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      // Клик по пустому месту окна не должен уводить фокус из поля (иначе оно сохранится и закроется).
      onMouseDown={e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}
      className="flex flex-col rounded-xl border border-border-main bg-[var(--color-modal-bg)] shadow-xl animate-fade-in">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button type="button" onMouseDown={keep} onClick={() => setTab("icons")} className={tabCls(tab === "icons")}>Иконки</button>
        <button type="button" onMouseDown={keep} onClick={() => setTab("emoji")} className={tabCls(tab === "emoji")}>Эмодзи</button>
        {current && (
          <button type="button" onMouseDown={keep} onClick={() => onPick(null)}
            className="ml-auto px-2 py-1 rounded-md text-sm text-text-muted hover:text-red-500">Убрать</button>
        )}
      </div>

      <div className="relative flex items-center gap-1.5 p-2">
        <label className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--color-input-bg)] border border-border-main focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Фильтр…" aria-label="Фильтр ярлычков"
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (tab === "icons" && foundIcons[0]) pickIcon(foundIcons[0]);
              if (tab === "emoji" && foundEmoji[0]) pick(emojiCode(foundEmoji[0]));
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-text-main focus:outline-none" />
        </label>
        <button type="button" onMouseDown={keep} title="Случайный" aria-label="Случайный ярлычок"
          onClick={() => {
            if (tab === "icons" && names.length) pickIcon(names[Math.floor(Math.random() * names.length)]);
            if (tab === "emoji") { const all = EMOJI_GROUPS.flatMap(g => g.items); pick(emojiCode(all[Math.floor(Math.random() * all.length)][0])); }
          }}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-border-main text-text-muted hover:text-text-main hover:bg-bg-subtle">
          <Shuffle className="w-4 h-4" />
        </button>
        {tab === "icons" && (
          <button type="button" onMouseDown={keep} onClick={() => setPalette(p => !p)} title="Цвет" aria-label="Цвет иконки" aria-expanded={palette}
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border-main hover:bg-bg-subtle">
            <span className="w-4 h-4 rounded-full bg-text-main" style={color ? { backgroundColor: color } : undefined} />
          </button>
        )}
        {palette && tab === "icons" && (
          <div className="absolute right-2 top-full z-10 w-44 rounded-lg border border-border-main bg-[var(--color-modal-bg)] shadow-lg p-1">
            {ICON_COLORS.map(c => (
              <button key={c.id} type="button" onMouseDown={keep} onClick={() => chooseColor(c.hex)} aria-pressed={color === c.hex}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-text-main hover:bg-bg-subtle ${color === c.hex ? "bg-primary/10" : ""}`}>
                <span className="w-3.5 h-3.5 rounded-full bg-text-main" style={c.hex ? { backgroundColor: c.hex } : undefined} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-3"
        onScroll={e => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) setShown(n => n + PAGE);
        }}>
        {tab === "icons" ? (
          !icons ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю иконки…</p>
          ) : (
            <>
              {!query.trim() && recentIconNames.length > 0 && <section>{heading("Недавние")}{iconGrid(recentIconNames, "r")}</section>}
              <section>
                {heading(query.trim() ? `Найдено: ${foundIcons.length}` : "Иконки")}
                {foundIcons.length ? iconGrid(foundIcons.slice(0, shown), "a") : <p className="text-sm text-text-muted text-center py-6">Ничего не найдено</p>}
              </section>
            </>
          )
        ) : query.trim() ? (
          foundEmoji.length ? emojiGrid(foundEmoji, "s") : <p className="text-sm text-text-muted text-center py-6">Ничего не найдено</p>
        ) : (
          <>
            {recentEmoji.length > 0 && <section>{heading("Недавние")}{emojiGrid(recentEmoji, "r")}</section>}
            {EMOJI_GROUPS.map(g => <section key={g.id}>{heading(g.label)}{emojiGrid(g.items.map(([e]) => e), g.id)}</section>)}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
