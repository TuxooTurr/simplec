/**
 * Ярлычок ячейки своего текстового поля — как иконка страницы в Notion: цветная иконка или эмодзи.
 * Хранится строкой рядом со значением (TaskList.icons), текст ячейки не трогает:
 *   «i:Bug:#2563eb» — иконка Lucide (имя как в lucide-react) и цвет; «e:🐞» — эмодзи.
 *
 * Набор иконок (~1700) подгружается отдельным куском и один раз: основная страница его не тянет.
 */

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type CellIcon = { kind: "icon"; name: string; color: string } | { kind: "emoji"; emoji: string };

export function parseCellIcon(code: string | undefined): CellIcon | null {
  if (!code) return null;
  if (code.startsWith("e:")) return code.length > 2 ? { kind: "emoji", emoji: code.slice(2) } : null;
  if (code.startsWith("i:")) {
    const [, name, color] = code.split(":");
    return name ? { kind: "icon", name, color: color || "" } : null;
  }
  return null;
}

export const iconCode = (name: string, color: string) => `i:${name}:${color}`;
export const emojiCode = (emoji: string) => `e:${emoji}`;

/** Цвета как в Notion; пустая строка — цвет текста (подстраивается под тему). */
export const ICON_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "default", label: "Обычный", hex: "" },
  { id: "gray",    label: "Серый",      hex: "#8a8f98" },
  { id: "brown",   label: "Коричневый", hex: "#a27763" },
  { id: "orange",  label: "Оранжевый",  hex: "#e07c39" },
  { id: "yellow",  label: "Жёлтый",     hex: "#d9a631" },
  { id: "green",   label: "Зелёный",    hex: "#4b9a6b" },
  { id: "blue",    label: "Синий",      hex: "#3b82f6" },
  { id: "purple",  label: "Фиолетовый", hex: "#9d6ad3" },
  { id: "pink",    label: "Розовый",    hex: "#d6589f" },
  { id: "red",     label: "Красный",    hex: "#e5534b" },
];

type IconMap = Record<string, LucideIcon>;
let cache: IconMap | null = null;
let pending: Promise<IconMap> | null = null;

function loadIcons(): Promise<IconMap> {
  if (cache) return Promise.resolve(cache);
  pending ??= import("lucide-react").then(m => (cache = m.icons as IconMap));
  return pending;
}

/** Все иконки (null — ещё грузятся). */
export function useIcons(): IconMap | null {
  const [map, setMap] = useState<IconMap | null>(cache);
  useEffect(() => {
    if (!map) void loadIcons().then(setMap);
  }, [map]);
  return map;
}

/** Русские слова → английские части имён иконок: фильтр понимает «баг», «готово», «релиз». */
const RU_WORDS: Record<string, string[]> = {
  баг: ["bug"], жук: ["bug"], дефект: ["bug"], ошибка: ["circle-x", "octagon-x", "bug", "triangle-alert"],
  готово: ["check", "badge-check"], галочка: ["check"], сделано: ["check"], ок: ["check", "thumbs-up"],
  нет: ["x", "ban"], крест: ["x"], запрет: ["ban"], блок: ["ban", "lock"], стоп: ["octagon", "hand", "circle-stop"],
  внимание: ["alert", "triangle-alert"], важно: ["alert", "star"], вопрос: ["question", "help"], инфо: ["info"],
  звезда: ["star"], огонь: ["flame"], срочно: ["flame", "zap", "siren"], молния: ["zap"], флаг: ["flag"],
  замок: ["lock"], ключ: ["key"], щит: ["shield"], безопасность: ["shield"],
  релиз: ["rocket", "package"], ракета: ["rocket"], пакет: ["package"], сборка: ["hammer", "package"],
  время: ["clock", "timer", "hourglass"], часы: ["clock"], ожидание: ["hourglass", "clock"], календарь: ["calendar"],
  дата: ["calendar"], пользователь: ["user"], человек: ["user"], команда: ["users"], люди: ["users"],
  база: ["database"], данные: ["database"], код: ["code", "brackets"], ссылка: ["link"], папка: ["folder"],
  файл: ["file"], документ: ["file-text", "file"], книга: ["book"], тест: ["flask", "test-tube"], поиск: ["search"],
  лупа: ["search"], настройки: ["settings", "sliders"], сердце: ["heart"], облако: ["cloud"], телефон: ["phone", "smartphone"],
  почта: ["mail"], чат: ["message"], сообщение: ["message"], плюс: ["plus"], минус: ["minus"], стрелка: ["arrow"],
  деньги: ["banknote", "wallet", "coins"], график: ["chart"], отчёт: ["chart", "file-text"], глаз: ["eye"],
  идея: ["lightbulb"], лампа: ["lamp", "lightbulb"], уведомление: ["bell"], колокол: ["bell"], пазл: ["puzzle"],
  интеграция: ["puzzle", "plug"], сервер: ["server"], монитор: ["monitor"], компьютер: ["monitor", "laptop"],
  робот: ["bot"], автотест: ["bot"], пауза: ["pause"], старт: ["play"], запуск: ["play", "rocket"],
  удалить: ["trash"], корзина: ["trash", "shopping-cart"], карандаш: ["pencil"], правка: ["pencil"], дом: ["house"],
  цель: ["target"], мишень: ["target"], якорь: ["anchor"], ветка: ["git-branch"], слияние: ["git-merge"],
  мобильный: ["smartphone"], веб: ["globe"], сеть: ["globe", "network", "wifi"], дизайн: ["palette", "pen-tool"],
  аналитика: ["chart", "chart-line"], бэк: ["server", "database"], фронт: ["layout", "monitor"],
};

/** Имя иконки Lucide «CircleCheckBig» → «circle-check-big» (по нему ищем). */
export const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();

export function filterIcons(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  if (!q) return names;
  const ru = Object.entries(RU_WORDS).filter(([w]) => w.replace(/ё/g, "е").startsWith(q)).flatMap(([, en]) => en);
  const terms = ru.length ? ru : [q];
  const scored = names.map(n => {
    const k = kebab(n);
    const parts = k.split("-");
    const score = terms.some(t => k === t) ? 0 : terms.some(t => parts[0] === t || k.startsWith(t)) ? 1
      : terms.some(t => parts.some(p => p.startsWith(t))) ? 2 : terms.some(t => k.includes(t)) ? 3 : 9;
    return [n, score] as const;
  }).filter(([, s]) => s < 9);
  return scored.sort((a, b) => a[1] - b[1]).map(([n]) => n);
}

const RECENT_KEY = "st_cell_icon_recent";

/** Недавние ярлычки этого браузера (удобство одного человека, не данные проекта). */
export function recentIcons(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; }
}

/** Иконка в «недавних» хранится без цвета: показываем её текущим выбранным цветом, как в Notion. */
export function rememberIcon(code: string): void {
  const c = parseCellIcon(code);
  const key = c?.kind === "icon" ? `i:${c.name}` : code;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...recentIcons().filter(x => x !== key)].slice(0, 12))); }
  catch { /* хранилище недоступно — недавние просто не запомнятся */ }
}

const COLOR_KEY = "st_cell_icon_color";

export function lastIconColor(): string {
  try { return localStorage.getItem(COLOR_KEY) ?? "#3b82f6"; } catch { return "#3b82f6"; }
}

export function rememberIconColor(hex: string): void {
  try { localStorage.setItem(COLOR_KEY, hex); } catch { /* не запомнится — не страшно */ }
}
