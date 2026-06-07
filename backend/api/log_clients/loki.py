"""
Клиент для Grafana Loki HTTP API.

Документация: https://grafana.com/docs/loki/latest/reference/loki-http-api/
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

import requests

from backend.api.log_clients.base import LogSourceClient, LogEntry, LogSearchResult


class LokiClient(LogSourceClient):
    """
    Работает с Grafana Loki HTTP API.
    Поиск через /loki/api/v1/query_range.
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
        # Формируем LogQL
        label_parts: list[str] = []

        # Фильтр по сервисам
        if services:
            if len(services) == 1:
                label_parts.append(f'job="{services[0]}"')
            else:
                label_parts.append(f'job=~"{"| ".join(services)}"')

        # Namespace / index
        if self.default_index:
            label_parts.append(f'namespace="{self.default_index}"')

        label_selector = ", ".join(label_parts) if label_parts else 'job=~".+"'

        # Уровень
        level_filter = self._level_filter(level)

        # Текстовый фильтр
        text_filter = f' |= "{query.strip()}"' if query.strip() else ""

        logql = f'{{{label_selector}}}{level_filter}{text_filter}'

        params = {
            "query": logql,
            "start": str(int(time_from.timestamp() * 1e9)),
            "end": str(int(time_to.timestamp() * 1e9)),
            "limit": min(limit, 500),
            "direction": "backward",
        }

        resp = requests.get(
            f"{self.base_url}/loki/api/v1/query_range",
            params=params,
            headers=self._build_headers(),
            auth=self._build_auth(),
            verify=self._verify_arg(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        entries: list[LogEntry] = []
        results = data.get("data", {}).get("result", [])

        for stream in results:
            labels = stream.get("stream", {})
            service = (
                labels.get("job")
                or labels.get("app")
                or labels.get("container")
                or labels.get("service_name")
                or "unknown"
            )
            for val in stream.get("values", []):
                ts_ns, line = val[0], val[1]
                entries.append(self._parse_line(ts_ns, line, service, labels))

        # Сортировка по времени (desc)
        entries.sort(key=lambda e: e.timestamp, reverse=True)
        entries = entries[:limit]

        return LogSearchResult(entries=entries, total=len(entries))

    def get_services(self) -> list[str]:
        """Получить список значений label 'job' за последние 24 часа."""
        services: set[str] = set()

        for label_name in ("job", "app", "container", "service_name"):
            try:
                resp = requests.get(
                    f"{self.base_url}/loki/api/v1/label/{label_name}/values",
                    headers=self._build_headers(),
                    auth=self._build_auth(),
                    verify=self._verify_arg(),
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    values = data.get("data", [])
                    services.update(v for v in values if v)
            except Exception:
                continue

        return sorted(services)

    def test_connection(self) -> dict:
        try:
            # Проверяем доступность через /ready или /loki/api/v1/labels
            resp = requests.get(
                f"{self.base_url}/ready",
                headers=self._build_headers(),
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=10,
            )
            if resp.status_code == 200:
                return {"status": "green", "message": "Loki — подключено (ready)"}

            # Fallback
            resp2 = requests.get(
                f"{self.base_url}/loki/api/v1/labels",
                headers=self._build_headers(),
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=10,
            )
            if resp2.status_code == 200:
                data = resp2.json()
                label_count = len(data.get("data", []))
                return {"status": "green", "message": f"Loki — подключено ({label_count} labels)"}

            return {"status": "red", "message": f"HTTP {resp.status_code}"}
        except requests.ConnectionError:
            return {"status": "red", "message": "Не удалось подключиться"}
        except requests.Timeout:
            return {"status": "red", "message": "Таймаут подключения (10 сек)"}
        except Exception as e:
            return {"status": "red", "message": str(e)[:200]}

    @staticmethod
    def _level_filter(level: str) -> str:
        mapping = {
            "ERROR": ' |~ "(?i)(error|err|exception)"',
            "WARN": ' |~ "(?i)(warn|warning)"',
            "FATAL": ' |~ "(?i)(fatal|critical|emergency|panic)"',
            "ERROR+WARN": ' |~ "(?i)(error|err|exception|warn|warning)"',
        }
        return mapping.get(level.upper(), ' |~ "(?i)(error|err|exception)"')

    @staticmethod
    def _parse_line(ts_ns: str, line: str, service: str, labels: dict) -> LogEntry:
        """Преобразовать строку Loki в LogEntry."""
        try:
            ts = datetime.fromtimestamp(int(ts_ns) / 1e9)
        except Exception:
            ts = datetime.utcnow()

        # Пробуем определить уровень из строки
        line_upper = line[:200].upper()
        if "FATAL" in line_upper or "CRITICAL" in line_upper or "PANIC" in line_upper:
            level = "FATAL"
        elif "ERROR" in line_upper or "EXCEPTION" in line_upper:
            level = "ERROR"
        elif "WARN" in line_upper:
            level = "WARN"
        else:
            level = "ERROR"

        # Разделяем message и stacktrace
        message = line
        stacktrace = ""
        if "\n" in line:
            parts = line.split("\n", 1)
            message = parts[0]
            stacktrace = parts[1]

        level_from_label = labels.get("level", "").upper()
        if level_from_label in ("ERROR", "WARN", "FATAL", "CRITICAL", "WARNING"):
            level = level_from_label
            if level == "WARNING":
                level = "WARN"
            elif level == "CRITICAL":
                level = "FATAL"

        metadata: dict = {}
        for key in ("namespace", "pod", "node_name", "instance", "trace_id"):
            if key in labels:
                metadata[key] = labels[key]

        return LogEntry(
            id=str(uuid.uuid4()),
            timestamp=ts,
            service=service,
            level=level,
            message=message[:500],
            stacktrace=stacktrace[:5000],
            metadata=metadata,
        )
