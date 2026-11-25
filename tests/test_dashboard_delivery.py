from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from backend.api import dashboard, dashboard_delivery as delivery
from db import dashboard_store as store


@pytest.fixture
def scheduled(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "FILE", tmp_path / "dashboard.json")
    widget = dashboard.Widget(id="bugs", title="Дефекты", jql="project = QA AND issuetype = Bug",
                              groupField="status", colors={"Исправлен": "#9b2ecb"}, period="today").model_dump()
    store.layout([widget], 0)
    monkeypatch.setenv("DASHBOARD_EDITORS", "alice,bob")
    monkeypatch.setattr(delivery.ether_mcp, "configured", lambda: True)
    monkeypatch.setattr(dashboard, "_ether_writer", lambda user: None)
    body = delivery.Delivery(enabled=True, recipients=[{"name": "QA", "peer": {"id": 1}}],
                             weekdays=[0, 2], time="09:00", timezone="Asia/Shanghai", columns=["status", "key"])
    result = dashboard.put_delivery("bugs", body, {"login": "alice"})
    return widget, result


def test_widget_sends_once_per_slot_with_rollup_columns_url_and_color(scheduled, monkeypatch):
    _, state = scheduled
    calls = []
    monkeypatch.setattr(delivery, "SessionLocal", lambda: nullcontext(None))
    monkeypatch.setattr(delivery.jira, "_load_cfg", lambda db: {"base_url": "https://jira.test"})
    monkeypatch.setattr(delivery.jira, "catalog", lambda **kwargs: {"fields": []})
    monkeypatch.setattr(delivery.jira, "_search", lambda cfg, jql, **kw: ([
        {"key": "QA-4", "fields": {"summary": "Скрытая колонка", "status": {"name": "Исправлен", "statusCategory": {"key": "done"}}}}
    ], 1))
    monkeypatch.setattr(delivery.ether_mcp, "send_message", lambda peer, message, *, sender: calls.append((peer, message, sender)))
    due = datetime.fromisoformat(state["nextAt"])
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: delivery.run_due("bugs", due), range(2)))
    assert len(calls) == 1 and calls[0][0] == {"id": 1} and calls[0][2] == "alice"
    text = calls[0][1]
    assert "🟣 Исправлен | QA-4" in text
    assert "Скрытая колонка" not in text
    assert parse_qs(urlsplit(text.splitlines()[-1]).query)["jql"] == [
        "(project = QA AND issuetype = Bug) AND created >= startOfDay() ORDER BY created ASC, key ASC"
    ]
    saved = dashboard.get_delivery("bugs", {"login": "alice"})
    assert saved["last"]["status"] == "sent" and datetime.fromisoformat(saved["nextAt"]) > due


def test_widget_schedule_stops_when_filter_or_sender_changes(scheduled, monkeypatch):
    widget, state = scheduled
    due = datetime.fromisoformat(state["nextAt"])
    calls = []
    monkeypatch.setattr(delivery.ether_mcp, "send_message", lambda *a, **kw: calls.append(a))
    store.layout([{**widget, "jql": "project = OTHER"}], 1)
    delivery.run_due("bugs", due)
    assert dashboard.get_delivery("bugs", {"login": "alice"})["sourceChanged"]
    assert dashboard.get_delivery("bugs", {"login": "bob"}) == {
        "config": None, "last": None, "nextAt": None, "locked": True,
    }
    store.layout([widget], 2)

    def reject(user):
        raise HTTPException(403, "Подключение сменилось.")

    monkeypatch.setattr(dashboard, "_ether_writer", reject)
    delivery.run_due("bugs", due)
    assert calls == []
    assert dashboard.get_delivery("bugs", {"login": "alice"})["last"]["status"] == "error"


def test_old_slot_is_not_sent_on_restart(scheduled, monkeypatch):
    _, state = scheduled
    due = datetime.fromisoformat(state["nextAt"])
    monkeypatch.setattr(delivery.ether_mcp, "send_message", lambda *a, **kw: pytest.fail("Отправлен устаревший отчёт"))
    delivery.run_due("bugs", due + timedelta(hours=1))
    assert dashboard.get_delivery("bugs", {"login": "alice"})["last"]["status"] == "skipped"


def test_timezone_and_weekday_determine_next_slot():
    cfg = {"timezone": "Asia/Shanghai", "weekdays": [0], "time": "09:00"}
    now = datetime(2026, 11, 29, 23, 59, tzinfo=timezone.utc)
    due = delivery.next_slot(cfg, now)
    assert due == datetime(2026, 11, 30, 1, tzinfo=timezone.utc)
    assert delivery.next_slot(cfg, due) == due + timedelta(days=7)
