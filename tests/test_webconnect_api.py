"""API веб-коннекторов и анализатора логов (браузер подменён, данные — во временной папке)."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.api.webconnect as W
import webconnect.store as store_mod

SEARCH_BODY = json.dumps({"query": {"match": {"service": "pay-api"}},
                          "range": {"gte": "2026-10-10T11:50:00.000Z", "lte": "2026-10-10T12:00:00.000Z"}})
LOGS = "\n".join(json.dumps({"@timestamp": f"2026-10-10T11:5{i}:00Z", "level": "ERROR",
                             "message": f"pay-api: timeout {i}"}) for i in range(5))

RECORDING = {
    "connector_id": None,
    "started_at": "2026-10-10T11:59:00+00:00",
    "steps": [{"type": "fill", "selector": "#service", "value": "pay-api", "secret": False}],
    "responses": [
        {"id": 0, "kind": "response", "t": 30, "method": "POST", "url": "https://kibana.x/api/search",
         "status": 200, "content_type": "application/json", "request_headers": {"kbn-xsrf": "true", "cookie": "sid=1"},
         "post_data": SEARCH_BODY, "size": 10, "likeness": 90,
         "body": json.dumps({"hits": {"hits": [{"_source": json.loads(l)} for l in LOGS.splitlines()]}})},
        {"id": 1, "kind": "download", "t": 40, "method": "GET", "url": "blob:https://kibana.x/123",
         "filename": "logs.txt", "status": 200, "content_type": "text/plain", "request_headers": {},
         "post_data": None, "size": 10, "likeness": 90, "body": LOGS},
    ],
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_CONNECTORS_FILE", tmp_path / "web_connectors.json")
    monkeypatch.setattr(store_mod, "_SERVICES_FILE", tmp_path / "log_services.json")
    monkeypatch.setattr(store_mod, "_RECORDINGS_DIR", tmp_path / "rec")
    runs = []

    async def fake_run(window, op, values, minutes):
        runs.append((op["id"], values, minutes))
        return {"service": next(iter(values.values()), ""), "values": values, "minutes": minutes, "source": "x",
                "output": op.get("output", "logs"), "lines": 5, "events": 5, "errors": 5,
                "groups": [], "sample": [], "seconds": 0.1}

    monkeypatch.setattr(W, "run_operation", fake_run)
    monkeypatch.setenv("SIMPLETEST_SECRET_KEY", "Zq0kQ7ZvYx2o3gTt9t2q0mQ1o3fJ2s8b7b2b0b3b4b4=")
    app = FastAPI()
    app.include_router(W.router)
    c = TestClient(app)
    c.runs = runs
    return c


def _connector(client):
    return client.post("/api/webconnect/connectors", json={"name": "Kibana ИФТ", "base_url": "https://kibana.x"}).json()


def test_коннектор_создаётся_и_виден(client):
    c = _connector(client)
    data = client.get("/api/webconnect").json()
    assert data["connectors"][0]["id"] == c["id"] and data["connectors"][0]["window"]["open"] is False


def test_адрес_проверяется(client):
    assert client.post("/api/webconnect/connectors", json={"name": "x", "base_url": "kibana"}).status_code == 422


def test_черновик_из_выгрузки_находит_запрос_источник(client):
    c = _connector(client)
    store_mod.WebStore.save_recording(c["id"], {**RECORDING, "connector_id": c["id"]})
    d = client.post(f"/api/webconnect/connectors/{c['id']}/draft", json={"response_id": 1, "service_value": "pay-api"}).json()
    tpl = d["template"]
    assert "logs.txt" in d["note"] and tpl["method"] == "POST"
    assert "{service}" in tpl["body"] and "{from_iso}" in tpl["body"]
    assert tpl["headers"] == {"kbn-xsrf": "true"}


def test_один_источник_анализатора_и_запуск_по_имени_сервиса(client):
    c = _connector(client)
    store_mod.WebStore.save_recording(c["id"], {**RECORDING, "connector_id": c["id"]})
    tpl = client.post(f"/api/webconnect/connectors/{c['id']}/draft", json={"response_id": 0, "service_value": "pay-api"}).json()["template"]
    first = client.post("/api/webconnect/scenarios", json={"connector_id": c["id"], "name": "A", "template": tpl, "log_source": True}).json()
    second = client.post("/api/webconnect/scenarios", json={"connector_id": c["id"], "name": "B", "template": tpl, "log_source": True}).json()
    sources = [s for s in client.get("/api/webconnect").json()["scenarios"] if s["log_source"]]
    assert [s["id"] for s in sources] == [second["id"]]           # источник — один, последний отмеченный

    res = client.post("/api/log-analyzer/run", json={"service": "notify", "minutes": 15}).json()
    assert res["scenario"]["name"] == "B" and client.runs == [(second["id"], {"service": "notify"}, 15)]
    assert first["id"] != second["id"]


def test_без_источника_понятная_ошибка(client):
    r = client.post("/api/log-analyzer/run", json={"service": "x", "minutes": 10})
    assert r.status_code == 422 and "Веб-коннекторы" in r.json()["detail"]["message"]


def test_сохранённые_сервисы(client):
    client.post("/api/log-analyzer/services", json={"name": "pay-api"})
    client.post("/api/log-analyzer/services", json={"name": "auth-api", "note": "вход"})
    client.post("/api/log-analyzer/services", json={"name": "pay-api"})        # повтор не дублирует
    names = [s["name"] for s in client.get("/api/log-analyzer").json()["services"]]
    assert names == ["auth-api", "pay-api"]
    assert [s["name"] for s in client.delete("/api/log-analyzer/services/pay-api").json()["services"]] == ["auth-api"]



# ── Операции общего вида ─────────────────────────────────────────────────────

STEPS = [
    {"type": "goto", "url": "https://portal.x/login"},
    {"type": "fill", "selector": "#u", "value": "tech_user", "secret": False},
    {"type": "fill", "selector": "#p", "value": "", "secret": True},
    {"type": "click", "selector": "#go", "text": "Войти"},
    {"type": "goto", "url": "https://portal.x/tickets"},
    {"type": "fill", "selector": "#ticket", "value": "INC0001543210", "secret": False},
    {"type": "press", "selector": "#ticket", "key": "Enter"},
    {"type": "goto", "url": "https://portal.x/tickets/INC0001543210"},
]


def test_операция_шаги_с_именованным_параметром(client):
    c = _connector(client)
    store_mod.WebStore.save_recording(c["id"], {**RECORDING, "connector_id": c["id"], "steps": STEPS})
    d = client.post(f"/api/webconnect/connectors/{c['id']}/draft", json={
        "mode": "steps", "params": [{"name": "incident", "label": "Номер инцидента", "value": "INC0001543210"}]}).json()
    tpl = d["template"]
    assert d["start_index"] == 4                                   # шаги входа пропущены
    assert tpl["start_url"] == "https://portal.x/tickets"
    assert tpl["steps"] == [{"type": "fill", "selector": "#ticket", "value": "{incident}"},
                            {"type": "press", "selector": "#ticket", "key": "Enter"}]
    saved = client.post("/api/webconnect/scenarios", json={
        "connector_id": c["id"], "name": "Статус инцидента", "template": tpl, "output": "text",
        "params": [{"name": "incident", "label": "Номер инцидента", "default": "INC0001543210"}]}).json()
    assert saved["kind"] == "steps" and saved["window"] is False
    client.post(f"/api/webconnect/scenarios/{saved['id']}/run", json={"values": {"incident": "INC42"}})
    client.post(f"/api/webconnect/scenarios/{saved['id']}/run", json={"values": {}})     # пусто → по умолчанию
    assert [r[1] for r in client.runs] == [{"incident": "INC42"}, {"incident": "INC0001543210"}]


def test_неверное_имя_параметра(client):
    c = _connector(client)
    store_mod.WebStore.save_recording(c["id"], {**RECORDING, "connector_id": c["id"]})
    r = client.post(f"/api/webconnect/connectors/{c['id']}/draft",
                    json={"response_id": 0, "params": [{"name": "Номер", "value": "x"}]})
    assert r.status_code == 422


def test_пароль_хранится_зашифрованным_и_не_отдаётся(client):
    c = client.post("/api/webconnect/connectors", json={"name": "Портал", "base_url": "https://portal.x",
                                                        "auth_mode": "password", "login": "tech_user",
                                                        "password": "S3cret!"}).json()
    assert c["auth"]["has_password"] is True and "password_enc" not in c["auth"]
    raw = store_mod.WebStore.connector(c["id"])["auth"]["password_enc"]
    assert raw and "S3cret" not in raw
    from webconnect.secrets import decrypt
    assert decrypt(raw) == "S3cret!"
    # пустой пароль при сохранении — оставить прежний
    again = client.post("/api/webconnect/connectors", json={"id": c["id"], "name": "Портал",
                                                            "base_url": "https://portal.x", "auth_mode": "password",
                                                            "login": "tech_user"}).json()
    assert again["auth"]["has_password"] is True
    # переход на ручной вход — пароль удаляется
    manual = client.post("/api/webconnect/connectors", json={"id": c["id"], "name": "Портал",
                                                             "base_url": "https://portal.x", "auth_mode": "manual"}).json()
    assert manual["auth"]["has_password"] is False
