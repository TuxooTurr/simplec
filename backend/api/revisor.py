"""
Ревизор стендов.

Стенды и методы сравнения настраиваются в общей шестерёнке:
Settings -> Ревизор — API стенды.

Каждый стенд может иметь несколько API-методов: build, version, status,
pods, health. Ревизор вызывает включённые методы, нормализует разные JSON
форматы и собирает сравнительную таблицу по микросервисам.
"""

import os
from typing import Any
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.api.app_settings import get_revisor_api_stands
from db.postgres import get_db

router = APIRouter()

METHOD_DEFINITIONS = {
    "build": "Сборка",
    "version": "Версия",
    "status": "Статус",
    "pods": "Поды",
    "health": "Health",
}

LEGACY_STAND_KEYS = [
    ("НТ",          "REVISOR_NT"),
    ("Major-Check", "REVISOR_MAJORCHECK"),
    ("Major-Go",    "REVISOR_MAJORGO"),
]


def _legacy_stand_configs() -> list[dict]:
    result = []
    for name, prefix in LEGACY_STAND_KEYS:
        url = os.getenv(f"{prefix}_URL", "")
        token = os.getenv(f"{prefix}_TOKEN", "")
        ns = os.getenv(f"{prefix}_NAMESPACE", "")
        result.append({
            "id": prefix.lower(),
            "name": name,
            "base_url": url,
            "url": url,
            "namespace": ns,
            "enabled": True,
            "connected": bool(url and token),
            "methods": {},
        })
    return result


def _enabled_methods(stand: dict) -> list[tuple[str, dict]]:
    raw = stand.get("methods") if isinstance(stand.get("methods"), dict) else {}
    result = []
    for key, label in METHOD_DEFINITIONS.items():
        cfg = raw.get(key) or {}
        if cfg.get("enabled") and str(cfg.get("path", "")).strip():
            result.append((key, {
                "enabled": True,
                "path": str(cfg.get("path", "")).strip(),
                "label": str(cfg.get("label", "")).strip() or label,
            }))
    return result


def _stand_configs(db: Session) -> list[dict]:
    configured = get_revisor_api_stands(db)
    if not configured:
        return _legacy_stand_configs()

    result = []
    for stand in configured:
        enabled = bool(stand.get("enabled", True))
        methods = _enabled_methods(stand)
        auth_type = str(stand.get("auth_type", "none")).strip().lower() or "none"
        token = str(stand.get("token", "")).strip()
        base_url = str(stand.get("base_url", "")).strip()
        needs_token = auth_type in ("bearer", "api_key")
        connected = bool(enabled and base_url and methods and (not needs_token or token))
        result.append({
            "id": stand.get("id"),
            "name": str(stand.get("name", "")).strip() or str(stand.get("id", "Стенд")),
            "base_url": base_url,
            "url": base_url,
            "namespace": str(stand.get("namespace", "")).strip(),
            "enabled": enabled,
            "connected": connected,
            "methods": [{"key": key, "label": cfg["label"], "path": cfg["path"]} for key, cfg in methods],
        })
    return result


@router.get("/api/revisor/stands")
def get_stands(db: Session = Depends(get_db)):
    """Список стендов и статус их подключения."""
    return {
        "methods": [{"key": k, "label": v} for k, v in METHOD_DEFINITIONS.items()],
        "stands": _stand_configs(db),
    }


@router.get("/api/revisor/data")
def get_revisor_data(db: Session = Depends(get_db)):
    """
    Возвращает список микросервисов с данными по каждому стенду.
    Если стенды не настроены через UI, сохраняется старый mock-режим.
    """
    configured = get_revisor_api_stands(db)
    if not configured:
        stand_names = [s["name"] for s in _legacy_stand_configs()]
        return {
            "stands": stand_names,
            "methods": [{"key": k, "label": v} for k, v in METHOD_DEFINITIONS.items()],
            "services": _mock_services(),
        }

    stands = _stand_configs(db)
    stand_names = [s["name"] for s in stands if s["enabled"]]
    method_labels = _collect_method_labels(configured)
    services = _collect_api_services(configured)
    return {"stands": stand_names, "methods": method_labels, "services": services}


def _collect_method_labels(stands: list[dict]) -> list[dict]:
    seen: dict[str, str] = {}
    for stand in stands:
        for key, cfg in _enabled_methods(stand):
            seen[key] = cfg["label"]
    if not seen:
        return [{"key": k, "label": v} for k, v in METHOD_DEFINITIONS.items()]
    return [{"key": k, "label": seen[k]} for k in METHOD_DEFINITIONS if k in seen]


