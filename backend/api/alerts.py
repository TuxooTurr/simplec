"""
Эндпоинты управления алертами (Jupyter-ноутбуки + динамические параметры + Kafka).

REST:
  GET    /api/alerts/scripts          — список алертов
  POST   /api/alerts/scripts          — создать / обновить алерт
  DELETE /api/alerts/scripts/{id}     — удалить алерт
  POST   /api/alerts/parse-notebook   — распарсить .ipynb файл
  POST   /api/alerts/send             — подставить параметры + отправить в Kafka
  GET    /api/alerts/history          — последние 20 отправок
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.alerts_store import AlertsStore
from db.postgres import get_db

router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────────

class NotebookCell(BaseModel):
    id:     str
    type:   str = "markdown"   # "markdown" | "code"
    source: str = ""


class DynamicParam(BaseModel):
    id:          str
    label:       str
    code_key:    str = ""
    placeholder: str = ""


class AlertScript(BaseModel):
    id:             Optional[str]       = None
    name:           str
    topic:          str                 = ""
    notebook:       list[dict]          = []
    dynamic_params: list[DynamicParam]  = []
    created_at:     Optional[str]       = None


class SendRequest(BaseModel):
    script_id:      str
    values:         dict[str, str] = {}   # param.id → user value
    topic_override: str            = ""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _apply_params(source: str, dynamic_params: list[dict], values: dict[str, str]) -> str:
    """Заменяет placeholder каждого параметра на значение из values."""
    result = source
    for p in dynamic_params:
        placeholder = p.get("placeholder", "")
        if not placeholder:
            continue
        value = values.get(p["id"], placeholder)
        result = result.replace(placeholder, value)
    return result


def _build_payload(script: dict, values: dict[str, str]) -> str:
    """Собирает payload из code-ячеек ноутбука с применёнными параметрами."""
    cells = script.get("notebook", [])
    params = script.get("dynamic_params", [])
    parts = []
    for cell in cells:
        if cell.get("type") == "code":
            parts.append(_apply_params(cell.get("source", ""), params, values))
    return "\n".join(parts)


def _send_kafka_sync(topic: str, payload: str, partition: Optional[int] = None,
                     kafka_cfg: Optional[dict] = None) -> dict:
    from agents.kafka_client import KafkaClient
    return KafkaClient.send(topic, payload, partition=partition, kafka_cfg=kafka_cfg)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/api/alerts/parse-notebook")
async def parse_notebook(file: UploadFile = File(...)) -> dict:
    """Принимает .ipynb, возвращает список ячеек."""
    raw = await file.read()
    try:
        nb = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Файл не является валидным JSON")

    if "cells" not in nb:
        raise HTTPException(status_code=400, detail="Файл не является Jupyter Notebook (.ipynb)")

    cells = []
    for i, cell in enumerate(nb.get("cells", [])):
        cell_type = cell.get("cell_type", "code")
        if cell_type not in ("markdown", "code"):
            continue
        source = cell.get("source", "")
        if isinstance(source, list):
            source = "".join(source)
        cells.append({
            "id":     f"cell-{i}-{uuid.uuid4().hex[:6]}",
            "type":   cell_type,
            "source": source,
        })

    return {"cells": cells}


@router.get("/api/alerts/scripts")
def list_scripts() -> list[dict]:
    return AlertsStore.get_scripts()


@router.post("/api/alerts/scripts")
def upsert_script(script: AlertScript) -> dict:
    data = script.model_dump(exclude_none=False)
    data["dynamic_params"] = [p.model_dump() for p in script.dynamic_params]
    if not data.get("created_at"):
        data["created_at"] = datetime.now(timezone.utc).isoformat()
    return AlertsStore.save_script(data)


@router.delete("/api/alerts/scripts/{script_id}")
def remove_script(script_id: str) -> dict:
    ok = AlertsStore.delete_script(script_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Алерт не найден")
    return {"status": "deleted"}


@router.post("/api/alerts/send")
async def send_alert(req: SendRequest, db: Session = Depends(get_db)) -> dict:
    from backend.api.app_settings import get_alerts_kafka_config
    kafka_cfg_raw = get_alerts_kafka_config(db)
    kafka_cfg: Optional[dict] = kafka_cfg_raw if kafka_cfg_raw else None

    script = AlertsStore.get_script(req.script_id)
    if not script:
        raise HTTPException(status_code=404, detail=f"Алерт '{req.script_id}' не найден")

    topic   = req.topic_override.strip() or script.get("topic", "alerts.default")
    payload = _build_payload(script, req.values)

    try:
        meta = await asyncio.to_thread(_send_kafka_sync, topic, payload, None, kafka_cfg)
        AlertsStore.add_history({
            "script_id":   req.script_id,
            "script_name": script.get("name", req.script_id),
            "topic":       topic,
            "payload":     payload,
            "status":      "ok",
        })
        return {
            "ok":        True,
            "payload":   payload,
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
            "payload":     payload,
            "status":      "error",
            "error":       err,
        })
        return {"ok": False, "payload": payload, "topic": topic, "error": err}


@router.get("/api/alerts/history")
def get_history(limit: int = 20) -> list[dict]:
    return AlertsStore.get_history(limit=min(limit, 50))
