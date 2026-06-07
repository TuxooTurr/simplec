"""
REST API фермы устройств --- встроенный Farm Hub.

Все эндпоинты: /api/farm/...

Агентские эндпоинты (/api/farm/agents/...) не требуют авторизации ---
агенты не имеют учётных записей SimpleTest.
"""

import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from backend.farm.manager import farm_manager

router = APIRouter()
log = logging.getLogger("device_farm")


# == Агентские эндпоинты (без авторизации) ====================================


@router.post("/api/farm/agents/register")
async def agent_register(body: dict) -> dict:
    """Регистрация устройства от агента."""
    udid = body.get("udid")
    if not udid:
        raise HTTPException(400, "udid обязателен")
    await farm_manager.register_device(
        udid=udid,
        platform=body.get("platform", "ANDROID"),
        model=body.get("model"),
        os_version=body.get("osVersion"),
        agent_host=body.get("agentHost"),
        appium_port=body.get("appiumPort"),
    )
    return {"status": "registered", "udid": udid}


@router.post("/api/farm/agents/heartbeat")
async def agent_heartbeat(body: dict) -> dict:
    """Heartbeat от агента."""
    udid = body.get("udid")
    if not udid:
        raise HTTPException(400, "udid обязателен")
    await farm_manager.heartbeat(udid, body.get("battery"))
    return {"status": "ok"}


# == Эндпоинты устройств (требуют авторизации через AuthMiddleware) ============


@router.get("/api/farm/devices")
async def list_devices(
    platform: str = Query(None, description="Фильтр: ANDROID | IOS"),
    status: str = Query(None, description="Фильтр: AVAILABLE | BUSY | OFFLINE | MAINTENANCE"),
) -> list:
    """Список устройств фермы."""
    return await farm_manager.get_devices(platform, status)


@router.get("/api/farm/devices/{udid}")
async def get_device(udid: str) -> dict:
    """Информация об устройстве по UDID."""
    d = await farm_manager.get_device(udid)
    if not d:
        raise HTTPException(404, f"Устройство {udid} не найдено")
    return d


@router.post("/api/farm/devices/{udid}/lock")
async def lock_device(udid: str, request: Request) -> dict:
    """Заблокировать (зарезервировать) устройство за пользователем."""
    user = getattr(request.state, "user", {})
    username = (user.get("login") or user.get("display_name") or "unknown") if isinstance(user, dict) else "unknown"
    try:
        session = await farm_manager.lock_device(udid, username)
        return {"sessionId": session["id"], "udid": udid, "status": "locked"}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@router.post("/api/farm/devices/{udid}/unlock")
async def unlock_device(udid: str) -> dict:
    """Разблокировать устройство."""
    try:
        await farm_manager.unlock_device(udid)
        return {"udid": udid, "status": "unlocked"}
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/api/farm/devices/{udid}/screenshot")
async def device_screenshot(udid: str):
    """Скриншот экрана устройства (PNG)."""
    try:
        data = await farm_manager.screenshot(udid)
        return Response(content=data, media_type="image/png")
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# == Эндпоинты сессий =========================================================


@router.get("/api/farm/sessions")
async def list_sessions(active: bool = Query(False, description="Только активные")) -> list:
    """Список сессий фермы."""
    return await farm_manager.get_sessions(active_only=active)


@router.post("/api/farm/sessions/{session_id}/release")
async def release_session(session_id: str) -> dict:
    """Принудительно завершить сессию."""
    try:
        await farm_manager.force_release(session_id)
        return {"status": "released", "sessionId": session_id}
    except ValueError as e:
        raise HTTPException(404, str(e))


# == Статус фермы =============================================================


@router.get("/api/farm/status")
async def farm_status() -> dict:
    """Статус фермы (аналог /actuator/health)."""
    return await farm_manager.get_status()
