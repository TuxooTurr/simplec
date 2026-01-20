from fastapi.testclient import TestClient
from simplec.web.app import app

def test_generate_page_with_mock_provider():
    client = TestClient(app)
    r = client.post("/generate", data={
        "platform": "W",
        "feature": "AUTH",
        "llm_provider": "mock",
        "text": "User can login with email and 2FA"
    })
    assert r.status_code == 200
    assert "download/zephyr" in r.text or "zephyr_import.json" in r.text
