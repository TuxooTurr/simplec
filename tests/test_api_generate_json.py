from fastapi.testclient import TestClient
from simplec.web.app import app

def test_api_generate_with_mock_returns_json_and_artifacts():
    client = TestClient(app)
    r = client.post("/api/generate", json={
        "platform": "W",
        "feature": "AUTH",
        "llm_provider": "mock",
        "text": "User can login with email and 2FA"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "out_dir" in data and data["out_dir"]
    assert "zephyr_import" in data
