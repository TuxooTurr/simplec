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
DEFAULT_FIELDS: dict[str, object] = {
    "security":          {"id": "12301"},        # Уровень доступа: К-3
    "customfield_11507": {"id": "11517"},        # Вид испытаний: СТ / (FT)
    "customfield_11600": {"id": "11602"},        # Тип объекта: ПО
    "customfield_17500": {"id": "33607"},        # Веха: Major-GO
    "customfield_22304": {"id": "128809"},       # Приоритет (число): 3
    "customfield_24500": {"id": "280501"},       # Роль в ПСИ: Участник ПСИ
    "customfield_35800": {"id": "348403"},       # Источник: Команда
    "customfield_35801": {"id": "348405"},       # Флаг: Нет
    "customfield_22400": [{"id": IT_SERVICE["id"]}],  # ИТ-услуга: Платформа Сопровождения Sber911
    # customfield_17704 (Тип дефекта: Киберуязвимость 328502) НЕ дефолтим:
    # помечать каждый дефект киберуязвимостью неверно — включить одной строкой при необходимости.
}

# id поля КЭ и Epic Link в SBER911 (используются, если createmeta их не отдал)
FIELD_KE = "customfield_18300"
FIELD_EPIC_LINK = "customfield_10006"
