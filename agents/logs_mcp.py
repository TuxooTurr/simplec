"""Read-only adapters for log search over MCP."""
from __future__ import annotations

import json
import os
import re
import ssl
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from urllib.parse import urlsplit

import anyio
from mcp.shared.exceptions import MCPError
from mcp.types import REQUEST_TIMEOUT
from pydantic import BaseModel, Field, StringConstraints

from db import pvs_credentials
from db.paths import MOCK
from mcp_server.log_triage import ERROR_LEVELS, LogEvent, parse_lines
from webconnect.secrets import SecretError

UTC = timezone.utc
DEMO_SERVICES = ("payments-api", "ledger-service", "notifications-api")
DEFAULT_ARGS = {"service": "service", "start": "start", "end": "end", "limit": "limit",
                "errors_only": "errorsOnly", "trace_id": "traceId", "namespace": "namespace"}
MAX_MESSAGE = 6000
MAX_STACK = 32
PVS_TOOL = "SearchIndexTool"
PVS_REQUIRED_FIELDS = {"namespace", "service", "timestamp", "level"}
PVS_OPTIONAL_FIELDS = {"message", "traceId", "requestId", "stack"}
PVS_MAX_ROWS = 100
PVS_ENV = ("OPENSEARCH_URL", "OPENSEARCH_USERNAME", "OPENSEARCH_PASSWORD", "OPENSEARCH_SSL_VERIFY",
           "OPENSEARCH_CA_CERT_PATH", "OPENSEARCH_CLIENT_CERT_PATH", "OPENSEARCH_CLIENT_KEY_PATH",
           "OPENSEARCH_TIMEOUT", "OPENSEARCH_QUERY_TIMEOUT")
LOG_ERROR_LEVELS = ERROR_LEVELS | {"PANIC", "ALERT", "EMERGENCY"}
_BEARER = re.compile(r"(?i)\b(Bearer\s+)[\w.~/+=-]+")
_SECRET = re.compile(r'''(?i)(["']?\b(?:password|passwd|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)''')


class LogSourceError(Exception):
    """A message safe to display without exposing the remote response or credentials."""


class LogSourceTimeout(LogSourceError):
    """The log source exceeded the deadline for one call."""


def _request_timeout() -> int:
    try:
        return max(5, min(600, int(os.getenv("LOGS_MCP_REQUEST_TIMEOUT", "120"))))
    except ValueError:
        return 120


def redact(text: str) -> str:
    return _SECRET.sub(r"\1[скрыто]", _BEARER.sub(r"\1[скрыто]", text))


class Record(BaseModel):
    service: str = Field(min_length=1, max_length=200)
    namespace: str = Field(default="", max_length=200)
    timestamp: str = Field(default="", max_length=70)
    level: str = Field(default="INFO", max_length=32)
    message: str = Field(max_length=MAX_MESSAGE)
    stack: list[Annotated[str, StringConstraints(max_length=1000)]] = Field(default_factory=list, max_length=MAX_STACK)
    traceId: str = Field(default="", max_length=150)
    requestId: str = Field(default="", max_length=150)
    error: bool = False
    fieldValue: str | None = Field(default=None, max_length=1000)


def configured() -> bool:
    mode = os.getenv("LOGS_MCP_TRANSPORT", "http").strip().lower()
    address = {"http": "LOGS_MCP_URL", "stdio": "LOGS_MCP_COMMAND"}.get(mode)
    return MOCK or bool(address and os.getenv(address, "").strip() and _tool_name())


def _is_pvs() -> bool:
    return os.getenv("LOGS_MCP_PROFILE", "").strip().lower() == "pvs"


def _tool_name() -> str:
    return os.getenv("LOGS_MCP_TOOL", "").strip() or (PVS_TOOL if _is_pvs() else "")


def configured_namespace() -> str:
    return os.getenv("LOGS_MCP_NAMESPACE", "").strip()


