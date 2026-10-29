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
             2: [{"status": "passed", "count": 5}, {"status": "broken", "count": 1}]}

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
    assert r["last"]["url"] == "https://testops.test/launch/3"


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
