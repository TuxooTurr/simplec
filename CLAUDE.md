# SimpleTest — инструкция для Claude Code

## Что это за проект

**SimpleTest** — веб-приложение для QA-инженеров. Генерирует тест-кейсы, оформляет баг-репорты, создаёт автотесты на Java, управляет алертами через Jupyter.

- **Бэкенд:** Python 3.10+, FastAPI, uvicorn, порт **8000**
- **Фронтенд:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, порт **3000** (нужен Node.js 20 LTS)
- **БД:** SQLite (`simpletest.db`) + ChromaDB (векторное хранилище)
- **LLM:** GigaChat — единственный встроенный провайдер. Остальные (OpenAI, Groq, Ollama и др.)
  подключаются как сторонние по OpenAI-совместимому API. Флаг `GIGACHAT_ONLY=1` отключает сторонних технически

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
│   │   ├── zephyr.py        # Zephyr Tool: индексы кейсов и прогонов, правка, крит регресс, релизы (data/zephyr_releases.json)
│   │   └── app_settings.py  # Настройки приложения
│   └── schemas.py           # Pydantic схемы
├── frontend/
│   ├── app/                 # Next.js App Router страницы
│   ├── components/
│   │   ├── sections/        # Основные секции UI
│   │   │   ├── GenerationSection.tsx   # «Тестовая модель»: генерация тест-кейсов
│   │   │   ├── BugsSection.tsx         # Баг-трекер
│   │   │   ├── ZephyrSection.tsx       # Zephyr Tool: вкладки Кейсы · Прогоны · Релиз (components/zephyr/)
│   │   │   ├── EventGeneratorsSection.tsx # Хаб: Метрики, ТКС, Jobs, папки алертов
│   │   │   ├── AlertsSection.tsx       # Алерты / Jupyter (открывается плиткой папки)
│   │   │   ├── AutoModelSection.tsx    # Автотесты (Java) — скрыт, код сохранён
│   │   │   └── RevisorSection.tsx      # Ревизия — скрыт, код сохранён
│   │   ├── ExportPanel.tsx  # Экспорт в Jira Zephyr Scale
│   │   └── NotionRenderer.tsx  # Markdown → Notion-стиль
│   ├── contexts/
│   │   ├── GenerationContext.tsx       # WebSocket генерация (глобальный state)
│   │   └── AlertsSchedulerContext.tsx  # Jupyter ядро + планировщик
│   └── lib/
│       ├── api.ts           # HTTP клиент к бэкенду
│       └── useGeneration.ts # Реэкспорт из GenerationContext
├── webconnect/              # Веб-коннекторы (ОТКЛЮЧЕНЫ, код сохранён — см. WEB_CONNECTORS_ENABLED)
├── mcp_server/              # MCP-сервер для GigaCode (ОТКЛЮЧЁН вместе с коннекторами, код сохранён)
├── agents/
│   ├── llm_client.py        # Универсальный LLM клиент (все провайдеры)
│   ├── layered_generator.py # 4-слойный генератор тест-кейсов
│   └── file_parser.py       # Парсинг файлов (PDF, DOCX, Excel)
├── db/
│   ├── vector_store.py      # ChromaDB эталоны (RAG)
│   ├── postgres.py          # PostgreSQL/SQLite ORM (метрики, настройки)
│   ├── *_store.py           # Файловые JSON-сторы (jobs, alerts, teams, autotest_runs…)
│   └── secure_config.py     # Шифрование секретов настроек
├── certs/
│   └── build_bundle.sh      # Сборка CA bundle для корп. прокси
├── start.sh                 # Запуск (venv + Conda)
├── install.sh               # Установка зависимостей
├── requirements.txt         # Python зависимости
└── .env.example             # Шаблон переменных окружения
```

---

## Временно отключено

Веб-коннекторы (Playwright), раздел «Логи» (анализатор на коннекторах) и MCP-сервер для GigaCode
отключены 13.10.2026, код сохранён. Вернуть:
1. `WEB_CONNECTORS_ENABLED = True` в `backend/main.py` и `frontend/lib/features.ts`;
2. раскомментировать `mcp`, `playwright`, `cryptography` в `requirements.txt`.

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
- `st_jira_epics` — **sessionStorage**: выгруженный список эпиков Jira по проекту до конца сессии вкладки
  (выгружается сам при первом открытии формы задачи, обновляется кнопкой в выборе эпика)
- `st_zephyr_project` — проект Zephyr Tool (по умолчанию SBER911); `st_zephyr_crit` — условия отбора крит регресса;
  `st_zephyr_staging:<проект>` — черновик новой модели (раскладка до «Применить»); sessionStorage `st_zephyr_import` — XML из генерации;
  `st_zephyr_panes` — ширины раздвигаемых зон (дерево, список прогонов)
- `st_cell_icon_recent`, `st_cell_icon_color` — недавние ярлычки ячеек и выбранный цвет иконок (удобство одного браузера)
- `st_jira_tool_cache` — **sessionStorage**: кэш задач Jira tool на сессию (задачи из Jira, связанные, ненайденные);
  основная копия — в памяти модуля `frontend/lib/jiraToolCache.ts`, фоновое обновление раз в 30 минут

### Авторизация
Bearer-токен (токен в localStorage на фронте, проверяется `AuthMiddleware` в `backend/main.py`).
Пользователи **захардкожены в `backend/api/auth.py`** (`USERS`), сессии — in-memory (`_sessions`):
```
Sber911       / 1234567   (роль superuser)
SberMonitoring / 1234567  (роль monitoring)
```
> Аккаунты живут в коде `auth.py`, поэтому валидны на любой машине сразу после клона.
> Смена пароля/добавление пользователя — правка словаря `USERS` в `backend/api/auth.py`.

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

---

## Ведение заметок (Notion и Obsidian)

> Формат единый для Notion и Obsidian. Он **плоский**. Если появится соблазн
> «разложить по папкам Backend/Frontend» — не надо, это откат к старой схеме,
> из которой проект уже вышел 30.08.2026.

**Где живут заметки:**

- **Notion:** корневая страница проекта `SimpleTest`, все записи — её прямые дочерние страницы
- **Obsidian:** `~/Documents/Obsidian-Vault/20-Projects/SimpleTest`, все файлы в корне папки

**Правила:**

1. **Никаких папок и вложенных разделов.** Все страницы и файлы — одним списком в корне проекта.
2. **Имя:** `ДД.ММ.ГГГГ [Компонент] Краткое наименование`.
   Пример: `08.07.2026 [Back] Генерация кейсов: клиентские пути`
3. **Компоненты:** `Back` — API, база, миграции, интеграции, LLM-пайплайны ·
   `Front` — интерфейс · `Design` — визуальные правила и дизайн-система ·
   `Spec` — продукт, спецификации, планы · `Keys` — доступы и места хранения секретов
4. **Никаких иконок и эмодзи** — ни в именах, ни в заголовке `#` внутри заметки.
   Единственное исключение: иконка корневой страницы проекта в Notion, её не трогаем.
