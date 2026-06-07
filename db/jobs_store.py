"""
Хранилище джобов (кнопки запуска scheduled-задач через UPDATE nextfiretime).

Файлы:
  data/jobs.json          — определения джобов
  data/job_folders.json   — папки джобов
  data/job_history.json   — последние 100 запусков
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_JOBS_FILE    = _ROOT / "data" / "jobs.json"
_FOLDERS_FILE = _ROOT / "data" / "job_folders.json"
_HISTORY_FILE = _ROOT / "data" / "job_history.json"
_HISTORY_MAX  = 100


class JobsStore:

    # ── Jobs ────────────────────────────────────────────────────────────────

    @staticmethod
    def _load_jobs() -> list[dict]:
        if not _JOBS_FILE.exists():
            return []
        with open(_JOBS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save_jobs(jobs: list[dict]) -> None:
        _JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_JOBS_FILE, "w", encoding="utf-8") as f:
            json.dump(jobs, f, ensure_ascii=False, indent=2)

    @classmethod
    def get_jobs(cls) -> list[dict]:
        return cls._load_jobs()

    @classmethod
    def get_job(cls, job_id: str) -> Optional[dict]:
        for j in cls._load_jobs():
            if j.get("id") == job_id:
                return j
        return None

    @classmethod
    def save_job(cls, job: dict) -> dict:
        """Создать или обновить джоб."""
        jobs = cls._load_jobs()
        if not job.get("id"):
            job["id"] = "job-" + str(uuid.uuid4())[:8]
        if not job.get("created_at"):
            job["created_at"] = datetime.now(timezone.utc).isoformat()
        job["updated_at"] = datetime.now(timezone.utc).isoformat()
        for i, j in enumerate(jobs):
            if j.get("id") == job["id"]:
                jobs[i] = job
                cls._save_jobs(jobs)
                return job
        jobs.append(job)
        cls._save_jobs(jobs)
        return job

    @classmethod
    def delete_job(cls, job_id: str) -> bool:
        jobs = cls._load_jobs()
        before = len(jobs)
        jobs = [j for j in jobs if j.get("id") != job_id]
        if len(jobs) == before:
            return False
        cls._save_jobs(jobs)
        return True

    # ── Folders ─────────────────────────────────────────────────────────────

    @staticmethod
    def _load_folders() -> list[dict]:
        if not _FOLDERS_FILE.exists():
            return []
        with open(_FOLDERS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save_folders(folders: list[dict]) -> None:
        _FOLDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_FOLDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(folders, f, ensure_ascii=False, indent=2)

    @classmethod
    def get_folders(cls) -> list[dict]:
        return cls._load_folders()

    @classmethod
    def save_folder(cls, folder: dict) -> dict:
        folders = cls._load_folders()
        if not folder.get("id"):
            folder["id"] = "jfld-" + str(uuid.uuid4())[:8]
        for i, f in enumerate(folders):
            if f.get("id") == folder["id"]:
                folders[i] = folder
                cls._save_folders(folders)
                return folder
        folders.append(folder)
        cls._save_folders(folders)
        return folder

    @classmethod
    def delete_folder(cls, folder_id: str) -> bool:
        folders = cls._load_folders()
        before = len(folders)
        folders = [f for f in folders if f.get("id") != folder_id]
        if len(folders) == before:
            return False
        cls._save_folders(folders)
        # Убрать folder_id у джобов в этой папке
        jobs = cls._load_jobs()
        changed = False
        for j in jobs:
            if j.get("folder_id") == folder_id:
                j["folder_id"] = None
                changed = True
        if changed:
            cls._save_jobs(jobs)
        return True

    # ── History ──────────────────────────────────────────────────────────────

    @staticmethod
    def _load_history() -> list[dict]:
        if not _HISTORY_FILE.exists():
            return []
        with open(_HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save_history(history: list[dict]) -> None:
        _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)

    @classmethod
    def add_history(cls, entry: dict) -> None:
        if not entry.get("ts"):
            entry["ts"] = datetime.now(timezone.utc).isoformat()
        history = cls._load_history()
        history.insert(0, entry)
        history = history[:_HISTORY_MAX]
        cls._save_history(history)

    @classmethod
    def get_history(cls, limit: int = 30) -> list[dict]:
        return cls._load_history()[:limit]
