"""
Хранилище требований — простой локальный список (без ChromaDB/эмбеддингов).

Раньше "эталоны" держали требования только в связке с готовым результатом
(требование → тест-кейс/автотест/дефект) в векторном хранилище — чтобы
подставить требование как контекст в другом месте (например, при регистрации
дефекта), надо было тянуть чужой пример целиком через RAG. Здесь — отдельная,
самостоятельная библиотека требований: имя, фича, текст. Ничего не эмбеддится,
поиск похожести не нужен — пользователь сам выбирает нужное требование из
списка (с фильтром по фиче) или вводит текст свободно.

Файл: data/requirements.json — локально на той машине/сервере, где запущен
бэкенд (не в облаке, без внешних зависимостей вроде huggingface.co).
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
_FILE = _ROOT / "data" / "requirements.json"
_MAX_ITEMS = 500


class RequirementsStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _FILE.exists():
            return []
        try:
            with open(_FILE, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            backup = _FILE.with_suffix(f".json.corrupted-{int(datetime.now().timestamp())}")
            try:
                shutil.move(str(_FILE), str(backup))
                logger.warning("requirements.json битый, перемещён в %s", backup)
            except OSError:
                logger.warning("requirements.json битый и не удалось сохранить копию")
            return []

    @staticmethod
    def _save(items: list[dict]) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _FILE.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _FILE)

    @classmethod
    def list_requirements(cls, feature: str = "") -> list[dict]:
        items = cls._load()
        if feature:
            f = feature.strip().lower()
            items = [i for i in items if f in str(i.get("feature", "")).lower()]
        return sorted(items, key=lambda i: i.get("created_at", ""), reverse=True)

    @classmethod
    def get_requirement(cls, req_id: str) -> Optional[dict]:
        for i in cls._load():
            if i.get("id") == req_id:
                return i
        return None

    @classmethod
    def add_requirement(cls, name: str, feature: str, text: str) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": name.strip(),
            "feature": feature.strip(),
            "text": text,
            "created_at": now,
            "updated_at": now,
        }
        items = cls._load()
        items.insert(0, item)
        items = items[:_MAX_ITEMS]
        cls._save(items)
        return item

    @classmethod
    def delete_requirement(cls, req_id: str) -> bool:
        items = cls._load()
        before = len(items)
        items = [i for i in items if i.get("id") != req_id]
        if len(items) == before:
            return False
        cls._save(items)
        return True
