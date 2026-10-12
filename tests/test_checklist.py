"""Чек-лист фичи (Jira tool → «Чек-лист»): критически важные базовые проверки по требованиям.

LLM подменяется: проверяем, что в запрос уходят требования, что ответ разбирается в пункты
и что без требований генерация не запускается.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import agents.llm_client as llm_client
import backend.api.bugs as B
from db.requirements_store import RequirementsStore


def test_разбор_пунктов():
    text = "Вот проверки:\n1. Откройте фильтр — видны услуги\n2) Выберите две услуги — остались только они\n- **Сбросьте** фильтр\n1. Откройте фильтр — видны услуги\n"
    assert B.parse_checks(text) == [
        "Откройте фильтр — видны услуги", "Выберите две услуги — остались только они", "Сбросьте фильтр",
    ]


@pytest.fixture
def reqs(monkeypatch):
    data = {"r1": {"name": "ТЗ фильтра", "text": "Фильтр по услугам сохраняется между вкладками"},
            "r2": {"name": "Пустое", "text": ""}}
    monkeypatch.setattr(RequirementsStore, "get_requirement", classmethod(lambda cls, rid: data.get(rid)))


def test_чек_лист_по_требованиям(monkeypatch, reqs):
    captured = {}

    class FakeLLM:
        def __init__(self, provider):
            captured["provider"] = provider

        def chat(self, messages, **kwargs):
            captured["prompt"] = messages[0].content
            return SimpleNamespace(content="1. Выберите услугу — список отфильтрован\n2. Перейдите на другую вкладку и вернитесь — фильтр сохранился")

    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    res = asyncio.run(B.task_checklist(B.ChecklistBody(key="SBER911-1", summary="Фильтр по услугам",
                                                       requirement_ids=["r1", "r2", "нет"], provider="gigachat")))
    assert res["checks"] == ["Выберите услугу — список отфильтрован",
                             "Перейдите на другую вкладку и вернитесь — фильтр сохранился"]
    assert "сохраняется между вкладками" in captured["prompt"]
    assert "бизнес-пользователя" in captured["prompt"]
    assert captured["provider"] == "gigachat"


def test_без_требований_не_генерируем(reqs):
    with pytest.raises(HTTPException) as e:
        asyncio.run(B.task_checklist(B.ChecklistBody(summary="Фича", requirement_ids=["r2"], provider="gigachat")))
    assert e.value.status_code == 400
