"""Вход в SimpleTest логином Jira: пароль проверяет Jira, маркеры — свои остаются, чужие и истёкшие выпускаются заново."""

import pytest
from fastapi import HTTPException

import backend.api.aqa_tracking as AQ
import backend.api.auth as A
import backend.api.confluence as C
import backend.api.jira_defects as J


class FakeDb:
    def rollback(self): pass
    def commit(self): pass


@pytest.fixture
def env(monkeypatch):
    st = {"jira": {"base_url": "https://jira.test", "token": "", "token_path": ""},
          "conf": {"base_url": "https://conf.test", "token": "", "token_path": ""},
          "bb": {"base_url": "", "token": "", "token_path": "", "ssl_verify": True},
          "password": "secret", "jira_owner": "", "conf_owner": "", "bb_owner": "", "issued": [], "down": False, "captcha": False}

    def jira_req(cfg, method, path, auth=None, timeout=30, **kw):
        if st["down"]:
            raise HTTPException(502, "Jira недоступна (https://jira.test): timeout")
        assert path == "/rest/api/2/myself"
        if auth is not None:
            if st["captcha"]:
                raise HTTPException(403, "Jira: нет прав на операцию (403)")
            if auth[1] != st["password"]:
                raise HTTPException(401, "Jira: токен недействителен или истёк — обновите его в настройках")
            return {"name": auth[0], "displayName": "Иванов Иван"}
        if not st["jira_owner"]:
            raise HTTPException(401, "истёк")
        return {"name": st["jira_owner"]}

    def conf_whoami(cfg):
        if not st["conf_owner"]:
            raise HTTPException(401, "аноним")
        return {"name": st["conf_owner"], "user": ""}

    def jira_issue(body, db):
        st["issued"].append("jira"); st["jira"]["token"] = "PAT"; st["jira_owner"] = body.login

    def conf_issue(body, db):
        st["issued"].append("confluence"); st["conf"]["token"] = "PAT"; st["conf_owner"] = body.login

    monkeypatch.setattr(J, "_load_cfg", lambda db: st["jira"])
    monkeypatch.setattr(C, "_load_cfg", lambda db: st["conf"])
    monkeypatch.setattr(J, "_jira_request", jira_req)
    monkeypatch.setattr(C, "_whoami", conf_whoami)
    monkeypatch.setattr(J, "token_from_login", jira_issue)
    monkeypatch.setattr(C, "token_from_login", conf_issue)
    def bb_issue(body, db):
        st["issued"].append("bitbucket"); st["bb"]["token"] = "PAT"; st["bb_owner"] = body.login

    monkeypatch.setattr(AQ, "bb_cfg", lambda db: st["bb"])
    monkeypatch.setattr(AQ, "bb_whoami", lambda cfg: st["bb_owner"])
    monkeypatch.setattr(AQ, "token_from_login", bb_issue)
    monkeypatch.setattr(A, "_sessions", {})
    return st


def login(user, password):
    return A.login(A.LoginRequest(login=user, password=password), db=FakeDb())


def test_первый_вход_выпускает_токены(env):
    r = login("ivanov", "secret")
    assert r["source"] == "jira" and r["role"] == "superuser" and r["display_name"] == "Иванов Иван"
    assert r["tokens"] == {"jira": {"state": "new"}, "confluence": {"state": "new"}}
    assert env["issued"] == ["jira", "confluence"] and r["token"] in A._sessions


def test_повторный_вход_оставляет_свои_токены(env):
    login("ivanov", "secret")
    env["issued"].clear()
    r = login("IVANOV", "secret")                       # регистр логина не важен
    assert r["tokens"] == {"jira": {"state": "reused"}, "confluence": {"state": "reused"}} and env["issued"] == []


def test_чужой_токен_заменяется(env):
    login("petrov", "secret")
    env["issued"].clear()
    r = login("ivanov", "secret")
    assert r["tokens"]["jira"]["state"] == "new" and env["jira_owner"] == "ivanov"


def test_неверный_пароль_и_капча(env):
    with pytest.raises(HTTPException) as e:
        login("ivanov", "wrong")
    assert e.value.status_code == 401 and "логин или пароль Jira" in e.value.detail
    env["captcha"] = True
    with pytest.raises(HTTPException) as e:
        login("ivanov", "secret")
    assert e.value.status_code == 403 and "капчу" in e.value.detail
    assert env["issued"] == [] and A._sessions == {}


def test_jira_недоступна_но_универсальная_учётка_работает(env):
    env["down"] = True
    with pytest.raises(HTTPException) as e:
        login("ivanov", "secret")
    assert e.value.status_code == 503 and "универсальной" in e.value.detail
    r = login("Sber911", "1234567")
    assert r["source"] == "local" and "tokens" not in r
    with pytest.raises(HTTPException):
        login("Sber911", "secret")                       # неверный пароль универсальной — в Jira не уходит


def test_нет_адреса_confluence_вход_не_ломает(env):
    env["conf"]["base_url"] = ""
    r = login("ivanov", "secret")
    assert r["tokens"]["jira"]["state"] == "new" and r["tokens"]["confluence"]["state"] == "error"


def test_мониторинга_больше_нет():
    assert set(A.USERS) == {"Sber911"}


def test_bitbucket_только_если_подключён_во_вкладке(env):
    r = login("ivanov", "secret")
    assert "bitbucket" not in r["tokens"]                 # вкладка «Трекинг AQA» Bitbucket не подключала
    env["bb"]["base_url"] = "https://stash.test"
    r = login("ivanov", "secret")
    assert r["tokens"]["bitbucket"] == {"state": "new"} and env["bb_owner"] == "ivanov"
    r = login("ivanov", "secret")
    assert r["tokens"]["bitbucket"] == {"state": "reused"}
