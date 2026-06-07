"""
Хранилище сессий генерации тест-кейсов.

Файл: data/gen_sessions.json
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_SESSIONS_FILE = _ROOT / "data" / "gen_sessions.json"
_MAX_SESSIONS = 50


class GenSessionsStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _SESSIONS_FILE.exists():
            return []
        with open(_SESSIONS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save(sessions: list[dict]) -> None:
        _SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(sessions, f, ensure_ascii=False, indent=2)

    @classmethod
    def list_sessions(cls, limit: int = 50, status: Optional[str] = None) -> list[dict]:
        sessions = cls._load()
        if status:
            sessions = [s for s in sessions if s.get("status") == status]
        result = []
        for s in sessions[:limit]:
            summary = {k: v for k, v in s.items()
                       if k not in ("cases", "qa_doc", "case_list", "events", "export_result")}
            summary["case_count"] = len(s.get("cases", []))
            summary["has_qa_doc"] = bool(s.get("qa_doc"))
            summary["has_export"] = bool(s.get("export_result"))
            # requirement в summary — первые 200 символов для отображения
            req = s.get("requirement", "")
            summary["requirement"] = req[:200] if req else ""
            result.append(summary)
        return result

    @classmethod
    def get_session(cls, session_id: str) -> Optional[dict]:
        for s in cls._load():
            if s.get("id") == session_id:
                return s
        return None

    @classmethod
    def create_session(cls, params: dict) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        session = {
            "id": uuid.uuid4().hex[:12],
            "status": "generating",
            "created_at": now,
            "updated_at": now,
            "requirement": params.get("requirement", ""),
            "feature": params.get("feature", ""),
            "depth": params.get("depth", "smoke"),
            "provider": params.get("provider", ""),
            "platform": params.get("platform", "Web"),
            "qa_doc": "",
            "case_list": [],
            "cases": [],
            "elapsed": 0,
            "current_layer": 0,
            "layer3_progress": None,
            "error": None,
            "error_is_llm": False,
            "export_result": None,
        }
        sessions = cls._load()
        sessions.insert(0, session)
        sessions = sessions[:_MAX_SESSIONS]
        cls._save(sessions)
        return session

    @classmethod
    def update_session(cls, session_id: str, **fields) -> Optional[dict]:
        sessions = cls._load()
        for i, s in enumerate(sessions):
            if s.get("id") == session_id:
                s.update(fields)
                s["updated_at"] = datetime.now(timezone.utc).isoformat()
                cls._save(sessions)
                return s
        return None

    @classmethod
    def delete_session(cls, session_id: str) -> bool:
        sessions = cls._load()
        before = len(sessions)
        sessions = [s for s in sessions if s.get("id") != session_id]
        if len(sessions) == before:
            return False
        cls._save(sessions)
        return True
