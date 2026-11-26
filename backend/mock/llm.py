"""Мок LLM: все подключения GigaChat «готовы», ответ — заготовка без сети."""
from __future__ import annotations

import json
import time

MODELS = ["GigaChat-2", "GigaChat-2-Pro", "GigaChat-2-Max"]

_CASES = """## Тест-кейс 1. Создание инцидента оператором
**Предусловия:** оператор авторизован в АС 911.

| № | Шаг | Ожидаемый результат |
|---|-----|---------------------|
| 1 | Открыть раздел «Инциденты» | Открыт список инцидентов |
| 2 | Нажать «Создать», заполнить адрес и тип | Поля заполнены, ошибок нет |
| 3 | Нажать «Сохранить» | Инцидент создан, статус «Новый» |

## Тест-кейс 2. Ошибка валидации адреса
| № | Шаг | Ожидаемый результат |
|---|-----|---------------------|
| 1 | Оставить адрес пустым и нажать «Сохранить» | Подсказка «Укажите адрес», инцидент не создан |
"""


def _tm(raw: str) -> str | None:
    """Этапы тестовой модели (agents/tm_pipeline.py): JSON по метке [[TM:…]] в начале промта."""
    import json
    import re
    m = re.match(r"\[\[TM:(\w+)\]\]", raw)
    if not m:
        return None
    kind = m.group(1)
    if kind == "FIX" and "=== СТРОКА КАРТЫ ===" in raw:
        kind = "FIX"
    line = lambda label: (re.search(label + r": (.*)", raw) or [None, ""])[1].strip()
    if kind == "PLAN":
        hint = line("Место в дереве")
        place = [p.strip() for p in hint.split("/")] if hint and not hint.startswith("не указано") else ["Инциденты", "Инциденты ИТ", "Шаблоны инцидентов"]
        f = line("Фича") or "Фича"
        rows = [
            ("Создать инцидент по шаблону", "Позитивные сценарии", f"[W][{f}] Создание. По шаблону с заполнением полей", "W", True),
            ("Создать инцидент по шаблону", "Негативные сценарии", f"[W][{f}] Создание. Ошибки валидации полей", "W", False),
            ("Найти шаблон", "Граничные сценарии", f"[W][{f}] Поиск шаблона. Пустой результат и длинный запрос", "W", False),
        ]
        return json.dumps({
            "place": place, "place_note": "",
            "scenarios": [{"scenario": a, "type": b, "name": c, "platform": d, "checks": "Заготовка мок-режима", "steps": 4, "critical": e}
                          for a, b, c, d, e in rows],
            "coverage": [{"item": "Создание по шаблону", "cases": [rows[0][2], rows[1][2]]}, {"item": "Поиск шаблона", "cases": [rows[2][2]]}],
            "questions": [{"unknown": "Метод создания", "where": "Шаги API", "question": "Какой метод API создаёт инцидент по шаблону?"}],
            "contradictions": [],
        }, ensure_ascii=False)
    if kind in ("CASE", "FIX"):
        name = line("Кейс") or "[W][Фича] Новый кейс. По замечанию арбитра"
        out = {
            "name": name if kind == "CASE" else name.replace(". ", ". Исправлено: ", 1),
            "objective": "Цель: заготовка мок-режима.\n\nОкружение:\n• Микросервисы: incident-template-ms\n• Job: нет\n• БД: ⚠ нужен контракт",
            "precondition": "1. Пользователь — дежурный\n2. Заведён шаблон AT_Шаблон\nОчистка: удалить AT_Шаблон",
            "system": "Инцидент ИТ [CI04663751]", "labels": ["incident-template-ms", "incidentit-web-gate"],
            "steps": [
                {"action": "Открыть раздел «Инциденты»", "test_data": "", "ui": "Открыт список инцидентов", "api": "", "db": ""},
                {"action": "Нажать «Создать по шаблону», выбрать AT_Шаблон", "test_data": "AT_Шаблон", "ui": "Поля заполнены из шаблона", "api": "⚠ нужен контракт", "db": ""},
                {"action": "Нажать «Сохранить»", "test_data": "", "ui": "Инцидент создан, статус «Новый»", "api": "⚠ сверить с контрактом", "db": "⚠ нужен контракт"},
            ],
        }
        if "=== НОВЫЙ КЕЙС ПО ЗАМЕЧАНИЮ" in raw:
            out.update({"name": "[W][Фича] Права. Нет доступа к шаблонам", "scenario": "Проверить доступ к шаблонам", "type": "Негативные сценарии"})
        return json.dumps(out, ensure_ascii=False)
    if kind == "REVIEW":
        first = (re.search(r"\[1\] (.*)", raw) or [None, ""])[1].strip()
        return json.dumps({
            "verdict": "fixes",
            "remarks": [
                {"what": "В шаге API нет метода — стоит ⚠ без вопроса в карте", "where": first, "fix": "Добавить вопрос и сверить с контрактом", "case": first},
                {"what": "Не покрыта роль без прав", "where": "Требование «Доступ»", "fix": "Добавить негативный кейс на отсутствие прав", "case": ""},
            ],
            "questions": [{"question": "Кто может создавать инциденты по шаблону?", "priority": "блокирует"}],
        }, ensure_ascii=False)
    if kind == "QADOC":
        return ("## Что это такое простыми словами\nЗаготовка документа QA в мок-режиме.\n\n"
                "## Чек-лист проверок\n- Инцидент по шаблону создаётся со статусом «Новый»\n\n"
                "## Вопросы для уточнения\n| № | Вопрос | Приоритет |\n|---|---|---|\n| 1 | Метод создания | блокирует |")
    return None