def _collect_api_services(stands: list[dict]) -> list[dict]:
    services: dict[str, dict] = {}
    for stand in stands:
        if not stand.get("enabled", True):
            continue
        stand_name = str(stand.get("name", "")).strip() or str(stand.get("id", "Стенд"))
        for method_key, method_cfg in _enabled_methods(stand):
            try:
                payload = _fetch_method_payload(stand, method_cfg["path"])
                _merge_payload(services, stand_name, method_key, method_cfg["label"], payload)
            except Exception as e:
                _merge_error(services, stand_name, method_key, method_cfg["label"], str(e))

    return sorted(services.values(), key=lambda item: item["name"].lower())


def _fetch_method_payload(stand: dict, path: str) -> Any:
    url = _method_url(str(stand.get("base_url", "")).strip(), path)
    headers = _auth_headers(stand)
    params = {}
    namespace = str(stand.get("namespace", "")).strip()
    if namespace:
        params["namespace"] = namespace
    with httpx.Client(timeout=20.0, verify=_verify()) as client:
        response = client.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()


def _method_url(base_url: str, path: str) -> str:
    if path.startswith(("http://", "https://")):
        return path
    if not base_url:
        return path
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def _auth_headers(stand: dict) -> dict[str, str]:
    auth_type = str(stand.get("auth_type", "none")).strip().lower()
    token = str(stand.get("token", "")).strip()
    if not token or auth_type == "none":
        return {}
    if auth_type == "bearer":
        return {"Authorization": "Bearer " + token}
    header = str(stand.get("api_key_header", "")).strip() or "Authorization"
    return {header: token}


def _verify():
    if os.getenv("SSL_NO_VERIFY", "").lower() in ("1", "true", "yes"):
        return False
    ca = os.getenv("SSL_CERT_FILE")
    return ca if ca and os.path.exists(ca) else True


