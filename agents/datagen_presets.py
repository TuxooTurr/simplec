"""
Готовые сценарии генерации под конкретные таблицы.

Правила выведены из реальных строк таблиц, а не придуманы: в tcs два разных
вида записей, и вид определяет остальные поля.

  type='jazz' — конференция, созданная вручную:
      external_id = -1 (внешней системы нет), url = ссылка на Jazz,
      nm вида «ВКС по инциденту <номер>»
  type='tcs'  — пришедшая из внешней системы:
      external_id = реальный номер, url пуст,
      nm начинается с этого же номера: «3117 - Сервисы ...»

Поэтому колонки нельзя заполнять независимо — набор правил идёт профилем,
внутри которого значения согласованы между собой.
"""

from typing import Any

# Метка, по которой сгенерированное отличается от боевого и может быть удалено.
TEST_MARKER = "ТЕСТ"

# Встречается в данных: Инцидент, Внедрение, ДЗО/КЭС, Прочее, Прочие
TCS_LABELS = ["Инцидент", "Внедрение", "ДЗО/КЭС", "Прочее"]

JAZZ_URL = ("https://ift.test-jazz.sberbank.ru/sber-swsofx"
            "?psw=OAZWD0sTUABRFlEZFAdHE14cTA")


def tcs_jazz_rules() -> dict[str, dict[str, Any]]:
    """ТКС типа jazz — ручная конференция по инциденту.

    Метка уходит в nm: отдельного технического поля в таблице нет, а nm —
    единственная колонка, по которой строку потом найдут глазами и запросом.
    """
    return {
        "cnt":         {"rule": "const", "value": 0},
        "external_id": {"rule": "const", "value": -1},
        "nm":          {"rule": "pattern", "value": "{marker} ВКС по инциденту IM{rnd}{rnd}"},
        "number":      {"rule": "null"},
        "external":    {"rule": "const", "value": False},
        "parent_id":   {"rule": "null"},
        "type":        {"rule": "const", "value": "jazz"},
        "url":         {"rule": "const", "value": JAZZ_URL},
        "label":       {"rule": "const", "value": "Инцидент"},
        "comment_id":  {"rule": "null"},
        "duty_id":     {"rule": "null"},
        "update_seq":  {"rule": "random_int", "min": 100_000, "max": 999_999},
    }


def tcs_external_rules(external_id_min: int = 900_001,
                       external_id_max: int = 999_999) -> dict[str, dict[str, Any]]:
    """ТКС типа tcs — пришедшая из внешней системы.

    external_id берётся из заведомо тестового диапазона (900000+), чтобы не
    столкнуться с реальными номерами: в данных они трёх-пятизначные.
    В nm внешний номер продублирован — так же, как в боевых строках.
    """
    return {
        "cnt":         {"rule": "const", "value": 0},
        # external_id объявлен раньше nm намеренно: nm ссылается на него через
        # {col:external_id}, а ссылка видит только заполненное выше.
        "external_id": {"rule": "random_int", "min": external_id_min, "max": external_id_max},
        "nm":          {"rule": "pattern", "value": "{marker} {col:external_id} - Тестовая услуга"},
        "number":      {"rule": "null"},
        "external":    {"rule": "const", "value": False},
        "parent_id":   {"rule": "null"},
        "type":        {"rule": "const", "value": "tcs"},
        "url":         {"rule": "null"},
        "label":       {"rule": "random_choice", "options": TCS_LABELS},
        "comment_id":  {"rule": "null"},
        "duty_id":     {"rule": "null"},
        "update_seq":  {"rule": "random_int", "min": 100_000, "max": 999_999},
    }


def tcsmember_rules() -> dict[str, dict[str, Any]]:
    """Участник ТКС. Колонка tcs — ссылка на родителя, её подставляет генератор."""
    return {
        "name":          {"rule": "pattern", "value": "{marker} Участник-{n}"},
        "primary_email": {"rule": "pattern", "value": "test-user-{rnd}@sberbank.ru"},
        "primary_phone": {"rule": "pattern", "value": "7900{rnd}{rnd}"},
        "typ":           {"rule": "const", "value": "USER"},
        "tcs":           {"rule": "from_parent"},
    }


# Готовые кнопки для интерфейса: подпись → что вставляем.
PRESET_TCS = {
    "id": "tcs",
    "title": "ТКС",
    "connection_hint": "Таблицы tcs и tcsmember",
    "marker": TEST_MARKER,
    "tables": ["tcs", "tcsmember"],
    # Связь колонкой, а не внешним ключом: в структуре таблиц FK не объявлен,
    # поэтому интроспекция его не найдёт — задаём явно.
    "link": {"parent": "tcs", "child": "tcsmember",
             "child_column": "tcs", "parent_column": "id"},
    "actions": [
        {
            "id": "add_tcs_jazz",
            "label": "Добавить ТКС (Jazz)",
            "table": "tcs",
            "count": 1,
            "rules": tcs_jazz_rules(),
        },
        {
            "id": "add_tcs_external",
            "label": "Добавить ТКС (внешняя)",
            "table": "tcs",
            "count": 1,
            "rules": tcs_external_rules(),
        },
        {
            "id": "add_members",
            "label": "Добавить участников",
            "table": "tcsmember",
            "count": 3,
            "parent_action": "add_tcs_jazz",   # берёт id последней созданной ТКС
            "rules": tcsmember_rules(),
        },
    ],
}

# Конфигурация синхронизации участников: пользователь выбирает существующую ТКС
# и говорит, сколько в ней должно быть участников.
SYNC_TCS = {
    "marker": TEST_MARKER,
    # Писать разрешено только в эти таблицы.
    "allowed_tables": ["tcs", "tcsmember"],

    "parent_table": "tcs",
    "parent_id_column": "id",
    "parent_label_column": "nm",          # что видно в выпадающем списке
    "parent_count_column": "cnt",         # счётчик участников
    # В родительской строке — возможно боевой — правим ровно одну колонку.
    "parent_updatable_columns": ["cnt"],

    "child_table": "tcsmember",
    "child_id_column": "id",
    "child_fk_column": "tcs",             # связь на tcs.id
    "child_marker_column": "name",        # по метке отличаем своих от чужих
    "child_rules": tcsmember_rules(),
}

ALL_PRESETS = [PRESET_TCS]


def get_preset(preset_id: str) -> dict | None:
    return next((p for p in ALL_PRESETS if p["id"] == preset_id), None)
