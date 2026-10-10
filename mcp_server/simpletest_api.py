"""
Клиент API SimpleTest для MCP-инструментов.

SimpleTest должен быть запущен (bash start.sh). Вход — учётка SimpleTest из env
MCP-сервера (SIMPLETEST_LOGIN / SIMPLETEST_PASSWORD), токен кешируется и
обновляется сам, когда бэкенд перезапустился и забыл сессии (они в памяти).
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx


class SimpleTestError(Exception):
    pass


class SimpleTestClient:
    def __init__(self, base_url: Optional[str] = None, login: Optional[str] = None,
                 password: Optional[str] = None, timeout: float = 180.0):
        self.base_url = (base_url or os.environ.get("SIMPLETEST_URL", "http://127.0.0.1:8000")).rstrip("/")
        self.login = login or os.environ.get("SIMPLETEST_LOGIN", "")
        self.password = password or os.environ.get("SIMPLETEST_PASSWORD", "")
        self.timeout = timeout
        self._token: Optional[str] = None

    async def _auth(self, client: httpx.AsyncClient) -> str:
        if not self.login or not self.password:
            raise SimpleTestError(
                "Не заданы SIMPLETEST_LOGIN и SIMPLETEST_PASSWORD в env MCP-сервера — "
                "без них инструменты SimpleTest не могут войти.")
        r = await client.post("/api/auth/login", json={"login": self.login, "password": self.password})
        if r.status_code != 200:
            raise SimpleTestError(f"Вход в SimpleTest не удался ({r.status_code}): {r.text[:200]}")
        self._token = r.json().get("token")
        return self._token

    async def request(self, method: str, path: str, **kwargs) -> Any:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                for attempt in (1, 2):
                    token = self._token or await self._auth(client)
                    r = await client.request(method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs)
                    if r.status_code == 401 and attempt == 1:
                        self._token = None      # бэкенд перезапущен — сессии в памяти пропали
                        continue
                    break
        except httpx.ConnectError as e:
            raise SimpleTestError(f"SimpleTest недоступен по {self.base_url} — запущен ли он (bash start.sh)?") from e
        if r.status_code >= 400:
            detail = r.text[:400]
            try:
                d = r.json().get("detail")
                detail = d.get("message") if isinstance(d, dict) else (d or detail)
            except ValueError:
                pass
            raise SimpleTestError(f"SimpleTest {method} {path} → {r.status_code}: {detail}")
        return r.json()
