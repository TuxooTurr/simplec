"""Промпт баг-репорта: короткий дефект без «Гипотез» и «Окружения».

Разделы «Гипотезы» и «Окружение» раздували описание и прятали суть дефекта
(STBUG-1). Тест фиксирует, что промпт их больше не просит, а строка
приоритета, на которой держится разбор отчёта, осталась последней.
"""

from types import SimpleNamespace

import agents.llm_client as llm_client
from backend.api.bugs import _format_bug_sync


def _captured_prompt(monkeypatch) -> str:
    captured: dict = {}

    class FakeLLM:
        def __init__(self, provider):
            pass

        def chat_continued(self, messages, **kwargs):
            captured["prompt"] = messages[0].content
            return SimpleNamespace(content="# t\n\nПриоритет: Низкий")

    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    _format_bug_sync("Back", "Заявки", "не создаётся заявка", "gigachat")
    return captured["prompt"]


def test_промпт_без_гипотез_и_окружения(monkeypatch):
    prompt = _captured_prompt(monkeypatch)
    assert "Гипотез" not in prompt
    assert "## Окружение" not in prompt


def test_шаблон_содержит_ожидаемый_результат(monkeypatch):
    prompt = _captured_prompt(monkeypatch)
    for section in ("## Описание", "## Шаги воспроизведения",
                    "## Фактический результат", "## Ожидаемый результат"):
        assert section in prompt


def test_приоритет_последней_строкой_шаблона(monkeypatch):
    prompt = _captured_prompt(monkeypatch)
    assert prompt.rstrip().splitlines()[-1].startswith("Приоритет:")
