# Farm Agent — scrcpy-стриминг Android-устройства

Агент подключается к Android-устройству через ADB, запускает scrcpy-server
для захвата экрана в H.264 (60fps) и транслирует видеопоток в SimpleTest
по WebSocket. Принимает команды управления (touch, key, text) и преобразует
их в scrcpy control protocol.

## Архитектура

```
Phone (USB) -> Agent (Python) -> SimpleTest (FastAPI WS) -> Browser
               scrcpy H.264      relay binary frames       WebCodecs decode
```

## Быстрый старт

### 1. Скачать scrcpy-server

Скачайте файл `scrcpy-server` (v2.7+) из
[релизов scrcpy](https://github.com/Genymobile/scrcpy/releases)
и поместите в эту директорию (`mobilefarm/agent/`).

В архиве релиза файл называется `scrcpy-server` (без расширения).

### 2. Установить зависимости

```bash
pip install websockets
```

### 3. Подключить устройство

- Включите USB-отладку на Android-устройстве
- Подключите устройство по USB
- Проверьте: `adb devices` должен показать ваше устройство

### 4. Запустить агент

```bash
# Минимальный запуск
python farm_agent.py --udid <UDID>

# С указанием SimpleTest-сервера
python farm_agent.py --udid <UDID> --hub http://192.168.1.100:8000

# Полный набор параметров
python farm_agent.py \
  --udid ABCD1234 \
  --hub http://localhost:8000 \
  --max-fps 60 \
  --max-size 1280 \
  --bitrate 8000000 \
  --verbose
```

## Параметры CLI

| Параметр      | По умолчанию          | Описание                                    |
|---------------|-----------------------|---------------------------------------------|
| `--udid`      | (обязательный)        | UDID устройства из `adb devices`            |
| `--hub`       | `http://localhost:8000` | URL бэкенда SimpleTest                    |
| `--max-fps`   | `60`                  | Максимальный FPS видео                      |
| `--max-size`  | `1280`                | Макс. размер экрана (по большей стороне)    |
| `--bitrate`   | `8000000`             | Битрейт видео H.264 (бит/с)                |
| `--verbose`   | выключено             | Подробное логирование (DEBUG)               |

## Требования

- Python 3.10+
- `adb` в PATH (Android SDK Platform Tools)
- `scrcpy-server` v2.7+ в директории агента
- `pip install websockets`
- Android-устройство с USB-отладкой
