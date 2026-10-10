/**
 * Оформление плиток «Генераторов событий»: палитра, иконки Lucide, эмодзи.
 *
 * Иконка хранится строкой: «lucide:<Имя>» — иконка из библиотеки Lucide (та же,
 * что во всём интерфейсе, ~1900 штук), «emoji:<символ>» — эмодзи.
 * Библиотека Notion закрытая (нет открытой лицензии и пакета), поэтому выбор
 * устроен как в Notion, а иконки — из Lucide.
 */

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

/* ── Цвета: классы целиком, чтобы Tailwind их увидел ─────────────────────── */

export const TILE_COLORS = {
  gray:   { label: "Серый",      gradient: "from-slate-400 to-slate-600",   swatch: "bg-slate-500" },
  brown:  { label: "Коричневый", gradient: "from-amber-700 to-orange-900",  swatch: "bg-amber-800" },
  orange: { label: "Оранжевый",  gradient: "from-amber-500 to-orange-500",  swatch: "bg-orange-500" },
  yellow: { label: "Жёлтый",     gradient: "from-yellow-400 to-amber-500",  swatch: "bg-yellow-400" },
  green:  { label: "Зелёный",    gradient: "from-emerald-500 to-teal-500",  swatch: "bg-emerald-500" },
  blue:   { label: "Голубой",    gradient: "from-sky-500 to-blue-600",      swatch: "bg-sky-500" },
  indigo: { label: "Синий",      gradient: "from-indigo-500 to-violet-500", swatch: "bg-indigo-500" },
  purple: { label: "Фиолетовый", gradient: "from-violet-500 to-purple-600", swatch: "bg-violet-500" },
  pink:   { label: "Розовый",    gradient: "from-fuchsia-500 to-pink-500",  swatch: "bg-pink-500" },
  red:    { label: "Красный",    gradient: "from-rose-500 to-red-600",      swatch: "bg-rose-500" },
} as const;

export type TileColor = keyof typeof TILE_COLORS;

export function gradientOf(color: string | undefined, fallback: TileColor): string {
  return (TILE_COLORS[color as TileColor] ?? TILE_COLORS[fallback]).gradient;
}

export type ParsedIcon = { kind: "lucide"; name: string } | { kind: "emoji"; value: string } | null;

export function parseIcon(icon?: string | null): ParsedIcon {
  if (!icon) return null;
  if (icon.startsWith("lucide:")) return { kind: "lucide", name: icon.slice(7) };
  if (icon.startsWith("emoji:")) return { kind: "emoji", value: icon.slice(6) };
  return null;
}

/* ── Вся библиотека Lucide грузится отдельным куском и только когда нужна ── */

type IconMap = Record<string, LucideIcon>;
let loaded: IconMap | null = null;
let loading: Promise<IconMap> | null = null;

export function loadLucide(): Promise<IconMap> {
  if (!loading) loading = import("lucide-react").then(m => (loaded = m.icons as unknown as IconMap));
  return loading;
}

/** Карта всех иконок Lucide; null, пока не загружена или не нужна. */
export function useLucideIcons(need: boolean): IconMap | null {
  const [icons, setIcons] = useState<IconMap | null>(loaded);
  useEffect(() => {
    if (need && !icons) loadLucide().then(setIcons).catch(() => { /* останутся стандартные иконки */ });
  }, [need, icons]);
  return icons;
}

/* ── Поиск по-русски: популярные иконки с ключевыми словами ─────────────── */

