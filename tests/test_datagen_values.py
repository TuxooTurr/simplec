"""Тесты генерации значений — без БД."""

import random

import pytest

from agents.datagen_values import (
    RuleError, build_row, ensure_marker_present, generate, validate_rule,
)


def test_шаблон_подставляет_номер_и_метку():
    rule = {"rule": "pattern", "value": "{marker} ТКС-{n}"}
    assert generate(rule, index=0) == "ТЕСТ ТКС-1"
    assert generate(rule, index=4) == "ТЕСТ ТКС-5"


def test_последовательность():
    rule = {"rule": "sequence", "start": 100, "step": 10}
    assert [generate(rule, index=i) for i in range(3)] == [100, 110, 120]


def test_случайное_воспроизводимо_при_одном_seed():
    rule = {"rule": "random_int", "min": 1, "max": 1000}
    a = [generate(rule, rnd=random.Random(42)) for _ in range(5)]
    b = [generate(rule, rnd=random.Random(42)) for _ in range(5)]
    assert a == b


def test_from_parent_берёт_ключ_родителя():
    rule = {"rule": "from_parent"}
    assert generate(rule, parent_value=777) == 777


def test_строка_собирается_с_ключом_родителя():
    rules = {
        "name": {"rule": "pattern", "value": "{marker} Участник-{n}"},
        "conference_id": {"rule": "from_parent"},
        "user_id": {"rule": "sequence", "start": 1},
    }
    row = build_row(rules, index=2, parent_values={"conference_id": 42})
    assert row == {"name": "ТЕСТ Участник-3", "conference_id": 42, "user_id": 3}


def test_колонки_без_правила_не_попадают_в_строку():
    """id и created_at заполняет БД — их не должно быть в INSERT."""
    row = build_row({"name": {"rule": "const", "value": "x"}})
    assert list(row) == ["name"]


@pytest.mark.parametrize("bad, why", [
    ({"rule": "неизвестное"},                       "неизвестное правило"),
    ({"rule": "random_int", "min": 10, "max": 1},   "min больше max"),
    ({"rule": "random_choice", "options": []},      "пустой список"),
    ({"rule": "pattern", "value": "  "},            "пустой шаблон"),
    ({"rule": "const"},                             "нет значения"),
])
def test_плохое_правило_отклоняется_до_запуска(bad, why):
    with pytest.raises(RuleError):
        validate_rule(bad)


def test_тест_метка_обязательна_и_распознаётся():
    без_метки = {"name": {"rule": "pattern", "value": "Совещание-{n}"}}
    с_меткой = {"name": {"rule": "pattern", "value": "{marker} Совещание-{n}"}}
    с_константой = {"title": {"rule": "const", "value": "ТЕСТ совещание"}}

    assert ensure_marker_present(без_метки) is False
    assert ensure_marker_present(с_меткой) is True
    assert ensure_marker_present(с_константой) is True


def test_null_и_uuid():
    assert generate({"rule": "null"}) is None
    v = generate({"rule": "uuid"})
    assert len(v) == 36 and v.count("-") == 4
