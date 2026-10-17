# ForChat.md — живой мастер-контекст проекта SimpleTest

> **Это единственная точка входа для любого ИИ-ассистента (Claude, GPT, Gemini, Codex…).**
> Скопируй/загрузи этот файл в начало чата — и ассистент сразу понимает архитектуру,
> логику работы и знает, **в какой файл идти** за деталями. Предварительно изучать
> проект не нужно — здесь карта всего.
>
> **Правило сопровождения:** этот файл — живой. При любом значимом изменении проекта
> (удаление/добавление модуля, смена структуры, новая фича) **сначала обнови ForChat.md**,
> затем код. Журнал изменений — в самом низу (§ CHANGELOG).

---

## 1. Что это за проект

**SimpleTest** — веб-платформа для QA-инженеров корпоративного контура (Сбер).
Один монолитный проект (frontend + backend в одном репозитории), который объединяет
несколько крупных функциональных модулей:

| Модуль | Что делает |
|--------|-----------|
| **Тестовая модель** (было «Ручное тестирование», маршрут `/generation`) | LLM генерирует тест-кейсы из требований, 4-слойный пайплайн, экспорт в Jira Zephyr Scale |
| **Автотестирование** — *скрыто с 10.10.2026* | Генерация Java-автотестов, запуск прогонов. Код сохранён, `/auto-model` ведёт на «Тестовую модель» |
| **Тестовые данные** | Подключения к внешним БД через JDBC-драйверы (PostgreSQL/MySQL/Oracle встроены + свои .jar, как в DBeaver), LLM-генерация SQL, поиск данных |
| **Jobs** — *плитка в «Генераторах событий»* | Произвольные задачи/скрипты с папками и историей запусков. `/jobs` открывает плитку |
| **Дефекты (Bugs)** | LLM-форматирование баг-репортов |
| **Логи** — *анализатор с 10.10.2026* | Имя микросервиса → ошибки за N минут. Источник — сценарий веб-коннектора (`webconnect/`), записанный человеком под своей сессией. Старый раздел VPS-подключений (`LogsSection`) сохранён в коде, не используется |
| **Генератор алертов** — *плитки-папки в «Генераторах событий»* | Jupyter-ядра, запуск скриптов-алертов, планировщик, глобальный индикатор в сайдбаре. Ответ ядра — чат «топик → тело → получатели» (`lib/kernelMessages.ts`, `components/alerts/KernelChat.tsx`) |
| **Просмотр Kafka** | Именованные подключения (CLEARTEXT/SSL с сертификатом), снапшот последних N сообщений топика, поиск |
| **Генератор метрик** | Эмуляция метрик в Kafka по спецификации (8 таблиц БД) |
| **Ревизор** — *упразднено с 10.10.2026* | Сравнение сборок на стендах: API в контуре нет. Код сохранён, доработка — через локальный MCP web |
| **Данные** (было «Эталоны») | Вкладка **Требования** — локальная библиотека (JSON, без ChromaDB): исходник + сгенерированная QA-документация в одной записи, используется как переключаемый источник в генерации и как контекст для дефектов. Вкладка **Документы** (RAG, ChromaDB) и вкладки Тест-кейсы/Автотесты/Дефекты (эталонные пары requirement→результат в ChromaDB) **скрыты с фронта**, но не удалены — данные по-прежнему пишутся кнопками «В эталон» в других разделах |
| **Тестирование моделей LLM** | Сравнение LLM на саммаризации: прогоны с метриками (латентность/токены), сравнительный отчёт от судьи, сценарии (промпт+транскрибация+критерии судье), экспорт отчёта в DOCX |

### Технологический стек

- **Backend:** Python **3.10–3.12** (НЕ 3.13/3.14 — несовместимо с ChromaDB), **FastAPI**, uvicorn, порт **8000**
- **Frontend:** **Next.js 16** (App Router), **React 19**, TypeScript, Tailwind CSS 3, порт **3000** (нужен **Node.js 20 LTS**)
- **БД:** SQLite (`simpletest.db`) ИЛИ PostgreSQL (через `DATABASE_URL`) + **ChromaDB** (вектора для эталонов)
- **LLM:** GigaChat (основной, Сбер), DeepSeek, OpenAI, Ollama, Groq + произвольные custom-провайдеры
- **Очереди:** Kafka (для алертов и метрик)

---

## 2. Установка и запуск (детально)

> TL;DR: установить **Python 3.10–3.12** и **Node.js 20**, затем
> `cp .env.example .env` → `bash install.sh` → `bash start.sh`.
> Открыть http://localhost:3000, войти `Sber911` / `1234567`.

### 2.0. Что обязательно должно быть установлено

| Компонент | Версия | Обязательно? | Зачем |
|-----------|--------|--------------|-------|
| **Python** | **3.10 / 3.11 / 3.12** | ✅ да | backend. **НЕ 3.13/3.14** — `chromadb` не соберётся |
| **Node.js + npm** | **20 LTS** (≥ 18.18) | ✅ да | frontend (Next.js 16) |
| **git** | любая | ✅ да | клонировать репозиторий |
| C-компилятор / build tools | — | ⚠️ Linux | сборка нативных колёс (`psycopg2`, `onnxruntime`) |
| **Docker** | любая | ❌ нет | только если нужен PostgreSQL или контейнеризация |
| **PostgreSQL** | 16 | ❌ нет | по умолчанию SQLite; PG нужен только для метрик в проде |
| **Хотя бы 1 LLM-ключ** | — | ❌ нет* | без ключа приложение **стартует**, но LLM-функции (генерация и т.п.) вернут ошибку. Ключ можно ввести позже в UI → Настройки |
| **Java (JRE/JDK)** | **17+** | ⚠️ для Тестовых данных | модуль «Тестовые данные»/«Jobs» подключается к БД через JDBC (JPype/jaydebeapi — нужна JVM). Без Java приложение стартует, но подключения к БД вернут ошибку |
| Maven/Gradle | — | ❌ нет | только для модуля «Запуск автотестов» (на машине с фреймворком) |

Дефолтные логины (захардкожены в `backend/api/auth.py`):
`Sber911` / `1234567` (superuser), `SberMonitoring` / `1234567` (monitoring).

---

### 2.1. macOS — пошагово

```bash
# 1. Установить Homebrew (если ещё нет)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Поставить Python 3.12, Node 20, git
brew install python@3.12 node@20 git
brew link --overwrite node@20            # сделать node 20 активным

# 3. Клонировать и зайти в проект
git clone <repo-url> SimpleTest && cd SimpleTest

# 4. Создать .env из шаблона (ключ GigaChat можно оставить пустым и ввести позже в UI)
cp .env.example .env

# 5. Автоустановка: создаёт .venv, ставит зависимости Python/Node, спросит GigaChat-ключ
bash install.sh

# 6. Конфиг фронта для dev (URL backend)
cp frontend/.env.local.example frontend/.env.local

# 7. Запуск (поднимет backend:8000 + frontend:3000 и откроет браузер)
bash start.sh
```

Открыть http://localhost:3000 → войти `Sber911 / 1234567`.

**Ручной запуск (без скриптов, два терминала):**
```bash
# первый раз — окружение и зависимости
python3.12 -m venv .venv
.venv/bin/python -m pip install -U pip
.venv/bin/python -m pip install -r requirements.txt
npm install --prefix frontend

# терминал 1 — backend (ВСЕГДА через `python -m uvicorn`, иначе возьмётся не тот Python)
.venv/bin/python -m uvicorn backend.main:app --reload --port 8000

# терминал 2 — frontend
npm run dev --prefix frontend
```

> На macOS с несколькими Python `uvicorn` напрямую может взять системный Python.
> Используй `.venv/bin/python -m uvicorn`, НЕ `source .venv/bin/activate` + `uvicorn`.

---

### 2.2. Linux / сервер — пошагово

**Debian / Ubuntu:**
```bash
# 1. Системные пакеты: Python 3.12 + venv, build tools, git, curl
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3.12-dev build-essential git curl

# 2. Node.js 20 LTS (через NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3-7. Дальше как на macOS:
git clone <repo-url> SimpleTest && cd SimpleTest
cp .env.example .env
bash install.sh
cp frontend/.env.local.example frontend/.env.local
bash start.sh
```

**RHEL / CentOS / Fedora:** замените шаг 1–2 на
`sudo dnf install -y python3.12 python3.12-devel gcc gcc-c++ make git` и Node 20 из `dnf module install nodejs:20` (или NodeSource).

**Headless-сервер (без браузера, для команды / прод-подобный режим):**
```bash
# собрать production-фронт (Next standalone) и запускать его, а не dev-сервер
npm run build --prefix frontend
npm run start --prefix frontend          # порт 3000

# backend — без --reload, можно несколько воркеров за nginx
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
- Открыть порты 3000 и 8000 (или спрятать оба за **nginx** reverse-proxy, отдавая `/` → 3000, `/api` и `/api/.../ws` → 8000 с `proxy_set_header Upgrade` для WebSocket).
- Для автозапуска при ребуте — **systemd**-юниты (по одному на backend и frontend) или `pm2`/`tmux`.
- В проде фронту переменные `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` НЕ нужны — URL вычисляется из `window.location` (см. `frontend/.env.local.example`).

---

### 2.3. Контейнер / Docker

В репозитории **нет Dockerfile приложения**; корневой `docker-compose.yml` поднимает **только PostgreSQL** (для метрик). Два варианта:

**A. Приложение на хосте + PostgreSQL в Docker (самый простой):**
```bash
docker compose up -d                       # postgres:16 на :5432 (db=metrics, user/pass=simpletest)
# в .env переключить БД на PostgreSQL:
#   DATABASE_URL=postgresql://simpletest:simpletest@localhost:5432/metrics
bash start.sh
```

**B. Полная контейнеризация (Dockerfile нужно добавить — каркас ниже):**
`next.config.ts` уже собирает фронт в `output: "standalone"`, поэтому фронт пакуется легко.
```dockerfile
# Dockerfile.backend
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python","-m","uvicorn","backend.main:app","--host","0.0.0.0","--port","8000"]
```
```dockerfile
# Dockerfile.frontend (multi-stage, Next standalone)
FROM node:20-alpine AS build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build
FROM node:20-alpine
WORKDIR /app/frontend
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./.next/static
COPY --from=build /app/frontend/public ./public
EXPOSE 3000
CMD ["node","server.js"]
```
Передавай секреты через env (`-e GIGACHAT_AUTH_KEY=...`, `-e DATABASE_URL=...`), а постоянные данные (`simpletest.db`, `db/chroma_db/`, `data/`, `out/`) монтируй как volume, иначе они потеряются при пересоздании контейнера.

---

### 2.4. Конфигурация (.env)

`.env` в корне (не коммитится, шаблон — `.env.example`). Ключевое:
- **`GIGACHAT_AUTH_KEY`** — Base64 `client_id:client_secret` из developers.sber.ru. `GIGACHAT_SCOPE=GIGACHAT_API_PERS` (или `_CORP`). Прочие LLM (DeepSeek/OpenAI/Ollama/Groq/custom) — через env или UI → Настройки → Дополнительные LLM.
- **`DATABASE_URL`** — по умолчанию `sqlite:///./simpletest.db`; для PostgreSQL — строка `postgresql://...`.
- **Kafka** (`KAFKA_BOOTSTRAP_SERVERS`, протокол, SASL) — для алертов/метрик.
- **Корп-сеть с TLS-инспекцией (Sber BIG IP):** быстро — `SSL_NO_VERIFY=1` или `SSL_MAX_TLS12=1` в `.env`; правильно — `bash certs/build_bundle.sh` и указать `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE`.

`frontend/.env.local` (только для dev): `NEXT_PUBLIC_API_URL=http://localhost:8000`, `NEXT_PUBLIC_WS_URL=ws://localhost:8000`.

---

### 2.5. Проверка, что всё поднялось

```bash
curl -s http://localhost:8000/healthz                 # backend жив (публичный, без токена)
curl -s -X POST http://localhost:8000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"login":"Sber911","password":"1234567"}'     # должен вернуть {"token": ...}
```
Затем открыть http://localhost:3000.

**Частые проблемы:**
- `Address already in use` → `lsof -ti :8000 | xargs kill -9` (то же для 3000).
- `chromadb` не ставится / падает → Python 3.13/3.14; поставь 3.10–3.12.
- Фронт не видит API → нет `frontend/.env.local` (`cp frontend/.env.local.example frontend/.env.local`).
- SSL `UNEXPECTED_EOF`/`CERTIFICATE_VERIFY_FAILED` в корп-сети → `SSL_NO_VERIFY=1` в `.env`.
- `uvicorn` берёт не тот Python → запускай `.venv/bin/python -m uvicorn ...`.

---

## 3. Архитектура верхнего уровня

```
┌─────────────────────────────────────────────────────────────────┐
│ Браузер (Next.js, :3000)                                          │
│   app/(app)/<section>/page.tsx → SectionRenderer → <Section>.tsx  │
│   lib/*.ts (HTTP клиенты) + contexts/*.tsx (глобальный стейт)     │
└──────────────┬──────────────────────────────────┬────────────────┘
               │ REST (fetch + Bearer token)        │ WebSocket
               ▼                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ FastAPI (:8000)  backend/main.py                                  │
│   AuthMiddleware → роутеры backend/api/*.py                       │
│   агентский слой: agents/*.py (LLM, парсинг, Kafka, планировщик)  │
│   данные: db/*.py (SQLAlchemy + ChromaDB + JSON-сторы)            │
└──────────────┬──────────────────────────────────┬────────────────┘
               │ SQLAlchemy                         │ WebSocket
               ▼                                    ▼
        SQLite/PostgreSQL + ChromaDB        стриминг генерации/логов
```

**Ключевой принцип фронта:** двухпанельный интерфейс (`ResizablePanels`):
левая панель — текущая страница (`children`), правая — `SectionRenderer`
(вспомогательная панель «Рабочая зона», переключается через `WorkspaceContext`).

---

## 4. BACKEND — карта файлов

### 4.1. Точка входа: `backend/main.py` (183 строки)

- Настраивает `sys.path` (чтобы видеть `agents/`, `db/`), грузит `.env`, корп. SSL-сертификаты.
- `lifespan` — startup/shutdown хуки:
  - применяет сохранённые настройки в `os.environ` (`app_settings.apply_saved_settings_to_env`)
  - запускает: планировщик метрик, монитор автозапуска автотестов
  - на shutdown — корректно всё останавливает
- **`AuthMiddleware`**: проверяет `Bearer`-токен на всех `/api/*`, кроме:
  - публичных: `/api/auth/login`, `/api/auth/me`, `/healthz`
  - WebSocket-апгрейдов (авторизация внутри хендлеров)
- Регистрирует **17 роутеров**.
- В конце — раздача статической Next.js сборки из `frontend/out` (если есть).

### 4.2. `backend/api/` — REST/WS эндпоинты

