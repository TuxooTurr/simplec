"""
WebSocket эндпоинты фермы устройств.

/api/farm/ws/devices       --- статусы устройств (JSON -> браузер)
/api/farm/ws/screen/{udid} --- экран устройства (binary PNG <-> JSON-команды)
/api/farm/ws/agent/{udid}  --- подключение агента (binary PNG-кадры -> сервер,
                               JSON-команды <- сервер)
"""

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.farm.manager import farm_manager

router = APIRouter()
log = logging.getLogger("device_farm_ws")


# == /api/farm/ws/devices --- статусы устройств (браузер) ======================


@router.websocket("/api/farm/ws/devices")
async def ws_device_status(ws: WebSocket):
    """
    Браузерный клиент подписывается на обновления статусов устройств.
    Сразу после подключения отправляем текущий список всех устройств.
    """
    await ws.accept()
    farm_manager.subscribe_status(ws)
    try:
        # Отправить начальный список устройств
        devices = await farm_manager.get_devices()
        await ws.send_json({"type": "initial", "devices": devices})

        # Держать соединение открытым, слушаем ping/pong
        while True:
            try:
                # Ждём входящих сообщений (ping от клиента или закрытие)
                await ws.receive_text()
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error("ws_device_status ошибка: %s", e)
    finally:
        farm_manager.unsubscribe_status(ws)
        try:
            await ws.close()
        except Exception:
            pass


# == /api/farm/ws/screen/{udid} --- экран устройства (браузер) =================


@router.websocket("/api/farm/ws/screen/{udid}")
async def ws_screen_stream(ws: WebSocket, udid: str):
    """
    Браузерный клиент просматривает экран устройства в реальном времени.
    - Получает бинарные кадры (PNG) от агента через FarmManager.
    - Может отправлять JSON-команды (tap, swipe, text, key) ---
      они пересылаются агенту.
    """
    await ws.accept()
    farm_manager.subscribe_screen(udid, ws)
    try:
        while True:
            try:
                # Входящие текстовые сообщения --- команды для устройства
                data = await ws.receive_text()
                await farm_manager.handle_screen_command(udid, data)
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error("ws_screen_stream /%s ошибка: %s", udid, e)
    finally:
        farm_manager.unsubscribe_screen(udid, ws)
        try:
            await ws.close()
        except Exception:
            pass


# == /api/farm/ws/agent/{udid} --- подключение агента ==========================


@router.websocket("/api/farm/ws/agent/{udid}")
async def ws_agent_connect(ws: WebSocket, udid: str):
    """
    Агент устройства подключается для:
    - Отправки бинарных кадров экрана (PNG) -> рассылка подписчикам
    - Получения JSON-команд (tap/swipe/text/key) <- от браузерных клиентов
    - Отправки JSON-статусов (обновления устройства)
    """
    await ws.accept()

    # Зарегистрировать агента и устройство
    farm_manager.register_agent_ws(udid, ws)
    await farm_manager.register_device(udid=udid, platform="ANDROID")

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if "bytes" in msg and msg["bytes"]:
                # Бинарные данные --- кадр экрана
                await farm_manager.push_screen_frame(udid, msg["bytes"])

            elif "text" in msg and msg["text"]:
                # Текстовые данные --- JSON-обновление статуса устройства
                try:
                    data = json.loads(msg["text"])
                    msg_type = data.get("type", "")
                    if msg_type == "heartbeat":
                        await farm_manager.heartbeat(
                            udid, data.get("battery")
                        )
                    elif msg_type == "device_info":
                        await farm_manager.register_device(
                            udid=udid,
                            platform=data.get("platform", "ANDROID"),
                            model=data.get("model"),
                            os_version=data.get("osVersion"),
                            agent_host=data.get("agentHost"),
                            appium_port=data.get("appiumPort"),
                        )
                except json.JSONDecodeError:
                    log.warning("Некорректный JSON от агента %s", udid)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error("ws_agent_connect /%s ошибка: %s", udid, e)
    finally:
        farm_manager.unregister_agent_ws(udid)
        try:
            await ws.close()
        except Exception:
            pass
