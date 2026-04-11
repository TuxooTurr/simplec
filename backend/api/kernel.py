"""
Управление Jupyter-ядрами для выполнения ячеек алертов.

REST:
  POST   /api/kernel/start/{script_id}    — запустить ядро
  DELETE /api/kernel/stop/{script_id}     — остановить ядро
  GET    /api/kernel/status/{script_id}   — статус ядра
  POST   /api/kernel/execute/{script_id}  — выполнить код
"""

import asyncio
import re
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


# ── Kernel session store ──────────────────────────────────────────────────────

@dataclass
class KernelSession:
    km: object   # KernelManager
    kc: object   # BlockingKernelClient
    kernel_id: str = ""


_sessions: dict[str, KernelSession] = {}  # script_id → session


# ── Sync helpers (run in thread) ──────────────────────────────────────────────

def _strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", text)


def _start_sync(script_id: str) -> str:
    """Запускает ядро python3 и возвращает kernel_id."""
    from jupyter_client import KernelManager

    km = KernelManager(kernel_name="python3")
    km.start_kernel()

    kc = km.blocking_client()
    kc.start_channels()
    kc.wait_for_ready(timeout=30)

    kid = str(km.kernel_id or "")
    _sessions[script_id] = KernelSession(km=km, kc=kc, kernel_id=kid)
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


# ── Routes ────────────────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    code:    str
    timeout: int = 60


@router.post("/api/kernel/start/{script_id}")
async def start_kernel(script_id: str) -> dict:
    # Если уже запущено — вернуть статус
    session = _sessions.get(script_id)
    if session:
        try:
            if session.km.is_alive():
                return {"status": "already_running", "kernel_id": session.kernel_id}
        except Exception:
            pass
        _sessions.pop(script_id, None)

    try:
        kid = await asyncio.to_thread(_start_sync, script_id)
        return {"status": "started", "kernel_id": kid}
    except Exception as e:
        raise HTTPException(500, f"Не удалось запустить ядро: {e}")


@router.delete("/api/kernel/stop/{script_id}")
async def stop_kernel(script_id: str) -> dict:
    await asyncio.to_thread(_stop_sync, script_id)
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
    return {"alive": alive, "kernel_id": session.kernel_id}


@router.post("/api/kernel/execute/{script_id}")
async def execute_code(script_id: str, req: ExecuteRequest) -> dict:
    if script_id not in _sessions:
        raise HTTPException(404, "Ядро не запущено — нажмите «Подключиться»")
    try:
        result = await asyncio.to_thread(_execute_sync, script_id, req.code, req.timeout)
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Ошибка выполнения: {e}")
