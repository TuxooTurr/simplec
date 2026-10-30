"""Трекинг AQA: ссылки, коммиты Bitbucket, запуски Allure TestOps, роадмап эпиков. Реальных серверов нет — _http подменяется."""

from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

import backend.api.aqa_tracking as Q
import backend.api.jira_tool as JT


def ms(days_ago: float = 0, hours: int = 12) -> int:
    d = datetime.now().replace(hour=hours, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
    return int(d.timestamp() * 1000)


def test_ссылки_разбираются():
    assert Q.parse_bitbucket("https://stash.sigma.sbrf.ru/projects/SBER911/repos/sber911-aqa/browse") == \
        {"base_url": "https://stash.sigma.sbrf.ru", "project": "SBER911", "repo": "sber911-aqa"}
    assert Q.parse_bitbucket("https://stash.x/ctx/projects/P/repos/r?at=refs") == {"base_url": "https://stash.x/ctx", "project": "P", "repo": "r"}
    assert Q.parse_bitbucket("https://stash.x/users/me") is None
    assert Q.parse_testops("https://testops.sigma.sbrf.ru/project/2414/test-cases") == \
        {"base_url": "https://testops.sigma.sbrf.ru", "project_id": 2414}
    assert Q.parse_testops("https://testops.x/launch/5") is None


BB = {"base_url": "https://stash.test", "project": "SBER911", "repo": "aqa", "token": "T", "ssl_verify": True}


def test_коммиты_сегодня_неделя_всего_по_страницам(monkeypatch):
    pages = {
        0: {"values": [{"id": "a" * 40, "displayId": "aaaaaaa", "message": "Тест входа\nподробно", "committerTimestamp": ms(0),
                        "author": {"displayName": "Иванов"}},
                       {"id": "b", "committerTimestamp": ms(3)}], "isLastPage": False, "nextPageStart": 2},
        2: {"values": [{"id": "c", "committerTimestamp": ms(6, 1)}, {"id": "d", "committerTimestamp": ms(10)}], "isLastPage": True},
    }
    calls = []

    def http(name, method, url, verify, **kw):
        calls.append(kw["params"]["start"])
        assert url == "https://stash.test/rest/api/1.0/projects/SBER911/repos/aqa/commits" and kw["token"] == "T"
        return pages[kw["params"]["start"]]
    monkeypatch.setattr(Q, "_http", http)
    r = Q.bb_commits(BB)
    assert (r["today"], r["week"], r["total"]) == (1, 3, 4) and calls == [0, 2]
    assert r["last"]["id"] == "aaaaaaa" and r["last"]["message"] == "Тест входа" and r["last"]["author"] == "Иванов"


TO = {"base_url": "https://testops.test", "project_id": 2414, "token": "API", "ssl_verify": True}


def test_testops_запуски_сегодня_и_последний(monkeypatch):
    Q._jwt.clear()
    launches = [{"id": 3, "name": "Регресс", "createdDate": ms(0, 15), "closed": True},
                {"id": 2, "name": "Смоук", "createdDate": ms(0, 9)},
                {"id": 1, "name": "Вчера", "createdDate": ms(1)}]
    stats = {3: [{"status": "passed", "count": 10}, {"status": "failed", "count": 2}],
             2: [{"status": "passed", "count": 5}, {"status": "broken", "count": 1}], 1: []}

    def http(name, method, url, verify, **kw):
        if url.endswith("/api/uaa/oauth/token"):
            assert kw["data"] == {"grant_type": "apitoken", "scope": "openid", "token": "API"}
            return {"access_token": "JWT", "expires_in": 3600}
        assert kw["token"] == "JWT"
        if url.endswith("/api/rs/launch"):
            assert kw["params"]["projectId"] == 2414
            return {"content": launches}
        return stats[int(url.split("/")[-2])]
    monkeypatch.setattr(Q, "_http", http)
    r = Q.testops_launches(TO)
    assert r["todayLaunches"] == 2
    assert r["todayStats"] == {"passed": 15, "failed": 2, "broken": 1}
    assert r["last"]["name"] == "Регресс" and r["last"]["stats"] == {"passed": 10, "failed": 2}
    assert r["last"]["url"] == "https://testops.test/launch/3" and [x["id"] for x in r["recent"]] == [3, 2, 1]


def test_testops_без_токена_понятная_ошибка(monkeypatch):
    Q._jwt.clear()
    monkeypatch.setattr(Q, "_http", lambda *a, **kw: {})
    with pytest.raises(HTTPException) as e:
        Q.testops_launches(TO)
    assert "API-токен" in e.value.detail


def _raw(key, itype="История", status="В работе", cat="indeterminate", created="2026-10-01T10:00:00.000+0300",
         due=None, resolved=None, assignee="Петров", links=None, epic=None):
    f = {"summary": f"Задача {key}", "issuetype": {"name": itype}, "status": {"name": status, "statusCategory": {"key": cat}},
         "assignee": {"displayName": assignee} if assignee else None, "created": created, "duedate": due,
         "resolutiondate": resolved, "issuelinks": links or []}
    if epic:
        f["customfield_10006"] = epic
    return {"key": key, "fields": f}


def test_роадмап_эпики_задачи_и_связанные_дефекты(monkeypatch):
    epics = [_raw("SBER911-1", "Эпик", links=[{"outwardIssue": {"key": "SBER911-9"}}]), _raw("SBER911-2", "Эпик")]
    children = [_raw("SBER911-11", epic="SBER911-1", due="2026-10-20"),
                _raw("SBER911-12", "Дефект", "Закрыт", "done", resolved="2026-10-05T12:00:00.000+0300", epic="SBER911-1"),
                _raw("SBER911-21", epic="SBER911-2", created="2026-09-01T10:00:00.000+0300")]
    jqls = []

    def search(cfg, jql, limit=0, fields=""):
        jqls.append(jql)
        return (epics, 2) if jql.startswith("key in") else (children, 3)
    monkeypatch.setattr(JT, "_search", search)
    monkeypatch.setattr(JT, "catalog", lambda db=None: {"epic_link": "customfield_10006"})
    monkeypatch.setattr(JT, "_by_keys", lambda cfg, keys: [_raw("SBER911-9", "Дефект", "Открыт", "new")])
    monkeypatch.setattr(Q.jira_defects, "_load_cfg", lambda db: {"base_url": "https://jira.test"})
    r = Q.roadmap(None, ["SBER911-1", "SBER911-2", "SBER911-404"])
    assert jqls[1].startswith("cf[10006] in (SBER911-1, SBER911-2)")
    e1, e2, e3 = r["epics"]
    assert [i["key"] for i in e1["issues"]] == ["SBER911-11", "SBER911-12", "SBER911-9"]
    d = e1["issues"][1]
    assert d["defect"] and d["statusCategory"] == "done" and d["resolved"] == "2026-10-05" and d["created"] == "2026-10-01"
    assert e1["issues"][0]["due"] == "2026-10-20" and e1["issues"][0]["assignee"] == "Петров"
    assert [i["key"] for i in e2["issues"]] == ["SBER911-21"]
    assert e3 == {"key": "SBER911-404", "missing": True, "summary": "", "issues": []}


class FakeDb:
    def __init__(self):
        self.kv = {}

    def commit(self):
        pass


def test_настройки_проверяют_ссылки_и_эпики(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(Q, "_get", lambda d, k, default="": d.kv.get(k, default))
    monkeypatch.setattr(Q, "_set", lambda d, k, v, desc="": d.kv.__setitem__(k, v))
    monkeypatch.setattr(Q, "_ssl_verify", lambda d: True)
    with pytest.raises(HTTPException):
        Q.put_settings(Q.SettingsBody(bitbucketUrl="https://stash.x/users/me"), db=db)
    with pytest.raises(HTTPException):
        Q.put_settings(Q.SettingsBody(epics=["не эпик"]), db=db)
    r = Q.put_settings(Q.SettingsBody(
        bitbucketUrl="https://stash.x/projects/P/repos/r/browse", testopsUrl="https://to.x/project/7/test-cases",
        testopsToken="secret", epics=["sber911-1", "https://jira.x/browse/SBER911-2", "SBER911-1"]), db=db)
    assert r["epics"] == ["SBER911-1", "SBER911-2"] and r["testopsToken"] == Q._MASK and r["bitbucketOk"] and r["testopsOk"]
    Q.put_settings(Q.SettingsBody(bitbucketUrl="https://stash.x/projects/P/repos/r/browse", testopsToken=Q._MASK, epics=[]), db=db)
    assert db.kv[Q.K_TO_TOKEN] == "secret"                       # маска — прежний токен остался


def test_ссылки_по_умолчанию_и_их_можно_убрать(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(Q, "_get", lambda d, k, default="": d.kv.get(k, default))
    monkeypatch.setattr(Q, "_set", lambda d, k, v, desc="": d.kv.__setitem__(k, v))
    monkeypatch.setattr(Q, "_ssl_verify", lambda d: True)
    r = Q.get_settings(db=db)                                    # ничего не сохраняли — ссылки по умолчанию
    assert r["bitbucketUrl"] == Q.DEFAULT_BB_URL and r["bitbucketOk"]
    assert r["testopsUrl"] == Q.DEFAULT_TO_URL and r["testopsOk"]
    assert Q.bb_cfg(db)["repo"] == "sber911-aqa" and Q.to_cfg(db)["project_id"] == 2414
    r = Q.put_settings(Q.SettingsBody(bitbucketUrl="", testopsUrl=""), db=db)
    assert r["bitbucketUrl"] == "" and not r["bitbucketOk"] and r["testopsUrl"] == "" and not r["testopsOk"]
    assert Q.bb_cfg(db)["base_url"] == ""                        # стёртая ссылка не возвращается сама


def test_коммиты_ветки_по_дням_последние_и_авторы(monkeypatch):
    seen = {}

    def http(name, method, url, verify, **kw):
        seen.update(kw["params"])
        return {"values": [
            {"id": "a", "displayId": "aaa", "message": "Сегодня", "committerTimestamp": ms(0), "author": {"displayName": "Иванов"}},
            {"id": "b", "committerTimestamp": ms(1), "author": {"name": "petrov"}},
            {"id": "c", "committerTimestamp": ms(1, 9), "author": {"displayName": "Иванов"}},
            {"id": "d", "committerTimestamp": ms(20)},
        ], "isLastPage": True}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.bb_commits(BB, "feature/login")
    assert seen["until"] == "refs/heads/feature/login"
    assert (r["today"], r["week"], r["total"]) == (1, 3, 4) and r["branch"] == "feature/login"
    assert len(r["daily"]) == Q.DAILY_DAYS and [d["count"] for d in r["daily"]][-2:] == [2, 1]
    assert r["daily"][-1]["date"] == datetime.now().date().isoformat()
    assert [c["id"] for c in r["recent"]] == ["aaa", "b", "c", "d"] and r["last"]["id"] == "aaa"
    assert r["authors"] == [{"name": "Иванов", "count": 2}, {"name": "petrov", "count": 1}]
    assert r["repoUrl"].endswith("/browse?at=refs/heads/feature/login")
    Q.bb_commits(BB, "")
    assert "until" not in seen or seen.get("until") == "refs/heads/feature/login"   # без ветки until не передаётся


def test_ветки_репозитория_и_ветка_по_умолчанию(monkeypatch):
    calls = []

    def http(name, method, url, verify, **kw):
        calls.append((url, kw.get("params")))
        return {"values": [{"displayId": "develop"}, {"displayId": "master", "isDefault": True}], "isLastPage": False}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.bb_branches(BB, " feat ")
    assert r == {"branches": [{"name": "develop", "default": False}, {"name": "master", "default": True}], "default": "master", "more": True}
    assert calls[0][0].endswith("/repos/aqa/branches") and calls[0][1]["filterText"] == "feat"


def _testops_http(launches, stats, extra=None):
    def http(name, method, url, verify, **kw):
        if url.endswith("/api/uaa/oauth/token"):
            return {"access_token": "JWT", "expires_in": 3600}
        if url.endswith("/api/rs/launch"):
            return {"content": launches}
        for suffix, value in (extra or {}).items():
            if url.endswith(suffix):
                return value(kw) if callable(value) else value
        return stats[int(url.split("/")[-2])]
    return http


def test_testops_последние_запуски_со_статистикой_без_повторных_запросов(monkeypatch):
    Q._jwt.clear()
    launches = [{"id": i, "name": f"Запуск {i}", "createdDate": ms(16 - i)} for i in range(15, 0, -1)]
    calls = []
    stats = {i: [{"status": "passed", "count": i}] for i in range(1, 16)}
    http = _testops_http(launches, stats)

    def counting(name, method, url, verify, **kw):
        calls.append(url)
        return http(name, method, url, verify, **kw)
    monkeypatch.setattr(Q, "_http", counting)
    r = Q.testops_launches(TO)
    assert len(r["recent"]) == Q.RECENT_LAUNCHES and r["recent"][0]["id"] == 15 and r["last"] == r["recent"][0]
    assert r["recent"][0]["stats"] == {"passed": 15}
    stat_calls = [c for c in calls if c.endswith("/statistic")]
    assert len(stat_calls) == len(set(stat_calls)) == Q.RECENT_LAUNCHES


def test_testops_запуск_подробно_упавшие_сверху(monkeypatch):
    Q._jwt.clear()
    pages = {0: {"content": [{"id": 1, "name": "Вход", "status": "PASSED", "duration": 1200, "start": 1000, "stop": 2200, "testCaseId": 77},
                             {"id": 2, "name": "Оплата", "status": "failed", "start": 1500, "stop": 5000, "message": "AssertionError"}],
                 "totalPages": 2},
             1: {"content": [{"id": 3, "name": "Выход", "status": "broken"}], "totalPages": 2}}
    http = _testops_http([], {9: [{"status": "passed", "count": 1}, {"status": "failed", "count": 1}, {"status": "broken", "count": 1}]}, {
        "/api/rs/launch/9": {"id": 9, "name": "Регресс", "createdDate": ms(0), "closed": True, "createdBy": "ci",
                             "tags": [{"name": "nightly"}]},
        "/api/rs/launch/9/env": [{"name": "stand", "value": "ift"}],
        "/api/rs/testresult": lambda kw: pages[kw["params"]["page"]],
    })
    monkeypatch.setattr(Q, "_http", http)
    r = Q.testops_launch(TO, 9)
    assert r["name"] == "Регресс" and r["tags"] == ["nightly"] and r["env"] == ["stand: ift"] and r["createdBy"] == "ci"
    assert [t["name"] for t in r["results"]] == ["Оплата", "Выход", "Вход"]
    assert r["results"][0]["duration"] == 3500 and r["results"][0]["message"] == "AssertionError"
    assert r["results"][2]["url"] == "https://testops.test/project/2414/test-cases/77" and r["results"][2]["status"] == "passed"
    assert r["duration"] == 4000 and r["resultsTotal"] == 3 and not r["resultsPartial"]


def test_плановые_поля_находятся_по_названию():
    fields = [{"id": "customfield_1", "name": "Плановое начало", "kind": "date"},
              {"id": "customfield_2", "name": "Плановое окончание", "kind": "date"},
              {"id": "customfield_3", "name": "Плановое начало работ (текст)", "kind": "text"},
              {"id": "duedate", "name": "Срок", "kind": "date"}]
    r = Q.plan_fields(fields)
    assert [c["id"] for c in r["start"]] == ["customfield_1", "customfield_3"]
    assert r["end"] == [{"id": "customfield_2", "name": "Плановое окончание"}]
    assert Q.plan_fields([{"id": "cf9", "name": "Target end", "kind": "date"}]) == {"start": [], "end": [{"id": "cf9", "name": "Target end"}]}
    assert Q.plan_fields([]) == {"start": [], "end": []}


def test_плановые_поля_сокращения_и_скобки():
    names = {"План. начало": "start", "Начало (план)": "start", "Дата начала (план)": "start", "Плановая дата начала": "start",
             "План. окончание": "end", "Окончание (план)": "end", "Плановая дата завершения": "end", "Planned finish": "end",
             "Начало работ": None, "Дата окончания": None, "Начало планирования": None, "Окончание планирования": None}
    for name, want in names.items():
        r = Q.plan_fields([{"id": "cf", "name": name, "kind": "date"}])
        got = "start" if r["start"] else "end" if r["end"] else None
        assert got == want, name


def test_роадмап_одноимённые_поля_берётся_заполненное(monkeypatch):
    """В большой Jira два поля «Плановое начало»: первое по порядку у задач пустое, заполнено второе."""
    epic = _raw("SBER911-1", "Эпик")
    a = _raw("SBER911-11", epic="SBER911-1")
    a["fields"].update({"customfield_7": "2026-10-05", "customfield_8": "20.10.2026"})       # окончание — текстом
    b = _raw("SBER911-12", epic="SBER911-1")
    b["fields"].update({"customfield_7": "2026-10-07T10:00:00.000+0300", "customfield_8": None})
    monkeypatch.setattr(JT, "_search", lambda cfg, jql, limit=0, fields="": ([epic], 1) if jql.startswith("key in") else ([a, b], 2))
    monkeypatch.setattr(JT, "catalog", lambda db=None: {"epic_link": "customfield_10006", "fields": [
        {"id": "customfield_1", "name": "Плановое начало", "kind": "date"},
        {"id": "customfield_7", "name": "Плановое начало", "kind": "date"},
        {"id": "customfield_8", "name": "Плановое окончание", "kind": "text"}]})
    monkeypatch.setattr(JT, "_by_keys", lambda cfg, keys: [])
    monkeypatch.setattr(Q.jira_defects, "_load_cfg", lambda db: {"base_url": "https://jira.test"})
    r = Q.roadmap(None, ["SBER911-1"])
    i1, i2 = r["epics"][0]["issues"]
    assert (i1["planStart"], i1["planEnd"]) == ("2026-10-05", "2026-10-20")
    assert (i2["planStart"], i2["planEnd"]) == ("2026-10-07", "")
    pf = r["planFields"]
    assert pf["start"]["id"] == "customfield_7" and pf["end"]["id"] == "customfield_8"
    assert pf["filled"] == {"start": 2, "end": 1} and pf["total"] == 2


def test_роадмап_плановые_даты_и_фактическое_закрытие(monkeypatch):
    epic = _raw("SBER911-1", "Эпик")
    a = _raw("SBER911-11", "Задача", "Закрыт", "done", resolved="2026-10-12T10:00:00.000+0300", epic="SBER911-1")
    a["fields"].update({"customfield_1": "2026-10-01", "customfield_2": "2026-10-10"})
    b = _raw("SBER911-12", "Задача", "Готово", "done", epic="SBER911-1")        # резолюцию не ставят
    b["fields"].update({"customfield_1": "2026-09-20", "statuscategorychangedate": "2026-10-03T09:00:00.000+0300"})
    c = _raw("SBER911-13", epic="SBER911-1")
    c["fields"]["statuscategorychangedate"] = "2026-10-02T09:00:00.000+0300"    # в работе — не закрытие
    asked = []

    def search(cfg, jql, limit=0, fields=""):
        asked.append(fields)
        return ([epic], 1) if jql.startswith("key in") else ([a, b, c], 3)
    monkeypatch.setattr(JT, "_search", search)
    monkeypatch.setattr(JT, "catalog", lambda db=None: {"epic_link": "customfield_10006", "fields": [
        {"id": "customfield_1", "name": "Плановое начало", "kind": "date"},
        {"id": "customfield_2", "name": "Плановое окончание", "kind": "date"}]})
    monkeypatch.setattr(JT, "_by_keys", lambda cfg, keys: [])
    monkeypatch.setattr(Q.jira_defects, "_load_cfg", lambda db: {"base_url": "https://jira.test"})
    r = Q.roadmap(None, ["SBER911-1"])
    assert "customfield_1" in asked[0] and "customfield_2" in asked[1] and "statuscategorychangedate" in asked[1]
    assert r["planFields"]["start"]["name"] == "Плановое начало"
    by = {i["key"]: i for i in r["epics"][0]["issues"]}
    assert [i["key"] for i in r["epics"][0]["issues"]] == ["SBER911-12", "SBER911-11", "SBER911-13"]   # по плановому началу
    assert (by["SBER911-11"]["planStart"], by["SBER911-11"]["planEnd"], by["SBER911-11"]["closed"]) == ("2026-10-01", "2026-10-10", "2026-10-12")
    assert by["SBER911-12"]["closed"] == "2026-10-03" and by["SBER911-12"]["planEnd"] == ""
    assert by["SBER911-13"]["closed"] == ""


def test_коммит_подробно_файлы_строки_и_свод(monkeypatch):
    calls = []

    def http(name, method, url, verify, **kw):
        calls.append((url, kw.get("params")))
        if url.endswith("/changes"):
            return {"values": [
                {"path": {"toString": "src/Login.java"}, "type": "MODIFY"},
                {"path": {"toString": "src/New.java"}, "type": "ADD"},
                {"path": {"toString": "old.yml"}, "type": "DELETE"},
                {"path": {"toString": "docs/b.md"}, "srcPath": {"toString": "docs/a.md"}, "type": "MOVE"},
                {"path": {"toString": "logo.png"}, "type": "ADD"},
            ], "isLastPage": True}
        if url.endswith("/diff"):
            return {"diffs": [
                {"destination": {"toString": "src/Login.java"}, "hunks": [{"segments": [
                    {"type": "REMOVED", "lines": [{}, {}]}, {"type": "ADDED", "lines": [{}, {}, {}]}, {"type": "CONTEXT", "lines": [{}]}]}]},
                {"destination": {"toString": "src/New.java"}, "hunks": [{"segments": [{"type": "ADDED", "lines": [{}] * 10}]}]},
                {"source": {"toString": "old.yml"}, "hunks": [{"segments": [{"type": "REMOVED", "lines": [{}] * 4}]}], "truncated": True},
                {"destination": {"toString": "logo.png"}, "binary": True},
            ]}
        return {"id": "abcdef1234567890", "displayId": "abcdef1", "message": "Вход\n\nподробно", "authorTimestamp": ms(0),
                "author": {"displayName": "Иванов", "emailAddress": "i@x"}, "parents": [{"id": "p1"}, {"id": "p2"}]}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.bb_commit(BB, "abcdef1234567890")
    assert calls[2][1]["contextLines"] == 0
    assert r["hash"] == "abcdef1234567890" and r["message"] == "Вход\n\nподробно" and r["merge"] and r["email"] == "i@x"
    assert [f["path"] for f in r["files"]][:3] == ["src/New.java", "src/Login.java", "old.yml"]
    login = next(f for f in r["files"] if f["path"] == "src/Login.java")
    assert (login["added"], login["removed"], login["type"]) == (3, 2, "modified")
    assert next(f for f in r["files"] if f["path"] == "docs/b.md")["from"] == "docs/a.md"
    assert next(f for f in r["files"] if f["path"] == "logo.png")["binary"]
    assert r["totals"] == {"files": 5, "added": 13, "removed": 6,
                           "byType": {"added": 2, "modified": 1, "deleted": 1, "moved": 1}}
    assert r["byExt"][0] == {"ext": "java", "files": 2, "added": 13, "removed": 2} and r["truncated"]


def test_роадмап_снимок_сохраняется_и_выручает_без_jira(monkeypatch, tmp_path):
    monkeypatch.setattr(Q, "SNAPSHOT_FILE", tmp_path / "aqa_roadmap.json")
    monkeypatch.setattr(Q, "_epics", lambda db: ["SBER911-1"])
    monkeypatch.setattr(Q, "_cache", {})
    monkeypatch.setattr(Q, "roadmap", lambda db, epics: {"epics": [{"key": "SBER911-1", "issues": []}], "planFields": {}})
    r = Q.roadmap_route(db=None)
    assert "snapshot" not in r and Q.load_snapshot()["keys"] == ["SBER911-1"]

    def down(db, epics):
        raise HTTPException(502, "Jira недоступна")
    monkeypatch.setattr(Q, "roadmap", down)
    r = Q.roadmap_route(refresh=True, db=None)
    assert r["epics"][0]["key"] == "SBER911-1" and r["snapshot"]["reason"] == "Jira недоступна" and "keys" not in r
    monkeypatch.setattr(Q, "_epics", lambda db: ["SBER911-2"])           # другие эпики — снимок не подходит
    with pytest.raises(HTTPException):
        Q.roadmap_route(refresh=True, db=None)


def test_снимок_роадмапа_в_разделе_трекинг_aqa_резервной_копии():
    import backend.api.backup as bk
    assert bk.FILE_SECTION["aqa_roadmap.json"] == "aqa" and Q.SNAPSHOT_FILE.name == "aqa_roadmap.json"


def test_файл_коммита_было_стало_рядом(monkeypatch):
    seen = {}

    def http(name, method, url, verify, **kw):
        seen["url"], seen["params"] = url, kw["params"]
        line = lambda s, d, t: {"source": s, "destination": d, "line": t}
        return {"diffs": [{"hunks": [{"segments": [
            {"type": "CONTEXT", "lines": [line(10, 10, "class A {")]},
            {"type": "REMOVED", "lines": [line(11, None, "  int a = 1;"), line(12, None, "  int b = 2;")]},
            {"type": "ADDED", "lines": [line(None, 11, "  int a = 10;")]},
            {"type": "CONTEXT", "lines": [line(13, 12, "}")]},
            {"type": "ADDED", "lines": [line(None, 13, "// конец")]},
        ]}]}]}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.bb_file_diff(BB, "abcdef1", "src/my dir/A.java", "src/old/A.java")
    assert seen["url"].endswith("/commits/abcdef1/diff/src/my%20dir/A.java")
    assert seen["params"]["srcPath"] == "src/old/A.java" and seen["params"]["contextLines"] == Q.DIFF_CONTEXT
    rows = r["hunks"][0]
    assert rows[0]["l"]["text"] == rows[0]["r"]["text"] == "class A {"
    assert (rows[1]["l"]["text"], rows[1]["r"]["text"]) == ("  int a = 1;", "  int a = 10;")       # пара было / стало
    assert rows[2]["l"]["n"] == 12 and rows[2]["r"] is None                                        # удалённая без пары
    assert rows[3]["l"]["type"] == "context" and rows[4] == {"l": None, "r": {"n": 13, "text": "// конец", "type": "added"}}
    assert not r["binary"] and not r["truncated"]
    monkeypatch.setattr(Q, "MAX_DIFF_ROWS", 2)
    assert Q.bb_file_diff(BB, "abcdef1", "A.java")["truncated"]
