"""
Настройки генератора данных: какие схема и таблицы использовать.

Раньше имена таблиц были зашиты в пресете (tcs / tcsmember). На разных стендах
схема и названия отличаются, поэтому они вынесены в настройки: пользователь
выбирает их из того, что реально прочитано из базы.

Файл: data/datagen_config.json
"""

import json
import os
import tempfile
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "datagen_config.json"

# Значения по умолчанию — то, что было зашито в коде до появления настроек.
DEFAULT_TCS = {
    "connection_id":        "",
    "parent_table":         "tcs",
    "parent_id_column":     "id",
    "parent_label_column":  "nm",
    "parent_count_column":  "cnt",
    "child_table":          "tcsmember",
    "child_id_column":      "id",
    "child_fk_column":      "tcs",
    "child_marker_column":  "name",
    "marker":               "ТЕСТ",
}

# Что разрешено менять снаружи. Ключи вне списка игнорируются: настройки
# попадают в имена таблиц и колонок, поэтому произвольные поля сюда не пускаем.
_ALLOWED = set(DEFAULT_TCS)


class DatagenConfigStore:

    @staticmethod
    def _load() -> dict:
        if not _FILE.exists():
            return {}
        try:
            with open(_FILE, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError):
            # Битый файл не должен ронять раздел — работаем на умолчаниях.
            return {}

    @staticmethod
    def _save(data: dict) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        # Пишем через временный файл: обрыв на записи не оставит обрезанный JSON.
        fd, tmp = tempfile.mkstemp(dir=str(_FILE.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, _FILE)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    @classmethod
    def get_tcs(cls) -> dict:
        """Настройки сценария ТКС: сохранённые поверх умолчаний."""
        saved = cls._load().get("tcs") or {}
        cfg = dict(DEFAULT_TCS)
        cfg.update({k: v for k, v in saved.items() if k in _ALLOWED})
        return cfg

    @classmethod
    def save_tcs(cls, patch: dict) -> dict:
        data = cls._load()
        current = data.get("tcs") or {}
        for k, v in (patch or {}).items():
            if k in _ALLOWED:
                current[k] = (v or "").strip() if isinstance(v, str) else v
        data["tcs"] = current
        cls._save(data)
        return cls.get_tcs()

    @classmethod
    def reset_tcs(cls) -> dict:
        data = cls._load()
        data.pop("tcs", None)
        cls._save(data)
        return cls.get_tcs()
