"""Logs screen: catalog, bounded read queries and analysis of selected events."""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from hashlib import sha256
from time import monotonic
from typing import Awaitable, Callable
from uuid import uuid4

import anyio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import AwareDatetime, BaseModel, Field, SecretStr, model_validator

from agents.log_assertions import LogFilter, read_matching
from agents.logs_investigation import investigate_selection
from agents.logs_mcp import DEMO_SERVICES, UTC, LogSourceError, LogSourceTimeout, Record, configured, configured_namespace, local_pvs_configured, open_source, redact
from backend.api.auth import require_superuser, require_user
from db import ms_store, pvs_credentials, log_catalog
from db.paths import MOCK
from webconnect.secrets import SecretError

router = APIRouter(prefix="/api/mcp-logs", tags=["MCP logs"])
logger = logging.getLogger(__name__)
MAX_ROWS = 500
MAX_ACTIVE_JOBS = 6
MAX_RETAINED_JOBS = 24
JOB_RESULT_TTL = 300


@dataclass
class LogJob:
    owner: bytes
    phase: str
    started_at: float = field(default_factory=monotonic)
    finished_at: float | None = None
    status: str = "running"
    result: dict | None = None
    detail: str = ""
    task: asyncio.Task | None = None


_jobs: dict[str, LogJob] = {}


def _job_timeout() -> int:
    try:
        return max(30, min(3600, int(os.getenv("LOGS_MCP_JOB_TIMEOUT", "900"))))
    except ValueError:
        return 900


def _job_owner(request: Request, _user: dict = Depends(require_user)) -> bytes:
    return sha256(request.headers["authorization"].encode()).digest()


async def _run_job(job: LogJob, work: Callable[[LogJob], Awaitable[dict]]) -> None:
    limit = _job_timeout()
    try:
        with anyio.fail_after(limit):
            job.result = await work(job)
        job.status = "done"
    except asyncio.CancelledError:
        job.status = "cancelled"
        raise
    except TimeoutError:
        job.status = "timeout"
        job.detail = f"Операция превысила лимит в {limit:g} с. Сузьте период или выберите один микросервис."
    except HTTPException as exc:
        job.status = "timeout" if exc.status_code == 504 else "error"
        job.detail = str(exc.detail)
    except Exception as exc:
        logger.warning("Операция с логами завершилась с ошибкой: %s", type(exc).__name__)
        job.status = "error"
        job.detail = "Не удалось завершить операцию с логами. Повторите запрос."


def _start_job(owner: bytes, phase: str, work: Callable[[LogJob], Awaitable[dict]]) -> dict:
    if sum(job.finished_at is None for job in _jobs.values()) >= MAX_ACTIVE_JOBS:
        raise HTTPException(429, "Сейчас выполняется несколько операций с логами. Повторите запрос чуть позже.")
    if len(_jobs) >= MAX_RETAINED_JOBS:
        oldest = next((job_id for job_id, job in _jobs.items() if job.finished_at is not None), None)
        if oldest:
            _jobs.pop(oldest, None)
    job_id, job = uuid4().hex, LogJob(owner, phase)
    _jobs[job_id] = job
    loop = asyncio.get_running_loop()

    def finish(_: asyncio.Task) -> None:
        job.finished_at = monotonic()
        loop.call_later(JOB_RESULT_TTL, _jobs.pop, job_id, None)

    job.task = loop.create_task(_run_job(job, work))
    job.task.add_done_callback(finish)
    return {"id": job_id}


def _get_job(job_id: str, owner: bytes) -> LogJob:
    job = _jobs.get(job_id)
    if not job or job.owner != owner:
        raise HTTPException(404, "Операция с логами недоступна. Запустите её снова.")
    return job


