"""
Сценарии сравнения LLM-моделей — сохранённые дефолты промпта и транскрибации.

При выборе сценария в "Тестировании моделей LLM" поля "Промпт" и "Транскрибация"
предзаполняются его значениями — пользователь может их заменить перед запуском,
дефолт только подставляется, ничего не блокирует.

Файл: data/model_bench_scenarios.json — тот же паттерн атомарной записи и
восстановления при битом JSON, что и в db/requirements_store.py.
"""

import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "model_bench_scenarios.json"
_MAX_ITEMS = 100


class ModelBenchScenariosStore:

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
                logger.warning("model_bench_scenarios.json битый, перемещён в %s", backup)
            except OSError:
                logger.warning("model_bench_scenarios.json битый и не удалось сохранить копию")
            return []

    @staticmethod
    def _save(items: list[dict]) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _FILE.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _FILE)

    @classmethod
    def list_scenarios(cls) -> list[dict]:
        return sorted(cls._load(), key=lambda i: i.get("created_at", ""), reverse=True)

    @classmethod
    def add_scenario(cls, name: str, prompt: str, transcript: str) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": name.strip(),
            "prompt": prompt,
            "transcript": transcript,
            "created_at": now,
        }
        items = cls._load()
        items.insert(0, item)
        items = items[:_MAX_ITEMS]
        cls._save(items)
        return item

    @classmethod
    def delete_scenario(cls, scenario_id: str) -> bool:
        items = cls._load()
        before = len(items)
        items = [i for i in items if i.get("id") != scenario_id]
        if len(items) == before:
            return False
        cls._save(items)
        return True
