"""
Хранилище подключений к внешним базам данных для поиска тестовых данных.

Файл: data/testdata_connections.json
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_CONNECTIONS_FILE = _ROOT / "data" / "testdata_connections.json"


class TestDataConnectionsStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _CONNECTIONS_FILE.exists():
            return []
        with open(_CONNECTIONS_FILE, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _save(connections: list[dict]) -> None:
        _CONNECTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_CONNECTIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(connections, f, ensure_ascii=False, indent=2)

    @classmethod
    def list_connections(cls) -> list[dict]:
        """Список подключений (пароль маскируется)."""
        conns = cls._load()
        result = []
        for c in conns:
            safe = {**c}
            if safe.get("password"):
                safe["password"] = "••••••••"
            result.append(safe)
        return result

    @classmethod
    def get_connection(cls, conn_id: str) -> Optional[dict]:
        """Получить подключение по ID (полное, с паролем)."""
        for c in cls._load():
            if c.get("id") == conn_id:
                return c
        return None

    @classmethod
    def get_connection_safe(cls, conn_id: str) -> Optional[dict]:
        """Получить подключение по ID (пароль маскирован)."""
        c = cls.get_connection(conn_id)
        if c and c.get("password"):
            c = {**c, "password": "••••••••"}
        return c

    @classmethod
    def create_connection(cls, data: dict) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        conn = {
            "id": uuid.uuid4().hex[:12],
            "display_name": data.get("display_name", "").strip(),
            "db_type": data.get("db_type", "postgresql"),  # postgresql, mysql, oracle
            "host": data.get("host", "localhost").strip(),
            "port": int(data.get("port", 5432)),
            "db_name": data.get("db_name", "").strip(),
            "login": data.get("login", "").strip(),
            "password": data.get("password", ""),
            "schema_name": data.get("schema_name", ""),  # Для Oracle: schema
            "created_at": now,
            "updated_at": now,
            # Кэш схемы (таблицы + колонки) — обновляется при introspect
            "cached_schema": None,
            "schema_updated_at": None,
        }
        connections = cls._load()
        connections.insert(0, conn)
        cls._save(connections)
        return conn

    @classmethod
    def update_connection(cls, conn_id: str, data: dict) -> Optional[dict]:
        connections = cls._load()
        for c in connections:
            if c.get("id") == conn_id:
                # Обновляем только переданные поля
                for field in ("display_name", "db_type", "host", "port",
                              "db_name", "login", "schema_name"):
                    if field in data:
                        c[field] = data[field]
                # Пароль обновляем только если он не маскированный
                if "password" in data and data["password"] != "••••••••":
                    c["password"] = data["password"]
                if "port" in data:
                    c["port"] = int(data["port"])
                c["updated_at"] = datetime.now(timezone.utc).isoformat()
                cls._save(connections)
                return c
        return None

    @classmethod
    def delete_connection(cls, conn_id: str) -> bool:
        connections = cls._load()
        before = len(connections)
        connections = [c for c in connections if c.get("id") != conn_id]
        if len(connections) == before:
            return False
        cls._save(connections)
        return True

    @classmethod
    def update_cached_schema(cls, conn_id: str, schema: dict) -> Optional[dict]:
        """Обновить кэш схемы после introspect."""
        connections = cls._load()
        for c in connections:
            if c.get("id") == conn_id:
                c["cached_schema"] = schema
                c["schema_updated_at"] = datetime.now(timezone.utc).isoformat()
                cls._save(connections)
                return c
        return None
