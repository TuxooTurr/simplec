"""
Генератор инцидентов: настройки, библиотека описаний и инструкций, пресеты, история отправок.

Файл: data/incident_gen.json (в .gitignore, попадает в резервную копию). Персональных данных по умолчанию нет:
исполнитель и автор инструкции — настройки, которые заполняет команда.
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "incident_gen.json"
_lock = threading.Lock()
HISTORY_MAX = 100

DEFAULT_SETTINGS: dict[str, Any] = {
    "kafka_connection_id": "ift-delta-default",   # подключение из «Просмотра Kafka»
    "topic": "repl.sber_esm_input",               # интеграционный топик Sber ESM → Sber911
    "partition": 0,
    "system_created_by": "CI02587203",            # КЭ системы-источника (мониторинг)
    "monitoring_system_name": "Мониторинг и журналирование Тенгри",
    "assignee_id_bhb": "",
    "assignee_personal_number": "",
    # Инструкции — запись в БД инцидентов (SQL-шаблон create_incident_instruction из test_sql_templates.json).
    "db_connection_id": "",
    "instruction_sql": "",
    "instruction_wait_sec": 5,
    "instruction_user_id": "",
    "instruction_user_name": "",
    "instruction_user_number": "",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty() -> dict:
    return {"settings": dict(DEFAULT_SETTINGS), "library": [], "presets": [], "history": []}


def _load() -> dict:
    if not _FILE.exists():
        return _empty()
    try:
        with open(_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty()
    base = _empty()
    base.update({k: v for k, v in data.items() if k in base})
    base["settings"] = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    return base


def _save(data: dict) -> None:
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _FILE)


def read() -> dict:
    with _lock:
        return _load()


def update(fn) -> Any:
    """Прочитать, изменить функцией fn(data) → результат, сохранить — под одной блокировкой."""
    with _lock:
        data = _load()
        out = fn(data)
        _save(data)
        return out


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def stamp() -> str:
    return _now()
