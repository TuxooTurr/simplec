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


def _settings(frm="2026-10-19", to="2026-11-13", limit=0, releases=()):
    st.put_settings("Major-Check", st.SettingsBody(windowFrom=frm, windowTo=to, limit=limit,
                                                   releases=[st.ReleaseMark(name=n, date=d) for n, d in releases]), db=None)


def _book(date_, team, service, features="", task="", hotfix=False):
    return st.add_booking("Major-Check", st.BookingBody(date=date_, team=team, service=service, features=features, task=task, hotfix=hotfix), db=None)


def test_окно_планирования_все_дни_и_старые_данные_спринта():
    d = {**st.default_data("Major-Check"), "window": {"from": "2026-10-19", "to": "2026-11-13"}}
    days = st.window_days(d)
    assert days[0] == date(2026, 10, 19) and days[-1] == date(2026, 11, 13) and len(days) == 26     # с выходными
    old = st._norm_data("Major-Check", {"sprintStart": "2026-10-19", "sprintDays": 14, "limit": 3, "bookings": [{"id": "x", "date": "2026-10-20", "team": "SC", "service": "a"}]})
    assert old["window"] == {"from": "2026-10-19", "to": "2026-11-15"} and old["limit"] == 0     # лимит 3 был по умолчанию
    assert old["bookings"][0]["features"] == ""


def test_разбор_заявки_и_даты():
    r = st.parse_request("Сервис: notify\nДата: 23.10\nКоманда: b2c\nФичи: тема инцидента; фильтр\nЗадача: sber911-1", TODAY)
    assert (r["service"], r["date"], r["team"], r["task"], r["features"]) == ("notify", date(2026, 10, 23), "b2c", "SBER911-1", "тема инцидента; фильтр")
    assert "Команда" in st.parse_request("Сервис: x\nДата: 23.10", TODAY)["error"]
    assert "не понял дату" in st.parse_request("Сервис: x\nДата: завтра\nКоманда: SC", TODAY)["error"]
    assert st.parse_date("05.01", TODAY) == date(2027, 1, 5)
    d = st.default_data("Major-Check")
    assert st.match_team(d, "базовые") == "Базовые сервисы" and st.match_team(d, "b2c") == "B2C"


def test_конфликт_один_кэ_две_команды_красится_но_не_блокирует(conf):
    _settings()
    _book("2026-10-22", "SC", "notify", "тема инцидента")
    _book("2026-10-22", "Агенты", "gateway")
    v = _book("2026-10-22", "B2C", " Notify ", "фильтр")                  # тот же КЭ другой командой — можно, но конфликт
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert day["status"] == "КОНФЛИКТ" and day["conflicts"] == [{"service": "notify", "teams": ["B2C", "SC"]}]
    assert sorted((b["service"].strip(), b["conflict"]) for b in day["bookings"]) == [("Notify", True), ("gateway", False), ("notify", True)]
    _book("2026-10-23", "SC", "notify"); _book("2026-10-23", "SC", "notify")  # одна команда дважды — не конфликт
    assert next(x for x in st.get_stand("Major-Check", db=None)["days"] if x["date"] == "2026-10-23")["status"] == "МОЖНО"


def test_правила_выходной_заморозка_окно_и_лимит_по_желанию(conf):
    _settings()
    for _ in range(5):
        _book("2026-10-22", "SC", "svc")                                  # без лимита — сколько угодно
    with pytest.raises(HTTPException) as e:
        _book("2026-10-24", "B2C", "rms")
    assert "выходной" in e.value.detail
    with pytest.raises(HTTPException) as e:
        _book("2026-12-01", "B2C", "rms")
    assert "вне окна планирования 19.10–13.11" in e.value.detail
    st.add_freeze("Major-Check", st.FreezeBody(start="2026-10-27", end="2026-10-28", reason="регресс"), db=None)
    with pytest.raises(HTTPException) as e:
        _book("2026-10-27", "B2C", "rms")
    assert "заморозка до 28.10 (регресс)" in e.value.detail
    _book("2026-10-27", "B2C", "hotfix-svc", hotfix=True)
    _settings(limit=2)
    _book("2026-10-29", "SC", "a"); _book("2026-10-29", "SC", "b")
    with pytest.raises(HTTPException) as e:
        _book("2026-10-29", "SC", "c")
    assert "лимит 2/2" in e.value.detail and "30.10" in e.value.detail


