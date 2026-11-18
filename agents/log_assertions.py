"""Async log search and polling for test runners using the same MCP adapter as Shark."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta

import anyio

from agents.logs_mcp import LogSourceError, Record, as_time, configured_namespace, normalize, open_source


@dataclass(frozen=True)
class LogFilter:
    namespace: str | None = None
    service: str | None = None
    levels: tuple[str, ...] = ()
    text: str = ""
    field: str = ""
    value: str | None = None
    trace_id: str = ""
    request_id: str = ""
    errors_only: bool = False


@dataclass(frozen=True)
class LogSearch:
    records: list[Record]
    truncated: bool
    timed_out: bool = False


async def read_matching(source, start: datetime, end: datetime, filters: LogFilter, limit: int) -> LogSearch:
    if start.utcoffset() is None or end.utcoffset() is None or not timedelta(0) < end - start <= timedelta(days=7):
        raise ValueError("Укажите даты с часовым поясом и период от 0 до 7 дней.")
    if not 1 <= limit <= 1000:
        raise ValueError("Лимит выборки должен быть от 1 до 1000.")
    if filters.value is not None and not filters.field:
        raise ValueError("Укажите имя поля, если ищете по значению.")
    namespace = filters.namespace if filters.namespace is not None else configured_namespace()
    data = await source.search(service=filters.service, start=start, end=end, limit=limit, namespace=namespace,
                               trace_id=filters.trace_id, errors_only=filters.errors_only)
    rows, truncated = normalize(data, filters.service, limit, namespace=namespace, field=filters.field)
    timed_out = isinstance(data, dict) and data.get("timed_out") is True
    levels = {level.strip().upper().replace("WARNING", "WARN") for level in filters.levels}
    text = filters.text.casefold()

    def matches(row: Record) -> bool:
        ts = as_time(row.timestamp)
        return (not namespace or row.namespace == namespace) and (not ts or start <= ts <= end) and (
            not filters.service or row.service.casefold() == filters.service.casefold()
        ) and (not levels or row.level.replace("WARNING", "WARN") in levels) and (
            not filters.errors_only or row.error
        ) and (not filters.trace_id or row.traceId == filters.trace_id) and (
            not filters.request_id or row.requestId == filters.request_id
        ) and (not text or text in row.message.casefold()) and (
            not filters.field or (row.fieldValue is not None and (filters.value is None or row.fieldValue == filters.value))
        )

    records = [row for row in rows if matches(row)]
    return LogSearch(sorted(records, key=lambda r: as_time(r.timestamp) or start, reverse=True), truncated or timed_out, timed_out)


async def fetch_logs(start: datetime, end: datetime, filters: LogFilter = LogFilter(), *, limit: int = 500) -> LogSearch:
    async with open_source() as source:
        return await read_matching(source, start, end, filters, limit)


async def wait_for_logs(start: datetime, end: datetime, filters: LogFilter, *, timeout: float = 30,
                        interval: float = 2, limit: int = 500) -> LogSearch:
    """Poll the same test window until matching records arrive, within a total timeout."""
    if timeout <= 0 or interval <= 0:
        raise ValueError("Таймаут и интервал ожидания должны быть больше нуля.")
    last_error = ""
    truncated = False
    try:
        with anyio.fail_after(timeout):
            async with open_source() as source:
                while True:
                    try:
                        result = await read_matching(source, start, end, filters, limit)
                        if result.records:
                            return result
                        truncated = truncated or result.truncated
                        last_error = ""
                    except LogSourceError as exc:
                        last_error = str(exc)
                    await asyncio.sleep(interval)
    except TimeoutError as exc:
        suffix = " Выборка была ограничена. Сузьте период или добавьте идентификатор операции." if truncated else ""
        if last_error:
            suffix += f" Последняя ошибка MCP: {last_error}"
        raise TimeoutError(f"Подходящие логи не появились за {timeout:g} с.{suffix}") from exc
