"""Локальный мост Shark → GigaCode CodeChat API.

OpenAI-совместимый HTTP API на 127.0.0.1:8001. Токен берёт из хранилища
GigaCode Desktop (~/.gigacode-desktop/gigacode_token.json) — Desktop сам
его обновляет, мост перечитывает файл перед каждым запросом, поэтому
токен всегда свежий и нигде не сохраняется.

Запуск:  scripts/start-gigacode-bridge.sh   (лог: /tmp/giga-bridge.log)
Модели:  Qwen3.6-35B, DeepSeek-V4.1-Flash-1017, GLM-5.3-Flash,
         Qwen3.8-Flash-Next, GigaChat-3-Ultra (см. /v1/models)
"""
from __future__ import annotations

import hmac
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

API = "https://gigacode.sberbank.ru/api/v2"
TOKEN_FILE = Path(os.getenv("GIGACODE_TOKEN_FILE") or Path.home() / ".gigacode-desktop/gigacode_token.json").expanduser()
PORT = int(os.getenv("GIGACODE_BRIDGE_PORT", "8001"))
API_KEY = os.getenv("GIGACODE_BRIDGE_KEY", "").strip()
TIMEOUT = float(os.getenv("GIGACODE_BRIDGE_TIMEOUT", "300"))
DEFAULT_MODEL = os.getenv("GIGACODE_BRIDGE_MODEL", "Qwen3.6-35B")

app = FastAPI(title="GigaCode bridge")
_cache: dict[str, Any] = {"token": "", "token_at": 0.0, "models": [], "models_at": 0.0}


class Message(BaseModel):
    role: str = "user"
    content: Any = ""


class ChatRequest(BaseModel):
    model: str = ""
    messages: list[Message] = Field(min_length=1)
    max_tokens: int | None = None
    temperature: float | None = None


def _prompt_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return str(content)


def build_prompt(messages: list[Message]) -> str:
    """Модели CodeChat — системный промпт складываем в общий текст (часть шлюзов игнорирует role:system)."""
    parts: list[str] = []
    for m in messages:
        text = _prompt_text(m.content).strip()
        if not text:
            continue
        if m.role == "system":
            parts.append("[Инструкция — соблюдай строго]\n" + text)
        elif m.role == "assistant":
            parts.append("[Предыдущий ответ ассистента]\n" + text)
        else:
            parts.append(text)
    return "\n\n".join(parts)


def _read_token() -> str:
    """Токен Desktop: перечитываем файл (Desktop сам его обновляет)."""
    if _cache["token"] and time.monotonic() - _cache["token_at"] < 30:
        return _cache["token"]
    try:
        data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise HTTPException(503, "Не найден токен GigaCode Desktop "
                                 "Откройте GigaCode Desktop и войдите.") from e
    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        raise HTTPException(503, "Токен GigaCode Desktop пуст — откройте GigaCode Desktop и войдите заново.")
    _cache.update(token=token, token_at=time.monotonic())
    return token


def _auth() -> dict:
    return {"Authorization": f"Bearer {_read_token()}", "Content-Type": "application/json"}


def models_list() -> list[dict]:
    if _cache["models"] and time.monotonic() - _cache["models_at"] < 3600:
        return _cache["models"]
    try:
        cfg = httpx.get(f"{API}/config", headers={"Authorization": f"Bearer {_read_token()}"},
                        timeout=20, verify=True).json()
        items = cfg.get("chat", {}).get("models", []) or []
    except Exception as e:  # config недоступен — отдаём дефолт
        raise HTTPException(502, f"Не получил список моделей GigaCode: {str(e)[:150]}") from e
    out = [{"id": m.get("model"), "description": m.get("description", "")} for m in items if m.get("model")]
    if not out:
        raise HTTPException(502, "GigaCode не вернул список моделей. Откройте GigaCode Desktop и войдите заново.")
    _cache.update(models=out, models_at=time.monotonic())
    return out


@app.get("/health")
def health() -> dict:
    ok = TOKEN_FILE.is_file()
    return {"ok": True, "tokenPresent": ok, "port": PORT}


@app.get("/v1/models")
def models(authorization: str = Header(default="")) -> dict:
    _check(authorization)
    return {"object": "list", "data": models_list()}


@app.post("/v1/chat/completions")
def chat(body: ChatRequest, authorization: str = Header(default="")) -> dict:
    _check(authorization)
    model = body.model or DEFAULT_MODEL
    # Список моделей — вспомогательная проверка: если config флапнул, не мешаем запросу
    # (GigaCode сам ответит, если модели нет, и мы отдадим её список в сообщении об ошибке).
    try:
        known = {m["id"] for m in models_list()}
    except HTTPException:
        known = None
    if known is not None and model not in known:
        raise HTTPException(400, f"Модель {model} недоступна. Доступные: {', '.join(sorted(known))}")
    payload: dict = {"model": model,
                     "messages": [{"role": "user", "content": build_prompt(body.messages)}],
                     "stream": False}
    if body.max_tokens:
        payload["max_tokens"] = body.max_tokens
    if body.temperature is not None:
        payload["temperature"] = body.temperature
    started = time.monotonic()
    try:
        r = httpx.post(f"{API}/chat/completions", headers={**_auth(), "X-Request-ID": str(uuid.uuid4())},
                       json=payload, timeout=TIMEOUT, verify=True)
    except httpx.TimeoutException as e:
        raise HTTPException(504, f"GigaCode не ответил за {TIMEOUT:g} с") from e
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Сеть до GigaCode: {str(e)[:150]}") from e
    if r.status_code == 401:
        _cache.update(token="", token_at=0.0)  # токен умер — перечитаем файл при следующем вызове
        raise HTTPException(502, "Токен GigaCode истёк — откройте GigaCode Desktop, он обновится, повторите запрос.")
    if r.status_code != 200:
        raise HTTPException(502, f"GigaCode вернул HTTP {r.status_code}.")
    try:
        data = r.json()
        text = data["choices"][0]["message"]["content"]
    except Exception as e:
        raise HTTPException(502, "Неожиданный формат ответа GigaCode.") from e
    return {
        "id": data.get("id") or f"gigabridge-{int(time.time())}",
        "object": "chat.completion",
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                     "finish_reason": data.get("choices", [{}])[0].get("finish_reason", "stop")}],
        "usage": data.get("usage", {}),
        "bridge": {"seconds": round(time.monotonic() - started, 1)},
    }


def _check(authorization: str) -> None:
    if not API_KEY or not hmac.compare_digest(authorization.encode(), f"Bearer {API_KEY}".encode()):
        raise HTTPException(401, "Неверный ключ моста (ожидается GIGACODE_BRIDGE_KEY)")


if __name__ == "__main__":
    import uvicorn
    if not API_KEY:
        raise SystemExit("Требуется GIGACODE_BRIDGE_KEY")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