| Файл | Строк | Назначение | Префикс |
|------|-------|-----------|---------|
| `auth.py` | 92 | Логин/логаут/me. **2 пользователя в коде** (`Sber911`, `SberMonitoring`, пароль `1234567`). Токены в `_sessions` (in-memory). Роли: `superuser`/`monitoring`. | `/api/auth/*` |
| `system.py` | 39 | Статусы LLM-провайдеров, статистика | `/api/system/*` |
| `generation.py` | 572 | **WS-стриминг генерации тест-кейсов** + REST сессий. Генерация = `asyncio.Task`, живёт даже при отключении WS. Сессии в `data/gen_sessions.json` | `/api/generation/*` |
| `etalons.py` | 372 | CRUD эталонов (RAG-пары requirement→testcase/autotest/defect + документы), ChromaDB. Вкладки браузинга пар скрыты с фронта, эндпоинты живы — пишут кнопки «В эталон» из других разделов | `/api/etalons/*` |
| `requirements.py` | ~70 | Локальная библиотека требований (JSON, `db/requirements_store.py`, без ChromaDB/эмбеддингов): исходник + `qa_doc` в одной записи. `POST /{id}/generate-doc` — генерирует QA-документацию тем же `LayeredGenerator.generate_qa_doc()`, что и Layer 1 генерации кейсов | `/api/requirements/*` |
| `bugs.py` | 122 | LLM-форматирование баг-репортов. `format_bug` принимает `requirement_ids[]` — текст выбранных требований уходит в промпт как контекст (реальные поля БД/методы API) | `/api/bugs/*` |
| `autotests_gen.py` | 311 | Генерация Java-автотестов | `/api/autotests/*` |
| `autotest_runs.py` | ~830 | Запуск автотестов: общий путь фреймворка, **дерево тест-кейсов** (парсинг JUnit `@Test`/`@Tag`/`@DisplayName`), **LLM-понятные названия** (кэш `test_labels`), **генерация скрипта-сценария** в папку фреймворка, прогоны, монитор автозапуска по сборкам. См. §11 | `/api/autotest-runs/*` |
| `alerts.py` | 215 | CRUD скриптов-алертов + папки | `/api/alerts/*` |
| `kernel.py` | 278 | Jupyter-ядра для выполнения скриптов алертов | `/api/kernel/*` |
| `metrics_systems.py` | 500 | CRUD систем/метрик (Генератор метрик) | `/api/metrics/*` |
| `metrics_settings.py` | 119 | Настройки Kafka для метрик | `/api/metrics/settings/*` |
| `metrics_builder.py` | 530 | Сборка и отправка метрик в Kafka | `/api/metrics/*` |
| `revisor.py` | 439 | Сравнение стендов/сборок | `/api/revisor/*` |
| `app_settings.py` | ~930 | **Централизованные настройки** (ключ-значение). Группы: `llm`, `llm_custom`, `revisor`, `logs_vps`, `kafka_metrics`. GigaChat — подключение по API-ключу или клиентскому сертификату (переключатель в UI). Маскирует секреты. `apply_saved_settings_to_env()` грузит в `os.environ` | `/api/settings/*` |
| `testdata.py` | ~740 | Подключения к внешним БД (через реестр JDBC-драйверов, «Настройка драйверов» в UI) + выполнение SELECT + LLM-генерация SQL | `/api/testdata/*` |
| `db_connector.py` | ~120 | Общий JDBC-коннектор (JPype JVM + jaydebeapi) для testdata и jobs; generic-интроспекция через DatabaseMetaData | — |
| `kafka_explorer.py` | ~140 | Просмотр Kafka: реестр подключений (SSL-тумблер, серт опционально), топики, снапшот сообщений | `/api/kafka/*` |
| `jobs.py` | 263 | Jobs + папки + история (`data/jobs.json`, `data/job_folders.json`, `data/job_history.json`) | `/api/jobs/*` |
| `logs.py` | 324 | Поиск/анализ логов на VPS. Клиенты в `log_clients/` | `/api/logs/*` |
| `jira_defects.py` | ~600 | Регистрация дефектов напрямую в корп. Jira (Data Center) через REST API, PAT-токен. Подробные трейсы каждого запроса/ответа в лог (`logger.info/error`, requires `logging.basicConfig` в `main.py`), извлечение `X-AREQUESTID` для поиска в серверных логах Jira. После создания проверяет `GET .../transitions` — если пусто, явно предупреждает про возможное ограничение прав/Security Level | `/api/jira/*` |
| `model_bench.py` | ~170 | Сравнение LLM-моделей на саммаризации: сессии (промпт+транскрибация+`judge_instructions`), прогоны с метриками, сравнительный отчёт от судьи (`agents/model_bench.py`), экспорт `GET /{id}/report.docx`, CRUD сценариев (`db/model_bench_scenarios_store.py`, авто-сеет встроенный сценарий «Транскрибация» при первом запуске) | `/api/model-bench/*` |

**`backend/api/log_clients/`** — стратегии подключения к системам логов:
`base.py` (абстракция), `graylog.py`, `elastic.py`, `loki.py`, `generic.py` (произвольный REST).

### 4.3. `agents/` — бизнес-логика и интеграции

| Файл | Назначение |
|------|-----------|
| `llm_client.py` | **Универсальный LLM-клиент.** Встроен только GigaChat (API key / клиентский сертификат-mTLS; `SSL_MAX_TLS12` → `ssl_context` для старых BIG IP). Остальные (DeepSeek/OpenAI/Ollama/…) — custom OpenAI-совместимые endpoints из `CUSTOM_LLM_PROVIDERS` (JSON env), путь `_init_custom`/`_chat_custom`. SSL-логика для корп-прокси (`_get_verify`). `classify_error()` для ретраев |
| `layered_generator.py` | **4-слойная генерация тест-кейсов:** L1 — QA-документация, L2 — список кейсов (зависит от глубины: `smoke`/`regression`/`full`/`atomary`, словарь `DEPTH_MAP`), L3 — Markdown-кейсы (+ оценка времени прохождения на кейс), L4 — экспорт в Zephyr Scale/TM4J XML: корень `<project>` с projectId/projectKey/jiraVersion/folders, `<testCase>` с objective/precondition/owner/customFields по корп. спецификации |
| `file_parser.py` | Парсинг входных файлов (PDF, DOCX, Excel) |
| `prompt_templates.py` | Шаблоны промптов |
| `prompt_guard.py` | Защита от prompt-injection |
| `a2a_builder.py` | Сборка вспомогательных артефактов |
| `kafka_client.py` | Клиент Kafka (метрики + просмотр топиков): producer/consumer, SSL с опц. отключением валидации серта (`kafka_ssl_verify`) |
| `metrics_message_builder.py` | Сборка JSON-сообщений метрик (DATA/METADATA/THRESHOLDS) |
| `metrics_scheduler.py` | Планировщик периодической отправки метрик |

### 4.4. `db/` — слой данных

- **`postgres.py`** — `engine`/`SessionLocal`/`Base`. `DATABASE_URL` из env: PostgreSQL **или** `sqlite:///./simpletest.db`. `init_db()` создаёт таблицы + миграции колонок (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). `get_db()` — FastAPI Dependency.
- **`metrics_models.py`** — все SQLAlchemy-модели:
  - Метрики (8 таблиц): `TestSystem`, `TestMetric`, `TestMetricValuesConfig`, `TestMetricBaselineConfig`, `TestMetricThresholdsConfig`, `TestMetricThresholdRow`, `TestMetricHealthConfig`, `GenerationLog`, `MetricsSettings`
- **`vector_store.py`** — ChromaDB для эталонов (RAG). Данные в `db/chroma_db/`, `db/chroma_data/`.
- **JSON-сторы** (файловые, без БД): `alerts_store.py`, `jobs_store.py`, `gen_sessions_store.py`, `testdata_connections.py`, `jdbc_drivers_store.py` (реестр JDBC-драйверов + .jar в `data/jdbc_drivers/`), `kafka_explorer_store.py` (подключения Просмотра Kafka), `team_store.py`, `feedback_store.py`, `autotest_runs_store.py`, `secure_config.py`, `audit_log.py`, **`requirements_store.py`** (`data/requirements.json` — библиотека требований: исходник+`qa_doc`), **`model_bench_store.py`** (`data/model_bench_sessions.json`), **`model_bench_scenarios_store.py`** (`data/model_bench_scenarios.json`, авто-сеет сценарий «Транскрибация» при первом запуске). Все — атомарная запись (tmp+`os.replace`) + восстановление при битом JSON (переименование в `.corrupted-<ts>`, продолжение с пустого состояния).

### 4.5. `backend/schemas.py` — Pydantic-схемы

`GenerationStartRequest`, `Step`, `CaseData`, `ExportRequest`, `EtalonAddRequest`, `BugFormatRequest/Response`, `ExportResponse`.

---

## 5. FRONTEND — карта файлов

### 5.1. Роутинг (App Router)

- `app/layout.tsx` — корневой layout.
- `app/login/page.tsx` — страница входа (поле **`login`**, не username!).
- `app/(app)/layout.tsx` — layout авторизованной зоны, оборачивает в `WorkspaceShell`.
- `app/(app)/<section>/page.tsx` — страницы секций (тонкие, рендерят секцию).

Список секций и маршрутов (из `components/Sidebar.tsx`):

| id | href | label | Доступ |
|----|------|-------|--------|
| `generation` | `/generation` | Ручное тестирование | все |
| `auto_model` | `/auto-model` | Автотестирование | все |
| `test_data` | `/test-data` | Тестовые данные | все |
| `jobs` | `/jobs` | Jobs | все |
| `bugs` | `/bugs` | Дефекты | все |
| `logs` | `/logs` | Логи | все |
| `alerts` | `/alerts` | Генератор алертов | все |
| `metrics` | `/metrics` | Генератор метрик | **superuserOnly** |
| `revisor` | `/revisor` | Ревизор | все |
| `etalons` | `/etalons` | Данные | **superuserOnly** |
| `model_bench` | `/model-bench` | Тестирование моделей LLM | все |

### 5.2. Оболочка и навигация

- **`components/WorkspaceShell.tsx`** — провайдеры (`WorkspaceProvider`, `GenerationProvider`, `AlertsSchedulerProvider`, `MetricsUiProvider`) + `Sidebar` + `ResizablePanels(left=children, right=SectionRenderer)`.
- **`components/Sidebar.tsx`** — навигация + статусы LLM (`LLMStatusBar`) + текущий пользователь + тема.
- **`components/SectionRenderer.tsx`** — рендер правой «рабочей зоны» (зависит от `WorkspaceContext`).
- **`components/ResizablePanels.tsx`** — две перетаскиваемые панели.

### 5.3. `components/sections/` — основные экраны (1 файл = 1 модуль)

`GenerationSection.tsx` (самый большой, ~1000 строк), `AutoModelSection.tsx`,
`TestDataSection.tsx`, `JobsSection.tsx`, `BugsSection.tsx`, `LogsSection.tsx`,
`AlertsSection.tsx`, `MetricsSection.tsx`,
`RevisorSection.tsx`, `EtalonsSection.tsx` (роут/id остались `etalons`, ярлык в UI — «Данные»;
вкладки: Требования, Документы, + скрытые Тест-кейсы/Автотесты/Дефекты), `ModelBenchSection.tsx`
(Тестирование моделей LLM), `SettingsSection.tsx` (~2000 строк — все настройки).

### 5.4. `components/ui/` — дизайн-система

`Badge`, `Button`, `Card`, `EmptyState`, `Input`, `Modal`, `SaveBar`, `Select`, `Tabs`,
`ThemeToggle`, `Toggle` + `index.ts` (реэкспорт). Стиль через CSS-переменные:
`bg-bg-card`, `text-text-main`, `border-border-main` и т.п. (см. `app/globals.css`, `tailwind.config.ts`).
**`Select`** (`components/ui/Select.tsx`) — кастомный брендированный дропдаун (нативный
`<select>` красит список средствами ОС): принимает те же `<option>`-дети, `onChange(value)`,
клавиатура, click-outside. Все выпадающие списки в приложении используют его, нативных `<select>` нет.

### 5.5. `contexts/` — глобальный стейт

- **`AuthContext.tsx`** — текущий пользователь, токен (в localStorage), логин/логаут.
- **`GenerationContext.tsx`** — гибрид **WS + REST polling**: генерация продолжается на сервере, фронт переподключается и догоняет состояние сессии.
- **`AlertsSchedulerContext.tsx`** — Jupyter-ядро + планировщик алертов.
- **`WorkspaceContext.tsx`** — что показано в правой панели.
- **`MetricsUiContext.tsx`** — UI-стейт генератора метрик.
- **`TestDataJobContext.tsx`** — запрос «Тестовых данных» живёт над роутами (в `WorkspaceShell`),
  поэтому уход на другой раздел не прерывает его (кнопка «Отменить» = AbortController); плюс
  архив выполненных запросов в localStorage (`st_testdata_archive`): время, БД, запрос, снимок результата.

### 5.6. `lib/` — HTTP-клиенты

- **`authApi.ts`** — `authHeaders()` (добавляет `Authorization: Bearer <token>` из localStorage). **Все остальные клиенты используют его.**
- `api.ts` — основной клиент (system, generation, etalons, bugs, export...).
- `settingsApi.ts`, `metricsApi.ts`, `revisorApi.ts`, `autotestRunsApi.ts`, `useGeneration.ts` (реэкспорт из контекста).

**Паттерн всех клиентов:** `fetchJson<T>(path, init)` — добавляет auth-заголовки,
кидает `Error("<status>: <text>")` при `!res.ok`. `API_BASE = NEXT_PUBLIC_API_URL ?? ""`.

---


## 7. Авторизация (важные детали)

- **2 захардкоженных пользователя** в `backend/api/auth.py`:
  `Sber911` (superuser) и `SberMonitoring` (monitoring), пароль у обоих `1234567`.
- Логин: `POST /api/auth/login {"login": "...", "password": "..."}` → `{token, login, role, display_name}`.
- Токен передаётся в заголовке **`Authorization: Bearer <token>`** (НЕ кука!). На фронте — localStorage, добавляется `authHeaders()`.
- Сессии — in-memory (`_sessions` dict), сбрасываются при рестарте backend.
- `AuthMiddleware` в `main.py` защищает все `/api/*` кроме публичных (`/api/auth/login`, `/api/auth/me`, `/healthz`) и WebSocket-апгрейдов.

---

## 8. Поток данных: генерация тест-кейсов (пример сквозного сценария)

1. UI (`GenerationSection.tsx`) открывает WS `/api/generation/ws`, шлёт `{action:"start", requirement, feature, depth, provider}`.
2. `backend/api/generation.py` создаёт `asyncio.Task` + сессию в `data/gen_sessions.json`, возвращает `session_created`.
3. `LayeredGenerator` (`agents/layered_generator.py`) исполняет 4 слоя, дёргая `LLMClient` (`agents/llm_client.py`); прогресс летит в WS (`layer_start/layer_done/case_start/case_done`).
4. Генерация **не зависит от WS** — при обрыве `GenerationContext.tsx` переподключается через `attach`/REST-polling и догоняет состояние.
5. Финал: `generation_done` с кейсами. Экспорт в Zephyr — `export` (XML/CSV/MD), UI: `ExportPanel.tsx`.

---

## 9. Конвенции и подводные камни

- **Язык:** весь UI, комментарии и коммиты — на русском.
- **Порты:** заняты? → `lsof -ti :8000 | xargs kill -9` (8000), то же для 3000.
- **ChromaDB** падает на Python 3.14 → используй 3.10–3.12.
- **localStorage-ключи фронта:** `st_auth_token` (Bearer-токен), `st_theme` (`light`/`dark`), `st_nav_order` + `st_nav_hidden` (порядок и скрытые разделы сайдбара), `st_alert_script_order` (порядок скриптов в Алертах), `st_automodel_history`, `st_autotest_project`, `st_projects`, `st_teams`, `st_ke`, `st_gen_history`.
- **Тема:** класс `.dark` на `<html>`, проставляется инлайн-скриптом в `app/layout.tsx` ДО первой отрисовки (без мерцания). Цвета — CSS-переменные в `app/globals.css`. Семантические статус-цвета — классы `tone-success/warning/danger/info/neutral` (адаптируются к теме). В `globals.css` есть «слой совместимости тёмной темы»: оверрайды голых светлых утилит (`bg-*-50`, `border-*-200`, `text-*-700` …) внутри `@layer components`, чтобы они корректно темнели, но уступали явным `dark:`-вариантам.
- **Добавить LLM-провайдера:** `agents/llm_client.py` (init/chat) + UI в `SettingsSection.tsx`.
- **Добавить API-эндпоинт:** файл в `backend/api/` → регистрация роутера в `backend/main.py` → клиент в `frontend/lib/`.
- **Настройки** (`app_settings.py`) — единый источник конфигурации, перекрывают env через `apply_saved_settings_to_env()` на старте.
- **Память проекта для ИИ:** см. `CLAUDE.md` (корень) — там же базовая инструкция.

---

## 10. Куда идти за чем (быстрый индекс)

