"""
Генератор тест-кейсов по одному с автопродолжением при обрыве XML.
"""

from typing import List, Optional, Callable
import re

class SingleCaseGenerator:
    
    CASE_TYPES = [
        {"name": "Позитивный основной (Happy Path)", "priority": "High", "critical": True},
        {"name": "Позитивный альтернативный", "priority": "Normal", "critical": False},
        {"name": "Негативный: валидация данных", "priority": "Normal", "critical": False},
        {"name": "Негативный: права доступа", "priority": "Normal", "critical": False},
        {"name": "Граничный: минимум", "priority": "Low", "critical": False},
        {"name": "Граничный: максимум", "priority": "Low", "critical": False},
        {"name": "Краевой: пустые/null", "priority": "Low", "critical": False},
        {"name": "Краевой: спецсимволы", "priority": "Low", "critical": False},
        {"name": "Интеграционный", "priority": "Normal", "critical": False},
        {"name": "Обработка ошибок", "priority": "Normal", "critical": False},
    ]
    
    MAX_CONTINUATIONS = 5
    
    def __init__(self, llm_client):
        self.llm = llm_client
    
    def _is_xml_complete(self, xml: str) -> bool:
        """Проверяет что XML полностью закрыт."""
        if not xml or not xml.strip():
            return False
        
        xml_clean = xml.strip()
        
        # Должен заканчиваться на </testCase>
        if not xml_clean.rstrip().endswith("</testCase>"):
            return False
        
        # Проверяем баланс основных тегов
        required_tags = ["testCase", "project", "name", "testScript", "steps"]
        for tag in required_tags:
            opens = len(re.findall(f"<{tag}[^/]*>", xml_clean))
            closes = len(re.findall(f"</{tag}>", xml_clean))
            if opens != closes:
                return False
        
        return True
    
    def _force_close_xml(self, xml: str) -> str:
        """Принудительно закрывает незакрытые теги."""
        if not xml:
            return xml
        
        # Теги в порядке закрытия (изнутри наружу)
        tags_order = [
            "expectedResult", "testData", "description", "step",
            "steps", "testScript", "value", "customField", 
            "customFields", "testCase"
        ]
        
        result = xml.rstrip()
        
        for tag in tags_order:
            opens = len(re.findall(f"<{tag}[^/>]*>", result))
            closes = len(re.findall(f"</{tag}>", result))
            
            while opens > closes:
                # Закрываем CDATA если нужно
                if result.count("<![CDATA[") > result.count("]]>"):
                    result += "]]>"
                result += f"</{tag}>"
                closes += 1
        
        return result
    
    def generate_single(self, requirement: str, case_type: dict, 
                       platform: str = "W", feature: str = "Feature",
                       domain: str = "Omega", team: str = "QA",
                       system: str = "System", folder: str = "Новая ТМ") -> Optional[str]:
        """Генерирует один тест-кейс с автопродолжением ТОЛЬКО при обрыве."""
        
        from agents.llm_client import Message
        
        prompt = f"""Сгенерируй ОДИН тест-кейс в формате Zephyr XML.

ТРЕБОВАНИЕ: {requirement}

ТИП КЕЙСА: {case_type["name"]}
ПРИОРИТЕТ: {case_type["priority"]}
КРИТИЧНЫЙ: {"Да" if case_type["critical"] else "Нет"}

ПАРАМЕТРЫ:
- Платформа: {platform}
- Фича: {feature}
- Домен: {domain}
- Команда: {team}
- Система: {system}
- Папка: {folder}

ФОРМАТ XML (СТРОГО):
<testCase id="14710028" key="SBER911-T14710028">
    <project><![CDATA[SBER911]]></project>
    <owner><![CDATA[16538296]]></owner>
    <priority><![CDATA[{case_type["priority"]}]]></priority>
    <status><![CDATA[Черновик]]></status>
    <customFields>
        <customField name="Крит. регресс" type="CHECKBOX">
            <value><![CDATA[{"true" if case_type["critical"] else "false"}]]></value>
        </customField>
        <customField name="Вид тестирования" type="SINGLE_CHOICE_SELECT_LIST">
            <value><![CDATA[Новый функционал]]></value>
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
    <name><![CDATA[[{system}][{feature}] Название проверки]]></name>
    <folder><![CDATA[{folder}]]></folder>
    <testScript type="steps">
        <steps>
            <step index="0">
                <description><![CDATA[Действие шага]]></description>
                <testData><![CDATA[Тестовые данные]]></testData>
                <expectedResult><![CDATA[UI: Ожидаемый результат<br/><br/>API: Метод и путь<br/><br/>БД: Изменения в таблице]]></expectedResult>
            </step>
        </steps>
    </testScript>
</testCase>

ВАЖНО:
1. Верни ТОЛЬКО XML, без пояснений
2. ОБЯЗАТЕЛЬНО закрой тег </testCase> в конце
3. Шаги должны быть детальными с UI/API/БД проверками
"""
        
        messages = [Message(role="user", content=prompt)]
        
        try:
            response = self.llm.chat(messages, temperature=0.7, max_tokens=3000)
            content = response.content.strip()
            
            # Извлекаем XML
            if "<testCase" in content:
                start = content.find("<testCase")
                content = content[start:]
            
            # Проверяем - нужно ли продолжение?
            if self._is_xml_complete(content):
                print(f"  OK Generated {len(content)} chars (complete)")
                return content
            
            # XML не закрыт - делаем продолжение
            for attempt in range(self.MAX_CONTINUATIONS):
                print(f"  -> Continuation {attempt + 1}/{self.MAX_CONTINUATIONS}...")
                
                cont_prompt = f"""Продолжи XML точно с места обрыва.
Текущий контент:
{content[-1500:]}

ПРОДОЛЖИ и ЗАКРОЙ все теги до </testCase>"""
                
                cont_response = self.llm.chat(
                    [Message(role="user", content=cont_prompt)],
                    temperature=0.3,
                    max_tokens=2000
                )
                
                continuation = cont_response.content.strip()
                
                # Убираем дубли если модель повторила часть
                if continuation.startswith("<"):
                    last_tag = re.search(r"<(\w+)[^>]*>(?!.*<\1)", content[-200:])
                    if last_tag:
                        tag = last_tag.group(1)
                        if f"<{tag}" in continuation[:100]:
                            idx = continuation.find(f"</{tag}>")
                            if idx > 0:
                                continuation = continuation[idx:]
                
                content += continuation
                
                # Проверяем после продолжения
                if self._is_xml_complete(content):
                    print(f"  OK Generated {len(content)} chars (after {attempt + 1} continuations)")
                    return content
            
            # Не удалось завершить - принудительно закрываем
            print(f"  ! Forcing close tags")
            content = self._force_close_xml(content)
            return content
            
        except Exception as e:
            print(f"  ERROR: {e}")
            return None
    
    @staticmethod
    def bundle_to_files(cases: List[str], cases_per_file: int = 10) -> List[str]:
        """Собирает кейсы в XML файлы."""
        if not cases:
            return []
        
        files = []
        for i in range(0, len(cases), cases_per_file):
            batch = cases[i:i + cases_per_file]
            xml = "<testCases>\n" + "\n".join(batch) + "\n</testCases>"
            files.append(xml)
        
        return files