async def stop_log_jobs() -> None:
    tasks = [job.task for job in _jobs.values() if job.task and not job.task.done()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _jobs.clear()


def _services() -> list[str]:
    if os.getenv("LOGS_MCP_PROFILE", "").lower() == "pvs" and not MOCK:
        return log_catalog.load().get("services", [])
    names = [*DEMO_SERVICES, *ms_store.load()] if MOCK else ms_store.load()
    return sorted(dict.fromkeys(names), key=str.casefold)


class Period(BaseModel):
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def check_period(self):
        self.start = self.start.astimezone(UTC)
        self.end = self.end.astimezone(UTC)
        if self.start >= self.end:
            raise ValueError("Начало периода должно быть раньше окончания")
        if self.end - self.start > timedelta(days=7):
            raise ValueError("Выберите период не длиннее 7 дней")
        return self


class Query(Period):
    service: str | None = Field(default=None, max_length=200)
    errorsOnly: bool = False


class Analysis(Period):
    provider: str = Field(default="gigachat", min_length=1, max_length=100)
    records: list[Record] = Field(min_length=1, max_length=12)


class PvsCredentials(BaseModel):
    login: str = Field(min_length=1, max_length=200)
    password: SecretStr


def _pvs_settings() -> dict:
    login = os.getenv("OPENSEARCH_USERNAME", "").strip()
    source = "environment" if os.getenv("OPENSEARCH_PASSWORD") else "none"
    try:
        stored = pvs_credentials.load()
        if stored:
            login, source = stored[0], "saved"
    except SecretError:
        source = "unavailable"
    return {"login": login, "credentialSource": source, "demo": MOCK, "launchConfigured": local_pvs_configured(),
            "apiUrl": os.getenv("OPENSEARCH_URL", ""), "namespace": configured_namespace(),
            "index": os.getenv("LOGS_PVS_INDEX", "")}


@router.get("/pvs", dependencies=[Depends(require_superuser)])
def pvs_settings() -> dict:
    return _pvs_settings()


@router.put("/pvs", dependencies=[Depends(require_superuser)])
def save_pvs_credentials(body: PvsCredentials) -> dict:
    password = body.password.get_secret_value()
    login = body.login.strip()
    if not login or not password or len(password) > 4096:
        raise HTTPException(422, "Укажите логин и пароль PVS. Пароль должен быть не длиннее 4096 символов.")
    try:
        pvs_credentials.save(login, password)
    except (OSError, SecretError, ValueError) as exc:
        raise HTTPException(503, "Не удалось зашифровать и сохранить пароль PVS на сервере Shark.") from exc
    return _pvs_settings()


@router.delete("/pvs", dependencies=[Depends(require_superuser)])
def clear_pvs_credentials() -> dict:
    try:
        pvs_credentials.clear()
    except OSError as exc:
        raise HTTPException(503, "Не удалось удалить сохранённую учётную запись PVS.") from exc
    return _pvs_settings()


@router.post("/pvs/test", dependencies=[Depends(require_superuser)])
async def test_pvs_connection() -> dict:
    if not MOCK and not local_pvs_configured():
        raise HTTPException(409, "Сначала настройте запуск PVS MCP и индекс на сервере Shark.")
    now = datetime.now(UTC)
    try:
        async with open_source() as source:
            result = await read_matching(source, now - timedelta(minutes=15), now, LogFilter(), 1)
    except LogSourceTimeout as exc:
        raise HTTPException(504, str(exc)) from exc
    except LogSourceError as exc:
        raise HTTPException(502, str(exc)) from exc
    if MOCK:
        return {"message": "Демо-режим. Shark читает тестовые события. Проверка учётной записи доступна на ИФТ."}
    if result.timed_out and not result.records:
        raise HTTPException(504, "PVS ответил, но не вернул запись до таймаута проверки подключения.")
    return {"message": ("PVS MCP доступен. Прочитана запись за последние 15 минут." if result.records
                        else "PVS MCP ответил. За последние 15 минут записей в namespace нет.")}


@router.get("/catalog")
def catalog() -> dict:
    cached = log_catalog.load()
    try: hours = max(1, min(720, int(os.getenv("LOGS_PVS_SERVICES_HOURS", "72"))))
    except ValueError: hours = 72
    return {"services": _services(), "configured": configured(), "demo": MOCK, "limit": MAX_ROWS,
            "namespace": configured_namespace(), "canDiscoverServices": MOCK or os.getenv("LOGS_MCP_PROFILE", "").lower() == "pvs",
            "servicesHours": hours, "catalogFresh": log_catalog.fresh(cached), "catalogUpdatedAt": cached.get("updatedAt")}


@router.post("/catalog/refresh")
async def refresh_catalog(force: bool = False, user: dict = Depends(require_user)) -> dict:
    cached = log_catalog.load()
    if not force and log_catalog.fresh(cached): return {**catalog(), "updatedAt": cached.get("updatedAt"), "cached": True}
    from agents.logs_mcp import discover_services
    try:
        async with open_source() as source:
            services = await discover_services(source)
        log_catalog.save(services)
    except LogSourceTimeout as exc: raise HTTPException(504, str(exc)) from exc
    except LogSourceError as exc: raise HTTPException(502, str(exc)) from exc
    return {**catalog(), "services": services, "updatedAt": log_catalog.load().get("updatedAt"), "cached": False}


@router.post("/query")
async def query(body: Query) -> dict:
    if not configured():
        raise HTTPException(503, "Источник логов MCP ещё не настроен на сервере Shark.")
    service = body.service.strip() if body.service else None
    if service is not None and service not in _services():
        raise HTTPException(422, "Выберите микросервис из справочника.")
    try:
        async with open_source() as source:
            result = await read_matching(source, body.start, body.end, LogFilter(service=service, errors_only=body.errorsOnly), MAX_ROWS)
    except LogSourceTimeout as exc:
        raise HTTPException(504, str(exc)) from exc
    except LogSourceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"records": result.records, "truncated": result.truncated, "timedOut": result.timed_out,
            "errorCount": sum(r.error for r in result.records)}


