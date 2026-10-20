"""График стендов: правила, заявки из комментариев Confluence, защита от одновременной записи, сборка страницы."""

from datetime import date

import pytest
from fastapi import HTTPException

import backend.api.stands as st

TODAY = date(2026, 10, 21)          # среда
CFG = {"base_url": "https://confluence.example", "token": "t", "token_path": "", "ssl_verify": False, "space": "~qa"}


@pytest.fixture
def conf(monkeypatch):
    """Подставной Confluence: свойство страницы 42 с версией, комментарии, ответы, тело страницы."""
    state = {"prop": None, "version": 0, "comments": [], "replies": [], "body": "", "page_version": 1, "conflict_once": False}
    monkeypatch.setattr(st, "today", lambda: TODAY)
    monkeypatch.setattr(st, "_load_cfg", lambda db: CFG)
    monkeypatch.setattr(st, "_config", lambda db: {"pages": {"Major-Check": "42", "Major-GO": ""}})

    def req(cfg, method, path, params=None, json_body=None, files=None, timeout=30):
        prop = f"/rest/api/content/42/property/{st.PROPERTY}"
        if method == "GET" and path == prop:
            if state["prop"] is None:
                raise HTTPException(404, "нет")
            return {"value": state["prop"], "version": {"number": state["version"]}}
        if method in ("POST", "PUT") and path in (prop, "/rest/api/content/42/property"):
            if state["conflict_once"]:              # «коллега записал раньше нас»
                state["conflict_once"] = False
                state["version"] += 1
                state["prop"]["bookings"].append(st._new_booking(date(2026, 10, 23), "Агенты", "agent-api", "", "коллега", "simpletest"))
                raise HTTPException(409, "Confluence: version conflict")
            want = (json_body.get("version") or {}).get("number", 1)
            if method == "PUT" and want != state["version"] + 1:
                raise HTTPException(409, "Confluence: version conflict")
            state["prop"], state["version"] = json_body["value"], want if method == "PUT" else 1
            return {}
        if method == "GET" and path == "/rest/api/content/42/child/comment":
            return {"results": state["comments"]}
        if method == "POST" and path == "/rest/api/content" and json_body.get("type") == "comment":
            state["replies"].append((json_body["ancestors"][0]["id"], json_body["body"]["storage"]["value"]))
            return {"id": "r"}
        if method == "GET" and path == "/rest/api/content/42":
            return {"title": "График стенда Major-Check", "version": {"number": state["page_version"]}}
        if method == "PUT" and path == "/rest/api/content/42":
            state["page_version"] += 1
            state["body"] = json_body["body"]["storage"]["value"]
            return {}
        raise HTTPException(404, f"нет маршрута {method} {path}")

    monkeypatch.setattr(st, "_request", req)
    return state


def _comment(cid, text, author="Иванов"):
    return {"id": cid, "body": {"storage": {"value": "<p>" + text.replace("\n", "<br/>") + "</p>"}}, "history": {"createdBy": {"displayName": author}}}


def _settings(start="2026-10-19"):
    st.put_settings("Major-Check", st.SettingsBody(limit=2, sprintStart=start, sprintDays=14), db=None)


def test_горизонт_два_спринта_рабочих_дней():
    d = {**st.default_data("Major-Check"), "sprintStart": "2026-10-05"}
    days = st.horizon(d, TODAY)
    assert days[0] == date(2026, 10, 19) and days[-1] == date(2026, 11, 13) and len(days) == 20   # текущий спринт с 19.10 + следующий


def test_разбор_заявки_и_даты():
    r = st.parse_request("Сервис: notify\nДата: 23.10\nКоманда: b2c\nЗадача: sber911-1", TODAY)
    assert (r["service"], r["date"], r["team"], r["task"]) == ("notify", date(2026, 10, 23), "b2c", "SBER911-1")
    assert "Команда" in st.parse_request("Сервис: x\nДата: 23.10", TODAY)["error"]
    assert "не понял дату" in st.parse_request("Сервис: x\nДата: завтра\nКоманда: SC", TODAY)["error"]
    assert st.parse_date("05.01", TODAY) == date(2027, 1, 5)           # без года — ближайшая впереди
    assert st.parse_date("2026-10-23", TODAY) == date(2026, 10, 23)
    d = st.default_data("Major-Check")
    assert st.match_team(d, "базовые") == "Базовые сервисы" and st.match_team(d, "b2c") == "B2C" and st.match_team(d, "") is None


