"""
Хранилище сессий сравнения LLM-моделей (Сравнение моделей).

Файл: data/model_bench_sessions.json
"""

import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
_SESSIONS_FILE = _ROOT / "data" / "model_bench_sessions.json"
_MAX_SESSIONS = 50


class ModelBenchStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _SESSIONS_FILE.exists():
            return []
        try:
            with open(_SESSIONS_FILE, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            # Файл битый (например, от обрыва записи до того, как _save() стала
            # атомарной) — без этого КАЖДЫЙ запрос к любому эндпоинту model-bench
            # падал бы необработанным исключением (500), пока кто-то не удалит
            # файл руками. Откладываем битую копию рядом и продолжаем с пустого
            # места — историю сессий этой машины теряем, но панель снова работает.
            backup = _SESSIONS_FILE.with_suffix(f".json.corrupted-{int(datetime.now().timestamp())}")
            try:
                shutil.move(str(_SESSIONS_FILE), str(backup))
                logger.warning("model_bench_sessions.json битый, перемещён в %s", backup)
            except OSError:
                logger.warning("model_bench_sessions.json битый и не удалось сохранить копию")
            return []

    @staticmethod
    def _save(sessions: list[dict]) -> None:
        """Пишем во временный файл и атомарно переименовываем — если процесс
        упадёт или запрос оборвётся посреди записи, основной файл не
        останется наполовину записанным (битый JSON положил бы все
        последующие запросы к этому хранилищу)."""
        _SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _SESSIONS_FILE.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(sessions, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _SESSIONS_FILE)

    @classmethod
    def list_sessions(cls, limit: int = 50) -> list[dict]:
        sessions = cls._load()
        result = []
        for s in sessions[:limit]:
            result.append({
                "id": s["id"],
                "created_at": s["created_at"],
                "updated_at": s["updated_at"],
                "prompt": s.get("prompt", "")[:200],
                "targets_count": len(s.get("targets", [])),
                "has_report": bool(s.get("report")),
            })
        return result

    @classmethod
    def get_session(cls, session_id: str) -> Optional[dict]:
        for s in cls._load():
            if s.get("id") == session_id:
                return s
        return None

    @classmethod
    def create_session(cls, prompt: str, transcript: str) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        session = {
            "id": uuid.uuid4().hex[:12],
            "created_at": now,
            "updated_at": now,
            "prompt": prompt,
            "transcript": transcript,
            "targets": [],
            "report": "",
            "report_provider": "",
            "best_provider": "",
            "best_model": "",
        }
        sessions = cls._load()
        sessions.insert(0, session)
        sessions = sessions[:_MAX_SESSIONS]
        cls._save(sessions)
        return session

    @classmethod
    def add_target_results(cls, session_id: str, provider: str, model: str, results: list[dict]) -> Optional[dict]:
        """Добавляет прогон модели. Повторный запуск той же provider/model
        дополняет уже существующий target новыми прогонами (не создаёт дубликат)."""
        sessions = cls._load()
        for s in sessions:
            if s.get("id") != session_id:
                continue
            targets = s.setdefault("targets", [])
            target = next((t for t in targets if t.get("provider") == provider and t.get("model") == model), None)
            if target is None:
                target = {"provider": provider, "model": model, "results": []}
                targets.append(target)
            base = len(target.setdefault("results", []))
            for r in results:
                r = dict(r)
                r["run"] = base + r["run"]
                target["results"].append(r)
            s["updated_at"] = datetime.now(timezone.utc).isoformat()
            cls._save(sessions)
            return s
        return None

    @classmethod
    def set_report(cls, session_id: str, report: str, provider: str, best: Optional[dict]) -> Optional[dict]:
        sessions = cls._load()
        for s in sessions:
            if s.get("id") == session_id:
                s["report"] = report
                s["report_provider"] = provider
                s["best_provider"] = (best or {}).get("provider", "")
                s["best_model"] = (best or {}).get("model", "")
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
