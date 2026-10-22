"""
Справочник людей Jira tool: тестировщики и люди направлений (аналитика, бэкенд, DevOps…).

Раньше жил только в браузере (localStorage) и пропадал вместе с ним. Теперь — на бэкенде, файл data/people.json:
переживает и перезапуск, и очистку браузера, один на всех, кто работает с этим SimpleTest.

Запись — целиком (справочник маленький), через временный файл: оборванная запись не оставит битый JSON.

Рядом со списком людей — jiraFields: направление → id поля Jira, куда пишется имя человека в Jira
(«Тестировщик», «Аналитик»…). Своя запись (save_jira_fields), сохранение людей её не трогает.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
PEOPLE_FILE = _ROOT / "data" / "people.json"
_lock = threading.Lock()


def load() -> dict:
    """{"people": [...], "jiraFields": {...}, "updatedAt": "..."}; файла нет или он битый — пустой справочник."""
    try:
        data = json.loads(PEOPLE_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {"people": [], "jiraFields": {}, "updatedAt": ""}
    if not isinstance(data, dict) or not isinstance(data.get("people"), list):
        return {"people": [], "jiraFields": {}, "updatedAt": ""}
    fields = data.get("jiraFields")
    return {"people": data["people"], "jiraFields": fields if isinstance(fields, dict) else {},
            "updatedAt": str(data.get("updatedAt") or "")}


def _write(out: dict) -> None:
    PEOPLE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = PEOPLE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(PEOPLE_FILE)


def save(people: list[dict], updated_at: str) -> dict:
    with _lock:
        out = {"people": people, "jiraFields": load()["jiraFields"], "updatedAt": updated_at}
        _write(out)
    return out


def save_jira_fields(fields: dict[str, str], updated_at: str) -> dict:
    with _lock:
        cur = load()
        out = {"people": cur["people"], "jiraFields": fields, "updatedAt": updated_at}
        _write(out)
    return out
