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
| **Ручное тестирование (Генерация)** | LLM генерирует тест-кейсы из требований, 4-слойный пайплайн, экспорт в Jira Zephyr Scale |
| **Автотестирование** | Генерация Java-автотестов, запуск прогонов |
| **Тестовые данные** | Подключения к внешним БД через JDBC-драйверы (PostgreSQL/MySQL/Oracle встроены + свои .jar, как в DBeaver), LLM-генерация SQL, поиск данных |
| **Jobs** | Произвольные задачи/скрипты с папками и историей запусков |
| **Дефекты (Bugs)** | LLM-форматирование баг-репортов |
| **Логи** | Подключения к VPS (Graylog/Elastic/Loki), поиск и LLM-анализ логов |
| **Генератор алертов** | Jupyter-ядра, запуск скриптов-алертов, планировщик, глобальный индикатор активных алертов в сайдбаре |
| **Просмотр Kafka** | Именованные подключения (CLEARTEXT/SSL с сертификатом), снапшот последних N сообщений топика, поиск |
| **Генератор метрик** | Эмуляция метрик в Kafka по спецификации (8 таблиц БД) |
| **Ревизор** | Сравнение сборок/версий/статусов на стендах |
| **Эталоны** | RAG — эталонные пары требование→тест-кейс в ChromaDB |

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
| `etalons.py` | 372 | CRUD эталонов (RAG), сохранение в ChromaDB | `/api/etalons/*` |
| `bugs.py` | 122 | LLM-форматирование баг-репортов | `/api/bugs/*` |
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
- **JSON-сторы** (файловые, без БД): `alerts_store.py`, `jobs_store.py`, `gen_sessions_store.py`, `testdata_connections.py`, `jdbc_drivers_store.py` (реестр JDBC-драйверов + .jar в `data/jdbc_drivers/`), `kafka_explorer_store.py` (подключения Просмотра Kafka), `team_store.py`, `feedback_store.py`, `autotest_runs_store.py`, `secure_config.py`, `audit_log.py`.

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
| `etalons` | `/etalons` | Эталоны | **superuserOnly** |

### 5.2. Оболочка и навигация

- **`components/WorkspaceShell.tsx`** — провайдеры (`WorkspaceProvider`, `GenerationProvider`, `AlertsSchedulerProvider`, `MetricsUiProvider`) + `Sidebar` + `ResizablePanels(left=children, right=SectionRenderer)`.
- **`components/Sidebar.tsx`** — навигация + статусы LLM (`LLMStatusBar`) + текущий пользователь + тема.
- **`components/SectionRenderer.tsx`** — рендер правой «рабочей зоны» (зависит от `WorkspaceContext`).
- **`components/ResizablePanels.tsx`** — две перетаскиваемые панели.

### 5.3. `components/sections/` — основные экраны (1 файл = 1 модуль)

`GenerationSection.tsx` (самый большой, ~1000 строк), `AutoModelSection.tsx`,
`TestDataSection.tsx`, `JobsSection.tsx`, `BugsSection.tsx`, `LogsSection.tsx`,
`AlertsSection.tsx`, `MetricsSection.tsx`,
`RevisorSection.tsx`, `EtalonsSection.tsx`, `SettingsSection.tsx` (~2000 строк — все настройки).

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
| Эталоны / RAG | `backend/api/etalons.py`, `db/vector_store.py` |
| Метрики в Kafka | `backend/api/metrics_*.py`, `agents/metrics_*.py` |
| Логи на VPS | `backend/api/logs.py`, `backend/api/log_clients/` |
| Тестовые данные / внешние БД | `backend/api/testdata.py`, `db/testdata_connections.py` |

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
