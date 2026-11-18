"""Hourly publication of the persisted Jira tool plan; independent of browser lifetime."""

import asyncio
import json
import time
from datetime import datetime, timezone

from fastapi import HTTPException

from db.postgres import SessionLocal

INTERVAL = 3600
_monitor: asyncio.Task | None = None
_job: asyncio.Task | None = None


def running() -> bool:
    return _job is not None and not _job.done()


def due(status: dict, now: float | None = None) -> bool:
    return (time.time() if now is None else now) - float(status.get("attemptEpoch") or 0) >= INTERVAL


def _error(exc: Exception) -> str:
    return str(exc.detail if isinstance(exc, HTTPException) else exc)[:300]


def _sync() -> None:
    from backend.api import jira_tool as jira, stands as st

    with SessionLocal() as db:
        status = {**st._stored(db, st._K_SYNC), "attemptEpoch": time.time(),
                  "lastAttemptAt": datetime.now(timezone.utc).isoformat(), "errors": {}, "pages": {}}

        def save():
            st._set(db, st._K_SYNC, json.dumps(status, ensure_ascii=False), "Публикация графиков стендов")
            db.commit()

        save()
        keys = sorted({item["task"] for item in st._plan_candidates(db)})
        previous = st._stored(db, st._K_PLAN_ISSUES).get("items") or {}
        items = {key: previous[key] for key in keys if key in previous}
        plan_errors = []
        for offset in range(0, len(keys), jira.MAX_KEYS):
            batch = keys[offset:offset + jira.MAX_KEYS]
            try:
                fresh = jira.stand_plan(jira.KeysBody(keys=batch), db=db)["items"]
                items.update(fresh)
                missing = set(batch) - fresh.keys()
                if missing:
                    plan_errors.append(f"Jira не вернула задачи: {', '.join(sorted(missing)[:10])}")
            except Exception as exc:
                plan_errors.append(_error(exc))
        warning = "План Jira обновлён не полностью; сохранены последние известные даты. " + "; ".join(plan_errors) if plan_errors else ""
        st._set(db, st._K_PLAN_ISSUES, json.dumps({"items": items, "error": warning}, ensure_ascii=False),
                "Плановое окончание задач для графиков стендов")
        db.commit()
        if warning:
            status["errors"]["Jira"] = warning
        cfg = st._load_cfg(db)
        for stand, pid in st._config(db)["pages"].items():
            if not pid:
                continue
            try:
                error = st.publish(cfg, pid, {"stand": stand}, db)
                if error:
                    status["errors"][stand] = error
                else:
                    status["pages"][stand] = pid
            except Exception as exc:
                status["errors"][stand] = _error(exc)
        status["finishedAt"] = datetime.now(timezone.utc).isoformat()
        if not status["errors"] and status["pages"]:
            status["lastSuccessAt"] = status["finishedAt"]
        save()


async def _run() -> None:
    # Await the thread even during shutdown: publishing must not race a replacement worker.
    worker = asyncio.create_task(asyncio.to_thread(_sync))
    try:
        await asyncio.shield(worker)
    except asyncio.CancelledError:
        await worker
        raise
    except Exception as exc:
        from backend.api import stands as st
        with SessionLocal() as db:
            status = st._stored(db, st._K_SYNC)
            status.update(finishedAt=datetime.now(timezone.utc).isoformat(), errors={"Публикация": _error(exc)})
            st._set(db, st._K_SYNC, json.dumps(status, ensure_ascii=False), "Публикация графиков стендов")
            db.commit()


def request_sync() -> None:
    global _job
    if not running():
        _job = asyncio.create_task(_run())


def _is_due() -> bool:
    from backend.api import stands as st
    with SessionLocal() as db:
        cfg = st._load_cfg(db)
        return bool((cfg.get("token") or cfg.get("token_path"))
                    and any(st._config(db)["pages"].values()) and due(st._stored(db, st._K_SYNC)))


async def _watch() -> None:
    while True:
        try:
            if not running() and await asyncio.to_thread(_is_due):
                request_sync()
        except Exception:
            # A temporary DB/configuration failure is retried on the next tick.
            pass
        await asyncio.sleep(30)


async def start() -> None:
    global _monitor
    if _monitor is None or _monitor.done():
        _monitor = asyncio.create_task(_watch())


async def stop() -> None:
    global _monitor, _job
    if _monitor is not None:
        _monitor.cancel()
        await asyncio.gather(_monitor, return_exceptions=True)
        _monitor = None
    if _job is not None:
        await asyncio.gather(_job, return_exceptions=True)
        _job = None
