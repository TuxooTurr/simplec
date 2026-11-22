"""Kimi K3 через сторонний OpenAI-совместимый провайдер: temperature фиксирована, рассуждение входит в лимит."""
import json
import pytest
from agents import llm_client as lc


class _Resp:
    def raise_for_status(self): pass
    def json(self):
        return {"model": "kimi-k3.1-pro", "choices": [{"message": {"content": "Ответ", "reasoning_content": "думаю"},
                                                       "finish_reason": "stop"}], "usage": {}}


@pytest.fixture
def provider(monkeypatch):
    def make(model):
        monkeypatch.setenv("CUSTOM_LLM_PROVIDERS", json.dumps([{
            "id": "custom_kimi", "name": "Kimi", "base_url": "https://api.moonshot.ai/v1",
            "model": model, "auth_type": "api_key", "api_key": "sk-test"}]))
        monkeypatch.delenv("GIGACHAT_ONLY", raising=False)
        client = lc.LLMClient("custom_kimi")
        sent = []
        client.client.post = lambda url, json, headers: (sent.append((url, json, headers)) or _Resp())
        return client, sent
    return make


def test_k3_без_temperature_и_лимита_ответ_из_content(provider):
    client, sent = provider("kimi-k3.1-pro")
    r = client.chat([lc.Message(role="user", content="ping")], temperature=0.2, max_tokens=5)
    url, payload, headers = sent[0]
    assert url == "https://api.moonshot.ai/v1/chat/completions"
    assert "temperature" not in payload and "max_tokens" not in payload
    assert headers["Authorization"] == "Bearer sk-test"
    assert r.content == "Ответ"                                     # рассуждение не попадает в ответ
    assert client.client.timeout.read == 600.0


def test_другие_модели_получают_temperature_и_лимит(provider):
    client, sent = provider("deepseek-chat")
    client.chat([lc.Message(role="user", content="ping")], temperature=0.2, max_tokens=5)
    assert sent[0][1]["temperature"] == 0.2 and sent[0][1]["max_tokens"] == 5
    assert client.client.timeout.read == 180.0


def test_модель_из_вызова_тоже_учитывается(provider):
    client, sent = provider("deepseek-chat")
    client.chat([lc.Message(role="user", content="ping")], model="kimi-k3")
    assert "temperature" not in sent[0][1]
