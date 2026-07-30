"""Генератор ручных кейсов: шаг — на бизнес-языке, техника — в зонах API и БД.

Требование пользователя: тестировщик и аналитик читают сам шаг и понимают, что
делает человек; методы, параметры, тело запроса и ответ описаны отдельно в зоне
API, а всё, что касается данных, — в зоне БД.

Проверяем то, что реально можем проверить без обращения к модели:
образцы шагов, которые уходят в промпт, и разбор ответа модели.
"""

import re

import pytest

from agents.layered_generator import LayeredGenerator, TestCaseMarkdown
from agents.prompt_templates import PromptTemplateManager


# Признаки техники, которым не место в формулировке шага.
TECH_IN_STEP = [
    (r'\b(GET|POST|PUT|DELETE|PATCH)\b', "HTTP-метод"),
    (r'/api/',                            "эндпоинт"),
    (r'\bcurl\b',                         "curl"),
    (r'\bSELECT\b|\bINSERT\b|\bUPDATE\b', "SQL"),
    (r'[{}]',                             "JSON"),
    (r'\b\d{3}\s+(OK|Created|Bad|Forbidden|Not)\b', "код ответа"),
]

STEP_RE = re.compile(r'^\*\*Шаг\s+\d+:\*\*\s*(.+)$', re.MULTILINE)


def _templates():
    return PromptTemplateManager.TEMPLATES.items()


@pytest.mark.parametrize("type_id", [t for t, _ in PromptTemplateManager.TEMPLATES.items()])
def test_примеры_шагов_в_том_же_формате_что_и_кейс(type_id):
    """Образцы были в XML, а слой кейсов просит Markdown — модель получала два
    несовместимых формата сразу."""
    example = PromptTemplateManager.TEMPLATES[type_id].example_steps
    assert "<step" not in example, f"{type_id}: образец шагов остался в XML"
    assert "<description>" not in example and "<expectedResult>" not in example
    assert STEP_RE.search(example), f"{type_id}: нет ни одного «**Шаг N:**»"


@pytest.mark.parametrize("type_id", [t for t, _ in PromptTemplateManager.TEMPLATES.items()])
def test_в_образцах_шаг_описан_бизнес_языком(type_id):
    example = PromptTemplateManager.TEMPLATES[type_id].example_steps
    for action in STEP_RE.findall(example):
        for pattern, label in TECH_IN_STEP:
            assert not re.search(pattern, action), (
                f"{type_id}: в шаге «{action}» осталась техника ({label}) — "
                f"её место в зоне API или БД"
            )


@pytest.mark.parametrize("type_id", [t for t, _ in PromptTemplateManager.TEMPLATES.items()])
def test_в_образцах_есть_все_три_зоны(type_id):
    example = PromptTemplateManager.TEMPLATES[type_id].example_steps
    for zone in ("- UI:", "- API:", "- БД:"):
        assert zone in example, f"{type_id}: в образце нет зоны {zone}"


@pytest.mark.parametrize("type_id", [t for t, _ in PromptTemplateManager.TEMPLATES.items()])
def test_образцы_показывают_детальный_запрос_и_ответ(type_id):
    """Пользователю нужны и запрос, и ответ — иначе кейс нечем сверять."""
    example = PromptTemplateManager.TEMPLATES[type_id].example_steps
    assert "Ответ:" in example, f"{type_id}: в образце не показан ответ метода"


def test_разбор_шага_сохраняет_многострочные_детали_api():
    """Продолжения зоны молча терялись: из кейса пропадали тело запроса и ответ."""
    g = LayeredGenerator(llm_client=None)
    md = (
        "## Кейс\n"
        "**Оценка времени прохождения:** 7 мин\n\n"
        "**Шаг 1:** Создать перевод на 1 000 рублей\n"
        "- Тестовые данные: сумма 1000, счёт 40817810000000000001\n"
        "- UI: Отображается сообщение «Перевод создан»\n"
        "- API: POST /api/v1/transactions\n"
        "  Тело запроса: {\"amount\": 1000.00}\n"
        "  Ответ: 201 Created, transactionId\n"
        "- БД: таблица transactions, status = 'PENDING'\n"
    )
    step = g._parse_markdown(md, {"name": "Кейс"}).steps[0]

    assert step["action"] == "Создать перевод на 1 000 рублей"
    assert "Тело запроса" in step["api"], "потеряно тело запроса"
    assert "Ответ: 201 Created" in step["api"], "потерян ответ метода"
    assert "PENDING" in step["db"]
    # Продолжения не должны просачиваться в соседние зоны.
    assert "Тело запроса" not in step["ui"]
    assert "Тело запроса" not in step["test_data"]


def test_разбор_многострочной_зоны_бд():
    g = LayeredGenerator(llm_client=None)
    md = (
        "**Шаг 1:** Убедиться, что заявка сохранилась\n"
        "- Тестовые данные: Не требуются\n"
        "- UI: В списке появилась заявка\n"
        "- API: Запросов к API нет\n"
        "- БД: схема public, таблица requests\n"
        "  Поле status = 'created'\n"
        "  Поле description = 'Тестовая заявка'\n"
    )
    step = g._parse_markdown(md, {"name": "Кейс"}).steps[0]
    assert "status = 'created'" in step["db"]
    assert "description = 'Тестовая заявка'" in step["db"]


def test_служебная_строка_результат_не_ломает_зоны():
    """to_markdown() пишет «- Результат:» перед зонами — она не должна съедать
    следующие строки как продолжение."""
    g = LayeredGenerator(llm_client=None)
    md = (
        "**Шаг 1:** Открыть форму заявки\n"
        "- Тестовые данные: Не требуются\n"
        "- Результат:\n"
        "  - UI: Форма отображается\n"
        "  - API: Запросов к API нет\n"
        "  - БД: Изменений в БД нет\n"
    )
    step = g._parse_markdown(md, {"name": "Кейс"}).steps[0]
    assert step["ui"] == "Форма отображается"
    assert step["test_data"] == "Не требуются"


def test_кейс_переживает_обратную_сборку_в_markdown():
    """Слой XML получает кейс через to_markdown(): детали не должны теряться
    на этом переходе."""
    g = LayeredGenerator(llm_client=None)
    md = (
        "**Шаг 1:** Создать перевод на 1 000 рублей\n"
        "- Тестовые данные: сумма 1000\n"
        "- UI: Сообщение «Перевод создан»\n"
        "- API: POST /api/v1/transactions\n"
        "  Ответ: 201 Created, transactionId\n"
        "- БД: таблица transactions, status = 'PENDING'\n"
    )
    case = g._parse_markdown(md, {"name": "Кейс"})
    again = g._parse_markdown(case.to_markdown(), {"name": "Кейс"})

    assert again.steps[0]["api"] == case.steps[0]["api"]
    assert again.steps[0]["db"] == case.steps[0]["db"]
    assert again.steps[0]["action"] == case.steps[0]["action"]


def test_пустой_ответ_модели_помечается_как_сбой():
    """Регресс: пустой ответ раньше выглядел как настоящий шаг кейса."""
    g = LayeredGenerator(llm_client=None)
    case = g._parse_markdown("", {"name": "Кейс"})
    assert "⚠️" in case.steps[0]["action"]