def test_одновременная_запись_не_теряет_бронь_коллеги(conf):
    _settings()
    conf["conflict_once"] = True
    v = _book("2026-10-22", "SC", "notify")
    assert {b["service"] for d in v["days"] for b in d["bookings"]} == {"notify", "agent-api"}


def test_заявки_из_комментариев_с_фичами_и_конфликтом_в_ответе(conf):
    _settings()
    conf["comments"] = [
        _comment("c1", "Сервис: notify\nДата: 22.10\nКоманда: B2C\nФичи: тема инцидента"),
        _comment("c2", "Сервис: notify\nДата: 22.10\nКоманда: SC"),           # тот же КЭ — конфликт, но принято
        _comment("c3", "просто вопрос без шаблона"),
        _comment("c4", "Сервис: x\nДата: 23.10\nКоманда: Космос"),
        _comment("c5", "Сервис: x\nДата: 25.10\nКоманда: SC"),                # воскресенье
    ]
    v = st.pull("Major-Check", db=None)
    assert v["pulled"]["accepted"] == 2 and v["pulled"]["pending"] == 3
    replies = dict(conf["replies"])
    assert replies["c1"] == "<p>Принято: notify, 22.10, B2C</p>"
    assert "КОНФЛИКТ: notify в этот день ставит также B2C" in replies["c2"]
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert any(b["features"] == "тема инцидента" for b in day["bookings"]) and day["status"] == "КОНФЛИКТ"
    reasons = {p["cid"]: p["reason"] for p in v["pending"]}
    assert "не указано" in reasons["c3"] and "Космос" in reasons["c4"] and "выходной" in reasons["c5"]
    assert st.pull("Major-Check", db=None)["pulled"] == {"accepted": 0, "pending": 0, "replyErrors": []}
    v = st.decide("Major-Check", "c5", st.PendingDecision(accept=True, date="2026-10-26", features="ночная установка"), db=None)
    assert any(b["features"] == "ночная установка" for d in v["days"] if d["date"] == "2026-10-26" for b in d["bookings"])
    st.decide("Major-Check", "c4", st.PendingDecision(accept=False, note="нет такой команды"), db=None)
    assert dict(conf["replies"])["c4"] == "<p>Отклонено: нет такой команды</p>"


def test_страница_таблица_дней_маркеры_фичи_релизы(conf):
    _settings(releases=[("Release 26", "2026-11-06")])
    _book("2026-10-23", "SC", "notify", "тема инцидента; фильтр по статусу", "SBER911-5")
    _book("2026-10-23", "B2C", "notify")
    body = conf["body"]
    assert body.count("<tr><td") == 20 + 1                      # 20 рабочих дней окна, у 23.10 две брони — строк на одну больше
    assert '<td rowspan="2">' in body and "notify (SC)" in body and "тема инцидента<br/>фильтр по статусу" in body
    assert body.count(">КОНФЛИКТ<") >= 2 and "РЕЛИЗ Release 26" in body and "Окно планирования: 19.10.2026 — 13.11.2026" in body
    assert "Фичи: тема инцидента" in body and "<strong>ср 21.10</strong>" in body and "ПРОШЁЛ" in body


def test_нет_страницы_стенда_понятная_ошибка(conf):
    with pytest.raises(HTTPException) as e:
        st.get_stand("Major-GO", db=None)
    assert e.value.status_code == 409 and "не выбрана страница" in e.value.detail
