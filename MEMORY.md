# SimpleC — Генератор тест-кейсов для Jira Zephyr

## Обновлено: 2026-02-14 (вечер)

---

## Описание
Инструмент для автоматической генерации тест-кейсов из требований с использованием LLM.
Целевая архитектура: 3-слойная генерация. Текущий UI пока на старых компонентах.

---

## Структура проекта

```
SimpleC/
├── app.py                         # Streamlit UI (СТАРАЯ логика, нужна переделка)
├── cli_layered.py                 # CLI для 3-слойной генерации (NEW)
├── tc_formatter.py                # Парсер/форматтер XML
├── .env                           # API ключи
├── requirements.txt               # Зависимости
├── MEMORY.md                      # Этот файл
├── agents/
│   ├── __init__.py
│   ├── llm_client.py              # LLM клиент (GigaChat, DeepSeek, Ollama, LM Studio)
│   ├── layered_generator.py       # 3-слойный генератор + cases_to_xml (NEW, НЕ подключен к UI)
│   ├── prompt_templates.py        # 5 шаблонов по типам (NEW, detect работает, промпты НЕ передаются)
│   ├── single_case_generator.py   # Генератор XML по одному кейсу (СТАРЫЙ, используется в app.py)
│   ├── qa_doc_generator.py        # QA документация (СТАРЫЙ, используется в app.py)
│   ├── test_generator.py          # Legacy генератор (СТАРЫЙ, используется в app.py)
│   ├── file_parser.py             # Парсер файлов
│   ├── prompt_guard.py            # Защита промптов
│   └── gigachat_agent.py          # Legacy агент
└── db/
    ├── feedback_store.py          # Хранилище оценок
    ├── vector_store.py            # ChromaDB эталоны
    ├── secure_config.py           # Валидация .env
    ├── audit_log.py               # Аудит действий
    └── team_store.py              # Список команд
```

---

## LLM Провайдеры (OpenAI удалён)

| Провайдер | Тип | Переменная .env | Примечание |
|-----------|-----|-----------------|------------|
| GigaChat | Облачный | GIGACHAT_CREDENTIALS | scope=GIGACHAT_API_PERS |
| DeepSeek | Облачный | DEEPSEEK_API_KEY | deepseek-chat |
| Ollama | Локальный | — | llama3.1:latest |
| LM Studio | Локальный | LMSTUDIO_URL (опц.) | localhost:1234 |

---

## Текущее состояние UI (app.py) — СТАРАЯ ЛОГИКА

### Сейчас работает так:
```
Tab 1 Требования:
  Ввод текста / загрузка файлов
  -> detect_type (определяет тип, но результат НЕ используется в промптах)
  -> QADocGenerator.generate() — СТАРЫЙ генератор QA дока
  -> SingleCaseGenerator.generate_single() — генерит XML по одному кейсу
  -> Показывает QA док + Лайк/Дизлайк отдельно

Tab 2 Тест-кейсы:
  -> Показывает XML таблицей
  -> Скачать XML / CSV (БЕЗ формы обвязки, всё захардкожено)
  -> Лайк/Дизлайк отдельно
  -> Если оба лайка -> предложение добавить в эталоны

Tab 3 Эталоны:
  -> ChromaDB, загрузка/просмотр/удаление эталонов

Tab 4 О системе:
  -> Статистика
```

### Проблемы текущего UI:
1. НЕ использует layered_generator.py (3-слойный)
2. НЕ передаёт результат detect_type в промпты генерации
3. XML обвязка захардкожена, нет формы для редактирования полей
4. QA док и кейсы на разных табах, два отдельных лайка
5. Глубины не совпадают с layered_generator (Атомарные 30-50 vs Full 10-15)

---

## Целевая логика UI (TODO — переделать app.py)

### Этап 1: Генерация
```
Пользователь вводит:
  - Требование (текст / файл)
  - Система / Фича
  - Глубина (smoke / sanity / regression / full)
  - Провайдер LLM

Нажимает Генерировать
  -> prompt_templates.detect_type() определяет тип
  -> prompt_templates.get_enhanced_prompt() формирует спец. промпт
  -> layered_generator:
       Слой 1: QA документация
       Слой 2: Список кейсов (JSON)
       Слой 3: Каждый кейс в Markdown

На экране появляются 2 блока:
  +-----------------------------------+
  | QA Документация                   |
  | (описание, сценарии, данные)      |
  +-----------------------------------+
  | Markdown тест-кейсы               |
  | (шаги с UI / API / БД)            |
  +-----------------------------------+
  |  Like        Dislike              |
  +-----------------------------------+

  Like = переход к Этапу 2
  Dislike = перегенерация
```

### Этап 2: XML обвязка + Экспорт (после лайка)
```
Появляется форма:
  +-----------------------------------+
  | Настройки XML для Zephyr          |
  |                                   |
  | Проект:  [SBER911            ]    |
  | Домен:   [Omega              ]    |
  | Команда: [QA                 ]    |
  | АС:      [System             ]    |
  | Папка:   [Новая ТМ           ]    |
  |                                   |
  |  [ Экспорт XML ]                  |
  +-----------------------------------+

  -> layered_generator.cases_to_xml() формирует XML
  -> Скачивается .xml файл для импорта в Jira Zephyr
```

---

## 3-слойный генератор (layered_generator.py)

### Слой 1: QA Документация
- Вход: требование + фича
- Выход: Markdown
- Содержит: описание, предусловия, позитивные/негативные сценарии, тестовые данные, точки интеграции

