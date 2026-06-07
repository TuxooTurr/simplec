"""
Управление Jupyter-ядрами для выполнения ячеек алертов.

REST:
  POST   /api/kernel/start/{script_id}    — запустить ядро
  DELETE /api/kernel/stop/{script_id}     — остановить ядро
  GET    /api/kernel/status/{script_id}   — статус ядра
  POST   /api/kernel/execute/{script_id}  — выполнить код
  GET    /api/kernel/all-status           — статус всех ядер (superuser)
  GET    /api/kernel/audit                — аудит запусков
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

_ROOT = Path(__file__).resolve().parent.parent.parent
_AUDIT_FILE = _ROOT / "data" / "kernel_audit.json"
_AUDIT_MAX = 200


# ── Kernel session store ──────────────────────────────────────────────────────

@dataclass
class KernelSession:
    km: object
    kc: object
    kernel_id: str = ""
    started_by: str = ""
    started_at: str = ""
    script_name: str = ""


_sessions: dict[str, KernelSession] = {}


# ── Audit ─────────────────────────────────────────────────────────────────────

def _load_audit() -> list[dict]:
    if not _AUDIT_FILE.exists():
        return []
    with open(_AUDIT_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save_audit(entries: list[dict]) -> None:
    _AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_AUDIT_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


def _add_audit(entry: dict) -> None:
    entry.setdefault("ts", datetime.now(timezone.utc).isoformat())
    entries = _load_audit()
    entries.insert(0, entry)
    _save_audit(entries[:_AUDIT_MAX])


# ── Sync helpers (run in thread) ──────────────────────────────────────────────

def _strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", text)


def _start_sync(script_id: str, user_login: str, script_name: str) -> str:
    from jupyter_client import KernelManager

    km = KernelManager(kernel_name="python3")
    km.start_kernel()

    kc = km.blocking_client()
    kc.start_channels()
    kc.wait_for_ready(timeout=30)

    kid = str(km.kernel_id or "")
    _sessions[script_id] = KernelSession(
        km=km,
        kc=kc,
        kernel_id=kid,
        started_by=user_login,
        started_at=datetime.now(timezone.utc).isoformat(),
        script_name=script_name,
    )
    return kid


def _stop_sync(script_id: str) -> None:
    session = _sessions.pop(script_id, None)
    if not session:
        return
    try:
        session.kc.stop_channels()
    except Exception:
        pass
    try:
        session.km.shutdown_kernel(now=True)
    except Exception:
        pass


def _execute_sync(script_id: str, code: str, timeout: int) -> dict:
    import queue as _q

    session = _sessions.get(script_id)
    if not session:
        raise ValueError("Ядро не найдено")

    kc = session.kc
    kc.execute(code)

    outputs: list[str] = []
    error: Optional[str] = None

    while True:
        try:
            msg = kc.get_iopub_msg(timeout=timeout)
        except _q.Empty:
            outputs.append("\n[timeout — ядро не ответило]\n")
            break

        mtype   = msg.get("msg_type", "")
        content = msg.get("content", {})

        if mtype == "stream":
            outputs.append(content.get("text", ""))

        elif mtype in ("execute_result", "display_data"):
            text = content.get("data", {}).get("text/plain", "")
            if text:
                outputs.append(text + "\n")

        elif mtype == "error":
            ename  = content.get("ename", "Error")
            evalue = content.get("evalue", "")
            tb     = "\n".join(_strip_ansi(l) for l in content.get("traceback", []))
            error  = tb or f"{ename}: {evalue}"
            outputs.append(f"[{ename}] {evalue}\n")

        elif mtype == "status" and content.get("execution_state") == "idle":
            break

    return {"output": "".join(outputs), "error": error}


def _get_user_login(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if user:
        return user.get("login", "unknown")
    return "unknown"


# ── Routes ────────────────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    code:    str
    timeout: int = 60


@router.post("/api/kernel/start/{script_id}")
async def start_kernel(script_id: str, request: Request, script_name: str = "") -> dict:
    user_login = _get_user_login(request)

    session = _sessions.get(script_id)
    if session:
        try:
            if session.km.is_alive():
                return {
                    "status": "already_running",
                    "kernel_id": session.kernel_id,
                    "started_by": session.started_by,
                    "started_at": session.started_at,
                }
        except Exception:
            pass
        _sessions.pop(script_id, None)

    try:
        kid = await asyncio.to_thread(_start_sync, script_id, user_login, script_name)
        _add_audit({
            "action": "start",
            "script_id": script_id,
            "script_name": script_name,
            "user": user_login,
        })
        return {"status": "started", "kernel_id": kid, "started_by": user_login}
    except Exception as e:
        raise HTTPException(500, f"Не удалось запустить ядро: {e}")


@router.delete("/api/kernel/stop/{script_id}")
async def stop_kernel(script_id: str, request: Request) -> dict:
    user_login = _get_user_login(request)
    session = _sessions.get(script_id)
    script_name = session.script_name if session else ""
    stopped_by_other = session and session.started_by != user_login

    await asyncio.to_thread(_stop_sync, script_id)
    _add_audit({
        "action": "stop",
        "script_id": script_id,
        "script_name": script_name,
        "user": user_login,
        "stopped_other": stopped_by_other,
    })
    return {"status": "stopped"}


@router.get("/api/kernel/status/{script_id}")
async def kernel_status(script_id: str) -> dict:
    session = _sessions.get(script_id)
    if not session:
        return {"alive": False}
    try:
        alive = bool(session.km.is_alive())
    except Exception:
        alive = False
    return {
        "alive": alive,
        "kernel_id": session.kernel_id,
        "started_by": session.started_by,
        "started_at": session.started_at,
    }


@router.get("/api/kernel/all-status")
async def all_kernel_status() -> list[dict]:
    result = []
    for script_id, session in list(_sessions.items()):
        try:
            alive = bool(session.km.is_alive())
        except Exception:
            alive = False
        result.append({
            "script_id": script_id,
            "script_name": session.script_name,
            "alive": alive,
            "kernel_id": session.kernel_id,
            "started_by": session.started_by,
            "started_at": session.started_at,
        })
    return result


@router.get("/api/kernel/audit")
async def get_audit(limit: int = 50) -> list[dict]:
    return _load_audit()[:min(limit, _AUDIT_MAX)]


@router.post("/api/kernel/execute/{script_id}")
async def execute_code(script_id: str, req: ExecuteRequest, request: Request) -> dict:
    if script_id not in _sessions:
        raise HTTPException(404, "Ядро не запущено — нажмите «Подключиться»")

    user_login = _get_user_login(request)
    _add_audit({
        "action": "execute",
        "script_id": script_id,
        "script_name": _sessions[script_id].script_name,
        "user": user_login,
    })

    try:
        result = await asyncio.to_thread(_execute_sync, script_id, req.code, req.timeout)
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Ошибка выполнения: {e}")
