"""График стендов: правила, заявки из комментариев Confluence, защита от одновременной записи, сборка страницы."""

from datetime import date

import pytest
from fastapi import HTTPException

import backend.api.stands as st

TODAY = date(2026, 10, 21)          # среда
CFG = {"base_url": "https://confluence.example", "token": "t", "token_path": "", "ssl_verify": False, "space": "~qa"}


@pytest.fixture
def conf(monkeypatch, tmp_path):
    """Подставной Confluence: свойство страницы 42 с версией, комментарии, ответы, тело страницы."""
    monkeypatch.setattr(st.ke_store, "KE_FILE", tmp_path / "ke_catalog.json")      # справочник КЭ — не в data/ проекта
    monkeypatch.setattr(st.ms_store, "MS_FILE", tmp_path / "ms_catalog.json")     # и микросервисов
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
    days = body.split("<h2>По дням</h2>")[1]
    assert days.count("<tr><td") == 20 + 1                      # 20 рабочих дней окна; у 23.10 две установки (SC и B2C) — строк на одну больше
    assert '<td rowspan="2">' in days and "<td>SC</td><td>notify" in days and "SBER911-5 — тема инцидента; фильтр по статусу" in days
    assert body.count(">КОНФЛИКТ<") >= 2 and "РЕЛИЗ Release 26" in body and "Окно планирования: 19.10.2026 — 13.11.2026" in body
    assert "Фичи: тема инцидента" in body and "<strong>ср 21.10</strong>" in body and "ПРОШЁЛ" in body


def test_пачка_броней_из_списка_одной_записью(conf):
    _settings()
    pages_before = conf["page_version"]
    items = [st.BookingBody(date="2026-10-22", team="SC", service=f"server-{n}", features="Миграция БД", task="SBER911-7") for n in range(30)]
    items.append(st.BookingBody(date="2026-10-24", team="SC", service="weekend", task="SBER911-8"))     # выходной — отказ
    v = st.add_bookings("Major-Check", st.BulkBookings(items=items), db=None)
    assert v["added"] == 30 and v["rejected"] == [{"service": "weekend", "task": "SBER911-8", "reason": "выходной"}]
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert len(day["bookings"]) == 30 and {b["task"] for b in day["bookings"]} == {"SBER911-7"}
    assert conf["page_version"] == pages_before + 1                       # страница пересобрана один раз
    with pytest.raises(HTTPException):
        st.add_bookings("Major-Check", st.BulkBookings(items=[]), db=None)

def test_один_кэ_у_команды_по_разным_фичам_одна_установка_и_одна_строка_на_странице(conf):
    _settings(limit=2)
    _book("2026-10-22", "B2C", "rms-front", "Карточка инцидента", "SBER911-1")
    _book("2026-10-22", "B2C", "rms-front", "Фильтр по статусу", "SBER911-2")
    _book("2026-10-22", "B2C", "rms-front", "Тема инцидента", "SBER911-3")    # тот же КЭ — лимит 2 не съеден
    v = _book("2026-10-22", "SC", "gateway")
    assert v["days"][[d["date"] for d in v["days"]].index("2026-10-22")]["status"] == "ЛИМИТ"   # установок 2: rms-front (B2C) + gateway (SC)
    body = conf["body"].split("<h2>По дням</h2>")[1]
    assert body.count("<td>B2C</td><td>rms-front") == 1
    assert "SBER911-1 — Карточка инцидента<br/>SBER911-2 — Фильтр по статусу<br/>SBER911-3 — Тема инцидента" in body


