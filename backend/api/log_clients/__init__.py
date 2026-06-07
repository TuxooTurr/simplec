"""
Клиенты для платформ агрегации логов.

Поддерживаемые платформы:
  - Graylog  (REST API)
  - Elasticsearch / OpenSearch
  - Grafana Loki
  - Generic REST (произвольный endpoint)
"""

from backend.api.log_clients.base import LogSourceClient, LogEntry
from backend.api.log_clients.graylog import GraylogClient
from backend.api.log_clients.elastic import ElasticClient
from backend.api.log_clients.loki import LokiClient
from backend.api.log_clients.generic import GenericRestClient

_REGISTRY: dict[str, type[LogSourceClient]] = {
    "graylog": GraylogClient,
    "elastic": ElasticClient,
    "loki":    LokiClient,
    "generic": GenericRestClient,
}


def get_client(vps_type: str, **kwargs) -> LogSourceClient:
    """Фабрика клиентов по типу VPS."""
    cls = _REGISTRY.get(vps_type)
    if cls is None:
        raise ValueError(f"Неизвестный тип VPS: {vps_type}. Доступные: {list(_REGISTRY.keys())}")
    return cls(**kwargs)


__all__ = [
    "LogSourceClient", "LogEntry",
    "GraylogClient", "ElasticClient", "LokiClient", "GenericRestClient",
    "get_client",
]