| Задача | Файл(ы) |
|--------|---------|
| Изменить логику LLM / добавить провайдера | `agents/llm_client.py` |
| Поправить генерацию кейсов / глубину | `agents/layered_generator.py` |
| WS-протокол генерации | `backend/api/generation.py` + `frontend/contexts/GenerationContext.tsx` |
| Любые настройки/подключения | `backend/api/app_settings.py` + `frontend/components/sections/SettingsSection.tsx` |
| Модели БД | `db/metrics_models.py`, `db/postgres.py` |
| Авторизация | `backend/api/auth.py`, `frontend/contexts/AuthContext.tsx`, `frontend/lib/authApi.ts` |
| Навигация / список секций | `frontend/components/Sidebar.tsx` |
| Эталоны / RAG (Документы) | `backend/api/etalons.py`, `db/vector_store.py` |
| Требования (исходник + QA-документация) | `backend/api/requirements.py`, `db/requirements_store.py` |
| Тестирование моделей LLM / сценарии / DOCX-экспорт | `backend/api/model_bench.py`, `agents/model_bench.py`, `agents/model_bench_export.py`, `db/model_bench_scenarios_store.py` |
| Метрики в Kafka | `backend/api/metrics_*.py`, `agents/metrics_*.py` |
| Логи на VPS | `backend/api/logs.py`, `backend/api/log_clients/` |
| Тестовые данные / внешние БД | `backend/api/testdata.py`, `db/testdata_connections.py` |
| Регистрация дефектов в Jira | `backend/api/jira_defects.py`, `frontend/components/JiraRegisterPanel.tsx` |

---

## 11. Автотесты — интерфейс запуска (детально)

Раздел `/auto-model` (`AutoModelSection.tsx`) имеет 2 вкладки: **Генерация автотестов** (LLM из ручных кейсов) и **Запуск автотестов** (`AutotestRunPanel.tsx`, только superuser).

**Модель запуска (бэкенд `autotest_runs.py`):** SimpleTest НЕ исполняет тесты сам — он запускает **скрипт фреймворка** (.sh/.py), передавая env-переменные; скрипт сам решает, что гонять. Передаются: `AUTOTEST_FRAMEWORK_PATH`, `AUTOTEST_TAGS`, `AUTOTEST_TYPES`, **`AUTOTEST_TESTS`** (выбранные в дереве кейсы `pkg.Class#method`), `AUTOTEST_MICROSERVICE`, `AUTOTEST_BUILD_VERSION`, `AUTOTEST_TRIGGER`.

**Эндпоинты `/api/autotest-runs/`:**
| Метод/путь | Что делает |
|------------|-----------|
| `GET config` / `PUT config` | конфиг панели: `framework_path`, `scripts[]` (сценарии-раннеры), `autorun` (правила), `test_labels` (кэш LLM-названий) |
| `GET test-tree` | парсит JUnit-тесты во фреймворке → `{ classes[пакет→класс→методы], tags, total, parseable, analyzed }`; мёржит понятные названия (`label`) |
| `POST analyze-tree` `{provider}` | LLM описывает классы/методы понятными русскими названиями, кэширует в `config.test_labels` |
| `POST create-scenario` `{name, tests[]}` | генерирует исполняемый скрипт `<framework>/simpletest-runners/<slug>.sh` (под maven/gradle/unknown) с «запечёнными» выбранными кейсами и регистрирует его как сценарий |
| `POST run` `{script_id, tests[], tags, test_types}` | запускает сценарий с выбранными кейсами через `AUTOTEST_TESTS` |
| `POST check-builds` | проверяет источник версий (URL/файл по regex) и запускает правила автозапуска |
| `GET history`, `GET script-options` | история прогонов; найденные скрипты во фреймворке |

**UX-логика (важно):**
- **Общий путь фреймворка:** `framework_path` хранится в серверном конфиге и общий для ОБЕИХ вкладок (генерация читает/пишет через `getAutotestRunConfig`/`saveAutotestRunConfig`). Привязал на одной — видно на другой.
- **Пустое состояние:** если `framework_path` не задан, на вкладке «Запуск» видно ТОЛЬКО блок подключения (дерево/запуск/автозапуск/настройка скрыты).
- **Понятные названия:** при первом подключении автоматически вызывается `analyze-tree` (нужен рабочий LLM-провайдер из глобального выбора слева). В дереве показывается `label || display`; кнопка «Обновить названия (AI)» — повторить.
- **Значок «?»** у каждого класса/метода (`TestTree.tsx`): по клику показывает НАСТОЯЩЕЕ имя + пакет/файл + путь (`pkg.Class#method`).
- **Дерево** (`frontend/components/autotest/TestTree.tsx`): пакет→класс(группа)→метод(кейс), поиск, фильтр по тегам, трёхсостояние чекбоксов, счётчик «Выбрано N».

Файлы: `backend/api/autotest_runs.py`, `frontend/lib/autotestRunsApi.ts`, `frontend/components/AutotestRunPanel.tsx`, `frontend/components/autotest/TestTree.tsx`, `frontend/components/sections/AutoModelSection.tsx`.

---

## 12. Кастомизация интерфейса (новое)

- **Порядок и видимость разделов сайдбара:** кнопка «**Настроить разделы**» внизу списка навигации (`Sidebar.tsx`) включает режим настройки — grip-ручки для drag-and-drop порядка и «глаз» для скрытия/показа разделов. Сохраняется в `st_nav_order` / `st_nav_hidden`. Вне режима — обычная навигация + drag раздела в правую панель (не конфликтуют).
- **Порядок скриптов в «Алертах»:** строки скриптов (в корне и внутри папок) перетаскиваются мышью; порядок в `st_alert_script_order` (`AlertsSection.tsx`, клиентский).
- **Темы:** переключатель темы в футере сайдбара; светлая/тёмная заданы CSS-переменными (см. §9).
- **«Искать тестовые данные в БД»** в генерации (`GenerationSection.tsx`): блок виден всегда; без подключений к БД показывает CTA-ссылку в Настройки → Тестовые данные.

---

## CHANGELOG — журнал изменений проекта

> Пополняй этот раздел при КАЖДОМ значимом изменении (новая запись сверху).
> Формат: `### YYYY-MM-DD — краткий заголовок` + буллеты что/почему/где.

### 2026-10-18 — Zephyr Tool: новая модель — раскладка по дереву и «Применить»

- **Источники**: файл XML (кнопка «Новая модель из XML» над деревом) и генерация SimpleTest («Открыть в Zephyr Tool» в
  `ExportPanel` → sessionStorage `st_zephyr_import` → раздел забирает при открытии). Разбор — `POST /api/zephyr/parse-xml`
  (`parse_zephyr_xml`: `<folders>`, `<testCase>` с папкой, шагами, `customFields`, CHECKBOX → bool; DOCTYPE/ENTITY отклоняются,
  предел 20 МБ — defusedxml в проекте нет).
- **Черновик** (`lib/zephyrStaging.ts`, localStorage `st_zephyr_staging:<проект>`): все папки XML — новые (даже при совпадении
  имён), у папки родитель `root | existing(path) | new(id)`, у кейса цель `existing | new`. `FolderTree` рисует сверху блок
  «Новая модель · в корне», новые папки внутри папок дерева (с отметкой «+N» у старой), перенос HTML5 DnD с автораскрытием
  через 0,5 с и запретом положить папку в свою же вложенную.
- **«Применить»** (`ApplyDialog` → `POST /api/zephyr/apply`): папки — только те, где остались кейсы, родители раньше детей
  (`POST /rest/atm/1.0/folder`, «уже есть» — не ошибка); кейсы — `POST /testcase` с `testScript STEP_BY_STEP`; 400 с
  пользовательскими полями — повтор без них с предупреждением; кейс в несозданной папке не отправляется. Созданное уходит из
  черновика, ошибки остаются у кейсов. Тесты — `tests/test_zephyr.py` (22).

### 2026-10-17 — Zephyr Tool: крит регресс релиза и плеер прохождения

- **Вкладка «Крит регресс»** (`CritRegressView.tsx`, первая вкладка раздела): номер релиза → `GET /api/zephyr/release/{key}`
  (issue с `expand=names`; КЭ — `customfield_18300` и поля с «КЭ» в названии, значения `{id,value}` / «название (id)» / id) →
  чипы КЭ (снять/добавить) → `POST /api/zephyr/crit-cases`: поиск кейсов только по статусу (его понимают оба варианта запроса),
  пользовательские поля («Крит регресс», «Тип тестирования», «КЭ») проверяются на бэкенде (`crit_filter`, совпадение КЭ —
  по id, иначе по названию), в ответе счётчики отсева. Условия редактируются и хранятся в `st_zephyr_crit`.
- **Прогон**: `POST /api/zephyr/runs` → `POST /rest/atm/1.0/testrun` (запасной — `testcycle`) с `items` и `issueKey` = релиз
  (отслеживание). Запись перебирает варианты только на 404/405 — на 400 не пробует другой путь, чтобы не создать дубль.
- **Результаты**: `POST /api/zephyr/run/{key}/results` → пачкой `testrun/{key}/testresults`, иначе по кейсу
  `testrun/{key}/testcase/{case}/testresult`; сбой одного кейса не роняет остальные. «Пройти все» — Pass всем с подтверждением.