def test_заявка_с_несколькими_кэ_через_запятую(conf):
    _settings()
    conf["comments"] = [_comment("c1", "Сервис: rms-front, gateway; rms-front\nДата: 22.10\nКоманда: B2C\nФичи: тема\nЗадача: SBER911-9")]
    v = st.pull("Major-Check", db=None)
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert sorted(b["service"] for b in day["bookings"]) == ["gateway", "rms-front"] and all(b["task"] == "SBER911-9" for b in day["bookings"])
    assert dict(conf["replies"])["c1"] == "<p>Принято: rms-front, gateway, 22.10, B2C</p>"

    _book("2026-10-26", "SC", "gateway")
    conf["comments"] = [_comment("c2", "Сервис: x\nДата: 26.10\nКоманда: Космос")]          # команды нет — на рассмотрение
    st.pull("Major-Check", db=None)
    v = st.decide("Major-Check", "c2", st.PendingDecision(accept=True, team="B2C", service="rms-front, gateway"), db=None)
    day = next(x for x in v["days"] if x["date"] == "2026-10-26")
    assert sorted(b["service"] for b in day["bookings"] if b["team"] == "B2C") == ["gateway", "rms-front"]
    reply = dict(conf["replies"])["c2"]
    assert reply.startswith("<p>Принято: rms-front, gateway, 26.10, B2C") and "КОНФЛИКТ: gateway в этот день ставит также SC" in reply


def test_справочник_кэ_файл_создание_и_базовый_список(tmp_path, monkeypatch):
    from db import ke_store
    monkeypatch.setattr(ke_store, "KE_FILE", tmp_path / "ke_catalog.json")
    default = tmp_path / "default.json"
    monkeypatch.setattr(ke_store, "DEFAULT_FILE", default)
    default.write_text('["notify", "gateway"]', "utf-8")
    assert st.get_ke_catalog() == {"ke": ["gateway", "notify"]}                       # базовый список — при первом чтении
    assert st.add_ke(st.KeNames(ke=[" rms-front ", "NOTIFY", "Auth  service"]))["ke"] == ["Auth service", "gateway", "notify", "rms-front"]
    with pytest.raises(HTTPException):
        st.add_ke(st.KeNames(ke=["  "]))
    assert st.put_ke_catalog(st.KeNames(ke=["rms-front", "gateway"]))["ke"] == ["gateway", "rms-front"]
    assert st.get_ke_catalog()["ke"] == ["gateway", "rms-front"]                      # удалённый базовый notify не вернулся
    default.write_text('["notify", "gateway", "search"]', "utf-8")
    assert st.get_ke_catalog()["ke"] == ["gateway", "rms-front", "search"]            # новый в базовом списке — дописан


def test_нет_страницы_стенда_понятная_ошибка(conf):
    with pytest.raises(HTTPException) as e:
        st.get_stand("Major-GO", db=None)
    assert e.value.status_code == 409 and "не выбрана страница" in e.value.detail


def test_бронь_на_диапазон_одна_запись_по_рабочим_дням(conf):
    _settings()
    st.add_freeze("Major-Check", st.FreezeBody(start="2026-11-04", end="2026-11-04", reason="регресс"), db=None)
    items = [
        st.BookingBody(date="2026-10-22", dateTo="2026-10-27", team="B2C", service="rms-front", task="SBER911-1", features="Карточка"),
        st.BookingBody(date="2026-11-02", dateTo="2026-11-05", team="SC", service="gateway", task="SBER911-2"),   # 04.11 заморозка
        st.BookingBody(date="2026-10-26", team="SC", service="rms-front", task="SBER911-3"),                          # конфликт в диапазоне
    ]
    v = st.add_bookings("Major-Check", st.BulkBookings(items=items), db=None)
    assert v["added"] == 2 and v["rejected"] == [{"service": "gateway", "task": "SBER911-2", "reason": "04.11: заморозка до 04.11 (регресс)"}]
    days = {d["date"]: d for d in v["days"]}
    on = lambda iso: [(b["team"], b["service"]) for b in days[iso]["bookings"]]
    for iso in ("2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"):
        assert ("B2C", "rms-front") in on(iso)
    assert on("2026-10-24") == [] and on("2026-10-25") == [] and on("2026-10-28") == []     # выходные и после конца — пусто
    assert days["2026-10-26"]["status"] == "КОНФЛИКТ" and days["2026-10-23"]["status"] == "МОЖНО"
    stored = [b for b in conf["prop"]["bookings"] if b["task"] == "SBER911-1"]
    assert len(stored) == 1 and stored[0]["dateTo"] == "2026-10-27"                          # одна запись на весь диапазон
    assert conf["body"].count("SBER911-1 — Карточка") == 4                                    # на странице — в каждом рабочем дне
    bad = st.add_bookings("Major-Check", st.BulkBookings(items=[st.BookingBody(date="2026-10-24", dateTo="2026-10-25", team="SC", service="x")]), db=None)
    assert bad["rejected"][0]["reason"] == "в диапазоне одни выходные"


