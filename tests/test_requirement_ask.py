"""Вопрос к документу «Данных»: промпт только по тексту документа, ответ модели, понятная ошибка."""

import asyncio

import pytest
from fastapi import HTTPException

import backend.api.requirements as R
import agents.llm_client as lc

DOC = {"id": "r1", "name": "Выгрузка карточки", "feature": "Карточка", "text": "Кнопка PDF выгружает карточку.",
       "qa_doc": "## Выгрузка\nPDF до 10 МБ."}


def test_промпт_берёт_документ_qa_и_исходник():
    p = R.ask_prompt(DOC, "  Какой лимит?  ")
    assert "# ДОКУМЕНТ QA\n## Выгрузка" in p and "# ИСХОДНИК (требования)\nКнопка PDF" in p
    assert p.endswith("ВОПРОС: Какой лимит?") and "ТОЛЬКО по тексту документа" in p
    p = R.ask_prompt({**DOC, "qa_doc": "", "text": "x" * (R.MAX_ASK_CHARS + 10)}, "?")
    assert "ДОКУМЕНТ QA" not in p and "[…документ обрезан по длине…]" in p


class FakeLLM:
    def __init__(self, provider):
        if provider == "сломан":
            raise RuntimeError("401 Unauthorized")

    def chat(self, messages, temperature, max_tokens):
        assert "Какой лимит?" in messages[0].content and temperature == 0.2
        return lc.LLMResponse(content="  До 10 МБ (раздел «Выгрузка»).  ")


def test_ответ_и_ошибка(monkeypatch):
    monkeypatch.setattr(R.RequirementsStore, "get_requirement", staticmethod(lambda i: DOC if i == "r1" else None))
    monkeypatch.setattr(lc, "LLMClient", type("C", (FakeLLM,), {"classify_error": staticmethod(lc.LLMClient.classify_error)}))
    r = asyncio.run(R.ask_requirement("r1", R.AskBody(provider="gigachat", question="Какой лимит?")))
    assert r == {"answer": "До 10 МБ (раздел «Выгрузка»)."}
    with pytest.raises(HTTPException) as e:
        asyncio.run(R.ask_requirement("r1", R.AskBody(provider="сломан", question="Какой лимит?")))
    assert e.value.status_code == 400 and "авторизации" in e.value.detail
    with pytest.raises(HTTPException) as e:
        asyncio.run(R.ask_requirement("нет", R.AskBody(provider="gigachat", question="?")))
    assert e.value.status_code == 404
