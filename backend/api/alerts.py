"""
Эндпоинты управления alert-скриптами и отправки алертов в Kafka.

REST:
  GET    /api/alerts/scripts          — список скриптов
  POST   /api/alerts/scripts          — создать / обновить скрипт
  DELETE /api/alerts/scripts/{id}     — удалить скрипт (builtin нельзя)
  POST   /api/alerts/send             — резолвить шаблон + отправить в Kafka
  GET    /api/alerts/history          — последние 20 отправок

script_type:
  "simple"  — стандартный JSON-шаблон с {{param}} заменой
  "a2a"     — A2A протокол: JWT заголовки + JSON-RPC 2.0 обёртка
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

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
    script_type:      str             = "simple"   # "simple" | "a2a"
    partition:        Optional[int]   = None
    payload_template: str
    params:           list[AlertParam] = []
    created_at:       Optional[str]   = None
    builtin:          bool            = False


class SendRequest(BaseModel):
    script_id:      str
    values:         dict[str, str] = {}
    topic_override: str            = ""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_template(template: str, values: dict[str, str]) -> str:
    """Заменяет {{key}} на values[key]. __now__ → ISO timestamp."""
    def replacer(m: re.Match) -> str:
        k = m.group(1)
        v = values.get(k, "")
        return v if v != "__now__" else datetime.now(timezone.utc).isoformat()

    result = re.sub(r"\{\{(\w+)\}\}", replacer, template)
    result = result.replace("__now__", datetime.now(timezone.utc).isoformat())
    return result


def _send_simple_sync(topic: str, payload: str, partition: Optional[int]) -> dict:
    from agents.kafka_client import KafkaClient
    return KafkaClient.send(topic, payload, partition=partition)


def _send_a2a_sync(
    topic: str,
    values: dict[str, str],
    partition: Optional[int],
) -> tuple[dict, str]:
    """
    Строит A2A-сообщение (JWT headers + JSON-RPC wrapper) и отправляет в Kafka.
    Returns: (record_meta, raw_payload_str)
    """
    from agents.kafka_client import KafkaClient
    from agents.a2a_builder import build_a2a_message

    system_ci        = values.get("as", "")
    sender           = values.get("sender", "alert_service")
    recipient        = values.get("recipient", "sber.support_platform.channel_agent")
    sender_id_aef    = values.get("sender_id_aef", "CI00213821")
    recipient_id_aef = values.get("recipient_id_aef", "CI00293210")
    alert_text       = values.get("alert_text", "")

    jwt_secret = os.getenv("A2A_JWT_SECRET", "SBER911_SECRET_KEY")

    payload_str, kafka_headers = build_a2a_message(
        system_ci, sender, recipient,
        sender_id_aef, recipient_id_aef,
        alert_text, jwt_secret,
    )

    key = str(uuid.uuid4())
    meta = KafkaClient.send(
        topic, payload_str,
        key=key,
        headers=kafka_headers,
        partition=partition,
    )
    return meta, payload_str


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/api/alerts/scripts")
def list_scripts() -> list[dict]:
    return AlertsStore.get_scripts()


@router.post("/api/alerts/scripts")
def upsert_script(script: AlertScript) -> dict:
    data = script.model_dump(exclude_none=False)
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

    # Подставить defaults
    values: dict[str, str] = {}
    for p in script.get("params", []):
        k = p["key"]
        v = req.values.get(k, p.get("default", ""))
        values[k] = v if v != "__now__" else datetime.now(timezone.utc).isoformat()

    topic      = req.topic_override.strip() or script.get("topic", "alerts.default")
    stype      = script.get("script_type", "simple")
    partition  = script.get("partition")

    # ── A2A протокол ─────────────────────────────────────────────────────
    if stype == "a2a":
        try:
            meta, raw_payload = await asyncio.to_thread(
                _send_a2a_sync, topic, values, partition
            )
            AlertsStore.add_history({
                "script_id":   req.script_id,
                "script_name": script.get("name", req.script_id),
                "topic":       topic,
                "payload":     raw_payload,
                "status":      "ok",
            })
            return {
                "ok":        True,
                "payload":   raw_payload,
                "topic":     topic,
                "offset":    meta.get("offset"),
                "partition": meta.get("partition"),
            }
        except Exception as e:
            err = str(e)
            AlertsStore.add_history({
                "script_id":   req.script_id,
                "script_name": script.get("name", req.script_id),
                "topic":       topic,
                "payload":     "",
                "status":      "error",
                "error":       err,
            })
            return {"ok": False, "payload": "", "topic": topic, "error": err}

    # ── Simple шаблон ─────────────────────────────────────────────────────
    raw_payload = _resolve_template(script["payload_template"], values)

    try:
        json.loads(raw_payload)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Шаблон payload не является валидным JSON: {e}"
        )

    try:
        meta = await asyncio.to_thread(_send_simple_sync, topic, raw_payload, partition)
        AlertsStore.add_history({
            "script_id":   req.script_id,
            "script_name": script.get("name", req.script_id),
            "topic":       topic,
            "payload":     raw_payload,
            "status":      "ok",
        })
        return {
            "ok":        True,
            "payload":   raw_payload,
            "topic":     topic,
            "offset":    meta.get("offset"),
            "partition": meta.get("partition"),
        }
    except Exception as e:
        err = str(e)
        AlertsStore.add_history({
            "script_id":   req.script_id,
            "script_name": script.get("name", req.script_id),
            "topic":       topic,
            "payload":     raw_payload,
            "status":      "error",
            "error":       err,
        })
        return {"ok": False, "payload": raw_payload, "topic": topic, "error": err}


@router.get("/api/alerts/history")
def get_history(limit: int = 20) -> list[dict]:
    return AlertsStore.get_history(limit=min(limit, 50))