- **Плеер** (`Player.tsx`): шаги Pass/Fail/Blocked (1/2/3 — первый неотмеченный шаг), фактический результат шага, таймер,
  итог по шагам (Fail > Blocked > Pass), «Завести дефект» — `IssueFormModal` с новыми `prefill` и `jiraOnly` (описание в Markdown:
  `_md_to_jira` превратил бы «# шаг» в заголовок), ключ дефекта уходит в `issueLinks` результата; Ctrl+Enter — сохранить и дальше.
  «Пройти» есть и у прогона на вкладке «Прогоны». Тесты — `tests/test_zephyr.py` (18).

### 2026-10-17 — Zephyr Tool, этап 1: просмотр проекта тестирования и проверка API

- **Раздел** `/zephyr` («Zephyr Tool», `ZephyrSection.tsx`, `components/zephyr/`): вкладки «Кейсы» (дерево папок `FolderTree` —
  дочерняя папка сдвинута на 16 px, счётчики, поиск; список кейсов папки с поиском по названию; карточка `CaseCard` —
  цель, предусловие, шаги, метки, связи с Jira) и «Прогоны» (`RunsView` — прогресс по статусам, задача Jira прогона,
  кейсы со статусами и дефектами). Текстовые поля Zephyr — HTML → текст (`zText`, DOMParser).
- **Бэкенд** `backend/api/zephyr.py` (тот же PAT, `_jira_request`): `/api/zephyr/tree|cases|case/{key}|runs|run/{key}` и
  `/api/zephyr/probe`. Документация стенда и публичный API Zephyr Scale Server расходятся (`testrun` против `testcycle`,
  `query=projectKey` против `JQL=project`, дерево — только во внутреннем `/rest/tests/1.0/.../foldertree`), поэтому запросы
  перебирают варианты и запоминают сработавший (`_working`); дерево — из foldertree, иначе из путей кейсов.
  Проверка API — только чтение, отчёт с каркасом ответов (ключи и типы, без данных; образцы — по галочке).
- **Решения Стефана**: «отслеживание» = связь с задачами Jira; этапами с проверкой; правки уходят в Jira сразу при сохранении,
  удаление — с подтверждением. **Этап 2** (после отчёта): CRUD кейсов/папок/прогонов, добавление кейсов в прогон, связи,
  плеер прохождения с дефектом из упавшего шага. Тесты — `tests/test_zephyr.py`.

### 2026-10-17 — Jira tool: фикс — фильтр по колонкам скрыл все задачи, таблица пропадала

- **Причина**: раздел проверял пустоту по `listIssues` (уже после фильтров колонок) и вместо таблицы показывал
  «Задачи списка не загрузились» — исчезали и заголовки с воронками, снять фильтр было негде.
- **Исправление**: «не загрузились» / «по запросу ничего нет» — по `searched` (до фильтров колонок); если пусто
  только из-за фильтров, `ListTable` остаётся, в теле — «Фильтр по колонкам скрыл все задачи» и «Сбросить фильтры»
  (`onResetFilters`), надпись прижата слева и не уезжает при прокрутке вбок.

### 2026-10-17 — Jira tool: вложения при создании задачи, вставка ⌘V

- **Было**: файлы прикладывались только в блоке генерации; в Jira уходили лишь PNG/JPG дефекта и только после
  генерации (нужны были имена скриншотов из ответа); вставки из буфера не было.
- **Стало** (`IssueFormModal` + `AttachmentsField.tsx` + `lib/attachments.ts`): блок «Вложения» под описанием —
  кнопка, перетаскивание, ⌘V/Ctrl+V в любом месте формы (`onPaste`, берутся только файлы — текст вставляется
  как обычно), превью картинок (object URL с освобождением), размер. В Jira уходят все файлы у дефекта и задачи.
- **Имена**: `withUniqueNames` — вставка из буфера («image.png») → `screenshot-ГГГГММДД-ЧЧММСС[-N].ext`, остальные
  очищаются как `bugs._SAFE_NAME_RE` (только латиница/цифры/._-), дубли нумеруются. Генерация пишет в описании `!имя!`;
  имя запоминается за самим файлом (`shotNames: Map<File, string>`), не по порядку — добавление/удаление файлов
  после генерации его не сбивает.
- **Генерация** получает только читаемые файлы (`PARSEABLE_RE`): видео/архив иначе сломали бы её «Недопустимым форматом».
- **Бэкенд** `/api/jira/attach/{key}`: тексты предупреждений нейтральны («SBER911-1 создана…»), 413 — «слишком большой файл».
  Тесты — `tests/test_jira_attach.py`. В черновике SimpleTest вложения не сохраняются (File в localStorage не положить).

### 2026-10-17 — Jira tool: выпадающие списки у края экрана, фильтры в колонках, вложенность папок

- **Ошибка**: выпадающие окна ячеек (статус (st), теги, фамилии направлений, требования, множественный выбор)
  открывались только вниз — у нижних строк уходили за край экрана; множественный выбор был внутри таблицы
  и обрезался её прокруткой. **Исправление**: общий `components/jiratool/Floating.tsx` — портал в body, fixed;
  вниз, если влезает (иначе вверх), высота не больше места на экране, по горизонтали не за край; при прокрутке
  едет за ячейкой; закрытие щелчком мимо и Esc. До расчёта места окно прозрачное (не `visibility: hidden` —
  иначе поле с autoFocus не получает фокус). Все пять окон в `ListCells.tsx` переведены на него.
- **Ширина колонки**: ручка в заголовке работала, но была невидимой; теперь видимая черта-разделитель
  (под мышью — толще и цветная), зона захвата 12 px.
- **Фильтр в заголовке** (`ColumnFilter.tsx`): галочки по `colValues` колонки с числом задач и поиском; варианты
  считаются по задачам, прошедшим остальные фильтры (как в Excel); фильтры колонок — «И». Состояние — в разделе
  (`colFilters`), не сохраняется и сбрасывается при смене списка: скрытый сохранённый фильтр путал бы.
- **Вложенность папок** (`ListTable.tsx`): первый уровень в папке — отступ `FOLDER_PAD` = 42 px (ключ начинается
  под названием папки). Линию-ветку слева пробовали — Стефан попросил убрать: отступа достаточно.

### 2026-10-16 — Данные: Markdown в исходнике требования

- **Загрузка**: `.md` / `.markdown` разрешены (`agents/file_parser.py` — читаются как текст, `ALLOWED_EXTENSIONS`;
  `ACCEPT_FILES` в `EtalonsSection`). Тест — `tests/test_file_parser.py`.
- **Показ**: `SourceText` в `RequirementsTab` — если текст похож на Markdown (`looksLikeMarkdown` в `NotionRenderer.tsx`:
  заголовок, блок кода, ≥2 строк разметки или строка разметки + жирный/ссылка/код), он отрисовывается `NotionRenderer`,
  иначе — `<pre>` как раньше (текст из PDF/DOCX). У размеченного — переключатель «Разметка / Текст».
- **NotionRenderer**: добавлены ссылки `[текст](https://…)` (новая вкладка) и цитаты `> …` — заодно и в QA-документации.

### 2026-10-16 — Jira tool: «Требования (st)» — документы и ссылка на исходник

- **Данные**: `ToolState.reqUrls` (ключ → ссылка) рядом с `reqLinks` (документы «Данных»), на уровне задачи;
  переносится при отправке черновика, в экспорте и импорте.
- **Ячейка** (`ReqCell`): документы — ссылки `/etalons?req=<id>` в новой вкладке; исходник — значок планеты
  (`linkHref`, только http/https) в новой вкладке. Карандаш при наведении или пустая ячейка — окно: ссылка сверху,
  документы с поиском и галочками ниже. Окно при прокрутке таблицы едет за ячейкой, а не закрывается.
- **«Данные»** (`EtalonsSection` → `RequirementsTab`): `?req=<id>` в адресе — раскрыть это требование и прокрутить
  к нему после загрузки списка (читается из `window.location`, без `useSearchParams` — не нужен Suspense).

### 2026-10-16 — Jira tool: участник в строке без приписки должности

- `ParticipantCell` (`ListCells.tsx`): в выпадающем списке участника только ФИО — должность уже в цветной метке слева.
  В форме создания задачи (`IssueFormModal`) приписка осталась: метки там нет, это единственное место, где видна должность.

### 2026-10-16 — Jira tool: норма дня и резервы в нагрузке; ручной статус без значка

- **Нагрузка** (`lib/jiraTool.ts`): `ToolState.loadSettings = { dayMinutes, reserves[] }` — общая для всех списков
  (норма и резервы относятся к людям). Резерв `{ name, minutes/день, participants }`, пусто — всем.
  `netDayMinutes` = норма − резервы участника (≥ 0); `listLoad(..., settings)` даёт capacity на участника,
  `reserves` и `reserved` за период. Старое хранилище без настройки — норма 7 ч (`normLoadSettings`).
- **Интерфейс**: шестерёнка в «Нагрузка по списку» → `LoadSettingsModal` (часы дня, резервы с «Кому: Всем / участники»,
  предпросмотр «на задачи в день останется»). В панели: «в день 7 ч − Автотесты 1 ч = 6 ч»; личные резервы — под строкой
  участника, всё — в подсказке строки.
- **Экспорт/импорт**: `loadReserves` (общие и участников файла); при импорте добавляются отсутствующие по id, участники
  переводятся на своих; личный резерв без сопоставленных участников отбрасывается (иначе стал бы общим). Норма дня не меняется.
- **Ручной статус (st)**: значок руки убран (по просьбе Стефана), стрелка — только при наведении. Ручной виден в подсказке
  статуса и в меню (галочка, «По Jira: …»).

### 2026-10-15 — Jira tool: статус (st) вручную — нижняя планка над Jira

- **Зачем**: статусы в Jira часто не двигают до конца (метрики руководителей), а списку нужна реальность.
- **Правило** (`withManual` в `lib/jiraStages.ts`): действующий статус = max(ручной, по Jira) по порядку продвижения.
  Jira выше ручного — показываем Jira; ручной ниже Jira выбрать нельзя. «Исключено» по Jira (отменена) важнее ручного,
  «Заблокирован» — поверх любого. У эпика ручные статусы сторей входят в расчёт (минимум по сторям), свой ручной у эпика —
  такая же планка поверх расчёта. `StageInfo.manual` хранит то, что показала бы Jira (для подсказки).
- **Хранение**: `ToolState.stageManual` (ключ → этап) — на уровне SimpleTest, как требования: реальность у задачи одна во
  всех списках. Переносится при отправке черновика, выгружается в экспорт и подтягивается импортом (свой важнее файла).
- **Интерфейс**: стрелка рядом со статусом (st) в строке (`StageCell`) — меню: «По Jira: …», этапы (ниже Jira — неактивны),
  «Сбросить — как в Jira». У действующего ручного статуса — значок руки и подсказка «По Jira — …».
- **Эпик**: клик по самому статусу — окно со сторями (`StageModal`, только просмотр), стрелка — ручной статус.
  Счётчик сторей «1/2» рядом со статусом эпика убран (по просьбе Стефана): подробности — в окне.
  Меню при прокрутке таблицы едет за стрелкой, а не закрывается (фокус на стрелке сам подкручивает таблицу).
- **Нюанс**: ниже «Разработки» встроенных этапов нет, поэтому «Бэклог» считается «Разработкой». Чтобы различать их —
  добавить свой статус «в начале» в «Статус (st) → Названия и цвета» и сопоставить с ним бэклог.

### 2026-10-14 — Jira tool: ярлычки ячеек своих текстовых полей (как иконки Notion)

- **Что**: в режиме редактирования ячейки «Свободный ввод» справа в поле кнопка; окно `IconPicker` — вкладки «Иконки»
  (все ~1700 иконок Lucide, цвет из палитры Notion) и «Эмодзи» (свой набор `lib/emoji.ts`), фильтр с русскими словами,
  случайный ярлычок, недавние, «Убрать». Ярлычок показывается слева от текста ячейки.
- **Хранение**: `TaskList.icons` (ключ → id поля → код `i:<Имя>:#hex` или `e:<эмодзи>`), отдельно от текста — поиск,
  сортировка, группировка и отчёт в чат его не видят. Переносится при отправке черновика (`replaceDraft`) и импорте.
- **Вес**: набор иконок грузится отдельным куском по первому требованию (`lib/cellIcon.ts`, `useIcons`), окно —
  через `next/dynamic`; основная страница не тяжелеет. Недавние и выбранный цвет — localStorage этого браузера
  (`st_cell_icon_recent`, `st_cell_icon_color`).

### 2026-10-14 — Jira tool: читаемый формат «Скопировать в чат»

- `chatReport` (`lib/jiraTool.ts`): сверху `*Статус — <название списка>*`, разделы по папкам через пустую строку (`*Папка*`),
  строка задачи `*(KEY) Тема* — <кружок> <статус (st)>`, под ней `Дефекты:` и по строке на каждый неустранённый
  дефект `(KEY) Тема. Приоритет: X`. Участник и счётчик дефектов из строки убраны — по образцу Стефана.
- Кружок — `stageDot` (`lib/jiraStages.ts`): встроенные статусы по смыслу (🔵 разработка, 🟡 тестирование,
  🟢 готово к релизу, ✅ готово, ⚪ исключено, 🔴 заблокирован), свои — по ближайшему к их цвету (серые → ⚪/⚫).

### 2026-10-14 — Jira tool: карточка задачи и смена статуса в несколько шагов

- **Карточка задачи**: клик по «Теме» в списке (`ListTable`, колонка `jira:summary`, кроме черновиков) открывает
  `components/jiratool/IssueModal.tsx` — автор, исполнитель, описание. Данные уже есть в кэше задач (поля `reporter`,
  `assignee`, `description` приходят с `*navigable`), запроса к Jira нет. Вики-теги `{color}`, `{code}` и т.п. убираются,
  ссылки `[текст|url]` и голые http(s) — кликабельны.
- **Смена статуса в несколько шагов** (`BulkStatusModal`): после перевода окно не закрывается — новый статус задач
  запоминается локально (`moved`), переходы запрашиваются заново (`round`), сверху сводка «Сейчас» и сделанные шаги.
  Выбор в списке сбрасывается только при закрытии окна, если что-то переводилось (`onClose(moved)`).
- **Почему не автопроход до итогового статуса**: Стефан выбрал ручной контроль каждого шага; автопоиск пути по схеме
  workflow (нужны права администратора, `/rest/api/2/workflow`) — возможное развитие.

### 2026-10-13 — Ускорение первичной установки (install.sh / start.sh)

- **Почему было долго**: pip ставит ~125 пакетов (~150 МБ, все колёсами — сборки из исходников нет), но с `-q`
  прогресс скрыт и установка выглядит зависшей; `npm install` ходил в сеть за audit/fund и тянул eslint
  (258 пакетов, нигде не запускался); модель поиска ChromaDB (~80 МБ) скачивалась молча при первой работе с эталонами.
- **Что сделано**:
  - `frontend/package.json`: удалены `eslint` и `eslint-config-next`; скрипт `lint` заменён на `typecheck` (`tsc --noEmit`).
    node_modules: 23 тыс. → 14,7 тыс. файлов, 430 → 373 МБ; чистая установка — ~13 с.
  - `start.sh`: pip с `--prefer-binary` и видимым прогрессом; Node-зависимости — `npm ci --no-audit --no-fund`
    и только при смене `package-lock.json` (метка `frontend/.deps-installed` = sha256 lock-файла).
  - `install.sh`: тот же pip, шаг `npm ci` с меткой, предзагрузка модели поиска ChromaDB (не фатально).
  - `db/vector_store.py`: телеметрия ChromaDB отключена (`anonymized_telemetry=False`) — без лишних сетевых вызовов.
- **Не исправить скриптами**: первая компиляция `next dev` (кэш `.next` ~1 ГБ) и нехватка RAM на машине.

### 2026-10-13 — Отключены веб-коннекторы, «Логи» и MCP-сервер (код сохранён)

- **Что**: веб-коннекторы (Playwright: запись и повтор действий на сайтах), раздел «Логи» (анализатор работает только через
  сценарий коннектора) и MCP-сервер для GigaCode (консоль dropup через браузер, разбор логов).
- **Как** — одним флагом, без удаления кода:
  - `backend/main.py`: `WEB_CONNECTORS_ENABLED = False` — роутер `/api/webconnect/*` не подключается, модуль не
    импортируется; при старте не грузятся playwright, mcp, cryptography (проверено по `sys.modules`).
  - `frontend/lib/features.ts`: `WEB_CONNECTORS_ENABLED = false` — «Логи» убраны из меню (`Sidebar.NAV_VISIBLE`),
    плитка «Веб-коннекторы» — из «Генераторов событий»; прямой адрес `/logs` — заглушка `FeatureDisabled`.
  - `requirements.txt`: `mcp`, `playwright`, `cryptography` закомментированы — новые окружения их не ставят.
  - `tests/test_mcp_server.py` пропускается без пакета `mcp` (`importorskip`); остальные тесты коннекторов идут —
    их код на месте.
- **Вернуть**: оба флага в `True` и раскомментировать три пакета (описано в CLAUDE.md, «Временно отключено»).

### 2026-10-13 — Jira tool: экспорт и импорт списков файлом

- **Зачем**: данные Jira tool живут в браузере (`localStorage`, привязан к адресу с портом: `localhost:3000` и `:3001` —
  разные хранилища). Файл позволяет не потерять списки и передать их коллеге.
- **Формат** — JSON (`ExportFile`, `format: "simpletest.jira-tool"`, `version: 1`): списки целиком (задачи, папки, колонки,
  представления, свои поля и значения, трудозатраты, направления, отметки и источники) и то, на что они ссылаются, —
  участники списка, фамилии направлений, привязки требований задач, черновики, свои статусы (st) и их оформление.
- **Экспорт** (`exportLists`): блок «Списки» → кнопка скачивания → «Текущий список» / «Все списки»; файл
  `SimpleTest — <список> — <дата>.json`.
- **Импорт** (`parseExportFile` + `importLists`): кнопка загрузки → файл. Списки добавляются новыми (одноимённый — с
  «(импорт)»), ничего у получателя не затирается; участник с тем же ФИО — тот же человек; черновик с занятым номером
  получает новый, и всё по его ключу (участник, папка, значения, траты, направления, требования) переезжает;
  фамилии направлений и свои статусы объединяются. Чужой или битый файл — понятная ошибка; файл из более новой
  версии — просьба обновить проект.
- Проверено в браузере: экспорт → импорт «коллегой» с совпадающими названием, номером черновика и участником.

### 2026-10-12 — Jira tool: «Некорректное имя резолюции» при смене статуса

- **Причина**: «Решение» выбиралось из общего справочника Jira (`/rest/api/2/resolution`), а на переходе Jira
  разрешает только свои варианты — «Исправлен» отвергался. Решение к тому же уходило названием.
- **Исправление**: `POST /api/jira/tool/transitions` отдаёт у перехода `resolutions` — `allowedValues` поля
  resolution (id + название); в окне смены статуса список «Решение» — только общие для выбранных переходов варианты,
  в Jira уходит **id** (`{"resolution": {"id": …}}`; название — запасной путь, если Jira варианты не прислала).
  Разные задачи разрешают разные решения без общего — подсказка «переведите по группам».

### 2026-10-12 — Jira tool: релиз = версия Jira, эпик → стори в смене статуса, свои статусы (st), правки

- **Релиз — это версия Jira**, а не тип задачи «Релиз» (прежняя догадка неверна). Ссылка вида
  `…/projects/SBER911/versions/2568004`, состав — задачи с этой версией в «Исправить в версиях» (`fixVersion`).
  Бэкенд `GET /api/jira/tool/release?version=&project=` (`parse_version_ref`: ссылка, id или название версии —
  название ищется в `/project/{key}/versions`), JQL `fixVersion = <id>`, эпики по Epic Link. Вкладка «Из релиза»
  показывает название версии, выпущена ли, дату релиза; связи и их переключатели убраны. Сверка источника — та же.
- **Смена статуса через эпик** (`BulkStatusModal`, `storiesOf`): выбранный эпик раскладывается на свои стори
  (Epic Link), переход выполняется им, а не эпику; дубли (стори выбрана и сама) — один раз. Переходы
  запрашиваются и выполняются пачками по 200 (`getTransitions`/`applyTransitions`).
- **Свои статусы (st)** — «Статус (st)» → «Названия и цвета» → «Добавить статус»: название, цвет и «после какого»
  статуса стоит в продвижении (`CustomStage`, `ToolState.customStages`, `stageOrder`). `Stage` теперь строка,
  `STAGES` меняется на месте (`applyStageStyles(styles, custom)`), эпик берёт минимальный этап по порядку
  (`stageRankOf`), «Готово к релизу и дальше» для нагрузки — тоже по порядку. Свой статус сопоставляется со статусами
  Jira на вкладках групп; удалили — сопоставления с ним снимаются («Не сопоставлен»).
- **Группировка** — только по значениям, у которых есть задачи: участник без задач группой не показывается
  (раньше пустые группы участников и вариантов первого уровня показывались ради переноса).
- **Выбор эпика в форме** — список рисуется порталом у `body`: окно формы анимируется `transform`, и fixed-список
  внутри него считал координаты от окна (уезжал в правый нижний угол). Кнопка «выгрузить эпики из Jira /
  выгрузить заново» вернулась над полем.
- **«ИТ-услуга» / «КЭ» не проставились** — сообщение было неточным: «отсутствует на экране» писалось всегда, потому
  что `createmeta` у нас 403 и есть ли поле на экране, неизвестно. Теперь — «Jira не приняла значение» и ответ Jira
  как есть (`_ensure_reference_fields`). Сама причина не устранена: поля — плагинного типа Сбера
  (`sbtconfigurationitemmulticftype`), ни один из пробуемых форматов Jira не принимает; нужен JSON поля из
  заполненного дефекта и `editmeta`. Тесты — `tests/test_jira_defect_fields.py`, `tests/test_jira_tool.py`.
- Значения ИТ-услуги (233293) и КЭ (3521751) Стефан подтвердил — совпадают с `jira_constants.py`. В перебор форматов
  (`_reference_candidates`) добавлены голый id и «название (id)» — так Jira Сбера показывает эти поля; идут после
  прежних вариантов. Подтверждения на настоящей Jira пока нет.

### 2026-10-12 — Jira tool: представления списка

- **Представление** = набор колонок списка (порядок, закреплённые, ширины). Папки, порядок задач, группировка,
  значения и задачи — общие для всех представлений. Модель (`lib/jiraTool.ts`): `TaskList.views`, `activeView`;
  действующее представление живёт в самих полях списка (`columns`, `pinned`, `widths`), остальные — в `views`
  (`listViews`, `switchView`, `addView`, `renameView`, `deleteView`). Без представлений список — одно «Основное».
- UI (`ViewSwitcher`) — кружочки с буквами названия слева в шапке списка: клик — переключиться; клик по действующему —
  переименовать / удалить (последнее не удаляется); «+» — новое представление: ключ, тип и тема
  (`VIEW_BASE_COLUMNS`), дальше колонки набираются как обычно и сохраняются за этим представлением.
- Проверено в браузере: новое представление, свои колонки в нём, переключение туда-обратно (колонки, закрепление,
  ширины возвращаются; папки и порядок задач те же), переименование, удаление действующего.

### 2026-10-12 — Jira tool: «Из релиза» — вкладка в «Добавить задачи», сверка состава источников

- Кнопка «Из релиза» в шапке убрана; релиз — третья вкладка окна «Добавить задачи» после JQL (`ReleaseTab`,
  бывший `ReleaseImportModal`): отмеченное уходит в корзину, дальше «Сохранить». `TaskList.release` заменён источниками.
- **Источники** (`TaskList.sources`, `ListSource`): задачи из JQL-фильтра и релиза запоминают источник со
  **снимком состава** — все результаты фильтра (не только отмеченные, иначе неотмеченные пришли бы «новыми») /
  все строки релиза (эпики и задачи без эпика). Тот же запрос второй раз — снимки объединяются (`upsertSource`).
  JQL больше 1000 задач — источник не запоминается (снимок неполный), в окне есть пометка.
- **Сверка** (`checkSources` → `applySourceCheck`) — при обновлении кэша: фоново раз в 30 минут (все списки) и по
  «Обновить из Jira» (текущий). Новые задачи встают в список (в «Без папки») с отметкой **«n»** (синяя), задачи списка,
  выпавшие из источника, — **«У»** (красная) перед ключом; вернулись — «У» снимается. Отметки — `TaskList.marks`.
  «n» снимается переносом в папку (`setFolder`); если папок нет — кликом по отметке. Убрали задачу — отметка тоже.
- Левая колонка: «Источники · сверка состава» — запрос/релиз, сколько задач в составе, когда сверено,
  крестик «не отслеживать» (задачи остаются).
- Проверено в браузере на подменённой Jira: JQL-источник, смена результата фильтра → «n» у новой и «У» у выпавшей,
  перенос в папку снимает «n»; релиз через вкладку и корзину → второй источник.

### 2026-10-12 — Jira tool: задачи из релиза, кэш задач на сессию

- **Релиз** — тип задачи «Релиз» (id 14905 в SBER911), не «Release 2.0» (id 15305). По выгрузке Jira отдельного
  поля состава нет — состав берётся из **связей** задачи-релиза (issuelinks). На настоящей Jira не проверено.
- Бэкенд `GET /api/jira/tool/release?key=` (`jira_tool.release`, `release_links`): задача-релиз, связи с подписями
  («включает», «relates to»…), связанные задачи (все поля) и их эпики по Epic Link. Тесты — `tests/test_jira_tool.py`.
- Фронтенд: кнопка «Из релиза» (`ReleaseImportModal`): ссылка или ключ → предпросмотр. `composeRelease`: задача
  с эпиком (стори, дефект, задача) → эпик, задачи одного эпика — под ним («из релиза: стори 2 · дефекты 1»,
  раскрывается); без эпика — сама; эпик из состава — сам. Подписи связей можно отключить (лишние «relates to»);
  предупреждение, если вставлен «Release 2.0». Цель — текущий список или новый с названием релиза. Задачи сразу
  в кэш. В списке запоминается `TaskList.release` — «подтянуть» в левой колонке добавляет новые задачи релиза.
- **Кэш задач на сессию** (`lib/jiraToolCache.ts`): задачи, связанные, «нет в Jira» — в памяти модуля (переходы
  между разделами) и копией в sessionStorage `st_jira_tool_cache` (перезагрузка вкладки; переполнение — только
  память). Вернулись в раздел — список сразу из кэша, без запросов. **Фоновое обновление** всех задач всех списков —
  раз в 30 минут, пока раздел открыт, и при открытии, если кэш старше 30 минут; в шапке — «данные Jira: чч:мм».
  Сменился сервер Jira — кэш сбрасывается (`bindCacheTo`). Удалённые из Jira задачи из кэша убираются.
- Проверено в браузере на подменённых ответах Jira: состав и группировка релиза, импорт, показ из кэша после
  возврата в раздел (~90 мс, без запросов), фоновое обновление устаревшего кэша.

### 2026-10-12 — Jira tool: «Добавить в список» при создании задачи

- В форме «Создать задачу» (`IssueFormModal`) — галочка «Добавить в список «<название>»», по умолчанию включена.
  Включена — как раньше: черновик или созданная в Jira задача встаёт в текущий список. Выключена — задача только
  создаётся в Jira (`IssueDraft.addToList = false`, `saveIssue` список не трогает), а «Создать в SimpleTest»
  недоступно: черновику без списка негде жить. У черновика из списка галочки нет — он уже в списке.

### 2026-10-12 — Jira tool: эпики при создании задачи — на сессию, выбор с поиском

- Выгруженный список эпиков (`st_jira_epics`, `readEpicsCache`/`writeEpicsCache` в `JiraRegisterPanel`) теперь
  в **sessionStorage**, а не бессрочно в localStorage: живёт до конца сессии вкладки, новая сессия выгружает свежий.
  Старая копия из localStorage удаляется при записи.
- Форма «Создать задачу» сама выгружает эпики при первом открытии в сессии (если Jira подключена и в сессии их нет);
  дальше — из сессии, «обновить» — в выпадающем списке.
- Выбор эпика — `EpicPicker` в стиле платформы вместо системного `select`: строка поиска по номеру и названию
  без учёта регистра, ↑/↓/Enter/Esc, отметка выбранного, внизу — «Эпиков: N · выгружено …» и «обновить».
  Список рисуется поверх формы (fixed) и открывается вверх, если внизу мало места.

### 2026-10-12 — Jira tool: отчёт в чат, чек-лист, «Требования (st)»

- **Кнопки под таблицей** «Скопировать в чат» и «Чек-лист» — только в режиме выбора (карандаш), по отмеченным
  задачам, в порядке таблицы (с сортировкой), по папкам. Текст — в буфер обмена, разметка Сберчата (*жирный*, _курсив_).
  Если браузер не дал скопировать сам (после долгой генерации) — кнопка «Скопировать» (новое нажатие).
- **Отчёт в чат** (`chatReport`): `*КОД* — наименование — статус (st) — дефектов: N | дефектов нет — участник`;
  под фичей — неустранённые дефекты `• номер наименование — статус — приоритет`; между фичами — пустая строка;
  у дефекта в списке сегмента «дефектов» нет.
- **Чек-лист** (`checklistReport`): `*КОД* наименование`, затем `_Критически важные базовые проверки:_` (нумерованно,
  если у фичи есть требования и выбрана модель) и `_Результат проверок:_` — заполняет тестировщик.
  Генерация — по одной фиче, с прогрессом и «прервать»; результат кешируется в сессии по фиче (ключ — требования
  + название), повторное нажатие LLM не дёргает.
- **Бэкенд** `POST /api/tasks/checklist` (`backend/api/bugs.py`): требования по id из «Данных» (контекст до 12 000
  символов) → 3–8 проверок языком бизнес-пользователя для младшего специалиста сопровождения; ответ разбирается
  в пункты (`parse_checks`, Markdown убирается). Без требований с текстом — 400. Тесты: `tests/test_checklist.py`.
- **«Требования (st)»** (`REQ_COL`, `ReqCell`): документы раздела «Данные», несколько; хранятся на уровне SimpleTest
  (`ToolState.reqLinks`: ключ задачи → id), общие на все списки; переезжают с черновика в Jira. Без колонки —
  «Требования…» в панели выбора (`ReqAssignModal`: добавить / заменить / снять у выбранных).
- `fetchJson` (`lib/jiraApi.ts`): `detail` объектом `{message}` теперь даёт текст ошибки, а не «[object Object]».
- Проверено: отчёт и чек-лист без требований, запасное копирование, окно требований (пустое — локально требований
  нет); генерация проверок — только тестами с подменённой моделью.

### 2026-10-12 — Jira tool: своё поле «Ссылка»

- Новый тип своего поля `link` («Ссылка»). В ячейке (`LinkCell`) — значок глобуса: клик открывает ссылку в новой
  вкладке (`rel="noopener noreferrer"`), адрес — в подсказке, карандаш при наведении — изменить; пусто — «+ ссылка».
- `linkHref`: вставить можно что угодно; без схемы — `https://`; открываются только http(s) — `javascript:` и прочие
  схемы не исполняются; текст с пробелами или без домена — серый глобус «не похоже на ссылку».
- Не группируется (у каждой задачи своя ссылка); ширина колонки по умолчанию 90 px.

### 2026-10-12 — Jira tool: исключение задач из нагрузки

- **Вручную**: колонка «Нагрузка (st)» (`LOAD_COL`, `LoadCell`) — галочка «учитывать»; в режиме выбора —
  «Нагрузка… → Не учитывать / Учитывать» для выбранных. Хранится в `TaskList.noLoad` (ключ → true),
  переезжает вместе с черновиком при отправке в Jira (`replaceDraft`). Пример: протестировали, а задачу ещё не перевели.
- **Автоматически**: задачи в статусе (st) «Готово к релизу» и дальше («Готово», «Исключено»; у заблокированной —
  по этапу без блокировки, `isReleaseOrLater`) не учитываются. Правило — галочка в блоке «Нагрузка по списку»,
  своя у каждого списка (`TaskList.loadAuto`, по умолчанию включено). В ячейке такая задача — «нет · по статусу».
- Расчёт (`listLoad` + `loadSkip`): исключённые задачи не идут ни в план, ни в «без плана»; в блоке — «Не учтено
  задач: N», у участника в подсказке — сколько его задач не учтено. Колонка группируется по «Учитывается /
  Не учитывается (вручную / статус)».

### 2026-10-12 — Jira tool: перетаскивание строк (исправление)

- **Симптом**: папки перетаскивались, строки — нет.
- **Отличия строк от папок** (у папок перенос работал), каждое — известная причина срыва HTML5-переноса:
  1) ручка строки была `<button>` — Firefox и Safari не начинают перенос с кнопки (у папки — `span`);
  2) `draggable` у строки ставился через состояние React (`armed`) после перерисовки по нажатию, а браузер
     решает, что тянуть, по нажатию; 3) в `dragstart` строка меняла состояние (`setDragRow`) — перерисовка
     таблицы и вставка раздела «Без папки» во время старта; Chrome при изменении страницы в `dragstart`
     отменяет перенос.
