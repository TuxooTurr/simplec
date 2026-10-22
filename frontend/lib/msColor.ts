/**
 * Цвет лейбла микросервиса по группе: у группы — свой цвет, у каждого сервиса группы — свой оттенок этого цвета.
 *
 * Группа — первое значимое слово имени (домен): имена в справочнике строятся «домен-поддомен-роль».
 *   work-group-integ-ms, work-group-web-api-gate      → work        (зелёные)
 *   incidentit-esm-integ-ms                            → incidentit  (красные)
 *   sber911-chat-message-ms                            → chat        (sber911 — служебное слово, пропускаем)
 *   api-health-check-mcp-ms                            → health
 *   pkap-work-group-integ-ms                           → pkap        (интеграция ПКАП, а не сервис work)
 * Служебные слова (роль сервиса, платформа, проект) группу не задают — см. GENERIC.
 *
 * Крупные группы справочника — с заранее разведёнными цветами (FIXED), остальные — по хэшу имени группы из
 * палитры PALETTE: цвет стабилен, не зависит от порядка и состава справочника. Рисует класс .ms-chip
 * (app/globals.css) по переменным --ms-h (тон) и --ms-l (ступень оттенка) — светлая и тёмная тема.
 */

import type { CSSProperties } from "react";

/** Слова, которые не задают группу: роль сервиса (integ, gate, ms…), платформа (ios, web…), проект (sber911). */
const GENERIC = new Set([
  "sber911", "sber", "911", "integ", "integration", "gate", "api", "web", "mobile", "lib", "libs", "ms", "service", "mcp",
  "app", "front", "back", "backend", "frontend", "ios", "android", "server", "client", "db", "meta", "config",
  "configuration", "core", "common", "ui", "swift", "kotlin", "java", "sm", "alpha",
]);

/** Тон (0–360) крупных групп справочника: разведены, чтобы соседние по размеру группы не путались. */
const FIXED: Record<string, number> = {
  incidentit: 0,      // красные
  pkap: 215,          // синие
  hexagon: 265,       // фиолетовые
  conference: 38,     // янтарные
  work: 140,          // зелёные
  ai: 300,            // пурпурные
  runup: 188,         // бирюзовые
  incident: 350,      // малиновые
  monitoring: 170,    // морская волна
  release: 22,        // оранжевые
  sowa: 235,          // индиго
  health: 95,         // салатовые
  emergency: 8,       // алые
  kshu: 50,           // жёлтые
  bus: 200,           // голубые
  devops: 280,        // сиреневые
  chat: 320,          // розовые
  dashboard: 160,     // изумрудные
};

/** Палитра для остальных групп — тона, хорошо различимые на светлом и тёмном фоне. */
const PALETTE = [0, 15, 30, 45, 60, 85, 110, 140, 165, 185, 200, 215, 235, 255, 275, 295, 315, 335];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Группа микросервиса: первое значимое слово имени. Нет значимых — первое слово. */
export function msGroup(name: string): string {
  const words = name.toLowerCase().split(/[-_.\s]+/).filter(Boolean);
  // CI02484989_asds_CD: код CI — не группа.
  const meaningful = words.filter(w => !GENERIC.has(w) && !/^ci\d+$/.test(w) && !/^\d+$/.test(w));
  return meaningful[0] ?? words[0] ?? "";
}

/** Тон группы и ступень оттенка сервиса (0–3) — для .ms-chip. */
export function msTone(name: string): { group: string; hue: number; shade: number } {
  const group = msGroup(name);
  const base = FIXED[group] ?? PALETTE[hash(group) % PALETTE.length];
  const h = hash(name.toLowerCase());
  // Внутри группы тон чуть гуляет (±6°), светлота — 4 ступени: соседние сервисы группы различимы, но одного цвета.
  return { group, hue: (base + ((h % 3) - 1) * 6 + 360) % 360, shade: (h >>> 3) % 4 };
}

/** Свойства лейбла: класс и переменные цвета. Подсказку с группой добавляет сам лейбл. */
export function msChipStyle(name: string): { className: string; style: CSSProperties } {
  const t = msTone(name);
  return { className: "ms-chip", style: { "--ms-h": t.hue, "--ms-l": t.shade } as CSSProperties };
}
