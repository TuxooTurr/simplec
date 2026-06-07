"""
Анализатор логов микросервисов.

Эндпоинты:
  POST /api/logs/search    — поиск логов по фильтрам
  POST /api/logs/analyze   — LLM-анализ выбранных ошибок
  GET  /api/logs/services  — список микросервисов из VPS
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.postgres import get_db

router = APIRouter()


# ── Pydantic-схемы ───────────────────────────────────────────────────────────

class LogSearchRequest(BaseModel):
    vps_id: str
    services: list[str] = Field(default_factory=list)
    level: str = "ERROR"
    time_from: str  # ISO datetime
    time_to: str    # ISO datetime
    query: str = ""
    limit: int = 100


class LogAnalyzeRequest(BaseModel):
    vps_id: str
    entries: list[dict]  # LogEntry dicts с log данными
    provider: str = "gigachat"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_vps_connections(db: Session) -> list[dict]:
    """Загрузить подключения VPS из БД."""
    from db.metrics_models import MetricsSettings
    row = db.query(MetricsSettings).filter(
        MetricsSettings.key == "logs_vps_connections"
    ).first()
    if not row or not row.value:
        return []
    try:
        data = json.loads(row.value)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _get_vps_connection(db: Session, vps_id: str) -> dict:
    """Найти подключение по ID."""
    connections = _load_vps_connections(db)
    conn = next(
        (c for c in connections if str(c.get("id", "")).lower() == vps_id.lower()),
        None,
    )
    if not conn:
        raise HTTPException(404, f"VPS подключение '{vps_id}' не найдено")
    if not conn.get("enabled", True):
        raise HTTPException(400, f"VPS подключение '{conn.get('name', vps_id)}' отключено")
    return conn


def _build_client(conn: dict):
    """Создать клиент для VPS по конфигу."""
    from backend.api.log_clients import get_client
    return get_client(
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


def _group_entries(entries: list[dict]) -> list[dict]:
    """
    Группировка по stacktrace fingerprint.
    Одинаковые ошибки объединяются, добавляется count.
    """
    groups: dict[str, dict] = {}
    group_entries: dict[str, list] = defaultdict(list)

    for entry in entries:
        fp = entry.get("fingerprint", entry.get("id", ""))
        if fp not in groups:
            groups[fp] = {**entry, "count": 1, "group_entries": []}
        else:
            groups[fp]["count"] += 1
        group_entries[fp].append(entry)

    result = []
    for fp, group in groups.items():
        group["group_entries"] = group_entries[fp][:5]  # до 5 примеров
        # Показываем самый свежий timestamp
        all_ts = [e.get("timestamp", "") for e in group_entries[fp]]
        all_ts.sort(reverse=True)
        if all_ts:
            group["timestamp"] = all_ts[0]
        result.append(group)

    return result


def _analyze_with_llm(entries: list[dict], provider: str) -> list[dict]:
    """
    Анализ ошибок через LLM.
    Обрабатывает пакетами по 5 ошибок.
    """
    from agents.llm_client import LLMClient, Message

    llm = LLMClient(provider=provider)
    results: list[dict] = []

    # Разбиваем на пакеты по 5
    batch_size = 5
    for i in range(0, len(entries), batch_size):
        batch = entries[i:i + batch_size]
        results.extend(_analyze_batch(llm, batch))

    return results


def _analyze_batch(llm, batch: list[dict]) -> list[dict]:
    """Анализ одного пакета ошибок."""
    from agents.llm_client import Message

    errors_text = []
    for idx, entry in enumerate(batch, 1):
        st = entry.get("stacktrace", "")
        st_preview = st[:1500] if st else "(нет стектрейса)"
        count = entry.get("count", 1)
        count_note = f" (повторяется ×{count})" if count > 1 else ""

        errors_text.append(f"""--- Ошибка #{idx}{count_note} ---
Сервис: {entry.get('service', 'unknown')}
Уровень: {entry.get('level', 'ERROR')}
Время: {entry.get('timestamp', '')}
Сообщение: {entry.get('message', '')}
Стектрейс:
{st_preview}
""")

    prompt = f"""Ты senior DevOps/SRE инженер и QA-эксперт. Проанализируй ошибки из логов микросервисов.

{chr(10).join(errors_text)}