def local_pvs_configured() -> bool:
    return (os.getenv("LOGS_MCP_TRANSPORT", "").strip().lower() == "stdio" and _is_pvs()
            and all(os.getenv(name, "").strip() for name in (
                "LOGS_MCP_COMMAND", "OPENSEARCH_URL", "LOGS_PVS_INDEX", "LOGS_PVS_FIELDS", "LOGS_MCP_NAMESPACE",
            )))


def _args() -> dict[str, str]:
    try:
        custom = json.loads(os.getenv("LOGS_MCP_ARGS") or "{}")
        if not isinstance(custom, dict) or any(k not in DEFAULT_ARGS or not isinstance(v, str) for k, v in custom.items()):
            raise ValueError
    except ValueError as exc:
        raise LogSourceError("Некорректная карта аргументов LOGS_MCP_ARGS на сервере Shark.") from exc
    mapped = {**DEFAULT_ARGS, **custom}
    names = [v for v in mapped.values() if v]
    if len(set(names)) != len(names) or not all(mapped[k] for k in ("service", "start", "end")):
        raise LogSourceError("Аргументы MCP должны иметь разные имена, включая сервис, начало и конец периода.")
    return mapped


def _decode(result: Any, *, pvs: bool = False) -> Any:
    if result.is_error:
        if any(re.search(r"timed?\s*out|timeout", block.text[:500], re.I) for block in result.content if block.type == "text"):
            raise LogSourceTimeout("Источник логов не завершил поиск вовремя. Сузьте период или выберите один микросервис.")
        raise LogSourceError("Инструмент MCP отклонил запрос логов. Проверьте доступ и параметры инструмента.")
    if result.structured_content is not None:
        return result.structured_content
    text = "\n".join(block.text for block in result.content if block.type == "text")
    if not text:
        raise LogSourceError("Инструмент MCP вернул результат без текста и записей.")
    if pvs and text.startswith("Search results from "):
        part = text.partition("\n")[2]
        if part:
            text = part
    try:
        return json.loads(text)
    except ValueError:
        return text


async def _call_search(client: Any, tool: Any, args: dict, *, pvs: bool = False) -> Any:
    timeout = _request_timeout()
    try:
        with anyio.fail_after(timeout):
            return _decode(await client.call_tool(tool.name, args), pvs=pvs)
    except LogSourceError:
        raise
    except Exception as exc:
        if isinstance(exc, TimeoutError) or (isinstance(exc, MCPError) and exc.code == REQUEST_TIMEOUT):
            raise LogSourceTimeout(f"MCP не ответил на поиск за {timeout:g} с. Сузьте период или выберите один микросервис.") from exc
        raise LogSourceError("Не удалось получить логи от MCP. Проверьте подключение и доступ к инструменту.") from exc


class McpLogSource:
    def __init__(self, client: Any, tool: Any, names: dict[str, str]):
        self.client = client
        self.tool = tool
        self.names = names

    @property
    def supports_trace(self) -> bool:
        return bool(self.names["trace_id"] and self.names["trace_id"] in (self.tool.input_schema.get("properties") or {}))

    async def search(self, *, service: str | None, start: datetime, end: datetime, limit: int,
                     errors_only: bool = False, trace_id: str = "", namespace: str | None = None) -> Any:
        schema = self.tool.input_schema
        props = schema.get("properties") or {}
        required = set(schema.get("required") or [])
        namespace = (configured_namespace() if namespace is None else namespace) or None
        if props and any(self.names[k] not in props for k in ("start", "end")):
            raise LogSourceError("Инструмент MCP не принимает настроенные аргументы периода. Проверьте LOGS_MCP_ARGS.")
        if props and service and self.names["service"] not in props:
            raise LogSourceError("Инструмент MCP не принимает настроенный аргумент сервиса. Проверьте LOGS_MCP_ARGS.")
        if namespace and (not self.names["namespace"] or (props and self.names["namespace"] not in props)):
            raise LogSourceError("Инструмент MCP не принимает настроенный аргумент namespace. Проверьте LOGS_MCP_ARGS.")
        if service is None and self.names["service"] in required:
            raise LogSourceError("Этот инструмент MCP требует конкретный сервис. Для поиска по всем нужен инструмент, принимающий общий запрос.")
        values = {"service": service, "namespace": namespace, "start": start.isoformat(), "end": end.isoformat(), "limit": limit,
                  "errors_only": errors_only, "trace_id": trace_id or None}
        args = {name: values[k] for k, name in self.names.items()
                if name and values[k] is not None and (name in props or (not props and k in ("service", "namespace", "start", "end", "limit")))}
        if required - args.keys():
            raise LogSourceError("У инструмента MCP есть обязательные аргументы, которые Shark пока не передаёт.")
        return await _call_search(self.client, self.tool, args)


