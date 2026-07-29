"""
Генерация значений колонок по правилам.

Чистая логика без БД и SQL: на вход — правило и контекст, на выходе — значение.
Значения первичных ключей, которые проставляет сама база (автоинкремент),
здесь не генерируются: их подставляет исполнитель после вставки строки.
"""

import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

# Правила заполнения
CONST         = "const"          # фиксированное значение
PATTERN       = "pattern"        # шаблон с {n} / {rnd} — «ТКС-{n}»
UUID4         = "uuid"
RANDOM_INT    = "random_int"     # {"min": 1, "max": 100}
RANDOM_CHOICE = "random_choice"  # {"options": [...]}
NOW           = "now"            # текущее время
DATE_SHIFT    = "date_shift"     # {"days_min": -30, "days_max": 0}
SEQUENCE      = "sequence"       # {"start": 1, "step": 1}
FROM_PARENT   = "from_parent"    # значение ключа родителя (подставляет исполнитель)
NULL          = "null"

ALL_RULES = {
    CONST, PATTERN, UUID4, RANDOM_INT, RANDOM_CHOICE,
    NOW, DATE_SHIFT, SEQUENCE, FROM_PARENT, NULL,
}

# Метка, обязательная для отличия сгенерированных данных от боевых.
DEFAULT_TEST_MARKER = "ТЕСТ"

_PLACEHOLDER = re.compile(r"\{(n|rnd|uuid|marker)\}")


class RuleError(ValueError):
    """Правило описано неверно — ловится до обращения к БД."""


def validate_rule(rule: dict) -> None:
    """Проверяет правило до запуска: ошибку показываем в форме, а не в середине вставки."""
    if not isinstance(rule, dict):
        raise RuleError("Правило должно быть объектом")
    kind = rule.get("rule")
    if kind not in ALL_RULES:
        raise RuleError(f"Неизвестное правило: {kind!r}")

    if kind == PATTERN and not str(rule.get("value", "")).strip():
        raise RuleError("Шаблон пустой")
    if kind == CONST and "value" not in rule:
        raise RuleError("Не задано значение константы")
    if kind == RANDOM_INT:
        lo, hi = rule.get("min", 0), rule.get("max", 0)
        if not isinstance(lo, int) or not isinstance(hi, int):
            raise RuleError("min/max должны быть целыми")
        if lo > hi:
            raise RuleError("min больше max")
    if kind == RANDOM_CHOICE and not rule.get("options"):
        raise RuleError("Список вариантов пуст")
    if kind == DATE_SHIFT:
        if rule.get("days_min", 0) > rule.get("days_max", 0):
            raise RuleError("days_min больше days_max")


def generate(rule: dict, index: int = 0, parent_value: Any = None,
             marker: str = DEFAULT_TEST_MARKER, rnd: Optional[random.Random] = None) -> Any:
    """Значение по правилу.

    index — номер строки (с 0) для {n} и sequence;
    parent_value — значение ключа родителя для from_parent;
    rnd — источник случайности (передаётся ради воспроизводимости в тестах).
    """
    validate_rule(rule)
    kind = rule["rule"]
    r = rnd or random

    if kind == NULL:
        return None
    if kind == CONST:
        return rule.get("value")
    if kind == UUID4:
        return str(uuid.uuid4())
    if kind == FROM_PARENT:
        return parent_value
    if kind == SEQUENCE:
        return int(rule.get("start", 1)) + index * int(rule.get("step", 1))
    if kind == RANDOM_INT:
        return r.randint(int(rule["min"]), int(rule["max"]))
    if kind == RANDOM_CHOICE:
        return r.choice(list(rule["options"]))
    if kind == NOW:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat(sep=" ")
    if kind == DATE_SHIFT:
        days = r.randint(int(rule.get("days_min", 0)), int(rule.get("days_max", 0)))
        return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ")
    if kind == PATTERN:
        def sub(m):
            token = m.group(1)
            if token == "n":      return str(index + 1)
            if token == "rnd":    return str(r.randint(1000, 9999))
            if token == "uuid":   return str(uuid.uuid4())
            if token == "marker": return marker
            return m.group(0)
        return _PLACEHOLDER.sub(sub, str(rule["value"]))

    raise RuleError(f"Правило не реализовано: {kind}")


def build_row(rules: dict[str, dict], index: int = 0,
              parent_values: Optional[dict[str, Any]] = None,
              marker: str = DEFAULT_TEST_MARKER,
              rnd: Optional[random.Random] = None) -> dict[str, Any]:
    """Одна строка: {колонка: значение}.

    parent_values — {колонка: значение} для правил from_parent (FK на родителя).
    Колонки без правила пропускаются: их проставит БД (default/автоинкремент).
    """
    parents = parent_values or {}
    row: dict[str, Any] = {}
    for column, rule in (rules or {}).items():
        row[column] = generate(rule, index=index, parent_value=parents.get(column),
                               marker=marker, rnd=rnd)
    return row


def ensure_marker_present(rules: dict[str, dict], marker: str = DEFAULT_TEST_MARKER) -> bool:
    """Есть ли в правилах тест-метка.

    Без неё сгенерированные строки неотличимы от боевых, и убрать их за собой
    нельзя. Исполнитель обязан отказать в запуске, если метки нет.
    """
    for rule in (rules or {}).values():
        kind = rule.get("rule")
        if kind == PATTERN and ("{marker}" in str(rule.get("value", "")) or marker in str(rule.get("value", ""))):
            return True
        if kind == CONST and marker in str(rule.get("value", "")):
            return True
    return False
