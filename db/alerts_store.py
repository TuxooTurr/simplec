"""
Хранилище alert-скриптов.

Файлы:
  data/alert_scripts.json   — скрипты (встроенные + пользовательские)
  data/alert_folders.json   — папки скриптов
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from typing import Optional
from db.paths import DATA_DIR

_ROOT = Path(__file__).resolve().parent.parent
_SCRIPTS_FILE  = DATA_DIR / "alert_scripts.json"
_FOLDERS_FILE  = DATA_DIR / "alert_folders.json"
_LOCK = RLock()


class AlertsStore:

    # ── Scripts ──────────────────────────────────────────────────────────────

    @staticmethod
    def _load_scripts() -> list[dict]:
        if not _SCRIPTS_FILE.exists():
            return []
        with open(_SCRIPTS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save_scripts(scripts: list[dict]) -> None:
        _SCRIPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", encoding="utf-8", dir=_SCRIPTS_FILE.parent, delete=False) as f:
            temp = Path(f.name)
            try:
                json.dump(scripts, f, ensure_ascii=False, indent=2)
                f.close()
                temp.replace(_SCRIPTS_FILE)
            finally:
                temp.unlink(missing_ok=True)

    @classmethod
    def get_scripts(cls) -> list[dict]:
        return cls._load_scripts()

    @classmethod
    def get_script(cls, script_id: str) -> Optional[dict]:
        for s in cls._load_scripts():
            if s.get("id") == script_id:
                return s
        return None

    @classmethod
    def save_script(cls, script: dict) -> dict:
        """Создать или обновить скрипт. Если id не задан — генерируем."""
        return cls.save_scripts([script])[0]

    @classmethod
    def save_scripts(cls, batch: list[dict]) -> list[dict]:
        with _LOCK:
            scripts = {s.get("id"): s for s in cls._load_scripts()}
            for script in batch:
                script["id"] = script.get("id") or uuid.uuid4().hex[:8]
                existing = scripts.get(script["id"], {})
                script["created_at"] = script.get("created_at") or existing.get("created_at") or datetime.now(timezone.utc).isoformat()
                scripts[script["id"]] = script
            cls._save_scripts(list(scripts.values()))
            return batch

    @classmethod
    def delete_script(cls, script_id: str) -> bool:
        """Удалить скрипт. Встроенные (builtin=true) удалять нельзя."""
        with _LOCK:
            scripts = cls._load_scripts()
            script = next((s for s in scripts if s.get("id") == script_id), None)
            if not script or script.get("builtin"):
                return False
            cls._save_scripts([s for s in scripts if s.get("id") != script_id])
            return True

    @classmethod
    def reorder_scripts(cls, ids: list[str]) -> list[dict]:
        """Порядок скриптов = порядок в файле. Переданные id встают в нужном порядке
        на те же места, что занимали (обычно — скрипты одной папки); остальные не двигаются."""
        with _LOCK:
            scripts = cls._load_scripts()
            by_id = {s.get("id"): s for s in scripts}
            wanted = [i for i in dict.fromkeys(ids) if i in by_id]
            selected = set(wanted)
            slots = [n for n, s in enumerate(scripts) if s.get("id") in selected]
            for slot, sid in zip(slots, wanted):
                scripts[slot] = by_id[sid]
            cls._save_scripts(scripts)
            return scripts

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
            folder["id"] = "fld-" + str(uuid.uuid4())[:8]
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
        with _LOCK:
            scripts = cls._load_scripts()
            moved = [s for s in scripts if s.get("folder_id") == folder_id]
            for s in moved:
                s["folder_id"] = None
            if moved:
                cls._save_scripts(scripts)
        return True
