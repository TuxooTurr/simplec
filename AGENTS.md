# SimpleTest — инструкция для Codex

## Что это за проект

**SimpleTest** — веб-приложение для QA-инженеров. Генерирует тест-кейсы, оформляет баг-репорты, создаёт автотесты на Java, управляет алертами, метриками, ревизором стендов и запуском автотестов.

- **Бэкенд:** Python 3.10+, FastAPI, uvicorn, порт **8000**
- **Фронтенд:** Next.js App Router, TypeScript, Tailwind CSS, порт **3000**
- **БД:** SQLite (`simpletest.db`) + ChromaDB
- **LLM:** GigaChat, DeepSeek и пользовательские chat/completions-compatible подключения из UI
- **Авторизация:** Bearer-токен; 2 пользователя захардкожены в `backend/api/auth.py` (`Sber911`, `SberMonitoring`, пароль `1234567`), сессии in-memory

## Как запустить локально

### macOS / Linux / Conda

```bash
# Первый раз
bash install.sh

# Каждый раз
bash start.sh
```

### Вручную

```bash
# Бэкенд
source .venv/bin/activate
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# Фронтенд
npm run dev --prefix frontend -- --hostname 127.0.0.1 --port 3000
```

> На macOS с несколькими Python всегда запускай uvicorn через `python -m uvicorn`.

## Настройки и секреты

- Основные настройки редактируются в UI: `/settings`.
- GigaChat и DeepSeek поддерживают `api_key` и `certificate`.
- Дополнительные LLM добавляются через UI.
- Kafka для метрик и алертов настраивается через UI, включая SASL/SSL/mTLS поля.
- Ревизор подключает стенды через UI: имя стенда, Base URL, auth и выбранные методы.

В этом репозитории конфигурация может храниться в проекте, потому что целевой запуск рассчитан на закрытый корпоративный контур.

## Структура проекта

```text
SimpleTest/
├── backend/
│   ├── main.py
│   └── api/
│       ├── generation.py
│       ├── bugs.py
│       ├── autotests_gen.py
│       ├── autotest_runs.py
│       ├── alerts.py
│       ├── metrics_settings.py
│       ├── revisor.py
│       ├── etalons.py
│       └── app_settings.py
├── frontend/
│   ├── app/
│   ├── components/
│   │   ├── sections/
│   │   └── AutotestRunPanel.tsx
│   ├── contexts/
│   └── lib/
├── agents/
│   ├── llm_client.py
│   ├── layered_generator.py
│   ├── kafka_client.py
│   └── file_parser.py
├── db/
│   ├── vector_store.py
│   ├── postgres.py
│   └── autotest_runs_store.py
├── data/
│   ├── alert_scripts.json
│   └── autotest_run_config.json
├── certs/
├── start.sh
├── install.sh
└── requirements.txt
```

## Ключевые паттерны

### Добавление API эндпоинта

1. Создай файл в `backend/api/`.
2. Зарегистрируй роутер в `backend/main.py`.
3. Добавь функцию в `frontend/lib/`.
4. Подключи UI в нужной секции фронтенда.

### LLM

- Встроенные провайдеры: `gigachat`, `deepseek`.
- Пользовательские провайдеры хранятся в настройках как `custom_*`.
- Выбранная модель берётся из `WorkspaceContext` и передаётся в генерации явно.
- Проверка LLM идёт фоном через `/api/system/providers`.

### Автотесты

- Генерация автотестов и запуск автотестов разделены во вкладках `AutoModelSection`.
- Конфигурация запуска хранится на бэкенде в `data/autotest_run_config.json`.
- История и аудит запусков пишутся через `db/autotest_runs_store.py`.

### Obsidian

После значимых изменений добавляй заметку в:

```text
/Users/stefanzastylov/Documents/Obsidian-Vault/20-Projects/SimpleTest/
```

Формат заметки: дата/время, контекст, **Было**, **Стало**, **Проверка**.

## Частые проблемы

| Проблема | Решение |
|---|---|
| `Address already in use` 8000 | `lsof -ti :8000 \| xargs kill -9` |
| `Address already in use` 3000 | `lsof -ti :3000 \| xargs kill -9` |
| `chromadb` падает на Python 3.14 | Используй Python 3.10-3.12 |
| SSL ошибки в корпоративной сети | `SSL_NO_VERIFY=1` или `bash certs/build_bundle.sh` |
| Бэкенд стартует, фронтенд не видит API | Проверь `frontend/.env.local` |
