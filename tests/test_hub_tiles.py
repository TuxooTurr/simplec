"""Оформление плиток «Генераторов событий»: хранение, проверка значений, права."""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import backend.api.hub_tiles as HT
from db import hub_tiles_store as store_mod


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_FILE", tmp_path / "hub_tiles.json")
    role = {"value": "superuser"}
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = {"login": "t", "role": role["value"]}
        return await call_next(request)

    app.include_router(HT.router)
    c = TestClient(app)
    c.role = role
    return c


def test_сохраняется_только_изменённое(client):
    r = client.put("/api/hub/tiles/jobs", json={"title": " Задачи ", "subtitle": "", "icon": "lucide:Rocket", "color": "rose"})
    assert r.status_code == 200 and r.json() == {"title": "Задачи", "icon": "lucide:Rocket", "color": "rose"}
    client.put("/api/hub/tiles/alerts:fld-1a2b3c4d", json={"icon": "emoji:🚀"})
    assert client.get("/api/hub/tiles").json() == {
        "jobs": {"title": "Задачи", "icon": "lucide:Rocket", "color": "rose"},
        "alerts:fld-1a2b3c4d": {"icon": "emoji:🚀"},
    }


def test_сброс_к_стандартному(client):
    client.put("/api/hub/tiles/metrics", json={"title": "Метрики"})
    assert client.delete("/api/hub/tiles/metrics").status_code == 200
    assert client.get("/api/hub/tiles").json() == {}
    client.put("/api/hub/tiles/tks", json={"title": "x"})
    client.put("/api/hub/tiles/tks", json={"title": ""})          # всё пусто — запись удаляется
    assert client.get("/api/hub/tiles").json() == {}


@pytest.mark.parametrize("body", [
    {"icon": "lucide:rocket"}, {"icon": "<svg onload=x>"}, {"icon": "emoji:"},
    {"color": "red; background:url(x)"}, {"title": "x" * 81},
])
def test_плохие_значения_отклоняются(client, body):
    assert client.put("/api/hub/tiles/jobs", json=body).status_code == 422


def test_плохой_ключ(client):
    assert client.put("/api/hub/tiles/..%2Fetc", json={"title": "x"}).status_code in (404, 422)
    assert client.put("/api/hub/tiles/a b", json={"title": "x"}).status_code == 422


def test_менять_может_только_суперюзер(client):
    client.role["value"] = "monitoring"
    assert client.put("/api/hub/tiles/jobs", json={"title": "x"}).status_code == 403
    assert client.delete("/api/hub/tiles/jobs").status_code == 403
    assert client.get("/api/hub/tiles").status_code == 200