class PvsLogSource:
    """Search a configured PVS index using SearchIndexTool and OpenSearch DSL."""

    def __init__(self, client: Any, tool: Any):
        self.client = client
        self.tool = tool
        self.index = os.getenv("LOGS_PVS_INDEX", "").strip()
        self.namespace = configured_namespace()
        if not self.index or self.index in ("*", "_all") or not self.namespace:
            raise LogSourceError("Для PVS укажите индекс логов LOGS_PVS_INDEX и LOGS_MCP_NAMESPACE.")
        try:
            fields = json.loads(os.getenv("LOGS_PVS_FIELDS") or "{}")
        except ValueError as exc:
            raise LogSourceError("LOGS_PVS_FIELDS должен содержать JSON-карту полей PVS.") from exc
        if (not isinstance(fields, dict) or not PVS_REQUIRED_FIELDS <= fields.keys()
                or fields.keys() - PVS_REQUIRED_FIELDS - PVS_OPTIONAL_FIELDS
                or not all(isinstance(f, str) and f.strip() for f in fields.values())):
            raise LogSourceError("Укажите поля namespace, service, timestamp и level из маппинга PVS в LOGS_PVS_FIELDS.")
        self.fields = fields
        props = tool.input_schema.get("properties") or {}
        if not {"index", "query_dsl", "size"} <= props.keys():
            raise LogSourceError("Инструмент PVS должен принимать index, query_dsl и size. Сверьте tools/list.")
        self.format_supported = "format" in props
        self.dsl_as_string = props["query_dsl"].get("type") == "string"

    @property
    def supports_trace(self) -> bool:
        return "traceId" in self.fields

    async def search(self, *, service: str | None, start: datetime, end: datetime, limit: int,
                     errors_only: bool = False, trace_id: str = "", namespace: str | None = None) -> dict:
        if namespace and namespace != self.namespace:
            raise LogSourceError("Запрос PVS выходит за пределы namespace, настроенного в Shark.")
        fields = self.fields
        size = min(limit, PVS_MAX_ROWS)
        filters = [
            {"term": {fields["namespace"]: self.namespace}},
            {"range": {fields["timestamp"]: {"gte": start.isoformat(), "lte": end.isoformat(),
                                             "format": "strict_date_optional_time||epoch_millis"}}},
        ]
        if service:
            filters.append({"term": {fields["service"]: service}})
        if errors_only:
            levels = sorted({variant for level in LOG_ERROR_LEVELS for variant in (level, level.lower(), level.title())})
            filters.append({"terms": {fields["level"]: levels}})
        if trace_id and self.supports_trace:
            filters.append({"term": {fields["traceId"]: trace_id}})
        dsl = {"query": {"bool": {"filter": filters}}, "sort": [{fields["timestamp"]: "desc"}],
               "track_total_hits": size + 1}
        args = {"index": self.index, "query_dsl": json.dumps(dsl) if self.dsl_as_string else dsl, "size": size}
        if self.format_supported:
            args["format"] = "json"
        payload = await _call_search(self.client, self.tool, args, pvs=True)
        hits = _field(payload, "hits.hits")
        if not isinstance(hits, list):
            raise LogSourceError("PVS не вернул выдачу OpenSearch. Проверьте индекс, права чтения и маппинг полей.")
        for hit in hits:
            raw = _field(hit, "_source")
            if isinstance(raw, dict):
                values = {}
                for key, path in fields.items():
                    value = _field(raw, path)
                    if value is None:
                        value = _field(raw, path.removesuffix(".keyword"))
                    if value is not None:
                        values[key] = value
                hit["_source"] = {**raw, **values}
        incomplete = payload.get("timed_out") or payload.get("terminated_early") or _field(payload, "_shards.failed")
        return {**payload, "truncated": bool(incomplete) or len(hits) >= size}