- **Исправление** (`ListTable`): ручка — `span role="button"` (клавиатура ↑/↓ осталась); `draggable`
  ставится атрибутом в DOM прямо в обработчике нажатия (`arm`/`disarm`, без перерисовки); в `dragstart`
  только ссылки, подсветка — `setTimeout(0)`. Перенос без ручки отменяется (выделение текста в ячейках не ломается).
- Проверено событиями из скрипта; настоящей мышью автоматизация перенос не делает (ни строк, ни папок) —
  проверка за Стефаном.

### 2026-10-12 — Jira tool: шаблоны списков

- «Настройка списка» → кнопка шаблона: структура текущего списка сохраняется как шаблон (`templateOf`):
  колонки по порядку, свои поля (варианты, теги, цвета) и папки. Задачи, значения полей, участники,
  трудозатраты, группировка, ширины колонок и проект в шаблон **не** входят. Шаблон с тем же названием
  заменяется (предупреждение под полем).
- «Новый список» → выбор «Шаблон: …» (если шаблоны есть) → `listFromTemplate`: пустой список с этой
  структурой; колонки своих полей, которых нет в шаблоне, и «Папка (st)» без папок отбрасываются.
- Шаблоны общие на инструмент (`ToolState.templates`), список — в блоке «Списки», удаление по корзине при
  наведении (созданные по шаблону списки не меняются).

### 2026-10-12 — Jira tool: свои поля-списки как цветные теги

- У своего поля «Выпадающий список» / «Множественный выбор» — галочка «Показывать как цветные теги»
  (`OwnField.tags`) и цвет у каждого варианта (`OwnField.colors`, кружок в теге; без своего цвета — палитра
  `TAG_COLORS` по порядку варианта, `tagColor`). Цвета удалённых вариантов не хранятся.
- В таблице такие поля — теги (`TagCell`/`Tag` в `ListCells`): выбор во всплывающем списке поверх таблицы
  (position: fixed — внутри ячейки его обрезала бы прокрутка), у множественного — галочки. Подписи групп при
  группировке по такому полю — тоже теги.

### 2026-10-12 — Jira tool: свои названия и цвета статусов (st)

- В «Статус (st)» новая вкладка **«Названия и цвета»**: для «Разработка», «Тестирование», «Готово к релизу», «Готово»,
  «Исключено», «Заблокирован» — своё название и цвет (палитра), предпросмотр метки, сброс к умолчанию.
  Общие на все списки и проекты (`ToolState.stageStyles`, хранятся только отличия от умолчания).
- `lib/jiraStages.ts`: `DEFAULT_STAGE_STYLE`, действующие `STAGE_LABEL` и цвета меняются на месте через
  `applyStageStyles` (вызывается в `JiraToolSection` до расчёта этапов — от названия зависят группы и сортировка);
  метки рисуются заливкой цвета, текст белый/тёмный по яркости (`stageStyle`, `textOn`). Классы `STAGE_CLS` убраны.
- Проверка: названия не пустые, разные и не «Нет сторей» / «Не сопоставлен» — иначе «Сохранить» недоступно.
- Списки фамилий в полях направлений уже раздельные (`roleNames[поле]`), с участниками не связаны — без изменений.

### 2026-10-12 — Jira tool: «Заблокирован», поля направлений (st), нагрузка, окна статуса и дефектов

- **Статус (st) «Заблокирован»** (тёмно-красный, `StageInfo.kind = "blocked"`, `blockingDefects` в `lib/jiraStages.ts`):
  у задачи есть блокирующий дефект не в «Закрыт» (`isClosedDefect`) — свой (Epic Link/связь), у стори — ещё
  дефекты её эпика, у эпика — дефекты его сторей. Держится до «Закрыт». В сортировке и группах — первым.
- **Согласовано с «Дефекты (st)» и «Блок (st)»**: блокирующий дефект неустранён, пока не «Закрыт»
  (`isOpenDefect`), иначе эпик был бы заблокирован, а окно дефектов — пустое. Неблокирующие — как раньше
  (устранён с «Подтверждено исправление»). Дефекты задачи = свои + унаследованные блокирующие
  (`defectsOf` в `JiraToolSection`); дефекты показываются **только** в окне «Дефекты (st)».
- **«Готово» в статусе (st)** — зелёный; «Готово к релизу» — бирюзовый (`STAGE_CLS`).
- **Окно статуса (st)** (`StageModal`) — по клику на статус эпика: стори эпика (тип, номер со ссылкой в Jira,
  наименование, статус Jira, статус (st), исполнитель), сортировка по колонкам. Таблица задач вынесена
  в `IssueTable` (группы, сортировка внутри групп).
- **Окно дефектов** (`DefectsModal`): тип и номер со ссылкой в Jira; «Показать устранённые» — отдельной
  группой ниже, сортировка работает внутри каждой группы.
- **Поля направлений (st)**: Analytics, Design, Back, Front, Mobile, Dev, Sup (`ROLE_FIELDS`, колонки `role:<id>`).
  В ячейке (`RoleCell`) — фамилия (свой список у поля, общий на все списки — `ToolState.roleNames`; добавить и
  убрать прямо в выпадающем списке, в заполненных ячейках фамилия остаётся) и состояние цветом: серый — не взят,
  жёлтый — в работе, зелёный — выполнен (`TaskList.roles`). Группируются и сортируются по фамилии.
- **Нагрузка по списку** (`LoadPanel` в левой колонке): у каждого участника — сумма «Траты план (st)» его задач
  в списке против нормы за период (будни × 7 ч: 9–18 минус обед и утренние встречи, `LOAD_DAY_MINUTES`);
  превышение — красным, задачи без плана — подсказкой. Период свой у списка (`TaskList.load`, по умолчанию 2 недели).
- **Автопрокрутка** при переносе колонки: у границы закреплённых колонок или у правого края таблица едет вбок
  (~540 px/с), останавливается без событий 150 мс.
- **Импорт структуры выключен** (`STRUCTURE_ENABLED = false`): плагин Structure отвечает 403. Бэкенд и окно
  оставлены — включить флагом, когда появится доступ.

### 2026-10-12 — Jira tool: удаление папок, «Без папки» только с задачами

