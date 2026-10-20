"""
Справочник людей Jira tool: тестировщики и люди направлений (аналитика, бэкенд, DevOps…).

Раньше жил только в браузере (localStorage) и пропадал вместе с ним. Теперь — на бэкенде, файл data/people.json:
переживает и перезапуск, и очистку браузера, один на всех, кто работает с этим SimpleTest.

Запись — целиком (справочник маленький), через временный файл: оборванная запись не оставит битый JSON.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
PEOPLE_FILE = _ROOT / "data" / "people.json"
_lock = threading.Lock()


def load() -> dict:
    """{"people": [...], "updatedAt": "..."}; файла нет или он битый — пустой справочник."""
    try:
        data = json.loads(PEOPLE_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {"people": [], "updatedAt": ""}
    if not isinstance(data, dict) or not isinstance(data.get("people"), list):
        return {"people": [], "updatedAt": ""}
    return {"people": data["people"], "updatedAt": str(data.get("updatedAt") or "")}


def save(people: list[dict], updated_at: str) -> dict:
    out = {"people": people, "updatedAt": updated_at}
    with _lock:
        PEOPLE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = PEOPLE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), "utf-8")
        tmp.replace(PEOPLE_FILE)
    return out