class DemoLogSource:
    supports_trace = True

    async def search(self, *, service: str | None, start: datetime, end: datetime, limit: int,
                     errors_only: bool = False, trace_id: str = "", namespace: str | None = None) -> dict:
        stamp = max(start, end - timedelta(minutes=2))
        rows = [
            {"service": "payments-api", "timestamp": stamp.isoformat(), "level": "ERROR", "traceId": "demo-payment-42",
             "message": "Не удалось подтвердить оплату: ledger-service вернул HTTP 503",
             "stack": ["UpstreamUnavailable: ledger-service", "  at PaymentConfirmation.confirm(PaymentConfirmation.java:42)"]},
            {"service": "ledger-service", "timestamp": stamp.isoformat(), "level": "ERROR", "traceId": "demo-payment-42",
             "message": "Не удалось записать операцию: исчерпан пул соединений с базой данных"},
            {"service": "notifications-api", "timestamp": max(start, stamp - timedelta(seconds=10)).isoformat(),
             "level": "ERROR", "traceId": "demo-push-17", "message": "Не удалось отправить push: таймаут шлюза уведомлений"},
            {"service": "notifications-api", "timestamp": stamp.isoformat(), "level": "INFO",
             "message": "Подписка на очередь уведомлений активна"},
            {"service": "payments-api", "timestamp": max(start, stamp - timedelta(seconds=1)).isoformat(), "level": "INFO",
             "message": "Запрос на подтверждение оплаты получен", "traceId": "demo-payment-42"},
        ]
        scope = namespace if namespace is not None else configured_namespace()
        rows = [{**r, "namespace": scope} for r in rows if (not service or r["service"] == service) and
                (not trace_id or r.get("traceId") == trace_id) and (not errors_only or r["level"] == "ERROR")]
        return {"records": rows[:limit], "truncated": len(rows) > limit}


def _string_list(setting: str) -> list[str]:
    try:
        items = json.loads(os.getenv(setting) or "[]")
        if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
            raise ValueError
        return items
    except ValueError as exc:
        raise LogSourceError(f"Настройка {setting} должна быть JSON-массивом строк.") from exc


async def _transport(stack: AsyncExitStack):
    if os.getenv("LOGS_MCP_TRANSPORT", "http").strip().lower() == "stdio":
        from mcp.client.stdio import StdioServerParameters

        env_names = _string_list("LOGS_MCP_STDIO_ENV")
        env = {name: os.environ[name] for name in (*env_names, *(PVS_ENV if _is_pvs() else ())) if name in os.environ}
        if _is_pvs():
            try:
                env.update(pvs_credentials.environment())
            except (OSError, SecretError, ValueError) as exc:
                raise LogSourceError("Учётная запись PVS недоступна. Сохраните пароль заново в «Настройки → Подключения → PVS MCP».") from exc
            env.setdefault("OPENSEARCH_TIMEOUT", str(_request_timeout()))
        return StdioServerParameters(command=os.environ["LOGS_MCP_COMMAND"].strip(), args=_string_list("LOGS_MCP_STDIO_ARGS"), env=env)

    import httpx2
    from mcp.client.streamable_http import streamable_http_client

    url = os.environ["LOGS_MCP_URL"].strip()
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.fragment:
            raise ValueError
    except ValueError as exc:
        raise LogSourceError("Адрес MCP должен быть HTTP(S) URL без встроенного логина или пароля.") from exc
    token = os.getenv("LOGS_MCP_TOKEN", "").strip()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    cert = os.getenv("LOGS_MCP_CA_FILE", "").strip()
    tls = ssl.create_default_context(cafile=cert) if cert else True
    client = await stack.enter_async_context(httpx2.AsyncClient(headers=headers, verify=tls, timeout=_request_timeout() + 5, follow_redirects=False))
    return streamable_http_client(url, http_client=client, max_sse_event_size=8 * 1024 * 1024)


