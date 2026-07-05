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
    estimated_minutes: int = 5

    def to_markdown(self) -> str:
        lines = [
            f"## {self.name}",
            f"**Приоритет:** {self.priority}",
            f"**Оценка времени прохождения:** {self.estimated_minutes} мин",
            "",
        ]
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
    def generate_qa_doc(self, requirement, feature="", context_docs=""):
        from agents.llm_client import Message
        from agents.prompt_templates import PromptTemplateManager

        detected_types = PromptTemplateManager.detect_type(requirement)
        type_names = PromptTemplateManager.get_template_names()
        types_str = ", ".join([type_names.get(t, t) for t in detected_types])

        context_block = ""
        if context_docs:
            context_block = (
                "КОНТЕКСТНЫЕ ДОКУМЕНТЫ (используй как дополнительный источник информации, "
                "эти документы содержат требования, спецификации и другую документацию проекта):\n"
                + context_docs + "\n\n"
                "---\n\n"
            )

        prompt = (
            "Ты — старший тестировщик и системный аналитик. Твоя задача — получить сырую техническую документацию "
            "(системные требования, спецификации, confluence-страницы, ТЗ) и преобразовать её в структурированный, понятный документ.\n\n"
            + context_block
            + "ФИЧА: " + feature + "\n"
            "ОПРЕДЕЛЁННЫЙ ТИП: " + types_str + "\n\n"
            "ДОКУМЕНТАЦИЯ:\n" + requirement + "\n\n"
            "---\n\n"
            "Напиши документ в Markdown строго по следующей структуре. "
            "Включай только те разделы, для которых есть информация в документации.\n\n"
            "## Что это такое простыми словами\n"
            "Что делает эта фича / система / модуль. Зачем она нужна (какую проблему решает). "
            "Кто ею пользуется (роли). Откуда берутся данные и куда уходят. "
            "Пиши так, чтобы новый человек в команде понял за 2 минуты. Без канцелярита.\n\n"
            "## Модель данных\n"
            "Для каждой таблицы / сущности: markdown-таблица полей (поле, тип, обязательность, описание), "
            "связи между таблицами. ER-диаграмма в PlantUML (`entity`, связи `||--o{`).\n\n"
            "## Диаграммы\n"
            "Для каждого значимого процесса / потока / алгоритма создай диаграмму PlantUML:\n"
            "- Activity — для алгоритмов и ветвлений\n"
            "- Sequence — для взаимодействия между компонентами (НЕ смешивать `package` и `participant`)\n"
            "- Component — для архитектурных схем (использовать `component`, НЕ `participant`)\n"
            "Правила: начинать с `@startuml`, заканчивать `@enduml`. "
            "Идентификаторы только латиницей. Для кириллики — алиасы: `participant \"Имя\" as Name`.\n\n"
            "## Условия и бизнес-логика\n"
            "Таблица: условие → результат. Важные правила и ограничения. "
            "Для сложной логики — activity-диаграмма с ветвлениями.\n\n"
            "## API методы\n"
            "Сначала сводная таблица всех методов. Для каждого: назначение, роли/доступ, "
            "таблица параметров запроса (параметр, тип, обязательность, описание), "
            "таблица параметров ответа (параметр, тип, описание, источник данных).\n\n"
            "## Jobs / фоновые задачи\n"
            "Для каждого Job: что делает, периодичность, пошаговый алгоритм, какие таблицы читает и пишет.\n\n"
            "## Интеграции / потоки данных\n"
            "Для каждого потока: Источник → Канал → Приёмник, формат данных (топики Kafka, REST, файлы), "
            "параметры подключения. Sequence или component диаграмма.\n\n"
            "## Чек-лист проверок\n"
            "Единый плоский список ключевых проверок (не более 40 пунктов). Без подглавы и чекбоксов. "
            "Каждый пункт — одно утверждение, проверяемое как true/false. "
            "Покрывай ключевые функции, граничные случаи, негативные сценарии, формулы, статусы, условия доступа. "
            "Пиши утвердительно: «АС из списка исключений получают value=NULL» (не «проверить что...»).\n\n"
            "## Вопросы для уточнения\n"
            "Таблица: № | Вопрос | Приоритет (🔴 блокирует / 🟡 неясность / 🟢 мелочь). "
            "Только реальные противоречия, неясности и пропуски из документации.\n\n"
            "---\n"
            "Правила:\n"
            "- Не придумывай информацию, которой нет в документации\n"
            "- Не пиши «предположительно» — если неясно, добавь в вопросы для уточнения\n"
            "- Не дублируй одну и ту же информацию в разных разделах\n"
            "- Только Markdown"
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.7, max_tokens=4000)
        return response.content.strip()

    # ========================================================
    # LAYER 2: Case list (depth-aware)
    # ========================================================
    def generate_case_list(self, qa_doc, depth="smoke", system="", feature="", platform="W"):
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
            '  {"name": "[' + platform + '][' + feature + '] HappyPath. Описание основного сценария", "priority": "High", "type": "positive"},\n'
            '  {"name": "[' + platform + '][' + feature + '] Boundary. Описание граничного случая", "priority": "Normal", "type": "boundary"}\n'
            "]\n\n"
            "ПРАВИЛА ИМЕНОВАНИЯ:\n"
            "- Формат СТРОГО: [" + platform + "][" + feature + "] ГруппаПроверок. Наименование кейса\n"
            "- ГруппаПроверок — ОДНО слово из: HappyPath | Regression | Boundary | Security | Authorization | Integration | Error | Smoke\n"
            "- Наименование — конкретное, понятное Junior-тестировщику, без аббревиатур и технического жаргона\n"
            '- Пример хорошего названия: "[' + platform + '][' + feature + '] HappyPath. Пользователь успешно выполняет основное действие"\n'
            '- Пример плохого названия: "[' + platform + '][' + feature + '] TC_001_positive"\n'
            "- priority: High (критичные), Normal (основные), Low (дополнительные)\n"
            "- type: positive, negative, boundary, integration, security\n\n"
            "Верни ТОЛЬКО JSON массив. Никакого текста до или после."
        )

        # Токенов нужно: ~120 токенов на кейс + запас. Для atomary (100 кейсов) = ~14000
        _max_tokens = min(depth_info["max"] * 140 + 2000, 16000)
        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.5, max_tokens=_max_tokens)

        text = response.content.strip()

        # 1. Прямой парсинг — LLM вернул чистый JSON
        try:
            cases = json.loads(text)
            if isinstance(cases, list) and cases:
                return cases
        except Exception:
            pass

        # 2. Вырезаем JSON-массив из текста (LLM добавил пояснения вокруг)
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            try:
                cases = json.loads(match.group())
                if isinstance(cases, list) and cases:
                    return cases
            except Exception:
                pass

        # 3. Repair truncated JSON — ответ обрезан по max_tokens
        #    Берём всё от первой '[' и пытаемся починить незаконченный массив
        bracket_start = text.find('[')
        if bracket_start != -1:
            partial = text[bracket_start:]
            # Удаляем последний неполный объект (обрезан посередине)
            last_complete = partial.rfind('},')
            if last_complete == -1:
                last_complete = partial.rfind('}')
            if last_complete != -1:
                repaired = partial[:last_complete + 1] + "]"
                try:
                    cases = json.loads(repaired)
                    if isinstance(cases, list) and cases:
                        return cases
                except Exception:
                    pass

        # 4. Fallback — только если LLM совсем не справился
        return [
            {"name": "[" + platform + "][" + feature + "] HappyPath. Основной успешный сценарий", "priority": "High", "type": "positive"},
            {"name": "[" + platform + "][" + feature + "] Error. Ошибка при некорректных входных данных", "priority": "Normal", "type": "negative"},
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
            "ФОРМАТ — ОБЯЗАТЕЛЬНО использовать ТОЧНО такой синтаксис заголовков шагов:\n\n"
            "## " + case_name + "\n\n"
            "**Оценка времени прохождения:** 5 мин\n\n"
            "**Шаг 1:** Открыть браузер и перейти на страницу оформления заявки\n"
            "- Тестовые данные: URL https://example.ru/request\n"
            "- UI: Отображается форма заявки с обязательными полями\n"
            "- API: Запросов к API нет\n"
            "- БД: Изменений в БД нет\n\n"
            "**Шаг 2:** Заполнить обязательные поля и нажать «Отправить»\n"
            "- Тестовые данные: тип заявки=Консультация, описание=Тестовая заявка\n"
            "- UI: Отображается сообщение об успешном создании заявки\n"
            "- API: POST /api/requests → 201 Created, body: {\"id\": \"...\"}\n"
            "- БД: таблица requests содержит новую запись со статусом created\n\n"
            "КРИТИЧЕСКИ ВАЖНО:\n"
            "- Сразу после заголовка кейса ОБЯЗАТЕЛЬНО укажи строку **Оценка времени прохождения:** N мин — "
            "экспертная оценка в целых минутах, с учётом количества шагов И времени на подготовку тестовых данных "
            "(создание записей, ожидание статусов и т.п.)\n"
            "- Заголовок шага ВСЕГДА: **Шаг N:** (звёздочки, двоеточие — точно так)\n"
            "- После двоеточия — действие на той же строке\n"
            "- Строки UI / API / БД — всегда присутствуют, без дополнительных отступов\n"
            "- UI: что ВИДИТ пользователь — если нет изменений, пиши \"Визуальных изменений нет\"\n"
            "- API: метод, endpoint, статус — если нет запроса, пиши \"Запросов к API нет\"\n"
            "- БД: таблица и поле — если нет изменений, пиши \"Изменений в БД нет\"\n"
            "- Тестовые данные = КОНКРЕТНЫЕ значения, если данных нет — пиши \"Не требуются\"\n"
            "- НИКОГДА не пиши просто \"-\"\n"
            "- Описания должны быть понятны Junior-тестировщику\n\n"
            "Только Markdown. Без вводных слов и пояснений."
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.7, max_tokens=3000)
        text = response.content

        # Продолжение если LLM обрезал ответ по лимиту токенов (до 3 раз)
        for _ in range(3):
            if not self._is_truncated(text, response):
                break
            cont_prompt = (
                "Продолжи написание тест-кейса точно с того места, где текст оборвался.\n"
                "НЕ повторяй уже написанное — только продолжение.\n\n"
                "Уже написано:\n" + text + "\n\nПродолжай:"
            )
            response = self.llm.chat(
                [Message(role="user", content=cont_prompt)],
                temperature=0.7, max_tokens=2000,
            )
            if not response.content.strip():
                break
            text = text + "\n" + response.content

        return self._parse_markdown(text, case_info)

    def _is_truncated(self, text: str, response) -> bool:
        """True если ответ LLM обрезан по лимиту токенов."""
        import re
        # Точный сигнал от GigaChat
        if getattr(response, "finish_reason", "stop") == "length":
            return True
        stripped = text.rstrip()
        if len(stripped) < 300:
            return False
        last_line = stripped.split("\n")[-1].strip()
        if not last_line:
            return False
        # Считаем завершённым, если последняя строка — структурированное поле или конец предложения
        clean = (
            last_line.endswith((".", "!", "?", "–", "—")) or
            re.match(r"^-\s*(UI|API|БД|Тестовые данные|Данные)\s*:", last_line, re.IGNORECASE) or
            re.match(r"^-\s*(Изменений|Запросов|Визуальных|Не требуются)", last_line, re.IGNORECASE)
        )
        return not clean

    def _parse_markdown(self, text, case_info):
        import re

        # Strip code fences
        text = re.sub(r'```\w*\n?', '', text).strip()

        # ── Оценка времени прохождения (с учётом подготовки данных) ─────────
        estimated_minutes = 5
        time_match = re.search(
            r'оценка\s+времени\s+прохождени\S*[^\n:]*:\**\s*(\d+)\s*мин',
            text, re.IGNORECASE,
        )
        if time_match:
            estimated_minutes = int(time_match.group(1))

        # ── Step detection: try patterns from most to least strict ──────────
        # Each pattern captures (step_number, block_content)
        STEP_PATTERNS = [
            # **Шаг N:** или **Шаг N.**  (двоеточие/точка внутри **)
            r'\*\*Шаг\s*(\d+)\s*[:.]\*\*\s*(.+?)(?=\*\*Шаг\s*\d+\s*[:.]\*\*|\Z)',
            # **Шаг N**: или **Шаг N**.  (знак снаружи **)
            r'\*\*Шаг\s*(\d+)\*\*\s*[:.]\s*(.+?)(?=\*\*Шаг\s*\d+\*\*|\Z)',
            # ### Шаг N: или ## Шаг N
            r'#{1,3}\s+Шаг\s+(\d+)[:.]\s*(.+?)(?=#{1,3}\s+Шаг\s+\d+|\Z)',
            # Шаг N: (plain, без markdown)
            r'(?:^|\n)Шаг\s+(\d+)\s*[:.]\s*(.+?)(?=\nШаг\s+\d+\s*[:.]\s*|\Z)',
        ]

        matches = []
        for pattern in STEP_PATTERNS:
            matches = re.findall(pattern, text, re.DOTALL)
            if matches:
                break

        # ── Fallback: нумерованный список  1. / 1) ─────────────────────────
        if not matches:
            matches = re.findall(
                r'(?:^|\n)\s*(\d+)[.)]\s+(.+?)(?=\n\s*\d+[.)]\s+|\Z)',
                text, re.DOTALL
            )

        # ── Парсинг блоков шагов ────────────────────────────────────────────
        steps = []
        for _num, block in matches:
            lines = block.strip().split('\n')
            # Первая непустая строка — действие
            action = next((l.strip() for l in lines if l.strip()), "Действие")
            step = {"action": action, "test_data": "Не требуются", "ui": "Визуальных изменений нет", "api": "Запросов к API нет", "db": "Изменений в БД нет"}

            for line in lines:
                ls = line.strip()
                ll = ls.lower()
                if not ls or ll == action.lower():
                    continue
                if "тестовые данные" in ll or "test data" in ll:
                    val = ls.split(":", 1)[-1].strip()
                    if val:
                        step["test_data"] = val
                elif re.match(r'^-?\s*ui\s*:', ll):
                    val = ls.split(":", 1)[-1].strip()
                    if val:
                        step["ui"] = val
                elif re.match(r'^-?\s*api\s*:', ll):
                    val = ls.split(":", 1)[-1].strip()
                    if val:
                        step["api"] = val
                elif re.match(r'^-?\s*(бд|db|база данных)\s*:', ll):
                    val = ls.split(":", 1)[-1].strip()
                    if val:
                        step["db"] = val

            steps.append(step)

        # ── Крайний fallback: весь текст как один шаг ────────────────────────
        if not steps:
            first_meaningful = next(
                (l.strip() for l in text.split('\n') if l.strip() and not l.startswith('#')),
                text[:200].strip()
            )
            steps = [{"action": first_meaningful or "Требует уточнения",
                       "test_data": "Не требуются",
                       "ui": "Визуальных изменений нет",
                       "api": "Запросов к API нет",
                       "db": "Изменений в БД нет"}]

        return TestCaseMarkdown(
            name=case_info["name"],
            steps=steps,
            priority=case_info.get("priority", "Normal"),
            case_type=case_info.get("type", "positive"),
            estimated_minutes=estimated_minutes,
        )

    # ========================================================
    # LAYER 4: Zephyr Scale / TM4J XML export
    # ========================================================

    _CUSTOM_FIELD_TPL = (
        '        <customField name="{name}" type="{ftype}">\n'
        '            <value><![CDATA[{value}]]></value>\n'
        '        </customField>\n'
    )

    _DEFAULT_AUTHOR_NAME = "Застылов Стефан Александрович"
    _DEFAULT_AUTHOR_TAB_NUM = "16538296"
    _DEFAULT_PROJECT_ID = "11000"
    _DEFAULT_JIRA_VERSION = "9.12.27"
    _DEFAULT_START_ID = 14710101

    @staticmethod
    def _case_group(case_name: str) -> str:
        """Извлекает «Группу проверок» из названия кейса вида [Platform][Feature] Группа. Имя."""
        import re
        m = re.search(r'\]\s*([^.\[\]]+)\.', case_name)
        return m.group(1).strip() if m else ""

    def _fallback_script_xml(self, case) -> str:
        """Шаги без LLM — из уже распарсенных полей кейса (ui/api/db/test_data)."""
        steps_xml = []
        for i, s in enumerate(case.steps):
            exp = "UI: " + s.get("ui", "-") + "<br/>API: " + s.get("api", "-") + "<br/>БД: " + s.get("db", "-")
            data = "Что нужно: " + s.get("test_data", "-") + "<br/>SQL: не требуется"
            steps_xml.append(
                '        <step index="' + str(i) + '">\n'
                '            <customFields/>\n'
                '            <description><![CDATA[' + s.get("action", "") + ']]></description>\n'
                '            <expectedResult><![CDATA[' + exp + ']]></expectedResult>\n'
                '            <testData><![CDATA[' + data + ']]></testData>\n'
                '        </step>\n'
            )
        return '<testScript type="steps">\n    <steps>\n' + "".join(steps_xml) + '    </steps>\n</testScript>'

    def _assemble_testcase_xml(self, case, case_id, case_key, project, system, team, domain,
                                case_folder, critical, priority, objective_xml, precondition_xml,
                                script_xml, dt, author_name, author_tab_num) -> str:
        author_name = author_name or self._DEFAULT_AUTHOR_NAME
        author_tab_num = author_tab_num or self._DEFAULT_AUTHOR_TAB_NUM

        custom_fields = (
            '    <customFields>\n'
            + self._CUSTOM_FIELD_TPL.format(name="Команда", ftype="SINGLE_CHOICE_SELECT_LIST", value=team)
            + self._CUSTOM_FIELD_TPL.format(name="Вид тестирования", ftype="SINGLE_CHOICE_SELECT_LIST", value="Новый функционал")
            + self._CUSTOM_FIELD_TPL.format(name="АС", ftype="SINGLE_CHOICE_SELECT_LIST", value=system)
            + self._CUSTOM_FIELD_TPL.format(name="Автоматизирован", ftype="SINGLE_CHOICE_SELECT_LIST", value="Нет")
            + self._CUSTOM_FIELD_TPL.format(name="Крит. регресс", ftype="CHECKBOX", value=critical)
            + self._CUSTOM_FIELD_TPL.format(name="Домен", ftype="MULTI_CHOICE_SELECT_LIST", value=domain)
            + '    </customFields>\n'
        )

        return (
            '<testCase id="' + str(case_id) + '" key="' + case_key + '">\n'
            '    <attachments/>\n'
            '    <confluencePageLinks/>\n'
            '    <createdBy>' + author_name + '</createdBy>\n'
            '    <createdOn>' + dt + '</createdOn>\n'
            + custom_fields
            + '    <folder><![CDATA[' + case_folder + ']]></folder>\n'
            '    <issues/>\n'
            '    <labels/>\n'
            '    <name><![CDATA[' + case.name + ']]></name>\n'
            '    ' + objective_xml + '\n'
            '    <owner>' + author_tab_num + '</owner>\n'
            '    ' + precondition_xml + '\n'
            '    <priority><![CDATA[' + priority + ']]></priority>\n'
            '    <status><![CDATA[Черновик]]></status>\n'
            '    <parameters/>\n'
            '    ' + script_xml + '\n'
            '    <updatedBy>' + author_name + '</updatedBy>\n'
            '    <updatedOn>' + dt + '</updatedOn>\n'
            '</testCase>'
        )

    def _wrap_project_xml(self, case_xml_parts, folders_seen, project_id, project_key, jira_version, base_dt) -> str:
        folders_xml = "\n".join(
            '<folder fullPath="' + path + '" index="' + str(idx) + '"/>'
            for path, idx in folders_seen.items()
        )
        export_date = base_dt.strftime("%Y-%m-%d %H:%M:%S") + " UTC"
        combined = "\n".join(case_xml_parts)
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<project>\n'
            '<projectId>' + str(project_id) + '</projectId>\n'
            '<projectKey>' + project_key + '</projectKey>\n'
            '<modelVersion>1.0</modelVersion>\n'
            '<jiraVersion>' + jira_version + '</jiraVersion>\n'
            '<exportDate>' + export_date + '</exportDate>\n'
            '<folders>\n' + folders_xml + '\n</folders>\n'
            '<testCases>\n' + combined + '\n</testCases>\n'
            '</project>'
        )

    def wrap_case_to_xml_via_llm(self, case, qa_doc,
                                  project="SBER911", system="",
                                  team="", domain="",
                                  folder="Новая ТМ",
                                  crit_regress=False,
                                  case_id=None,
                                  created_on=None,
                                  author_name="",
                                  author_tab_num=""):
        from agents.llm_client import Message
        from datetime import datetime, timezone
        import re

        case_id = case_id or self._DEFAULT_START_ID
        md_text = case.to_markdown()
        priority = case.priority if case.priority in ("High", "Normal") else "Normal"
        critical = "true" if (crit_regress and case.priority == "High") else "false"
        case_key = project + "-T" + str(case_id)
        group = self._case_group(case.name)
        case_folder = folder + "/" + group if group else folder
        dt = (created_on or datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M:%S") + " UTC"

        prompt = (
            "Ты эксперт по Zephyr Scale / TM4J. На основе Markdown тест-кейса сформируй "
            "цель, предусловия и шаги в XML.\n\n"
            "ТЕСТ-КЕЙС (Markdown):\n" + md_text + "\n\n"
            "КОНТЕКСТ (QA документация):\n" + qa_doc[:1500] + "\n\n"
            "ОЦЕНКА ВРЕМЕНИ ПРОХОЖДЕНИЯ (уже посчитана, используй как есть): "
            + str(case.estimated_minutes) + " мин\n\n"
            "Сгенерируй ТОЛЬКО эти три блока:\n\n"
            "<objective><![CDATA[Что именно проверяет кейс — 1 короткое предложение<br/>"
            "Оценка времени прохождения (с учётом подготовки данных): "
            + str(case.estimated_minutes) + " мин]]></objective>\n"
            "<precondition><![CDATA[1. Первое предусловие<br/>2. Второе предусловие]]></precondition>\n"
            "<testScript type=\"steps\">\n"
            "    <steps>\n"
            '        <step index="0">\n'
            "            <customFields/>\n"
            "            <description><![CDATA[Действие тестировщика с конкретными данными]]></description>\n"
            "            <expectedResult><![CDATA[UI: что видит пользователь<br/>API: метод, endpoint, статус, ответ<br/>БД: таблица, поле, значение]]></expectedResult>\n"
            "            <testData><![CDATA[Что нужно: конкретные данные<br/>SQL: SELECT ... (или \"не требуется\", если БД не проверяется)]]></testData>\n"
            "        </step>\n"
            "    </steps>\n"
            "</testScript>\n\n"
            "ПРАВИЛА:\n"
            "1. objective — конкретная цель кейса, без воды, и обязательно вторая строка через <br/> с оценкой "
            "времени ровно как дано выше (" + str(case.estimated_minutes) + " мин) — не пересчитывай\n"
            "2. precondition — конкретные проверяемые предусловия (не «система работает», а что именно должно "
            "быть настроено/создано перед прогоном)\n"
            "3. expectedResult — ВСЕГДА три зоны UI/API/БД через <br/>, если зона неприменима — пиши внутри неё "
            "«Не требуется», саму зону не пропускай\n"
            "4. testData — «Что нужно: ...<br/>SQL: ...». SQL — рабочий SELECT под таблицы/поля из кейса, если "
            "проверка требует БД, иначе «SQL: не требуется»\n"
            "5. index шагов начинается с 0, количество шагов — как в исходном Markdown-кейсе\n"
            "6. Не добавляй <testCase>, <name>, <priority> и другие теги — только objective, precondition, testScript\n\n"
            "Верни ТОЛЬКО эти три блока. Без пояснений, без markdown-обёртки."
        )

        response = self.llm.chat([Message(role="user", content=prompt)],
                                  temperature=0.3, max_tokens=3500)
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```\w*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            raw = raw.strip()

        objective_m = re.search(r'<objective>.*?</objective>', raw, re.DOTALL)
        precondition_m = re.search(r'<precondition>.*?</precondition>', raw, re.DOTALL)
        script_m = re.search(r'<testScript.*?</testScript>', raw, re.DOTALL)

        objective_xml = objective_m.group(0) if objective_m else (
            "<objective><![CDATA[" + case.name + "<br/>Оценка времени прохождения (с учётом подготовки данных): "
            + str(case.estimated_minutes) + " мин]]></objective>"
        )
        precondition_xml = precondition_m.group(0) if precondition_m else (
            "<precondition><![CDATA[1. Тестовые данные подготовлены<br/>2. Пользователь имеет необходимые "
            "права доступа]]></precondition>"
        )
        script_xml = script_m.group(0) if script_m else self._fallback_script_xml(case)

        return self._assemble_testcase_xml(
            case=case, case_id=case_id, case_key=case_key,
            project=project, system=system, team=team, domain=domain,
            case_folder=case_folder, critical=critical, priority=priority,
            objective_xml=objective_xml, precondition_xml=precondition_xml, script_xml=script_xml,
            dt=dt, author_name=author_name, author_tab_num=author_tab_num,
        )

    def wrap_all_cases_via_llm(self, cases, qa_doc,
                                project="SBER911", system="",
                                team="", domain="",
                                folder="Новая ТМ",
                                progress_callback=None,
                                crit_regress=False,
                                project_id=None,
                                jira_version=None,
                                start_id=None,
                                author_name="",
                                author_tab_num=""):
        from datetime import datetime, timedelta, timezone

        total = len(cases)
        base_dt = datetime.now(timezone.utc)
        case_id = start_id or self._DEFAULT_START_ID
        xml_parts = []
        folders_seen: dict = {}

        for i, case in enumerate(cases):
            if progress_callback:
                progress_callback(i, total, case.name)

            created_on = base_dt + timedelta(minutes=i)
            case_xml = self.wrap_case_to_xml_via_llm(
                case, qa_doc, project=project, system=system,
                team=team, domain=domain, folder=folder,
                crit_regress=crit_regress, case_id=case_id,
                created_on=created_on, author_name=author_name, author_tab_num=author_tab_num,
            )
            xml_parts.append(case_xml)

            group = self._case_group(case.name)
            case_folder = folder + "/" + group if group else folder
            if case_folder not in folders_seen:
                folders_seen[case_folder] = len(folders_seen)

            case_id += 1

        return self._wrap_project_xml(
            xml_parts, folders_seen,
            project_id or self._DEFAULT_PROJECT_ID, project,
            jira_version or self._DEFAULT_JIRA_VERSION, base_dt,
        )

    # ========================================================
    # FALLBACK: Simple XML (no LLM)
    # ========================================================
    def cases_to_xml(self, cases, project="SBER911",
                     system="", team="", domain="",
                     folder="Новая ТМ", crit_regress=False,
                     project_id=None, jira_version=None, start_id=None,
                     author_name="", author_tab_num=""):
        from datetime import datetime, timedelta, timezone

        base_dt = datetime.now(timezone.utc)
        case_id = start_id or self._DEFAULT_START_ID
        xml_parts = []
        folders_seen: dict = {}

        for i, case in enumerate(cases):
            priority = case.priority if case.priority in ("High", "Normal") else "Normal"
            critical = "true" if (crit_regress and case.priority == "High") else "false"
            case_key = project + "-T" + str(case_id)
            group = self._case_group(case.name)
            case_folder = folder + "/" + group if group else folder
            if case_folder not in folders_seen:
                folders_seen[case_folder] = len(folders_seen)
            dt = (base_dt + timedelta(minutes=i)).strftime("%Y-%m-%d %H:%M:%S") + " UTC"

            objective_xml = (
                "<objective><![CDATA[" + case.name + "<br/>Оценка времени прохождения (с учётом подготовки данных): "
                + str(case.estimated_minutes) + " мин]]></objective>"
            )
            precondition_xml = (
                "<precondition><![CDATA[1. Тестовые данные подготовлены<br/>2. Пользователь имеет необходимые "
                "права доступа]]></precondition>"
            )
            script_xml = self._fallback_script_xml(case)

            xml_parts.append(self._assemble_testcase_xml(
                case=case, case_id=case_id, case_key=case_key,
                project=project, system=system, team=team, domain=domain,
                case_folder=case_folder, critical=critical, priority=priority,
                objective_xml=objective_xml, precondition_xml=precondition_xml, script_xml=script_xml,
                dt=dt, author_name=author_name, author_tab_num=author_tab_num,
            ))
            case_id += 1

        return self._wrap_project_xml(
            xml_parts, folders_seen,
            project_id or self._DEFAULT_PROJECT_ID, project,
            jira_version or self._DEFAULT_JIRA_VERSION, base_dt,
        )
