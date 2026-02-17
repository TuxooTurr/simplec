"""
Layered generator v2.
Layer 1: QA documentation
Layer 2: Case list (depth-aware)
Layer 3: Markdown cases (template-enhanced)
Layer 4: LLM XML wrapping
"""

from typing import List, Optional
from dataclasses import dataclass


@dataclass
class TestCaseMarkdown:
    """Test case in Markdown format."""
    name: str
    steps: List[dict]
    priority: str = "Normal"
    case_type: str = "positive"

    def to_markdown(self) -> str:
        lines = [f"## {self.name}", f"**Приоритет:** {self.priority}", ""]
        for i, step in enumerate(self.steps, 1):
            lines.append(f"**Шаг {i}:** {step.get('action', '')}")
            lines.append(f"- Тестовые данные: {step.get('test_data', '-')}")
            lines.append(f"- Результат:")
            lines.append(f"  - UI: {step.get('ui', '-')}")
            lines.append(f"  - API: {step.get('api', '-')}")
            lines.append(f"  - БД: {step.get('db', '-')}")
            lines.append("")
        return "\n".join(lines)


class LayeredGenerator:
    """3-layer generator with depth-aware case generation."""

    DEPTH_MAP = {
        "smoke": {
            "min": 1, "max": 5,
            "name": "Smoke (1-5 e2e кейсов)",
            "description": "Полноценные e2e тест-кейсы с множеством шагов. "
                           "Проверяют основной сквозной сценарий от начала до конца. "
                           "Каждый кейс содержит 5-10 детальных шагов.",
            "steps_per_case": "5-10 шагов",
            "focus": "E2E сквозные сценарии, happy path с полной проверкой всех слоёв",
            "case_style": "Полноценные многошаговые кейсы"
        },
        "regression": {
            "min": 5, "max": 10,
            "name": "Regression (5-10 кейсов)",
            "description": "Основные сценарии + негативные кейсы. "
                           "Покрывают happy path, основные ошибки, валидацию.",
            "steps_per_case": "3-7 шагов",
            "focus": "Основные позитивные + ключевые негативные сценарии",
            "case_style": "Смесь позитивных и негативных кейсов"
        },
        "full": {
            "min": 11, "max": 30,
            "name": "Full (11-30 кейсов)",
            "description": "Полное покрытие тестовой модели. "
                           "Все ветвления логики, граничные значения, интеграции, безопасность.",
            "steps_per_case": "3-5 шагов",
            "focus": "Полная тестовая модель: все ветки, границы, роли, ошибки",
            "case_style": "Детальное покрытие каждого аспекта"
        },
        "atomary": {
            "min": 31, "max": 100,
            "name": "Atomary (31-100 кейсов)",
            "description": "Атомарные проверки по 1 шагу. "
                           "Максимально детальное покрытие каждого параметра, поля, условия.",
            "steps_per_case": "1 шаг",
            "focus": "Каждый параметр, каждое поле, каждое условие = отдельный кейс в 1 шаг",
            "case_style": "Атомарные одношаговые проверки"
        }
    }

    def __init__(self, llm_client):
        self.llm = llm_client

    # ========================================================
    # LAYER 1: QA Documentation
    # ========================================================
    def generate_qa_doc(self, requirement, feature=""):
        from agents.llm_client import Message
        from agents.prompt_templates import PromptTemplateManager

        detected_types = PromptTemplateManager.detect_type(requirement)
        type_names = PromptTemplateManager.get_template_names()
        types_str = ", ".join([type_names.get(t, t) for t in detected_types])

        prompt = (
            "Ты Senior QA-аналитик. Создай подробную документацию для тестирования.\n"
            "Пиши так, чтобы Junior тестировщик мог по ней работать без дополнительных вопросов.\n\n"
            "ТРЕБОВАНИЕ:\n" + requirement + "\n\n"
            "ФИЧА: " + feature + "\n"
            "ОПРЕДЕЛЁННЫЙ ТИП: " + types_str + "\n\n"
            "Напиши документ в Markdown по структуре:\n\n"
            "# QA Документация: " + feature + "\n\n"
            "## 1. Описание услуги/функционала\n"
            "- Что делает функционал простым языком\n"
            "- Для кого предназначен (роли пользователей)\n"
            "- Бизнес-ценность\n\n"
            "## 2. Потоки данных\n"
            "- Откуда приходят данные (источники)\n"
            "- Куда уходят (получатели)\n"
            "- Формат данных на каждом этапе\n"
            "- Схема: Пользователь -> UI -> API -> Сервис -> БД -> Ответ\n\n"
            "## 3. API логика\n"
            "- Какие эндпоинты задействованы (метод, URL, параметры)\n"
            "- Формат запросов и ответов\n"
            "- Коды ошибок и их значение\n"
            "- Авторизация и заголовки\n\n"
            "## 4. Логика работы БД\n"
            "- Какие таблицы затрагиваются\n"
            "- Какие записи создаются/обновляются/удаляются\n"
            "- Связи между таблицами\n"
            "- Триггеры и констрейнты\n\n"
            "## 5. Бизнес-правила\n"
            "- ВСЕ условия (если/то/иначе) из требований\n"
            "- Формулы расчётов с примерами\n"
            "- Лимиты и ограничения\n"
            "- Статусные переходы\n\n"
            "## 6. Предусловия для тестирования\n"
            "- Что должно быть настроено\n"
            "- Тестовые учётные записи и роли\n"
            "- Тестовые данные (конкретные примеры)\n"
            "- Доступы и окружение\n\n"
            "## 7. Тестовые сценарии (обзор)\n"
            "### Позитивные\n"
            "- Happy path (основной сценарий)\n"
            "- Альтернативные успешные сценарии\n\n"
            "### Негативные\n"
            "- Ошибки валидации\n"
            "- Ошибки авторизации\n"
            "- Граничные случаи\n"
            "- Недоступность зависимостей\n\n"
            "## 8. Точки проверки\n"
            "- Что проверять на UI\n"
            "- Что проверять в API ответах\n"
            "- Что проверять в БД\n"
            "- Что проверять в логах\n\n"
            "Пиши КОНКРЕТНО с примерами значений. Не абстрактно.\n"
            "Только Markdown."
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.7, max_tokens=3000)
        return response.content.strip()

    # ========================================================
    # LAYER 2: Case list (depth-aware)
    # ========================================================
    def generate_case_list(self, qa_doc, depth="smoke", system="", feature=""):
        from agents.llm_client import Message
        import json
        import re

        depth_info = self.DEPTH_MAP.get(depth, self.DEPTH_MAP["smoke"])

        depth_rules = {
            "smoke": (
                "- Только СКВОЗНЫЕ e2e сценарии\n"
                "- Каждый кейс проходит весь путь: UI -> API -> БД -> Ответ\n"
                "- Первый кейс = полный Happy Path\n"
                "- Остальные = ключевые альтернативные e2e пути\n"
                "- НЕ дробить на мелкие проверки"
            ),
            "regression": (
                "- Основные позитивные сценарии (happy path + альтернативы)\n"
                "- Ключевые негативные сценарии (ошибки валидации, авторизации)\n"
                "- Баланс: ~60% позитивных, ~40% негативных\n"
                "- Каждый кейс проверяет конкретный бизнес-сценарий"
            ),
            "full": (
                "- ВСЕ ветвления бизнес-логики = отдельный кейс\n"
                "- ВСЕ граничные значения\n"
                "- ВСЕ роли пользователей\n"
                "- ВСЕ коды ошибок API\n"
                "- Интеграционные сценарии\n"
                "- Проверки безопасности\n"
                "- Полная матрица покрытия"
            ),
            "atomary": (
                "- КАЖДЫЙ параметр = отдельный кейс\n"
                "- КАЖДОЕ поле формы = отдельный кейс\n"
                "- КАЖДОЕ граничное значение = отдельный кейс\n"
                "- КАЖДЫЙ код ответа API = отдельный кейс\n"
                "- КАЖДАЯ роль x действие = отдельный кейс\n"
                "- Кейсы максимально атомарные (1 проверка = 1 кейс)\n"
                "- Название кейса должно чётко указывать ЧТО проверяется"
            )
        }

        rules = depth_rules.get(depth, depth_rules["smoke"])

        prompt = (
            "Проанализируй QA документацию и создай список тест-кейсов.\n\n"
            "QA ДОКУМЕНТАЦИЯ:\n" + qa_doc + "\n\n"
            "ГЛУБИНА ТЕСТИРОВАНИЯ: " + depth_info["name"] + "\n"
            "ОПИСАНИЕ ГЛУБИНЫ: " + depth_info["description"] + "\n"
            "ФОКУС: " + depth_info["focus"] + "\n"
            "СТИЛЬ КЕЙСОВ: " + depth_info["case_style"] + "\n"
            "КОЛИЧЕСТВО КЕЙСОВ: от " + str(depth_info["min"]) + " до " + str(depth_info["max"]) + "\n\n"
            "ПРАВИЛА ДЛЯ ГЛУБИНЫ \"" + depth + "\":\n" + rules + "\n\n"
            "ФОРМАТ (JSON массив):\n"
            "[\n"
            '  {"name": "[' + system + '][' + feature + '] Название кейса", "priority": "High", "type": "positive"},\n'
            '  {"name": "[' + system + '][' + feature + '] Название кейса", "priority": "Normal", "type": "negative"}\n'
            "]\n\n"
            "ПРАВИЛА ИМЕНОВАНИЯ:\n"
            "- Первый кейс = Happy Path (High priority)\n"
            "- type: positive, negative, boundary, integration, security\n"
            "- priority: High (критичные), Normal (основные), Low (дополнительные)\n\n"
            "Верни ТОЛЬКО JSON массив. Никакого текста до или после."
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.5, max_tokens=4000)

        text = response.content.strip()
        match = re.search(r'\$$.*\$$', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass

        return [
            {"name": "[" + system + "][" + feature + "] Основной сценарий", "priority": "High", "type": "positive"},
            {"name": "[" + system + "][" + feature + "] Валидация данных", "priority": "Normal", "type": "negative"},
        ]

    # ========================================================
    # LAYER 3: Markdown cases (template-enhanced)
    # ========================================================
    def generate_case_markdown(self, case_info, qa_doc, depth="smoke"):
        from agents.llm_client import Message
        from agents.prompt_templates import PromptTemplateManager
        import re

        depth_info = self.DEPTH_MAP.get(depth, self.DEPTH_MAP["smoke"])
        enhanced = PromptTemplateManager.get_enhanced_prompt(qa_doc)

        step_instructions = {
            "atomary": "Напиши РОВНО 1 шаг. Этот кейс атомарный — одна конкретная проверка.",
            "smoke": "Напиши 5-10 шагов. Это e2e кейс — пройди весь путь от начала до конца.",
            "regression": "Напиши 3-7 шагов. Покрой основной сценарий с проверками.",
            "full": "Напиши 3-5 шагов."
        }
        step_instr = step_instructions.get(depth, "Напиши 3-5 шагов.")

        case_name = case_info["name"]
        case_type = case_info.get("type", "positive")
        case_prio = case_info.get("priority", "Normal")

        prompt = (
            "Ты Senior QA-инженер. Напиши детальный тест-кейс.\n"
            "Пиши так, чтобы Junior тестировщик мог выполнить без вопросов.\n\n"
            "НАЗВАНИЕ: " + case_name + "\n"
            "ТИП: " + case_type + "\n"
            "ПРИОРИТЕТ: " + case_prio + "\n\n"
            "КОНТЕКСТ (QA документация):\n" + qa_doc[:2000] + "\n\n"
            + enhanced + "\n\n"
            "КОЛИЧЕСТВО ШАГОВ: " + step_instr + "\n\n"
            "ФОРМАТ (строго соблюдай):\n\n"
            "## " + case_name + "\n\n"
            "**Шаг 1:** Конкретное действие\n"
            "- Тестовые данные: конкретные значения\n"
            "- Результат:\n"
            "  - UI: что видит пользователь\n"
            "  - API: метод, endpoint, статус код\n"
            "  - БД: таблица, запись, значения\n\n"
            "ВАЖНО:\n"
            "- Тестовые данные = КОНКРЕТНЫЕ значения\n"
            "- UI = что ВИДИТ пользователь\n"
            "- API = конкретный endpoint и ответ\n"
            "- БД = конкретная таблица и поля\n"
            "- Если для шага уровень не применим, пиши \"-\"\n\n"
            "Только Markdown. Без пояснений."
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.7, max_tokens=2500)

        return self._parse_markdown(response.content, case_info)

    def _parse_markdown(self, text, case_info):
        import re
        steps = []

        if text.strip().startswith('```'):
            text = re.sub(r'```\w*', '', text)

        step_pattern = r'\*\*Шаг\s*(\d+):\*\*\s*(.+?)(?=\*\*Шаг\s*\d+:\*\*|$)'
        matches = re.findall(step_pattern, text, re.DOTALL)

        for num, block in matches:
            lines = block.strip().split(chr(10))
            action = lines[0].strip() if lines else "Действие"

            step = {"action": action, "test_data": "-", "ui": "-", "api": "-", "db": "-"}

            for line in block.split(chr(10)):
                line_lower = line.lower().strip()
                if "тестовые данные" in line_lower:
                    val = line.split(":", 1)[-1].strip()
                    step["test_data"] = val if val else "-"
                elif line_lower.startswith("- ui:") or line_lower.startswith("ui:"):
                    val = line.split(":", 1)[-1].strip()
                    step["ui"] = val if val else "-"
                elif line_lower.startswith("- api:") or line_lower.startswith("api:"):
                    val = line.split(":", 1)[-1].strip()
                    step["api"] = val if val else "-"
                elif any(x in line_lower for x in ["бд:", "db:", "база данных:"]):
                    val = line.split(":", 1)[-1].strip()
                    step["db"] = val if val else "-"

            steps.append(step)

        if not steps:
            steps = [{"action": "Не удалось распарсить ответ LLM", "test_data": "-", "ui": "-", "api": "-", "db": "-"}]

        return TestCaseMarkdown(
            name=case_info["name"],
            steps=steps,
            priority=case_info.get("priority", "Normal"),
            case_type=case_info.get("type", "positive")
        )

    # ========================================================
    # LAYER 4: LLM XML wrapping (HTML-formatted steps)
    # ========================================================
    def wrap_case_to_xml_via_llm(self, case, qa_doc,
                                  project="SBER911", system="",
                                  team="", domain="",
                                  folder="Новая ТМ"):
        from agents.llm_client import Message
        import random

        cid = random.randint(10000000, 99999999)
        md_text = case.to_markdown()
        critical = "true" if case.priority == "High" else "false"
        case_key = project + "-T" + str(cid)

        xml_template = (
            '<testCase id="' + str(cid) + '" key="' + case_key + '">\n'
            '    <project><![CDATA[' + project + ']]></project>\n'
            '    <priority><![CDATA[' + case.priority + ']]></priority>\n'
            '    <status><![CDATA[Черновик]]></status>\n'
            '    <customFields>\n'
            '        <customField name="Крит. регресс" type="CHECKBOX">\n'
            '            <value><![CDATA[' + critical + ']]></value>\n'
            '        </customField>\n'
            '        <customField name="Домен" type="MULTI_CHOICE_SELECT_LIST">\n'
            '            <value><![CDATA[' + domain + ']]></value>\n'
            '        </customField>\n'
            '        <customField name="Команда" type="SINGLE_CHOICE_SELECT_LIST">\n'
            '            <value><![CDATA[' + team + ']]></value>\n'
            '        </customField>\n'
            '        <customField name="АС" type="SINGLE_CHOICE_SELECT_LIST">\n'
            '            <value><![CDATA[' + system + ']]></value>\n'
            '        </customField>\n'
            '    </customFields>\n'
            '    <name><![CDATA[' + case.name + ']]></name>\n'
            '    <folder><![CDATA[' + folder + ']]></folder>'
        )

        prompt = (
            "Ты эксперт по Zephyr Scale XML. Преобразуй Markdown тест-кейс в XML шаги.\n\n"
            "ТЕСТ-КЕЙС (Markdown):\n" + md_text + "\n\n"
            "КОНТЕКСТ (QA документация):\n" + qa_doc[:1500] + "\n\n"
            "Сгенерируй ТОЛЬКО блок <testScript> с шагами в формате:\n\n"
            "<testScript type=\"steps\">\n"
            "    <steps>\n"
            '        <step index="0">\n'
            "            <description><![CDATA[Действие тестировщика]]></description>\n"
            "            <testData><![CDATA[Конкретные тестовые данные]]></testData>\n"
            "            <expectedResult><![CDATA[\n"
            "<strong>UI:</strong>\n"
            "<ul><li>что видит пользователь</li></ul>\n"
            "<strong>API:</strong>\n"
            "<ul><li>метод, endpoint, статус, ответ</li></ul>\n"
            "<strong>БД:</strong>\n"
            "<ul><li>таблица, запись, значения</li></ul>\n"
            "            ]]></expectedResult>\n"
            "        </step>\n"
            "    </steps>\n"
            "</testScript>\n\n"
            "ПРАВИЛА:\n"
            "1. expectedResult форматируй HTML: <strong>, <ul>, <li>, <br/>\n"
            "2. testData — конкретные значения, URL, параметры, JSON\n"
            "3. description — чёткое действие для Junior тестировщика\n"
            "4. Если UI/API/БД не применимо — не включай этот блок в expectedResult\n"
            "5. index шагов начинается с 0\n\n"
            "Верни ТОЛЬКО <testScript>...</testScript>. Без пояснений."
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.3, max_tokens=3000)

        script_xml = response.content.strip()
        if script_xml.startswith("```"):
            import re
            script_xml = re.sub(r"^```\w*\n?", "", script_xml)
            script_xml = re.sub(r"\n?```$", "", script_xml)
            script_xml = script_xml.strip()

        return xml_template + "\n    " + script_xml + "\n</testCase>"

    def wrap_all_cases_via_llm(self, cases, qa_doc,
                                project="SBER911", system="",
                                team="", domain="",
                                folder="Новая ТМ",
                                progress_callback=None):
        xml_parts = []
        total = len(cases)

        for i, case in enumerate(cases):
            if progress_callback:
                progress_callback(i, total, case.name)

            case_xml = self.wrap_case_to_xml_via_llm(
                case, qa_doc, project=project, system=system,
                team=team, domain=domain, folder=folder
            )
            xml_parts.append(case_xml)

        combined = "\n".join(xml_parts)
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<testCases>\n"
            + combined + "\n"
            "</testCases>"
        )

    # ========================================================
    # FALLBACK: Simple XML (no LLM)
    # ========================================================
    def cases_to_xml(self, cases, project="SBER911",
                     system="", team="", domain="",
                     folder="Новая ТМ"):
        import random

        xml_parts = []
        for case in cases:
            cid = random.randint(10000000, 99999999)
            critical = "true" if case.priority == "High" else "false"

            steps_xml = ""
            for i, s in enumerate(case.steps):
                exp = "UI: " + s["ui"] + "<br/><br/>API: " + s["api"] + "<br/><br/>БД: " + s["db"]
                steps_xml += (
                    '\n            <step index="' + str(i) + '">'
                    "\n                <description><![CDATA[" + s["action"] + "]]></description>"
                    "\n                <testData><![CDATA[" + s["test_data"] + "]]></testData>"
                    "\n                <expectedResult><![CDATA[" + exp + "]]></expectedResult>"
                    "\n            </step>"
                )

            xml_parts.append(
                '<testCase id="' + str(cid) + '" key="' + project + '-T' + str(cid) + '">\n'
                '    <project><![CDATA[' + project + ']]></project>\n'
                '    <priority><![CDATA[' + case.priority + ']]></priority>\n'
                '    <status><![CDATA[Черновик]]></status>\n'
                '    <customFields>\n'
                '        <customField name="Крит. регресс" type="CHECKBOX">\n'
                '            <value><![CDATA[' + critical + ']]></value>\n'
                '        </customField>\n'
                '        <customField name="Домен" type="MULTI_CHOICE_SELECT_LIST">\n'
                '            <value><![CDATA[' + domain + ']]></value>\n'
                '        </customField>\n'
                '        <customField name="Команда" type="SINGLE_CHOICE_SELECT_LIST">\n'
                '            <value><![CDATA[' + team + ']]></value>\n'
                '        </customField>\n'
                '        <customField name="АС" type="SINGLE_CHOICE_SELECT_LIST">\n'
                '            <value><![CDATA[' + system + ']]></value>\n'
                '        </customField>\n'
                '    </customFields>\n'
                '    <name><![CDATA[' + case.name + ']]></name>\n'
                '    <folder><![CDATA[' + folder + ']]></folder>\n'
                '    <testScript type="steps">\n'
                '        <steps>' + steps_xml + '\n'
                '        </steps>\n'
                '    </testScript>\n'
                '</testCase>'
            )

        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<testCases>\n'
            + "\n".join(xml_parts) + "\n"
            + '</testCases>'
        )
