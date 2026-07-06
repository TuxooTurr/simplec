"""
Единый реестр JDBC-драйверов для подключения к внешним БД — как в DBeaver.

Все типы БД (PostgreSQL, MySQL, Oracle, и любые пользовательские) подключаются
через один и тот же механизм: класс драйвера + шаблон JDBC URL + .jar-библиотека,
загружаемая в общую JVM (см. backend/api/db_connector.py).

Встроенные драйверы (PostgreSQL/MySQL/Oracle) заранее прописаны с типовыми
настройками (класс, URL-шаблон, порт по умолчанию) — пользователю остаётся
только указать .jar во вкладке «Библиотека». Их нельзя удалить, но можно
изменить настройки и заменить/убрать библиотеку.

Библиотеку можно подключить двумя способами:
  • jar_path      — путь к .jar на машине (рекомендуется): файл не копируется,
                    указывается ссылкой; заменить драйвер = поменять файл по пути;
  • jar_filename  — .jar, загруженный через UI и сохранённый в data/jdbc_drivers/.
jar_path имеет приоритет над jar_filename.

Файлы: data/jdbc_drivers.json (метаданные), data/jdbc_drivers/ (загруженные .jar).
"""

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_DRIVERS_FILE = _ROOT / "data" / "jdbc_drivers.json"
_JARS_DIR = _ROOT / "data" / "jdbc_drivers"

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")

BUILTIN_DRIVERS: list[dict] = [
    {
        "id": "builtin-postgresql",
        "name": "PostgreSQL",
        "driver_class": "org.postgresql.Driver",
        "url_template": "jdbc:postgresql://{host}:{port}/{db_name}",
        "default_port": 5432,
        "default_db_name": "postgres",
        "default_login": "postgres",
        "sql_dialect": "postgresql",
    },
    {
        "id": "builtin-mysql",
        "name": "MySQL",
        "driver_class": "com.mysql.cj.jdbc.Driver",
        "url_template": "jdbc:mysql://{host}:{port}/{db_name}",
        "default_port": 3306,
        "default_db_name": "",
        "default_login": "root",
        "sql_dialect": "mysql",
    },
    {
        "id": "builtin-oracle",
        "name": "Oracle",
        "driver_class": "oracle.jdbc.OracleDriver",
        "url_template": "jdbc:oracle:thin:@//{host}:{port}/{db_name}",
        "default_port": 1521,
        "default_db_name": "",
        "default_login": "system",
        "sql_dialect": "oracle",
    },
]


def _sanitize_filename(name: str) -> str:
    return _SAFE_NAME.sub("_", name) or "driver.jar"