@asynccontextmanager
async def open_source():
    if MOCK:
        yield DemoLogSource()
        return
    if not configured():
        raise LogSourceError("Источник логов MCP ещё не настроен на сервере Shark.")
    pvs = _is_pvs()
    names = _args() if not pvs else {}
    from mcp import Client

    timeout = _request_timeout()
    stack = AsyncExitStack()
    try:
        try:
            client = await stack.enter_async_context(Client(await _transport(stack), read_timeout_seconds=timeout))
            expected = _tool_name()
            cursor = None
            tool = None
            with anyio.fail_after(timeout):
                for _ in range(10):
                    page = await client.list_tools(cursor=cursor)
                    tool = next((t for t in page.tools if t.name == expected), None)
                    cursor = page.next_cursor
                    if tool or not cursor:
                        break
        except LogSourceError:
            raise
        except Exception as exc:
            if isinstance(exc, TimeoutError) or (isinstance(exc, MCPError) and exc.code == REQUEST_TIMEOUT):
                raise LogSourceTimeout(f"MCP не ответил при подключении или чтении списка инструментов за {timeout:g} с.") from exc
            raise LogSourceError("Не удалось подключиться к MCP или получить список инструментов. Проверьте адрес и доступ.") from exc
        if not tool:
            raise LogSourceError("Настроенный инструмент поиска логов отсутствует в списке MCP.")
        if tool.annotations and tool.annotations.read_only_hint is False:
            raise LogSourceError("Инструмент поиска логов объявлен как изменяющий данные. Нужен инструмент чтения.")
        yield PvsLogSource(client, tool) if pvs else McpLogSource(client, tool, names)
    finally:
        # Close the transport normally so its task groups do not wrap a caller's log error.
        await stack.aclose()


def _field(obj: Any, key: str) -> Any:
    if not isinstance(obj, dict):
        return None
    if key in obj:
        return obj[key]
    first, dot, rest = key.partition(".")
    return _field(obj.get(first), rest) if dot else None


def _string(obj: dict, *keys: str) -> str:
    for key in keys:
        value = _field(obj, key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value)
    return ""


def as_time(value: str) -> datetime | None:
    if not value:
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def _clean_record(raw: dict, service: str | None, namespace: str, field: str) -> Record | None:
    if isinstance(raw.get("_source"), dict):
        raw = raw["_source"]
    text = _string(raw, "message", "msg", "text", "body", "@m")
    error_value = raw.get("error")
    if not text and isinstance(error_value, str):
        text = error_value
    if not text:
        return None
    stack = raw.get("stack") or raw.get("stackTrace") or raw.get("stack_trace") or []
    if isinstance(stack, str):
        stack = stack.splitlines()
    stack = [redact(x)[:1000] for x in stack[:MAX_STACK] if isinstance(x, str)] if isinstance(stack, list) else []
    level = (_string(raw, "level", "severity", "severityText", "log.level", "@l") or "INFO").upper()[:32]
    timestamp = _string(raw, "timestamp", "@timestamp", "time", "ts", "@t")
    name = _string(raw, "service", "service.name", "serviceName", "microservice", "application", "kubernetes.container_name") or service or "Не указан"
    scope = _string(raw, "namespace", "kubernetes.namespace_name", "kubernetes.namespace", "k8s.namespace.name") or namespace
    trace = _string(raw, "traceId", "trace_id", "trace.id", "correlationId", "mdc.traceId")
    request = _string(raw, "requestId", "request_id", "request.id", "mdc.requestId")
    if not trace:
        found = re.search(r"\b(?:trace[_ .-]?id|correlation[_ .-]?id)\s*[:=]\s*['\"]?([A-Za-z0-9._-]+)", text, re.I)
        trace = found.group(1) if found else ""
    if not request:
        found = re.search(r"\brequest[_ .-]?id\s*[:=]\s*['\"]?([A-Za-z0-9._-]+)", text, re.I)
        request = found.group(1) if found else ""
    msg = redact(text)[:MAX_MESSAGE]
    code = _string(raw, "statusCode", "status_code", "http.status_code")
    value = _field(raw, field) if field else None
    value = redact(f"{field}={value}").partition("=")[2][:1000] if isinstance(value, (str, int, float)) else None
    return Record(service=name[:200], namespace=scope[:200], timestamp=timestamp[:70], level=level,
                  message=msg, stack=stack, traceId=trace[:150], requestId=request[:150], fieldValue=value,
                  error=error_value is True or level in LOG_ERROR_LEVELS
                  or bool(re.fullmatch(r"5\d\d", code)) or LogEvent(None, None, level, msg, stack).is_error)


