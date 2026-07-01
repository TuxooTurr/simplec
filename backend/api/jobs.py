"""
API управления джобами — кнопки запуска scheduled-задач.

Джоб выполняет UPDATE-запрос к внешней БД, подставляя nextfiretime
(epoch-миллисекунды = момент нажатия + 30 сек).

Эндпоинты:
  GET    /api/jobs                   — список джобов
  POST   /api/jobs                   — создать / обновить джоб
  DELETE /api/jobs/{id}              — удалить джоб
  POST   /api/jobs/{id}/execute      — запустить джоб (однократно)
  POST   /api/jobs/execute-batch     — запустить несколько джобов (папка)
  GET    /api/jobs/history           — история запусков

  GET    /api/jobs/folders           — список папок
  POST   /api/jobs/folders           — создать / обновить папку
  DELETE /api/jobs/folders/{id}      — удалить папку
"""

import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.api.db_connector import get_db_connection
from db.jobs_store import JobsStore
from db.testdata_connections import TestDataConnectionsStore

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────────

class JobDef(BaseModel):
    id:                    Optional[str] = None
    name:                  str
    connection_id:         str           # ссылка на testdata_connections
    update_sql:            str           # UPDATE ... SET next_fire_time = {nextfiretime} WHERE ...
    folder_id:             Optional[str] = None
    visible_to_monitoring: bool          = False
    created_at:            Optional[str] = None


class JobFolder(BaseModel):
    id:   Optional[str] = None
    name: str


class ExecuteRequest(BaseModel):
    offset_ms: int = 30000   # сдвиг от текущего момента (по умолчанию +30 сек)


class BatchExecuteRequest(BaseModel):
    job_ids:   list[str]
    offset_ms: int = 30000


# ── DB executor ──────────────────────────────────────────────────────────────

def _execute_update_sync(conn_config: dict, sql: str) -> dict:
    """
    Подключается к внешней БД (через тот же реестр драйверов, что и «Тестовые
    данные») и выполняет UPDATE-запрос. Возвращает {"rows_affected": N}.
    """
    conn, _driver = get_db_connection(conn_config)
    try:
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.rowcount
        conn.commit()
        return {"rows_affected": rows}
    finally:
        conn.close()


def _build_sql(template: str, nextfiretime: int) -> str:
    """Подставляет {nextfiretime} в шаблон SQL."""
    return template.replace("{nextfiretime}", str(nextfiretime))


# ── Folders ──────────────────────────────────────────────────────────────────

@router.get("/api/jobs/folders")
def list_folders() -> list[dict]:
    return JobsStore.get_folders()


@router.post("/api/jobs/folders")
def upsert_folder(folder: JobFolder) -> dict:
    return JobsStore.save_folder(folder.model_dump(exclude_none=False))


@router.delete("/api/jobs/folders/{folder_id}")
def remove_folder(folder_id: str) -> dict:
    ok = JobsStore.delete_folder(folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Папка не найдена")
    return {"status": "deleted"}


# ── Jobs CRUD ────────────────────────────────────────────────────────────────

@router.get("/api/jobs")
def list_jobs() -> list[dict]:
    return JobsStore.get_jobs()


@router.post("/api/jobs")
def upsert_job(job: JobDef) -> dict:
    # Проверяем что подключение существует
    conn = TestDataConnectionsStore.get_connection(job.connection_id)
    if not conn:
        raise HTTPException(status_code=400, detail=f"Подключение '{job.connection_id}' не найдено")
    data = job.model_dump(exclude_none=False)
    return JobsStore.save_job(data)


@router.delete("/api/jobs/{job_id}")
def remove_job(job_id: str) -> dict:
    ok = JobsStore.delete_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Джоб не найден")
    return {"status": "deleted"}


# ── Execution ────────────────────────────────────────────────────────────────

@router.post("/api/jobs/{job_id}/execute")
async def execute_job(job_id: str, req: ExecuteRequest = ExecuteRequest()) -> dict:
    """Запустить джоб: выполнить UPDATE с nextfiretime = now + offset_ms."""
    job = JobsStore.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Джоб не найден")

    conn_config = TestDataConnectionsStore.get_connection(job["connection_id"])
    if not conn_config:
        raise HTTPException(status_code=400, detail="Подключение к БД не найдено")

    nextfiretime = int(time.time() * 1000) + req.offset_ms
    sql = _build_sql(job["update_sql"], nextfiretime)

    try:
        result = await asyncio.to_thread(_execute_update_sync, conn_config, sql)
        JobsStore.add_history({
            "job_id":        job_id,
            "job_name":      job.get("name", job_id),
            "connection_id": job["connection_id"],
            "sql":           sql,
            "nextfiretime":  nextfiretime,
            "rows_affected": result["rows_affected"],
            "status":        "ok",
        })
        return {
            "ok":            True,
            "job_id":        job_id,
            "nextfiretime":  nextfiretime,
            "rows_affected": result["rows_affected"],
            "sql":           sql,
        }
    except Exception as e:
        logger.error("Job execute error: %s", e)
        JobsStore.add_history({
            "job_id":        job_id,
            "job_name":      job.get("name", job_id),
            "connection_id": job["connection_id"],
            "sql":           sql,
            "nextfiretime":  nextfiretime,
            "status":        "error",
            "error":         str(e),
        })
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/jobs/execute-batch")
async def execute_batch(req: BatchExecuteRequest) -> dict:
    """Запустить несколько джобов (для запуска папки)."""
    results = []
    for jid in req.job_ids:
        try:
            r = await execute_job(jid, ExecuteRequest(offset_ms=req.offset_ms))
            results.append(r)
        except HTTPException as e:
            results.append({"ok": False, "job_id": jid, "error": e.detail})
        except Exception as e:
            results.append({"ok": False, "job_id": jid, "error": str(e)})
    ok_count = sum(1 for r in results if r.get("ok"))
    return {
        "total":   len(req.job_ids),
        "ok":      ok_count,
        "failed":  len(req.job_ids) - ok_count,
        "results": results,
    }


# ── History ──────────────────────────────────────────────────────────────────

@router.get("/api/jobs/history")
def get_history(limit: int = 30) -> list[dict]:
    return JobsStore.get_history(limit)
