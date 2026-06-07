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

import json
import os
import re
from datetime import datetime
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.postgres import get_db
from db.metrics_models import MetricsSettings

router = APIRouter()

# ── Секретные поля — маскируются в GET ───────────────────────────────────────

_SECRET_FIELDS = {
    "gigachat_auth_key",
    "deepseek_api_key",
    "alerts_kafka_sasl_password",
    "alerts_kafka_ssl_password",
    "kafka_sasl_password",
    "kafka_ssl_password",
}

_MASKED_PLACEHOLDER = "●●●●●●●●●●●●"
_CUSTOM_LLM_KEY = "custom_llm_providers"
_REVISOR_STANDS_KEY = "revisor_api_stands"
_LOGS_VPS_KEY = "logs_vps_connections"
_AUTH_TYPE_FIELDS = {"gigachat_auth_type", "deepseek_auth_type"}

# ── Дефолтные значения для новых ключей ──────────────────────────────────────

_DEFAULTS: Dict[str, Dict[str, str]] = {
    # LLM
    "gigachat_auth_type": {
        "value":       os.getenv("GIGACHAT_AUTH_TYPE", "api_key"),
        "description": "Тип подключения GigaChat: api_key или certificate",
        "group":       "llm",
    },
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
    "gigachat_base_url": {
        "value":       os.getenv("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1"),
        "description": "Base URL GigaChat API",
        "group":       "llm",
    },
    "gigachat_auth_url": {
        "value":       os.getenv("GIGACHAT_AUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
        "description": "OAuth URL GigaChat для режима API key",
        "group":       "llm",
    },
    "gigachat_model": {
        "value":       os.getenv("GIGACHAT_MODEL", "GigaChat"),
        "description": "Модель GigaChat",
        "group":       "llm",
    },
    "gigachat_ca_cert_path": {
        "value":       os.getenv("GIGACHAT_CA_CERT_PATH", ""),
        "description": "Путь к CA bundle для GigaChat",
        "group":       "llm",
    },
    "gigachat_client_cert_path": {
        "value":       os.getenv("GIGACHAT_CLIENT_CERT_PATH", ""),
        "description": "Путь к клиентскому сертификату GigaChat",
        "group":       "llm",
    },
    "gigachat_client_key_path": {
        "value":       os.getenv("GIGACHAT_CLIENT_KEY_PATH", ""),
        "description": "Путь к приватному ключу клиентского сертификата GigaChat",
        "group":       "llm",
    },
    "deepseek_auth_type": {
        "value":       os.getenv("DEEPSEEK_AUTH_TYPE", "api_key"),
        "description": "Тип подключения DeepSeek: api_key или certificate",
        "group":       "llm",
    },
    "deepseek_api_key": {
        "value":       os.getenv("DEEPSEEK_API_KEY", ""),
        "description": "DeepSeek API Key (platform.deepseek.com → API keys)",
        "group":       "llm",
    },
    "deepseek_base_url": {
        "value":       os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        "description": "Base URL DeepSeek/chat-completions endpoint",
        "group":       "llm",
    },
    "deepseek_model": {
        "value":       os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "description": "Модель DeepSeek: deepseek-chat или deepseek-reasoner",
        "group":       "llm",
    },
    "deepseek_ca_cert_path": {
        "value":       os.getenv("DEEPSEEK_CA_CERT_PATH", ""),
        "description": "Путь к CA bundle для DeepSeek",
        "group":       "llm",
    },
    "deepseek_client_cert_path": {
        "value":       os.getenv("DEEPSEEK_CLIENT_CERT_PATH", ""),
        "description": "Путь к клиентскому сертификату DeepSeek",
        "group":       "llm",
    },
    "deepseek_client_key_path": {
        "value":       os.getenv("DEEPSEEK_CLIENT_KEY_PATH", ""),
        "description": "Путь к приватному ключу клиентского сертификата DeepSeek",
        "group":       "llm",
    },
    _CUSTOM_LLM_KEY: {
        "value":       os.getenv("CUSTOM_LLM_PROVIDERS", "[]"),
        "description": "Пользовательские chat/completions-compatible LLM подключения",
        "group":       "llm_custom",
    },
    _REVISOR_STANDS_KEY: {
        "value":       os.getenv("REVISOR_API_STANDS", "[]"),
        "description": "API-подключения стендов Ревизора и выбранные методы сравнения",
        "group":       "revisor",
    },
    _LOGS_VPS_KEY: {
        "value":       os.getenv("LOGS_VPS_CONNECTIONS", "[]"),
        "description": "Подключения к VPS-платформам агрегации логов (Graylog, Elastic, Loki)",
        "group":       "logs_vps",
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
    "alerts_kafka_ssl_certfile": {
        "value":       os.getenv("ALERTS_KAFKA_SSL_CERTFILE", ""),
        "description": "Путь к клиентскому сертификату Kafka алертов (для mTLS)",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_ssl_keyfile": {
        "value":       os.getenv("ALERTS_KAFKA_SSL_KEYFILE", ""),
        "description": "Путь к приватному ключу клиентского сертификата Kafka алертов",
        "group":       "kafka_alerts",
    },
    "alerts_kafka_ssl_password": {
        "value":       os.getenv("ALERTS_KAFKA_SSL_PASSWORD", ""),
        "description": "Пароль приватного ключа Kafka алертов, если ключ зашифрован",
        "group":       "kafka_alerts",
    },
    # Ферма мобильных устройств (встроенная)
    "farm_enabled": {
        "value":       os.getenv("FARM_ENABLED", "false"),
        "description": "Включить ферму устройств",
        "group":       "farm",
    },
    "farm_max_sessions_per_user": {
        "value":       os.getenv("FARM_MAX_SESSIONS_PER_USER", "3"),
        "description": "Максимум активных сессий на пользователя",
        "group":       "farm",
    },
    "farm_session_timeout_min": {
        "value":       os.getenv("FARM_SESSION_TIMEOUT_MIN", "30"),
        "description": "Таймаут сессии (минуты)",
        "group":       "farm",
    },
}

# Маппинг: ключ настройки → env-переменная (для apply_saved_settings_to_env)
_ENV_MAP: Dict[str, str] = {
    "gigachat_auth_type":             "GIGACHAT_AUTH_TYPE",
    "gigachat_auth_key":              "GIGACHAT_AUTH_KEY",
    "gigachat_scope":                 "GIGACHAT_SCOPE",
    "gigachat_base_url":              "GIGACHAT_BASE_URL",
    "gigachat_auth_url":              "GIGACHAT_AUTH_URL",
    "gigachat_model":                 "GIGACHAT_MODEL",
    "gigachat_ca_cert_path":          "GIGACHAT_CA_CERT_PATH",
    "gigachat_client_cert_path":      "GIGACHAT_CLIENT_CERT_PATH",
    "gigachat_client_key_path":       "GIGACHAT_CLIENT_KEY_PATH",
    "deepseek_auth_type":             "DEEPSEEK_AUTH_TYPE",
    "deepseek_api_key":               "DEEPSEEK_API_KEY",
    "deepseek_base_url":              "DEEPSEEK_BASE_URL",
    "deepseek_model":                 "DEEPSEEK_MODEL",
    "deepseek_ca_cert_path":          "DEEPSEEK_CA_CERT_PATH",
    "deepseek_client_cert_path":      "DEEPSEEK_CLIENT_CERT_PATH",
    "deepseek_client_key_path":       "DEEPSEEK_CLIENT_KEY_PATH",
    _CUSTOM_LLM_KEY:                  "CUSTOM_LLM_PROVIDERS",
    _REVISOR_STANDS_KEY:              "REVISOR_API_STANDS",
    "alerts_kafka_bootstrap_servers": "ALERTS_KAFKA_BOOTSTRAP_SERVERS",
    "alerts_kafka_security_protocol": "ALERTS_KAFKA_SECURITY_PROTOCOL",
    "alerts_kafka_sasl_mechanism":    "ALERTS_KAFKA_SASL_MECHANISM",
    "alerts_kafka_sasl_username":     "ALERTS_KAFKA_SASL_USERNAME",
    "alerts_kafka_sasl_password":     "ALERTS_KAFKA_SASL_PASSWORD",
    "alerts_kafka_ssl_cafile":        "ALERTS_KAFKA_SSL_CAFILE",
    "alerts_kafka_ssl_certfile":      "ALERTS_KAFKA_SSL_CERTFILE",
    "alerts_kafka_ssl_keyfile":       "ALERTS_KAFKA_SSL_KEYFILE",
    "alerts_kafka_ssl_password":      "ALERTS_KAFKA_SSL_PASSWORD",
    "farm_enabled":                   "FARM_ENABLED",
    "farm_max_sessions_per_user":     "FARM_MAX_SESSIONS_PER_USER",
    "farm_session_timeout_min":       "FARM_SESSION_TIMEOUT_MIN",
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


def _load_custom_llm_providers(db: Session) -> list[dict]:
    row = db.query(MetricsSettings).filter(MetricsSettings.key == _CUSTOM_LLM_KEY).first()
    raw = row.value if row and row.value else "[]"
    try:
        data = json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save_custom_llm_providers(db: Session, providers: list[dict]) -> None:
    raw = json.dumps(providers, ensure_ascii=False)
    row = db.query(MetricsSettings).filter(MetricsSettings.key == _CUSTOM_LLM_KEY).first()
    if row:
        row.value = raw
        row.updated_at = datetime.utcnow()
    else:
        db.add(MetricsSettings(
            key=_CUSTOM_LLM_KEY,
            value=raw,
            description=_DEFAULTS[_CUSTOM_LLM_KEY]["description"],
        ))
    db.commit()
    os.environ["CUSTOM_LLM_PROVIDERS"] = raw


def _load_revisor_stands(db: Session) -> list[dict]:
    row = db.query(MetricsSettings).filter(MetricsSettings.key == _REVISOR_STANDS_KEY).first()
    raw = row.value if row and row.value else "[]"
    try:
        data = json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save_revisor_stands(db: Session, stands: list[dict]) -> None:
    raw = json.dumps(stands, ensure_ascii=False)
    row = db.query(MetricsSettings).filter(MetricsSettings.key == _REVISOR_STANDS_KEY).first()
    if row:
        row.value = raw
        row.updated_at = datetime.utcnow()
    else:
        db.add(MetricsSettings(
            key=_REVISOR_STANDS_KEY,
            value=raw,
            description=_DEFAULTS[_REVISOR_STANDS_KEY]["description"],
        ))
    db.commit()
    os.environ["REVISOR_API_STANDS"] = raw


def _slugify_provider_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return "custom_" + (slug or "llm")


def _slugify_revisor_stand_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return "stand_" + (slug or "api")


def _mask_custom_provider(provider: dict) -> dict:
    item = dict(provider)
    if item.get("api_key"):
        item["api_key"] = _MASKED_PLACEHOLDER
    return item


def _mask_revisor_stand(stand: dict) -> dict:
    item = dict(stand)
    if item.get("token"):
        item["token"] = _MASKED_PLACEHOLDER
    return item


# ── Logs VPS helpers ─────────────────────────────────────────────────────────

def _load_logs_vps(db: Session) -> list[dict]:
    row = db.query(MetricsSettings).filter(MetricsSettings.key == _LOGS_VPS_KEY).first()
    raw = row.value if row and row.value else "[]"
    try:
        data = json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save_logs_vps(db: Session, connections: list[dict]) -> None:
    raw = json.dumps(connections, ensure_ascii=False)
    row = db.query(MetricsSettings).filter(MetricsSettings.key == _LOGS_VPS_KEY).first()
    if row:
        row.value = raw
        row.updated_at = datetime.utcnow()
    else:
        db.add(MetricsSettings(
            key=_LOGS_VPS_KEY,
            value=raw,
            description=_DEFAULTS[_LOGS_VPS_KEY]["description"],
        ))
    db.commit()
    os.environ["LOGS_VPS_CONNECTIONS"] = raw


def _slugify_logs_vps_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return "vps_" + (slug or "logs")


def _mask_logs_vps(conn: dict) -> dict:
    item = dict(conn)
    if item.get("token"):
        item["token"] = _MASKED_PLACEHOLDER
    if item.get("password"):
        item["password"] = _MASKED_PLACEHOLDER
    return item


def get_revisor_api_stands(db: Session) -> list[dict]:
    """Public helper for backend/api/revisor.py."""
    _ensure_defaults(db)
    return _load_revisor_stands(db)


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
    Если bootstrap_servers пустой — вернуть пустой dict (fallback на os.getenv).
    """
    _ensure_defaults(db)
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
        "kafka_ssl_certfile":       rows.get("alerts_kafka_ssl_certfile", ""),
        "kafka_ssl_keyfile":        rows.get("alerts_kafka_ssl_keyfile", ""),
        "kafka_ssl_password":       rows.get("alerts_kafka_ssl_password", ""),
    }


def get_farm_config(db: Session) -> dict:
    """Вернуть конфиг встроенной фермы устройств из БД."""
    _ensure_defaults(db)
    rows = {r.key: r.value or "" for r in db.query(MetricsSettings).all()}
    return {
        "enabled": rows.get("farm_enabled", "false").lower() == "true",
        "max_sessions_per_user": int(rows.get("farm_max_sessions_per_user", "3")),
        "session_timeout_min": int(rows.get("farm_session_timeout_min", "30")),
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
        if key in (_CUSTOM_LLM_KEY, _REVISOR_STANDS_KEY, _LOGS_VPS_KEY):
            continue
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
        if key in (_CUSTOM_LLM_KEY, _REVISOR_STANDS_KEY, _LOGS_VPS_KEY):
            continue
        # Игнорировать placeholder маскировки
        if value == _MASKED_PLACEHOLDER:
            continue
        # Игнорировать пустые значения для секретных полей
        if key in _SECRET_FIELDS and not value.strip():
            continue
        if key in _AUTH_TYPE_FIELDS:
            value = value.strip().lower() or "api_key"
            if value not in ("api_key", "certificate"):
                raise HTTPException(422, f"{key} должен быть api_key или certificate")

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
        elif sk in body.settings:
            os.environ.pop(ev, None)

    return {"ok": True}


class CustomLlmProvider(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    auth_type: str = "api_key"  # api_key | certificate
    api_key: str = ""
    ca_cert_path: str = ""
    client_cert_path: str = ""
    client_key_path: str = ""


@router.get("/api/settings/llm-providers")
def list_custom_llm_providers(db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    providers = [_mask_custom_provider(p) for p in _load_custom_llm_providers(db)]
    return {"providers": providers}


@router.post("/api/settings/llm-providers")
def upsert_custom_llm_provider(body: CustomLlmProvider, db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    providers = _load_custom_llm_providers(db)

    provider_id = (body.id or "").strip().lower() or _slugify_provider_id(body.name)
    if provider_id in ("gigachat", "deepseek"):
        provider_id = "custom_" + provider_id
    if not provider_id.startswith("custom_"):
        provider_id = "custom_" + provider_id

    auth_type = body.auth_type.strip() or "api_key"
    if auth_type not in ("api_key", "certificate"):
        raise HTTPException(422, "auth_type должен быть api_key или certificate")

    existing = next((p for p in providers if str(p.get("id", "")).lower() == provider_id), None)
    api_key = body.api_key
    if auth_type == "certificate":
        api_key = ""
    elif api_key == _MASKED_PLACEHOLDER and existing:
        api_key = str(existing.get("api_key", ""))

    item = {
        "id": provider_id,
        "name": body.name.strip(),
        "base_url": body.base_url.rstrip("/"),
        "model": body.model.strip(),
        "auth_type": auth_type,
        "api_key": api_key.strip(),
        "ca_cert_path": body.ca_cert_path.strip(),
        "client_cert_path": body.client_cert_path.strip(),
        "client_key_path": body.client_key_path.strip(),
    }

    if existing:
        providers = [item if str(p.get("id", "")).lower() == provider_id else p for p in providers]
    else:
        providers.append(item)

    _save_custom_llm_providers(db, providers)
    return {"ok": True, "provider": _mask_custom_provider(item)}


@router.delete("/api/settings/llm-providers/{provider_id}")
def delete_custom_llm_provider(provider_id: str, db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    provider_id = provider_id.lower()
    providers = [
        p for p in _load_custom_llm_providers(db)
        if str(p.get("id", "")).lower() != provider_id
    ]
    _save_custom_llm_providers(db, providers)
    return {"ok": True}


class RevisorMethodConfig(BaseModel):
    enabled: bool = False
    path: str = ""
    label: str = ""


class RevisorStandConfig(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    auth_type: str = "none"  # none | bearer | api_key
    token: str = ""
    api_key_header: str = "Authorization"
    namespace: str = ""
    enabled: bool = True
    methods: Dict[str, RevisorMethodConfig] = Field(default_factory=dict)


_REVISOR_METHOD_LABELS = {
    "build": "Сборка",
    "version": "Версия",
    "status": "Статус",
    "pods": "Поды",
    "health": "Health",
}


@router.get("/api/settings/revisor-stands")
def list_revisor_stands(db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    stands = [_mask_revisor_stand(s) for s in _load_revisor_stands(db)]
    return {
        "methods": [{"key": k, "label": v} for k, v in _REVISOR_METHOD_LABELS.items()],
        "stands": stands,
    }


@router.post("/api/settings/revisor-stands")
def upsert_revisor_stand(body: RevisorStandConfig, db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    stands = _load_revisor_stands(db)

    stand_id = (body.id or "").strip().lower() or _slugify_revisor_stand_id(body.name)
    if not stand_id.startswith("stand_"):
        stand_id = "stand_" + stand_id

    auth_type = body.auth_type.strip().lower() or "none"
    if auth_type not in ("none", "bearer", "api_key"):
        raise HTTPException(422, "auth_type должен быть none, bearer или api_key")

    existing = next((s for s in stands if str(s.get("id", "")).lower() == stand_id), None)
    token = body.token
    if auth_type == "none":
        token = ""
    elif token == _MASKED_PLACEHOLDER and existing:
        token = str(existing.get("token", ""))

    methods: dict[str, dict] = {}
    for key, cfg in body.methods.items():
        method_key = key.strip().lower()
        if not method_key:
            continue
        methods[method_key] = {
            "enabled": bool(cfg.enabled),
            "path": cfg.path.strip(),
            "label": cfg.label.strip() or _REVISOR_METHOD_LABELS.get(method_key, method_key),
        }

    item = {
        "id": stand_id,
        "name": body.name.strip(),
        "base_url": body.base_url.rstrip("/"),
        "auth_type": auth_type,
        "token": token.strip(),
        "api_key_header": body.api_key_header.strip() or "Authorization",
        "namespace": body.namespace.strip(),
        "enabled": bool(body.enabled),
        "methods": methods,
    }

    if existing:
        stands = [item if str(s.get("id", "")).lower() == stand_id else s for s in stands]
    else:
        stands.append(item)

    _save_revisor_stands(db, stands)
    return {"ok": True, "stand": _mask_revisor_stand(item)}


@router.delete("/api/settings/revisor-stands/{stand_id}")
def delete_revisor_stand(stand_id: str, db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    stand_id = stand_id.lower()
    stands = [
        s for s in _load_revisor_stands(db)
        if str(s.get("id", "")).lower() != stand_id
    ]
    _save_revisor_stands(db, stands)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# Logs VPS CRUD
# ═══════════════════════════════════════════════════════════════════════════════

class LogsVpsConfig(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    vps_type: str = "graylog"          # graylog | elastic | loki | generic
    base_url: str = Field(min_length=1)
    auth_type: str = "none"            # none | bearer | basic | api_key
    token: str = ""
    username: str = ""
    password: str = ""
    api_key_header: str = "Authorization"
    ssl_verify: bool = True
    ca_cert_path: str = ""
    default_index: str = ""
    enabled: bool = True


@router.get("/api/settings/logs-vps")
def list_logs_vps(db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    connections = [_mask_logs_vps(c) for c in _load_logs_vps(db)]
    return {"connections": connections}


@router.post("/api/settings/logs-vps")
def upsert_logs_vps(body: LogsVpsConfig, db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    connections = _load_logs_vps(db)

    conn_id = (body.id or "").strip().lower() or _slugify_logs_vps_id(body.name)
    if not conn_id.startswith("vps_"):
        conn_id = "vps_" + conn_id

    vps_type = body.vps_type.strip().lower() or "graylog"
    if vps_type not in ("graylog", "elastic", "loki", "generic"):
        raise HTTPException(422, "vps_type должен быть graylog, elastic, loki или generic")

    auth_type = body.auth_type.strip().lower() or "none"
    if auth_type not in ("none", "bearer", "basic", "api_key"):
        raise HTTPException(422, "auth_type должен быть none, bearer, basic или api_key")

    existing = next(
        (c for c in connections if str(c.get("id", "")).lower() == conn_id), None
    )

    # Не перезатираем секреты маской
    token = body.token
    password = body.password
    if auth_type == "none":
        token = ""
        password = ""
    else:
        if token == _MASKED_PLACEHOLDER and existing:
            token = str(existing.get("token", ""))
        if password == _MASKED_PLACEHOLDER and existing:
            password = str(existing.get("password", ""))

    item = {
        "id": conn_id,
        "name": body.name.strip(),
        "vps_type": vps_type,
        "base_url": body.base_url.rstrip("/"),
        "auth_type": auth_type,
        "token": token.strip(),
        "username": body.username.strip(),
        "password": password.strip(),
        "api_key_header": body.api_key_header.strip() or "Authorization",
        "ssl_verify": bool(body.ssl_verify),
        "ca_cert_path": body.ca_cert_path.strip(),
        "default_index": body.default_index.strip(),
        "enabled": bool(body.enabled),
    }

    if existing:
        connections = [
            item if str(c.get("id", "")).lower() == conn_id else c
            for c in connections
        ]
    else:
        connections.append(item)

    _save_logs_vps(db, connections)
    return {"ok": True, "connection": _mask_logs_vps(item)}


@router.delete("/api/settings/logs-vps/{conn_id}")
def delete_logs_vps(conn_id: str, db: Session = Depends(get_db)) -> dict:
    _ensure_defaults(db)
    conn_id = conn_id.lower()
    connections = [
        c for c in _load_logs_vps(db)
        if str(c.get("id", "")).lower() != conn_id
    ]
    _save_logs_vps(db, connections)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# Тест подключений
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/api/settings/test/llm/{provider_id}")
def test_llm_connection(provider_id: str) -> dict:
    """Тест подключения к LLM провайдеру (отправляет ping)."""
    try:
        from agents.llm_client import LLMClient
        result = LLMClient.health_check(provider_id)
        return result
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/kafka-alerts")
def test_kafka_alerts(db: Session = Depends(get_db)) -> dict:
    """Тест подключения к Kafka для алертов."""
    try:
        cfg = get_alerts_kafka_config(db)
        bootstrap = cfg.get("kafka_bootstrap_servers", "")
        if not bootstrap:
            return {"status": "red", "message": "Bootstrap servers не настроены"}
        from agents.kafka_client import KafkaClient
        kwargs = KafkaClient._build_producer_kwargs(cfg)
        from kafka import KafkaProducer
        producer = KafkaProducer(**kwargs)
        producer.close(timeout=5)
        return {"status": "green", "message": f"Подключено к {bootstrap}"}
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/kafka-metrics")
def test_kafka_metrics(db: Session = Depends(get_db)) -> dict:
    """Тест подключения к Kafka для метрик."""
    try:
        from backend.api.metrics_settings import get_kafka_config
        cfg = get_kafka_config(db)
        bootstrap = cfg.get("kafka_bootstrap_servers", "")
        if not bootstrap:
            return {"status": "red", "message": "Bootstrap servers не настроены"}
        from agents.kafka_client import KafkaClient
        kafka_cfg = {
            "kafka_bootstrap_servers":  bootstrap,
            "kafka_security_protocol":  cfg.get("kafka_security_protocol", "PLAINTEXT"),
            "kafka_sasl_mechanism":     cfg.get("kafka_sasl_mechanism", ""),
            "kafka_sasl_username":      cfg.get("kafka_sasl_username", ""),
            "kafka_sasl_password":      cfg.get("kafka_sasl_password", ""),
            "kafka_ssl_cafile":         cfg.get("kafka_ssl_cafile", ""),
            "kafka_ssl_certfile":       cfg.get("kafka_ssl_certfile", ""),
            "kafka_ssl_keyfile":        cfg.get("kafka_ssl_keyfile", ""),
            "kafka_ssl_password":       cfg.get("kafka_ssl_password", ""),
        }
        kwargs = KafkaClient._build_producer_kwargs(kafka_cfg)
        from kafka import KafkaProducer
        producer = KafkaProducer(**kwargs)
        producer.close(timeout=5)
        return {"status": "green", "message": f"Подключено к {bootstrap}"}
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/chromadb")
def test_chromadb() -> dict:
    """Тест подключения к ChromaDB."""
    try:
        from db.vector_store import VectorStore
        store = VectorStore()
        stats = store.get_stats()
        total = sum(stats.values())
        return {"status": "green", "message": f"OK — {total} записей в {len(stats)} коллекциях"}
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/postgres")
def test_postgres() -> dict:
    """Тест подключения к PostgreSQL."""
    try:
        from db.postgres import SessionLocal
        session = SessionLocal()
        session.execute(__import__("sqlalchemy").text("SELECT 1"))
        session.close()
        return {"status": "green", "message": "Подключено"}
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/revisor/{stand_id}")
def test_revisor_stand(stand_id: str, db: Session = Depends(get_db)) -> dict:
    """Тест подключения к API стенду Ревизора."""
    try:
        _ensure_defaults(db)
        stands = _load_revisor_stands(db)
        stand = next((s for s in stands if str(s.get("id", "")).lower() == stand_id.lower()), None)
        if not stand:
            return {"status": "red", "message": "Стенд не найден"}
        import requests as req
        base_url = stand.get("base_url", "").rstrip("/")
        headers = {}
        auth_type = stand.get("auth_type", "none")
        if auth_type == "bearer" and stand.get("token"):
            headers["Authorization"] = f"Bearer {stand['token']}"
        elif auth_type == "api_key" and stand.get("token"):
            header_name = stand.get("api_key_header", "Authorization")
            headers[header_name] = stand["token"]
        resp = req.get(base_url, headers=headers, timeout=10, verify=False)
        return {"status": "green", "message": f"HTTP {resp.status_code} — доступен"}
    except req.ConnectionError:
        return {"status": "red", "message": "Не удалось подключиться"}
    except req.Timeout:
        return {"status": "red", "message": "Таймаут подключения (10 сек)"}
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/logs-vps/{conn_id}")
def test_logs_vps(conn_id: str, db: Session = Depends(get_db)) -> dict:
    """Тест подключения к VPS-платформе логов."""
    try:
        _ensure_defaults(db)
        connections = _load_logs_vps(db)
        conn = next(
            (c for c in connections if str(c.get("id", "")).lower() == conn_id.lower()),
            None,
        )
        if not conn:
            return {"status": "red", "message": "Подключение не найдено"}
        from backend.api.log_clients import get_client
        client = get_client(
            vps_type=conn.get("vps_type", "generic"),
            base_url=conn.get("base_url", ""),
            auth_type=conn.get("auth_type", "none"),
            token=conn.get("token", ""),
            username=conn.get("username", ""),
            password=conn.get("password", ""),
            api_key_header=conn.get("api_key_header", "Authorization"),
            ssl_verify=conn.get("ssl_verify", True),
            ca_cert_path=conn.get("ca_cert_path", ""),
            default_index=conn.get("default_index", ""),
        )
        return client.test_connection()
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}


@router.post("/api/settings/test/farm")
async def test_farm() -> dict:
    """Тест фермы --- проверить что Farm Manager работает."""
    try:
        from backend.farm.manager import farm_manager
        status = await farm_manager.get_status()
        total = status.get("devices", {}).get("total", 0)
        return {
            "status": "green",
            "message": f"Ферма активна, устройств: {total}",
        }
    except Exception as e:
        return {"status": "red", "message": str(e)[:200]}
