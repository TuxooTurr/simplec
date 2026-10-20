"""Confluence для «Графика стендов»: разбор ссылки на страницу, вход по маркеру, проверка чтения и записи."""

import pytest
from fastapi import HTTPException

import backend.api.confluence as c

CFG = {"base_url": "https://confluence.example", "token": "t", "token_path": "", "ssl_verify": False, "space": "~qa"}


@pytest.fixture
def conf(monkeypatch):
    """Подставной Confluence: routes[(метод, путь)] = ответ, функция(тело) или HTTPException; calls — что спрашивали."""
    state = {"routes": {}, "calls": []}
    monkeypatch.setattr(c, "_load_cfg", lambda db: CFG)

    def req(cfg, method, path, params=None, json_body=None, files=None, timeout=30):
        state["calls"].append((method, path, json_body))
        r = state["routes"].get((method, path), HTTPException(404, "Confluence: not found"))
        if isinstance(r, Exception):
            raise r
        return r(json_body) if callable(r) else r

    monkeypatch.setattr(c, "_request", req)
    return state


def test_ссылка_на_страницу_id_или_название():
    assert c.page_ref("https://confluence.example/pages/viewpage.action?pageId=123456") == ("id", "123456")
    assert c.page_ref("https://confluence.example/spaces/QA/pages/987/График") == ("id", "987")
    assert c.page_ref(" 555 ") == ("id", "555")
    assert c.page_ref("График стендов") == ("title", "График стендов")


def test_аноним_вместо_пользователя_значит_маркер_не_принят(conf):
    conf["routes"][("GET", "/rest/api/user/current")] = {"type": "anonymous"}
    with pytest.raises(HTTPException) as e:
        c.test_connection(db=None)
    assert e.value.status_code == 401


def test_проверка_чтения_страница_по_названию_и_свойства(conf):
    conf["routes"][("GET", "/rest/api/user/current")] = {"username": "ivanov", "displayName": "Иванов"}
    conf["routes"][("GET", "/rest/api/space/~qa")] = {"name": "Личное", "type": "personal"}
    conf["routes"][("GET", "/rest/api/content")] = {"results": [{"id": "42", "version": {"number": 3}}]}
    conf["routes"][("GET", "/rest/api/content/42/property")] = {"results": []}
    conf["routes"][("GET", "/rest/api/content/42/child/attachment")] = HTTPException(403, "Confluence: нет прав")
    rep = c.probe(page="График", db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["whoami"]["note"] == "Иванов (ivanov)" and by["page"]["note"] == "найдено: 1"
    assert by["properties"]["ok"] and not by["attachments"]["ok"] and by["attachments"]["status"] == 403
    assert rep["ok"] == 4 and rep["total"] == 5


def test_проверка_чтения_без_страницы_пропускает_зависимые(conf):
    conf["routes"][("GET", "/rest/api/user/current")] = {"username": "ivanov"}
    rep = c.probe(space="", db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["properties"]["skipped"] and by["attachments"]["skipped"]
    assert by["properties"]["reason"] == "страница не указана"
    assert by["space"]["path"] == "/rest/api/space/~qa"          # пространство из настроек


def test_проверка_записи_на_тестовой_странице_и_отказ_на_старой_версии(conf):
    prop = "/rest/api/content/77/property/" + c.PROBE_PROPERTY
    stored = {}
    conf["routes"][("POST", "/rest/api/content")] = lambda b: {"id": "77", "version": {"number": 1}}
    conf["routes"][("POST", "/rest/api/content/77/property")] = lambda b: stored.update(b) or {"version": {"number": 1}}
    conf["routes"][("GET", prop)] = lambda b: {"value": stored["value"], "version": {"number": 1}}
    seen = []

    def put_prop(b):     # вторая запись с той же версией — отказ, как у настоящего Confluence
        if b["version"]["number"] in seen:
            raise HTTPException(409, "Confluence: Version must be incremented")
        seen.append(b["version"]["number"])
        return {"version": b["version"]}
    conf["routes"][("PUT", prop)] = put_prop
    conf["routes"][("PUT", "/rest/api/content/77")] = lambda b: {"version": b["version"]}
    conf["routes"][("POST", "/rest/api/content/77/child/attachment")] = {"results": [{"id": "a1"}]}
    rep = c.probe_write(c.ProbeWriteBody(space="~qa", parent="https://x/pages/viewpage.action?pageId=10"), db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert all(r["ok"] for r in rep["results"]), rep["results"]
    assert by["prop-read"]["note"] == "значение совпало"
    assert by["prop-conflict"]["status"] == 409 and by["prop-conflict"]["note"] == "отказ, как и должно быть"
    created = conf["calls"][0][2]
    assert created["space"] == {"key": "~qa"} and created["ancestors"] == [{"id": "10"}]
    assert rep["page"] == "https://confluence.example/pages/viewpage.action?pageId=77"
    assert not any(m in ("PUT", "DELETE") and p == "/rest/api/content/10" for m, p, _ in conf["calls"])   # родителя не трогаем


def test_запись_прошла_там_где_ждали_отказ_это_провал(conf):
    conf["routes"][("POST", "/rest/api/content")] = {"id": "77", "version": {"number": 1}}
    conf["routes"][("POST", "/rest/api/content/77/property")] = {"version": {"number": 1}}
    conf["routes"][("GET", "/rest/api/content/77/property/" + c.PROBE_PROPERTY)] = {"value": {}, "version": {"number": 1}}
    conf["routes"][("PUT", "/rest/api/content/77/property/" + c.PROBE_PROPERTY)] = lambda b: {"version": b["version"]}
    rep = c.probe_write(c.ProbeWriteBody(space="~qa"), db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert not by["prop-conflict"]["ok"] and "ожидали отказ" in by["prop-conflict"]["error"]
