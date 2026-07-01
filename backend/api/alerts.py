"""
Эндпоинты управления алертами (Jupyter-ноутбуки + динамические параметры).

Отправка/выполнение алертов идёт через Jupyter-ядро (см. backend/api/kernel.py) —
каждый скрипт сам описывает своё подключение к Kafka в коде ячеек.

REST:
  GET    /api/alerts/scripts          — список алертов
  POST   /api/alerts/scripts          — создать / обновить алерт
  DELETE /api/alerts/scripts/{id}     — удалить алерт
  POST   /api/alerts/parse-notebook   — распарсить .ipynb файл
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from db.alerts_store import AlertsStore

router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────────

class NotebookCell(BaseModel):
    id:     str
    type:   str = "markdown"
    source: str = ""


class DynamicParam(BaseModel):
    id:          str
    label:       str
    code_key:    str = ""
    placeholder: str = ""
    field_type:  Literal["text", "select", "multiselect", "dropdown", "dropdown_multi", "datetime"] = "text"
    options:     list[str] = Field(default_factory=list)


class AlertScript(BaseModel):
    id:                    Optional[str]       = None
    name:                  str
    topic:                 str                 = ""
    notebook:              list[dict]          = []
    dynamic_params:        list[DynamicParam]  = []
    visible_to_monitoring: bool                = False
    folder_id:             Optional[str]       = None
    created_at:            Optional[str]       = None


class AlertFolder(BaseModel):
    id:   Optional[str] = None
    name: str


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/api/alerts/folders")
def list_folders() -> list[dict]:
    return AlertsStore.get_folders()


@router.post("/api/alerts/folders")
def upsert_folder(folder: AlertFolder) -> dict:
    return AlertsStore.save_folder(folder.model_dump(exclude_none=False))


@router.delete("/api/alerts/folders/{folder_id}")
def remove_folder(folder_id: str) -> dict:
    ok = AlertsStore.delete_folder(folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Папка не найдена")
    return {"status": "deleted"}


@router.post("/api/alerts/parse-notebook")
async def parse_notebook(file: UploadFile = File(...)) -> dict:
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
def list_scripts(request: Request) -> list[dict]:
    scripts = AlertsStore.get_scripts()
    user = getattr(request.state, "user", None)
    if user and user.get("role") == "monitoring":
        scripts = [s for s in scripts if s.get("visible_to_monitoring", False)]
    return scripts


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


