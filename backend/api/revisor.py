"""
Ревизор стендов — сравнение Docker-версий и статуса подов.
Стенды: НТ (нагрузочный), Major-Check, Major-Go.
Пока работает на mock-данных; реальный K8s-коннектор добавляется позже.
Учётные данные задаются через .env: REVISOR_NT_URL, REVISOR_NT_TOKEN, ...
"""

import os
from fastapi import APIRouter

router = APIRouter()

STAND_KEYS = [
    ("НТ",          "REVISOR_NT"),
    ("Major-Check", "REVISOR_MAJORCHECK"),
    ("Major-Go",    "REVISOR_MAJORGO"),
]


def _stand_configs() -> list[dict]:
    result = []
    for name, prefix in STAND_KEYS:
        url   = os.getenv(f"{prefix}_URL", "")
        token = os.getenv(f"{prefix}_TOKEN", "")
        ns    = os.getenv(f"{prefix}_NAMESPACE", "")
        result.append({
            "name":      name,
            "url":       url,
            "namespace": ns,
            "connected": bool(url and token),
        })
    return result


@router.get("/api/revisor/stands")
def get_stands():
    """Список стендов и статус их подключения (из .env)."""
    return {"stands": _stand_configs()}


@router.get("/api/revisor/data")
def get_revisor_data():
    """
    Возвращает список микросервисов с данными по каждому стенду.
    Пока — mock-данные. Когда будет реальный коннектор —
    заменить _mock_services() на K8s-вызовы.
    """
    stand_names = [s["name"] for s in _stand_configs()]
    return {"stands": stand_names, "services": _mock_services()}


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
