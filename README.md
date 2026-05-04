# SimpleTest

**AI-платформа для генерации тест-кейсов, автотестов и мониторинга**

Полностью переработанный Full-Stack проект на базе FastAPI + Next.js с поддержкой нескольких LLM-провайдеров, real-time стриминга, K8s-интеграции и Kafka-алертов.

---

## Основные возможности

### Генерация тест-кейсов (`/generation`)
- **3-слойная генерация через WebSocket:** QA-документация → список кейсов → детальные шаги
- **Глубина:** Smoke (1–5) → Regression (5–10) → Full (11–30) → Atomic (31–100)
- **Автоопределение типа требований:** API, UI, бизнес-логика, интеграции, безопасность
- **Загрузка файлов:** PDF, DOCX, XLSX, изображения
- **Экспорт:** XML (Jira Zephyr Scale), CSV, Markdown

### Автотестирование (`/auto-model`)
- Генерация Selenium/Cypress тест-скриптов на основе тест-кейсов
- Поддержка Python/Java (Selenium) и JavaScript (Cypress)

### Дефекты (`/bugs`)
- Форматирование описаний дефектов через LLM в структурированные баг-репорты
- Автоопределение типа тестирования и генерация рекомендаций

### Эталоны (`/etalons`)
- CRUD-управление эталонными тест-кейсами
- Хранение в ChromaDB (векторные эмбеддинги) для RAG при генерации

### Генератор алертов (`/alerts`)
- Конструктор шаблонов Kafka-алертов с переменными `{{param}}`
- Два типа скриптов: `simple` (JSON-шаблон) и `a2a` (JWT + JSON-RPC 2.0)
- История последних отправок

### Генератор метрик (`/metrics`)
- CRUD-управление системами и метриками мониторинга K8s-микросервисов
- Настройка источников данных, базовых значений, порогов и статусов здоровья
- Фоновый планировщик (APScheduler) для периодического сбора метрик

### Ревизор (`/revisor`)
- Сравнение микросервисов по настраиваемым стендам
- Конструктор API-методов для сборок, версий, статусов, подов и health

### Настройки (`/settings`)
- Управление подключениями LLM-провайдеров: API key или клиентский сертификат
- Конфигурация Kafka, параметры моделей

---

## Архитектура

```
SimpleTest/
├── backend/                  # FastAPI-приложение
│   ├── main.py               # Инициализация, роутинг, middleware
│   ├── schemas.py            # Pydantic-модели
│   └── api/
│       ├── generation.py     # WebSocket-генерация тест-кейсов
│       ├── etalons.py        # CRUD эталонов
│       ├── bugs.py           # Форматирование дефектов
│       ├── alerts.py         # Kafka-алерты
│       ├── metrics_*.py      # Метрики и системы мониторинга
│       ├── revisor.py        # API-конструктор сравнения стендов
│       ├── autotests_gen.py  # Selenium/Cypress генерация
│       ├── app_settings.py   # Настройки приложения
│       └── system.py         # /healthz, /providers, /stats
│
├── agents/                   # LLM-оркестрация
│   ├── llm_client.py         # Универсальный клиент (6 провайдеров)
│   ├── layered_generator.py  # 3-слойный генератор
│   ├── prompt_templates.py   # Шаблоны промптов по типам
│   ├── a2a_builder.py        # A2A-протокол для алертов
│   ├── kafka_client.py       # Kafka producer
│   ├── metrics_scheduler.py  # Планировщик метрик
│   ├── file_parser.py        # Парсинг PDF/DOCX/XLSX/изображений
│   └── prompt_guard.py       # Защита от prompt injection
│
├── db/                       # Хранилища данных
│   ├── postgres.py           # SQLAlchemy + PostgreSQL
│   ├── metrics_models.py     # ORM-схема
│   ├── alerts_store.py       # Скрипты алертов
│   ├── feedback_store.py     # Оценки генераций
│   ├── vector_store.py       # ChromaDB эмбеддинги
│   └── secure_config.py      # Валидация .env
│
├── frontend/                 # Next.js-приложение
│   ├── app/
│   │   └── (app)/            # generation, etalons, bugs,
│   │                         # alerts, metrics, auto-model,
│   │                         # revisor, settings
│   ├── components/
│   │   ├── sections/         # Секции страниц
│   │   ├── Sidebar.tsx       # Навигация + выбор модели
│   │   ├── LLMStatusBar.tsx  # Статус провайдеров
│   │   ├── StatusPanel.tsx   # Real-time прогресс генерации
│   │   ├── CaseCard.tsx      # Карточка тест-кейса
│   │   └── ExportPanel.tsx   # Экспорт XML/CSV/MD
│   └── lib/                  # API-клиент, утилиты
│
├── docker-compose.yml        # PostgreSQL для локальной разработки
├── deploy.sh                 # Деплой на VPS (Ubuntu/Debian/AlmaLinux)
└── .env.example              # Шаблон конфигурации
```

