"""
Мок-режим Shark (`SHARK_MOCK=1`): приложение работает без корпоративной сети.

Что делает `install()`:
  • перехватывает исходящие HTTP-запросы (`requests` и `httpx`) — в сеть не уходит ничего; Jira, Confluence,
    Bitbucket, Allure TestOps и Jenkins отвечают заготовками (backend/mock/*.py), остальное — 501 с понятным текстом;
  • подменяет LLM-клиент: подключения GigaChat «готовы», ответ — заготовка;
  • в мок-базе заполняет пустые маркеры доступа заглушками, чтобы экраны не просили войти.

Данные мок-режима — в `data_mock/` и `data_mock/shark_mock.db` (db/paths.py), настоящие не трогаются.
Новые экраны: если в логе «Мок: нет заготовки …» — добавьте ответ в нужный модуль.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from backend.mock import confluence, devtools, jira
from backend.mock.common import Reply

logger = logging.getLogger("shark.mock")

# Задержка ответа заглушки, с: как у настоящей сети — видно состояния загрузки. SHARK_MOCK_DELAY=0 — без задержки.
try:
    DELAY = max(0.0, float(os.getenv("SHARK_MOCK_DELAY", "0.4")))
except ValueError:
    DELAY = 0.4

# Чем отличаем сервис: по пути запроса — адреса у пользователя могут быть свои.
_CONFLUENCE_PATHS = ("/rest/api/content", "/rest/api/space", "/rest/api/user/current")


def route(method: str, url: str, params: dict, body: Any) -> Reply:
    parts = urlsplit(url)
    path = parts.path
    q = {**dict(parse_qsl(parts.query)), **{k: v for k, v in (params or {}).items() if v is not None}}
    host = parts.hostname or ""
    try:
        reply = None
        if path.startswith(_CONFLUENCE_PATHS) or (path == "/rest/pat/latest/tokens" and "confluence" in host):
            reply = confluence.handle(method, path, q, body)
        elif path.startswith("/rest/api/1.0/") or "/plugins/servlet/applinks/" in path or "/rest/access-tokens/" in path:
            reply = devtools.bitbucket(method, path, q, body)
        elif "/api/rs/" in path or path.endswith("/api/uaa/oauth/token"):
            reply = devtools.testops(method, path, q, body)
        elif "/job/" in path or "/queue/item/" in path:
            reply = devtools.jenkins(method, path, q, body)
        elif path.startswith("/rest/"):
            reply = jira.handle(method, path, q, body)
    except Exception as e:                                       # ошибка в заготовке не должна ронять запрос молча
        logger.exception("Мок: сбой заготовки %s %s", method, url)
        return Reply(500, {"message": f"Мок: сбой заготовки — {e}", "errorMessages": [f"Мок: сбой заготовки — {e}"]})
    if reply is None:
        logger.warning("Мок: нет заготовки для %s %s", method, url)
        text = f"Мок: нет заготовки для {method} {path}"
        return Reply(501, {"message": text, "errorMessages": [text]})
    logger.info("Мок ← %s %s -> %s", method, path, reply.status)
    if DELAY:
        time.sleep(DELAY)
    return reply


def _encode(reply: Reply) -> tuple[bytes, str]:
    b = reply.body
    if b is None:
        return b"", reply.content_type or "application/json"
    if isinstance(b, bytes):
        return b, reply.content_type or "application/octet-stream"
    if isinstance(b, str):
        return b.encode("utf-8"), reply.content_type or "text/plain; charset=utf-8"
    return json.dumps(b, ensure_ascii=False).encode("utf-8"), reply.content_type or "application/json;charset=UTF-8"


def _body_of(raw: Any, ctype: str) -> Any:
    if not raw:
        return None
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if "json" in (ctype or "") or (isinstance(raw, str) and raw[:1] in "{["):
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            pass
    if isinstance(raw, str) and "=" in raw:
        return dict(parse_qsl(raw))
    return None


def _patch_requests() -> None:
    import io

    import requests
    from requests.adapters import HTTPAdapter
    from requests.structures import CaseInsensitiveDict

    def send(self, request, **kwargs):
        reply = route(request.method or "GET", request.url, {}, _body_of(request.body, request.headers.get("Content-Type", "")))
        content, ctype = _encode(reply)
        r = requests.Response()
        r.status_code = reply.status
        r.reason = "OK" if reply.status < 400 else "Mock"
        r.url = request.url
        r.request = request
        r.headers = CaseInsensitiveDict({"Content-Type": ctype, **reply.headers})
        r._content = content
        r._content_consumed = True
        r.raw = io.BytesIO(content)
        r.encoding = "utf-8"
        return r

    HTTPAdapter.send = send


def _patch_httpx() -> None:
    try:
        import httpx
    except ImportError:
        return

    def make(request: "httpx.Request") -> "httpx.Response":
        try:
            raw = request.read()
        except Exception:
            raw = b""
        reply = route(request.method, str(request.url), {}, _body_of(raw, request.headers.get("content-type", "")))
        content, ctype = _encode(reply)
        return httpx.Response(reply.status, headers={"Content-Type": ctype, **reply.headers}, content=content)

    # Подменяем сетевой транспорт, а не клиента: внутренние транспорты (TestClient, ASGI) работают как обычно.
    def handle(self, request):
        return make(request)

    async def ahandle(self, request):
        return make(request)

    httpx.HTTPTransport.handle_request = handle
    httpx.AsyncHTTPTransport.handle_async_request = ahandle


# Маркеры-заглушки: без них экраны просят войти, а запрос всё равно ушёл бы в мок.
_SEED = {
    "jira_token": "mock-token",
    "confluence_token": "mock-token",
    "aqa_bitbucket_token": "mock-token",
    "aqa_testops_token": "mock-token",
    "aqa_jenkins_user": "mock_user",
    "aqa_jenkins_token": "mock-token",
}


def seed_settings() -> None:
    """Пустые маркеры в мок-базе → заглушки. Заполненные не трогаем: их могли поменять руками в настройках."""
    from db.metrics_models import MetricsSettings
    from db.postgres import SessionLocal
    db = SessionLocal()
    try:
        for key, value in _SEED.items():
            row = db.query(MetricsSettings).filter(MetricsSettings.key == key).first()
            if row is None:
                db.add(MetricsSettings(key=key, value=value, description="Мок-режим"))
            elif not row.value:
                row.value = value
        db.commit()
    except Exception:
        logger.exception("Мок: не удалось заполнить настройки-заглушки")
        db.rollback()
    finally:
        db.close()


def install() -> None:
    from backend.mock import llm
    _patch_requests()
    _patch_httpx()
    llm.install()
    logger.warning("SHARK_MOCK=1 — мок-режим: внешние сервисы и LLM — заготовки, данные в data_mock/")