5. **Отдельный журнал изменений не ведём.** Список заметок и есть журнал; индексные
   страницы направлений («Backend», «Frontend», «Общее») расформированы намеренно.
6. **Справочные срезы обновляются на месте, а не дописываются:** структура бэкенда,
   структура фронтенда, интеграции, спецификация продукта.
7. **Секретные значения в заметки не пишем** — только место хранения и порядок ротации.
8. **Wiki-ссылки в Obsidian** пишутся полным новым именем, вместе со скобками компонента:
   `[[30.04.2026 [Spec] Спецификация проекта]]`. При переименовании заметки ссылки
   на неё правятся в том же проходе, иначе связи разваливаются.

## База дефектов и регламент

Дефекты ведутся в базе **«Дефекты SimpleTest»** внутри корневой страницы Notion.

- **Карточку заводит Стефан.** Обязательно: название, Раздел, Приоритет, Статус `Новый`.
  Шаги воспроизведения — в теле карточки, не колонкой.
- **Агент не читает базу и не меняет статусы по своей инициативе.** Только по явной команде.
- **По команде:** статус `В работе` + Компонент → причина в коде → правка →
  в поле «Что сделано» причина и суть правки → статус `Готово к проверке`.
- **Не баг или не влезает в задачу:** `Отклонён` / `Отложен` с объяснением, решение за Стефаном.
- **Статус `Проверен` ставит только Стефан** после проверки в браузере. Агент этот статус
  не выставляет никогда: подтвердить исправление в работающем приложении он не может,
  и закрывать дефект по своему слову означало бы врать о результате.

## Скилы (Claude Code Skills) — использовать по умолчанию

Установлены глобально в `~/.claude/skills/` и применяются автоматически по описанию.
В этом проекте использовать проактивно:

- **agent-skills** (addyosmani, 24 скила) — инженерный воркфлоу: спека, планирование,
  пошаговая реализация, отладка по первопричине, код-ревью, упрощение, безопасность,
  git-флоу, CI/CD, TDD. Применять при любой нетривиальной задаче; перед мерджем —
  `code-review-and-quality`, `security-and-hardening`, `debugging-and-error-recovery`.
- **ui-skills** (ibelick, 5) — полировка веб-UI: `baseline-ui`, `fixing-accessibility`,
  `fixing-metadata`, `fixing-motion-performance`. Применять при работе над `frontend/`.
- **transitions-dev** — готовые CSS-переходы/анимации (модалки, дропдауны, тосты, табы,
  staggered reveal). Применять при анимациях во `frontend/`.

> Скилы исполняются с полными правами агента — это доверенные паки, поставленные
> по запросу пользователя.