---

## LLM-провайдеры

| Провайдер | Тип | Настройка | Статус без подключения |
|-----------|-----|-----------|------------------------|
| GigaChat | Встроенный | `GIGACHAT_AUTH_TYPE`, ключ или сертификат | Красный |
| DeepSeek | Встроенный | `DEEPSEEK_AUTH_TYPE`, ключ или сертификат | Красный |
| Пользовательский LLM | Настраиваемый | через UI Settings | зависит от API key/сертификата |

**Особенности:**
- Кнопки выбора модели отображаются **только для провайдеров со статусом green** (доступны к генерации)
- Статус-бар внизу сайдбара показывает **всех** провайдеров с индикаторами
- Провайдеры без настроенного ключа/сертификата сразу получают `red` без HTTP-запроса к API
- GigaChat и DeepSeek редактируются в настройках: Base URL, модель, тип подключения, CA bundle, client cert/key.
- Дополнительные LLM добавляются в настройках как chat/completions-compatible endpoint через API key или сертификат.

---

## Технологии

| Слой | Технология |
|------|-----------|
| Frontend | Next.js 16, React 19, TypeScript 5, TailwindCSS 3 |
| Backend | FastAPI 0.128, Uvicorn 0.40, Python 3.12 |
| База данных | PostgreSQL 16, SQLAlchemy 2.0 |
| Vector DB | ChromaDB 1.4 (RAG для эталонов) |
| Доступ | Без пользовательской авторизации; доступ ограничивается корпоративной сетью/VM |
| Real-time | WebSockets (стриминг генерации) |
| Мониторинг | APScheduler, Kubernetes Python client |
| Сообщения | kafka-python, A2A/JSON-RPC 2.0 |
| Парсинг | PyPDF2, python-docx, openpyxl, Pillow |

---

## Установка и запуск (локально)

### Требования
- Python 3.12+
- Node.js 20+
- Docker — **не обязателен** (можно использовать SQLite)

### Вариант 1 — без Docker (SQLite)

Самый простой способ: база данных создаётся автоматически как файл `simpletest.db`.

```bash
git clone https://github.com/TuxooTurr/simplec.git
cd SimpleTest

python3.12 -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows

pip install -r requirements.txt

cp .env.example .env
# Отредактировать .env:
#   GIGACHAT_AUTH_KEY=<ключ>     # или настройте сертификат в UI
#   DEEPSEEK_API_KEY=<ключ>      # или настройте сертификат в UI
#   DATABASE_URL=sqlite:///./simpletest.db   # уже стоит по умолчанию

python3.12 -m uvicorn backend.main:app --reload --port 8000
```

### Вариант 2 — с Docker (PostgreSQL)

```bash
git clone https://github.com/TuxooTurr/simplec.git
cd SimpleTest

python3.12 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# Раскомментировать PostgreSQL-строку в .env:
#   DATABASE_URL=postgresql://simpletest:simpletest@localhost:5432/metrics

docker compose up -d             # Поднять PostgreSQL

python3.12 -m uvicorn backend.main:app --reload --port 8000
```

### Фронтенд (оба варианта)

```bash
cd frontend
npm install
npm run dev
```

Откроется на `http://localhost:3000`, API на `http://localhost:8000`.

---

## Конфигурация (`.env`)

