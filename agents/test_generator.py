"""
test_generator — агент генерации тест-кейсов.
RAG + GigaChat для создания XML в формате Zephyr Scale.
"""

import os
import re
import time
from pathlib import Path
from typing import List, Dict, Optional

from dotenv import load_dotenv
from gigachat import GigaChat
from agents.llm_client import LLMClient, Message
from agents.prompt_templates import PromptTemplateManager
from gigachat.models import Chat, Messages, MessagesRole

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "db"))
from vector_store import VectorStore

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class TestGeneratorAgent:

    SYSTEM_PROMPT = """Ты — старший QA-инженер в крупном банке. Генерируй тест-кейсы по требованиям.

КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ НАЗВАНИЙ:
1. Название ДОЛЖНО быть ПОНЯТНЫМ и ЧИТАЕМЫМ на русском языке
2. Формат: "ПЛАТФОРМА [Функция] Понятное описание действия"
3. ПРИМЕРЫ ХОРОШИХ названий:
   - "W [Транскрибация] Проверка успешной транскрибации звонка"
   - "M [Авторизация] Вход с корректным паролем"
   - "A [Переводы] Перевод между своими счетами"
4. ЗАПРЕЩЕНО: аббревиатуры ТКС, непонятные сокращения, транслит

КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ ШАГОВ:
1. ШАГ 0 ОБЯЗАТЕЛЬНО — Начальные действия/Подготовка:
   - Описание: "Подготовка тестовых данных и начальные действия"
   - testData: ВСЕ конкретные данные (ID, логины, суммы, статусы)
   - expectedResult: "Данные подготовлены, система готова к тестированию"

2. КАЖДЫЙ последующий шаг ДОЛЖЕН содержать:
   - description: ЧТО делает тестировщик (глагол в повелительном наклонении)
   - testData: КОНКРЕТНЫЕ значения для этого шага
   - expectedResult: ЧТО должно произойти (с разделением UI/API/БД)

3. Шаги должны быть АТОМАРНЫМИ — одно действие = один шаг

ФОРМАТ expectedResult с HTML:
<strong>UI:</strong>
<ul><li>Отображается сообщение "Операция успешна"</li></ul>
<strong>API:</strong>
<ul><li>Статус 200, поле status="SUCCESS"</li></ul>
<strong>БД:</strong>
<ul><li>Запись в таблице transactions создана</li></ul>

ПОКРЫТИЕ ТРЕБОВАНИЙ:
- Все ветвления if/else — отдельные кейсы
- Все enum-значения — отдельные кейсы
- Граничные значения (мин/макс)
- Негативные сценарии (ошибки, пустые данные)

ФОРМАТ XML (Zephyr Scale TM4J):
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<testCases>
  <testCase>
    <name><![CDATA[W [Функция] Понятное название теста]]></name>
    <objective><![CDATA[Цель: проверить что именно]]></objective>
    <precondition><![CDATA[1. Пользователь авторизован
2. Доступ к функции есть
3. Тестовые данные созданы]]></precondition>
    <priority><![CDATA[Normal]]></priority>
    <status><![CDATA[Черновик]]></status>
    <customFields>
      <customField name="Автоматизирован" type="SINGLE_CHOICE_SELECT_LIST">
        <value><![CDATA[Нет]]></value>
      </customField>
      <customField name="Вид тестирования" type="SINGLE_CHOICE_SELECT_LIST">
        <value><![CDATA[Новый функционал]]></value>
      </customField>
      <customField name="Крит. регресс" type="CHECKBOX">
        <value><![CDATA[true]]></value>
      </customField>
      <customField name="Домен" type="MULTI_CHOICE_SELECT_LIST">
        <value><![CDATA[{domain}]]></value>
      </customField>
      <customField name="Команда" type="SINGLE_CHOICE_SELECT_LIST">
        <value><![CDATA[{team}]]></value>
      </customField>
      <customField name="АС" type="SINGLE_CHOICE_SELECT_LIST">
        <value><![CDATA[{system}]]></value>
      </customField>
    </customFields>
    <folder><![CDATA[{folder}]]></folder>
    <testScript type="steps">
      <steps>
        <step index="0">
          <description><![CDATA[Подготовка тестовых данных и начальные действия]]></description>
          <testData><![CDATA[user_id=12345, account="40817810000000000001", amount=1000.00]]></testData>
          <expectedResult><![CDATA[Данные подготовлены, система готова к тестированию]]></expectedResult>
        </step>
        <step index="1">
          <description><![CDATA[Открыть страницу функции]]></description>
          <testData><![CDATA[URL: /app/feature]]></testData>
          <expectedResult><![CDATA[<strong>UI:</strong><ul><li>Страница загружена</li><li>Форма отображается</li></ul>]]></expectedResult>
        </step>
      </steps>
    </testScript>
  </testCase>
</testCases>

ОТВЕЧАЙ ТОЛЬКО ВАЛИДНЫМ XML БЕЗ MARKDOWN-ОБЁРТОК!

КРИТИЧЕСКИ ВАЖНО:
- Генерируй НЕ БОЛЕЕ 5-7 тест-кейсов за раз
- ВСЕГДА завершай XML тегом </testCases>
- КАЖДЫЙ тег должен быть закрыт: </testCase>, </steps>, </testScript>
- КАЖДАЯ CDATA секция должна быть закрыта: ]]>
- НЕ ОБРЫВАЙ ответ посередине
- Лучше меньше тест-кейсов, но полностью завершённых"""

    def __init__(self, auth_key: Optional[str] = None, provider: str = "gigachat"):
        self.auth_key = auth_key or os.getenv("GIGACHAT_AUTH_KEY", "")
        self.scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
        self.provider = provider
        self.vs = VectorStore()
        
        # Универсальный LLM клиент
        self.llm_client = LLMClient(provider)
        
        # GigaChat для обратной совместимости
        if self.auth_key:
            self.llm = GigaChat(
                timeout=120,
                credentials=self.auth_key,
                scope=self.scope,
                verify_ssl_certs=False
            )
        else:
            self.llm = None

    def generate(
        self,
        requirement: str,
        platform: str = "W",
        feature: str = "Функционал",
        depth: str = "normal",
        domain: str = "Домен",
        team: str = "Команда",
        system: str = "АС",
        folder: str = "Папка",
        n_etalons: int = 3,
        max_test_cases: int = 10
    ) -> Dict:
        """Генерирует тест-кейсы по требованию."""
        if not self.llm:
            return {
                "xml": "",
                "count": 0,
                "error": "GigaChat не инициализирован"
            }

        # Получаем похожие примеры из RAG
        examples = self._get_rag_examples(requirement, platform, feature)

        # Формируем промпт
        user_prompt = self._build_user_prompt(
            requirement, platform, feature, depth, examples
        )

        # Вызываем LLM
        xml_response = self._call_llm(
            user_prompt, domain, team, system, folder
        )

        # Парсим результат
        count = self._count_test_cases(xml_response)

        return {
            "xml": xml_response,
            "count": count,
            "error": "" if count > 0 else "Не удалось сгенерировать"
        }

    def _get_rag_examples(
        self, requirement: str, platform: str, feature: str
    ) -> str:
        """Получает похожие примеры из векторной БД."""
        examples = []

        # Ищем похожие требования
        try:
            similar_reqs = self.vs.search_requirements(
                requirement, n_results=2
            )
            if similar_reqs:
                for doc in similar_reqs[:2]:
                    examples.append(
                        "Похожее требование:\n" + doc[:500]
                    )
        except Exception:
            pass

        # Ищем похожие пары требование-тесткейс
        try:
            similar_pairs = self.vs.search_pairs(
                requirement, n_results=2
            )
            if similar_pairs:
                for doc in similar_pairs[:2]:
                    examples.append(
                        "Пример тест-кейса:\n" + doc[:1000]
                    )
        except Exception:
            pass

        if examples:
            return "\n\n---\n\n".join(examples)
        return ""

    def _build_user_prompt(
        self,
        requirement: str,
        platform: str,
        feature: str,
        depth: str,
        examples: str
    ) -> str:
        """Формирует пользовательский промпт."""
        depth_instruction = {
            "smoke": "Только 3-5 критичных позитивных сценария.",
            "normal": "Основные позитивные и негативные сценарии, 8-12 кейсов.",
            "deep": "Полное покрытие: все ветвления, граничные значения, 15-25 кейсов."
        }.get(depth, "Основные сценарии.")

        prompt = f"""ТРЕБОВАНИЕ ДЛЯ ТЕСТИРОВАНИЯ:
{requirement}

ПАРАМЕТРЫ:
- Платформа: {platform}
- Функция: {feature}
- Глубина: {depth_instruction}

ВАЖНО:
1. Название каждого теста: "{platform} [{feature}] Понятное описание"
2. Шаг 0 ОБЯЗАТЕЛЬНО — подготовка данных с КОНКРЕТНЫМИ значениями
3. Каждый шаг — атомарное действие
4. expectedResult разделять на UI/API/БД где применимо
"""

        if examples:
            prompt += f"""

ПРИМЕРЫ ИЗ БАЗЫ ЗНАНИЙ (используй как образец стиля):
{examples}
"""

        prompt += "\n\nСгенерируй тест-кейсы в формате XML:"
        return prompt

    def _call_llm(
        self,
        prompt: str,
        domain: str,
        team: str,
        system: str,
        folder: str
    ) -> str:
        """Вызывает GigaChat и возвращает XML."""
        system_prompt = self.SYSTEM_PROMPT.format(
            domain=domain, team=team, system=system, folder=folder
        )

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = self.llm.chat(Chat(
                    messages=[
                        Messages(role=MessagesRole.SYSTEM, content=system_prompt),
                        Messages(role=MessagesRole.USER, content=prompt),
                    ],
                    temperature=0.3,
                    max_tokens=8192,
                ))

                content = response.choices[0].message.content
                
                # Проверяем, не обрезан ли ответ
                finish_reason = getattr(response.choices[0], 'finish_reason', None)
                if finish_reason == 'length':
                    content += "\n<!-- ВНИМАНИЕ: Ответ был обрезан из-за лимита токенов -->"
                
                # Убираем markdown обёртки
                content = re.sub(r"```xml\s*", "", content)
                content = re.sub(r"```\s*$", "", content)
                content = content.strip()
                return content

            except Exception as e:
                if '429' in str(e) and attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                return f"<!-- Ошибка: {str(e)} -->"

    def _count_test_cases(self, xml_text: str) -> int:
        """Считает количество тест-кейсов."""
        return len(re.findall(r"<testCase", xml_text))


    def get_stats(self) -> Dict:
        """Возвращает статистику RAG-базы и состояние LLM."""
        try:
            vs_stats = self.vs.get_stats()
            db_stats = {
                "requirements": vs_stats.get("requirements", 0),
                "test_cases": vs_stats.get("test_cases", 0),
                "pairs": vs_stats.get("pairs", 0),
            }
        except Exception:
            db_stats = {
                "requirements": 0,
                "test_cases": 0,
                "pairs": 0,
            }
        
        return {
            "db": db_stats,
            "auth_key_set": bool(self.auth_key),
        }
