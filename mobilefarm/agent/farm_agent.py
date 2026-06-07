#!/usr/bin/env python3
"""
Farm Agent — стриминг экрана Android-устройства через scrcpy + управление.

Подключается к SimpleTest по WebSocket, транслирует H.264 видео с устройства
на 60fps и обрабатывает touch/key/text команды.

Использование:
  python farm_agent.py --udid <DEVICE_UDID> --hub http://localhost:8000

Требования:
  - adb в PATH
  - scrcpy-server в mobilefarm/agent/ (скачать из releases scrcpy)
  - pip install websockets
"""

import argparse
import asyncio
import json
import logging
import os
import platform
import signal
import struct
import sys
from pathlib import Path
from typing import Optional

try:
    import websockets
    import websockets.exceptions
    # websockets >= 13.0 использует новый asyncio API
    try:
        from websockets.asyncio.client import connect as ws_connect
    except ImportError:
        # websockets < 13.0 — совместимый fallback
        from websockets import connect as ws_connect
except ImportError:
    print(
        "Ошибка: библиотека websockets не установлена.\n"
        "Установите: pip install websockets"
    )
    sys.exit(1)

# ── Константы ────────────────────────────────────────────────────────────────

AGENT_DIR = Path(__file__).parent
SCRCPY_SERVER_LOCAL = AGENT_DIR / "scrcpy-server"
SCRCPY_SERVER_REMOTE = "/data/local/tmp/scrcpy-server.jar"
SCRCPY_VERSION = "2.7"

HEARTBEAT_INTERVAL = 15  # секунды
WS_RECONNECT_DELAY = 3  # секунды между попытками переподключения
WS_RECONNECT_MAX_DELAY = 30  # максимальная задержка между попытками

# Типы сообщений scrcpy control
INJECT_KEYCODE = 0x00
INJECT_TEXT = 0x01
INJECT_TOUCH = 0x02

# Действия touch
ACTION_DOWN = 0x00
ACTION_UP = 0x01
ACTION_MOVE = 0x02

# Маска PTS для config-пакетов (SPS/PPS)
PTS_CONFIG_FLAG = 1 << 63

log = logging.getLogger("farm_agent")


# ── ADB утилиты (async) ─────────────────────────────────────────────────────


async def adb_run(
    udid: str, *args: str, timeout: float = 10.0
) -> tuple[int, str, str]:
    """Выполнить adb-команду асинхронно. Возвращает (returncode, stdout, stderr)."""
    cmd = ["adb", "-s", udid] + list(args)
    log.debug("ADB: %s", " ".join(cmd))
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
        return (
            proc.returncode or 0,
            stdout.decode("utf-8", errors="replace").strip(),
            stderr.decode("utf-8", errors="replace").strip(),
        )
    except asyncio.TimeoutError:
        log.warning("ADB команда превысила таймаут: %s", " ".join(cmd))
        try:
            proc.kill()
        except Exception:
            pass
        return -1, "", "timeout"
    except FileNotFoundError:
        log.error("adb не найден в PATH. Установите Android SDK Platform Tools.")
        return -1, "", "adb not found"


async def get_device_prop(udid: str, prop: str) -> str:
    """Получить системное свойство устройства через adb shell getprop."""
    rc, out, _ = await adb_run(udid, "shell", "getprop", prop)
    return out.strip().replace("\r", "") if rc == 0 else ""


async def get_device_info(udid: str) -> dict:
    """Собрать информацию об устройстве: модель, версия ОС."""
    model, os_version = await asyncio.gather(
        get_device_prop(udid, "ro.product.model"),
        get_device_prop(udid, "ro.build.version.release"),
    )
    return {
        "model": model or "Unknown",
        "osVersion": os_version or "Unknown",
    }


async def get_battery_level(udid: str) -> Optional[int]:
    """Получить уровень заряда батареи через dumpsys battery."""
    rc, out, _ = await adb_run(udid, "shell", "dumpsys", "battery")
    if rc != 0:
        return None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("level:"):
            try:
                return int(line.split(":")[1].strip())
            except (ValueError, IndexError):
                pass
    return None