def test_кэ_сравниваются_по_коду(conf):
    from db import ke_store
    assert ke_store.ke_key("Чат [CI04663753]") == ke_store.ke_key("ci04663753") == ke_store.ke_key("Чат (4663753)") == "ci4663753"
    assert ke_store.ke_key("Чат [CI04663753]") != ke_store.ke_key("Чат [CI04510531]")          # одинаковые названия — разные КЭ
    assert ke_store.ke_key("Контроль качества релизов Sigma (Release Quality Management)").startswith("контроль")
    assert ke_store.clean(["Чат [CI04663753]", "CI04663753", "Чат [CI04510531]"]) == ["Чат [CI04510531]", "Чат [CI04663753]"]
    _settings()
    _book("2026-10-22", "B2C", "Управление приоритетными событиями [CI03521751]", task="SBER911-1")
    v = _book("2026-10-22", "SC", "Управление приоритетными событиями (3521751)", task="SBER911-2")   # так КЭ приходит из Jira
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert day["status"] == "КОНФЛИКТ"


def test_базовый_справочник_кэ_из_репозитория():
    import json
    from db import ke_store
    base = json.loads(ke_store.DEFAULT_FILE.read_text("utf-8"))
    assert len(base) == 83 and "Чат [CI04663753]" in base and "Чат [CI04510531]" in base
    assert not any("Удалить" in k for k in base)
    assert len({ke_store.ke_key(k) for k in base}) == len(base)                                       # коды уникальны


def _bulk(*items):
    return st.add_bookings("Major-Check", st.BulkBookings(items=list(items)), db=None)


def test_время_установки_конфликт_только_при_пересечении(conf):
    _settings()
    B = st.BookingBody
    v = _bulk(B(date="2026-10-22", team="B2C", service="notify", timeFrom="10:00", timeTo="12:00", task="SBER911-1"),
              B(date="2026-10-22", team="SC", service="notify", timeFrom="14:00", timeTo="16:00", task="SBER911-2"))
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    assert day["status"] == "МОЖНО" and not any(b["conflict"] for b in day["bookings"])           # разное время — не конфликт
    assert {(b["timeFrom"], b["timeTo"]) for b in day["bookings"]} == {("10:00", "12:00"), ("14:00", "16:00")}
    v = _bulk(B(date="2026-10-22", team="Агенты", service="Notify", timeFrom="11:30", timeTo="13:00", task="SBER911-3"))
    day = next(x for x in v["days"] if x["date"] == "2026-10-22")
    flags = {b["task"]: b["conflict"] for b in day["bookings"]}
    assert flags == {"SBER911-1": True, "SBER911-2": False, "SBER911-3": True}
    assert day["conflicts"] == [{"service": "notify", "teams": ["B2C", "Агенты"]}]
    v = _bulk(B(date="2026-10-23", team="B2C", service="gateway"), B(date="2026-10-23", team="SC", service="gateway", timeFrom="09:00", timeTo="10:00"))
    assert next(x for x in v["days"] if x["date"] == "2026-10-23")["status"] == "КОНФЛИКТ"        # без времени — весь день
    bad = _bulk(B(date="2026-10-26", team="SC", service="x", timeFrom="12:00", timeTo="11:00"),
                B(date="2026-10-26", team="SC", service="y", timeFrom="25:00", timeTo="26:00"))
    assert [r["reason"] for r in bad["rejected"]] == ["время окончания раньше начала", "время — ЧЧ:ММ"]
    assert "SBER911-1 — (10:00–12:00)" not in conf["body"] and "SBER911-1 (10:00–12:00)" in conf["body"]


