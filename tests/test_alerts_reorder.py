"""Порядок скриптов алертов: перетаскивание внутри папки, общий для всех."""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import backend.api.alerts as A
from db import alerts_store as store_mod
from db.alerts_store import AlertsStore


@pytest.fixture
def scripts_file(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_SCRIPTS_FILE", tmp_path / "alert_scripts.json")
    for sid, folder in [("a", None), ("m1", "mcp"), ("x", "other"), ("m2", "mcp"), ("m3", "mcp")]:
        AlertsStore.save_script({"id": sid, "name": sid, "folder_id": folder, "created_at": "t"})
    return tmp_path


def ids():
    return [s["id"] for s in AlertsStore.get_scripts()]


def test_скрипты_папки_встают_в_новом_порядке_остальные_на_месте(scripts_file):
    AlertsStore.reorder_scripts(["m3", "m1", "m2"])
    assert ids() == ["a", "m3", "x", "m1", "m2"]


def test_неизвестные_и_повторы_игнорируются(scripts_file):
    AlertsStore.reorder_scripts(["m2", "нет", "m2", "m1"])
    assert ids() == ["a", "m2", "x", "m1", "m3"]


def test_менять_порядок_может_только_суперюзер(scripts_file):
    role = {"v": "monitoring"}
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = {"login": "t", "role": role["v"]}
        return await call_next(request)

    app.include_router(A.router)
    c = TestClient(app)
    assert c.post("/api/alerts/scripts/reorder", json={"ids": ["m3", "m1"]}).status_code == 403
    role["v"] = "superuser"
    assert c.post("/api/alerts/scripts/reorder", json={"ids": ["m3", "m1"]}).status_code == 200
    assert ids()[1] == "m3"
