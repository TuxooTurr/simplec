"""
Разбор логов: тысячи строк → несколько групп ошибок.

Повторы важнее потока: `NullPointerException ×847` — одна причина, а не 847 строк.
Группа определяется отпечатком (fingerprint): текст ошибки, где числа, UUID, hex,
IP, e-mail и время заменены на метки, плюс класс исключения и первые кадры стека.
Модуль не ходит в сеть — его используют MCP-сервер и (дальше) раздел SimpleTest.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

# ── Распознавание строки ─────────────────────────────────────────────────────

# Префикс времени от Kubernetes (logs?timestamps=true): RFC3339 с наносекундами.
_K8S_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s?(.*)$")
_LEVEL_RE = re.compile(r"\b(FATAL|CRITICAL|SEVERE|ERROR|ERR|WARN|WARNING|INFO|DEBUG|TRACE)\b")
_EXCEPTION_START_RE = re.compile(
    r"^(?:Exception in thread .*|Traceback \(most recent call last\):|"
    r"(?:[\w$]+\.)*[\w$]*(?:Exception|Error)(?::|\s*$))"
)
# Строки стека: «at …», «Caused by:», «... 12 more», кадры Python «  File "…"».
_CONTINUATION_RE = re.compile(
    r"^(?:\s+at\s|\tat\s|\s+\.\.\.\s*\d+\s+more|Caused by:|Suppressed:|\s+File \")"
)
# Просто строка с отступом — продолжение, только если предыдущее событие — ошибка
# (тело исключения Python, многострочное сообщение). Иначе это обычный лог.
_INDENTED_RE = re.compile(r"^\s{2,}\S")
_HTTP_5XX_RE = re.compile(r"\b(?:status|HTTP|code|statusCode)[\"']?\s*[=: /]\s*5\d\d\b", re.I)
_EXC_NAME_RE = re.compile(r"((?:[\w$]+\.)*[\w$]*(?:Exception|Error))\b")
_FRAME_RE = re.compile(r"^\s*at\s+([\w$.<>]+)")

ERROR_LEVELS = {"FATAL", "CRITICAL", "SEVERE", "ERROR", "ERR"}

# ── Нормализация для отпечатка ───────────────────────────────────────────────

_NORMALIZERS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?"), "<ts>"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I), "<uuid>"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "<email>"),
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b"), "<ip>"),
    (re.compile(r"\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b", re.I), "<hex>"),
    (re.compile(r"\d+"), "<n>"),
    (re.compile(r"\s+"), " "),
]


def normalize(text: str) -> str:
    out = text
    for pattern, repl in _NORMALIZERS:
        out = pattern.sub(repl, out)
    return out.strip()[:300]


# ── Событие ──────────────────────────────────────────────────────────────────

@dataclass
class LogEvent:
    ts: Optional[str]
    pod: Optional[str]
    level: str
    message: str
    stack: list[str] = field(default_factory=list)

    @property
    def is_error(self) -> bool:
        return (
            self.level in ERROR_LEVELS
            or bool(self.stack)
            or bool(_EXCEPTION_START_RE.match(self.message))
            or bool(_HTTP_5XX_RE.search(self.message))
        )

    @property
    def exception(self) -> str:
        for line in [self.message, *self.stack]:
            m = _EXC_NAME_RE.search(line)
            if m:
                return m.group(1)
        return ""

    def fingerprint(self) -> str:
        frames = []
        for line in self.stack:
            m = _FRAME_RE.match(line)
            if m:
                frames.append(m.group(1))
            if len(frames) == 3:
                break
        key = "|".join([normalize(self.message), self.exception, *frames])
        return hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]


def _from_json(text: str) -> Optional[tuple[str, str, list[str], Optional[str]]]:
    """Строка JSON-лога → (уровень, сообщение, стек, время) или None."""
    if not text.startswith("{"):
        return None
    try:
        obj = json.loads(text)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    level = ""
    for k in ("level", "severity", "log.level", "@l", "lvl"):
        v = obj.get(k)
        if isinstance(v, str) and v:
            level = v.upper()
            break
    message = ""
    for k in ("message", "msg", "@m", "text", "@mt"):
        v = obj.get(k)
        if isinstance(v, str) and v:
            message = v
            break
    stack_raw = ""
    for k in ("stack_trace", "stackTrace", "exception", "@x", "error.stack_trace", "err"):
        v = obj.get(k)
        if isinstance(v, str) and v:
            stack_raw = v
            break
        if isinstance(v, dict):
            stack_raw = v.get("stack") or v.get("message") or ""
            if stack_raw:
                break
    stack = [l for l in stack_raw.splitlines() if l.strip()]
    if stack and not message:
        message, stack = stack[0], stack[1:]
    ts = next((obj[k] for k in ("@timestamp", "timestamp", "time", "ts", "@t")
               if isinstance(obj.get(k), str) and obj[k][:4].isdigit()), None)
    return (level or "INFO"), (message or text[:300]), stack, ts


def parse_lines(lines: Iterable[tuple[Optional[str], str]]) -> list[LogEvent]:
    """(под, сырая строка) → события. Строки стека прикрепляются к предыдущему событию."""
    events: list[LogEvent] = []
    last_by_pod: dict[Optional[str], LogEvent] = {}

    for pod, raw in lines:
        if not raw or not raw.strip():
            continue
        ts = None
        text = raw.rstrip("\n")
        m = _K8S_TS_RE.match(text)
        if m:
            ts, text = m.group(1), m.group(2)

        prev = last_by_pod.get(pod)
        if prev is not None and not _LEVEL_RE.match(text.strip()) and (
            _CONTINUATION_RE.match(text) or (_INDENTED_RE.match(text) and prev.is_error)
        ):
            prev.stack.append(text)
            continue

        # Java (logback/log4j): «ERROR … сообщение», а исключение — следующей строкой.
        # Это одна ошибка: исключение уходит в стек сообщения, а не в отдельное событие.
        if (prev is not None and prev.level in ERROR_LEVELS and not prev.stack
                and _EXCEPTION_START_RE.match(text) and not _LEVEL_RE.search(text[:40])):
            prev.stack.append(text)
            continue

        # Python: «Traceback…», кадры, а суть ошибки — последней строкой без отступа.
        if prev is not None and prev.message.startswith("Traceback") and _EXCEPTION_START_RE.match(text):
            prev.stack.insert(0, prev.message)
            prev.message = text
            continue

        parsed = _from_json(text)
        if parsed:
            level, message, stack, json_ts = parsed
            ts = ts or json_ts
        else:
            lm = _LEVEL_RE.search(text[:200])
            level = lm.group(1) if lm else ""
            if level == "WARNING":
                level = "WARN"
            message, stack = text, []
            if not level and _EXCEPTION_START_RE.match(text):
                level = "ERROR"

        ev = LogEvent(ts=ts, pod=pod, level=level or "INFO", message=message, stack=stack)
        events.append(ev)
        last_by_pod[pod] = ev
    return events


# ── Категории и важность ─────────────────────────────────────────────────────

_CATEGORIES: list[tuple[str, re.Pattern]] = [
    ("memory",        re.compile(r"outofmemory|\boom\b|heap space|gc overhead|memory limit", re.I)),
    ("NPE",           re.compile(r"nullpointer|nonetype|cannot read propert(?:y|ies) of (?:null|undefined)|null reference", re.I)),
    ("timeout",       re.compile(r"timeout|timed out|deadline exceeded", re.I)),
    ("db",            re.compile(r"\bsql|jdbc|postgres|oracle|hibernate|deadlock|constraint|ora-\d|psql|liquibase", re.I)),
    ("auth",          re.compile(r"unauthori[sz]ed|forbidden|access denied|\b40[13]\b|jwt|token expired|authenticat", re.I)),
    ("network",       re.compile(r"connection refused|connectexception|unknownhost|connection reset|broken pipe|no route to host|econnrefused|\b50[234]\b", re.I)),
    ("serialization", re.compile(r"jackson|deserializ|serializ|json|unmarshal|mismatchedinput|parse error|malformed", re.I)),
    ("config",        re.compile(r"config|property|properties|bean creation|no such bean|missing env|not configured|placeholder", re.I)),
]


def categorize(text: str) -> str:
    for name, pattern in _CATEGORIES:
        if pattern.search(text):
            return name
    return "other"


def severity(level: str, category: str, count: int) -> str:
    """critical — падение (FATAL, память); high — массово; medium — повторяется; low — единично."""
    if level == "FATAL" or category == "memory":
        return "critical"
    if count >= 50:
        return "high"
    if count >= 5:
        return "medium"
    return "low"


# ── Группировка ──────────────────────────────────────────────────────────────

@dataclass
class ErrorGroup:
    fingerprint: str
    message: str
    exception: str
    level: str
    count: int = 0
    first_ts: Optional[str] = None
    last_ts: Optional[str] = None
    pods: set[str] = field(default_factory=set)
    sample_stack: list[str] = field(default_factory=list)

    @property
    def category(self) -> str:
        return categorize(" ".join([self.message, self.exception, *self.sample_stack[:3]]))

    @property
    def severity(self) -> str:
        return severity(self.level, self.category, self.count)

    def to_dict(self) -> dict:
        return {
            "fingerprint": self.fingerprint,
            "message": self.message[:500],
            "exception": self.exception,
            "level": self.level,
            "count": self.count,
            "first_ts": self.first_ts,
            "last_ts": self.last_ts,
            "pods": sorted(self.pods),
            "category": self.category,
            "severity": self.severity,
            "sample_stack": self.sample_stack[:15],
        }


_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def triage(lines: Iterable[tuple[Optional[str], str]]) -> dict:
    """Полный разбор: события → группы ошибок, от самых важных к менее важным."""
    events = parse_lines(lines)
    groups: dict[str, ErrorGroup] = {}
    errors = 0
    for ev in events:
        if not ev.is_error:
            continue
        errors += 1
        fp = ev.fingerprint()
        g = groups.get(fp)
        if g is None:
            g = groups[fp] = ErrorGroup(
                fingerprint=fp, message=ev.message, exception=ev.exception,
                level=ev.level if ev.level in ERROR_LEVELS else "ERROR",
                sample_stack=list(ev.stack),
            )
        g.count += 1
        if ev.pod:
            g.pods.add(ev.pod)
        if ev.ts:
            g.first_ts = min(filter(None, [g.first_ts, ev.ts]))
            g.last_ts = max(filter(None, [g.last_ts, ev.ts]))

    ordered = sorted(groups.values(), key=lambda g: (_SEVERITY_ORDER[g.severity], -g.count))
    return {
        "events": len(events),
        "errors": errors,
        "groups": [g.to_dict() for g in ordered],
    }


_LEAD_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*")
_LEAD_LEVEL_RE = re.compile(r"^(?:FATAL|CRITICAL|SEVERE|ERROR|ERR|WARN|WARNING)\b\s*")


def display_message(message: str) -> str:
    """Для отчёта: без даты и уровня в начале строки — они и так в колонках."""
    return _LEAD_LEVEL_RE.sub("", _LEAD_TS_RE.sub("", message.strip())).strip()


def render_markdown(result: dict, top: int = 10, title: str = "") -> str:
    """Отчёт для человека и LLM: сводка + таблица групп + образцы стеков."""
    groups = result["groups"]
    head = f"## {title}\n\n" if title else ""
    if not groups:
        return head + f"Ошибок не найдено (просмотрено событий: {result['events']})."
    lines = [
        head + f"Событий: {result['events']} · ошибок: {result['errors']} · "
               f"групп: {len(groups)}" + (f" (показаны первые {top})" if len(groups) > top else ""),
        "",
        "| # | Важность | Кол-во | Категория | Ошибка | Первая → последняя | Поды |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, g in enumerate(groups[:top], 1):
        text = display_message(g["message"])
        msg = (g["exception"] + " — " if g["exception"] and g["exception"] not in text else "") + text
        msg = msg.replace("|", "\\|").replace("\n", " ")[:160]
        span = f"{(g['first_ts'] or '')[11:19]} → {(g['last_ts'] or '')[11:19]}" if g["first_ts"] else "—"
        lines.append(f"| {i} | {g['severity']} | {g['count']} | {g['category']} | {msg} | {span} | {len(g['pods'])} |")
    for i, g in enumerate(groups[:3], 1):
        if g["sample_stack"]:
            lines += ["", f"**#{i} стек (начало):**", "```", *g["sample_stack"][:8], "```"]
    return "\n".join(lines)
