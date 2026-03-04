"""
Настройки Kafka для Генератора метрик.
Хранятся в БД — переопределяют переменные окружения.
При переезде на Сбер-инфраструктуру достаточно обновить настройки через UI.
"""

import os
from datetime import datetime
from typing import Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.postgres import get_db
from db.metrics_models import MetricsSettings

router = APIRouter()

# Дефолтные значения — берём из .env, чтобы при первом запуске уже были заполнены
_DEFAULTS: Dict[str, Dict[str, str]] = {
    "kafka_bootstrap_servers": {
        "value":       os.getenv("KAFKA_BOOTSTRAP_SERVERS", ""),
        "description": "Адрес Kafka-брокера (host:port или host1:port1,host2:port2)",
    },
    "kafka_topic": {
        "value":       "metadata",
        "description": "Kafka-топик для отправки метрик (стенд Sber911 читает 'metadata')",
    },
    "kafka_security_protocol": {
        "value":       os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
        "description": "Протокол: PLAINTEXT · SASL_PLAINTEXT · SASL_SSL · SSL",
    },
    "kafka_sasl_mechanism": {
        "value":       os.getenv("KAFKA_SASL_MECHANISM", ""),
        "description": "SASL механизм: PLAIN · SCRAM-SHA-256 · SCRAM-SHA-512 · GSSAPI",
    },
    "kafka_sasl_username": {
        "value":       os.getenv("KAFKA_SASL_USERNAME", ""),
        "description": "SASL логин",
    },
    "kafka_sasl_password": {
        "value":       os.getenv("KAFKA_SASL_PASSWORD", ""),
        "description": "SASL пароль",
    },
    "kafka_ssl_cafile": {
        "value":       os.getenv("KAFKA_SSL_CAFILE", ""),
        "description": "Путь к CA-сертификату (для SSL/SASL_SSL)",
    },
    "metric_send_timeout_sec": {
        "value":       "10",
        "description": "Таймаут отправки одного сообщения в Kafka (секунды)",
    },
}


def _ensure_defaults(db: Session):
    """Заполнить дефолтные настройки при первом запуске (идемпотентно)."""
    for key, meta in _DEFAULTS.items():
        if not db.query(MetricsSettings).filter(MetricsSettings.key == key).first():
            db.add(MetricsSettings(key=key, value=meta["value"], description=meta["description"]))
    db.commit()


def get_kafka_config(db: Session) -> dict:
    """Вернуть текущую Kafka-конфигурацию из БД (для планировщика)."""
    _ensure_defaults(db)
    rows = {r.key: r.value or "" for r in db.query(MetricsSettings).all()}
    return {k: rows.get(k, meta["value"]) for k, meta in _DEFAULTS.items()}


@router.get("/api/metrics/settings")
def get_settings(db: Session = Depends(get_db)):
    _ensure_defaults(db)
    rows = db.query(MetricsSettings).order_by(MetricsSettings.key).all()
    return {
        r.key: {
            "value":       r.value or "",
            "description": r.description or "",
            "updatedAt":   r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    }


class SettingsUpdate(BaseModel):
    settings: Dict[str, str]


@router.put("/api/metrics/settings")
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    _ensure_defaults(db)
    for key, value in body.settings.items():
        row = db.query(MetricsSettings).filter(MetricsSettings.key == key).first()
        if row:
            row.value = value
            row.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True}