export const POPULAR_ICONS: [string, string][] = [
  ["Bell", "колокол уведомление алерт звонок"], ["BellRing", "алерт тревога уведомление"],
  ["Siren", "сирена авария инцидент"], ["TriangleAlert", "внимание предупреждение ошибка"],
  ["Bug", "баг дефект ошибка жук"], ["ShieldCheck", "защита безопасность проверка"],
  ["Activity", "пульс мониторинг метрика"], ["ChartColumn", "график метрики статистика"],
  ["ChartLine", "график тренд метрики"], ["ChartPie", "диаграмма доля"], ["Gauge", "спидометр нагрузка"],
  ["Database", "база данных бд"], ["Server", "сервер стенд"], ["Cloud", "облако"],
  ["Container", "контейнер под openshift"], ["Boxes", "микросервисы сервисы"], ["Network", "сеть связи"],
  ["Cpu", "процессор железо"], ["HardDrive", "диск хранилище"], ["Terminal", "терминал консоль скрипт"],
  ["Code", "код разработка"], ["Braces", "json данные"], ["FileBraces", "json файл"],
  ["FileText", "документ файл текст"], ["Files", "файлы документы"], ["Folder", "папка"],
  ["FolderOpen", "папка открыта"], ["Archive", "архив"], ["Inbox", "входящие очередь"],
  ["Send", "отправить отправка kafka"], ["Mail", "почта письмо"], ["MessageSquare", "сообщение чат"],
  ["MessagesSquare", "диалог чат"], ["Radio", "трансляция эфир поток"], ["Rss", "поток лента"],
  ["Zap", "молния событие быстро"], ["Flame", "огонь горит срочно"], ["Rocket", "ракета запуск релиз"],
  ["Play", "запуск старт"], ["CirclePlay", "запуск старт"], ["Timer", "таймер время"],
  ["Clock", "часы время расписание"], ["CalendarDays", "календарь дата расписание"], ["History", "история"],
  ["RefreshCw", "обновить повтор"], ["Repeat", "повтор цикл"], ["Workflow", "процесс сценарий"],
  ["GitBranch", "ветка git"], ["Settings", "настройки шестерёнка"], ["Wrench", "инструмент ремонт"],
  ["Hammer", "молоток сборка"], ["Users", "люди команда участники ткс"], ["User", "пользователь человек"],
  ["UserCheck", "пользователь проверен"], ["Building2", "банк здание офис"], ["Landmark", "банк"],
  ["CreditCard", "карта платёж"], ["Wallet", "кошелёк деньги"], ["Banknote", "деньги купюра"],
  ["Coins", "монеты деньги"], ["ShoppingCart", "корзина покупка"], ["Receipt", "чек квитанция"],
  ["Phone", "телефон звонок"], ["Smartphone", "телефон мобильный"], ["Monitor", "монитор экран"],
  ["Globe", "сайт интернет веб"], ["Link", "ссылка"], ["Search", "поиск лупа"], ["Eye", "глаз просмотр"],
  ["Funnel", "фильтр"], ["ListChecks", "чеклист список проверки"], ["ClipboardList", "список задачи"],
  ["ClipboardCheck", "проверка тест"], ["FlaskConical", "тест эксперимент колба"], ["TestTube", "тест пробирка"],
  ["Target", "цель"], ["Flag", "флаг отметка"], ["Bookmark", "закладка"], ["Star", "звезда избранное"],
  ["Heart", "сердце"], ["Lightbulb", "идея лампочка"], ["Sparkles", "магия ai ии"], ["Bot", "бот ии ai робот"],
  ["Brain", "мозг ии"], ["Lock", "замок доступ"], ["Key", "ключ доступ"], ["FingerprintPattern", "отпечаток доступ"],
  ["Map", "карта"], ["MapPin", "место точка"], ["Truck", "доставка грузовик"], ["Package", "пакет коробка"],
  ["Layers", "слои"], ["LayoutGrid", "плитки сетка"], ["Puzzle", "пазл интеграция"], ["Plug", "подключение коннектор"],
  ["Cable", "кабель подключение"], ["Wifi", "сеть wifi"], ["Thermometer", "температура"], ["Sun", "солнце"],
  ["Moon", "луна ночь"], ["Coffee", "кофе"], ["Trophy", "кубок победа"], ["Smile", "улыбка"],
];

export const EMOJIS: [string, string][] = [
  ["🚨", "сирена алерт авария"], ["🔔", "колокол уведомление"], ["⚠️", "внимание"], ["🔥", "огонь срочно"],
  ["🐞", "баг дефект"], ["🐛", "баг жук"], ["🧪", "тест колба"], ["✅", "готово галочка"], ["❌", "ошибка крест"],
  ["⛔", "стоп запрет"], ["🛡️", "защита"], ["🔒", "замок"], ["🔑", "ключ"], ["📊", "график метрики"],
  ["📈", "рост график"], ["📉", "падение график"], ["🧮", "счёты подсчёт"], ["🗄️", "архив база"], ["💾", "диск"],
  ["🖥️", "компьютер сервер"], ["💻", "ноутбук"], ["📱", "телефон"], ["☁️", "облако"], ["🌐", "сайт интернет"],
  ["🔗", "ссылка"], ["🔌", "подключение"], ["📡", "антенна сигнал"], ["📨", "письмо отправка"],
  ["✉️", "почта"], ["💬", "сообщение чат"], ["📣", "объявление"], ["📢", "громкоговоритель"],
  ["⚡", "молния событие"], ["🚀", "ракета запуск"], ["▶️", "запуск"], ["⏱️", "таймер"], ["⏰", "будильник"],
  ["📅", "календарь"], ["🗓️", "расписание"], ["🔁", "повтор"], ["🔄", "обновить"], ["⚙️", "настройки"],
  ["🛠️", "инструменты"], ["🔧", "ключ ремонт"], ["🧰", "инструменты"], ["🤖", "бот робот ии"], ["🧠", "мозг ии"],
  ["✨", "магия"], ["💡", "идея"], ["🎯", "цель"], ["🏁", "финиш"], ["🚩", "флаг"], ["📌", "закреп"],
  ["⭐", "звезда"], ["🏆", "победа"], ["👥", "люди команда"], ["👤", "пользователь"], ["🧑‍💻", "разработчик"],
  ["🏦", "банк"], ["💳", "карта платёж"], ["💰", "деньги"], ["💸", "платёж"], ["🧾", "чек"], ["🛒", "корзина"],
  ["📦", "коробка пакет"], ["🚚", "доставка"], ["🗂️", "папки"], ["📁", "папка"], ["📂", "папка открыта"],
  ["📄", "документ"], ["📋", "список"], ["📝", "заметка"], ["🔍", "поиск"], ["👀", "просмотр"],
  ["🧩", "пазл интеграция"], ["🌡️", "температура"], ["🌙", "ночь"], ["☀️", "день"], ["☕", "кофе"],
  ["🍀", "удача"], ["🎉", "праздник релиз"], ["🟢", "зелёный ок"], ["🟡", "жёлтый"], ["🔴", "красный"],
  ["🔵", "синий"], ["🟣", "фиолетовый"],
];

/** «ChartColumn» → «chart column» для поиска по английскому имени. */
export function iconWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}