### Слой 2: Список кейсов
- Вход: QA док + глубина + system + feature
- Выход: JSON массив
- Формат: [{name, priority, type}]
- Количество зависит от глубины

### Слой 3: Детальные кейсы
- Вход: один элемент из списка + QA док (контекст)
- Выход: Markdown с 3-5 шагами
- Каждый шаг: действие + тестовые данные + UI/API/БД

### Экспорт XML
- Метод: cases_to_xml()
- Вход: список TestCaseMarkdown + метаданные (project, system, team, domain, folder)
- Выход: Zephyr XML

---

## Автоопределение типа (prompt_templates.py)

| Тип | Ключевые слова | Специфика промпта |
|-----|----------------|-------------------|
| API | api, rest, endpoint, post, json, status | HTTP методы, статус коды, headers, body |
| UI | экран, кнопка, форма, нажать, ввести | Действия пользователя, валидация форм |
| Бизнес-логика | если/то, расчёт, лимит, комиссия | Ветвления, формулы, матрица покрытия |
| Интеграции | kafka, очередь, webhook, синхронизация | Retry, идемпотентность, таймауты |
| Безопасность | авторизация, роль, токен, xss | Роли x действия, injection, шифрование |

По умолчанию: бизнес-логика.

---

## Глубина тестирования

### В layered_generator.py (НОВАЯ):
| Глубина | Кейсов |
|---------|--------|
| smoke | 1-5 |
| sanity | 5-7 |
| regression | 7-10 |
| full | 10-15 |

### В app.py (СТАРАЯ — нужно синхронизировать):
| Глубина | Кейсов |
|---------|--------|
| Smoke | 1-5 |
| Общие | 5-15 |
| Детальные | 15-30 |
| Атомарные | 30-50 |

---

## Формат XML (Zephyr)

```xml
<?xml version='1.0' encoding='UTF-8'?>
<testCases>
  <testCase id='...' key='PROJECT-T...'>
    <project><![CDATA[PROJECT]]></project>
    <priority><![CDATA[Normal]]></priority>
    <status><![CDATA[Черновик]]></status>
    <customFields>
      <customField name='Крит. регресс' type='CHECKBOX'>
        <value><![CDATA[false]]></value>
      </customField>
      <customField name='Домен' type='MULTI_CHOICE_SELECT_LIST'>
        <value><![CDATA[Omega]]></value>
      </customField>
      <customField name='Команда' type='SINGLE_CHOICE_SELECT_LIST'>
        <value><![CDATA[QA]]></value>
      </customField>
      <customField name='АС' type='SINGLE_CHOICE_SELECT_LIST'>
        <value><![CDATA[System]]></value>
      </customField>
    </customFields>
    <name><![CDATA[[System][Feature] Название]]></name>
    <folder><![CDATA[Новая ТМ]]></folder>
    <testScript type='steps'>
      <steps>
        <step index='0'>
          <description><![CDATA[Действие]]></description>
          <testData><![CDATA[Данные]]></testData>
          <expectedResult><![CDATA[UI: ...<br/><br/>API: ...<br/><br/>БД: ...]]></expectedResult>
        </step>
      </steps>
    </testScript>
  </testCase>
</testCases>
```

---

## Типы кейсов

| # | Тип | Приоритет |
|---|-----|-----------|
| 1 | Позитивный основной (Happy Path) | Critical |
| 2 | Позитивный альтернативный | High |
| 3 | Негативный: валидация данных | High |
| 4 | Негативный: права доступа | High |
| 5 | Граничный: минимум | Normal |
| 6 | Граничный: максимум | Normal |
| 7 | Краевой: пустые/null | Normal |
| 8 | Краевой: спецсимволы | Low |
| 9 | Интеграционный | Normal |
| 10 | Обработка ошибок | Normal |

---

## Как запустить

```bash
cd /Users/stefanzastylov/Documents/SimpleC
source .venv/bin/activate

# Web UI (старая логика, но работает)
streamlit run app.py

# CLI 3-слойный (новая логика)
python3 cli_layered.py
```

---

## История изменений

### 2026-02-14 (вечер)
- Создан layered_generator.py (3 слоя + cases_to_xml)
- Создан prompt_templates.py (5 типов, автоопределение)
- Создан cli_layered.py
- Удалён OpenAI из llm_client.py
- Оставлены: GigaChat, DeepSeek, Ollama, LM Studio
- Добавлен scope=GIGACHAT_API_PERS
- Определена целевая логика UI (2 этапа: генерация + XML обвязка)

### 2026-02-14 (день)
- Автопродолжение при обрыве XML (MAX_CONTINUATIONS=5)
- SingleCaseGenerator

---

## TODO (по приоритету)

### 1. Переделать app.py на новую логику
- [ ] Заменить SingleCaseGenerator + QADocGenerator на LayeredGenerator
- [ ] Подключить prompt_templates (передавать enhanced prompt в генератор)
- [ ] Объединить QA док + MD кейсы на одном экране
- [ ] Один лайк/дизлайк вместо двух
- [ ] Форма XML обвязки после лайка (проект, домен, команда, АС, папка)
- [ ] Синхронизировать глубины (smoke/sanity/regression/full)

### 2. Прочее
- [ ] Тест полного цикла: требование -> XML файл
- [ ] Batch режим (несколько фич)
- [ ] Интеграция с Jira API