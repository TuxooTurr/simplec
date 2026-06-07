"""
Generic REST клиент для произвольных API логов.

Отправляет GET-запрос на base_url с query-параметрами,
парсит JSON-ответ по настраиваемым полям.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import requests

from backend.api.log_clients.base import LogSourceClient, LogEntry, LogSearchResult


class GenericRestClient(LogSourceClient):
    """
    Работает с произвольным REST API.
    Ожидает JSON-массив объектов с полями, указанными в параметрах.
    """

    def search(
        self,
        services: list[str],
        level: str,
        time_from: datetime,
        time_to: datetime,
        query: str = "",
        limit: int = 100,
    ) -> LogSearchResult:
        params: dict[str, str] = {
            "from": time_from.isoformat(),
            "to": time_to.isoformat(),
            "level": level.upper(),
            "limit": str(min(limit, 500)),
        }

        if services:
            params["services"] = ",".join(services)
        if query.strip():
            params["query"] = query.strip()

        endpoint = self.default_index.strip("/") if self.default_index else "logs"

        resp = requests.get(
            f"{self.base_url}/{endpoint}",
            params=params,
            headers=self._build_headers(),
            auth=self._build_auth(),
            verify=self._verify_arg(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        # Поддерживаем разные форматы ответа
        if isinstance(data, list):
            items = data
            total = len(data)
        elif isinstance(data, dict):
            items = data.get("items", data.get("logs", data.get("entries", data.get("results", []))))
            total = data.get("total", data.get("count", len(items)))
        else:
            items = []
            total = 0

        entries = [self._parse_item(item) for item in items[:limit]]
        return LogSearchResult(entries=entries, total=total)

    def get_services(self) -> list[str]:
        """Попробовать получить список сервисов через endpoint /services."""
        try:
            resp = requests.get(
                f"{self.base_url}/services",
                headers=self._build_headers(),
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return sorted(str(s) for s in data if s)
                elif isinstance(data, dict):
                    items = data.get("services", data.get("items", []))
                    return sorted(str(s) for s in items if s)
        except Exception:
            pass
        return []

    def test_connection(self) -> dict:
        try:
            resp = requests.get(
                self.base_url,
                headers=self._build_headers(),
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=10,
            )
            if resp.status_code < 400:
                return {"status": "green", "message": f"HTTP {resp.status_code} — доступен"}
            return {"status": "red", "message": f"HTTP {resp.status_code}"}
        except requests.ConnectionError:
            return {"status": "red", "message": "Не удалось подключиться"}
        except requests.Timeout:
            return {"status": "red", "message": "Таймаут подключения (10 сек)"}
        except Exception as e:
            return {"status": "red", "message": str(e)[:200]}

    @staticmethod
    def _parse_item(item: dict[str, Any]) -> LogEntry:
        """Преобразовать произвольный JSON-объект в LogEntry."""
        # Ищем timestamp в различных полях
        ts_raw = (
            item.get("timestamp")
            or item.get("@timestamp")
            or item.get("time")
            or item.get("date")
            or ""
        )
        try:
            if isinstance(ts_raw, (int, float)):
                ts = datetime.fromtimestamp(ts_raw if ts_raw < 1e12 else ts_raw / 1e3)
            else:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except Exception:
            ts = datetime.utcnow()

        service = str(
            item.get("service")
            or item.get("source")
            or item.get("application")
            or item.get("app")
            or item.get("container")
            or "unknown"
        )

        level = str(
            item.get("level")
            or item.get("severity")
            or item.get("log_level")
            or "ERROR"
        ).upper()

        message = str(
            item.get("message")
            or item.get("msg")
            or item.get("text")
            or item.get("log")
            or ""
        )

        stacktrace = str(
            item.get("stacktrace")
            or item.get("stack_trace")
            or item.get("exception")
            or item.get("error_trace")
            or ""
        )

        if not stacktrace and "\n" in message:
            parts = message.split("\n", 1)
            message = parts[0]
            stacktrace = parts[1]

        return LogEntry(
            id=str(item.get("id", uuid.uuid4())),
            timestamp=ts,
            service=service,
            level=level,
            message=message[:500],
            stacktrace=stacktrace[:5000],
            metadata={k: v for k, v in item.items()
                      if k not in ("message", "msg", "text", "log",
                                   "stacktrace", "stack_trace", "exception",
                                   "timestamp", "@timestamp", "time", "date",
                                   "service", "source", "application", "app",
                                   "level", "severity", "log_level", "id")
                      and isinstance(v, (str, int, float, bool))},
        )
