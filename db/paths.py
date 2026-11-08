"""
Где лежат данные приложения.

Обычно — папка `data/` в корне проекта. В мок-режиме (`SHARK_MOCK=1`) — `data_mock/`: моки Jira, TestOps и прочих
сервисов пишут в хранилища (снимок роадмапа, справочник людей, индекс Zephyr), и настоящие данные они трогать не должны.
`SHARK_DATA_DIR` задаёт папку явно (тесты, второй экземпляр).

Все хранилища берут путь отсюда — не собирайте `… / "data"` в модулях сами.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOCK = os.getenv("SHARK_MOCK", "").strip().lower() in ("1", "true", "yes", "on")
DATA_DIR = Path(os.getenv("SHARK_DATA_DIR") or (ROOT / ("data_mock" if MOCK else "data"))).expanduser().resolve()

MOCK_DB_FILE = DATA_DIR / "shark_mock.db"


def _prepare_mock_dir() -> None:
    """Первый запуск мок-режима: копия настоящих `data/` и SQLite-базы — экраны с локальными данными («Данные»,
    алерты, генераторы) выглядят как обычно, а всё, что моки потом запишут, останется в `data_mock/`.
    Начать с чистого листа — удалить папку `data_mock/`."""
    import shutil
    if DATA_DIR.exists():
        return
    real = ROOT / "data"
    if real.is_dir():
        shutil.copytree(real, DATA_DIR, ignore=shutil.ignore_patterns("backups", "*.tmp"))
    else:
        DATA_DIR.mkdir(parents=True)
    url = os.getenv("DATABASE_URL", "")
    if url.startswith("sqlite:///"):
        src = Path(url[len("sqlite:///"):])
        src = src if src.is_absolute() else ROOT / src
        if src.is_file():
            shutil.copy2(src, MOCK_DB_FILE)


if MOCK and not os.getenv("SHARK_DATA_DIR"):
    _prepare_mock_dir()
