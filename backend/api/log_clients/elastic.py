"""
Клиент для Elasticsearch / OpenSearch REST API.

Поиск через /_search endpoint с query DSL.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

import requests

from backend.api.log_clients.base import LogSourceClient, LogEntry, LogSearchResult


class ElasticClient(LogSourceClient):
    """
    Работает с Elasticsearch / OpenSearch REST API.
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
        index = self.default_index or "*"
        url = f"{self.base_url}/{index}/_search"

        must: list[dict] = []

        # Диапазон времени
        must.append({
            "range": {
                "@timestamp": {
                    "gte": time_from.isoformat(),
                    "lte": time_to.isoformat(),
                }
            }
        })

        # Уровень
        level_values = self._level_values(level)
        if level_values:
            must.append({
                "bool": {
                    "should": [
                        {"terms": {"level": level_values}},
                        {"terms": {"log.level": level_values}},
                        {"terms": {"severity": level_values}},
                        {"terms": {"loglevel": level_values}},
                    ],
                    "minimum_should_match": 1,
                }
            })

        # Фильтр по сервисам
        if services:
            must.append({
                "bool": {
                    "should": [
                        {"terms": {"service": services}},
                        {"terms": {"service.name": services}},
                        {"terms": {"kubernetes.container_name": services}},
                        {"terms": {"application": services}},
                    ],
                    "minimum_should_match": 1,
                }
            })

        # Текстовый фильтр
        if query.strip():
            must.append({
                "multi_match": {
                    "query": query.strip(),
                    "fields": ["message", "error.message", "error.stack_trace", "log"],
                }
            })

        body = {
            "size": min(limit, 500),
            "sort": [{"@timestamp": {"order": "desc"}}],
            "query": {"bool": {"must": must}},
        }

        resp = requests.post(
            url,
            json=body,
            headers={**self._build_headers(), "Content-Type": "application/json"},
            auth=self._build_auth(),
            verify=self._verify_arg(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        hits = data.get("hits", {})
        total_raw = hits.get("total", 0)
        total = total_raw.get("value", 0) if isinstance(total_raw, dict) else total_raw

        entries = []
        for hit in hits.get("hits", []):
            entries.append(self._parse_hit(hit))

        return LogSearchResult(entries=entries, total=total)

    def get_services(self) -> list[str]:
        """Агрегация по полям service / application."""
        index = self.default_index or "*"
        url = f"{self.base_url}/{index}/_search"

        now = datetime.utcnow()
        body = {
            "size": 0,
            "query": {
                "range": {
                    "@timestamp": {
                        "gte": (now - timedelta(hours=24)).isoformat(),
                        "lte": now.isoformat(),
                    }
                }
            },
            "aggs": {
                "services": {
                    "terms": {"field": "service.keyword", "size": 200}
                },
                "services_alt": {
                    "terms": {"field": "kubernetes.container_name.keyword", "size": 200}
                },
                "services_app": {
                    "terms": {"field": "application.keyword", "size": 200}
                },
            },
        }

        try:
            resp = requests.post(
                url,
                json=body,
                headers={**self._build_headers(), "Content-Type": "application/json"},
                auth=self._build_auth(),
                verify=self._verify_arg(),
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            aggs = data.get("aggregations", {})

            services_set: set[str] = set()
            for agg_name in ("services", "services_alt", "services_app"):
                buckets = aggs.get(agg_name, {}).get("buckets", [])
                for b in buckets:
                    key = b.get("key", "")
                    if key:
                        services_set.add(key)
            return sorted(services_set)
        except Exception:
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
            if resp.status_code == 200:
                data = resp.json()
                name = data.get("name", "unknown")
                version = data.get("version", {}).get("number", "unknown")
                return {"status": "green", "message": f"Elasticsearch {version} ({name}) — подключено"}
            return {"status": "red", "message": f"HTTP {resp.status_code}"}
        except requests.ConnectionError:
            return {"status": "red", "message": "Не удалось подключиться"}
        except requests.Timeout:
            return {"status": "red", "message": "Таймаут подключения (10 сек)"}
        except Exception as e:
            return {"status": "red", "message": str(e)[:200]}

    @staticmethod
    def _level_values(level: str) -> list[str]:
        mapping = {
            "ERROR": ["error", "ERROR", "err", "ERR"],
            "WARN": ["warn", "WARN", "warning", "WARNING"],
            "FATAL": ["fatal", "FATAL", "critical", "CRITICAL", "emergency", "EMERGENCY"],
            "ERROR+WARN": ["error", "ERROR", "err", "ERR", "warn", "WARN", "warning", "WARNING"],
        }
        return mapping.get(level.upper(), ["error", "ERROR"])

    @staticmethod
    def _parse_hit(hit: dict[str, Any]) -> LogEntry:
        """Преобразовать Elasticsearch hit в LogEntry."""
        src = hit.get("_source", {})

        ts_raw = src.get("@timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except Exception:
            ts = datetime.utcnow()

        # Определяем service
        service = (
            src.get("service", {}).get("name")
            or src.get("service")
            or src.get("kubernetes", {}).get("container_name")
            or src.get("application")
            or src.get("host", {}).get("name")
            or "unknown"
        )
        if isinstance(service, dict):
            service = service.get("name", "unknown")

        # Уровень
        level = (
            src.get("level")
            or src.get("log", {}).get("level") if isinstance(src.get("log"), dict) else None
            or src.get("severity")
            or src.get("loglevel")
            or "ERROR"
        )
        if isinstance(level, dict):
            level = "ERROR"
        level = str(level).upper()

        # Сообщение
        message = src.get("message", "")
        if isinstance(message, list):
            message = message[0] if message else ""

        # Стектрейс
        stacktrace = ""
        if src.get("error", {}).get("stack_trace") if isinstance(src.get("error"), dict) else None:
            stacktrace = src["error"]["stack_trace"]
        elif src.get("stacktrace"):
            stacktrace = src["stacktrace"]
        elif src.get("stack_trace"):
            stacktrace = src["stack_trace"]
        elif "\n" in message:
            parts = message.split("\n", 1)
            message = parts[0]
            stacktrace = parts[1]

        # Metadata
        metadata: dict[str, Any] = {}
        for key in ("trace_id", "span_id", "request_id", "correlation_id"):
            if key in src:
                metadata[key] = src[key]
        k8s = src.get("kubernetes", {})
        if isinstance(k8s, dict):
            for key in ("pod_name", "namespace", "container_name", "node_name"):
                if key in k8s:
                    metadata[key] = k8s[key]

        return LogEntry(
            id=hit.get("_id", str(uuid.uuid4())),
            timestamp=ts,
            service=str(service),
            level=level,
            message=str(message)[:500],
            stacktrace=str(stacktrace)[:5000],
            metadata=metadata,
        )