def test_бронь_правила_лимит_выходной_заморозка(conf):
    _settings()
    st.add_booking("Major-Check", st.BookingBody(date="2026-10-22", team="SC", service="notify"), db=None)
    st.add_booking("Major-Check", st.BookingBody(date="2026-10-22", team="Агенты", service="gateway"), db=None)
    with pytest.raises(HTTPException) as e:
        st.add_booking("Major-Check", st.BookingBody(date="2026-10-22", team="B2C", service="rms"), db=None)
    assert "лимит 2/2" in e.value.detail and "23.10" in e.value.detail      # подсказан ближайший свободный
    with pytest.raises(HTTPException) as e:
        st.add_booking("Major-Check", st.BookingBody(date="2026-10-24", team="B2C", service="rms"), db=None)
    assert "выходной" in e.value.detail
    st.add_freeze("Major-Check", st.FreezeBody(start="2026-10-27", end="2026-10-28", reason="регресс"), db=None)
    with pytest.raises(HTTPException) as e:
        st.add_booking("Major-Check", st.BookingBody(date="2026-10-27", team="B2C", service="rms"), db=None)
    assert "заморозка до 28.10 (регресс)" in e.value.detail
    v = st.add_booking("Major-Check", st.BookingBody(date="2026-10-27", team="B2C", service="hotfix-svc", hotfix=True), db=None)
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert day["status"] == "ЛИМИТ" and len(day["bookings"]) == 2
    assert "ЗАМОРОЗКА" in conf["body"] and "регресс" in conf["body"]        # страница пересобрана


def test_одновременная_запись_не_теряет_бронь_коллеги(conf):
    _settings()
    conf["conflict_once"] = True
    v = st.add_booking("Major-Check", st.BookingBody(date="2026-10-22", team="SC", service="notify"), db=None)
    services = {b["service"] for d in v["days"] for b in d["bookings"]}
    assert services == {"notify", "agent-api"}                          # своя и коллеги, записанная между чтением и записью


def test_заявки_из_комментариев_принимаются_по_правилам_и_получают_ответ(conf):
    _settings()
    conf["comments"] = [
        _comment("c1", "Сервис: notify\nДата: 22.10\nКоманда: B2C"),
        _comment("c2", "Сервис: gateway\nДата: 22.10\nКоманда: SC"),
        _comment("c3", "Сервис: rms\nДата: 22.10\nКоманда: Агенты"),      # сверх лимита 2
        _comment("c4", "просто вопрос без шаблона"),
        _comment("c5", "Сервис: x\nДата: 23.10\nКоманда: Космос"),
    ]
    v = st.pull("Major-Check", db=None)
    assert v["pulled"]["accepted"] == 2 and v["pulled"]["pending"] == 3
    reasons = {p["cid"]: p["reason"] for p in v["pending"]}
    assert "лимит 2/2" in reasons["c3"] and "ближайший свободный день — 23.10" in reasons["c3"]
    assert "не указано" in reasons["c4"] and "не знаю команду «Космос»" in reasons["c5"]
    replies = dict(conf["replies"])
    assert replies["c1"].startswith("<p>Принято: notify, 22.10, B2C") and replies["c3"].startswith("<p>На рассмотрении")
    # Повторный сбор не берёт те же комментарии дважды
    assert st.pull("Major-Check", db=None)["pulled"] == {"accepted": 0, "pending": 0, "replyErrors": []}
    # Решение по заявке руками: c3 переносим на 23.10
    v = st.decide("Major-Check", "c3", st.PendingDecision(accept=True, date="2026-10-23"), db=None)
    assert all(p["cid"] != "c3" for p in v["pending"])
    assert any(b["service"] == "rms" for d in v["days"] if d["date"] == "2026-10-23" for b in d["bookings"])
    v = st.decide("Major-Check", "c5", st.PendingDecision(accept=False, note="нет такой команды"), db=None)
    assert dict(conf["replies"])["c5"] == "<p>Отклонено: нет такой команды</p>"


def test_страница_все_дни_двух_спринтов_и_памятка(conf):
    _settings()
    st.add_booking("Major-Check", st.BookingBody(date="2026-10-23", team="SC", service="notify", task="SBER911-5"), db=None)
    body = conf["body"]
    assert body.count("<tr><td>") == 20                                   # все рабочие дни двух спринтов, в т.ч. пустые
    assert body.count("<h2>Спринт с ") == 2
    assert "Сервис: notify" in body and "Базовые сервисы / Агенты / B2C / SC" in body
    assert "SC · notify · SBER911-5" in body and "<strong>ср 21.10</strong>" in body
    assert 'ac:name="status"' in body and "ПРОШЁЛ" in body               # пн и вт уже прошли


def test_нет_страницы_стенда_понятная_ошибка(conf):
    with pytest.raises(HTTPException) as e:
        st.get_stand("Major-GO", db=None)
    assert e.value.status_code == 409 and "не выбрана страница" in e.value.detail
