"""
Записанное действие → шаблон операции, и обратно: шаблон + параметры → действие.

При записи человек вводит конкретные значения («pay-api», «INC0001543210»).
Выбранные значения становятся параметрами {service}, {incident}…, а значения
времени — переменными окна ({from_iso}, {to_ms}, {since_seconds}…), которые при
запуске считаются от «сейчас»: последние N минут.

Два вида шаблонов:
- запрос сайта (templatize) — повтор XHR/fetch, которым сайт получает данные;
- шаги (templatize_steps) — открыть, ввести, нажать — для сайтов без удобного API.

Отдельно распознаётся консоль OpenShift: запрос логов там привязан к конкретному
поду (`…/pods/pay-api-7d9f-x/log`), поэтому сценарий хранит проект, а поды
сервиса находятся при запуске.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Значения времени считаем «временем запроса», только если они близко к моменту
# записи — иначе это случайное число (id, offset).
_NEAR = timedelta(days=3)

_FROM_HINT = re.compile(r"(?i)(from|start|gte|gt|since|after|begin|min)")
_TO_HINT = re.compile(r"(?i)(to|end|lte|lt|until|before|max)")
_SINCE_SECONDS_KEY = re.compile(r"(?i)^since_?seconds$")
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$")

WINDOW_VARS = ("since_seconds",) + tuple(f"{side}_{fmt}" for side in ("from", "to") for fmt in ("iso", "ms", "s", "ns"))
PARAM_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_NUM_MARK_RE = re.compile(r'"__ST_NUM_((?:from|to)_(?:iso|ms|s|ns))__"')


def _names_re(names) -> str:
    return "(" + "|".join(sorted((re.escape(n) for n in names), key=len, reverse=True)) + ")"

K8S_POD_LOG_RE = re.compile(r"/api/kubernetes/api/v1/namespaces/([^/]+)/pods/([^/]+)/log$")

# Заголовки, которые нельзя сохранять (секреты) или бессмысленно повторять.
_DROP_HEADERS = {"cookie", "authorization", "content-length", "host", "connection", "accept-encoding",
                 "origin", "referer", "user-agent", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site",
                 "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "priority"}


def _parse_time(value: Any) -> Optional[tuple[datetime, str]]:
    """Значение → (момент, формат) для ISO и epoch s/ms/ns; иначе None."""
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        n = int(value)
        for unit, div in (("ns", 1e9), ("ms", 1e3), ("s", 1)):
            try:
                dt = datetime.fromtimestamp(n / div, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                continue
            if 2000 < dt.year < 2100:
                digits = len(str(n))
                if (unit, digits) in (("ns", 19), ("ms", 13), ("s", 10)):
                    return dt, unit
        return None
    if isinstance(value, str) and _ISO_RE.match(value):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00").replace(" ", "T"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt, "iso"
    return None


def _as_params(params: "dict[str, str] | str") -> dict[str, str]:
    """Совместимость: раньше параметр был один — строка-сервис."""
    if isinstance(params, str):
        return {"service": params} if params.strip() else {}
    return {k: v for k, v in (params or {}).items() if v and str(v).strip()}


class _Templater:
    """Обходит запрос, заменяя значения параметров и время переменными. Помнит, что заменено."""

    def __init__(self, params: dict[str, str], recorded_at: datetime):
        # Длинные значения — первыми: «pay-api-v2» не должен распасться на «{service}-v2».
        self.params = sorted(((k, str(v).strip()) for k, v in params.items()), key=lambda kv: -len(kv[1]))
        self.recorded_at = recorded_at
        self.found: dict[str, list[str]] = {"time": [], **{k: [] for k in params}}
        self._pending: list[tuple[datetime, str, str, Any, Any]] = []   # (момент, формат, ключ, контейнер, индекс)

    def text(self, value: str) -> str:
        out = value
        for name, val in self.params:
            if val and val in out:
                self.found[name].append(value)
                out = out.replace(val, "{" + name + "}")
        return out

    def scalar(self, key: str, value: Any, container: Any, index: Any) -> Any:
        if _SINCE_SECONDS_KEY.match(key or "") and str(value).isdigit():
            self.found["time"].append(f"{key}={value}")
            return "{since_seconds}"
        t = _parse_time(value)
        if t and abs(t[0] - self.recorded_at) <= _NEAR:
            self._pending.append((t[0], t[1], key or "", container, index))
            return value
        return self.text(value) if isinstance(value, str) else value

    def walk(self, obj: Any, key: str = "") -> Any:
        if isinstance(obj, dict):
            for k in list(obj):
                obj[k] = self.walk(obj[k], k) if isinstance(obj[k], (dict, list)) else self.scalar(k, obj[k], obj, k)
            return obj
        if isinstance(obj, list):
            for i, v in enumerate(obj):
                obj[i] = self.walk(v, key) if isinstance(v, (dict, list)) else self.scalar(key, v, obj, i)
            return obj
        return obj

    def resolve_times(self) -> None:
        """Самое раннее время — начало окна, самое позднее — конец; одиночное — по имени ключа."""
        if not self._pending:
            return
        moments = [p[0] for p in self._pending]
        lo, hi = min(moments), max(moments)
        for moment, fmt, key, container, index in self._pending:
            if lo != hi:
                side = "from" if moment == lo else "to"
            else:
                side = "from" if _FROM_HINT.search(key) and not _TO_HINT.fullmatch(key) else "to"
            self.found["time"].append(f"{key or '…'}={container[index]}")
            # Число в JSON должно остаться числом: метка без кавычек ставится после dumps.
            if isinstance(container[index], (int, float)):
                container[index] = f"__ST_NUM_{side}_{fmt}__"
            else:
                container[index] = "{" + f"{side}_{fmt}" + "}"


def templatize(request: dict, params: "dict[str, str] | str", recorded_at: Optional[datetime] = None) -> dict:
    """Запись запроса → шаблон операции.

    request: {"method", "url", "body" (str|None), "headers" (dict)}.
    params:  {имя параметра: значение при записи}; строка — старый вариант «сервис».
    Возвращает {"kind": "request"|"k8s_logs", ..., "found": {"time": [...], <параметр>: [...]}}.
    """
    params = _as_params(params)
    recorded_at = recorded_at or datetime.now(timezone.utc)
    parts = urlsplit(request["url"])

    m = K8S_POD_LOG_RE.search(parts.path)
    if m:
        query = dict(parse_qsl(parts.query))
        return {
            "kind": "k8s_logs",
            "namespace": m.group(1),
            "container": query.get("container", ""),
            "pod_example": m.group(2),
            "found": {"service": [m.group(2)] if any(v in m.group(2) for v in params.values()) else [],
                      "time": [k for k in ("sinceSeconds", "sinceTime") if k in query]},
        }

    t = _Templater(params, recorded_at)
    path = t.text(parts.path)
    query_items = [[k, v] for k, v in parse_qsl(parts.query, keep_blank_values=True)]
    for item in query_items:
        item[1] = t.scalar(item[0], item[1], item, 1)

    body = request.get("body")
    body_json = None
    if body:
        try:
            body_json = json.loads(body)
        except ValueError:
            body = t.text(body)
    if body_json is not None:
        t.walk(body_json)

    t.resolve_times()
    # urlencode экранирует фигурные скобки — возвращаем наши переменные как есть.
    names = list(params) + list(WINDOW_VARS)
    query = re.sub(r"%7B" + _names_re(names) + r"%7D", r"{\1}", urlencode([(k, v) for k, v in query_items]))
    body_out = body
    if body_json is not None:
        body_out = _NUM_MARK_RE.sub(r"{\1}", json.dumps(body_json, ensure_ascii=False))
    return {
        "kind": "request",
        "method": request.get("method", "GET").upper(),
        "url": urlunsplit((parts.scheme, parts.netloc, path, query, "")),
        "body": body_out,
        "headers": {k: v for k, v in (request.get("headers") or {}).items() if k.lower() not in _DROP_HEADERS},
        "found": t.found,
    }


def window_vars(minutes: int, now: Optional[datetime] = None) -> dict[str, str]:
    """Переменные окна «последние N минут» во всех форматах, которые умеет шаблон."""
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(minutes=minutes)

    def iso(d: datetime) -> str:
        return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"

    return {
        "since_seconds": str(minutes * 60),
        "from_iso": iso(start), "to_iso": iso(now),
        "from_ms": str(int(start.timestamp() * 1000)), "to_ms": str(int(now.timestamp() * 1000)),
        "from_s": str(int(start.timestamp())), "to_s": str(int(now.timestamp())),
        "from_ns": str(int(start.timestamp() * 1e9)), "to_ns": str(int(now.timestamp() * 1e9)),
    }


def render(template: str, values: "dict[str, str] | str", minutes: int = 10, now: Optional[datetime] = None) -> str:
    """Подставляет параметры и переменные окна. Прочие фигурные скобки (JSON) не трогает."""
    if isinstance(values, str):
        values = {"service": values}
    all_values = {**{k: str(v) for k, v in values.items()}, **window_vars(minutes, now)}
    return re.sub(r"\{" + _names_re(all_values) + r"\}", lambda m: all_values[m.group(1)], template)


_LABELS = {"service": "Сервис"}


def template_params(tpl: dict) -> list[dict]:
    """Параметры, на которые ссылается шаблон ({имя}), кроме переменных окна времени."""
    texts = [tpl.get("url"), tpl.get("body"), tpl.get("start_url"),
             *(s.get("value") for s in tpl.get("steps") or [])]
    names: list[str] = []
    for t in texts:
        for n in re.findall(r"\{([a-z][a-z0-9_]{0,39})\}", t or ""):
            if n not in WINDOW_VARS and n not in names:
                names.append(n)
    return [{"name": n, "label": _LABELS.get(n, n), "default": ""} for n in names]


def uses_window(*texts: Optional[str]) -> bool:
    """Есть ли в шаблоне переменные окна времени."""
    return any(t and re.search(r"\{" + _names_re(WINDOW_VARS) + r"\}", t) for t in texts)


# ── Шаги ─────────────────────────────────────────────────────────────────────

def detect_login(steps: list[dict]) -> Optional[dict]:
    """Где в записи вход: поле логина, поле пароля и чем отправили форму.

    Пароль в записи не хранится — только факт ввода (secret). По нему и находим
    форму входа, чтобы потом входить самим логином и паролем техучётки.
    """
    pw = next((i for i, s in enumerate(steps) if s.get("type") == "fill" and s.get("secret")), None)
    if pw is None:
        return None
    user = next((i for i in range(pw - 1, -1, -1)
                 if steps[i].get("type") == "fill" and not steps[i].get("secret")), None)
    submit = next((i for i in range(pw + 1, len(steps)) if steps[i].get("type") in ("click", "press")), None)
    login_url = next((steps[i]["url"] for i in range((user if user is not None else pw), -1, -1)
                      if steps[i].get("type") == "goto"), "")
    return {
        "user_selector": steps[user]["selector"] if user is not None else "",
        "password_selector": steps[pw]["selector"],
        "submit": ({"type": steps[submit]["type"], "selector": steps[submit]["selector"],
                    "key": steps[submit].get("key", "Enter")} if submit is not None else None),
        "login_url": login_url,
        "end_index": (submit if submit is not None else pw) + 1,
    }


def _caused_gotos(steps: list[dict]) -> set[int]:
    """Переходы, вызванные кликом/Enter: первый переход после действия, не позже 5 с.

    Их повторять не нужно — их повторит сам клик. Остальные переходы человек сделал
    сам (адрес, закладка) — они остаются шагами.
    """
    caused, last_action, consumed = set(), None, True
    for i, s in enumerate(steps):
        kind = s.get("type")
        if kind in ("click", "press"):
            last_action, consumed = s, False
        elif kind == "goto":
            if not consumed and last_action is not None and (s.get("t", 0) - last_action.get("t", 0)) <= 5:
                caused.add(i)
            consumed = True
    return caused


def templatize_steps(steps: list[dict], params: dict[str, str], start_index: int = 0) -> dict:
    """Записанные шаги → шаблон «повтор действий».

    Берутся шаги начиная со start_index (обычно — сразу после входа). Ввод пароля
    выбрасывается всегда, переходы от кликов — тоже (их повторит клик). Первый
    оставшийся переход — стартовая страница; если его нет — страница, где начались шаги.
    """
    params = _as_params(params)
    t = _Templater(params, datetime.now(timezone.utc))
    caused = _caused_gotos(steps)
    out: list[dict] = []
    start_url = ""
    for i in range(start_index, len(steps)):
        s = steps[i]
        kind = s.get("type")
        if (kind == "fill" and s.get("secret")) or (kind == "goto" and i in caused):
            continue
        if kind == "goto":
            if not out and not start_url:
                start_url = s["url"]
                continue
            out.append({"type": "goto", "url": t.text(s["url"])})
            continue
        step = {"type": kind, "selector": s.get("selector", "")}
        if kind == "fill":
            step["value"] = t.text(str(s.get("value", "")))
        elif kind == "click":
            step["text"] = s.get("text", "")
        elif kind == "press":
            step["key"] = s.get("key", "Enter")
        out.append(step)
    if not start_url:
        start_url = next((s["url"] for s in reversed(steps[:start_index + 1]) if s.get("type") == "goto"), "")
    return {"kind": "steps", "start_url": t.text(start_url) if start_url else "", "steps": out, "found": t.found}
