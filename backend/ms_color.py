"""
Цвет микросервиса по группе — то же, что frontend/lib/msColor.ts (лейблы в Jira tool и полосы графика стендов),
для страницы стенда в Confluence. Меняете правила там — меняйте и здесь (тест сверяет на примерах).

Группа — первое значимое слово имени («work-group-web-api-gate» → work), служебные слова пропускаются. У крупных
групп тон задан, у остальных — по хэшу имени группы; у сервиса внутри группы — свой оттенок (±6° и 4 ступени).
"""

from __future__ import annotations

import colorsys
import re

GENERIC = {
    "sber911", "sber", "911", "integ", "integration", "gate", "api", "web", "mobile", "lib", "libs", "ms", "service", "mcp",
    "app", "front", "back", "backend", "frontend", "ios", "android", "server", "client", "db", "meta", "config",
    "configuration", "core", "common", "ui", "swift", "kotlin", "java", "sm", "alpha",
}

FIXED = {
    "incidentit": 0, "pkap": 215, "hexagon": 265, "conference": 38, "work": 140, "ai": 300, "runup": 188,
    "incident": 350, "monitoring": 170, "release": 22, "sowa": 235, "health": 95, "emergency": 8, "kshu": 50,
    "bus": 200, "devops": 280, "chat": 320, "dashboard": 160,
}

PALETTE = [0, 15, 30, 45, 60, 85, 110, 140, 165, 185, 200, 215, 235, 255, 275, 295, 315, 335]


def _hash(s: str) -> int:
    """FNV-1a по кодам UTF-16, как charCodeAt в JS."""
    h = 2166136261
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def ms_group(name: str) -> str:
    words = [w for w in re.split(r"[-_.\s]+", name.lower()) if w]
    meaningful = [w for w in words if w not in GENERIC and not re.fullmatch(r"ci\d+", w) and not w.isdigit()]
    return meaningful[0] if meaningful else (words[0] if words else "")


def ms_tone(name: str) -> tuple[str, int, int]:
    """(группа, тон 0–360, ступень оттенка 0–3)."""
    group = ms_group(name)
    base = FIXED.get(group, PALETTE[_hash(group) % len(PALETTE)])
    h = _hash(name.lower())
    return group, (base + ((h % 3) - 1) * 6 + 360) % 360, (h >> 3) % 4


def ms_hex(name: str) -> str:
    """Цвет заливки (светлая тема), как фон .ms-chip: hsl(тон, 80%, 92% − 3%·ступень)."""
    _, hue, shade = ms_tone(name)
    r, g, b = colorsys.hls_to_rgb(hue / 360, (92 - 3 * shade) / 100, 0.8)
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))