@router.post("/analyze")
async def analyze(body: Analysis) -> dict:
    return await _analyze(body)


async def _analyze(body: Analysis, job: LogJob | None = None) -> dict:
    # Дополнительная защита на границе, если клиент передал записи вручную.
    records = [r.model_copy(update={"message": redact(r.message), "stack": [redact(x[:1000]) for x in r.stack]}) for r in body.records]
    def model_started() -> None:
        if job:
            job.phase = "model"

    try:
        return await investigate_selection(records, _services(), body.start, body.end, body.provider, on_model=model_started)
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise HTTPException(504, "Модель не успела подготовить разбор. Повторите разбор выбранных записей.") from exc
    except Exception as exc:
        logger.warning("Ошибка модели при анализе логов: %s", type(exc).__name__)
        raise HTTPException(502, "ИИ не смог подготовить разбор. Проверьте выбранную модель и повторите запрос.") from exc


@router.post("/query/jobs", status_code=202)
async def start_query(body: Query, owner: bytes = Depends(_job_owner)) -> dict:
    return _start_job(owner, "search", lambda _: query(body))


@router.post("/pvs/test/jobs", status_code=202, dependencies=[Depends(require_superuser)])
async def start_pvs_test(owner: bytes = Depends(_job_owner)) -> dict:
    return _start_job(owner, "search", lambda _: test_pvs_connection())


@router.post("/analyze/jobs", status_code=202)
async def start_analysis(body: Analysis, owner: bytes = Depends(_job_owner)) -> dict:
    return _start_job(owner, "related", lambda job: _analyze(body, job))


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, response: Response, owner: bytes = Depends(_job_owner)) -> dict:
    job = _get_job(job_id, owner)
    response.headers["Cache-Control"] = "no-store"
    snapshot = {"phase": job.phase, "status": job.status, "seconds": int((job.finished_at or monotonic()) - job.started_at)}
    if job.status == "done":
        snapshot["result"] = job.result
    elif job.detail:
        snapshot["detail"] = job.detail
    return snapshot


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, owner: bytes = Depends(_job_owner)) -> dict:
    job = _get_job(job_id, owner)
    if job.status == "running" and job.task:
        job.status = "cancelled"
        job.task.cancel()
    return {"ok": True}
