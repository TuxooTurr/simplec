"""
Абстрактный клиент для платформ агрегации логов.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class LogEntry:
    """Единая модель записи лога, не зависит от платформы."""
    id: str
    timestamp: datetime
    service: str
    level: str                          # ERROR / WARN / FATAL / INFO
    message: str                        # первая строка / summary
    stacktrace: str = ""                # полный стектрейс (если есть)
    metadata: dict[str, Any] = field(default_factory=dict)  # pod, node, trace_id и пр.

    @property
    def fingerprint(self) -> str:
        """
        Fingerprint для группировки одинаковых ошибок.
        Берём первые 3 строки стектрейса + service + level.
        """
        st_lines = self.stacktrace.strip().splitlines()[:3] if self.stacktrace else []
        raw = f"{self.service}|{self.level}|{'|'.join(st_lines)}"
        return hashlib.md5(raw.encode()).hexdigest()[:12]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "service": self.service,
            "level": self.level,
            "message": self.message,
            "stacktrace": self.stacktrace,
            "metadata": self.metadata,
            "fingerprint": self.fingerprint,
        }


@dataclass
class LogSearchResult:
    """Результат поиска логов."""
    entries: list[LogEntry]
    total: int = 0

    def to_dict(self) -> dict:
        return {
            "entries": [e.to_dict() for e in self.entries],
            "total": self.total,
        }


class LogSourceClient(ABC):
    """
    Абстрактный клиент для работы с платформой агрегации логов.
    Все реализации (Graylog, Elastic, Loki, Generic) наследуют этот класс.
    """

    def __init__(
        self,
        base_url: str,
        auth_type: str = "none",
        token: str = "",
        username: str = "",
        password: str = "",
        api_key_header: str = "Authorization",
        ssl_verify: bool = True,
        ca_cert_path: str = "",
        default_index: str = "",
        **kwargs,
    ):
        self.base_url = base_url.rstrip("/")
        self.auth_type = auth_type
        self.token = token
        self.username = username
        self.password = password
        self.api_key_header = api_key_header
        self.ssl_verify = ssl_verify
        self.ca_cert_path = ca_cert_path or None
        self.default_index = default_index

    def _build_headers(self) -> dict[str, str]:
        """Собрать заголовки авторизации."""
        headers: dict[str, str] = {"Accept": "application/json"}
        if self.auth_type == "bearer" and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        elif self.auth_type == "api_key" and self.token:
            headers[self.api_key_header] = self.token
        return headers

    def _build_auth(self):
        """HTTP Basic Auth tuple или None."""
        if self.auth_type == "basic" and self.username:
            return (self.username, self.password)
        return None

    def _verify_arg(self):
        """SSL verify аргумент для requests."""
        if self.ca_cert_path:
            return self.ca_cert_path
        return self.ssl_verify

    @abstractmethod
    def search(
        self,
        services: list[str],
        level: str,
        time_from: datetime,
        time_to: datetime,
        query: str = "",
        limit: int = 100,
    ) -> LogSearchResult:
        """Поиск логов по фильтрам."""
        ...

    @abstractmethod
    def get_services(self) -> list[str]:
        """Получить список доступных микросервисов / source."""
        ...

    @abstractmethod
    def test_connection(self) -> dict:
        """Тест подключения. Возвращает {status: 'green'|'red', message: str}."""
        ...