- **Удаление папки** — корзина у папки в левой колонке (блок «Папки», при наведении) с подтверждением:
  «Задачи (N) останутся в списке — в разделе «Без папки»». То же, что корзина в заголовке папки в таблице
  (`deleteFolder`): папка убирается из `folderList`, у её задач — из `folders`. Задачи из списка не удаляются.
- **«Без папки»** (`ListTable`) показывается, только если в нём есть задачи. Пока тянут строку, он виден
  пустым — чтобы задачу можно было вынуть из папки перетаскиванием.

### 2026-10-12 — Jira tool: режим выбора задач

- **Проблема**: при видимых чекбоксах строки не получалось перетащить. Логика переноса при выбранных строках
  исправна (проверено событиями перетаскивания из скрипта); вероятная причина — ручка ⋮⋮ (видна только при
  наведении) стоит вплотную к чекбоксу, и нажатие попадает в чекбокс.
- **Решение**: чекбоксы скрыты по умолчанию. Кнопка с карандашом в заголовке таблицы (слева от «Ключ»)
  включает режим выбора (`ListTable.selecting`): чекбоксы у строк, групп, папок и «выбрать все» + панель действий
  («Сменить статус», «Убрать из списка», «В папку…», «Отмена»). Повторное нажатие карандаша или «Отмена» скрывает
  чекбоксы и снимает выбор; смена списка — тоже.

### 2026-10-12 — Jira tool: настоящая Jira вместо моков

- **Убрано**: `frontend/lib/jiraMock.ts` (выдуманные задачи `MOCK_ISSUES`, проекты SBER911/PKAP/MONIT, мок-workflow,
  мок-структуры), локальный разбор JQL (`compileJql`), демо-наполнение (`initialState`: списки, участники, траты),
  «Сбросить демо-данные», подстановка шаблона при сбое генерации (`mockGenerated`) — теперь честная ошибка.
- **Бэкенд** `backend/api/jira_tool.py` (подключение и токен — те же, что у регистрации дефектов, `_load_cfg`/
  `_jira_request`): `GET /api/jira/tool/catalog` (поля с типами, Epic Link по типу поля, статусы по категориям,
  приоритеты, решения; кэш 10 мин), `/projects`, `/project-fields?project=` (поля, заполненные в последних 100
  задачах проекта — createmeta у нас 403), `POST /issues` (по ключам пачками по 100, `validateQuery=false`, при 400 —
  добор по одной), `/search` (JQL как есть), `/related` (стори и дефекты эпиков по `cf[Epic Link]` + задачи из
  связей), `GET /statuses?project=` (статусы по типам задач), `POST /transitions` и `/transition` (переходы
  workflow с обязательным «Решением», параллельно по 8), `GET /structures` и `/structures/{id}` (Structure 2.0:
  `forest/latest` → формула `rowId:depth:item`, имена и ключи строк — `POST /rest/structure/2.0/value`, без него —
  ключи по id задач). Задача уходит плоской: поля текстом, пустые не передаются, даты — ISO Jira.
  Тесты на подменённой Jira: `tests/test_jira_tool.py`.
- **Фронтенд**: модель — `lib/jiraModel.ts` (справочники сервера заполняются `setCatalog`, `epicLinkId()`),
  клиент — `lib/jiraToolApi.ts`. `JiraToolSection` держит кэш задач (не сохраняется), догружает задачи списка и
  связанные; баннер «Jira не подключена» с «Настроить Jira» / «Повторить»; «Обновить из Jira»; ключи, которых нет в
  Jira, — плашкой с «Убрать из списка». Проект списка — поле с подсказками из Jira (по умолчанию SBER911).
  Добавление задач, массовая смена статуса, «Статус (st)», импорт структуры — через API.
  Без сохранённой таблицы «Статус (st)» угадывается по названию статуса (`guessStage`).
- **Черновики** — ключ `SBER911-ЧЕРНОВИК-1` (не спутать с настоящей задачей). Созданная из формы задача сразу
  в списке с полями формы и через 2 с перечитывается из Jira.
- **Миграция**: состояние v1–v2 (мок-итерация) не переносится — ключи там выдуманные; сохраняются участники
  (кроме трёх демо) и сопоставление статусов. `ToolState.version = 3`, `changed` убран.
- **Не проверено на настоящей Jira** (локально её нет): ответы Jira и плагина Structure покрыты тестами по
  документации API; первая проверка — у Стефана в корп. сети.

### 2026-10-12 — Jira tool: трудозатраты, цветной тип задачи, закрепление колонок

- **Трудозатраты (st)** — `TaskList.spend[key] = {plan, start, end}`: «Траты план (st)» хранится в минутах, вводится
  в часах или минутах (переключатель ч/мин в ячейке, последняя единица помнится в браузере), понимает «1.5», «1:40»,
  «1 ч 40 мин», «90»; показ — «1 ч 40 мин» (`fmtMinutes`, `parseDuration`). «Начало/Конец теста (st)» — дата и время;
  «Траты факт (st)» = **рабочее время** между началом и концом (`factMinutes` → `workingMinutes`; `WORK_DAY`:
  пн–пт 9:00–18:00, обед 13:00–14:00 не считается, праздники пока нет); если не заполнено хоть одно — не считаем;
  больше плана — подсвечено с подсказкой. Суммы план/факт — в заголовках групп и папок. Не группируются.
- **Даты Jira** показываются как `дд.мм.гггг чч:мм` (поле-дата — `дд.мм.гггг`): `fmtJiraDate` понимает
  «2026-10-08», «2026-10-08 14:35» и ISO Jira с поясом «…T14:35:00.000+0300» (в местное время). Сортировка и
  группировка — по исходному значению (хронологически); подписи групп и поиск по списку — в новом формате.
- **Тип задачи** — цветной лейбл с иконкой как в Jira (`IssueTypeBadge`): дефект красный, эпик фиолетовый,
  стори/история зелёная, задача синяя, подзадача голубая, прочее серое.
- **Закрепление колонок** — булавка в заголовке (`TaskList.pinned`): закреплённые идут первыми и `position: sticky`
  остаются на месте при прокрутке вбок; ключ задачи и выбор закреплены всегда; подписи групп и папок не уезжают.
  Таблица одна на все папки — прокручивается целиком.

### 2026-10-12 — Алерты: порядок скриптов перетаскиванием — общий для команды

- Порядок скриптов = порядок в `data/alert_scripts.json`: `POST /api/alerts/scripts/reorder {ids}` ставит переданные
  скрипты (одной папки) по порядку на их же места, остальные не двигаются (`AlertsStore.reorder_scripts`); менять —
  только суперюзер. Раньше порядок жил в localStorage браузера (`st_alert_script_order`) — он переносится на
  сервер один раз при открытии суперюзером и удаляется.
- Список (`AlertsSection.renderRow`): ручка ⋮⋮, линия-указатель «перед/после», перетаскивание только внутри своей
  папки (на чужую — курсор «нельзя»), Alt+↑/↓ с клавиатуры. Копия скрипта встаёт следующей за оригиналом и на сервере.
  Тесты: `tests/test_alerts_reorder.py`.

### 2026-10-12 — «No module named 'playwright'» при записи в веб-коннекторе

- **Причина**: `start.sh` ставил зависимости Python, только если в окружении нет `fastapi`. В уже рабочем
  окружении новые пакеты из `requirements.txt` (playwright, mcp, cryptography) после обновления кода не ставились.
- **start.sh / install.sh**: отметка `.deps-installed` = `sys.prefix|sha256(requirements.txt)`; изменился файл
  или окружение → `pip install -r requirements.txt` (с подсказкой про прокси/зеркало при ошибке). В `.gitignore`.
- **Понятные ошибки**: нет playwright → `WebError(MISSING_PLAYWRIGHT)` (что выполнить; браузер не скачивается —
  используется установленный Chrome), то же в `mcp_server/dropup.py`; `cryptography` импортируется лениво
  (`webconnect/secrets.py`) — без неё бэкенд стартует, а сохранение пароля коннектора отвечает 503 с текстом.
  Тесты: `tests/test_missing_deps.py`.

### 2026-10-12 — Чат ядра: ответ из mcp-out в чате

- **Причина**: MCP-скрипты только отправляют запрос в `mcp-in` и печатают «🔎 Ответ в mcp-out по id: <uuid>» /
  «Искать ответы в mcp-out по id:» со списком «значение → <uuid>»; сами `mcp-out` не читают, поэтому чату
  нечего было показать.
- **Решение** (`frontend/lib/mcpReply.ts`, `AlertsSchedulerContext._doExecute`): после loop-ячеек SimpleTest
  находит UUID после подсказки и выполняет в том же ядре короткое чтение `mcp-out` — настройки Kafka берутся из
  `producer.config` скрипта (иначе `BROKERS`, PLAINTEXT), топик — `MCP_OUT_TOPIC` или `mcp-out`. Читаем с
  отступом 5 минут назад (ответ мог прийти раньше), ждём до 45 с; совпадение — по ключу сообщения, `id` в
  JSON-RPC или вхождению id в тело. Найденное печатается маркером `@@ST_MSG` → в чате сообщение от `mcp-out`;
  не пришедшее — строкой «⌛ нет за 45 с». Проверено на подменённом Kafka-клиенте, на реальном брокере — нет.

### 2026-10-12 — Jira tool: черновик → Jira из списка

- У черновика SimpleTest рядом с ключом — метка «черновик → Jira»; клик по ней или по ключу открывает
  `IssueFormModal` с полями черновика (`initial`): «Сохранить черновик» или «Отправить в Jira».
- После отправки черновик заменяется настоящей задачей (`replaceDraft` в `lib/jiraTool.ts`): новый ключ
  со ссылкой «↗» во всех списках, участник, значения своих полей и папка переезжают на него.

### 2026-10-11 — Jira tool: форма «Создать задачу» вместо генератора дефектов, перенос текста в своих полях

- **«Создать задачу»** (`components/jiratool/IssueFormModal.tsx`) — бывший «Генератор дефектов» + регистрация
  в Jira в одной форме. Типы: Дефект и Задача (эпик и стори здесь не заводят). Все поля видны сразу:
  слева — данные для ИИ (слой, фича, текст своими словами, вложения, **источник для ИИ — требования из
  «Данных»**), «Сгенерировать» заполняет только название и описание (у дефекта — и критичность);
  справа — название, описание, критичность, тип стенда (дефект), эпик (выгрузка из Jira), компоненты (дефект:
  до 2, второй — мобильный), лейблы, участник (st). Внизу — «Создать в SimpleTest» (черновик в списке)
  или «Создать в Jira» (через `/api/jira/create`, скриншоты дефекта — вложениями). Справочники — из Jira
  (`getJiraMeta`), если подключена, иначе из мок-проекта. Созданная в Jira задача — с ключом-ссылкой «↗».
- Вкладка «Генератор дефектов» убрана; `BugsSection.tsx` сохранён в коде (история отчётов старого генератора
  в новую форму не переносилась). Старые `CreateDefectModal`/`CreateIssueModal` удалены.
- **Бэкенд**: `POST /api/tasks/format` — генерация задачи (Цель / Что сделать / Критерии готовности / Контекст)
  с требованиями как контекстом; общий сбор вложений и требований — `_collect_context` (им же пользуется
  `/api/bugs/format`). `CreateDefectBody.issuetype`: для не-дефекта не уходят поля, обязательные только
  для дефекта SBER911 (вид испытаний, тип объекта, тип стенда); уровень доступа, ИТ-услуга и КЭ — уходят.
  Обязательные поля «Задачи» в Jira не проверены (createmeta 403). Тесты: `tests/test_task_generation.py`.
- **Свой текст в таблице**: `OwnField.wrap` — обрезать многоточием или переносить и показывать всё;
  переключается в настройке поля и кнопкой в заголовке колонки. Ячейка — просмотр + правка по клику
  (Enter — сохранить, Shift+Enter — новая строка).

### 2026-10-11 — Jira tool: папки, ширина колонок, должности, корзина добавления (моки)

- **Папки списка** (`TaskList.folderList` + `folders`): уровень над группировкой — таблица делится на папки
  (+ «Без папки»), группировка идёт внутри каждой. Создание — «Папки → + папка» в настройке списка;
  переименование, удаление (задачи → «Без папки»), порядок — на заголовке папки в таблице (перетаскиванием).
  Перенос задачи в другую папку (на строку или заголовок) меняет только папку — в новой папке задача сама
  встаёт в свою группу; внутри папки — прежние правила групп. Выбранные — «В папку…» в панели выбора.
  Импорт структуры теперь создаёт папки (а не уровень группировки); «Папка (st)» из группировки убрана;
  старые списки мигрируют (`migrateList`).
- **Ширина колонок**: тянуть край заголовка, двойной щелчок — стандартная (`TaskList.widths`, `defaultWidth`).
  Таблица в `table-layout: fixed`; ячейки вынесены в `ListCells.tsx` и не держат свои min-width.
  Ширина столбца ключа растёт с глубиной вложенности.
- **Должность участника** — аббревиатура до 3 символов (`normRole`, подсказки QA/AQA/LQA/SQA/DEV…),
  цветная метка `RoleBadge` у ФИО в таблице; в «Участниках» — правка должности и цвета.
- **Добавить задачи**: корзина выбранного живёт между поисками до «Сохранить»; по номеру — ключ, голый номер
  или ссылка (`parseKeys` вытаскивает ключ из …/browse/KEY и ?selectedIssue=KEY); найденное по номеру сразу
  в корзину, поле очищается.
- **Удаление списка** — корзина при наведении на список в перечне, с подтверждением.

### 2026-10-11 — Jira tool: перетаскивание колонок и строк (моки)

- **Колонки** — перетаскиванием заголовка (или Alt+←/→ на заголовке); порядок сохраняется в `TaskList.columns`.
- **Строки** — за ручку слева (или ↑/↓ на ручке); ручной порядок = порядок `TaskList.keys`, группы его наследуют.
  При сортировке по колонке ручной порядок выключен; в шапке «сортировка: … · сбросить».
- **Внутри группы** — меняется порядок. **Между группами** — только если все отличающиеся уровни — записываемые
  поля SimpleTest (`isWritableGroupRef`: Участник (st), Папка (st), свои поля): у задачи меняется значение
  (`applyGroupMove`; мультивыбор — убрать исходное значение, добавить новое; «— не задано» — очистить).
  Поля Jira и вычисляемые (Статус/Дефекты/Блок (st)) переносом не меняются — бросить нельзя, курсор «запрещено».
- На первом уровне группировки по участнику или своему списку показываются и **пустые группы** (все участники /
  все варианты): на заголовок группы можно бросить задачу.
- Раскладка приложения (`ResizablePanels`) на любой dragover разрешает drop (перенос разделов в правую панель),
  поэтому таблица гасит запрещённые переносы сама (`refuse` + stopPropagation).

### 2026-10-11 — Jira tool: поля (st), «Блок (st)», устранённые дефекты (моки)

- Поля, которые считает SimpleTest, подписаны «(st)» и собраны в группу «Поля SimpleTest»: «Статус (st)»
  (бывший «Этап» — рядом с настоящим «Статусом» из Jira), «Дефекты (st)», «Блок (st)», «Участник (st)»,
  «Папка (st)»; у своих полей подсказка «st · тип». Окно сопоставления — «Статус (st)».
- **Устранённый дефект** — только «Подтверждено исправление» / «Закрыт» (+ Fix confirmed, Fix verified, Verified,
  Closed; `isResolvedDefect` в `lib/jiraMock.ts`). «Выполнен» и «Отклонен» — неустранённые **намеренно**:
  отклонение подтверждает инициатор, переводя дефект в «Закрыт»; до этого дефект висит в счётчике и в «Блок (st)».
  В мок-workflow дефекта добавлен «Подтверждено исправление» (Выполнен → Подтверждено исправление → Закрыт).
- «Дефекты (st)» = число неустранённых. Окно дефектов по умолчанию показывает только их; галочка
  «Показать устранённые» — все (устранённые приглушены).
- **«Блок (st)»** (`block`): красный знак внимания, если среди неустранённых дефектов эпика/стори/задачи есть
  блокирующие (Блокирующий / Blocker); клик — окно дефектов. Группируется: «Есть блокирующие» / «Нет».

