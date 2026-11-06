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
    assert r["epics"] == Q.PINNED_EPICS + ["SBER911-1", "SBER911-2"] and r["testopsToken"] == Q._MASK and r["bitbucketOk"] and r["testopsOk"]
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


# ── Управление задачами эпика ────────────────────────────────────────────────

PLAN = {"start": [{"id": "cf_a", "name": "Плановое начало"}, {"id": "cf_b", "name": "Плановое начало"}],
        "end": [{"id": "cf_e", "name": "Плановое окончание"}]}
META = {"summary": {"schema": {"type": "string"}}, "description": {"schema": {"type": "string"}},
        "priority": {"schema": {"type": "priority"}, "allowedValues": [{"id": "3", "name": "Высокий"}]},
        "cf_b": {"schema": {"type": "date"}}, "cf_e": {"schema": {"type": "datetime"}}}


def test_плановая_дата_пишется_в_поле_с_экрана_редактирования():
    # cf_a подошло по названию, но его нет на экране — значит, пишем в cf_b.
    assert Q.plan_target(PLAN["start"], META)["id"] == "cf_b"
    # Дата уже стоит в одном из одноимённых полей — обновляем именно его.
    both = {**META, "cf_a": {"schema": {"type": "date"}}}
    assert Q.plan_target(PLAN["start"], both, {"cf_b": "2026-11-01"})["id"] == "cf_b"
    assert Q.plan_target(PLAN["start"], both)["id"] == "cf_a"
    # Нет на экране или тип не дата — писать некуда.
    assert Q.plan_target(PLAN["start"], {}) is None
    assert Q.plan_target(PLAN["start"], {"cf_a": {"schema": {"type": "option"}}}) is None


def test_значение_плановой_даты_по_типу_поля():
    assert Q.plan_payload({"type": "date"}, "2026-11-20") == "2026-11-20"
    assert Q.plan_payload({"type": "datetime"}, "2026-11-20") == "2026-11-20T12:00:00.000+0000"
    assert Q.plan_payload({"type": "string"}, "2026-11-20") == "20.11.2026"
    assert Q._plan_day(Q.plan_payload({"type": "string"}, "2026-11-20")) == "2026-11-20"
    assert Q.plan_payload({"type": "date"}, "") is None


def _jira(monkeypatch, cur=None, fail_assignee=False):
    """Подмена Jira: чтение задачи и editmeta, запись — в calls."""
    calls = []

    def req(cfg, method, path, json_body=None, params=None, **kw):
        if method == "GET":
            return {"fields": META} if path.endswith("/editmeta") else {"key": "SBER911-1", "fields": cur or {}}
        calls.append((path, json_body))
        if fail_assignee and path.endswith("/assignee"):
            raise HTTPException(400, "Jira: нельзя назначить")
        return {}
    monkeypatch.setattr(Q.jira_defects, "_jira_request", req)
    monkeypatch.setattr(Q.jira_defects, "_load_cfg", lambda db: {"base_url": "https://jira.test"})
    monkeypatch.setattr(JT, "catalog", lambda **kw: {"fields": [
        {"id": "cf_a", "name": "Плановое начало", "kind": "date"}, {"id": "cf_b", "name": "Плановое начало", "kind": "date"},
        {"id": "cf_e", "name": "Плановое окончание", "kind": "datetime"}]})
    return calls


def test_в_jira_уходит_только_изменённое(monkeypatch):
    calls = _jira(monkeypatch)
    r = Q.update_issue(None, "SBER911-1", Q.IssueChange(summary=" Новое ", planEnd="2026-12-01", assignee="ivanov"))
    assert r == {"status": "ok", "warnings": []}
    assert calls == [("/rest/api/2/issue/SBER911-1", {"fields": {"summary": "Новое", "cf_e": "2026-12-01T12:00:00.000+0000"}}),
                     ("/rest/api/2/issue/SBER911-1/assignee", {"name": "ivanov"})]


def test_очистка_исполнителя_и_даты(monkeypatch):
    calls = _jira(monkeypatch, {"cf_b": "2026-11-01"})
    Q.update_issue(None, "SBER911-1", Q.IssueChange(planStart="", assignee=""))
    assert calls == [("/rest/api/2/issue/SBER911-1", {"fields": {"cf_b": None}}),
                     ("/rest/api/2/issue/SBER911-1/assignee", {"name": None})]


