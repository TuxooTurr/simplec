from fastapi.testclient import TestClient
from simplec.web.app import app

client = TestClient(app)

def test_root_ok():
    r = client.get("/")
    assert r.status_code == 200

def test_healthz_ok():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.text.strip() == "ok"

def test_api_health_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"
