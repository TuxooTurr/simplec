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
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_SCRIPTS_FILE  = _ROOT / "data" / "alert_scripts.json"
_FOLDERS_FILE  = _ROOT / "data" / "alert_folders.json"


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
        with open(_SCRIPTS_FILE, "w", encoding="utf-8") as f:
            json.dump(scripts, f, ensure_ascii=False, indent=2)

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
        scripts = cls._load_scripts()
        if not script.get("id"):
            script["id"] = str(uuid.uuid4())[:8]
        if not script.get("created_at"):
            script["created_at"] = datetime.now(timezone.utc).isoformat()
        # Обновить существующий
        for i, s in enumerate(scripts):
            if s.get("id") == script["id"]:
                scripts[i] = script
                cls._save_scripts(scripts)
                return script
        # Добавить новый
        scripts.append(script)
        cls._save_scripts(scripts)
        return script

    @classmethod
    def delete_script(cls, script_id: str) -> bool:
        """Удалить скрипт. Встроенные (builtin=true) удалять нельзя."""
        scripts = cls._load_scripts()
        for s in scripts:
            if s.get("id") == script_id:
                if s.get("builtin"):
                    return False   # нельзя удалить встроенный
                scripts = [x for x in scripts if x.get("id") != script_id]
                cls._save_scripts(scripts)
                return True
        return False

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
        scripts = cls._load_scripts()
        changed = False
        for s in scripts:
            if s.get("folder_id") == folder_id:
                s["folder_id"] = None
                changed = True
        if changed:
            cls._save_scripts(scripts)
        return True
