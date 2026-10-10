"use client";

import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  EMOJIS, POPULAR_ICONS, TILE_COLORS, iconWords, parseIcon, useLucideIcons, type TileColor,
} from "@/lib/tileStyle";

const PAGE = 240;   // столько иконок рисуем за раз — вся библиотека ~1700

/** Выбор иконки как в Notion: вкладки «Иконки» и «Эмодзи», поиск, цвет. */
export default function IconPicker({ icon, color, onIcon, onColor }: {
  icon?: string;
  color: TileColor;
  onIcon: (icon: string) => void;
  onColor: (color: TileColor) => void;
}) {
  const [tab, setTab] = useState<"icons" | "emoji">(parseIcon(icon)?.kind === "emoji" ? "emoji" : "icons");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [custom, setCustom] = useState("");
  const icons = useLucideIcons(true);
  const q = query.trim().toLowerCase();
  const current = parseIcon(icon);

  // Сначала популярные (ищутся и по-русски), затем вся библиотека по английскому имени.
  const iconList = useMemo(() => {
    if (!icons) return [];
    const popular = POPULAR_ICONS.filter(([n, ru]) => icons[n] && (!q || ru.includes(q) || iconWords(n).includes(q)))
      .map(([n]) => n);
    const seen = new Set(popular);
    const rest = Object.keys(icons).filter(n => !seen.has(n) && (!q || iconWords(n).includes(q) || n.toLowerCase().includes(q)));
    return [...popular, ...rest];
  }, [icons, q]);

  const emojiList = useMemo(() => EMOJIS.filter(([e, ru]) => !q || ru.includes(q) || e === q), [q]);

  const tabCls = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${on ? "bg-bg-subtle text-text-main" : "text-text-muted hover:text-text-main"}`;

  return (
    <div className="rounded-xl border border-border-main bg-bg-card p-3 space-y-2.5">
      <div className="flex items-center gap-1" role="tablist" aria-label="Вид иконки">
        <button type="button" role="tab" aria-selected={tab === "icons"} onClick={() => setTab("icons")} className={tabCls(tab === "icons")}>Иконки</button>
        <button type="button" role="tab" aria-selected={tab === "emoji"} onClick={() => setTab("emoji")} className={tabCls(tab === "emoji")}>Эмодзи</button>
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-2.5 py-1.5
        focus-within:ring-2 focus-within:ring-primary/30">
        <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <input value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} autoFocus
          placeholder={tab === "icons" ? "Поиск: график, база, rocket…" : "Поиск: алерт, ракета…"}
          aria-label="Поиск иконки" className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
      </label>

      {tab === "icons" && (
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Цвет">
          {(Object.keys(TILE_COLORS) as TileColor[]).map(c => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={TILE_COLORS[c].label}
              title={TILE_COLORS[c].label} onClick={() => onColor(c)}
              className={`w-5 h-5 rounded-full ${TILE_COLORS[c].swatch} transition-transform hover:scale-110
                ${color === c ? "ring-2 ring-offset-2 ring-primary ring-offset-[var(--color-modal-bg)]" : ""}`} />
          ))}
        </div>
      )}

      <div className="h-56 overflow-y-auto scrollbar-thin -mx-1 px-1">
        {tab === "icons" ? (
          !icons ? (
            <div className="h-full flex items-center justify-center gap-2 text-xs text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Загружаю библиотеку иконок…
            </div>
          ) : iconList.length === 0 ? (
            <p className="text-xs text-text-muted p-2">Ничего не нашлось. Библиотека Lucide на английском — попробуйте «chart», «user», «server».</p>
          ) : (
            <>
              <div className="grid grid-cols-10 gap-0.5">
                {iconList.slice(0, limit).map(n => {
                  const I = icons[n];
                  const on = current?.kind === "lucide" && current.name === n;
                  return (
                    <button key={n} type="button" title={n} aria-label={n} aria-pressed={on} onClick={() => onIcon(`lucide:${n}`)}
                      className={`aspect-square flex items-center justify-center rounded-md transition-colors
                        ${on ? "bg-primary/15 text-primary" : "text-text-muted hover:bg-bg-subtle hover:text-text-main"}`}>
                      <I className="w-[18px] h-[18px]" />
                    </button>
                  );
                })}
              </div>
              {iconList.length > limit && (
                <button type="button" onClick={() => setLimit(l => l + PAGE * 2)}
                  className="mt-2 w-full text-xs text-primary hover:underline">
                  Показать ещё ({iconList.length - limit})
                </button>
              )}
            </>
          )
        ) : (
          <div className="grid grid-cols-10 gap-0.5">
            {emojiList.map(([e, ru]) => {
              const on = current?.kind === "emoji" && current.value === e;
              return (
                <button key={e} type="button" title={ru} aria-label={ru} aria-pressed={on} onClick={() => onIcon(`emoji:${e}`)}
                  className={`aspect-square flex items-center justify-center rounded-md text-xl transition-colors
                    ${on ? "bg-primary/15" : "hover:bg-bg-subtle"}`}>
                  {e}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {tab === "emoji" && (
        <div className="flex items-center gap-2">
          <input value={custom} onChange={e => setCustom(e.target.value)} maxLength={16}
            placeholder="Свой эмодзи: вставьте сюда" aria-label="Свой эмодзи"
            className="flex-1 min-w-0 text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)]
              text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <button type="button" disabled={!custom.trim()} onClick={() => onIcon(`emoji:${custom.trim()}`)}
            className="px-2.5 py-1.5 rounded-lg border border-border-main text-xs text-text-main hover:bg-bg-subtle disabled:opacity-40">
            Взять
          </button>
        </div>
      )}
    </div>
  );
}