class JdbcDriversStore:

    @staticmethod
    def _load_raw() -> list[dict]:
        if not _DRIVERS_FILE.exists():
            return []
        with open(_DRIVERS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save(drivers: list[dict]) -> None:
        _DRIVERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_DRIVERS_FILE, "w", encoding="utf-8") as f:
            json.dump(drivers, f, ensure_ascii=False, indent=2)

    @classmethod
    def _load(cls) -> list[dict]:
        """Читает драйверы с диска, досеивая встроенные (PostgreSQL/MySQL/Oracle), если их ещё нет."""
        drivers = cls._load_raw()
        existing_ids = {d.get("id") for d in drivers}
        missing = [b for b in BUILTIN_DRIVERS if b["id"] not in existing_ids]
        if missing:
            now = datetime.now(timezone.utc).isoformat()
            seeded = [
                {**b, "jar_filename": None, "jar_path": None, "original_filename": None, "built_in": True, "created_at": now}
                for b in missing
            ]
            drivers = seeded + drivers
            cls._save(drivers)
        return drivers

    @classmethod
    def list_drivers(cls) -> list[dict]:
        return cls._load()

    @classmethod
    def get_driver(cls, driver_id: str) -> Optional[dict]:
        for d in cls._load():
            if d.get("id") == driver_id:
                return d
        return None

    @classmethod
    def jar_path(cls, driver: dict) -> Optional[Path]:
        """Абсолютный путь к .jar драйвера. Приоритет — внешний путь (jar_path),
        иначе загруженный в data/jdbc_drivers/ файл (jar_filename)."""
        external = driver.get("jar_path")
        if external:
            return Path(external)
        if driver.get("jar_filename"):
            return _JARS_DIR / driver["jar_filename"]
        return None

    @staticmethod
    def has_library(driver: dict) -> bool:
        return bool(driver.get("jar_path") or driver.get("jar_filename"))

    @staticmethod
    def library_label(driver: dict) -> Optional[str]:
        """Что показать в UI как имя подключённой библиотеки."""
        if driver.get("jar_path"):
            return driver["jar_path"]
        return driver.get("original_filename")

    @classmethod
    def create_driver(cls, data: dict) -> dict:
        """Создать новый пользовательский драйвер (без библиотеки — она добавляется отдельно)."""
        now = datetime.now(timezone.utc).isoformat()
        driver = {
            "id": uuid.uuid4().hex[:12],
            "name": data.get("name", "").strip(),
            "driver_class": data.get("driver_class", "").strip(),
            "url_template": data.get("url_template", "").strip(),
            "default_port": int(data["default_port"]) if data.get("default_port") else None,
            "default_db_name": data.get("default_db_name", "").strip(),
            "default_login": data.get("default_login", "").strip(),
            "sql_dialect": "generic",
            "jar_filename": None,
            "jar_path": None,
            "original_filename": None,
            "built_in": False,
            "created_at": now,
        }
        drivers = cls._load()
        drivers.insert(0, driver)
        cls._save(drivers)
        return driver

    @classmethod
    def update_driver(cls, driver_id: str, data: dict) -> Optional[dict]:
        """Обновить настройки драйвера (вкладка «Настройки») — доступно и для встроенных."""
        drivers = cls._load()
        for d in drivers:
            if d.get("id") == driver_id:
                for field in ("name", "driver_class", "url_template", "default_db_name", "default_login"):
                    if field in data:
                        d[field] = data[field].strip() if isinstance(data[field], str) else data[field]
                if "default_port" in data:
                    d["default_port"] = int(data["default_port"]) if data["default_port"] else None
                cls._save(drivers)
                return d
        return None

    @classmethod
    def _unlink_uploaded(cls, driver: dict) -> None:
        """Удалить ранее загруженный (скопированный в data/jdbc_drivers/) .jar, если он есть."""
        if driver.get("jar_filename"):
            uploaded = _JARS_DIR / driver["jar_filename"]
            if uploaded.exists():
                uploaded.unlink()

    @classmethod
    def set_library(cls, driver_id: str, jar_bytes: bytes, original_filename: str) -> Optional[dict]:
        """Загрузить/заменить .jar драйвера через UI (файл копируется в data/jdbc_drivers/)."""
        drivers = cls._load()
        for d in drivers:
            if d.get("id") == driver_id:
                cls._unlink_uploaded(d)
                jar_filename = f"{driver_id}_{_sanitize_filename(original_filename)}"
                _JARS_DIR.mkdir(parents=True, exist_ok=True)
                with open(_JARS_DIR / jar_filename, "wb") as f:
                    f.write(jar_bytes)
                d["jar_filename"] = jar_filename
                d["jar_path"] = None           # загруженный файл вытесняет внешний путь
                d["original_filename"] = original_filename
                cls._save(drivers)
                return d
        return None

    @classmethod
    def set_library_path(cls, driver_id: str, path: str) -> Optional[dict]:
        """Указать .jar по пути на машине (без копирования — рекомендуемый способ)."""
        path = path.strip()
        drivers = cls._load()
        for d in drivers:
            if d.get("id") == driver_id:
                cls._unlink_uploaded(d)         # если раньше был загруженный файл — уберём копию
                d["jar_filename"] = None
                d["jar_path"] = path
                d["original_filename"] = Path(path).name
                cls._save(drivers)
                return d
        return None

    @classmethod
    def remove_library(cls, driver_id: str) -> Optional[dict]:
        drivers = cls._load()
        for d in drivers:
            if d.get("id") == driver_id:
                cls._unlink_uploaded(d)
                d["jar_filename"] = None
                d["jar_path"] = None            # внешний файл по пути НЕ удаляем — он не наш
                d["original_filename"] = None
                cls._save(drivers)
                return d
        return None

    @classmethod
    def delete_driver(cls, driver_id: str) -> bool:
        """Удалить пользовательский драйвер целиком. Встроенные драйверы удалить нельзя —
        для них можно только очистить библиотеку (remove_library)."""
        drivers = cls._load()
        target = next((d for d in drivers if d.get("id") == driver_id), None)
        if not target or target.get("built_in"):
            return False
        drivers = [d for d in drivers if d.get("id") != driver_id]
        cls._save(drivers)
        cls._unlink_uploaded(target)   # чистим только нашу копию; внешний .jar по пути не трогаем
        return True
