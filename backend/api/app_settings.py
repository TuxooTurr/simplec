"""
Единая страница настроек приложения.

Хранит в таблице metrics_settings (key-value):
  - LLM API ключи и параметры моделей
  - Kafka-настройки для Алертов (отдельный брокер)

Kafka-настройки Метрик уже хранятся в metrics_settings через metrics_settings.py,
здесь добавляем только новые ключи (LLM + алерты Kafka).

На старте сервера apply_saved_settings_to_env() переносит сохранённые значения
в os.environ, чтобы LLMClient читал их через os.getenv() без изменений.
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

# ── Секретные поля — маскируются в GET ───────────────────────────────────────

_SECRET_FIELDS = {
    "gigachat_auth_key",
    "deepseek_api_key",
    "openai_api_key",
    "anthropic_api_key",
    "alerts_kafka_sasl_password",
    "kafka_sasl_password",
}

_MASKED_PLACEHOLDER = "●●●●●●●●●●●●"

# ── Дефолтные значения для новых ключей ──────────────────────────────────────

_DEFAULTS: Dict[str, Dict[str, str]] = {
    # LLM
    "gigachat_auth_key": {
        "value":       os.getenv("GIGACHAT_AUTH_KEY", ""),
        "description": "GigaChat AUTH_KEY (Base64-строка из личного кабинета)",
        "group":       "llm",
    },
    "gigachat_scope": {
        "value":       os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
        "description": "Scope: GIGACHAT_API_PERS (физ.лица) или GIGACHAT_API_CORP (юр.лица)",
        "group":       "llm",
    },
    "deepseek_api_key": {
        "value":       os.getenv("DEEPSEEK_API_KEY", ""),
        "description": "DeepSeek API Key (platform.deepseek.com → API keys)",
        "group":       "llm",
    },
    "deepseek_model": {
        "value":       os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "description": "Модель DeepSeek: deepseek-chat или deepseek-reasoner",
        "group":       "llm",
    },
    "openai_api_key": {
        "value":       os.getenv("OPENAI_API_KEY", ""),
        "description": "OpenAI API Key (platform.openai.com → API keys)",
        "group":       "llm",
    },
    "openai_model": {
        "value":       os.getenv("OPENAI_MODEL", "gpt-4o"),
        "description": "Модель OpenAI: gpt-4o, gpt-4o-mini, o1, o3-mini и др.",
        "group":       "llm",
    },
    "anthropic_api_key": {
        "value":       os.getenv("ANTHROPIC_API_KEY", ""),
        "description": "Anthropic API Key (console.anthropic.com → API keys)",
        "group":       "llm",
    },
    "anthropic_model": {
        "value":       os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        "description": "Модель Claude: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5 и др.",
        "group":       "llm",
    },
    "ollama_model": {
        "value":       os.getenv("OLLAMA_MODEL", "llama3.1"),
        "description": "Модель Ollama (должна быть загружена: ollama pull <model>)",
        "group":       "llm",
    },
    "lmstudio_url": {
        "value":       os.getenv("LMSTUDIO_URL", "http://localhost:1234/v1"),
        "description": "LM Studio API URL (Local Server → копируй URL из интерфейса)",
        "group":       "llm",
    },
    "lmstudio_model": {
        "value":       os.getenv("LMSTUDIO_MODEL", "local-model"),
        "description": "Идентификатор модели LM Studio",
        "group":       "llm",
    },
    # Kafka Алерты
    "alerts_kafka_bootstrap_servers": {
        "value":       os.getenv("ALERTS_KAFKA_BOOTSTRAP_SERVERS", ""),
        "description": "Kafka-брокер для алертов (host:port или host1:port1,host2:port2)",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_security_protocol": {
        "value":       os.getenv("ALERTS_KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
        "description": "Протокол: PLAINTEXT · SASL_PLAINTEXT · SASL_SSL · SSL",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_sasl_mechanism": {
        "value":       os.getenv("ALERTS_KAFKA_SASL_MECHANISM", ""),
        "description": "SASL механизм: PLAIN · SCRAM-SHA-256 · SCRAM-SHA-512 · GSSAPI",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_sasl_username": {
        "value":       os.getenv("ALERTS_KAFKA_SASL_USERNAME", ""),
        "description": "SASL логин",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_sasl_password": {
        "value":       os.getenv("ALERTS_KAFKA_SASL_PASSWORD", ""),
        "description": "SASL пароль",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_ssl_cafile": {
        "value":       os.getenv("ALERTS_KAFKA_SSL_CAFILE", ""),
        "description": "Путь к CA-сертификату (для SSL/SASL_SSL)",
        "group":       "kafka_alerts",
    },
}

# Маппинг: ключ настройки → env-переменная (для apply_saved_settings_to_env)
_ENV_MAP: Dict[str, str] = {
    "gigachat_auth_key":              "GIGACHAT_AUTH_KEY",
    "gigachat_scope":                 "GIGACHAT_SCOPE",
    "deepseek_api_key":               "DEEPSEEK_API_KEY",
    "deepseek_model":                 "DEEPSEEK_MODEL",
    "openai_api_key":                 "OPENAI_API_KEY",
    "openai_model":                   "OPENAI_MODEL",
    "anthropic_api_key":              "ANTHROPIC_API_KEY",
    "anthropic_model":                "ANTHROPIC_MODEL",
    "ollama_model":                   "OLLAMA_MODEL",
    "lmstudio_url":                   "LMSTUDIO_URL",
    "lmstudio_model":                 "LMSTUDIO_MODEL",
    "alerts_kafka_bootstrap_servers": "ALERTS_KAFKA_BOOTSTRAP_SERVERS",
    "alerts_kafka_security_protocol": "ALERTS_KAFKA_SECURITY_PROTOCOL",
    "alerts_kafka_sasl_mechanism":    "ALERTS_KAFKA_SASL_MECHANISM",
    "alerts_kafka_sasl_username":     "ALERTS_KAFKA_SASL_USERNAME",
    "alerts_kafka_sasl_password":     "ALERTS_KAFKA_SASL_PASSWORD",
    "alerts_kafka_ssl_cafile":        "ALERTS_KAFKA_SSL_CAFILE",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_defaults(db: Session) -> None:
    """Создать записи с дефолтными значениями при первом запуске (идемпотентно)."""
    for key, meta in _DEFAULTS.items():
        if not db.query(MetricsSettings).filter(MetricsSettings.key == key).first():
            db.add(MetricsSettings(
                key=key,
                value=meta["value"],
                description=meta["description"],
            ))
    db.commit()


def apply_saved_settings_to_env(db: Session) -> None:
    """
    При старте сервера: применить сохранённые настройки к os.environ,
    чтобы LLMClient и другие компоненты читали актуальные значения через os.getenv().
    """
    _ensure_defaults(db)
    rows = {r.key: r.value or "" for r in db.query(MetricsSettings).all()}
    for sk, ev in _ENV_MAP.items():
        val = rows.get(sk, "")
        if val:
            os.environ[ev] = val


def get_alerts_kafka_config(db: Session) -> dict:
    """
    Вернуть Kafka-конфиг для алертов из БД.
    Используется в alerts.py для передачи в KafkaClient.send(kafka_cfg=...).
    Если bootstrap_servers пустой — вернуть None (fallback на os.getenv).
    """
    rows = {r.key: r.value or "" for r in db.query(MetricsSettings).all()}
    bootstrap = rows.get("alerts_kafka_bootstrap_servers", "")
    if not bootstrap:
        return {}
    return {
        "kafka_bootstrap_servers":  bootstrap,
        "kafka_security_protocol":  rows.get("alerts_kafka_security_protocol", "PLAINTEXT"),
        "kafka_sasl_mechanism":     rows.get("alerts_kafka_sasl_mechanism", ""),
        "kafka_sasl_username":      rows.get("alerts_kafka_sasl_username", ""),
        "kafka_sasl_password":      rows.get("alerts_kafka_sasl_password", ""),
        "kafka_ssl_cafile":         rows.get("alerts_kafka_ssl_cafile", ""),
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    """
    Вернуть все настройки приложения.
    Секретные поля (ключи API, пароли) возвращаются замаскированными,
    если значение не пустое.
    """
    _ensure_defaults(db)

    # Загружаем новые ключи (app_settings) + существующие (metrics_settings)
    rows = {r.key: r for r in db.query(MetricsSettings).all()}

    result: dict = {}

    # Наши ключи с group-метаданными
    for key, meta in _DEFAULTS.items():
        row = rows.get(key)
        raw_value = (row.value or "") if row else meta["value"]
        is_secret = key in _SECRET_FIELDS
        display_value = _MASKED_PLACEHOLDER if (is_secret and raw_value) else raw_value
        result[key] = {
            "value":       display_value,
            "description": meta["description"],
            "group":       meta["group"],
            "updatedAt":   row.updated_at.isoformat() if row and row.updated_at else None,
        }

    # Существующие metrics/kafka ключи (из metrics_settings.py)
    from backend.api.metrics_settings import _DEFAULTS as METRICS_DEFAULTS
    for key, meta in METRICS_DEFAULTS.items():
        row = rows.get(key)
        raw_value = (row.value or "") if row else meta["value"]
        is_secret = key in _SECRET_FIELDS
        display_value = _MASKED_PLACEHOLDER if (is_secret and raw_value) else raw_value
        result[key] = {
            "value":       display_value,
            "description": meta["description"],
            "group":       "kafka_metrics",
            "updatedAt":   row.updated_at.isoformat() if row and row.updated_at else None,
        }

    return result


class SettingsUpdate(BaseModel):
    settings: Dict[str, str]


@router.put("/api/settings")
def save_settings(body: SettingsUpdate, db: Session = Depends(get_db)) -> dict:
    """
    Сохранить настройки в БД и обновить os.environ.
    Пустые строки для секретных полей игнорируются (не перезатирают существующий ключ).
    Маскированные placeholder-значения тоже игнорируются.
    """
    _ensure_defaults(db)

    for key, value in body.settings.items():
        # Игнорировать placeholder маскировки
        if value == _MASKED_PLACEHOLDER:
            continue
        # Игнорировать пустые значения для секретных полей
        if key in _SECRET_FIELDS and not value.strip():
            continue

        row = db.query(MetricsSettings).filter(MetricsSettings.key == key).first()
        if row:
            row.value = value
            row.updated_at = datetime.utcnow()
        else:
            # Новый ключ (не должно быть, но на всякий случай)
            db.add(MetricsSettings(key=key, value=value))

    db.commit()

    # Применить изменения к os.environ
    rows = {r.key: r.value or "" for r in db.query(MetricsSettings).all()}
    for sk, ev in _ENV_MAP.items():
        val = rows.get(sk, "")
        if val:
            os.environ[ev] = val

    return {"ok": True}
