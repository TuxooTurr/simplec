"""
Менеджер фермы устройств --- ядро Farm Hub, встроенное в SimpleTest.

Управляет:
- Регистрацией устройств от агентов
- Heartbeat и мониторингом здоровья
- Сессиями (lock/unlock)
- WebSocket трансляцией статусов
- Стримингом экрана
- Взаимодействием с устройствами (tap, swipe, text, etc.)
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import WebSocket
from starlette.websockets import WebSocketState

from db.postgres import SessionLocal
from db.metrics_models import FarmDevice, FarmSession

log = logging.getLogger("farm_manager")

# ── Вспомогательные утилиты ──────────────────────────────────────────────────


def _device_to_dict(d: FarmDevice, locked_by: Optional[str] = None) -> dict:
    """Преобразовать ORM-объект устройства в словарь для API/WS."""
    return {
        "udid": d.udid,
        "platform": d.platform,
        "model": d.model,
        "osVersion": d.os_version,
        "agentHost": d.agent_host,
        "appiumPort": d.appium_port,
        "status": d.status,
        "battery": d.battery,
        "lastSeen": d.last_seen.isoformat() if d.last_seen else None,
        "lockedBy": locked_by,
    }


def _session_to_dict(s: FarmSession) -> dict:
    """Преобразовать ORM-объект сессии в словарь для API."""
    return {
        "id": s.id,
        "deviceUdid": s.device_udid,
        "username": s.username,
        "sessionType": s.session_type,
        "startedAt": s.started_at.isoformat() if s.started_at else None,
        "endedAt": s.ended_at.isoformat() if s.ended_at else None,
        "timeoutMin": s.timeout_min,
        "status": s.status,
    }


async def _safe_send_json(ws: WebSocket, data: dict) -> bool:
    """Безопасно отправить JSON в WebSocket. Возвращает False при ошибке."""
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_json(data)
            return True
    except Exception:
        pass
    return False


async def _safe_send_bytes(ws: WebSocket, data: bytes) -> bool:
    """Безопасно отправить байты в WebSocket. Возвращает False при ошибке."""
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_bytes(data)
            return True
    except Exception:
        pass
    return False


# ── Основной класс менеджера ─────────────────────────────────────────────────


class FarmManager:
    """
    Синглтон-менеджер фермы мобильных устройств.

    Хранит in-memory состояние (подписчики WS, подключения агентов)
    и персистит данные об устройствах/сессиях в SQLite/PostgreSQL.
    """

    def __init__(self) -> None:
        # WebSocket подписчики на статусы устройств (браузерные клиенты)
        self._status_subscribers: set[WebSocket] = set()

        # WebSocket подписчики на экран конкретного устройства {udid: set[ws]}
        self._screen_subscribers: dict[str, set[WebSocket]] = {}

        # Подключения агентов {udid: WebSocket}
        self._agent_connections: dict[str, WebSocket] = {}

        # Фоновые задачи
        self._health_task: Optional[asyncio.Task] = None
        self._expiry_task: Optional[asyncio.Task] = None

        self._running = False

    # ── Жизненный цикл ───────────────────────────────────────────────────

    async def start(self) -> None:
        """Запустить фоновые задачи менеджера."""
        if self._running:
            return
        self._running = True
        self._health_task = asyncio.create_task(self._health_check_loop())
        self._expiry_task = asyncio.create_task(self._session_expiry_loop())
        log.info("Farm Manager запущен")

    async def stop(self) -> None:
        """Остановить фоновые задачи."""
        self._running = False
        for task in (self._health_task, self._expiry_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._health_task = None
        self._expiry_task = None
        log.info("Farm Manager остановлен")

    # ── Регистрация устройств ────────────────────────────────────────────

    async def register_device(
        self,
        udid: str,
        platform: str = "ANDROID",
        model: Optional[str] = None,
        os_version: Optional[str] = None,
        agent_host: Optional[str] = None,
        appium_port: Optional[int] = None,
    ) -> dict:
        """Зарегистрировать или обновить устройство (upsert)."""
        db = SessionLocal()
        try:
            device = db.query(FarmDevice).filter(FarmDevice.udid == udid).first()
            now = datetime.utcnow()
            if device:
                device.platform = platform.upper()
                device.model = model or device.model
                device.os_version = os_version or device.os_version
                device.agent_host = agent_host or device.agent_host
                device.appium_port = appium_port or device.appium_port
                device.last_seen = now
                # Если устройство было OFFLINE, вернуть в AVAILABLE
                if device.status == "OFFLINE":
                    device.status = "AVAILABLE"
            else:
                device = FarmDevice(
                    udid=udid,
                    platform=platform.upper(),
                    model=model,
                    os_version=os_version,
                    agent_host=agent_host,
                    appium_port=appium_port,
                    status="AVAILABLE",
                    last_seen=now,
                )
                db.add(device)
            db.commit()
            db.refresh(device)
            result = _device_to_dict(device)
            await self._broadcast_device_status(device, db)
            return result
        finally:
            db.close()

    async def heartbeat(self, udid: str, battery: Optional[int] = None) -> None:
        """Обновить heartbeat устройства."""
        db = SessionLocal()
        try:
            device = db.query(FarmDevice).filter(FarmDevice.udid == udid).first()
            if not device:
                log.warning("Heartbeat от неизвестного устройства: %s", udid)
                return
            device.last_seen = datetime.utcnow()
            if battery is not None:
                device.battery = battery
            # Если устройство было OFFLINE, вернуть в AVAILABLE
            if device.status == "OFFLINE":
                device.status = "AVAILABLE"
            db.commit()
            db.refresh(device)
            await self._broadcast_device_status(device, db)
        finally:
            db.close()

    # ── Запросы устройств ────────────────────────────────────────────────

    async def get_devices(
        self,
        platform_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> list[dict]:
        """Получить список устройств с опциональными фильтрами."""
        db = SessionLocal()
        try:
            q = db.query(FarmDevice)
            if platform_filter:
                q = q.filter(FarmDevice.platform == platform_filter.upper())
            if status_filter:
                q = q.filter(FarmDevice.status == status_filter.upper())
            devices = q.all()

            result = []
            for d in devices:
                locked_by = self._get_locked_by(d.udid, db)
                result.append(_device_to_dict(d, locked_by))
            return result
        finally:
            db.close()

    async def get_device(self, udid: str) -> Optional[dict]:
        """Получить информацию об одном устройстве."""
        db = SessionLocal()
        try:
            device = db.query(FarmDevice).filter(FarmDevice.udid == udid).first()
            if not device:
                return None
            locked_by = self._get_locked_by(udid, db)
            return _device_to_dict(device, locked_by)
        finally:
            db.close()

    def _get_locked_by(self, udid: str, db) -> Optional[str]:
        """Найти пользователя, который заблокировал устройство."""
        session = (
            db.query(FarmSession)
            .filter(FarmSession.device_udid == udid, FarmSession.status == "ACTIVE")
            .first()
        )
        return session.username if session else None

    # ── Сессии (lock / unlock) ───────────────────────────────────────────

    async def lock_device(self, udid: str, username: str) -> dict:
        """Заблокировать устройство для пользователя."""
        db = SessionLocal()
        try:
            device = db.query(FarmDevice).filter(FarmDevice.udid == udid).first()
            if not device:
                raise ValueError(f"Устройство {udid} не найдено")
            if device.status != "AVAILABLE":
                raise RuntimeError(
                    f"Устройство {udid} недоступно (статус: {device.status})"
                )

            # Получить таймаут из настроек
            timeout_min = self._get_session_timeout(db)

            session = FarmSession(
                id=str(uuid.uuid4()),
                device_udid=udid,
                username=username,
                session_type="MANUAL",
                started_at=datetime.utcnow(),
                timeout_min=timeout_min,
                status="ACTIVE",
            )
            device.status = "BUSY"
            db.add(session)
            db.commit()
            db.refresh(session)
            db.refresh(device)

            await self._broadcast_device_status(device, db)
            return _session_to_dict(session)
        finally:
            db.close()

    async def unlock_device(self, udid: str) -> None:
        """Разблокировать устройство (завершить активную сессию)."""
        db = SessionLocal()
        try:
            device = db.query(FarmDevice).filter(FarmDevice.udid == udid).first()
            if not device:
                raise ValueError(f"Устройство {udid} не найдено")

            session = (
                db.query(FarmSession)
                .filter(
                    FarmSession.device_udid == udid,
                    FarmSession.status == "ACTIVE",
                )
                .first()
            )
            if session:
                session.status = "COMPLETED"
                session.ended_at = datetime.utcnow()

            device.status = "AVAILABLE"
            db.commit()
            db.refresh(device)

            await self._broadcast_device_status(device, db)
        finally:
            db.close()

    async def get_sessions(self, active_only: bool = False) -> list[dict]:
        """Получить список сессий."""
        db = SessionLocal()
        try:
            q = db.query(FarmSession)
            if active_only:
                q = q.filter(FarmSession.status == "ACTIVE")
            q = q.order_by(FarmSession.started_at.desc())
            return [_session_to_dict(s) for s in q.limit(200).all()]
        finally:
            db.close()

    async def force_release(self, session_id: str) -> None:
        """Принудительно завершить сессию."""
        db = SessionLocal()
        try:
            session = db.query(FarmSession).filter(FarmSession.id == session_id).first()
            if not session:
                raise ValueError(f"Сессия {session_id} не найдена")

            session.status = "FORCE_RELEASED"
            session.ended_at = datetime.utcnow()

            device = (
                db.query(FarmDevice)
                .filter(FarmDevice.udid == session.device_udid)
                .first()
            )
            if device and device.status == "BUSY":
                device.status = "AVAILABLE"

            db.commit()

            if device:
                db.refresh(device)
                await self._broadcast_device_status(device, db)
        finally:
            db.close()

    def _get_session_timeout(self, db) -> int:
        """Получить таймаут сессии из настроек."""
        from db.metrics_models import MetricsSettings

        row = (
            db.query(MetricsSettings)
            .filter(MetricsSettings.key == "farm_session_timeout_min")
            .first()
        )
        if row and row.value:
            try:
                return int(row.value)
            except (ValueError, TypeError):
                pass
        return 30

    # ── WebSocket: статусы устройств (браузер) ───────────────────────────

    def subscribe_status(self, ws: WebSocket) -> None:
        """Подписать браузерный клиент на обновления статусов."""
        self._status_subscribers.add(ws)

    def unsubscribe_status(self, ws: WebSocket) -> None:
        """Отписать браузерный клиент от обновлений статусов."""
        self._status_subscribers.discard(ws)

    async def _broadcast_device_status(self, device: FarmDevice, db) -> None:
        """Отправить обновление статуса устройства всем подписчикам."""
        locked_by = self._get_locked_by(device.udid, db)
        msg = {
            "type": "device_status",
            "udid": device.udid,
            "platform": device.platform,
            "model": device.model,
            "osVersion": device.os_version,
            "status": device.status,
            "battery": device.battery,
            "lockedBy": locked_by,
        }
        dead: list[WebSocket] = []
        for ws in self._status_subscribers:
            ok = await _safe_send_json(ws, msg)
            if not ok:
                dead.append(ws)
        for ws in dead:
            self._status_subscribers.discard(ws)

    # ── WebSocket: экран устройства (браузер) ────────────────────────────

    def subscribe_screen(self, udid: str, ws: WebSocket) -> None:
        """Подписать браузерный клиент на стрим экрана устройства."""
        if udid not in self._screen_subscribers:
            self._screen_subscribers[udid] = set()
        self._screen_subscribers[udid].add(ws)

    def unsubscribe_screen(self, udid: str, ws: WebSocket) -> None:
        """Отписать браузерный клиент от стрима экрана."""
        subs = self._screen_subscribers.get(udid)
        if subs:
            subs.discard(ws)
            if not subs:
                del self._screen_subscribers[udid]

    async def push_screen_frame(self, udid: str, frame_bytes: bytes) -> None:
        """Переслать кадр экрана всем подписчикам устройства."""
        subs = self._screen_subscribers.get(udid)
        if not subs:
            return
        dead: list[WebSocket] = []
        for ws in subs:
            ok = await _safe_send_bytes(ws, frame_bytes)
            if not ok:
                dead.append(ws)
        for ws in dead:
            subs.discard(ws)

    async def handle_screen_command(self, udid: str, command_json: str) -> None:
        """Переслать команду от браузера агенту устройства."""
        agent_ws = self._agent_connections.get(udid)
        if not agent_ws:
            log.warning("Команда для %s: агент не подключён", udid)
            return
        try:
            await agent_ws.send_text(command_json)
        except Exception as e:
            log.error("Ошибка отправки команды агенту %s: %s", udid, e)

    # ── WebSocket: подключения агентов ───────────────────────────────────

    def register_agent_ws(self, udid: str, ws: WebSocket) -> None:
        """Зарегистрировать WebSocket агента устройства."""
        self._agent_connections[udid] = ws
        log.info("Агент подключён: %s", udid)

    def unregister_agent_ws(self, udid: str) -> None:
        """Отключить WebSocket агента устройства."""
        self._agent_connections.pop(udid, None)
        log.info("Агент отключён: %s", udid)

    # ── Скриншот ─────────────────────────────────────────────────────────

    async def screenshot(self, udid: str) -> bytes:
        """Получить скриншот устройства.

        Стратегия:
        1. Если агент подключён по WS --- отправить команду 'screenshot'
           и ждать бинарный ответ.
        2. Иначе --- HTTP GET к agent_host:9100/screenshot/{udid}.
        3. Если и это не удалось --- ошибка.
        """
        # Попробовать через агентский WebSocket
        agent_ws = self._agent_connections.get(udid)
        if agent_ws:
            try:
                await agent_ws.send_text(
                    json.dumps({"type": "screenshot", "udid": udid})
                )
                # Ждём бинарный ответ (максимум 10 секунд)
                data = await asyncio.wait_for(
                    agent_ws.receive_bytes(), timeout=10
                )
                return data
            except Exception as e:
                log.warning(
                    "Скриншот через WS агента %s не удался: %s, пробуем HTTP",
                    udid,
                    e,
                )

        # Fallback: HTTP GET к агенту
        db = SessionLocal()
        try:
            device = db.query(FarmDevice).filter(FarmDevice.udid == udid).first()
            if not device:
                raise ValueError(f"Устройство {udid} не найдено")
            if not device.agent_host:
                raise RuntimeError(
                    f"Агент устройства {udid} не подключён и host неизвестен"
                )

            url = f"http://{device.agent_host}:9100/screenshot/{udid}"
            async with httpx.AsyncClient(timeout=15, verify=False) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return resp.content
                raise RuntimeError(
                    f"Скриншот от агента: HTTP {resp.status_code}"
                )
        finally:
            db.close()

    # ── Статус фермы ─────────────────────────────────────────────────────

    async def get_status(self) -> dict:
        """Общий статус фермы устройств."""
        db = SessionLocal()
        try:
            total = db.query(FarmDevice).count()
            available = (
                db.query(FarmDevice)
                .filter(FarmDevice.status == "AVAILABLE")
                .count()
            )
            busy = (
                db.query(FarmDevice)
                .filter(FarmDevice.status == "BUSY")
                .count()
            )
            offline = (
                db.query(FarmDevice)
                .filter(FarmDevice.status == "OFFLINE")
                .count()
            )
            active_sessions = (
                db.query(FarmSession)
                .filter(FarmSession.status == "ACTIVE")
                .count()
            )
            connected_agents = len(self._agent_connections)
            return {
                "status": "UP",
                "devices": {
                    "total": total,
                    "available": available,
                    "busy": busy,
                    "offline": offline,
                },
                "activeSessions": active_sessions,
                "connectedAgents": connected_agents,
                "statusSubscribers": len(self._status_subscribers),
            }
        finally:
            db.close()

    # ── Фоновые задачи ──────────────────────────────────────────────────

    async def _health_check_loop(self) -> None:
        """Каждые 30 секунд помечать устройства с просроченным heartbeat как OFFLINE."""
        while self._running:
            try:
                await asyncio.sleep(30)
                if not self._running:
                    break
                db = SessionLocal()
                try:
                    threshold = datetime.utcnow() - timedelta(seconds=60)
                    stale = (
                        db.query(FarmDevice)
                        .filter(
                            FarmDevice.status.in_(["AVAILABLE", "BUSY"]),
                            FarmDevice.last_seen < threshold,
                        )
                        .all()
                    )
                    for device in stale:
                        old_status = device.status
                        device.status = "OFFLINE"
                        db.commit()
                        db.refresh(device)
                        log.info(
                            "Устройство %s: %s -> OFFLINE (heartbeat просрочен)",
                            device.udid,
                            old_status,
                        )
                        await self._broadcast_device_status(device, db)
                finally:
                    db.close()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("health_check_loop ошибка: %s", e)

    async def _session_expiry_loop(self) -> None:
        """Каждые 10 секунд завершать просроченные сессии."""
        while self._running:
            try:
                await asyncio.sleep(10)
                if not self._running:
                    break
                db = SessionLocal()
                try:
                    now = datetime.utcnow()
                    active = (
                        db.query(FarmSession)
                        .filter(FarmSession.status == "ACTIVE")
                        .all()
                    )
                    for session in active:
                        if not session.started_at:
                            continue
                        timeout = timedelta(minutes=session.timeout_min or 30)
                        if session.started_at + timeout < now:
                            session.status = "TIMED_OUT"
                            session.ended_at = now
                            device = (
                                db.query(FarmDevice)
                                .filter(FarmDevice.udid == session.device_udid)
                                .first()
                            )
                            if device and device.status == "BUSY":
                                device.status = "AVAILABLE"
                                db.commit()
                                db.refresh(device)
                                log.info(
                                    "Сессия %s устройства %s просрочена (таймаут %d мин)",
                                    session.id,
                                    session.device_udid,
                                    session.timeout_min or 30,
                                )
                                await self._broadcast_device_status(device, db)
                            else:
                                db.commit()
                finally:
                    db.close()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("session_expiry_loop ошибка: %s", e)


# ── Синглтон ─────────────────────────────────────────────────────────────────

farm_manager = FarmManager()