def test_заявка_с_периодом_и_временем(conf):
    _settings()
    conf["comments"] = [_comment("c1", "Сервис: rms-front\nДата: 22.10–27.10\nВремя: 10:00-12:00\nКоманда: B2C\nЗадача: SBER911-9"),
                        _comment("c2", "Сервис: x\nДата: 22.10\nВремя: утром\nКоманда: SC")]
    v = st.pull("Major-Check", db=None)
    stored = [b for b in conf["prop"]["bookings"] if b["task"] == "SBER911-9"]
    assert len(stored) == 1 and stored[0]["dateTo"] == "2026-10-27" and stored[0]["timeFrom"] == "10:00"
    assert dict(conf["replies"])["c1"] == "<p>Принято: rms-front, 22.10 10:00 – 27.10 12:00, B2C</p>"
    assert "не понял время" in next(p["reason"] for p in v["pending"] if p["cid"] == "c2")
    assert st.parse_date_range("с 28.12 по 05.01", TODAY) == (date(2026, 12, 28), date(2027, 1, 5))
    assert st.parse_date_range("2026-10-23", TODAY) == (date(2026, 10, 23), date(2026, 10, 23))


def test_график_за_период_последние_3_месяца(conf):
    _settings()
    conf["prop"]["bookings"].append(st._new_booking(date(2026, 8, 3), "SC", "notify", "SBER911-7", "SimpleTest", "simpletest"))
    v = st.get_stand("Major-Check", start="2026-07-21", end="2026-11-13", db=None)
    assert v["range"] == {"from": "2026-07-21", "to": "2026-11-13"} and len(v["days"]) == 116
    aug = next(x for x in v["days"] if x["date"] == "2026-08-03")
    assert aug["bookings"][0]["task"] == "SBER911-7" and aug["status"] == "ПРОШЁЛ" and not aug["inWindow"]
    assert next(x for x in v["days"] if x["date"] == "2026-10-21")["inWindow"]
    assert len(st.get_stand("Major-Check", start="2026-01-01", end="2026-12-31", db=None)["days"]) == st.MAX_VIEW_DAYS
    with pytest.raises(HTTPException):
        st.get_stand("Major-Check", start="вчера", db=None)


def test_справочник_микросервисов(tmp_path, monkeypatch, conf):
    from db import ms_store
    monkeypatch.setattr(ms_store, "MS_FILE", tmp_path / "ms.json")
    monkeypatch.setattr(ms_store, "DEFAULT_FILE", tmp_path / "ms_default.json")
    assert st.add_ms(st.KeNames(ke=["rms-front", " Notify ", "notify"]))["ms"] == ["Notify", "rms-front"]
    assert st.put_ms_catalog(st.KeNames(ke=["gateway"]))["ms"] == ["gateway"]
    _settings()
    v = st.get_stand("Major-Check", db=None)
    assert v["msCatalog"] == ["gateway"] and "keCatalog" not in v
    with pytest.raises(HTTPException):
        st.add_ms(st.KeNames(ke=[" "]))


def test_базовый_справочник_микросервисов_из_репозиториев(tmp_path, monkeypatch):
    import json
    from db import ms_store
    monkeypatch.setattr(ms_store, "MS_FILE", tmp_path / "ms_catalog.json")
    base = json.loads(ms_store.DEFAULT_FILE.read_text("utf-8"))
    info = ms_store.info()
    assert len(base) == 395 and len(set(map(str.lower, base))) == len(base)
    assert "act-confirm-mcp-ms" in base and "zpi-ms" in base and "release-calendar-ms" in base
    assert info["release-calendar-ms"] == "Микросервис Календарь внедрений" and "agent_analiytics" not in info
    assert set(info) <= set(base)
    assert st.get_ms_catalog()["info"]["zpi-ms"] == "Микросервис ЗПИ."


