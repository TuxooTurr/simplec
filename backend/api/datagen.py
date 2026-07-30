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

from agents.datagen_presets import tcsmember_rules
from agents.datagen_sync import list_parents, plan_sync, sync_members
from backend.api.db_connector import get_db_connection, introspect_schema
from db.datagen_config_store import DatagenConfigStore
from db.testdata_connections import TestDataConnectionsStore

router = APIRouter()

# Потолок на разовую операцию — согласован с agents/datagen_sql.py.
MAX_TARGET = 500


def _connection_or_404(conn_id: str) -> dict:
    cfg = TestDataConnectionsStore.get_connection(conn_id)
    if not cfg:
        raise HTTPException(404, "Подключение к базе не найдено")
    return cfg


def _sync_config() -> dict:
    """Конфигурация синхронизации из настроек.

    Таблицы и колонки берутся из пользовательских настроек, а не из пресета:
    на разных стендах схема и названия отличаются. Правила заполнения участника
    остаются в коде — они привязаны к смыслу полей, а не к их именам.
    """
    saved = DatagenConfigStore.get_tcs()
    child_rules = dict(tcsmember_rules())
    # Ссылка на родителя должна называться так, как выбрано в настройках.
    child_rules.pop("tcs", None)
    child_rules[saved["child_fk_column"]] = {"rule": "from_parent"}

    return {
        **saved,
        # Писать разрешено только в выбранные таблицы — не во всё, что есть в базе.
        "allowed_tables": [saved["parent_table"], saved["child_table"]],
        "parent_updatable_columns": [saved["parent_count_column"]],
        "child_rules": child_rules,
    }


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
            _with_connection, cfg, lambda c: list_parents(c, _sync_config(), limit=limit)
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
            lambda c: plan_sync(c, _sync_config(), req.parent_id, req.target),
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
            lambda c: sync_members(c, _sync_config(), req.parent_id, req.target),
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


# ── Настройки: какие схема и таблицы использовать ────────────────────────────

@router.get("/api/datagen/tcs/config")
def tcs_config() -> dict:
    """Текущие настройки сценария ТКС."""
    return DatagenConfigStore.get_tcs()


class TcsConfigRequest(BaseModel):
    connection_id:       str = Field(default="")
    parent_table:        str = Field(default="")
    parent_id_column:    str = Field(default="")
    parent_label_column: str = Field(default="")
    parent_count_column: str = Field(default="")
    child_table:         str = Field(default="")
    child_id_column:     str = Field(default="")
    child_fk_column:     str = Field(default="")
    child_marker_column: str = Field(default="")
    marker:              str = Field(default="")


@router.put("/api/datagen/tcs/config")
def save_tcs_config(body: TcsConfigRequest) -> dict:
    """Сохраняет настройки. Пустые поля не затирают сохранённое."""
    patch = {k: v for k, v in body.model_dump().items() if str(v).strip()}

    if patch.get("parent_table") and patch.get("parent_table") == patch.get("child_table"):
        raise HTTPException(422, "Таблица ТКС и таблица участников должны быть разными")

    return DatagenConfigStore.save_tcs(patch)


@router.post("/api/datagen/tcs/config/reset")
def reset_tcs_config() -> dict:
    return DatagenConfigStore.reset_tcs()


@router.get("/api/datagen/schema")
async def datagen_schema(connection_id: str, refresh: bool = False) -> dict:
    """Схемы, таблицы и колонки выбранной базы — для выпадающих списков настроек.

    По умолчанию отдаём кэш подключения: интроспекция большой базы небыстрая,
    а состав таблиц меняется редко. refresh=true перечитывает из базы.
    """
    cfg = _connection_or_404(connection_id)

    schema = None if refresh else cfg.get("cached_schema")
    if not schema:
        def _read(conn):
            data = introspect_schema(conn)
            TestDataConnectionsStore.update_cached_schema(connection_id, data)
            return data
        try:
            schema = await asyncio.to_thread(_with_connection, cfg, _read)
        except Exception as e:
            raise HTTPException(502, f"Не удалось прочитать схему: {str(e)[:300]}")

    tables = []
    for full_name, columns in (schema or {}).items():
        schema_name, _, table_name = full_name.rpartition(".")
        tables.append({
            "full_name": full_name,
            "schema": schema_name,
            "table": table_name or full_name,
            "columns": [
                {
                    "name": c.get("name", ""),
                    "type": c.get("type", ""),
                    "pk": bool(c.get("pk")),
                    "fk": c.get("fk"),
                }
                for c in (columns or [])
            ],
        })

    tables.sort(key=lambda t: (t["schema"], t["table"]))
    return {
        "schemas": sorted({t["schema"] for t in tables if t["schema"]}),
        "tables": tables,
        "from_cache": not refresh and bool(cfg.get("cached_schema")),
    }
