"""
Агент-генератор тест-кейсов.
Принимает требование -> ищет похожие эталоны -> генерирует тест-кейсы в XML (Zephyr).
"""

from __future__ import annotations

import os
import json
import re
from pathlib import Path
from typing import List, Dict, Optional

from dotenv import load_dotenv
from gigachat import GigaChat
from gigachat.models import Chat, Messages, MessagesRole

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "db"))
from vector_store import VectorStore

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class TestGeneratorAgent:

    SYSTEM_PROMPT = """Ты — старший QA-инженер в крупном банке. Твоя задача — генерировать тест-кейсы по требованиям.

ПРАВИЛА:
1. Генерируй тест-кейсы ТОЛЬКО в формате XML для Zephyr Scale (TM4J)
2. Каждый тест-кейс ДОЛЖЕН содержать:
   - name: формат "ПЛАТФОРМА [ФИЧА] Краткое описание"
   - objective: что именно проверяем
   - precondition: предусловия с конкретными данными
   - steps: шаги с разделением проверок на UI/API/БД
3. В expectedResult используй HTML-разметку:
   - <strong>UI</strong>, <strong>API</strong>, <strong>БД</strong> для категорий
   - <ul><li> для списка проверок
4. В precondition и testData указывай КОНКРЕТНЫЕ значения (ID, статусы, имена)
5. Покрывай ВСЕ ветвления логики из требования (if/else/enum значения)
6. Для каждого enum-значения создавай ОТДЕЛЬНЫЙ тест-кейс
7. Учитывай граничные значения и негативные сценарии
8. customFields ВСЕГДА включают: Автоматизирован, Вид тестирования, Крит. регресс, Домен, Команда, АС

ФОРМАТ ОТВЕТА — только валидный XML без markdown-обёрток:
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<testCases>
  <testCase>
    <name><![CDATA[...]]></name>
    <objective><![CDATA[...]]></objective>
    <precondition><![CDATA[...]]></precondition>
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
          <description><![CDATA[...]]></description>
          <expectedResult><![CDATA[<strong>UI</strong><ul><li>...</li></ul>]]></expectedResult>
          <testData><![CDATA[...]]></testData>
        </step>
      </steps>
    </testScript>
  </testCase>
</testCases>"""

    def __init__(self, auth_key: Optional[str] = None):
        self.auth_key = auth_key or os.getenv("GIGACHAT_AUTH_KEY", "")
        self.scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
        self.vs = VectorStore()

        if self.auth_key:
            self.llm = GigaChat(
                credentials=self.auth_key,
                scope=self.scope,
                verify_ssl_certs=True
            )
        else:
            self.llm = None

    def generate(
        self,
        requirement: str,
        platform: str = "W",
        feature: str = "",
        domain: str = "Omega",
        team: str = "Канальный агент и агенты эксперты [00G10014]",
        system: str = "РМДС [CI04663743]",
        folder: str = "Новая ТМ",
        n_etalons: int = 3,
        max_test_cases: int = 10,
    ) -> Dict:

        req_types = self._classify_requirement(requirement)

        similar_pairs = self.vs.find_similar_pairs(
            query=requirement, n_results=n_etalons,
            platform=platform
        )

        similar_reqs = self.vs.find_similar_requirements(
            query=requirement, n_results=n_etalons,
            platform=platform
        )

        prompt = self._build_prompt(
            requirement=requirement,
            req_types=req_types,
            similar_pairs=similar_pairs,
            similar_reqs=similar_reqs,
            platform=platform,
            feature=feature,
            domain=domain,
            team=team,
            system=system,
            folder=folder,
            max_test_cases=max_test_cases
        )

        if not self.llm:
            return {
                "xml": "",
                "prompt": prompt,
                "test_cases_count": 0,
                "etalons_used": len(similar_pairs),
                "requirement_types": req_types,
                "error": "GigaChat AUTH_KEY не задан. Установите GIGACHAT_AUTH_KEY в .env",
                "similar_pairs": [
                    {"id": p["id"], "distance": p["distance"]}
                    for p in similar_pairs
                ],
            }

        xml_response = self._call_llm(prompt, domain, team, system, folder)
        tc_count = xml_response.count("<testCase")

        return {
            "xml": xml_response,
            "test_cases_count": tc_count,
            "etalons_used": len(similar_pairs),
            "requirement_types": req_types,
            "similar_pairs": [
                {"id": p["id"], "distance": p["distance"]}
                for p in similar_pairs
            ],
        }

    def _classify_requirement(self, text: str) -> List[str]:
        types = []
        lower = text.lower()
        patterns = {
            "business_logic": ["если", "в случае", "при условии", "когда", "то отображается", "проверяется"],
            "api_method": ["метод", "request", "response", "path:", "путь:", "http", "параметры request"],
            "data_model": ["таблица", "varchar", "int8", "timestamp", "поле в бд", "enum:"],
            "ui_requirement": ["кнопка", "модальное окно", "отображается", "страница", "лейбл", "информационное окно"],
            "sequence": ["sequence", "последовательность", "поток", "участники:", "диаграмма"],
            "notification": ["уведомлен", "notification", "push", "template_ready"],
            "scope": ["scope", "на странице представлены"],
        }
        for req_type, keywords in patterns.items():
            if any(kw in lower for kw in keywords):
                types.append(req_type)
        return types or ["unknown"]

    def _build_prompt(self, requirement, req_types, similar_pairs, similar_reqs,
                      platform, feature, domain, team, system, folder, max_test_cases):

        etalons_text = ""
        if similar_pairs:
            etalons_text = "\n\n=== ЭТАЛОННЫЕ ПРИМЕРЫ (используй как образец стиля и структуры) ===\n"
            for i, pair in enumerate(similar_pairs, 1):
                etalons_text += f"\n--- Эталон {i} (distance={pair['distance']:.4f}) ---\n"
                etalons_text += f"ТРЕБОВАНИЕ:\n{pair['document']}\n"
                if pair.get("metadata", {}).get("test_case_xml"):
                    etalons_text += f"ТЕСТ-КЕЙС:\n{pair['metadata']['test_case_xml']}\n"

        context_text = ""
        if similar_reqs:
            context_text = "\n\n=== КОНТЕКСТ: ПОХОЖИЕ ТРЕБОВАНИЯ ИЗ СИСТЕМЫ ===\n"
            for i, req in enumerate(similar_reqs, 1):
                context_text += f"\n--- Контекст {i} ---\n{req['document'][:300]}\n"

        return f"""ЗАДАЧА: Сгенерировать тест-кейсы по следующему требованию.

ПЛАТФОРМА: {platform}
ФИЧА: {feature}
ТИПЫ БЛОКОВ В ТРЕБОВАНИИ: {', '.join(req_types)}
МАКСИМУМ ТЕСТ-КЕЙСОВ: {max_test_cases}

=== ТРЕБОВАНИЕ ===
{requirement}
{etalons_text}
{context_text}

ИНСТРУКЦИИ:
1. Проанализируй требование и определи ВСЕ сценарии для тестирования
2. Для каждого ветвления (if/else/enum) создай ОТДЕЛЬНЫЙ тест-кейс
3. Добавь граничные значения и негативные сценарии
4. Используй стиль и структуру из эталонных примеров
5. В name используй формат: {platform} [{feature}] Описание
6. В precondition указывай конкретные тестовые данные
7. Разделяй проверки на UI/API/БД в expectedResult

Сгенерируй XML с тест-кейсами:"""

    def _call_llm(self, prompt, domain, team, system, folder):
        system_prompt = self.SYSTEM_PROMPT.format(
            domain=domain, team=team, system=system, folder=folder
        )

        response = self.llm.chat(Chat(
            messages=[
                Messages(role=MessagesRole.SYSTEM, content=system_prompt),
                Messages(role=MessagesRole.USER, content=prompt),
            ],
            temperature=0.3,
            max_tokens=8000,
        ))

        raw = response.choices[0].message.content
        raw = re.sub(r"^```xml\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw.strip())
        return raw

    def generate_preview(self, requirement: str, **kwargs) -> str:
        result = self.generate(requirement, **kwargs)
        preview = []
        preview.append("=" * 60)
        preview.append("ПРЕВЬЮ ГЕНЕРАЦИИ ТЕСТ-КЕЙСОВ")
        preview.append("=" * 60)
        preview.append(f"\nТипы блоков: {', '.join(result['requirement_types'])}")
        preview.append(f"Эталонов найдено: {result['etalons_used']}")

        if result.get("similar_pairs"):
            preview.append("\nНайденные эталонные пары:")
            for p in result["similar_pairs"]:
                preview.append(f"  [{p['id']}] distance={p['distance']:.4f}")

        if result.get("error"):
            preview.append(f"\n⚠️  {result['error']}")

        if result.get("xml"):
            preview.append(f"\n✅ Сгенерировано тест-кейсов: {result['test_cases_count']}")
            preview.append("\n--- XML (первые 1000 символов) ---")
            preview.append(result["xml"][:1000])

        return "\n".join(preview)

    def get_stats(self) -> Dict:
        db_stats = self.vs.get_stats()
        return {
            "llm": "GigaChat",
            "auth_key_set": bool(self.auth_key),
            "db": db_stats,
        }

