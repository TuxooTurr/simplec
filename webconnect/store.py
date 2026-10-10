"""
Хранилище веб-коннекторов (JSON в data/, вне git).

  data/web_connectors.json        — коннекторы и сценарии
  data/log_services.json          — сохранённые имена микросервисов анализатора логов
  data/webconnect_recordings/     — последняя запись по каждому коннектору

Секретов здесь нет: вход делает человек, сессия живёт в профиле браузера
(~/.simpletest/webconnect/<id>/), cookie и заголовки авторизации в сценарий не пишутся.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent / "data"
_CONNECTORS_FILE = _ROOT / "web_connectors.json"
_SERVICES_FILE = _ROOT / "log_services.json"
_RECORDINGS_DIR = _ROOT / "webconnect_recordings"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read(path: Path, default):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


class WebStore:
    # ── коннекторы и сценарии ──

    @staticmethod
    def _load() -> dict:
        data = _read(_CONNECTORS_FILE, {})
        data.setdefault("connectors", [])
        data.setdefault("scenarios", [])
        return data

    @classmethod
    def connectors(cls) -> list[dict]:
        return cls._load()["connectors"]

    @classmethod
    def connector(cls, cid: str) -> Optional[dict]:
        return next((c for c in cls.connectors() if c["id"] == cid), None)

    @classmethod
    def save_connector(cls, item: dict) -> dict:
        data = cls._load()
        if not item.get("id"):
            item["id"] = "wc-" + uuid.uuid4().hex[:8]
            item["created_at"] = _now()
        item["updated_at"] = _now()
        idx = next((i for i, c in enumerate(data["connectors"]) if c["id"] == item["id"]), None)
        if idx is None:
            data["connectors"].append(item)
        else:
            data["connectors"][idx] = {**data["connectors"][idx], **item}
            item = data["connectors"][idx]
        _write(_CONNECTORS_FILE, data)
        return item

    @classmethod
    def delete_connector(cls, cid: str) -> bool:
        data = cls._load()
        before = len(data["connectors"])
        data["connectors"] = [c for c in data["connectors"] if c["id"] != cid]
        data["scenarios"] = [s for s in data["scenarios"] if s["connector_id"] != cid]
        _write(_CONNECTORS_FILE, data)
        return len(data["connectors"]) < before

    @classmethod
    def scenarios(cls, connector_id: Optional[str] = None) -> list[dict]:
        items = cls._load()["scenarios"]
        return [s for s in items if not connector_id or s["connector_id"] == connector_id]

    @classmethod
    def scenario(cls, sid: str) -> Optional[dict]:
        return next((s for s in cls.scenarios() if s["id"] == sid), None)

    @classmethod
    def save_scenario(cls, item: dict) -> dict:
        data = cls._load()
        if not item.get("id"):
            item["id"] = "sc-" + uuid.uuid4().hex[:8]
            item["created_at"] = _now()
        item["updated_at"] = _now()
        # Источник для анализатора логов — один на всё приложение.
        if item.get("log_source"):
            for s in data["scenarios"]:
                if s["id"] != item["id"]:
                    s["log_source"] = False
        idx = next((i for i, s in enumerate(data["scenarios"]) if s["id"] == item["id"]), None)
        if idx is None:
            data["scenarios"].append(item)
        else:
            data["scenarios"][idx] = {**data["scenarios"][idx], **item}
            item = data["scenarios"][idx]
        _write(_CONNECTORS_FILE, data)
        return item

    @classmethod
    def delete_scenario(cls, sid: str) -> bool:
        data = cls._load()
        before = len(data["scenarios"])
        data["scenarios"] = [s for s in data["scenarios"] if s["id"] != sid]
        _write(_CONNECTORS_FILE, data)
        return len(data["scenarios"]) < before

    @classmethod
    def log_source(cls) -> Optional[dict]:
        items = cls.scenarios()
        return next((s for s in items if s.get("log_source")), None)

    # ── записи ──

    @staticmethod
    def save_recording(connector_id: str, recording: dict) -> None:
        _write(_RECORDINGS_DIR / f"{connector_id}.json", recording)

    @staticmethod
    def recording(connector_id: str) -> Optional[dict]:
        return _read(_RECORDINGS_DIR / f"{connector_id}.json", None)

    # ── сохранённые сервисы анализатора ──

    @staticmethod
    def services() -> list[dict]:
        return _read(_SERVICES_FILE, [])

    @classmethod
    def save_service(cls, name: str, note: str = "") -> list[dict]:
        name = name.strip()
        items = [s for s in cls.services() if s["name"] != name]
        items.append({"name": name, "note": note.strip()})
        items.sort(key=lambda s: s["name"].lower())
        _write(_SERVICES_FILE, items)
        return items

    @classmethod
    def delete_service(cls, name: str) -> list[dict]:
        items = [s for s in cls.services() if s["name"] != name]
        _write(_SERVICES_FILE, items)
        return items
