# SimpleTest — инструкция для Claude Code

## Что это за проект

**SimpleTest** — веб-приложение для QA-инженеров. Генерирует тест-кейсы, оформляет баг-репорты, создаёт автотесты на Java, управляет алертами через Jupyter.

- **Бэкенд:** Python 3.10+, FastAPI, uvicorn, порт **8000**
- **Фронтенд:** Next.js 14 (App Router), TypeScript, Tailwind CSS, порт **3000**
- **БД:** SQLite (`simpletest.db`) + ChromaDB (векторное хранилище)
- **LLM:** GigaChat (основной), DeepSeek, OpenAI, Claude, Ollama, LM Studio

---

## Как запустить локально

### macOS / Linux (venv)

```bash
# Первый раз
bash install.sh

# Каждый раз
bash start.sh
```

### Windows / Conda

```bash
conda activate simpletest   # активируй своё conda окружение
bash install.sh             # первый раз
bash start.sh               # каждый раз
```

### Вручную (если скрипты не работают)

```bash
# Бэкенд
source .venv/bin/activate          # или: conda activate simpletest
python -m uvicorn backend.main:app --reload --port 8000

# Фронтенд (в другом терминале)
npm run dev --prefix frontend
```

> На macOS с двумя Python: uvicorn может взять неправильный Python.
> Всегда запускай через `python -m uvicorn`, не через `uvicorn` напрямую.

---

## Переменные окружения (.env)

Файл `.env` в корне проекта — **не коммитится** (в .gitignore). Создай из шаблона:

```bash
cp .env.example .env
```

Обязательные ключи:
```
GIGACHAT_AUTH_KEY=<Base64 ключ из СберID>
GIGACHAT_SCOPE=GIGACHAT_API_PERS
```

Опциональные ключи:
```
DEEPSEEK_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

### Корпоративная сеть (Sber BIG IP proxy)

Добавь в `.env`:
```
SSL_NO_VERIFY=1        # быстрый способ (небезопасно, но работает)
# или
SSL_MAX_TLS12=1        # форсировать TLS 1.2 для старых BIG IP
```

Или собери CA bundle:
```bash
bash certs/build_bundle.sh
# перезапусти бэкенд
```

---

## Структура проекта

```
SimpleTest/
├── backend/
│   ├── main.py              # FastAPI точка входа, SSL-конфиг, роутеры
│   ├── api/
│   │   ├── generation.py    # WebSocket генерация тест-кейсов
│   │   ├── bugs.py          # Форматирование баг-репортов
│   │   ├── autotests_gen.py # Генерация Java автотестов
│   │   ├── alerts.py        # Управление скриптами алертов
│   │   ├── kernel.py        # Jupyter ядра для алертов
│   │   ├── etalons.py       # Эталонные примеры (RAG)
│   │   ├── revisor.py       # Ревизия тест-кейсов
│   │   └── app_settings.py  # Настройки приложения
│   └── schemas.py           # Pydantic схемы
├── frontend/
│   ├── app/                 # Next.js App Router страницы
│   ├── components/
│   │   ├── sections/        # Основные секции UI
│   │   │   ├── GenerationSection.tsx   # Генерация тест-кейсов
│   │   │   ├── BugsSection.tsx         # Баг-трекер
│   │   │   ├── AutoModelSection.tsx    # Автотесты (Java)
│   │   │   ├── AlertsSection.tsx       # Алерты / Jupyter
│   │   │   └── RevisorSection.tsx      # Ревизия
│   │   ├── ExportPanel.tsx  # Экспорт в Jira Zephyr Scale
│   │   └── NotionRenderer.tsx  # Markdown → Notion-стиль
│   ├── contexts/
│   │   ├── GenerationContext.tsx       # WebSocket генерация (глобальный state)
│   │   └── AlertsSchedulerContext.tsx  # Jupyter ядро + планировщик
│   └── lib/
│       ├── api.ts           # HTTP клиент к бэкенду
│       └── useGeneration.ts # Реэкспорт из GenerationContext
├── agents/
│   ├── llm_client.py        # Универсальный LLM клиент (все провайдеры)
│   ├── generator.py         # Основной генератор тест-кейсов
│   └── file_parser.py       # Парсинг файлов (PDF, DOCX, Excel)
├── db/
│   ├── user_store.py        # SQLite пользователи + сессии
│   ├── vector_store.py      # ChromaDB эталоны
│   └── postgres.py          # PostgreSQL (метрики, опционально)
├── certs/
│   └── build_bundle.sh      # Сборка CA bundle для корп. прокси
├── start.sh                 # Запуск (venv + Conda)
├── install.sh               # Установка зависимостей
├── requirements.txt         # Python зависимости
└── .env.example             # Шаблон переменных окружения
```

---

## Ключевые паттерны

### Добавление нового LLM провайдера
Файл `agents/llm_client.py` — добавь в `SUPPORTED_PROVIDERS`, `_init_client()`, `chat()`.

### Добавление нового API эндпоинта
1. Создай файл в `backend/api/`
2. Зарегистрируй роутер в `backend/main.py`
3. Добавь функцию в `frontend/lib/api.ts`

### localStorage ключи (фронтенд)
- `st_automodel_history` — история автотестов
- `st_autotest_project` — привязанный проект (персистентно)
- `st_projects`, `st_teams`, `st_ke` — списки для ExportPanel
- `st_gen_history` — история генераций

### Авторизация
Cookie-based (httpOnly). Дефолтный пользователь из `.env`:
```
ADMIN_USER=admin
ADMIN_PASS=Admin12345
```

---

## Частые проблемы

| Проблема | Решение |
|----------|---------|
| `Address already in use` (порт 8000) | `lsof -ti :8000 \| xargs kill -9` |
| `Address already in use` (порт 3000) | `lsof -ti :3000 \| xargs kill -9` |
| `chromadb` падает на Python 3.14 | Запускай через `python3.12 -m uvicorn ...` или используй Python 3.10–3.12 |
| `UNEXPECTED_EOF_WHILE_READING` (SSL) | Добавь `SSL_NO_VERIFY=1` в `.env` |
| Бэкенд стартует, фронтенд не видит API | Проверь `frontend/.env.local` — там должен быть `NEXT_PUBLIC_API_URL=http://localhost:8000` |
| uvicorn берёт неправильный Python | Всегда `python -m uvicorn`, не `uvicorn` напрямую |