### 2026-10-11 — Jira tool: настройки в левой колонке, создать задачу, импорт структуры, поле «Дефекты» (моки)

- **Шапка списка** — только проект и действия: «Структура» (импорт), «Добавить задачи» (из Jira), «Создать задачу».
  Колонки, группировка (раскрывающиеся блоки с поиском и множественным выбором — `PickerPanel`), свои поля,
  поиск по списку, переименование и удаление — в левой колонке «Настройка списка»; в свёрнутой полоске есть
  кнопки «Колонки» и «Группировка» (разворачивают колонку на нужном блоке).
- **Создать задачу** (`CreateIssueModal`): выбор типа (Дефект / История / Задача / Epic); Дефект — прежняя форма
  с генерацией, остальные — короткая форма с Epic Link. Начальный статус — первый в workflow типа.
- **Импорт структуры** (`ImportStructureModal`, мок `STRUCTURES`): в Jira стоит плагин Structure (ALM Works,
  поле `com.almworks.jira.structure`) — дерево папок и задач. Импорт в новый или текущий список: папка → колонка
  `folder` и первый уровень группировки; «обновить из структуры» в настройках списка. Реальный API —
  `/rest/structure/2.0/structure` и `/forest/latest`.
- **Поле «Дефекты»** (`defects`): у всех задач, кроме дефектов, — сумма дефектов, привязанных через Epic Link
  или связь (`issuelinks`); красная, если есть незакрытые. Клик — `DefectsModal`: код, название, статус, приоритет,
  исполнитель, сортировка по всем колонкам (статус и приоритет — по ходу процесса).

### 2026-10-11 — Jira tool: проект списка, этапы SimpleTest, массовая смена статуса (моки)

- **Проект у списка** (`TaskList.project`): от него поля (системные + используемые в проекте пользовательские),
  примеры JQL, голый номер задачи, компоненты при создании дефекта. Мок-проекты: SBER911, PKAP, MONIT
  (`lib/jiraMock.ts`). В настоящей Jira поля общие на сервер, а `createmeta` у нас 403 — поля проекта
  будем брать по заполненным полям последних задач проекта.
- **Этап** (`lib/jiraStages.ts`, колонка `stage`): Разработка / Тестирование / Готово к релизу / Готово / Исключено.
  Стори, дефекты, прочие — по таблице «статус Jira → этап», своя на проект и группу (окно «Этапы и статусы»;
  черновик — `guessStage` по названию). Эпик — этап самой отстающей стори через Epic Link (customfield_10006);
  стори = История/Story/User Story/Enabler Story (Sub-Story нет), «Исключено» не считается, несопоставленная —
  как отстающая с предупреждением; эпик без сторей — «Нет сторей» красным, без этапа. Дефекты на этап эпика
  и сторей не влияют (решение Стефана).
- **Массовая смена статуса**: чекбоксы (строка, группа, все) → «Сменить статус». Только переходами workflow
  (`WORKFLOWS`): цели с числом задач, сводка «перейдут / нет перехода из X», обязательное «Решение» на закрытии;
  эпики пропускаются. В моке пишется в `ToolState.changed`.
