# SimpleC — Генератор тест-кейсов для Jira Zephyr

## Обновлено: 2026-02-14

## Описание
Генератор тест-кейсов из требований с использованием LLM.
Формат: Zephyr XML для импорта в Jira.

## Структура
SimpleC/
├── app.py                         # Streamlit UI
├── .env                           # API ключи
├── agents/
│   ├── llm_client.py              # LLM клиент (5 провайдеров)
│   ├── single_case_generator.py   # Генератор с автопродолжением
│   └── gigachat_agent.py          # Legacy

## Провайдеры LLM
| Провайдер  | Статус | Модель |
|------------|--------|--------|
| LM Studio  | OK     | Rnj-1  |
| Ollama     | OK     | llama3.1:8b |
| GigaChat   | 402    | - |
| DeepSeek   | 402    | - |
| OpenAI     | -      | gpt-4o-mini |

## Запуск
source .venv/bin/activate
streamlit run app.py

## Ключевые фичи
- Автопродолжение при обрыве XML (до 5 попыток)
- Принудительное закрытие незакрытых тегов
- 10 типов тест-кейсов по приоритету
- Генерация по глубине (3/5/7/10 кейсов)

## Типы кейсов
1. Позитивный основной (Happy Path)
2. Позитивный альтернативный
3. Негативный: валидация
4. Негативный: права доступа
5. Граничный: минимум
6. Граничный: максимум
7. Краевой: пустые/null
8. Краевой: спецсимволы
9. Интеграционный
10. Обработка ошибок

## Быстрый тест
python3 -c "
from agents.llm_client import LLMClient, Message
llm = LLMClient('lmstudio')  # или 'ollama'
r = llm.chat([Message(role='user', content='Hi')])
print(r.content)
"

## История
2026-02-14: Добавлен LM Studio, автопродолжение XML
