"""Создание задачи из Jira tool: генерация «Задачи» и отправка в Jira не как дефект.

- Генерация задачи берёт требования из раздела «Данные» как контекст — чтобы
  содержимое было адаптировано под требования.
- «Задача» уходит в Jira своим типом и без полей, обязательных только для дефекта
  SBER911 (вид испытаний, тип объекта, тип стенда); уровень доступа — общий для проекта.
"""

from types import SimpleNamespace

import pytest

import agents.llm_client as llm_client
import backend.api.jira_defects as JD
from backend.api import jira_constants as JC
from backend.api.bugs import _format_task_sync, _parse_report


def test_задача_строится_по_требованиям(monkeypatch):
    captured: dict = {}

    class FakeLLM:
        def __init__(self, provider):
            pass

        def chat_continued(self, messages, **kwargs):
            captured["prompt"] = messages[0].content
            return SimpleNamespace(content="# Проверить фильтр по услугам\n\n## Цель\nУбедиться.")

    monkeypatch.setattr(llm_client, "LLMClient", FakeLLM)
    report = _format_task_sync("Фильтр", "надо проверить фильтр", "gigachat", "### ТЗ фильтра\nФильтр по КЭ")
    assert "ТЗ фильтра" in captured["prompt"] and "Фильтр по КЭ" in captured["prompt"]
    assert "Критерии готовности" in captured["prompt"]
    parsed = _parse_report(report)
    assert parsed["title"] == "Проверить фильтр по услугам"
    assert "## Цель" in parsed["description"]


@pytest.fixture
def sent(monkeypatch):
    out: dict = {}

    def fake_request(cfg, method, path, json_body=None, **kw):
        if path == "/rest/api/2/issue":
            out.update(json_body["fields"])
            return {"key": "SBER911-7"}
        return {}

    monkeypatch.setattr(JD, "_jira_request", fake_request)
    monkeypatch.setattr(JD, "_load_cfg", lambda db: {
        "base_url": "https://jira.example", "token": "t", "token_path": "",
        "ssl_verify": False, "labels": [], "issuetype": "Дефект",
    })
    monkeypatch.setattr(JD, "_resolve_fields", lambda cfg, project, issuetype: {"_issuetype": issuetype, "_available": []})
    monkeypatch.setattr(JD, "_ensure_reference_fields", lambda *a, **k: None)
    return out


def test_задача_уходит_своим_типом_без_полей_дефекта(sent):
    JD.create_defect(JD.CreateDefectBody(project="SBER911", summary="Проверить фильтр", issuetype="Задача"), db=None)
    assert sent["issuetype"] == {"name": "Задача"}
    for fid in JC.DEFAULT_FIELDS:
        if fid != "security":
            assert fid not in sent, f"поле дефекта {fid} ушло в задачу"
    assert JC.FIELD_STAND_TYPE not in sent
    assert sent["security"] == JC.DEFAULT_FIELDS["security"]
    assert JC.FIELD_IT_SERVICE in sent                       # ИТ-услуга — общая для проекта


def test_дефект_по_прежнему_с_полями_дефекта(sent):
    JD.create_defect(JD.CreateDefectBody(project="SBER911", summary="Ошибка"), db=None)
    assert sent["issuetype"] == {"name": "Дефект"}
    for fid in JC.DEFAULT_FIELDS:
        assert fid in sent
    assert JC.FIELD_STAND_TYPE in sent