def answer(messages) -> str:
    """Ответ по смыслу запроса: тест-кейсы, баг-репорт или короткий текст. Это заготовка — не настоящая модель."""
    tm = _tm(str(getattr(messages[0], "content", ""))) if messages else None
    if tm is not None:
        return tm
    prompt = " ".join(str(getattr(m, "content", "")) for m in messages)
    component = "\nКомпонент Jira: 1" if "Компонент Jira: <номер или 0>" in prompt else ""
    if prompt.startswith("Собери краткую Markdown-страницу изменений версии"):
        release = prompt.split("\n\n", 1)[-1].split("\n\nПРЕДЫДУЩИЕ БИЗНЕС-ВЕРСИИ:", 1)[0]
        return "## Что добавили\n\n" + release.partition("\n")[2].strip()
    if prompt.startswith("Обнови только затронутые разделы действующего QA-обзора"):
        changes = prompt.partition("ИЗМЕНЕНИЯ ИСТОЧНИКА:")[2].splitlines()
        added = [line[1:] for line in changes if line.startswith("+") and not line.startswith("+++") and line[1:].strip()]
        sections = ["## Изменения источника · демо\n\n" + "\n".join(added)] if added else []
        return json.dumps({"replace": [], "add": sections}, ensure_ascii=False)
    if "скрипт-генератор событий для Jupyter Notebook" in prompt:
        if "list_links" in prompt and "filter_links" in prompt:
            return json.dumps({"scripts": [
                {"version": version, "server": "incident-tools", "tool": tool, "business": purpose,
                 "cells": [{"type": "code", "source": f'tool = "{tool}"\nprint(tool)'}], "params": []}
                for version, tool, purpose in [("V1", "list_links", "Показать связи инцидента"), ("V2", "filter_links", "Отобрать связи по статусу")]
            ]}, ensure_ascii=False)
        return json.dumps({"name": "Демо: событие инцидента", "topic": "incidents", "cells": [
            {"type": "markdown", "source": "# Отправка события инцидента\nДемо-скрипт ИИ-помощника."},
            {"type": "code", "source": "from kafka import KafkaProducer\nimport json\nsystem = \"CI0000001\"\npriority = \"P2\"\nraised = \"2026-11-23T10:00\"\nevent = {\"system\": system, \"priority\": priority, \"raised\": raised}\nprint(json.dumps(event, ensure_ascii=False))"}],
            "params": [{"label": "Система (КЭ)", "code_key": "system", "placeholder": "CI0000001", "field_type": "text"},
                       {"label": "Приоритет", "code_key": "priority", "placeholder": "P2", "field_type": "dropdown", "options": ["P1", "P2", "P3"]},
                       {"label": "Время возникновения", "code_key": "raised", "placeholder": "2026-11-23T10:00", "field_type": "datetime"}]},
            ensure_ascii=False)
    if "Выбери по входным данным один код слоя" in prompt:
        return (f"# [Fn][Карточка инцидента] Ошибка при сохранении{component}\n\n"
                "## Описание\nКарточка не сохраняется.\n\n"
                "## Шаги воспроизведения\n1. Открыть карточку.\n2. Нажать «Сохранить».\n\n"
                "## Фактический результат\nОшибка 500.\n\n"
                "## Ожидаемый результат\nКарточка сохранена.\n\nПриоритет: Высокий")
    if "Оформи задачу для Jira по неформальному описанию" in prompt:
        return (f"# Проверить сохранение карточки инцидента{component}\n\n"
                "## Цель\nПроверить работу карточки инцидента.\n\n"
                "## Что сделать\n1. Изменить и сохранить карточку.\n\n"
                "## Критерии готовности\n- Карточка сохраняется с изменениями.")
    text = prompt.lower()
    if text.strip() in ("ping", "привет"):
        return "pong"
    if "баг" in text or "дефект" in text or "bug" in text:
        return ("**Заголовок:** Ошибка 500 при сохранении карточки инцидента\n\n**Шаги воспроизведения:**\n1. Открыть карточку\n"
                "2. Изменить статус\n3. Нажать «Сохранить»\n\n**Фактический результат:** ошибка 500\n\n"
                "**Ожидаемый результат:** статус сохранён\n\n**Окружение:** ИФТ, Chrome 130")
    if "тест" in text or "кейс" in text or "test" in text:
        return _CASES
    return "Мок-ответ модели: режим SHARK_MOCK, настоящая модель не вызывалась."


def install() -> None:
    import agents.llm_client as lc

    def _status(provider_id: str) -> dict:
        prof = lc.GIGA_PROFILES.get(provider_id, {"name": provider_id})
        return {"id": provider_id, "name": prof["name"], "status": "ready", "message": "OK (мок)"}

    def _init_client(self) -> None:
        self.client = None
        self.model = MODELS[-1]

    def _chat(self, messages, temperature: float = 0.7, max_tokens: int = 4000, model: str = ""):
        time.sleep(0.4)                                  # чтобы индикаторы загрузки было видно
        return lc.LLMResponse(content=answer(messages), model=model or MODELS[-1], usage={"total_tokens": 0})

    lc._builtin_status = _status
    lc.LLMClient._init_client = _init_client
    lc.LLMClient.chat = _chat
    lc.list_gigachat_models = lambda *a, **k: list(MODELS)
    lc.probe_gigachat_chat = lambda *a, **k: "pong (мок)"
