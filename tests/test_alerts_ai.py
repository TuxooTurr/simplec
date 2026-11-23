"""ИИ-помощник генератора событий: проверка черновика скрипта из ответа модели."""
import pytest
from fastapi import HTTPException
from backend.api import alerts


def test_draft_validates_types_options_and_placeholders():
    data = {"name": "МПР", "topic": "events", "cells": [
        {"type": "markdown", "source": "# Отправка"},
        {"type": "code", "source": 'system = "CI0001"\nstate = "OPEN"\nwhen = "2026-11-23T10:00"'},
        {"type": "code", "source": "  "}],
        "params": [
            {"label": "Система", "code_key": "system", "placeholder": "CI0001", "field_type": "text"},
            {"label": "Статус", "code_key": "state", "placeholder": "OPEN", "field_type": "select", "options": []},
            {"label": "Время", "code_key": "when", "placeholder": "2026-11-23T10:00", "field_type": "calendar"},
            {"label": "Нет в коде", "code_key": "x", "placeholder": "ZZZ", "field_type": "text"},
        ]}
    d = alerts.ai_draft(data)
    assert [c["type"] for c in d["notebook"]] == ["markdown", "code"]
    assert [(p["label"], p["field_type"]) for p in d["dynamic_params"]] == [("Система", "text"), ("Статус", "text"), ("Время", "text")]
    assert any("Нет в коде" in n for n in d["notes"]) and any("вариантов нет" in n for n in d["notes"])


def test_list_type_with_options_kept_and_no_code_rejected():
    d = alerts.ai_draft({"cells": [{"type": "code", "source": 'lvl = "P1"'}],
                         "params": [{"label": "Приоритет", "placeholder": "P1", "field_type": "dropdown", "options": ["P1", "P2"]}]})
    assert d["dynamic_params"][0]["field_type"] == "dropdown" and d["dynamic_params"][0]["options"] == ["P1", "P2"]
    with pytest.raises(HTTPException):
        alerts.ai_draft({"cells": [{"type": "markdown", "source": "только текст"}], "params": []})


def test_parse_json_inside_fence():
    assert alerts._ai_parse('```json\n{"name": "x", "cells": []}\n```')["name"] == "x"
    with pytest.raises(HTTPException):
        alerts._ai_parse("не json")
