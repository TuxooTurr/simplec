"""
Ответ ресурса → строки логов для разбора (mcp_server.log_triage).

Узнаёт форматы, которые обычно стоят за просмотрщиками логов:
- Elasticsearch / Kibana / OpenSearch: hits.hits[]._source (и ответ Kibana bsearch);
- Grafana Loki: data.result[].values[[ts, line]];
- Kubernetes: текст `…/log` (с префиксом времени);
- JSON-массив строк или объектов; просто текст.

Каждая строка возвращается как (источник, текст): источник — под/контейнер/хост,
если он есть в записи, иначе None.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

_MSG_KEYS = ("message", "msg", "log", "@m", "text", "line")
_TS_KEYS = ("@timestamp", "timestamp", "time", "ts", "@t")
_SOURCE_KEYS = (("kubernetes", "pod_name"), ("kubernetes", "pod", "name"), ("pod",), ("host", "name"),
                ("hostname",), ("container",), ("service",))


def _dig(obj: Any, path: tuple) -> Any:
    for p in path:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(p)
    return obj


def _record_to_line(rec: dict) -> tuple[Optional[str], str]:
    """Документ лога → строка: «время уровень сообщение» + стек, если есть; JSON целиком — если сообщения нет."""
    msg = next((rec[k] for k in _MSG_KEYS if isinstance(rec.get(k), str) and rec[k]), None)
    if msg is None:
        return _source_of(rec), json.dumps(rec, ensure_ascii=False)
    # Сохраняем JSON-вид: log_triage сам достанет уровень, сообщение и стек.
    return _source_of(rec), json.dumps(rec, ensure_ascii=False) if _has_level_or_stack(rec) else _prefix_ts(rec, msg)


def _has_level_or_stack(rec: dict) -> bool:
    return any(k in rec for k in ("level", "severity", "log.level", "@l", "stack_trace", "exception", "@x"))


def _prefix_ts(rec: dict, msg: str) -> str:
    ts = next((rec[k] for k in _TS_KEYS if isinstance(rec.get(k), str)), None)
    return f"{ts} {msg}" if ts and "T" in ts else msg


def _source_of(rec: dict) -> Optional[str]:
    for path in _SOURCE_KEYS:
        v = _dig(rec, path)
        if isinstance(v, str) and v:
            return v
    return None


def _ns_to_iso(ns: str) -> str:
    try:
        return datetime.fromtimestamp(int(ns) / 1e9, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    except (ValueError, OverflowError):
        return ""


def extract_lines(body: str, content_type: str = "") -> list[tuple[Optional[str], str]]:
    text = body or ""
    stripped = text.lstrip()
    if "json" in content_type or stripped[:1] in ("{", "["):
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if data is not None:
            lines = _from_json(data)
            if lines is not None:
                return lines
    return [(None, l) for l in text.splitlines() if l.strip()]


def _from_json(data: Any) -> Optional[list[tuple[Optional[str], str]]]:
    # Kibana bsearch / _msearch: несколько ответов внутри
    if isinstance(data, dict) and isinstance(data.get("responses"), list):
        out: list = []
        for r in data["responses"]:
            out += _from_json(r) or []
        return out
    if isinstance(data, dict) and isinstance(data.get("rawResponse"), dict):
        return _from_json(data["rawResponse"])

    # Elasticsearch / OpenSearch
    hits = _dig(data, ("hits", "hits"))
    if isinstance(hits, list):
        return [_record_to_line(h.get("_source") or h.get("fields") or {}) for h in hits if isinstance(h, dict)]

    # Loki
    result = _dig(data, ("data", "result"))
    if isinstance(result, list) and result and isinstance(result[0], dict) and "values" in result[0]:
        out = []
        for stream in result:
            labels = stream.get("stream") or stream.get("metric") or {}
            src = labels.get("pod") or labels.get("container") or labels.get("app")
            for pair in stream.get("values", []):
                if isinstance(pair, list) and len(pair) == 2:
                    ts = _ns_to_iso(str(pair[0]))
                    out.append((src, f"{ts} {pair[1]}" if ts else str(pair[1])))
        return out

    # Массив строк или записей
    items = data if isinstance(data, list) else next(
        (data[k] for k in ("items", "logs", "entries", "records", "data", "lines") if isinstance(data, dict)
         and isinstance(data.get(k), list)), None)
    if isinstance(items, list):
        out = []
        for it in items:
            if isinstance(it, str):
                out.append((None, it))
            elif isinstance(it, dict):
                out.append(_record_to_line(it))
        return out
    return None


def log_likeness(body: str, content_type: str = "", url: str = "") -> int:
    """Насколько ответ похож на логи (0–100) — чтобы подсказать, какой запрос выбрать."""
    if not body:
        return 0
    lines = extract_lines(body[:400_000], content_type)
    if not lines:
        return 0
    sample = [l for _, l in lines[:300]]
    has_level = sum(1 for l in sample if any(w in l.upper() for w in ("ERROR", "WARN", "INFO", "DEBUG", "EXCEPTION")))
    has_ts = sum(1 for l in sample if l[:4].isdigit() and "-" in l[:10] or '"@timestamp"' in l or '"timestamp"' in l)
    score = min(30, len(lines) // 2) + int(35 * has_level / len(sample)) + int(25 * has_ts / len(sample))
    if any(w in url.lower() for w in ("log", "search", "query_range", "_msearch", "bsearch")):
        score += 10
    return min(100, score)
