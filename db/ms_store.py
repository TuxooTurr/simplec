"""
Справочник микросервисов графика стендов (выпадающий список в форме брони) — файл data/ms_catalog.json.

С 22.10.2026 на графике бронируют микросервисы, а не КЭ. Справочник КЭ (db/ke_store.py) остаётся как есть —
его переиспользуют в другом месте. Механика та же: один на оба стенда и на всех, кто работает с этим SimpleTest;
создаётся из формы брони или правится списком в настройках стенда; базовый список — db/ms_catalog_default.json
(репозитории платформы, 22.10.2026; дописывается один раз, удалённое руками не возвращается).
Описания репозиториев — db/ms_catalog_info.json: подсказка в выпадающем списке (по имени вроде «pkap-zno-integ-ms»
выбирать тяжело), поиск идёт и по описанию. У созданных руками описания нет.
"""

from __future__ import annotations

import json
from pathlib import Path

from db import ke_store

_ROOT = Path(__file__).resolve().parent.parent
MS_FILE = _ROOT / "data" / "ms_catalog.json"
DEFAULT_FILE = Path(__file__).resolve().parent / "ms_catalog_default.json"
INFO_FILE = Path(__file__).resolve().parent / "ms_catalog_info.json"

clean = ke_store.clean
key = ke_store.ke_key


def load() -> list[str]:
    return ke_store.load_at(MS_FILE, DEFAULT_FILE)


def add(names: list[str]) -> list[str]:
    return ke_store.add_at(MS_FILE, DEFAULT_FILE, names)


def replace(names: list[str]) -> list[str]:
    return ke_store.replace_at(MS_FILE, DEFAULT_FILE, names)


def info() -> dict[str, str]:
    """Описания микросервисов: имя → описание (из репозитория)."""
    try:
        data = json.loads(INFO_FILE.read_text("utf-8"))
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}