def test_начало_позже_окончания_не_уходит_в_jira(monkeypatch):
    calls = _jira(monkeypatch, {"cf_e": "2026-11-10"})
    with pytest.raises(HTTPException) as e:                    # сравниваем и с уже стоящей в задаче датой
        Q.update_issue(None, "SBER911-1", Q.IssueChange(planStart="2026-11-20"))
    assert e.value.status_code == 422 and calls == []
    with pytest.raises(HTTPException):
        Q.update_issue(None, "SBER911-1", Q.IssueChange(planStart="20.11.2026"))
    with pytest.raises(HTTPException):
        Q.update_issue(None, "SBER911-1", Q.IssueChange(summary="   "))
    assert calls == []


def test_незаписанное_не_теряется_молча(monkeypatch):
    calls = _jira(monkeypatch, fail_assignee=True)
    monkeypatch.setattr(JT, "catalog", lambda **kw: {"fields": [{"id": "cf_x", "name": "Плановое начало", "kind": "date"}]})
    r = Q.update_issue(None, "SBER911-1", Q.IssueChange(summary="Т", planStart="2026-11-20", assignee="ivanov"))
    assert calls[0] == ("/rest/api/2/issue/SBER911-1", {"fields": {"summary": "Т"}})   # поля записаны
    assert len(r["warnings"]) == 2 and "Плановое начало" in r["warnings"][0] and "нельзя назначить" in r["warnings"][1]


def test_задача_для_окна_правки(monkeypatch):
    _jira(monkeypatch, {"summary": "С", "description": "h1. Текст", "assignee": {"name": "ivanov", "displayName": "Иванов"},
                        "priority": {"id": "3", "name": "Высокий"}, "cf_b": "2026-11-01"})
    d = Q.issue_details(None, "SBER911-1")
    assert d["description"] == "h1. Текст" and d["assigneeLogin"] == "ivanov" and d["priorityId"] == "3"
    assert d["priorities"] == [{"id": "3", "name": "Высокий"}] and d["planStart"] == "2026-11-01"
    assert d["editable"] == {"summary": True, "description": True, "priority": True,
                             "planStart": "Плановое начало", "planEnd": "Плановое окончание"}


def test_номер_задачи_проверяется():
    assert Q._issue_key(" sber911-12 ") == "SBER911-12"
    with pytest.raises(HTTPException):
        Q._issue_key("SBER911-1/../../admin")


# ── Запуск автотестов (Jenkins) ──────────────────────────────────────────────

JK = {"base_url": "https://ci.test", "job_path": "/job/AQA/job/AQA_TEST", "job": "AQA_TEST", "url": "u", "user": "qa", "token": "T", "ssl_verify": True}
JOB = {"name": "AQA_TEST", "displayName": "AQA_TEST", "url": "https://ci.test/job/AQA/job/AQA_TEST/", "buildable": True,
       "property": [{}, {"parameterDefinitions": [
           {"name": "STAND", "type": "ChoiceParameterDefinition", "choices": ["IFT", "PSI"], "defaultParameterValue": {"value": "PSI"}, "description": "Стенд"},
           {"name": "SMOKE", "type": "BooleanParameterDefinition", "defaultParameterValue": {"value": True}},
           {"name": "TAGS", "type": "StringParameterDefinition", "defaultParameterValue": {"value": "@regress"}},
           {"name": "NOTE", "type": "TextParameterDefinition"},
           {"name": "PASS", "type": "PasswordParameterDefinition", "defaultParameterValue": {"value": "{зашифровано}"}},
           {"name": "BRANCH", "type": "PT_BRANCH", "allValueItems": {"values": [{"name": "main", "value": "main"}, {"name": "dev", "value": "dev"}]}},
       ]}],
       "builds": [{"number": 7, "url": "https://ci.test/7/", "building": True, "timestamp": 0, "duration": 0},
                  {"number": 6, "url": "https://ci.test/6/", "result": "FAILURE", "building": False, "timestamp": 0, "duration": 1000}]}


