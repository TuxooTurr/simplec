"""
Хранилище настроек панели запуска автотестов и истории прогонов.

Файлы:
  data/autotest_run_config.json   — путь к фреймворку, кнопки запуска, правила автозапуска
  data/autotest_run_history.json  — последние 50 ручных и автоматических запусков
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_CONFIG_FILE = _ROOT / "data" / "autotest_run_config.json"
_HISTORY_FILE = _ROOT / "data" / "autotest_run_history.json"
_HISTORY_MAX = 50


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_config() -> dict:
    return {
        "framework_path": "",
        "selected_types": ["api", "e2e"],
        "selected_tags": ["smoke"],
        "scripts": [
            {
                "id": "smoke-local",
                "name": "Smoke прогон",
                "script_path": "",
                "work_dir": "",
                "default_tags": ["smoke"],
                "test_types": ["api", "e2e"],
                "microservices": ["*"],
                "enabled": True,
                "timeout_sec": 1200,
                "ui_size": "md",
                "ui_order": 0,
            }
        ],
        "autorun": {
            "enabled": False,
            "source_type": "url",
            "source_url": "",
            "source_file_path": "",
            "poll_interval_sec": 120,
            "version_regex": r"(?P<microservice>[A-Za-z0-9_.-]+)\s*[:=]\s*(?P<version>[A-Za-z0-9_.-]+)",
            "run_on_first_seen": False,
            "rules": [
                {
                    "id": "rule-smoke-all",
                    "name": "Smoke при обновлении любого сервиса",
                    "microservice": "*",
                    "script_ids": ["smoke-local"],
                    "tags": [],
                    "use_microservice_as_tag": True,
                    "test_types": ["api", "e2e"],
                    "enabled": True,
                    "ui_size": "md",
                    "ui_order": 0,
                }
            ],
            "last_seen": {},
            "last_check_at": "",
        },
    }


def _merge_defaults(config: dict) -> dict:
    defaults = _default_config()
    merged = {**defaults, **(config or {})}
    merged["autorun"] = {**defaults["autorun"], **(config or {}).get("autorun", {})}
    merged.setdefault("scripts", defaults["scripts"])
    merged.setdefault("selected_types", defaults["selected_types"])
    merged.setdefault("selected_tags", defaults["selected_tags"])
    for index, script in enumerate(merged.get("scripts", [])):
        script.setdefault("ui_size", "md")
        script.setdefault("ui_order", index)
    for index, rule in enumerate(merged.get("autorun", {}).get("rules", [])):
        rule.setdefault("ui_size", "md")
        rule.setdefault("ui_order", index)
        rule.setdefault("use_microservice_as_tag", True)
    return merged


class AutotestRunsStore:
    @staticmethod
    def get_config() -> dict:
        if not _CONFIG_FILE.exists():
            return _default_config()
        with open(_CONFIG_FILE, encoding="utf-8") as f:
            return _merge_defaults(json.load(f))

    @staticmethod
    def save_config(config: dict) -> dict:
        data = _merge_defaults(config)
        for script in data.get("scripts", []):
            if not script.get("id"):
                script["id"] = uuid.uuid4().hex[:8]
            script.setdefault("ui_size", "md")
            script.setdefault("ui_order", 0)
        for rule in data.get("autorun", {}).get("rules", []):
            if not rule.get("id"):
                rule["id"] = uuid.uuid4().hex[:8]
            rule.setdefault("ui_size", "md")
            rule.setdefault("ui_order", 0)
            rule.setdefault("use_microservice_as_tag", True)
        data["updated_at"] = _now_iso()
        _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return data

    @classmethod
    def update_autorun_state(cls, *, last_seen: dict[str, str], last_check_at: Optional[str] = None) -> dict:
        config = cls.get_config()
        autorun = config.setdefault("autorun", {})
        autorun["last_seen"] = last_seen
        autorun["last_check_at"] = last_check_at or _now_iso()
        return cls.save_config(config)

    @staticmethod
    def add_history(entry: dict) -> None:
        if not entry.get("ts"):
            entry["ts"] = _now_iso()
        history = AutotestRunsStore.get_history(limit=_HISTORY_MAX)
        history.insert(0, entry)
        history = history[:_HISTORY_MAX]
        _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)

    @staticmethod
    def get_history(limit: int = 20) -> list[dict]:
        if not _HISTORY_FILE.exists():
            return []
        with open(_HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)[:limit]
