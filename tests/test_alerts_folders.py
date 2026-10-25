"""Папки алертов: создаёт и удаляет только суперюзер, алерты удалённой папки остаются «Без папки»."""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import backend.api.alerts as A
from db import alerts_store as store_mod
from db.alerts_store import AlertsStore


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_SCRIPTS_FILE", tmp_path / "alert_scripts.json")
    monkeypatch.setattr(store_mod, "_FOLDERS_FILE", tmp_path / "alert_folders.json")
    role = {"v": "superuser"}
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = {"login": "t", "role": role["v"]}
        return await call_next(request)

    app.include_router(A.router)
    return TestClient(app), role


def test_суперюзер_создаёт_и_удаляет_папку_алерты_остаются(client):
    c, _ = client
    fld = c.post("/api/alerts/folders", json={"name": "  PKAP  "}).json()
    assert fld["name"] == "PKAP" and fld["id"].startswith("fld-")
    AlertsStore.save_script({"id": "s1", "name": "ЗНО", "folder_id": fld["id"], "created_at": "t"})

    assert c.delete(f"/api/alerts/folders/{fld['id']}").status_code == 200
    assert AlertsStore.get_folders() == []
    assert AlertsStore.get_scripts()[0]["folder_id"] is None
    assert c.delete(f"/api/alerts/folders/{fld['id']}").status_code == 404


def test_пустое_название_не_принимается(client):
    c, _ = client
    assert c.post("/api/alerts/folders", json={"name": "   "}).status_code == 422
    assert AlertsStore.get_folders() == []


def test_мониторинг_не_меняет_папки(client):
    c, role = client
    fld = c.post("/api/alerts/folders", json={"name": "PKAP"}).json()
    role["v"] = "monitoring"
    assert c.post("/api/alerts/folders", json={"name": "Чужая"}).status_code == 403
    assert c.post("/api/alerts/folders", json={"id": fld["id"], "name": "Другое"}).status_code == 403
    assert c.delete(f"/api/alerts/folders/{fld['id']}").status_code == 403
    assert [f["name"] for f in AlertsStore.get_folders()] == ["PKAP"]