def test_время_периода_начало_в_первый_день_конец_в_последний(conf):
    """13.11 09:00 — 17.11 18:00: стоит непрерывно, а не каждый день с 9 до 18 (решение Стефана 23.10.2026)."""
    b = {"date": "2026-11-13", "dateTo": "2026-11-17", "timeFrom": "09:00", "timeTo": "18:00"}
    assert st.interval(b, date(2026, 11, 13)) == (540, st.DAY_MIN)
    assert st.interval(b, date(2026, 11, 16)) == (0, st.DAY_MIN)
    assert st.interval(b, date(2026, 11, 17)) == (0, 1080)
    # В период конец может быть «раньше» начала по часам — это другой день.
    assert st.check_times("18:00", "09:00", single=False) is None
    assert st.check_times("18:00", "09:00") == "время окончания раньше начала"
    # Можно только начало или только конец.
    assert st.check_times("09:00", "") is None and st.check_times("", "18:00") is None
    assert st.parse_time_range("с 9:00") == ("09:00", "") and st.parse_time_range("до 18.00") == ("", "18:00")
    assert st.time_label({**b}) == "13.11 09:00 – 17.11 18:00"
    assert st.time_label({"date": "2026-11-13", "timeFrom": "09:00"}) == "с 09:00"

    _settings()
    B = st.BookingBody
    # Другая команда ставит тот же сервис 17.11 в 19:00 — после конца периода: не конфликт; в 10:00 — конфликт.
    v = _bulk(B(date="2026-10-22", dateTo="2026-10-26", team="B2C", service="notify", timeFrom="18:00", timeTo="09:00"),
              B(date="2026-10-26", team="SC", service="notify", timeFrom="10:00", timeTo="11:00"),
              B(date="2026-10-22", team="Агенты", service="notify", timeFrom="10:00", timeTo="12:00"))
    assert not v["rejected"]
    flags = {(b["team"], d["date"]): b["conflict"] for d in v["days"] for b in d["bookings"]}
    assert flags[("Агенты", "2026-10-22")] is False      # в первый день B2C ставит с 18:00
    assert flags[("SC", "2026-10-26")] is False          # в последний день B2C стоит до 09:00
    assert flags[("B2C", "2026-10-23")] is False


def test_правка_брони_дни_время_и_правила_только_для_новых_дней(conf):
    _settings()
    B = st.BookingBody
    v = _bulk(B(date="2026-10-22", team="B2C", service="notify", task="SBER911-1", features="Фича"))
    bid = next(b for d in v["days"] for b in d["bookings"])["id"]
    v = st.edit_booking("Major-Check", bid, B(date="2026-10-22", dateTo="2026-10-26", timeFrom="10:00", team="SC",
                                              service="gateway", task="sber911-2", features="Новая"), db=None)
    got = next(b for d in v["days"] for b in d["bookings"] if b["id"] == bid)
    assert (got["team"], got["service"], got["task"], got["dateTo"], got["timeFrom"]) == ("SC", "gateway", "SBER911-2", "2026-10-26", "10:00")
    assert sum(1 for d in v["days"] for b in d["bookings"] if b["id"] == bid) == 3     # 22, 23, 26 (выходные пропущены)
    with pytest.raises(HTTPException) as e:
        st.edit_booking("Major-Check", bid, B(date="2026-10-22", dateTo="2026-10-21", team="SC", service="x"), db=None)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        st.edit_booking("Major-Check", "нет-такой", B(date="2026-10-22", team="SC", service="x"), db=None)
    assert e.value.status_code == 404
    for bad in (B(date="2026-10-24", dateTo="2026-10-25", team="SC", service="x"),      # одни выходные
                B(date="2026-10-22", dateTo="2026-12-31", team="SC", service="x")):     # дольше двух месяцев
        with pytest.raises(HTTPException) as e:
            st.edit_booking("Major-Check", bid, bad, db=None)
        assert e.value.status_code == 422


def test_график_на_странице_сплошные_полосы_цвет_группы_и_конфликт(conf):
    from backend.ms_color import ms_hex
    _settings()
    _bulk(st.BookingBody(date="2026-10-23", dateTo="2026-10-26", timeFrom="09:00", timeTo="18:00", team="B2C", service="work-group-ms"),
          st.BookingBody(date="2026-10-26", timeFrom="10:00", timeTo="12:00", team="SC", service="work-group-ms"))
    chart = conf["body"].split("<h2>График</h2>")[1].split("<h2>По дням</h2>")[0]
    b2c = chart.split("<strong>B2C</strong>")[1].split("</tr>")[0]
    colour = ms_hex("work-group-ms")
    # 23.10 (пт) с 09:00, выходные 24–25 закрашены, 26.10 до 18:00 — конфликт с SC (красный «!»)
    assert b2c.count(f'data-highlight-colour="{colour}"') == 3 and ">09:00<" in b2c
    assert 'data-highlight-colour="#ffbdad">! до 18:00<' in b2c
    assert "<strong>SC</strong>" in chart and "<th>Команда</th><th>Микросервис</th>" in chart
