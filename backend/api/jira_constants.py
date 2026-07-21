# -*- coding: utf-8 -*-
"""
Справочники значений полей Jira SBER911 (собраны из реальных дефектов).

Применяются при создании дефекта в проекте SBER911:
  - DEFAULT_FIELDS — поля, заполняемые по умолчанию (id опций);
  - COMPONENT_KE — компонент → КЭ (customfield_18300), подставляется автоматически.
"""

PROJECT_KEY = "SBER911"

# ИТ-услуга (customfield_22400)
IT_SERVICE = {"id": "233293", "value": "Платформа Сопровождения Sber911"}

# Компонент → КЭ (customfield_18300). При выборе компонента КЭ подставляется сам.
COMPONENT_KE: dict[str, dict] = {
    "Back-end": {
        "value": "Управление приоритетными событиями",
        "typeSm": "Функциональная подсистема",
        "smId": "3521751",
        "itServiceValue": IT_SERVICE["value"],
        "itServiceId": IT_SERVICE["id"],
    },
    "Front-end": {
        "value": "Фронтальный компонент",
        "typeSm": "Модуль",
        "smId": "7801187",
        "itServiceValue": IT_SERVICE["value"],
        "itServiceId": IT_SERVICE["id"],
    },
    "iOS": {
        "value": "Sber911. МП iOS",
        "typeSm": "Модуль",
        "smId": "4759215",
        "itServiceValue": IT_SERVICE["value"],
        "itServiceId": IT_SERVICE["id"],
    },
    "Android": {
        "value": "Sber911. МП Android",
        "typeSm": "Модуль",
        "smId": "4759206",
        "itServiceValue": IT_SERVICE["value"],
        "itServiceId": IT_SERVICE["id"],
    },
}

# Мобильные компоненты: при их выборе разрешён второй компонент (2 компонента → 2 КЭ)
MOBILE_COMPONENTS = {"iOS", "Android"}

# Поля со справочными значениями — заполняются по умолчанию, если не заданы.
# id опций из реальных дефектов SBER911.
#
# ⚠️ customfield_24500 (Роль в ПСИ), customfield_22304 (Приоритет-число),
# customfield_35800 (Источник), customfield_35801 (Флаг) — НЕ ставим: их нет
# на экране создания дефекта, Jira отвечает "cannot be set — not on the
# appropriate screen". Это read-only/производные поля, заполняются в Jira
# автоматически или на других экранах (переходах статуса и т.п.).
DEFAULT_FIELDS: dict[str, object] = {
    "security":          {"id": "12301"},        # Уровень доступа: К-3
    "customfield_11507": {"id": "11517"},        # Вид испытаний: СТ / (FT)
    "customfield_11600": {"id": "11602"},        # Тип объекта: ПО
    # customfield_22400 (ИТ-услуга) сюда не идёт — реальная Jira на SBER911 требует
    # его строкой, а не объектом {"id": ...} (см. _field_schema_type в jira_defects.py);
    # формат определяется динамически по схеме поля из createmeta.
    # customfield_17704 (Тип дефекта: Киберуязвимость 328502) НЕ дефолтим:
    # помечать каждый дефект киберуязвимостью неверно — включить одной строкой при необходимости.
    # customfield_17500 (Тип стенда) сюда не идёт — это видимый выбор пользователя,
    # см. STAND_TYPE ниже.
}

# id поля КЭ и Epic Link в SBER911 (используются, если createmeta их не отдал)
FIELD_KE = "customfield_18300"
FIELD_EPIC_LINK = "customfield_10006"

# Тип стенда (customfield_17500) — видимый выпадающий список на экране создания,
# пользователь выбирает сам. Дефолт — первое значение (Major-Check).
FIELD_STAND_TYPE = "customfield_17500"
STAND_TYPE: dict[str, str] = {
    "Major-Check": "33606",
    "Major-GO":    "33607",
}
DEFAULT_STAND_TYPE = "Major-Check"

# Стенды — справочник для выпадающего списка (Jira отдаёт это поле свободным
# текстом, без allowedValues, поэтому список держим здесь, а не тянем из createmeta).
# TODO: заполнить реальными названиями стендов проекта SBER911.
STANDS: list[str] = []