def _records(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return [payload]

    for key in ("services", "items", "data", "applications", "apps", "deployments", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return _dict_records(value)

    if any(isinstance(v, (dict, list)) for v in payload.values()):
        return _dict_records(payload)
    return [payload]


def _dict_records(data: dict) -> list[dict]:
    result = []
    for key, value in data.items():
        if isinstance(value, dict):
            item = dict(value)
            item.setdefault("name", key)
            result.append(item)
        else:
            result.append({"name": key, "value": value})
    return result


def _merge_payload(
    services: dict[str, dict],
    stand_name: str,
    method_key: str,
    method_label: str,
    payload: Any,
) -> None:
    records = _records(payload)
    if not records:
        _merge_error(services, stand_name, method_key, method_label, "Пустой ответ")
        return
    for idx, record in enumerate(records):
        service_name = _service_name(record, idx)
        value = _method_value(method_key, record)
        status = _method_status(method_key, record, value)
        cell = _cell(services, service_name, stand_name)
        cell["methods"].append({
            "key": method_key,
            "label": method_label,
            "value": value,
            "status": status,
        })
        _apply_method_to_cell(cell, method_key, record, value, status)


def _merge_error(
    services: dict[str, dict],
    stand_name: str,
    method_key: str,
    method_label: str,
    error: str,
) -> None:
    cell = _cell(services, "Ошибки подключения", stand_name)
    cell["methods"].append({
        "key": method_key,
        "label": method_label,
        "value": error[:160],
        "status": "red",
        "error": True,
    })
    cell["status_value"] = "Ошибка"
    cell["compare_value"] = "Ошибка"


def _cell(services: dict[str, dict], service_name: str, stand_name: str) -> dict:
    service = services.setdefault(service_name, {"name": service_name, "stands": {}})
    return service["stands"].setdefault(stand_name, {
        "version": "",
        "total": 0,
        "running": 0,
        "status_value": "",
        "compare_value": "",
        "methods": [],
    })


def _service_name(record: Any, idx: int) -> str:
    if not isinstance(record, dict):
        return "Общее"
    for key in ("name", "service", "service_name", "serviceName", "microservice", "app", "application", "deployment"):
        value = record.get(key)
        if value:
            return str(value)
    metadata = record.get("metadata")
    if isinstance(metadata, dict) and metadata.get("name"):
        return str(metadata["name"])
    return "Сервис " + str(idx + 1)


def _method_value(method_key: str, record: Any) -> str:
    if not isinstance(record, dict):
        return _string_value(record)
    fields = {
        "build": ("build", "buildNumber", "build_number", "buildId", "assembly", "release", "tag", "imageTag"),
        "version": ("version", "appVersion", "dockerTag", "imageTag", "image", "tag"),
        "status": ("status", "state", "phase", "ready", "condition"),
        "pods": ("pods", "replicas", "readyReplicas", "running", "total"),
        "health": ("health", "healthStatus", "status", "state", "availability"),
    }.get(method_key, ("value", method_key))
    for field in fields:
        if field in record and record[field] not in (None, ""):
            value = record[field]
            if method_key == "pods":
                return _pod_value(record)
            return _string_value(value)
    if method_key == "pods":
        return _pod_value(record)
    if "value" in record:
        return _string_value(record["value"])
    return ""


def _pod_value(record: dict) -> str:
    running, total = _pod_counts(record)
    if total:
        return f"{running}/{total}"
    value = record.get("pods")
    return _string_value(value) if value not in (None, "") else ""


def _pod_counts(record: dict) -> tuple[int, int]:
    running = _int_value(
        record.get("running")
        or record.get("readyReplicas")
        or record.get("ready")
        or record.get("availableReplicas")
        or 0
    )
    total = _int_value(
        record.get("total")
        or record.get("replicas")
        or record.get("desiredReplicas")
        or record.get("podCount")
        or 0
    )
    return running, total


def _method_status(method_key: str, record: Any, value: str) -> str:
    if method_key == "pods" and isinstance(record, dict):
        running, total = _pod_counts(record)
        if total == 0:
            return "grey"
        if running == 0:
            return "red"
        if running == total:
            return "green"
        return "yellow"
    text = value.lower()
    if any(x in text for x in ("error", "fail", "failed", "down", "red", "critical", "crash", "not ready")):
        return "red"
    if any(x in text for x in ("warn", "degraded", "pending", "yellow", "partial", "unknown")):
        return "yellow"
    if any(x in text for x in ("ok", "green", "ready", "running", "healthy", "success", "up")):
        return "green"
    return "grey" if not value else "green"


def _apply_method_to_cell(cell: dict, method_key: str, record: Any, value: str, status: str) -> None:
    if method_key in ("build", "version") and value:
        cell["version"] = cell.get("version") or value
        cell["compare_value"] = cell.get("compare_value") or value
    if method_key == "status" and value:
        cell["status_value"] = value
        cell["compare_value"] = cell.get("compare_value") or value
    if method_key == "health" and value:
        cell["status_value"] = cell.get("status_value") or value
    if method_key == "pods" and isinstance(record, dict):
        running, total = _pod_counts(record)
        cell["running"] = running
        cell["total"] = total
        if not cell.get("status_value"):
            cell["status_value"] = status


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return str(value)
    return str(value)


def _int_value(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _mock_services() -> list[dict]:
    """Реалистичный набор микросервисов с разными версиями и статусами подов."""
    return [
        {"name": "api-gateway", "stands": {
            "НТ":          {"version": "2.14.1", "total": 3, "running": 3},
            "Major-Check": {"version": "2.14.1", "total": 2, "running": 2},
            "Major-Go":    {"version": "2.14.1", "total": 2, "running": 2},
        }},
        {"name": "user-service", "stands": {
            "НТ":          {"version": "2.13.0", "total": 2, "running": 2},
            "Major-Check": {"version": "2.14.0", "total": 2, "running": 2},
            "Major-Go":    {"version": "2.14.1", "total": 2, "running": 0},
        }},
        {"name": "auth-service", "stands": {
            "НТ":          {"version": "",       "total": 0, "running": 0},
            "Major-Check": {"version": "1.0.5",  "total": 2, "running": 2},
            "Major-Go":    {"version": "1.0.5",  "total": 2, "running": 2},
        }},
        {"name": "payment-gateway", "stands": {
            "НТ":          {"version": "3.7.2", "total": 2, "running": 1},
            "Major-Check": {"version": "3.7.2", "total": 2, "running": 2},
            "Major-Go":    {"version": "3.7.2", "total": 2, "running": 2},
        }},
        {"name": "notification-service", "stands": {
            "НТ":          {"version": "1.5.0", "total": 1, "running": 1},
            "Major-Check": {"version": "1.5.0", "total": 1, "running": 1},
            "Major-Go":    {"version": "1.5.1", "total": 1, "running": 1},
        }},
        {"name": "audit-service", "stands": {
            "НТ":          {"version": "0.9.4", "total": 2, "running": 2},
            "Major-Check": {"version": "0.9.4", "total": 2, "running": 2},
            "Major-Go":    {"version": "0.9.4", "total": 2, "running": 2},
        }},
        {"name": "config-service", "stands": {
            "НТ":          {"version": "2.0.1", "total": 3, "running": 3},
            "Major-Check": {"version": "2.0.1", "total": 2, "running": 2},
            "Major-Go":    {"version": "2.0.0", "total": 2, "running": 2},
        }},
        {"name": "file-storage", "stands": {
            "НТ":          {"version": "1.1.0", "total": 0, "running": 0},
            "Major-Check": {"version": "1.1.0", "total": 0, "running": 0},
            "Major-Go":    {"version": "1.1.0", "total": 0, "running": 0},
        }},
    ]