def normalize(payload: Any, service: str | None, limit: int, *, namespace: str = "", field: str = "") -> tuple[list[Record], bool]:
    """Supported results: record object/list, common envelopes, or raw log text."""
    truncated = False
    if isinstance(payload, dict):
        truncated = any(payload.get(k) is True for k in ("truncated", "hasMore", "has_more")) or bool(payload.get("nextCursor"))
        hits = _field(payload, "hits.hits")
        if isinstance(hits, list):
            total = _field(payload, "hits.total.value") or _field(payload, "hits.total")
            truncated = truncated or (isinstance(total, int) and total > len(hits))
            payload = hits
        else:
            payload = next((payload[k] for k in ("records", "logs", "entries", "items", "results") if k in payload), payload)
    if isinstance(payload, str):
        truncated = truncated or len(payload) > 2_000_000
        events = parse_lines((None, line) for line in payload[:2_000_000].splitlines())
        payload = [{"timestamp": e.ts, "level": e.level, "message": e.message, "stack": e.stack, "error": e.is_error} for e in events]
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        raise LogSourceError("Формат ответа MCP не распознан. Нужен список событий или текст логов.")
    truncated = truncated or len(payload) >= limit
    records = []
    for raw in payload[:limit]:
        if isinstance(raw, str):
            parsed = parse_lines([(None, raw)])
            if parsed:
                ev = parsed[0]
                raw = {"timestamp": ev.ts, "level": ev.level, "message": ev.message, "stack": ev.stack, "error": ev.is_error}
        if isinstance(raw, dict) and (record := _clean_record(raw, service, namespace, field)):
            records.append(record)
    if payload and not records:
        raise LogSourceError("MCP вернул записи, но Shark не распознал поля сообщения. Нужен пример ответа инструмента.")
    return records, truncated


async def discover_services(source) -> list[str]:
    """Read names with an aggregation: listing OpenSearch indexes is not required."""
    if isinstance(source, DemoLogSource): return list(DEMO_SERVICES)
    if not isinstance(source, PvsLogSource):
        raise LogSourceError('Обновление справочника из логов доступно для профиля PVS.')
    try: hours = max(1, min(720, int(os.getenv('LOGS_PVS_SERVICES_HOURS', '72'))))
    except ValueError: hours = 72
    now = datetime.now(UTC)
    dsl = {'size': 0, 'query': {'bool': {'filter': [
        {'term': {source.fields['namespace']: source.namespace}},
        {'range': {source.fields['timestamp']: {'gte': (now-timedelta(hours=hours)).isoformat(), 'lte': now.isoformat()}}},
    ]}}, 'aggs': {'services': {'terms': {'field': source.fields['service'], 'size': 5000}}}}
    args = {'index': source.index, 'query_dsl': json.dumps(dsl) if source.dsl_as_string else dsl, 'size': 1}
    if source.format_supported: args['format'] = 'json'
    result = await _call_search(source.client, source.tool, args, pvs=True)
    buckets = _field(result, 'aggregations.services.buckets')
    if not isinstance(buckets, list): raise LogSourceError('PVS не вернул справочник сервисов. Проверьте доступ к агрегации и поле service.')
    if result.get('timed_out') or _field(result, '_shards.failed') or _field(result, 'aggregations.services.sum_other_doc_count'):
        raise LogSourceError('Справочник PVS получен не полностью. Сузьте период; предыдущий справочник сохранён.')
    return [str(b['key']) for b in buckets if b.get('key') is not None]
