"""
Генератор данных: сценарий ТКС.

Пользователь выбирает существующую ТКС, указывает нужное число участников —
система добавляет недостающих, удаляет лишних и обновляет счётчик в tcs.

Все проверки живут в agents/datagen_sql.py и agents/datagen_sync.py: сюда
операции приходят уже собранными и проверенными. Здесь только подключение,
выполнение в потоке и понятные ошибки наружу.
"""

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.datagen_presets import SYNC_TCS
from agents.datagen_sync import list_parents, plan_sync, sync_members
from backend.api.db_connector import get_db_connection
from db.testdata_connections import TestDataConnectionsStore

router = APIRouter()

# Потолок на разовую операцию — согласован с agents/datagen_sql.py.
MAX_TARGET = 500


def _connection_or_404(conn_id: str) -> dict:
    cfg = TestDataConnectionsStore.get_connection(conn_id)
    if not cfg:
        raise HTTPException(404, "Подключение к базе не найдено")
    return cfg


def _with_connection(conn_cfg: dict, fn):
    """Открывает соединение, выполняет и обязательно закрывает."""
    conn, _driver = get_db_connection(conn_cfg)
    try:
        return fn(conn)
    finally:
        try:
            conn.close()
        except Exception:
            pass


@router.get("/api/datagen/tcs/parents")
async def tcs_parents(connection_id: str, limit: int = 500) -> dict:
    """Список ТКС для выпадающего списка."""
    cfg = _connection_or_404(connection_id)
    try:
        rows = await asyncio.to_thread(
            _with_connection, cfg, lambda c: list_parents(c, SYNC_TCS, limit=limit)
        )
    except Exception as e:
        raise HTTPException(502, f"Не удалось получить список ТКС: {str(e)[:300]}")

    return {
        "items": [{"id": r[0], "label": r[1] or f"ТКС #{r[0]}"} for r in rows],
        "db_name": cfg.get("display_name", connection_id),
    }


class SyncRequest(BaseModel):
    connection_id: str = Field(..., min_length=1)
    parent_id: int
    target: int = Field(..., ge=0, le=MAX_TARGET)


@router.post("/api/datagen/tcs/plan")
async def tcs_plan(req: SyncRequest) -> dict:
    """Предпросмотр: что произойдёт, без изменений в базе."""
    cfg = _connection_or_404(req.connection_id)
    try:
        plan = await asyncio.to_thread(
            _with_connection, cfg,
            lambda c: plan_sync(c, SYNC_TCS, req.parent_id, req.target),
        )
    except Exception as e:
        raise HTTPException(502, f"Ошибка подключения: {str(e)[:300]}")

    if not plan.ok:
        raise HTTPException(400, plan.error)

    return {
        "current": plan.current,
        "target": plan.target,
        "to_insert": plan.to_insert,
        "to_delete": plan.to_delete,
        "count_after": plan.update_count_to,
        "summary": plan.describe(),
    }


@router.post("/api/datagen/tcs/sync")
async def tcs_sync(req: SyncRequest) -> dict:
    """Выполняет синхронизацию в одной транзакции."""
    cfg = _connection_or_404(req.connection_id)
    try:
        res = await asyncio.to_thread(
            _with_connection, cfg,
            lambda c: sync_members(c, SYNC_TCS, req.parent_id, req.target),
        )
    except Exception as e:
        raise HTTPException(502, f"Ошибка подключения: {str(e)[:300]}")

    if not res.ok:
        raise HTTPException(400, res.error)

    return {
        "inserted": res.inserted,
        "deleted": res.deleted,
        "count_updated": res.count_updated,
        "sample": res.rows[:3],
    }