async def check_device_connected(udid: str) -> bool:
    """Проверить, подключено ли устройство через ADB."""
    rc, out, _ = await adb_run(udid, "get-state")
    return rc == 0 and "device" in out


async def list_devices() -> str:
    """Получить вывод adb devices для диагностики."""
    proc = await asyncio.create_subprocess_exec(
        "adb", "devices", "-l",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    return stdout.decode("utf-8", errors="replace").strip()


# ── scrcpy менеджер ──────────────────────────────────────────────────────────


class ScrcpyManager:
    """
    Управляет жизненным циклом scrcpy-server на устройстве:
    push jar, запуск процесса, подключение video/control сокетов,
    чтение H.264 потока, отправка управляющих команд.
    """

    def __init__(
        self,
        udid: str,
        max_size: int = 1280,
        max_fps: int = 60,
        bitrate: int = 8_000_000,
    ) -> None:
        self.udid = udid
        self.max_size = max_size
        self.max_fps = max_fps
        self.bitrate = bitrate

        # Размеры экрана (заполняются после handshake)
        self.screen_width: int = 0
        self.screen_height: int = 0
        self.device_name: str = ""

        # Порт ADB forward (динамический)
        self._forward_port: Optional[int] = None

        # Процесс scrcpy-server на устройстве
        self._server_proc: Optional[asyncio.subprocess.Process] = None

        # TCP сокеты (asyncio)
        self._video_reader: Optional[asyncio.StreamReader] = None
        self._video_writer: Optional[asyncio.StreamWriter] = None
        self._control_reader: Optional[asyncio.StreamReader] = None
        self._control_writer: Optional[asyncio.StreamWriter] = None

        self._running = False

    async def start(self) -> None:
        """Запустить scrcpy-server и подключить video/control сокеты."""
        if not SCRCPY_SERVER_LOCAL.exists():
            log.error(
                "scrcpy-server не найден: %s\n"
                "Скачайте из https://github.com/Genymobile/scrcpy/releases\n"
                "и поместите файл scrcpy-server (без расширения) в %s",
                SCRCPY_SERVER_LOCAL,
                AGENT_DIR,
            )
            raise FileNotFoundError(
                f"scrcpy-server не найден: {SCRCPY_SERVER_LOCAL}"
            )

        # 1. Загрузить scrcpy-server на устройство
        log.info("Загрузка scrcpy-server на устройство %s ...", self.udid)
        rc, _, err = await adb_run(
            self.udid, "push",
            str(SCRCPY_SERVER_LOCAL), SCRCPY_SERVER_REMOTE,
            timeout=30.0,
        )
        if rc != 0:
            raise RuntimeError(f"Не удалось загрузить scrcpy-server: {err}")

        # 2. Найти свободный порт и установить ADB forward
        self._forward_port = await self._find_free_port()
        log.info("ADB forward: tcp:%d -> localabstract:scrcpy", self._forward_port)
        rc, _, err = await adb_run(
            self.udid, "forward",
            f"tcp:{self._forward_port}", "localabstract:scrcpy",
        )
        if rc != 0:
            raise RuntimeError(f"Не удалось установить ADB forward: {err}")

        # 3. Запустить scrcpy-server на устройстве
        log.info(
            "Запуск scrcpy-server: max_size=%d, fps=%d, bitrate=%d",
            self.max_size, self.max_fps, self.bitrate,
        )
        server_cmd = [
            "adb", "-s", self.udid, "shell",
            f"CLASSPATH={SCRCPY_SERVER_REMOTE}",
            "app_process", "/", "com.genymobile.scrcpy.Server", SCRCPY_VERSION,
            "tunnel_forward=true",
            "video=true",
            "audio=false",
            "control=true",
            f"max_size={self.max_size}",
            f"max_fps={self.max_fps}",
            f"video_bit_rate={self.bitrate}",
            "video_codec=h264",
            "send_frame_meta=true",
        ]
        self._server_proc = await asyncio.create_subprocess_exec(
            *server_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # Небольшая пауза для старта сервера на устройстве
        await asyncio.sleep(1.0)

        # Проверить, что процесс не упал сразу
        if self._server_proc.returncode is not None:
            stderr = ""
            if self._server_proc.stderr:
                raw = await self._server_proc.stderr.read()
                stderr = raw.decode("utf-8", errors="replace")
            raise RuntimeError(
                f"scrcpy-server завершился с кодом {self._server_proc.returncode}: {stderr}"
            )

        # 4. Подключить video socket (первое соединение)
        log.info("Подключение video socket на порт %d ...", self._forward_port)
        self._video_reader, self._video_writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", self._forward_port),
            timeout=10.0,
        )
        await self._video_handshake()

        # 5. Подключить control socket (второе соединение)
        log.info("Подключение control socket ...")
        self._control_reader, self._control_writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", self._forward_port),
            timeout=10.0,
        )
        await self._control_handshake()

        self._running = True
        log.info(
            "scrcpy готов: %s, %dx%d",
            self.device_name, self.screen_width, self.screen_height,
        )

    async def _video_handshake(self) -> None:
        """Прочитать handshake video socket: dummy + device_name + codec + width + height."""
        assert self._video_reader is not None

        # 1 байт dummy
        dummy = await self._video_reader.readexactly(1)
        if dummy != b"\x00":
            log.warning("Неожиданный dummy байт video: 0x%02x", dummy[0])

        # 64 байта device name (null-padded UTF-8)
        name_bytes = await self._video_reader.readexactly(64)
        self.device_name = name_bytes.split(b"\x00", 1)[0].decode("utf-8", errors="replace")

        # 4 байта codec ID (big-endian uint32)
        codec_bytes = await self._video_reader.readexactly(4)
        codec_id = struct.unpack(">I", codec_bytes)[0]
        if codec_id != 0x68323634:  # "h264"
            log.warning(
                "Неожиданный codec ID: 0x%08x (ожидалось 0x68323634 / h264)",
                codec_id,
            )

        # 4 байта width + 4 байта height (big-endian uint32)
        dim_bytes = await self._video_reader.readexactly(8)
        self.screen_width, self.screen_height = struct.unpack(">II", dim_bytes)

    async def _control_handshake(self) -> None:
        """Прочитать handshake control socket: 1 байт dummy."""
        assert self._control_reader is not None
        dummy = await self._control_reader.readexactly(1)
        if dummy != b"\x00":
            log.warning("Неожиданный dummy байт control: 0x%02x", dummy[0])

    async def read_video_packet(self) -> Optional[bytes]:
        """
        Прочитать один H.264 пакет из video socket.

        Формат (send_frame_meta=true):
          - 8 байт PTS (big-endian uint64, бит 63 = config packet)
          - 4 байта длина пакета (big-endian uint32)
          - N байт H.264 данные

        Возвращает сырые H.264 данные или None при отключении.
        """
        if not self._video_reader or not self._running:
            return None

        try:
            # PTS (8 байт) + длина (4 байта)
            header = await self._video_reader.readexactly(12)
            pts_raw = struct.unpack(">Q", header[:8])[0]
            pkt_len = struct.unpack(">I", header[8:12])[0]

            if pkt_len == 0:
                return b""

            if pkt_len > 5 * 1024 * 1024:  # Защита: макс 5 МБ на пакет
                log.warning("Подозрительно большой пакет: %d байт, пропуск", pkt_len)
                # Пропустить данные
                remaining = pkt_len
                while remaining > 0:
                    chunk_size = min(remaining, 65536)
                    await self._video_reader.readexactly(chunk_size)
                    remaining -= chunk_size
                return b""

            data = await self._video_reader.readexactly(pkt_len)
            return data

        except (asyncio.IncompleteReadError, ConnectionError, OSError) as exc:
            log.warning("Видео поток прерван: %s", exc)
            self._running = False
            return None

    def build_touch_event(
        self,
        action: int,
        x: int,
        y: int,
        screen_w: int,
        screen_h: int,
    ) -> bytes:
        """
        Собрать бинарное сообщение touch event для scrcpy control socket.

        Формат (32 байта):
          type(1) + action(1) + pointerId(8) + x(4) + y(4) +
          screenWidth(2) + screenHeight(2) + pressure(2) +
          actionButton(4) + buttons(4) = 32 байта
        """
        pointer_id = 0xFFFFFFFFFFFFFFFF  # -1 (мышь)
        pressure = 0xFFFF if action != ACTION_UP else 0x0000
        action_button = 1  # PRIMARY
        buttons = 1 if action == ACTION_DOWN else 0

        return struct.pack(
            ">BB q ii HH H ii",
            INJECT_TOUCH,    # type: 1 байт
            action,          # action: 1 байт
            pointer_id,      # pointerId: 8 байт (signed int64, -1)
            x,               # x: 4 байта (signed int32)
            y,               # y: 4 байта (signed int32)
            screen_w,        # screenWidth: 2 байта (uint16)
            screen_h,        # screenHeight: 2 байта (uint16)
            pressure,        # pressure: 2 байта (uint16)
            action_button,   # actionButton: 4 байта (signed int32)
            buttons,         # buttons: 4 байта (signed int32)
        )

    def build_keycode_event(self, action: int, keycode: int) -> bytes:
        """
        Собрать бинарное сообщение keycode event для scrcpy control socket.

        Формат (14 байт):
          type(1) + action(1) + keycode(4) + repeat(4) + metaState(4) = 14 байт
        """
        return struct.pack(
            ">BB ii i",
            INJECT_KEYCODE,  # type: 1 байт
            action,          # action: 1 байт
            keycode,         # keycode: 4 байта (signed int32)
            0,               # repeat: 4 байта (signed int32)
            0,               # metaState: 4 байта (signed int32)
        )

    def build_text_event(self, text: str) -> bytes:
        """
        Собрать бинарное сообщение inject text для scrcpy control socket.

        Формат:
          type(1) + length(4) + text(N) = 5+N байт
        """
        encoded = text.encode("utf-8")
        return struct.pack(">B I", INJECT_TEXT, len(encoded)) + encoded

    async def send_control(self, data: bytes) -> None:
        """Отправить управляющее сообщение в control socket."""
        if not self._control_writer or not self._running:
            log.warning("Control socket не подключён, команда отброшена")
            return
        try:
            self._control_writer.write(data)
            await self._control_writer.drain()
        except (ConnectionError, OSError) as exc:
            log.warning("Ошибка записи в control socket: %s", exc)
            self._running = False

    async def stop(self) -> None:
        """Остановить scrcpy-server и освободить ресурсы."""
        self._running = False

        # Закрыть сокеты
        for writer in (self._video_writer, self._control_writer):
            if writer:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass
        self._video_reader = None
        self._video_writer = None
        self._control_reader = None
        self._control_writer = None

        # Остановить процесс scrcpy-server
        if self._server_proc and self._server_proc.returncode is None:
            log.info("Остановка scrcpy-server ...")
            try:
                self._server_proc.terminate()
                await asyncio.wait_for(self._server_proc.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                log.warning("scrcpy-server не завершился, принудительный kill")
                self._server_proc.kill()
                await self._server_proc.wait()
            except Exception as exc:
                log.warning("Ошибка при остановке scrcpy-server: %s", exc)
        self._server_proc = None

        # Удалить ADB forward
        if self._forward_port:
            await adb_run(
                self.udid, "forward", "--remove", f"tcp:{self._forward_port}"
            )
            log.info("ADB forward tcp:%d удалён", self._forward_port)
            self._forward_port = None

    @property
    def is_running(self) -> bool:
        return self._running

    @staticmethod
    async def _find_free_port() -> int:
        """Найти свободный TCP порт на хосте."""
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        return port


# ── Основной агент ───────────────────────────────────────────────────────────


class FarmAgent:
    """
    Агент фермы: связывает scrcpy-стриминг с WebSocket к SimpleTest.

    Жизненный цикл:
    1. Проверяет подключение устройства
    2. Запускает scrcpy
    3. Подключается к SimpleTest по WS
    4. Отправляет device_info, video_start
    5. Параллельно: стримит видео + принимает команды + шлёт heartbeat
    6. При обрыве WS — переподключается
    7. При обрыве устройства — полный перезапуск
    """

    def __init__(
        self,
        udid: str,
        hub_url: str = "http://localhost:8000",
        max_fps: int = 60,
        max_size: int = 1280,
        bitrate: int = 8_000_000,
    ) -> None:
        self.udid = udid
        self.hub_url = hub_url
        self.max_fps = max_fps
        self.max_size = max_size
        self.bitrate = bitrate

        self._scrcpy: Optional[ScrcpyManager] = None
        self._ws: Optional[websockets.ClientConnection] = None
        self._running = False
        self._shutdown_event = asyncio.Event()

    async def run(self) -> None:
        """Главный цикл агента с автопереподключением."""
        self._running = True

        # Проверить устройство
        if not await check_device_connected(self.udid):
            devices_output = await list_devices()
            log.error(
                "Устройство %s не найдено.\n"
                "Подключённые устройства:\n%s",
                self.udid,
                devices_output,
            )
            return

        # Получить информацию об устройстве
        dev_info = await get_device_info(self.udid)
        log.info(
            "Устройство: %s — %s (Android %s)",
            self.udid, dev_info["model"], dev_info["osVersion"],
        )

        while self._running:
            try:
                await self._session(dev_info)
            except asyncio.CancelledError:
                log.info("Агент остановлен (cancelled)")
                break
            except Exception as exc:
                log.error("Ошибка сессии: %s", exc, exc_info=True)

            if not self._running:
                break

            # Задержка перед переподключением
            log.info(
                "Переподключение через %d сек ...", WS_RECONNECT_DELAY
            )
            try:
                await asyncio.wait_for(
                    self._shutdown_event.wait(), timeout=WS_RECONNECT_DELAY
                )
                # shutdown_event сработал — выходим
                break
            except asyncio.TimeoutError:
                pass  # Таймаут — продолжаем переподключение

        await self._cleanup()
        log.info("Агент завершил работу")

    async def _session(self, dev_info: dict) -> None:
        """Одна сессия: scrcpy + WS подключение + стриминг."""

        # 1. Проверить устройство
        if not await check_device_connected(self.udid):
            log.error("Устройство %s отключено", self.udid)
            await asyncio.sleep(WS_RECONNECT_DELAY)
            return

        # 2. Запустить scrcpy
        self._scrcpy = ScrcpyManager(
            self.udid,
            max_size=self.max_size,
            max_fps=self.max_fps,
            bitrate=self.bitrate,
        )
        try:
            await self._scrcpy.start()
        except Exception as exc:
            log.error("Не удалось запустить scrcpy: %s", exc)
            await self._cleanup_scrcpy()
            raise

        # 3. Подключиться к SimpleTest по WS
        ws_url = self._build_ws_url()
        log.info("Подключение к SimpleTest: %s", ws_url)

        try:
            self._ws = await ws_connect(
                ws_url,
                max_size=10 * 1024 * 1024,  # 10 МБ макс. размер сообщения
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
            )
        except Exception as exc:
            log.error("Не удалось подключиться к SimpleTest: %s", exc)
            await self._cleanup_scrcpy()
            raise

        log.info("WebSocket подключён к SimpleTest")

        # 4. Отправить device_info
        await self._ws.send(json.dumps({
            "type": "device_info",
            "platform": "ANDROID",
            "model": dev_info["model"],
            "osVersion": dev_info["osVersion"],
            "agentHost": platform.node(),
        }))

        # 5. Отправить video_start
        await self._ws.send(json.dumps({
            "type": "video_start",
            "codec": "h264",
            "width": self._scrcpy.screen_width,
            "height": self._scrcpy.screen_height,
            "fps": self.max_fps,
        }))

        # 6. Запустить параллельные задачи
        tasks = [
            asyncio.create_task(self._stream_video(), name="video"),
            asyncio.create_task(self._receive_commands(), name="commands"),
            asyncio.create_task(self._heartbeat_loop(dev_info), name="heartbeat"),
        ]

        try:
            # Ждём завершения любой задачи (= ошибка или отключение)
            done, pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            # Проверить, были ли ошибки
            for task in done:
                exc = task.exception()
                if exc:
                    log.error("Задача %s завершилась с ошибкой: %s", task.get_name(), exc)
        finally:
            # Отменить оставшиеся задачи
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        # Очистка
        await self._cleanup_ws()
        await self._cleanup_scrcpy()

    async def _stream_video(self) -> None:
        """Читать H.264 пакеты из scrcpy и отправлять по WS."""
        assert self._scrcpy is not None
        assert self._ws is not None

        frames_sent = 0
        while self._scrcpy.is_running and self._running:
            packet = await self._scrcpy.read_video_packet()
            if packet is None:
                log.info("Видео поток завершён")
                return
            if len(packet) == 0:
                continue

            try:
                await self._ws.send(packet)
                frames_sent += 1
                if frames_sent % 300 == 0:  # Лог каждые ~5 секунд при 60fps
                    log.debug("Отправлено %d видео пакетов", frames_sent)
            except websockets.exceptions.ConnectionClosed:
                log.info("WS соединение закрыто во время стриминга")
                return
            except Exception as exc:
                log.error("Ошибка отправки видео пакета: %s", exc)
                return

    async def _receive_commands(self) -> None:
        """Принимать JSON-команды от SimpleTest и транслировать в scrcpy."""
        assert self._scrcpy is not None
        assert self._ws is not None

        while self._running:
            try:
                raw = await self._ws.recv()
            except websockets.exceptions.ConnectionClosed:
                log.info("WS соединение закрыто (приём команд)")
                return
            except Exception as exc:
                log.error("Ошибка приёма WS-сообщения: %s", exc)
                return

            # Ожидаем только текстовые JSON-сообщения
            if isinstance(raw, bytes):
                continue

            try:
                cmd = json.loads(raw)
            except json.JSONDecodeError:
                log.warning("Некорректный JSON от SimpleTest: %s", raw[:200])
                continue

            cmd_type = cmd.get("type", "")
            try:
                if cmd_type == "touch":
                    await self._handle_touch(cmd)
                elif cmd_type == "key":
                    await self._handle_key(cmd)
                elif cmd_type == "text":
                    await self._handle_text(cmd)
                else:
                    log.debug("Неизвестный тип команды: %s", cmd_type)
            except Exception as exc:
                log.error("Ошибка обработки команды %s: %s", cmd_type, exc)

    async def _handle_touch(self, cmd: dict) -> None:
        """Обработать touch-команду (нормализованные координаты 0-1 -> пиксели)."""
        assert self._scrcpy is not None

        action_map = {"down": ACTION_DOWN, "up": ACTION_UP, "move": ACTION_MOVE}
        action_str = cmd.get("action", "")
        action = action_map.get(action_str)
        if action is None:
            log.warning("Неизвестное touch action: %s", action_str)
            return

        # Нормализованные координаты (0.0 - 1.0) -> пиксельные
        norm_x = float(cmd.get("x", 0))
        norm_y = float(cmd.get("y", 0))
        px_x = int(norm_x * self._scrcpy.screen_width)
        px_y = int(norm_y * self._scrcpy.screen_height)

        # Ограничить координаты границами экрана
        px_x = max(0, min(px_x, self._scrcpy.screen_width - 1))
        px_y = max(0, min(px_y, self._scrcpy.screen_height - 1))

        msg = self._scrcpy.build_touch_event(
            action, px_x, px_y,
            self._scrcpy.screen_width, self._scrcpy.screen_height,
        )
        await self._scrcpy.send_control(msg)

    async def _handle_key(self, cmd: dict) -> None:
        """Обработать key-команду (Android keycode)."""
        assert self._scrcpy is not None

        keycode = int(cmd.get("keycode", 0))
        action_str = cmd.get("action", "down_and_up")

        if action_str == "down_and_up":
            # Отправить DOWN, затем UP
            msg_down = self._scrcpy.build_keycode_event(ACTION_DOWN, keycode)
            msg_up = self._scrcpy.build_keycode_event(ACTION_UP, keycode)
            await self._scrcpy.send_control(msg_down)
            await self._scrcpy.send_control(msg_up)
        elif action_str == "down":
            msg = self._scrcpy.build_keycode_event(ACTION_DOWN, keycode)
            await self._scrcpy.send_control(msg)
        elif action_str == "up":
            msg = self._scrcpy.build_keycode_event(ACTION_UP, keycode)
            await self._scrcpy.send_control(msg)
        else:
            log.warning("Неизвестное key action: %s", action_str)

    async def _handle_text(self, cmd: dict) -> None:
        """Обработать text-команду (ввод текста)."""
        assert self._scrcpy is not None

        text = cmd.get("value", "")
        if not text:
            return

        msg = self._scrcpy.build_text_event(text)
        await self._scrcpy.send_control(msg)

    async def _heartbeat_loop(self, dev_info: dict) -> None:
        """Периодически отправлять heartbeat с уровнем батареи."""
        assert self._ws is not None

        while self._running:
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
            except asyncio.CancelledError:
                return

            if not self._running:
                return

            battery = await get_battery_level(self.udid)

            try:
                await self._ws.send(json.dumps({
                    "type": "heartbeat",
                    "battery": battery,
                }))
                log.debug("Heartbeat отправлен (battery=%s)", battery)
            except websockets.exceptions.ConnectionClosed:
                log.info("WS закрыт во время heartbeat")
                return
            except Exception as exc:
                log.error("Ошибка отправки heartbeat: %s", exc)
                return

    def _build_ws_url(self) -> str:
        """Построить WebSocket URL для подключения к SimpleTest."""
        base = self.hub_url.rstrip("/")
        # http -> ws, https -> wss
        if base.startswith("https://"):
            ws_base = "wss://" + base[len("https://"):]
        elif base.startswith("http://"):
            ws_base = "ws://" + base[len("http://"):]
        else:
            ws_base = "ws://" + base
        return f"{ws_base}/api/farm/ws/agent/{self.udid}"

    async def _cleanup_ws(self) -> None:
        """Закрыть WebSocket соединение."""
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def _cleanup_scrcpy(self) -> None:
        """Остановить scrcpy."""
        if self._scrcpy:
            await self._scrcpy.stop()
            self._scrcpy = None

    async def _cleanup(self) -> None:
        """Полная очистка ресурсов."""
        await self._cleanup_ws()
        await self._cleanup_scrcpy()

    def shutdown(self) -> None:
        """Инициировать graceful shutdown."""
        log.info("Получен сигнал завершения")
        self._running = False
        self._shutdown_event.set()


# ── CLI ──────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Farm Agent — стриминг Android-устройства через scrcpy",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--udid",
        required=True,
        help="UDID устройства (из adb devices)",
    )
    parser.add_argument(
        "--hub",
        default="http://localhost:8000",
        help="URL SimpleTest (бэкенд)",
    )
    parser.add_argument(
        "--max-fps",
        type=int,
        default=60,
        help="Максимальный FPS видео",
    )
    parser.add_argument(
        "--max-size",
        type=int,
        default=1280,
        help="Максимальный размер экрана (по большей стороне, px)",
    )
    parser.add_argument(
        "--bitrate",
        type=int,
        default=8_000_000,
        help="Битрейт видео (бит/с)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Подробный вывод (DEBUG)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Настройка логирования
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    agent = FarmAgent(
        udid=args.udid,
        hub_url=args.hub,
        max_fps=args.max_fps,
        max_size=args.max_size,
        bitrate=args.bitrate,
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Обработка сигналов завершения
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, agent.shutdown)

    try:
        loop.run_until_complete(agent.run())
    except KeyboardInterrupt:
        log.info("Прервано пользователем (Ctrl+C)")
        agent.shutdown()
        loop.run_until_complete(agent._cleanup())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
