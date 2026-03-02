"""
Эндпоинты управления alert-скриптами и отправки алертов в Kafka.

REST:
  GET    /api/alerts/scripts          — список скриптов
  POST   /api/alerts/scripts          — создать / обновить скрипт
  DELETE /api/alerts/scripts/{id}     — удалить скрипт (builtin нельзя)
  POST   /api/alerts/send             — резолвить шаблон + отправить в Kafka
  GET    /api/alerts/history          — последние 20 отправок
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.alerts_store import AlertsStore

router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────────

class AlertParam(BaseModel):
    key:      str
    label:    str
    type:     str = "text"          # text | select | textarea
    required: bool = False
    default:  str  = ""
    hint:     Optional[str] = None
    options:  Optional[list[str]] = None


class AlertScript(BaseModel):
    id:               Optional[str]   = None
    name:             str
    description:      str             = ""
    topic:            str
    payload_template: str
    params:           list[AlertParam] = []
    created_at:       Optional[str]   = None
    builtin:          bool            = False


class SendRequest(BaseModel):
    script_id:     str
    values:        dict[str, str] = {}
    topic_override: str           = ""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_template(template: str, values: dict[str, str]) -> str:
    """Заменяет {{key}} на values[key]. __now__ → текущий ISO timestamp."""
    def replacer(m: re.Match) -> str:
        k = m.group(1)
        v = values.get(k, "")
        return v if v != "__now__" else datetime.now(timezone.utc).isoformat()

    result = re.sub(r"\{\{(\w+)\}\}", replacer, template)
    # Подставляем __now__ в оставшиеся значения (если default был __now__)
    result = result.replace("__now__", datetime.now(timezone.utc).isoformat())
    return result


def _send_to_kafka_sync(topic: str, payload: str) -> dict:
    from agents.kafka_client import KafkaClient
    return KafkaClient.send(topic, payload)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/api/alerts/scripts")
def list_scripts() -> list[dict]:
    return AlertsStore.get_scripts()


@router.post("/api/alerts/scripts")
def upsert_script(script: AlertScript) -> dict:
    data = script.model_dump(exclude_none=False)
    # Params — сериализуем вложенные модели
    data["params"] = [p.model_dump(exclude_none=True) for p in script.params]
    return AlertsStore.save_script(data)


@router.delete("/api/alerts/scripts/{script_id}")
def remove_script(script_id: str) -> dict:
    ok = AlertsStore.delete_script(script_id)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Встроенный скрипт нельзя удалить. Можно только изменить шаблон."
        )
    return {"status": "deleted"}


@router.post("/api/alerts/send")
async def send_alert(req: SendRequest) -> dict:
    script = AlertsStore.get_script(req.script_id)
    if not script:
        raise HTTPException(status_code=404, detail=f"Скрипт '{req.script_id}' не найден")

    # Подставить defaults для незаполненных значений
    values: dict[str, str] = {}
    for p in script.get("params", []):
        k = p["key"]
        v = req.values.get(k, p.get("default", ""))
        values[k] = v if v != "__now__" else datetime.now(timezone.utc).isoformat()

    # Резолвим шаблон
    raw_payload = _resolve_template(script["payload_template"], values)

    # Проверяем валидность JSON (необязательно, но полезно)
    try:
        json.loads(raw_payload)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Шаблон payload не является валидным JSON после подстановки: {e}"
        )

    topic = req.topic_override.strip() or script.get("topic", "alerts.default")

    # Отправляем в Kafka
    try:
        meta = await asyncio.to_thread(_send_to_kafka_sync, topic, raw_payload)
        result = {
            "ok":      True,
            "payload": raw_payload,
            "topic":   topic,
            "offset":  meta.get("offset"),
            "partition": meta.get("partition"),
        }
        AlertsStore.add_history({
            "script_id":   req.script_id,
            "script_name": script.get("name", req.script_id),
            "topic":       topic,
            "payload":     raw_payload,
            "status":      "ok",
        })
        return result

    except Exception as e:
        error_msg = str(e)
        AlertsStore.add_history({
            "script_id":   req.script_id,
            "script_name": script.get("name", req.script_id),
            "topic":       topic,
            "payload":     raw_payload,
            "status":      "error",
            "error":       error_msg,
        })
        return {
            "ok":      False,
            "payload": raw_payload,
            "topic":   topic,
            "error":   error_msg,
        }


@router.get("/api/alerts/history")
def get_history(limit: int = 20) -> list[dict]:
    return AlertsStore.get_history(limit=min(limit, 50))