══════════════════════════════════════════════════
ИНСТРУКЦИИ
══════════════════════════════════════════════════
Для КАЖДОЙ ошибки верни JSON-объект в массиве:
{{
  "error_index": <номер ошибки>,
  "summary": "<что произошло — 1-2 предложения>",
  "root_cause": "<вероятная причина>",
  "impact": "<на что влияет>",
  "category": "<NPE|timeout|config|auth|db|network|memory|serialization|other>",
  "severity": "<critical|major|minor>",
  "suggestion": "<рекомендация по исправлению>",
  "defect_draft": "<готовый markdown баг-репорт в формате Jira (название, описание, шаги, ОР, ФР)>"
}}

Ответ — ТОЛЬКО JSON-массив, без пояснений, без markdown-блока кода. Начинай сразу с [.
Если данных недостаточно — укажи «Требует уточнения» в соответствующих полях.
Не выдумывай — основывайся только на данных из логов.
"""

    try:
        from agents.llm_client import Message
        response = llm.chat(
            [Message(role="user", content=prompt)],
            temperature=0.15,
            max_tokens=4000,
        )
        raw = response.content.strip()

        # Очищаем от возможных обёрток ```json...```
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()

        analyses = json.loads(raw)
        if not isinstance(analyses, list):
            analyses = [analyses]

        # Привязываем к записям
        results = []
        for a in analyses:
            idx = a.get("error_index", 1) - 1
            if 0 <= idx < len(batch):
                a["log_id"] = batch[idx].get("id", "")
                a["service"] = batch[idx].get("service", "")
            results.append(a)
        return results

    except json.JSONDecodeError:
        # Если LLM не вернул валидный JSON, возвращаем fallback
        return [{
            "error_index": i + 1,
            "log_id": entry.get("id", ""),
            "service": entry.get("service", ""),
            "summary": entry.get("message", "")[:200],
            "root_cause": "Не удалось проанализировать (ошибка парсинга ответа LLM)",
            "impact": "Требует ручного анализа",
            "category": "other",
            "severity": "major",
            "suggestion": "Проверьте стектрейс вручную",
            "defect_draft": "",
        } for i, entry in enumerate(batch)]

    except Exception as e:
        return [{
            "error_index": i + 1,
            "log_id": entry.get("id", ""),
            "service": entry.get("service", ""),
            "summary": f"Ошибка анализа: {str(e)[:100]}",
            "root_cause": "",
            "impact": "",
            "category": "other",
            "severity": "major",
            "suggestion": "",
            "defect_draft": "",
        } for i, entry in enumerate(batch)]


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/api/logs/search")
async def search_logs(body: LogSearchRequest, db: Session = Depends(get_db)) -> dict:
    """Поиск логов по фильтрам."""
    conn = _get_vps_connection(db, body.vps_id)
    client = _build_client(conn)

    try:
        time_from = datetime.fromisoformat(body.time_from.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, f"Некорректный time_from: {body.time_from}")
    try:
        time_to = datetime.fromisoformat(body.time_to.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, f"Некорректный time_to: {body.time_to}")

    try:
        result = await asyncio.to_thread(
            client.search,
            services=body.services,
            level=body.level,
            time_from=time_from,
            time_to=time_to,
            query=body.query,
            limit=body.limit,
        )
    except Exception as e:
        raise HTTPException(502, f"Ошибка запроса к VPS: {str(e)[:300]}")

    raw_entries = [e.to_dict() for e in result.entries]
    grouped = _group_entries(raw_entries)
    services_found = sorted({e.service for e in result.entries})

    return {
        "entries": raw_entries,
        "grouped": grouped,
        "total": result.total,
        "unique_count": len(grouped),
        "services_found": services_found,
    }


@router.post("/api/logs/analyze")
async def analyze_logs(body: LogAnalyzeRequest, db: Session = Depends(get_db)) -> dict:
    """LLM-анализ выбранных ошибок."""
    if not body.entries:
        raise HTTPException(400, "Нет ошибок для анализа")
    if len(body.entries) > 50:
        raise HTTPException(400, "Максимум 50 ошибок за один запрос")

    try:
        analyses = await asyncio.to_thread(
            _analyze_with_llm,
            entries=body.entries,
            provider=body.provider,
        )
    except Exception as e:
        raise HTTPException(502, f"Ошибка LLM анализа: {str(e)[:300]}")

    return {"analyses": analyses}


@router.get("/api/logs/services")
async def get_log_services(
    vps_id: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    """Получить список микросервисов из VPS."""
    conn = _get_vps_connection(db, vps_id)
    client = _build_client(conn)

    try:
        services = await asyncio.to_thread(client.get_services)
    except Exception as e:
        raise HTTPException(502, f"Ошибка получения списка сервисов: {str(e)[:200]}")

    return {"services": services}