def test_ссылка_на_джоб_разбирается():
    url = "https://sber911-ci.ci.jenkins.sberbank.ru/job/sber911-ci/job/sber911-backend/job/AQA/job/AQA_TEST/"
    assert Q.parse_jenkins(url) == {"base_url": "https://sber911-ci.ci.jenkins.sberbank.ru",
                                    "job_path": "/job/sber911-ci/job/sber911-backend/job/AQA/job/AQA_TEST", "job": "AQA_TEST"}
    assert Q.parse_jenkins("https://ci.test/view/all/") is None


def test_форма_строится_из_описания_джоба(monkeypatch):
    monkeypatch.setattr(Q, "_http", lambda *a, **k: JOB)
    r = Q.jenkins_job(JK)
    p = {x["name"]: x for x in r["params"]}
    assert (p["STAND"]["kind"], p["STAND"]["default"], p["STAND"]["choices"]) == ("choice", "PSI", ["IFT", "PSI"])
    assert (p["SMOKE"]["kind"], p["SMOKE"]["default"]) == ("boolean", True)
    assert (p["TAGS"]["kind"], p["TAGS"]["default"]) == ("string", "@regress")
    assert p["NOTE"]["kind"] == "multiline" and p["BRANCH"]["choices"] == ["main", "dev"]
    assert (p["PASS"]["kind"], p["PASS"]["default"]) == ("password", "")      # пароль наружу не отдаём
    assert [b["result"] for b in r["builds"]] == ["RUNNING", "FAILURE"]


def test_параметры_из_actions_и_без_дублей():
    d = {"actions": [{"parameterDefinitions": [{"name": "A", "type": "StringParameterDefinition"}]}],
         "property": [{"parameterDefinitions": [{"name": "A", "type": "StringParameterDefinition"}]}]}
    assert [p["name"] for p in Q.jk_params(d)] == ["A"]


def test_запуск_уходит_с_параметрами_и_даёт_номер_в_очереди(monkeypatch):
    sent = {}

    def http(name, method, url, verify, **kw):
        if method == "GET":
            return JOB
        sent.update(url=url, data=kw["data"], auth=kw["auth"])
        return type("R", (), {"headers": {"Location": "https://ci.test/queue/item/4242/"}})()
    monkeypatch.setattr(Q, "_http", http)
    r = Q.jenkins_run(JK, {"STAND": "IFT", "SMOKE": False, "PASS": ""})
    assert r == {"status": "queued", "queueId": 4242}
    assert sent["url"] == "https://ci.test/job/AQA/job/AQA_TEST/buildWithParameters" and sent["auth"] == ("qa", "T")
    assert sent["data"] == {"STAND": "IFT", "SMOKE": "false"}                 # пустой пароль не перетирает умолчание


def test_джоб_без_параметров_запускается_через_build(monkeypatch):
    urls = []

    def http(name, method, url, verify, **kw):
        if method == "GET":
            return {"builds": []}
        urls.append(url)
        return type("R", (), {"headers": {}})()
    monkeypatch.setattr(Q, "_http", http)
    assert Q.jenkins_run(JK, {})["queueId"] is None and urls == ["https://ci.test/job/AQA/job/AQA_TEST/build"]


def test_устаревший_параметр_не_уходит(monkeypatch):
    calls = []

    def http(name, method, url, verify, **kw):
        calls.append(method)
        return JOB
    monkeypatch.setattr(Q, "_http", http)
    with pytest.raises(HTTPException) as e:
        Q.jenkins_run(JK, {"OLD": "1"})
    assert e.value.status_code == 422 and "OLD" in e.value.detail and calls == ["GET"]


def test_ссылка_на_папку_объясняется(monkeypatch):
    monkeypatch.setattr(Q, "_http", lambda *a, **k: {"jobs": [{"name": "main"}, {"name": "dev"}]})
    with pytest.raises(HTTPException) as e:
        Q.jenkins_job(JK)
    assert "папку" in e.value.detail and "main, dev" in e.value.detail


