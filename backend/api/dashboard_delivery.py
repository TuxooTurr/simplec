"""Send authorized dashboard reports on the server, once per scheduled slot."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from colorsys import rgb_to_hls
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from urllib.parse import urlencode
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from agents import ether_mcp
from backend.api import jira_tool as jira
from db import dashboard_store as store
from db.postgres import SessionLocal

logger = logging.getLogger(__name__)
MAX_TEXT = 4000
MAX_ROWS = 30
GRACE = timedelta(minutes=10)
FIELD_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_CATEGORIES = {"new": "⚪", "indeterminate": "🔵", "done": "🟢"}
_HUE_DOTS = [(0, "🔴"), (30, "🟠"), (55, "🟡"), (130, "🟢"), (215, "🔵"), (280, "🟣"), (360, "🔴")]


class Recipient(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    peer: dict | list | str | int

    @field_validator("peer")
    @classmethod
    def peer_ref(cls, value):
        if not value or isinstance(value, bool) or len(json.dumps(value, ensure_ascii=False)) > 2048:
            raise ValueError("Некорректный адрес получателя Эфира.")
        return value


class Delivery(BaseModel):
    enabled: bool = False
    recipients: list[Recipient] = Field(default_factory=list, max_length=10)
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    time: str = Field(default="09:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=80)
    columns: list[str] = Field(default_factory=lambda: ["key", "summary", "status", "assignee"], max_length=12)
    statusColors: dict[str, str] = Field(default_factory=dict, max_length=200)

    @field_validator("timezone")
    @classmethod
    def timezone_exists(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Укажите часовой пояс IANA, например Europe/Moscow.") from None
        return value

    @model_validator(mode="after")
    def validate_schedule(self):
        if any(day not in range(7) for day in self.weekdays):
            raise ValueError("Выберите дни недели.")
        if any(not FIELD_ID.fullmatch(col) or col in jira._SKIP_FIELDS for col in self.columns):
            raise ValueError("Выберите доступные колонки Jira.")
        if any(len(key) > 420 or not re.fullmatch(r"#[0-9a-f]{6}", color, re.I)
               for key, color in self.statusColors.items()):
            raise ValueError("Некорректные цвета статусов.")
        self.weekdays = sorted(set(self.weekdays))
        self.columns = list(dict.fromkeys(self.columns))
        self.recipients = list({json.dumps(p.peer, sort_keys=True): p for p in self.recipients}.values())
        if self.enabled and (not self.weekdays or not self.recipients or not self.columns):
            raise ValueError("Выберите получателей, дни отправки и колонки.")
        return self


def next_slot(config: dict, now: datetime) -> datetime:
    local = now.astimezone(ZoneInfo(config["timezone"]))
    hour, minute = map(int, config["time"].split(":"))
    for offset in range(15):
        day = local + timedelta(days=offset)
        slot = day.replace(hour=hour, minute=minute, second=0, microsecond=0, fold=0)
        utc_slot = slot.astimezone(timezone.utc)
        round_trip = utc_slot.astimezone(local.tzinfo)
        if (slot.weekday() in config["weekdays"] and utc_slot > now
                and (round_trip.hour, round_trip.minute) == (hour, minute)):
            return utc_slot
    raise ValueError("В расписании нет дней отправки.")


def source_signature(widget: dict) -> str:
    keys = ("kind", "title", "jql", "period", "fromDate", "toDate", "groupField", "colors", "scope", "owner",
            "employeeLogin", "employeeName", "activityProject")
    return sha256(json.dumps([widget.get(k) for k in keys], sort_keys=True).encode()).hexdigest()


def public_config(data: dict, widget: dict, login: str) -> dict:
    config = data.get("deliveries", {}).get(widget["id"])
    if not config:
        return {"config": None, "last": None, "nextAt": None, "locked": False}
    if config["owner"] != login:
        return {"config": None, "last": None, "nextAt": None, "locked": True}
    changed = config["signature"] != source_signature(widget)
    return {"config": Delivery.model_validate(config).model_dump(), "last": config.get("last"),
            "nextAt": None if changed else config.get("nextAt"), "sourceChanged": changed, "locked": False}


def save_config(widget: dict, body: Delivery, login: str) -> dict:
    now = datetime.now(timezone.utc)
    with store.LOCK:
        data = store.read()
        current = next((w for w in data["widgets"] if w["id"] == widget["id"]), None)
        if not current or source_signature(current) != source_signature(widget):
            raise HTTPException(409, "Виджет изменился. Откройте настройки отправки заново.")
        configs = data.setdefault("deliveries", {})
        previous = configs.get(widget["id"])
        if previous and previous["owner"] != login:
            if body.enabled:
                raise HTTPException(403, "Расписание уже настроено другим пользователем.")
            configs.pop(widget["id"])
        else:
            last = previous.get("last") if previous else None
            if last and last["status"] == "sending":
                last = {**last, "status": "unknown", "error": "Расписание изменено во время отправки."}
            configs[widget["id"]] = {
                **body.model_dump(), "owner": login, "revision": uuid4().hex,
                "signature": source_signature(current),
                "nextAt": next_slot(body.model_dump(), now).isoformat() if body.enabled else None,
                "last": last,
            }
        store.write(data)
        return public_config(data, current, login)


def _claim(widget_id: str, now: datetime):
    with store.LOCK:
        data = store.read()
        config = data.get("deliveries", {}).get(widget_id)
        widget = next((w for w in data["widgets"] if w["id"] == widget_id), None)
        if not config or not config["enabled"] or not widget or config["signature"] != source_signature(widget):
            return None
        slot = store._time(config.get("nextAt"))
        if not slot or slot > now:
            return None
        # Record the occurrence before any external call. An ambiguous send is never repeated after a restart.
        config["nextAt"] = next_slot(config, now).isoformat()
        expired = now - slot > GRACE
        config["last"] = {"at": now.isoformat(), "status": "skipped" if expired else "sending",
                          "sent": 0, "total": len(config["recipients"]),
                          "error": "Срок отправки прошёл." if expired else ""}
        store.write(data)
        return None if expired else (widget, config)


def _current(widget_id, revision):
    data = store.read()
    config = data.get("deliveries", {}).get(widget_id)
    widget = next((w for w in data["widgets"] if w["id"] == widget_id), None)
    return bool(config and config["enabled"] and widget and config["revision"] == revision
                and config["signature"] == source_signature(widget))


def _finish(widget_id, revision, sent, total, error):
    with store.LOCK:
        data = store.read()
        config = data.get("deliveries", {}).get(widget_id)
        if config and config["revision"] == revision:
            config["last"].update(status="sent" if sent == total else "partial" if sent else "error",
                                  sent=sent, error=error)
            store.write(data)


def _dot(color, category):
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-f]{6}", color, re.I):
        return _CATEGORIES.get(category, "⚪")
    hue, light, sat = rgb_to_hls(*(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)))
    if sat < .25:
        return "⚪" if light >= .5 else "⚫"
    return min(_HUE_DOTS, key=lambda item: abs(item[0] - hue * 360))[1]


def _cell(widget, raw, issue, col, colors):
    field = "issuetype" if col == "type" else col
    value = issue.get("key") if field == "key" else issue["fields"].get(field)
    if isinstance(value, list):
        value = ", ".join(value)
    value = " ".join(str(value or "—").split())[:220]
    if field == "status" and value != "—":
        status = raw.get("fields", {}).get("status") or {}
        category = (status.get("statusCategory") or {}).get("key", "") if isinstance(status, dict) else ""
        name = issue["fields"].get("status", "")
        chart_color = (widget.get("colors") or {}).get(name) if widget.get("groupField") == "status" else None
        project = issue["key"].rpartition("-")[0]
        color = colors.get(f"{project}|{issue['fields'].get('issuetype', '')}|{name}")
        return f"{_dot(chart_color or color, category)} {value}"
    return value


def _report(widget, columns, colors):
    from backend.api.dashboard import query_for
    from backend.api.dashboard_activity import _quote

    with SessionLocal() as db:
        cfg = jira._load_cfg(db)
        if widget["kind"] == "employee":
            jql = (f"project = {_quote(widget['activityProject'])} AND assignee = {_quote(widget['employeeLogin'])}"
                   " ORDER BY updated DESC")
        else:
            jql = query_for(widget)
        fields = list(dict.fromkeys("issuetype" if col == "type" else col for col in columns if col != "key"))
        if "status" in fields and "issuetype" not in fields:
            fields.append("issuetype")
        raw, total = jira._search(cfg, jql, limit=MAX_ROWS, fields=",".join(fields) or "key")
        names = {"key": "Номер", "type": "Тип", "summary": "Тема", "status": "Статус", "assignee": "Исполнитель"}
        try:
            names.update((f["id"], f["name"]) for f in jira.catalog(db=db)["fields"])
        except HTTPException:
            pass  # A field ID remains an unambiguous heading when the catalog is unavailable.
    link = f"{cfg['base_url'].rstrip('/')}/issues/?{urlencode({'jql': jql})}"
    lead = widget["title"]
    if widget["kind"] == "employee":
        lead += f" · Задачи сотрудника {widget['employeeName']}"
    header = f"{lead}\nЗадач по JQL: {total}\n"
    table = " | ".join(names.get(col, col)[:60] for col in columns)
    rows = [table]
    budget = MAX_TEXT - len(header) - len(link) - 180
    if budget < len(table):
        raise ValueError("Ссылка JQL слишком длинная для одного сообщения Эфира.")
    for item in raw:
        issue = jira.norm_issue(item, cfg["base_url"])
        line = " | ".join(_cell(widget, item, issue, col, colors) for col in columns)
        budget -= len(line) + 1
        if budget < 0:
            break
        rows.append(line)
    shown = len(rows) - 1
    body = "\n".join(rows) if raw else "По этому фильтру задач нет."
    if shown < total:
        body += f"\nВ сообщении {shown} из {total}. Полный список открыт по ссылке."
    return f"{header}\n{body}\n\nФильтр Jira (JQL)\n{link}"


def run_due(widget_id: str, now: datetime | None = None, stopping: threading.Event | None = None):
    claim = _claim(widget_id, now or datetime.now(timezone.utc))
    if not claim:
        return
    widget, config = claim
    sent = 0
    revision = config["revision"]
    total = len(config["recipients"])
    error = ""
    try:
        from backend.api.dashboard import _ether_writer
        _ether_writer({"login": config["owner"]})
        if not ether_mcp.configured():
            raise HTTPException(409, "Эфир не подключён.")
        message = _report(widget, config["columns"], config.get("statusColors") or {})
        for recipient in config["recipients"]:
            if stopping and stopping.is_set():
                error = "Shark завершает работу."
                break
            if not _current(widget_id, revision):
                error = "Расписание или виджет изменились."
                break
            try:
                ether_mcp.send_message(recipient["peer"], message, sender=config["owner"])
                sent += 1
            except ether_mcp.EtherMcpError as exc:
                error = str(exc)
    except HTTPException as exc:
        error = str(exc.detail) if exc.status_code in (403, 409) else "Jira не вернула данные для отчёта."
    except ValueError as exc:
        error = str(exc)
    except Exception:
        error = "Не удалось собрать или отправить отчёт."
    _finish(widget_id, revision, sent, total, error)


def _recover_interrupted():
    with store.LOCK:
        data = store.read()
        interrupted = [c["last"] for c in data.get("deliveries", {}).values()
                       if (c.get("last") or {}).get("status") == "sending"]
        if interrupted:
            for last in interrupted:
                last.update(status="unknown", error="Shark перезапустился во время отправки.")
            store.write(data)


async def watch():
    stopping = threading.Event()
    pending: dict[str, asyncio.Task] = {}
    try:
        await asyncio.to_thread(_recover_interrupted)
        while True:
            try:
                pending = {key: task for key, task in pending.items() if not task.done()}
                now = datetime.now(timezone.utc)
                for widget_id, config in store.read().get("deliveries", {}).items():
                    if len(pending) >= 3:
                        break
                    next_at = store._time(config.get("nextAt"))
                    if widget_id not in pending and config.get("enabled") and next_at and next_at <= now:
                        pending[widget_id] = asyncio.create_task(asyncio.to_thread(run_due, widget_id, None, stopping))
            except Exception:
                logger.warning("Не удалось проверить расписания отправки виджетов.")
            await asyncio.sleep(15)
    finally:
        stopping.set()
        if pending:
            await asyncio.gather(*pending.values(), return_exceptions=True)