- Состояние v2 (`st_jira_tool`): миграция v1 → v2 (проект SBER911 по умолчанию).
- Левая колонка (списки, участники, этапы) сворачивается в полоску 48 px: кнопка в шапке «Списки» или клавиша «[».
  Положение помнится в браузере (`st_jira_tool_aside`); в полоске — инициалы списков, аватары участников, «Этапы».

### 2026-10-11 — Jira tool (бывшие «Дефекты»), итерация 1 на моках

- Раздел «Дефекты» → **Jira tool** (маршрут `/bugs` прежний). Вкладки: «Списки» (новое) и
  «Генератор дефектов» (старый `BugsSection`, пока создание не подключено к настоящей Jira).
- **Списки** (`components/sections/JiraToolSection.tsx`, `components/jiratool/*`, модель — `lib/jiraTool.ts`):
  сколько угодно списков; задачи — по JQL или по номеру; колонки — любые поля Jira + свои поля списка
  (свободный ввод, дата, дата и время, выпадающий, множественный выбор); группировка до 3 уровней
  (задача с несколькими значениями — в группе каждого); участники общие, у задачи в списке — один;
  выбор полей и группировки — с поиском и множественным выбором; сортировка по колонке, поиск по списку.
- **Создать дефект**: тема + описание своими словами, «Сгенерировать» — настоящий `/api/bugs/format`;
  если LLM недоступна — подставляется пример (`mockGenerated`).
- **Моки**: 48 задач SBER911 (`MOCK_ISSUES`, детерминированные), справочник полей — системные поля Jira +
  несколько пользовательских из реального дефекта; JQL разбирается локально (`compileJql`: = != ~ in,
  is EMPTY, даты -7d, AND/OR/NOT, скобки). Всё хранится в localStorage `st_jira_tool`.
- Из выгрузки Jira (Server 9.12, 715 полей): у учётки нет прав на `createmeta` (403) — обязательные поля
  Дефекта при создании придётся задать вручную или получить права.
- Общая раскладка: `ResizablePanels` — `min-w-0` у колонки раздела (широкие таблицы растягивали страницу).

### 2026-10-10 — Оформление плиток «Генераторов событий»

- Суперюзер меняет у любой плитки название, подсказку, иконку и цвет (карандаш при наведении).
  Хранится на сервере: `data/hub_tiles.json` (`db/hub_tiles_store.py`, `backend/api/hub_tiles.py`),
  у всей команды одинаково; пустое поле — стандартное значение из кода.
- Иконки — вся библиотека Lucide (~1700, грузится отдельным куском только при выборе) + эмодзи;
  поиск по-русски по популярным, по-английски по всей библиотеке; палитра из 10 цветов
  (`frontend/lib/tileStyle.ts`). Библиотека Notion закрытая (нет пакета и открытой лицензии).
- У папки алертов название = имя самой папки (меняется через `saveAlertFolder`), остальное — в оформлении.
- Удаление коннектора/операции — подтверждение на странице: встроенные браузеры молча отвечают
  «Отмена» на `confirm()`.

### 2026-10-10 — Веб-коннекторы: любые операции (способ входа + запись действий + параметры)

- **Коннектор = адрес + как подключаемся**: вход вручную (SSO/2FA) или логин и пароль техучётки.
  Пароль шифруется (`webconnect/secrets.py`, Fernet, ключ `~/.simpletest/secret.key` или
  `SIMPLETEST_SECRET_KEY`), в API не возвращается (`has_password`). Форма входа (`detect_login`)
  берётся из записи по шагу ввода пароля; при истёкшей сессии `runner.auto_login` входит сам и
  повторяет операцию один раз (`relogged`). Переключение на ручной вход удаляет пароль.
- **Операция** (в коде — scenario): `kind` request | k8s_logs | steps, `params` [{name,label,default}]
  (любые значения из записи → `{name}`; незаполненный при запуске — значение из записи),
  `output` logs | data | text, `window` — есть ли окно времени. Вид **steps** (`templatize_steps`):
  повтор действий без шагов входа, без пароля и без переходов от кликов; результат — текст элемента
  (`extract_selector`) или страницы + JPEG-скриншот.
- **Запись**: ввод фиксируется по событию input и сбрасывается перед Enter/кликом/уходом со страницы
  (раньше значение терялось, если после ввода сразу жали Enter).
- **API**: черновик `{mode, response_id, params[], start_index}`, запуск `{values, minutes}`; старый
  `service`/`service_value` поддерживается. Анализатор логов подставляет сервис в `service` или в первый параметр.
- **UI**: «Как подключаемся» в форме коннектора; мастер «Новая операция» (вид → источник/шаги →
  параметры → результат); строка операции с полями параметров, результат: группы ошибок / таблица
  данных / текст и скриншот. **MCP**: `web_run(scenario_id, params, minutes)`.

### 2026-10-10 — Веб-коннекторы (запись под сессией) и анализатор логов «имя сервиса → ошибки»

- **Пакет `webconnect/`**: человек сам входит и открывает данные в окне Chrome, SimpleTest записывает
  шаги (без паролей) и ответы сайта на его XHR/fetch и выгрузки (`browser.py`). Из записи выбирается
  источник: выгрузка, собранная браузером (blob), сводится к запросу-источнику. `templates.py` превращает
  запрос в шаблон: значение сервиса → `{service}`, время → `{from_iso|ms|s|ns}`, `{to_*}`, `{since_seconds}`
  (числа остаются числами, cookie/Authorization не сохраняются). Консоль OpenShift (`…/pods/<pod>/log`)
  распознаётся отдельно: сценарий `k8s_logs` хранит проект, поды сервиса ищутся при запуске.
  `extract.py` достаёт строки из Elastic/Kibana (вкл. bsearch), Loki, k8s, JSON, текста. `runner.py` —
  повтор в фоновом браузере с той же сессией + разбор `mcp_server/log_triage.py`.
- **Скорость**: запуск Chrome с профилем 7–25 с, поэтому фоновый браузер держится 10 минут после запуска
  (повтор ~0,3 с), флаги ускорения запуска; `experimental.proxyTimeout` 120 с в `next.config.ts`.
- **API** `backend/api/webconnect.py`: коннекторы, окно `login|record`, черновик, сценарии, запуск;
  `/api/log-analyzer` — сохранённые сервисы и запуск источника. Данные — `data/web_connectors.json`,
  `data/log_services.json`, `data/webconnect_recordings/` (в .gitignore); профили — `~/.simpletest/webconnect/<id>/`.
- **Интерфейс**: плитка «Веб-коннекторы» в Генераторах событий (superuser) с мастером сценария;
  сайдбар «Логи» → `LogAnalyzerSection` (сервис, период, сохранённые сервисы, группы ошибок, «Дефект»).
  Общий вывод групп — `components/logs/ErrorGroups.tsx`.
- **MCP**: `logs_analyze`, `logs_saved_services`, `web_scenarios`, `web_run` (через API SimpleTest).
- Тесты: `test_webconnect_templates.py`, `test_webconnect_api.py`; e2e записи и повтора — на имитации
  Kibana с входом формой и выгрузкой blob и на k8s-API.

### 2026-10-10 — MCP-сервер SimpleTest: коннектор для GigaCode и web-коннектор к dropup

- **`mcp_server/`** — локальный MCP-сервер (python `mcp` 2.x, `MCPServer`), только чтение:
  - `simpletest_*` — требования, черновик баг-репорта (`/api/bugs/format`), представления
    Jira-аналитики. Вход по `SIMPLETEST_LOGIN`/`SIMPLETEST_PASSWORD`, токен обновляется сам после
    перезапуска бэкенда (`simpletest_api.py`);
  - `dropup_*` — консоль OpenShift через браузер с сессией пользователя (`dropup.py`): Playwright
    управляет установленным Chrome (постоянный профиль `~/.simpletest/mcp-web/profile`), запросы
    к прокси Kubernetes API консоли (`/api/kubernetes/...`) идут `fetch` изнутри страницы — с куками,
    сертификатами и прокси браузера. Пароль не хранится: вход в окне делает человек
    (`dropup_login`). Сессионные cookie сохраняются в `session-cookies.json` (0600), потому что
    браузер теряет их при закрытии окна входа (найдено e2e-прогоном).
  - `log_triage.py` — ядро анализатора: события из строк (k8s-время, JSON-логи, Java/Python-стеки,
    исключение следующей строкой после ERROR), отпечаток (нормализация чисел/UUID/IP/hex/e-mail/времени
    + исключение + 3 кадра), категории, важность, Markdown-отчёт. Будет переиспользовано разделом SimpleTest.
- Запуск: `scripts/simpletest-mcp.sh` (stdio для GigaCode) или `--http` (127.0.0.1:8765/mcp, один
  процесс на профиль браузера — для нескольких клиентов). Подключение — `GIGACODE.md`.
- Зависимости: `mcp>=2.3,<3`, `playwright>=1.45` в `requirements.txt`. Тесты: `tests/test_log_triage.py`,
  `tests/test_mcp_server.py` (инструменты через MCP-клиент, консоль и API подменены).

### 2026-10-10 — Реструктуризация разделов, алерты в «Генераторах событий», чат ответа ядра, GigaCode

- **Сайдбар:** «Ручное тестирование» → «Тестовая модель». Скрыты (код сохранён): Автотестирование,
  Логи, Ревизор — их маршруты делают redirect. В «Данных» осталась только вкладка «Требования».
- **Генераторы событий** (`EventGeneratorsSection.tsx`) — хаб плиток, открыт всем ролям:
  Метрики ОД и ТКС (superuser), Jobs, плитка на каждую папку алертов + «Без папки» + «Новая папка».
  Открытая плитка — в адресе `?open=metrics|tks|jobs|alerts:<folderId>|alerts:none`;
  `/alerts` и `/jobs` ведут сюда, индикатор активных алертов открывает папку алерта.
- **AlertsSection** получил режим одной папки (`folderId`): плоский список, «Запустить все»,
  переименование/удаление папки, новый алерт создаётся в этой папке. Строка списка — общий `renderRow`.
- **Ответ ядра — чат:** контакт = топик Kafka, сообщение = тело + «Кому» (получатели), технические
  детали за кнопкой «i», служебный вывод свёрнут, сырой вывод — вкладка «Лог». Разбор:
  `frontend/lib/kernelMessages.ts` (маркер `@@ST_MSG {json}` + узнавание строк текущих скриптов).
- **Скрипты алертов:** 36 скриптов (21 новый, 1 обновлён) + папка «AC AKC» (`fld-dcedb1d1`).
- **GigaCode:** `GIGACODE.md` (карта MCP и проекта) и скилл `.gigacode/skills/log-triage/`.

### 2026-10-08 — Jira-аналитика, шаг 1: слой данных для представлений (только бэкенд)

- **Представление** = JQL-выборка + группировка (до 3 уровней, любое поле Jira, в т.ч. кастомное:
  «Тестировщик», исполнитель) + колонки. Общие на команду, хранятся в `data/jira_views.json`
  (`db/jira_views_store.py`, файл в `.gitignore`).
- **API** (`backend/api/jira_views.py`, токен и подключение — из `jira_defects.py`):
  `GET /api/jira/fields`, `GET|POST /api/jira/views`, `DELETE /api/jira/views/{id}`,
  `POST /api/jira/views/query` (группы отсортированы по убыванию, «(не задано)» в конце).
- **Защита корп. Jira:** потолок выборки 1000 задач, кэш результата 3 мин (`refresh` — мимо кэша),
  список полей кэшируется на 10 мин.
- Клиент: `frontend/lib/jiraApi.ts` (`getJiraFields`, `listJiraViews`, `saveJiraView`,
  `deleteJiraView`, `runJiraView`). Экрана пока нет — шаг 2. Тесты: `tests/test_jira_views.py`.

### 2026-09-17 — Дефекты STBUG-1…5: короткий промпт, эпики и фича между дефектами, копия алерта, заголовки вкладок

- **Промпт дефекта короче** (`backend/api/bugs.py::_format_bug_sync`): убраны разделы
  «Окружение» и «Гипотезы», добавлен отдельный «Ожидаемый результат», из логов — только
  ключевая строка. Строка «Приоритет: X» по-прежнему последняя. Тест: `tests/test_bug_prompt.py`.
- **Эпики Jira не выгружаются заново** (`JiraRegisterPanel.tsx`): список хранится в
  localStorage `st_jira_epics` (по проекту, с временем выгрузки); кнопка «Выгрузить» стала
  «Обновить». Причина была в том, что панель размонтируется на каждой генерации.
- **Серия дефектов по одной фиче** (`BugsSection.tsx`): «Новый дефект» сохраняет компонент,
  фичу, требования и выбранный эпик (эпик поднят в родителя); новая кнопка «С нуля» очищает всё.
- **Копирование алерта** (`AlertsSection.tsx`): кнопка «Копировать» у скрипта — копия
  «<имя> (копия)» в той же папке, сразу после оригинала.
- **Заголовок вкладки браузера = раздел**: `metadata.title` в каждом `app/(app)/*/page.tsx`
  и `app/login/layout.tsx`, шаблон `%s — SimpleTest` в `app/layout.tsx`.

### 2026-07-25 — Требования (Данные), Тестирование моделей LLM (сценарии/DOCX), Jira-трейсы, центровка вкладок

- **Эталоны → «Данные», новая библиотека Требований.** Route/id остались `etalons`/`/etalons`
  (минимальный риск), в UI и заголовках — «Данные». Вкладки Тест-кейсы/Автотесты/Дефекты
  (пары requirement→результат в ChromaDB) **скрыты с фронта** (не удалены — данные и дальше
  пишутся кнопками «В эталон» в других разделах). Новая вкладка **Требования** — простой
  локальный JSON-стор (`db/requirements_store.py`, `data/requirements.json`, БЕЗ ChromaDB/
  эмбеддингов/huggingface.co — осознанный уход от прежней боли с недоступностью
  huggingface в закрытой сети): исходник + `qa_doc` в одной записи. Кнопка «Сгенерировать»
  вызывает тот же `LayeredGenerator.generate_qa_doc()`, что и Layer 1 обычной генерации кейсов.
- **Требования — сквозной клиентский путь:**
  1. Данные → Требования → вставил исходник → сгенерировал документ → требование доступно
     как переключаемый источник («Из списка требований») в Ручном тестировании и как
     мультивыбор-контекст («Приложить требования») в Дефектах (`bugs.py::format_bug`
     принимает `requirement_ids[]`, текст уходит в промпт форматирования — ИИ точнее
     описывает дефект, зная реальные поля БД/методы API).
  2. Ручное тестирование → закинул требование в генерацию → сразу после появления QA-
     документации (ещё во время генерации, layers 2-4 продолжают работу в фоне) — кнопка
     «В эталон» сохраняет пару исходник+документация в Требования одним локальным вызовом,
     без повторного обращения к LLM и без прерывания генерации.
- **Тестирование моделей LLM — сценарии с критериями судьи + встроенный сценарий
  «Транскрибация».** `db/model_bench_scenarios_store.py`: поле `judge_instructions`
  (доп. критерии оценки, едут вместе с сессией от создания до анализа отчёта — см.
  `agents/model_bench.py::analyze_report`). При первом запуске (файла ещё нет) авто-сеется
  встроенный сценарий «Транскрибация» — реальный продакшен-промпт саммаризации инцидентов +
  9-пунктовые критерии (техническая точность: галлюцинации/сохранность деталей/хронология/
  полнота; логика: связность/дублирование/релевантность/лаконичность/стиль) — работает на
  любом деплое, не только локально. Модал «Настройки сценариев» (список + форма добавления)
  заменил инлайновое «Сохранить как сценарий».
- **Детальный отчёт + таймаут.** `agents/model_bench.py::compute_stats` считает
  мин/медиана/макс задержки и % успешности (не только среднее) — доступно сразу после
  прогонов через `GET /sessions/{id}/stats`, без ожидания судьи. `LLMClient` получил
  необязательный `timeout` (не ломает существующие вызовы — везде `provider=` как keyword);
  в model-bench поднят до 180с — однопоточные/занятые локальные модели чаще успевают ответить.
- **Экспорт отчёта: PPTX → DOCX.** Первая версия (PPTX, `python-pptx`) резала контент на
  слайды принудительно — таблицы/абзацы рвались без причины (плохая вёрстка). Заменено на
  DOCX (`agents/model_bench_export.py`, `python-docx`): обычный структурированный документ —
  Heading 1-4, настоящие таблицы (техметрики + таблица сравнения из отчёта), списки, жирный
  текст. `requirements.txt`: `python-pptx` → `python-docx` (был неучтён, хотя уже
  использовался для парсинга загружаемых файлов в `file_parser.py`). Кнопка «Скачать .docx»
  показывается только после того, как отчёт реально отобразился (`session.report`), а не
  просто при наличии прогонов.
- **Фикс бага «отчёт получен, но не виден».** Причина — `NotionRenderer.tsx` не распознавал
  заголовки `####` (только `#`/`##`/`###`), строка вида `#### Итоговая рекомендация` падала в
  обычный абзац с решётками как текстом. Добавлена поддержка H4-H6. Заодно: если судья вернул
  пустой отчёт без исключения (деградация модели, не ошибка API) — теперь явная ошибка в UI
  вместо молчания.
- **Jira — подробные трейсы в терминал.** Логгер в `jira_defects.py` был объявлен, но не
  использовался; в приложении не было `logging.basicConfig` — INFO-логи никуда не попадали.
  Добавлен root-логгер в `main.py`. Каждый запрос к Jira: тело/статус в лог; при ошибке —
  полный raw body + заголовки, извлечение `X-AREQUESTID` (по нему администратор Jira находит
  запись в серверном логе; ID теперь и в тексте ошибки пользователю). После создания дефекта
  — проверка `GET .../transitions`: если пусто, явное предупреждение о возможном ограничении
  прав/Security Level вместо молчаливого «дефект создан, но кнопок перехода нет».
- **UI — стартовые интерфейсы вкладок по центру.** Автотестирование/Дефекты/Данные/Настройки/
  Тестирование моделей LLM растягивались на всю ширину рабочей зоны — приведены к единому
  паттерну `max-w-5xl mx-auto` (эталон — `TestDataSection.tsx`). Ручное тестирование было
  `w-1/2` без центрирования (прижато к левому краю) — добавлен `max-w-3xl mx-auto`. Jobs/
  Kafka/Ревизор/Генератор метрик/алертов намеренно не тронуты — табличные/дашбордные
  интерфейсы, где ширина работает на контент. `max-w-*` вместо фиксированной ширины —
  корректно сжимается при drag-n-drop второй рабочей зоны (сплит-панели).

### 2026-07-07 — Горячая замена JDBC-драйверов, фиксы SSL/jaydebeapi, DeepSeek→custom, брендированные Select, персист Kafka/Тестовых данных

- **JDBC-драйверы грузятся «на лету» — перезапуск бэкенда больше НЕ нужен**
  (`backend/api/db_connector.py`). JVM стартует без фиксированного classpath; на каждое
  подключение драйвер загружается своим `java.net.URLClassLoader`, из него берётся
  `java.sql.Driver` и вызывается `.connect(url, props)` напрямую (минуя `DriverManager`,
  который не видит классы внешнего загрузчика). Заменил `.jar` → следующее подключение
  подхватит новую версию. ⚠️ Отменяет старую заметку «нужен перезапуск JVM» из записи 2026-07-02.
- **Библиотеку драйвера можно указать путём на диске** (без копирования в проект):
  поле «Путь к .jar на этом компьютере» во вкладке «Библиотека» (рекомендуемый способ),
  загрузка файла осталась как альтернатива. Store: поле `jar_path` с приоритетом над
  `jar_filename`; при снятии внешний .jar по пути не удаляется. Эндпоинт
  `POST /api/testdata/drivers/{id}/library-path`. Путь машинно-зависимый — после переноса переуказать.
- **Фикс jaydebeapi при подключении в обход `jaydebeapi.connect()`** (тест БД / интроспекция
  схемы / Jobs падали): собственная инициализация в `_ensure_jaydebeapi_ready()` —
  attach потока к JVM (все обращения к БД идут в `asyncio.to_thread`), `_init_types`/`_converters`
  (иначе `Cursor.fetchone()` → `'NoneType' has no attribute 'get'`), `_java_array_byte`;
  `ensure_jvm()` стартует JVM с `convertStrings=True` (иначе `getString()` возвращает
  `java.lang.String` вместо python `str` → падала JSON-сериализация схемы, 500 в Jobs).
- **GigaChat `[Errno 54] Connection reset by peer` за корп-прокси** — старые BIG IP не умеют
  TLS 1.3. `SSL_MAX_TLS12=1` раньше до GigaChat SDK не доходил; теперь при этом флаге собирается
  `SSLContext` с потолком TLS 1.2 (+ `CERT_NONE` при `SSL_NO_VERIFY`, + `OP_LEGACY_SERVER_CONNECT`)
  и передаётся SDK как `ssl_context` (доходит и до auth-, и до chat-клиента). `agents/llm_client.py`.
  GigaChat по сертификату = чистый mTLS (SDK не запрашивает OAuth-токен без credentials),
  дефолтный Base URL cert-режима — ИФТ-стенд `https://gigachat-ift.sberdevices.delta.sbrf.ru/api/v1`.
- **DeepSeek полностью убран из встроенных провайдеров** — единственный встроенный теперь GigaChat
  (`BUILTIN_PROVIDERS = ["gigachat"]`). DeepSeek подключается как обычный OpenAI-совместимый
  custom-провайдер через «Добавить провайдер» (`custom_deepseek`, путь `_init_custom`/`_chat_custom`),
  в одном ряду с OpenAI/Gemini/Ollama/Groq и т.д. Вычищен мёртвый код DeepSeek в `llm_client.py`
  и настройки `deepseek_*` в `app_settings.py`. Claude/Anthropic в generic-путь не встанет
  (другой формат API) — отдельная доработка при необходимости.
- **`onnxruntime` 1.24.1 → 1.23.2** в `requirements.txt`.
- **Просмотр Kafka — доработки UI:** 4 панели фиксированной равной высоты со скроллом внутри;
  строка сообщения = Offset / Дата / Отправитель / Получатель / Value с независимой сортировкой
  по Offset и Дате в каждом топике; тумблеры видимости колонок Отправитель/Получатель/Value
  (персист в localStorage `st_kafka_cols`); отправитель/получатель берутся из заголовков сообщения.
  Список топиков сортируется **A→Z**.
- **Kafka — выбор не сбрасывается:** подключение + оба топика + лимит в `sessionStorage`
  (`st_kafka_session`) — переживают переход между разделами и перезагрузку, сбрасываются
  только при закрытии вкладки/браузера. Восстановленный `connId` валидируется по списку.
- **Тестовые данные — фоновый запрос + архив:** выполнение вынесено в `TestDataJobContext`
  (в `WorkspaceShell`, над роутами) — уход на другой раздел не прерывает процесс, вернувшись
  видно прогресс с кнопкой «Отменить» (AbortController), по завершении — результат.
  Архив запросов в localStorage (`st_testdata_archive`, капы 30 записей / 500 строк на БД):
  время + список БД + запрос + снимок результата; клик по записи открывает модалку с той самой
  «страницей» результата (`ResultsView`) + «Подставить в форму». `execute/generateTestDataQuery`
  принимают `AbortSignal`.
- **Все выпадающие списки — брендированные:** новый `components/ui/Select.tsx` (своя панель в
  цветах/шрифте продукта, галочка выбранного, клавиатура, click-outside) заменил все 35 нативных
  `<select>` (Kafka, Настройки, Метрики, Алерты, Jobs, Эталоны, Автотесты). Старый нативный
  ui-`Select` из `Input.tsx` удалён.

### 2026-07-02 — Готовность к миграции: deploy.sh переписан, JDBC-драйверы, Zephyr XML, Kafka SSL
- **`deploy.sh` полностью переписан** под текущую архитектуру (был мёртвый Streamlit-скрипт):
  2 systemd-сервиса (`simpletest-api` uvicorn :8000, `simpletest-next` — Next standalone :3000),
  nginx `/` → next, `/api|/healthz|/docs` → FastAPI, `/api/ws/` — WebSocket-upgrade;
  ставит Node.js 20 (NodeSource) и **Java 17 headless** (нужна для JDBC Тестовых данных).
- **Создан `MIGRATION.md`** — чеклист переноса на новую машину/сервер (что ставить, что переносить руками).
- **`psycopg2-binary` возвращён в requirements.txt** — нужен ядру приложения при
  `DATABASE_URL=postgresql://...` (был ошибочно удалён при JDBC-унификации Тестовых данных).
- **Тестовые данные/Jobs**: все подключения к БД через единый реестр JDBC-драйверов
  («Настройка драйверов» в стиле DBeaver: вкладки Настройки/Библиотека, загрузка своих .jar).
  Встроенные PostgreSQL/MySQL/Oracle предзаполнены — требуется только .jar.
  Нативные Python-драйверы БД из testdata убраны. Общий модуль `backend/api/db_connector.py`.
  ⚠️ JPype: .jar, загруженный после старта JVM, требует перезапуска бэкенда.
- **Экспорт Zephyr XML** переписан под корп. спецификацию TM4J: корень `<project>`
  (projectId/projectKey/modelVersion/jiraVersion/exportDate/folders), в `<testCase>` —
  attachments/createdBy/createdOn/customFields (Команда, Вид тестирования, АС, Автоматизирован,
  Крит. регресс, Домен)/objective (цель + время прохождения)/owner (табельный)/precondition/
  parameters/testScript/updatedBy/updatedOn; sequential id/key с 14710101; в форме экспорта —
  Project ID, Jira Version, Автор ФИО + табельный (персистится в localStorage `st_author`),
  дефолты: SBER911/11000/9.12.27/Застылов С.А./16538296.
- **Генерация**: LLM даёт оценку времени прохождения на кейс (`estimated_minutes`);
  саммари «Создано N кейсов. Общее время прохождения: M мин» + бейдж времени на карточке.
- **LLM-провайдеры**: GigaChat в UI переключается API-ключ ⇄ клиентский сертификат
  (CA/cert/key пути), DeepSeek — по API-ключу. Активный провайдер = клик по статусу в сайдбаре
  (не персистится — после перезагрузки страницы возвращается GigaChat).
- **Просмотр Kafka**: форма подключения с тумблерами «CLEARTEXT ⇄ SSL» и
  «Валидировать сертификат: нет ⇄ да» + опциональные пути (ключ/серт/CA);
  `ssl_verify=false` строит SSL-контекст без валидации (самоподписанные серты стендов).
- Все реестры подключений (Kafka/Ревизор/Тестовые данные/Логи VPS) — единый UI-паттерн
  `ConnectionsModal`/`ConnectionRow` (`frontend/components/ui/ConnectionsModal.tsx`).
- В `.gitignore` добавлен `data/kafka_explorer_connections.json` (может содержать SASL-пароли).

### 2026-06-29 — Удалён модуль «Ферма устройств» (Device Farm) + консолидация документации
- **Удалена вся фича Device Farm** (по решению владельца — мёртвый/тяжёлый модуль):
  - backend: каталог `backend/farm/`, `backend/api/device_farm.py`, `backend/api/device_farm_ws.py`;
    из `backend/main.py` убраны импорт, регистрация роутеров, lifespan `farm_manager.start/stop`,
    обход авторизации `/api/farm/agents/`; из `backend/api/app_settings.py` убраны настройки
    `farm_*`, `get_farm_config()`, эндпоинт `POST /api/settings/test/farm`.
  - frontend: пункт сайдбара «Ферма устройств», страница `app/(app)/device-farm/`,
    `components/sections/DeviceFarmSection.tsx`, `lib/deviceFarmApi.ts`, тип `device_farm`
    в `WorkspaceContext`.
  - удалён встроенный каталог `mobilefarm/` (~84 МБ: Appium, scrcpy-агент, Java-клиент, infra).
  - ORM-модели `FarmDevice`/`FarmSession` в `db/metrics_models.py` стали неиспользуемыми (см. ниже).
- **Документация приведена к консистентности** (`README.md`, `CLAUDE.md`, `AGENTS.md`, этот файл):
  - исправлено описание авторизации — реально это Bearer-токен с **2 захардкоженными пользователями**
    в `backend/api/auth.py` (`Sber911`/`SberMonitoring`, пароль `1234567`), а не «авторизации нет»
    и не «admin из .env».
  - `CLAUDE.md`: ссылка на несуществующий `agents/generator.py` → `agents/layered_generator.py`;
    убрана ссылка на несуществующий `db/user_store.py`.
- **Репозиторий — self-contained для GitHub:** из `.gitignore` убран футган `*.css`
  (мог молча выкидывать стили фронтенда). Аккаунты (в `auth.py`) и `.env` остаются в репо
  намеренно — чтобы проект запускался с любой машины сразу после клона.

*Историческая база: монолит SimpleTest с интерфейсом запуска автотестов (дерево кейсов,
LLM-названия, сценарии), кастомизацией сайдбара и системой тем.*
Это карта, а не замена кода: при расхождениях сверяйся с реальными файлами.*