@pytest.mark.parametrize("answer,want", [
    ({"why": "Ждёт агента"}, {"state": "queued", "why": "Ждёт агента"}),
    ({"executable": {"number": 8, "url": "https://ci.test/8/"}}, {"state": "started", "number": 8, "url": "https://ci.test/8/"}),
    ({"cancelled": True}, {"state": "cancelled"}),
])
def test_что_с_запуском_в_очереди(monkeypatch, answer, want):
    monkeypatch.setattr(Q, "_http", lambda *a, **k: answer)
    assert Q.jenkins_queue(JK, 1) == want


def test_очередь_забыла_запуск(monkeypatch):
    def gone(*a, **k):
        raise HTTPException(404, "нет")
    monkeypatch.setattr(Q, "_http", gone)
    assert Q.jenkins_queue(JK, 1) == {"state": "gone"}


# ── Закреплённые эпики ───────────────────────────────────────────────────────

def _settings_db(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(Q, "_get", lambda d, k, default="": d.kv.get(k, default))
    monkeypatch.setattr(Q, "_set", lambda d, k, v, desc="": d.kv.__setitem__(k, v))
    monkeypatch.setattr(Q, "_ssl_verify", lambda d: True)
    return db


def test_закреплённые_эпики_есть_всегда_и_первыми(monkeypatch):
    db = _settings_db(monkeypatch)
    want = ["SBER911-29998", "SBER911-30133", "SBER911-30135"]
    assert Q.get_settings(db=db)["epics"] == want and Q.get_settings(db=db)["pinnedEpics"] == want
    assert Q.put_settings(Q.SettingsBody(bitbucketUrl="", testopsUrl="", epics=[]), db=db)["epics"] == want      # убрать нельзя
    r = Q.put_settings(Q.SettingsBody(bitbucketUrl="", testopsUrl="", epics=["SBER911-1", want[1]]), db=db)
    assert r["epics"] == want + ["SBER911-1"]                                       # без дублей, порядок прежний


def test_закреплённые_не_отнимают_места_у_своих_эпиков(monkeypatch):
    db = _settings_db(monkeypatch)
    own = [f"SBER911-{i}" for i in range(1, 6)]
    assert Q.put_settings(Q.SettingsBody(bitbucketUrl="", testopsUrl="", epics=own + Q.PINNED_EPICS), db=db)["epics"] == Q.PINNED_EPICS + own
    with pytest.raises(HTTPException):
        Q.put_settings(Q.SettingsBody(bitbucketUrl="", testopsUrl="", epics=own + ["SBER911-6"]), db=db)


# ── Результат кейса TestOps ──────────────────────────────────────────────────

NESTED = {"attachments": [{"id": 9, "name": "лог", "contentType": "text/plain"}], "steps": [
    {"name": "Вход", "status": "passed", "start": 1000, "stop": 3000},
    {"name": "POST /incident", "status": "failed", "steps": [
        {"name": "Запрос", "status": "passed", "attachments": [{"id": 1, "name": "Request", "contentType": "application/json"}]},
        {"name": "Проверка кода", "status": "failed", "message": "ожидали 200, получили 500"},
    ]},
    {"name": "Выход", "status": "skipped"},
]}
FLAT = {"root": {"children": [1]}, "scenarioSteps": {"1": {"body": "Шаг", "status": "broken", "children": [2]},
                                                     "2": {"body": "Вложение", "attachmentId": 5}},
        "attachments": {"5": {"id": 5, "name": "Response", "contentType": "text/html"}}}


def test_шаги_вложенным_деревом_и_упавший_шаг():
    steps, top = Q.parse_steps(NESTED)
    assert [a["name"] for a in top] == ["лог"] and steps[0]["duration"] == 2000
    assert Q.mark_failed(steps)["name"] == "Проверка кода"                # самый глубокий, а не родитель
    assert steps[1]["steps"][1]["failed"] and not steps[1]["failed"] and not steps[2]["failed"]
    assert steps[1]["steps"][0]["attachments"][0] == {"id": 1, "name": "Request", "type": "application/json", "size": 0}


def test_шаги_плоским_словарём():
    steps, _ = Q.parse_steps(FLAT)
    assert steps[0]["name"] == "Шаг" and steps[0]["steps"][0]["attachments"][0]["name"] == "Response"
    assert Q.mark_failed(steps)["name"] == "Шаг"                          # детей с ошибкой нет — упал сам шаг


def test_шаги_без_ошибки_и_мусор_в_ответе():
    assert Q.mark_failed(Q.parse_steps([{"name": "А", "status": "passed"}])[0]) is None
    assert Q.parse_steps("не то")[0] == [] and Q.parse_steps({"steps": ["не шаг"]})[0] == []


def test_результат_кейса_и_запасной_адрес_шагов(monkeypatch):
    monkeypatch.setattr(Q, "_testops_jwt", lambda cfg: "J")
    seen = []

    def http(name, method, url, verify, **kw):
        seen.append(url.rsplit("/", 1)[-1])
        if url.endswith("/execution"):
            raise HTTPException(404, "нет")
        if url.endswith("/scenario"):
            return NESTED
        if url.endswith("/attachment"):
            return {"content": []}
        return {"id": 7, "name": "Кейс", "status": "failed", "description": "Описание", "message": "упал", "trace": "at x",
                "testCaseId": 3, "labels": [{"name": "epic", "value": "Инциденты"}, {"name": "story", "value": "Создание"}, {"name": "host", "value": "h"}]}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.testops_result(TO, 7)
    assert r["description"] == "Описание" and r["failedStep"] == "Проверка кода" and r["stepsSource"] == "scenario" and r["stepsNote"] == ""
    assert r["behavior"] == {"epic": "Инциденты", "story": "Создание"} and r["url"].endswith("/project/2414/test-cases/3")
    assert [a["name"] for a in r["attachments"]] == ["лог"]               # вложения из шагов наверху не дублируются


def test_шаги_не_получены_это_видно(monkeypatch):
    monkeypatch.setattr(Q, "_testops_jwt", lambda cfg: "J")

    def http(name, method, url, verify, **kw):
        if url.endswith(("/execution", "/scenario", "/attachment")):
            raise HTTPException(404, "Allure TestOps: не найдено")
        return {"id": 7, "status": "failed"}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.testops_result(TO, 7)
    assert r["steps"] == [] and "не отдал шаги" in r["stepsNote"] and r["stepsSource"] == ""


def test_вложение_текстом_и_файлом(monkeypatch):
    monkeypatch.setattr(Q, "_testops_jwt", lambda cfg: "J")
    resp = lambda t, c: type("R", (), {"headers": {"Content-Type": c}, "text": t})()
    monkeypatch.setattr(Q, "_http", lambda *a, **k: resp('{"a":1}', "application/json; charset=utf-8"))
    assert Q.testops_attachment(TO, 1) == {"contentType": "application/json", "binary": False, "text": '{"a":1}', "truncated": False}
    monkeypatch.setattr(Q, "_http", lambda *a, **k: resp("x" * (Q.MAX_ATTACHMENT + 1), "text/plain"))
    r = Q.testops_attachment(TO, 1)
    assert r["truncated"] and len(r["text"]) == Q.MAX_ATTACHMENT
    monkeypatch.setattr(Q, "_http", lambda *a, **k: resp("png", "image/png"))
    assert Q.testops_attachment(TO, 1)["binary"]


def test_поведение_из_меток_и_полей_testops():
    assert Q.behavior_of({"labels": [{"name": "Epic", "value": "Э"}, {"name": "feature", "value": "Ф"}]}) == {"epic": "Э", "feature": "Ф"}
    assert Q.behavior_of({"customFields": [{"customField": {"name": "Story"}, "name": "С"}]}) == {"story": "С"}
    assert Q.behavior_of({}) == {}


def test_поведения_поштучно_сбой_одного_не_мешает(monkeypatch):
    monkeypatch.setattr(Q, "_testops_jwt", lambda cfg: "J")
    Q._cache.clear()

    def http(name, method, url, verify, **kw):
        if url.endswith("/2"):
            raise HTTPException(500, "сбой")
        return {"labels": [{"name": "epic", "value": "Э"}]}
    monkeypatch.setattr(Q, "_http", http)
    r = Q.testops_behaviors(TO, [1, 2])
    assert r == {"behaviors": {"1": {"epic": "Э"}, "2": {}}, "partial": False}
    Q._cache.clear()
