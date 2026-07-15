"""
Реестр именованных Kafka-подключений для «Просмотра Kafka».

Каждая команда заводит своё подключение (имя + bootstrap + протокол + опц.
SASL/SSL) и выбирает его из дропдауна — отсюда «вариативность для других команд».
Файл: data/kafka_explorer_connections.json. Пароль маскируется при чтении.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
_FILE = _ROOT / "data" / "kafka_explorer_connections.json"

_MASK = "••••••••"
_FIELDS = (
    "name", "bootstrap_servers", "security_protocol",
    "sasl_mechanism", "sasl_username",
    "ssl_cafile", "ssl_certfile", "ssl_keyfile",
)

# Обязательное подключение проекта: создаётся автоматически, если файла
# подключений ещё нет (свежий клон / первый запуск). Без секретов — PLAINTEXT.
# Удалённое пользователем подключение повторно не создаётся (файл уже существует).
_SEED_CONNECTIONS = [
    {
        "id": "ift-delta-default",
        "name": "ИФТ ПКАП (delta)",
        "bootstrap_servers": "tvldq-sber00010.delta.sbrf.ru:9092,tvldq-sber00011.delta.sbrf.ru:9092",
        "security_protocol": "PLAINTEXT",
        "sasl_mechanism": "",
        "sasl_username": "",
        "sasl_password": "",
        "ssl_cafile": "",
        "ssl_certfile": "",
        "ssl_keyfile": "",
        "ssl_verify": True,
        "default_limit": 50,
        "created_at": "2026-07-14T00:00:00+00:00",
        "updated_at": "2026-07-14T00:00:00+00:00",
    },
]


class KafkaExplorerStore:

    @staticmethod
    def _load() -> list[dict]:
        if not _FILE.exists():
            seeded = [dict(c) for c in _SEED_CONNECTIONS]
            KafkaExplorerStore._save(seeded)
            return seeded
        try:
            with open(_FILE, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []

    @staticmethod
    def _save(items: list[dict]) -> None:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)

    @staticmethod
    def _mask(conn: dict) -> dict:
        safe = {**conn}
        if safe.get("sasl_password"):
            safe["sasl_password"] = _MASK
        return safe

    @classmethod
    def list_connections(cls) -> list[dict]:
        return [cls._mask(c) for c in cls._load()]

    @classmethod
    def get_connection(cls, conn_id: str) -> Optional[dict]:
        """Полное подключение (с паролем) — для подключения к брокеру."""
        for c in cls._load():
            if c.get("id") == conn_id:
                return c
        return None

    @classmethod
    def create_connection(cls, data: dict) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        conn = {
            "id": uuid.uuid4().hex[:12],
            "name": str(data.get("name", "")).strip() or "Kafka",
            "bootstrap_servers": str(data.get("bootstrap_servers", "")).strip(),
            "security_protocol": str(data.get("security_protocol", "PLAINTEXT")).strip().upper() or "PLAINTEXT",
            "sasl_mechanism": str(data.get("sasl_mechanism", "")).strip(),
            "sasl_username": str(data.get("sasl_username", "")).strip(),
            "sasl_password": data.get("sasl_password", "") or "",
            "ssl_cafile": str(data.get("ssl_cafile", "")).strip(),
            "ssl_certfile": str(data.get("ssl_certfile", "")).strip(),
            "ssl_keyfile": str(data.get("ssl_keyfile", "")).strip(),
            "ssl_verify": bool(data.get("ssl_verify", True)),
            "default_limit": int(data.get("default_limit", 50) or 50),
            "created_at": now,
            "updated_at": now,
        }
        items = cls._load()
        items.insert(0, conn)
        cls._save(items)
        return cls._mask(conn)

    @classmethod
    def update_connection(cls, conn_id: str, data: dict) -> Optional[dict]:
        items = cls._load()
        for c in items:
            if c.get("id") == conn_id:
                for field in _FIELDS:
                    if field in data and data[field] is not None:
                        val = data[field]
                        c[field] = str(val).strip().upper() if field == "security_protocol" else str(val).strip()
                if "ssl_verify" in data and data["ssl_verify"] is not None:
                    c["ssl_verify"] = bool(data["ssl_verify"])
                if "default_limit" in data and data["default_limit"]:
                    c["default_limit"] = int(data["default_limit"])
                # Пароль обновляем только если он НЕ маскированный
                if "sasl_password" in data and data["sasl_password"] != _MASK:
                    c["sasl_password"] = data["sasl_password"] or ""
                c["updated_at"] = datetime.now(timezone.utc).isoformat()
                cls._save(items)
                return cls._mask(c)
        return None

    @classmethod
    def delete_connection(cls, conn_id: str) -> bool:
        items = cls._load()
        before = len(items)
        items = [c for c in items if c.get("id") != conn_id]
        if len(items) == before:
            return False
        cls._save(items)
        return True

    @staticmethod
    def to_kafka_cfg(conn: dict) -> dict:
        """Маппинг записи реестра → kafka_*-конфиг, который понимает KafkaClient."""
        return {
            "kafka_bootstrap_servers": conn.get("bootstrap_servers", ""),
            "kafka_security_protocol": conn.get("security_protocol", "PLAINTEXT"),
            "kafka_sasl_mechanism": conn.get("sasl_mechanism", ""),
            "kafka_sasl_username": conn.get("sasl_username", ""),
            "kafka_sasl_password": conn.get("sasl_password", ""),
            "kafka_ssl_cafile": conn.get("ssl_cafile", ""),
            "kafka_ssl_certfile": conn.get("ssl_certfile", ""),
            "kafka_ssl_keyfile": conn.get("ssl_keyfile", ""),
            "kafka_ssl_verify": conn.get("ssl_verify", True),
        }
