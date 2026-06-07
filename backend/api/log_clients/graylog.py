"""
Клиент для Graylog REST API.

Документация: https://docs.graylog.org/docs/rest-api
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import requests

from backend.api.log_clients.base import LogSourceClient, LogEntry, LogSearchResult


class GraylogClient(LogSourceClient):
    """
    Работает с Graylog REST API (v2+).
    Поиск через /api/search/universal/absolute.
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
        # Формируем Graylog query
        parts: list[str] = []

        # Уровень
        level_map = {
            "ERROR": "level:3 OR level:ERROR",
            "WARN": "level:4 OR level:WARN OR level:WARNING",
            "FATAL": "level:0 OR level:1 OR level:2 OR level:FATAL OR level:EMERGENCY OR level:ALERT OR level:CRITICAL",
            "ERROR+WARN": "(level:3 OR level:4 OR level:ERROR OR level:WARN OR level:WARNING)",
        }
        level_q = level_map.get(level.upper(), "level:3 OR level:ERROR")
        parts.append(f"({level_q})")

        # Фильтр по сервисам
        if services:
            svc_parts = " OR ".join(f'source:"{s}"' for s in services)
            parts.append(f"({svc_parts})")

        # Текстовый фильтр
        if query.strip():
            parts.append(f'"{query.strip()}"')

        q = " AND ".join(parts) if parts else "*"

        params = {
            "query": q,
            "from": time_from.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "to": time_to.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "limit": min(limit, 500),
            "sort": "timestamp:desc",
            "fields": "timestamp,source,level,message,full_message",
        }

        if self.default_index:
            params["filter"] = f"streams:{self.default_index}"

        resp = requests.get(
            f"{self.base_url}/api/search/universal/absolute",
            params=params,
            headers=self._build_headers(),
            auth=self._build_auth(),
            verify=self._verify_arg(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        entries = []
        for msg in data.get("messages", []):
            m = msg.get("message", {})
            entries.append(self._parse_message(m))

        return LogSearchResult(
            entries=entries,
            total=data.get("total_results", len(entries)),
        )

    def get_services(self) -> list[str]:
        """
        Получить список source (микросервисов) из Graylog.
        Используем поиск по последним 24 часам с группировкой.
        """
        try:
            # Пробуем через terms-агрегацию
            from datetime import timedelta
            now = datetime.utcnow()
            params = {
                "query": "*",
                "from": (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                "to": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                "field": "source",
            }
            resp = requests.get(
                f"{self.base_url}/api/search/universal/absolute/terms",
                params=params,
                headers=self._build_headers(),
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                terms = data.get("terms", {})
                return sorted(terms.keys())
        except Exception:
            pass

        # Fallback: поиск последних 50 записей и извлечение уникальных source
        try:
            from datetime import timedelta
            now = datetime.utcnow()
            result = self.search(
                services=[],
                level="ERROR+WARN",
                time_from=now - timedelta(hours=24),
                time_to=now,
                limit=200,
            )
            sources = sorted({e.service for e in result.entries if e.service})
            return sources
        except Exception:
            return []

    def test_connection(self) -> dict:
        try:
            resp = requests.get(
                f"{self.base_url}/api/system",
                headers=self._build_headers(),
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                version = data.get("version", "unknown")
                return {"status": "green", "message": f"Graylog {version} — подключено"}
            return {"status": "red", "message": f"HTTP {resp.status_code}"}
        except requests.ConnectionError:
            return {"status": "red", "message": "Не удалось подключиться"}
        except requests.Timeout:
            return {"status": "red", "message": "Таймаут подключения (10 сек)"}
        except Exception as e:
            return {"status": "red", "message": str(e)[:200]}

    @staticmethod
    def _parse_message(m: dict[str, Any]) -> LogEntry:
        """Преобразовать Graylog message в LogEntry."""
        ts_raw = m.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except Exception:
            ts = datetime.utcnow()

        # Graylog level: 0=EMERGENCY..3=ERROR..4=WARNING..6=INFO..7=DEBUG
        level_num = m.get("level")
        if isinstance(level_num, int):
            if level_num <= 2:
                level = "FATAL"
            elif level_num == 3:
                level = "ERROR"
            elif level_num == 4:
                level = "WARN"
            else:
                level = "INFO"
        else:
            level = str(level_num or "ERROR").upper()

        message = m.get("message", "")
        full_message = m.get("full_message", "")

        # Стектрейс: full_message или часть message после первого \n
        stacktrace = ""
        if full_message and full_message != message:
            stacktrace = full_message
        elif "\n" in message:
            parts = message.split("\n", 1)
            message = parts[0]
            stacktrace = parts[1]

        metadata = {}
        for key in ("facility", "source_ip", "gl2_source_node", "container_name",
                     "pod_name", "namespace", "trace_id", "span_id"):
            if key in m:
                metadata[key] = m[key]

        return LogEntry(
            id=m.get("_id", str(uuid.uuid4())),
            timestamp=ts,
            service=m.get("source", "unknown"),
            level=level,
            message=message[:500],
            stacktrace=stacktrace[:5000],
            metadata=metadata,
        )
