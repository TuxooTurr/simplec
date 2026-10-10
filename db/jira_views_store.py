"""
Хранилище представлений Jira-аналитики.

Представление = выборка (JQL) + группировка + колонки. Общее на всю команду:
все видят одни и те же сохранённые представления.

Файл: data/jira_views.json
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_VIEWS_FILE = _ROOT / "data" / "jira_views.json"


class JiraViewsStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _VIEWS_FILE.exists():
            return []
        with open(_VIEWS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save(views: list[dict]) -> None:
        _VIEWS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_VIEWS_FILE, "w", encoding="utf-8") as f:
            json.dump(views, f, ensure_ascii=False, indent=2)

    @classmethod
    def list_views(cls) -> list[dict]:
        return cls._load()

    @classmethod
    def get_view(cls, view_id: str) -> Optional[dict]:
        return next((v for v in cls._load() if v.get("id") == view_id), None)

    @classmethod
    def save_view(cls, view: dict) -> dict:
        """Создать или обновить представление. Без id — создаётся новое."""
        views = cls._load()
        now = datetime.now(timezone.utc).isoformat()
        if not view.get("id"):
            view["id"] = "view-" + uuid.uuid4().hex[:8]
            view["created_at"] = now
        view["updated_at"] = now
        for i, v in enumerate(views):
            if v.get("id") == view["id"]:
                view.setdefault("created_at", v.get("created_at", now))
                views[i] = view
                cls._save(views)
                return view
        views.append(view)
        cls._save(views)
        return view

    @classmethod
    def delete_view(cls, view_id: str) -> bool:
        views = cls._load()
        rest = [v for v in views if v.get("id") != view_id]
        if len(rest) == len(views):
            return False
        cls._save(rest)
        return True
