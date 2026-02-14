# SimpleC — Генератор тест-кейсов для Jira Zephyr

## Обновлено: 2026-02-14

## Описание
Инструмент для автоматической генерации тест-кейсов из требований с использованием LLM. Генерирует XML в формате Zephyr для импорта в Jira.

## Структура проекта
SimpleC/
├── app.py                         # Streamlit UI
├── .env                           # API ключи
├── requirements.txt               # Зависимости
├── PROJECT_MEMORY.md              # Этот файл
└── agents/
    ├── __init__.py
    ├── llm_client.py              # Универсальный LLM клиент
    ├── single_case_generator.py   # Генератор с автопродолжением
    └── gigachat_agent.py          # Legacy агент

## Установка и запуск
cd SimpleC
python3 -m venv .venv
source .venv/bin/activate
pip install streamlit gigachat httpx ollama
ollama serve &
ollama pull llama3.1:8b
streamlit run app.py

## LLM Провайдеры
- Ollama: РАБОТАЕТ, бесплатно, локально, llama3.1:8b
- GigaChat: 402 Payment Required
- DeepSeek: 402 Insufficient Balance
- OpenAI: не тестировался

## Ключевые компоненты

### LLMClient (agents/llm_client.py)
Универсальный клиент для работы с разными LLM провайдерами.
Поддерживает: ollama, gigachat, deepseek, openai

### SingleCaseGenerator (agents/single_case_generator.py)
Генератор тест-кейсов с автопродолжением при обрыве ответа.
- MAX_CONTINUATIONS = 5 попыток продолжить
- Проверяет закрытие всех XML тегов
- Принудительно закрывает если не удалось

### Типы генерируемых кейсов (по приоритету)
1. Позитивный основной (Happy Path) — критичный
2. Позитивный альтернативный
3. Негативный: валидация данных
4. Негативный: права доступа
5. Граничный: минимум
6. Граничный: максимум
7. Краевой: пустые/null
8. Краевой: спецсимволы
9. Интеграционный
10. Обработка ошибок

## Формат XML тест-кейса
<testCase id="14710028" key="SBER911-T14710028">
    <project><![CDATA[SBER911]]></project>
    <owner><![CDATA[16538296]]></owner>
    <priority><![CDATA[Normal]]></priority>
    <status><![CDATA[Черновик]]></status>
    <customFields>
        <customField name="Крит. регресс" type="CHECKBOX">
            <value><![CDATA[false]]></value>
        </customField>
        <customField name="Вид тестирования" type="SINGLE_CHOICE_SELECT_LIST">
            <value><![CDATA[Новый функционал]]></value>
        </customField>
        <customField name="Домен" type="MULTI_CHOICE_SELECT_LIST">
            <value><![CDATA[Omega]]></value>
        </customField>
        <customField name="Команда" type="SINGLE_CHOICE_SELECT_LIST">
            <value><![CDATA[QA]]></value>
        </customField>
        <customField name="АС" type="SINGLE_CHOICE_SELECT_LIST">
            <value><![CDATA[System]]></value>
        </customField>
    </customFields>
    <name><![CDATA[[System][Feature] Название проверки]]></name>
    <folder><![CDATA[Новая ТМ]]></folder>
    <testScript type="steps">
        <steps>
            <step index="0">
                <description><![CDATA[Шаг действия]]></description>
                <testData><![CDATA[Тестовые данные]]></testData>
                <expectedResult><![CDATA[UI: Описание<br/><br/>API: Method /path<br/><br/>БД: Таблица]]></expectedResult>
            </step>
        </steps>
    </testScript>
</testCase>

## Быстрый тест
python3 -c "
from agents.llm_client import LLMClient
from agents.single_case_generator import SingleCaseGenerator
llm = LLMClient('ollama')
gen = SingleCaseGenerator(llm)
result = gen.generate_single(
    requirement='Авторизация по логину и паролю',
    case_type=gen.CASE_TYPES[0],
    feature='AUTH',
    system='Test'
)
print('OK!' if result else 'FAIL')
"

## Исправления 2026-02-14
- Добавлено автопродолжение при обрыве XML (MAX_CONTINUATIONS=5)
- UI теперь использует выбранный провайдер (строка 470 app.py)
- Ollama работает как основной бесплатный провайдер
- SingleCaseGenerator генерирует ровно N кейсов по глубине

## Известные проблемы
- GigaChat/DeepSeek требуют пополнения баланса
- Ollama медленнее облачных API (30-60 сек на кейс)
- llama3.1:8b иногда генерирует неполные шаги

## TODO
- Добавить поддержку других моделей Ollama
- Кэширование результатов
- Параллельная генерация
- Валидация XML перед экспортом
- Интеграция с Jira API