```dotenv
# Пользовательской авторизации нет.
# Все подключившиеся к VM работают с общими данными приложения.

# LLM-провайдеры
LLM_PROVIDER=gigachat
GIGACHAT_AUTH_TYPE=api_key
GIGACHAT_AUTH_KEY=       # Base64(client_id:client_secret)
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_BASE_URL=https://gigachat.devices.sberbank.ru/api/v1
GIGACHAT_AUTH_URL=https://ngw.devices.sberbank.ru:9443/api/v2/oauth
GIGACHAT_MODEL=GigaChat
DEEPSEEK_AUTH_TYPE=api_key
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
# Для режима certificate укажите *_CA_CERT_PATH, *_CLIENT_CERT_PATH, *_CLIENT_KEY_PATH.
# Дополнительные LLM настраиваются в UI: Settings → Дополнительные LLM

# База данных
DATABASE_URL=postgresql://simpletest:simpletest@localhost:5432/metrics

# Kafka (алерты)
KAFKA_BOOTSTRAP_SERVERS=
KAFKA_SECURITY_PROTOCOL=PLAINTEXT

# Ревизор (стенды)
# Основная настройка: UI Settings → Ревизор — API стенды.
# Старые env-переменные оставлены как fallback для статуса стендов.
REVISOR_NT_URL=
REVISOR_NT_TOKEN=
REVISOR_MAJORCHECK_URL=
REVISOR_MAJORCHECK_TOKEN=
REVISOR_MAJORGO_URL=
REVISOR_MAJORGO_TOKEN=
```

---

## Деплой на VPS

```bash
# На сервере (Ubuntu/Debian/AlmaLinux)
curl -O https://raw.githubusercontent.com/TuxooTurr/simplec/main/deploy.sh
sudo bash deploy.sh
```

Скрипт автоматически:
1. Устанавливает nginx, python3.12, certbot
2. Клонирует репозиторий в `/opt/simpletest`
3. Создаёт venv и устанавливает зависимости
4. Настраивает `.env`
5. Регистрирует systemd-сервисы (`simpletest-api`, `simpletest-next`)
6. Настраивает nginx как reverse proxy с WebSocket
7. Выпускает SSL-сертификат (Let's Encrypt)

**Управление сервисами на проде:**

```bash
systemctl status simpletest-api   # статус бэкенда
systemctl status simpletest-next  # статус фронтенда
journalctl -u simpletest-api -f   # логи бэкенда
cd /opt/simpletest && git pull    # обновление кода
npm run build --prefix frontend   # пересборка фронтенда
```

---

## API

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `WS` | `/api/ws/generation` | Стриминг генерации тест-кейсов |
| `POST` | `/api/generation/parse-file` | Парсинг файла в текст |
| `POST` | `/api/autotests/generate` | Генерация Selenium/Cypress |
| `POST` | `/api/bugs/format-bug` | Форматирование дефекта |
| `GET/POST/DELETE` | `/api/etalons/*` | CRUD эталонов |
| `GET/POST/DELETE` | `/api/alerts/scripts` | CRUD скриптов алертов |
| `POST` | `/api/alerts/send` | Отправка алерта |
| `GET/POST/PUT/DELETE` | `/api/metrics/*` | CRUD систем и метрик |
| `GET` | `/api/revisor/data` | Сравнение API-стендов Ревизора |
| `GET` | `/api/revisor/stands` | Статус подключений Ревизора |
| `GET/POST/DELETE` | `/api/settings/revisor-stands` | Конструктор API-стендов Ревизора |
| `GET/PUT` | `/api/settings` | Настройки приложения |
| `GET` | `/api/system/providers` | Статус LLM-провайдеров |
| `GET` | `/healthz` | Health check |

---

## История изменений

### 2026-03-30
- **fix:** Статус LLM показывает все провайдеры; без ключа — красный «Нет ключа» (без HTTP-запроса)
- **feat:** Кнопки выбора модели отображаются только для провайдеров с зелёным статусом; автопереключение на первый доступный

### 2026-03-11
- **fix:** Убрана вкладка Kafka из шапки генератора метрик
- **fix:** Тоггл «Критичный регресс» — исправлен двойной клик (label→div)

### 2026-02-18
- **refactor:** Полная переработка с Streamlit на FastAPI + Next.js
- **feat:** WebSocket стриминг генерации, JWT-аутентификация
- **feat:** Добавлены разделы: Ревизор, Генератор метрик, Генератор алертов, Автотестирование

### 2026-02-14 и ранее
- Первоначальная версия на Streamlit (v1.0–v2.0)
- 3-слойный генератор, ChromaDB, экспорт в Zephyr XML

---

## Лицензия

Проприетарный проект.

## Авторы

**Stefan Zastylov** — разработка и поддержка

---

**Версия:** 3.1 · **Продакшен:** https://simpletest.pro
