import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents import file_parser, llm_client
from backend.api import bugs, requirements
from db.requirements_store import RequirementsStore


@pytest.fixture
def generation(monkeypatch):
    app = FastAPI()
    app.include_router(bugs.router)
    model = SimpleNamespace(prompt="", report="")

    class FakeLLM:
        def __init__(self, provider):
            pass

        def chat_continued(self, messages, **kwargs):
            model.prompt = messages[0].content
            return SimpleNamespace(content=model.report)

    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    monkeypatch.setattr(RequirementsStore, "get_requirement", lambda rid: {
        "system-doc": {"name": "СТ об оплате", "text": "Кнопка активна после выбора карты"},
        "empty": {"name": "Пустой документ", "text": " "},
    }.get(rid))
    return TestClient(app), model


def post(client, kind, *, context=None, requirement_ids=(), files=()):
    return client.post(f"/api/{kind}/format", data={
        "description": "Кнопка не активируется.",
        "provider": "gigachat",
        "jira_context": json.dumps({"epic": "SBER911-123", **(context or {})}, ensure_ascii=False),
        "requirement_ids": list(requirement_ids),
    }, files=list(files))


def test_defect_uses_linked_requirements_and_evidence(generation, monkeypatch):
    client, model = generation
    model.report = (
        "# [fn][Оплата] Кнопка остаётся неактивной\nКомпонент Jira: 2\n\n"
        "## Фактический результат\nКнопка неактивна.\n\nПриоритет: Средний"
    )
    monkeypatch.setattr(file_parser, "_parse_image", lambda data: "PAYMENT BUTTON DISABLED")
    response = post(client, "bugs", context={
        "summary": "Оплата картой", "epic_summary": "Платёжный сценарий",
        "components": ["Отчёты", "Оплата"],
    }, requirement_ids=["system-doc"], files=[
        ("attachments", ("ui.png", b"test image", "image/png")),
        ("attachments", ("response.json", b'{"status":"DISABLED"}', "application/json")),
    ])
    assert response.status_code == 200
    result = response.json()
    assert result["title"] == "[Fn][Оплата] Кнопка остаётся неактивной"
    assert result["component"] == "Оплата"
    assert result["priority"] == "Средний"
    assert result["screenshots"] == ["ui.png"]
    assert "![ui.png](ui.png)" in result["description"]
    assert "Компонент Jira" not in result["description"]
    for value in ("Кнопка не активируется", "Оплата картой", "SBER911-123", "Платёжный сценарий",
                  "Кнопка активна после выбора карты", "PAYMENT BUTTON DISABLED", '{"status":"DISABLED"}'):
        assert value in model.prompt


def test_missing_or_deleted_requirements_are_requested_before_llm(generation):
    client, model = generation
    response = post(client, "bugs", requirement_ids=["deleted", "empty"])
    assert response.status_code == 200
    assert response.json()["needs_requirements"] is True
    assert model.prompt == ""


def test_task_uses_confluence_source_and_limits_component_to_jira(generation, monkeypatch):
    client, model = generation
    model.report = "# Проверить форму оплаты\nКомпонент Jira: 3\n\n## Цель\nПроверить оплату."

    def fake_page(ref):
        assert ref == "https://confluence.example/pages/42"
        return {"title": "Оплата", "markdown": "Поле суммы обязательно"}

    monkeypatch.setattr(requirements, "fetch_page", fake_page)
    response = post(client, "tasks", context={
        "confluence_ref": "https://confluence.example/pages/42", "components": ["Оплата"],
    })
    assert response.status_code == 200
    assert response.json()["title"] == "Проверить форму оплаты"
    assert response.json()["component"] == ""
    assert "Поле суммы обязательно" in model.prompt


def test_task_uses_requirements_file_and_keeps_manual_component(generation):
    client, model = generation
    model.report = "# Проверить форму оплаты\n\n## Цель\nПроверить оплату."
    response = post(client, "tasks", context={
        "selected_components": ["Оплата"], "components": ["Отчёты", "Оплата"],
    }, files=[("requirement_file", ("rules.md", "Обязательна карта".encode(), "text/markdown"))])
    assert response.status_code == 200
    assert response.json()["component"] == ""
    assert "rules.md" in model.prompt
    assert "Обязательна карта" in model.prompt
    assert "КОМПОНЕНТЫ, ВЫБРАННЫЕ ПОЛЬЗОВАТЕЛЕМ: Оплата" in model.prompt
    assert "Компонент Jira:" not in model.prompt


def test_invalid_defect_title_does_not_return_filled_fields(generation):
    client, model = generation
    model.report = "# [Wrong][Оплата] Ошибка\n\n## Описание\nКнопка не работает."
    response = post(client, "bugs", context={"allow_without_requirements": True})
    assert response.status_code == 502
    assert "название и описание" in response.json()["detail"]["message"]
