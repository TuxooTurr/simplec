"""Bounded sampling of uploaded text logs for a single model investigation."""
from __future__ import annotations

from collections import deque
from threading import Event
from typing import BinaryIO

from agents.logs_mcp import LOG_ERROR_LEVELS, Record, redact
from mcp_server.log_triage import LogEvent, normalize as normalize_message, parse_line

MAX_BYTES = 500 * 1024 * 1024
MAX_FILES = 12
_LINE_BYTES = 32 * 1024
_SAMPLE_LIMIT = 24


class LogFileError(ValueError):
    pass


def _sample_event(event: LogEvent, file_number: int, error: bool) -> Record:
    return Record(service=f"Файл {file_number}", timestamp=(event.ts or "")[:70], level=event.level[:32],
                  message=redact(event.message)[:850], stack=[redact(line)[:200] for line in event.stack[:2]],
                  error=error)


def scan_files(files: list[BinaryIO], errors_only: bool, stop: Event) -> tuple[list[Record], dict]:
    size, lines, events, errors, long_lines = 0, 0, 0, 0, 0
    samples: list[list[Record]] = []
    for file_number, file in enumerate(files, 1):
        head: list[Record] = []
        tail: deque[tuple[int, LogEvent, bool]] = deque(maxlen=3)
        representatives: dict[str, tuple[int, Record]] = {}
        pending: LogEvent | None = None
        file_count = 0

        def collect(event: LogEvent) -> None:
            nonlocal events, errors, file_count
            error = event.is_error or event.level in LOG_ERROR_LEVELS
            events += 1
            errors += error
            if errors_only and not error:
                return
            file_count += 1
            if error and len(representatives) < 3:
                key = normalize_message(event.message[:850])
                if key not in representatives:
                    representatives[key] = (file_count, _sample_event(event, file_number, error))
            if file_count <= 3:
                head.append(_sample_event(event, file_number, error))
            else:
                tail.append((file_count, event, error))

        first_line = True
        while not stop.is_set() and (raw := file.readline(_LINE_BYTES)):
            lines += 1
            size += len(raw)
            if b"\x00" in raw:
                raise LogFileError("Загрузите текстовые логи в UTF-8. Архивы и бинарные файлы не поддерживаются.")
            clipped = len(raw) == _LINE_BYTES and not raw.endswith(b"\n")
            if clipped:
                long_lines += 1
                while not stop.is_set() and (chunk := file.readline(_LINE_BYTES)):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise LogFileError("Общий объём файлов превышает 500 МБ.")
                    if chunk.endswith(b"\n"):
                        break
            if size > MAX_BYTES:
                raise LogFileError("Общий объём файлов превышает 500 МБ.")
            encoding = "utf-8-sig" if first_line else "utf-8"
            first_line = False
            try:
                line = raw.decode(encoding)
            except UnicodeDecodeError as exc:
                if not clipped or exc.reason != "unexpected end of data":
                    raise LogFileError("Загрузите текстовые логи в кодировке UTF-8.") from exc
                line = raw.decode(encoding, errors="ignore")
            event = parse_line(line, None, pending)
            if event is not None:
                if pending is not None:
                    collect(pending)
                pending = event
            if pending and len(pending.stack) > 4:
                del pending.stack[4:]
        if stop.is_set():
            raise InterruptedError
        if pending is not None:
            collect(pending)
        ordered = dict(representatives.values())
        for i, record in enumerate(head, 1):
            ordered.setdefault(i, record)
        for i, event, error in reversed(tail):
            ordered.setdefault(i, _sample_event(event, file_number, error))
        samples.append(list(ordered.values()))

    records = [sample[i] for i in range(max(map(len, samples), default=0)) for sample in samples if i < len(sample)][:_SAMPLE_LIMIT]
    return records, {"fileCount": len(files), "sizeBytes": size, "lineCount": lines, "eventCount": events,
                     "errorCount": errors, "sampleCount": len(records), "longLines": long_lines, "errorsOnly": errors_only}
