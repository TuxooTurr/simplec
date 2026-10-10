"use client";

import { useState, type ComponentType } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { HubTileStyle } from "@/lib/api";
import { TILE_COLORS, type TileColor } from "@/lib/tileStyle";
import IconPicker from "./IconPicker";
import TileGlyph from "./TileGlyph";

export interface TileDefaults {
  title: string;
  subtitle: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  color: TileColor;
}

/**
 * Окно оформления плитки: название, подсказка, иконка, цвет. Пустое поле —
 * стандартное значение. Слева — предпросмотр плитки как она будет выглядеть.
 */
export default function TileEditor({ open, defaults, style, titleRequired, onSave, onReset, onClose }: {
  open: boolean;
  defaults: TileDefaults;
  style: HubTileStyle;
  /** У папки алертов название обязательно — это имя самой папки. */
  titleRequired?: boolean;
  onSave: (style: HubTileStyle) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(style.title ?? (titleRequired ? defaults.title : ""));
  const [subtitle, setSubtitle] = useState(style.subtitle ?? "");
  const [icon, setIcon] = useState(style.icon ?? "");
  const [color, setColor] = useState<TileColor>((style.color as TileColor) in TILE_COLORS ? style.color as TileColor : defaults.color);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr("");
    try { await fn(); onClose(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const save = () => run(() => onSave({
    title: title.trim(), subtitle: subtitle.trim(), icon,
    color: color === defaults.color ? "" : color,
  }));

  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={onClose} title="Оформление плитки" size="max-w-3xl">
      <div className="flex gap-6">
        {/* Предпросмотр */}
        <div className="w-60 flex-shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Так будет выглядеть</p>
          <div className="bg-bg-card border border-border-main rounded-xl p-5">
            <TileGlyph icon={icon} color={color} fallbackIcon={defaults.Icon} fallbackColor={defaults.color} />
            <h3 className="text-sm font-semibold text-text-main mb-1 break-words">{title.trim() || defaults.title}</h3>
            <p className="text-xs text-text-muted leading-relaxed break-words">{subtitle.trim() || defaults.subtitle}</p>
          </div>
        </div>

        {/* Поля */}
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <label htmlFor="tile-title" className="block text-xs font-semibold text-text-muted mb-1.5">Название</label>
            <input id="tile-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={80}
              placeholder={defaults.title} className={field} />
          </div>
          <div>
            <label htmlFor="tile-subtitle" className="block text-xs font-semibold text-text-muted mb-1.5">Подсказка</label>
            <textarea id="tile-subtitle" value={subtitle} onChange={e => setSubtitle(e.target.value)} maxLength={300} rows={2}
              placeholder={defaults.subtitle} className={`${field} resize-none`} />
          </div>
          <div>
            <span className="block text-xs font-semibold text-text-muted mb-1.5">Иконка</span>
            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={() => setPicker(p => !p)} aria-expanded={picker}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-main hover:bg-bg-subtle text-sm text-text-main">
                <TileGlyph icon={icon} color={color} fallbackIcon={defaults.Icon} fallbackColor={defaults.color} size="inline" />
                {picker ? "Скрыть выбор" : "Выбрать иконку"}
                <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${picker ? "rotate-180" : ""}`} />
              </button>
              {icon && (
                <button type="button" onClick={() => setIcon("")} className="text-xs text-text-muted hover:text-text-main">
                  Стандартная
                </button>
              )}
            </div>
            {picker && <IconPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />}
          </div>

          {err && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">{err}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => run(onReset)} disabled={busy}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /> Вернуть стандартное оформление
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">
                Отмена
              </button>
              <button type="button" onClick={save} disabled={busy || (titleRequired && !title.trim())}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                {busy ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
