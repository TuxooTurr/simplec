# MIGRATION.md — перенос SimpleTest на другую машину / сервер

> Проверено: 2026-07-02. Репозиторий приватный — `.env` и `frontend/.env.local`
> закоммичены намеренно, поэтому LLM-ключи переезжают вместе с `git clone`.
> Файл-карта проекта — `ForChat.md`. Этот файл — только про перенос.

---

## 1. Что должно стоять на целевой машине

| Компонент | Версия | Обязательно | Зачем |
|-----------|--------|-------------|-------|
| Python | **3.10–3.12** (НЕ 3.13/3.14) | ✅ | backend (chromadb не собирается на 3.13+) |
| Node.js + npm | **20 LTS** | ✅ | frontend (Next.js 16) |
| git | любая | ✅ | клонирование |
| **Java (JRE/JDK)** | **17+** | ⚠️ | «Тестовые данные»/«Jobs» ходят в БД через JDBC (JPype). Без Java всё стартует, но подключения к БД вернут ошибку |
| Docker / PostgreSQL 16 | — | ❌ | по умолчанию SQLite; PG — опция для прода |
| Maven/Gradle | — | ❌ | только для запуска Java-автотестов на машине с фреймворком |

Проверка: `python3.12 --version && node --version && java -version`

---

## 2. Вариант А — новая рабочая машина (dev)

```bash
git clone https://github.com/TuxooTurr/simplec.git SimpleTest
cd SimpleTest
bash install.sh      # venv + pip install + .env (уже в репо — шаг пропустится)
bash start.sh        # backend :8000 + frontend :3000, откроет браузер
```

Вход: `Sber911` / `1234567` (superuser) или `SberMonitoring` / `1234567`.

Windows: используйте Conda (`conda create -n simpletest python=3.12 && conda activate simpletest`),
затем те же `bash install.sh` / `bash start.sh` из Git Bash.

---

## 3. Вариант Б — сервер (prod, VPS)

```bash
# На сервере (Ubuntu 22/24, Debian 12, AlmaLinux 8/9):
curl -O https://raw.githubusercontent.com/TuxooTurr/simplec/main/deploy.sh
# отредактируйте DOMAIN в шапке скрипта, затем:
sudo bash deploy.sh
```

Скрипт ставит python3.12 + Node 20 + **Java 17** + nginx + certbot, клонирует репо
в `/opt/simpletest`, собирает production-фронтенд (next build, standalone),
регистрирует 2 systemd-сервиса и настраивает nginx:

| Сервис | Что | Порт (локальный) |
|--------|-----|------------------|
| `simpletest-api` | uvicorn backend.main:app | 127.0.0.1:8000 |
| `simpletest-next` | node .next/standalone/server.js | 127.0.0.1:3000 |

nginx: `/` → next, `/api` + `/healthz` + `/docs` → FastAPI, `/api/ws/` → WebSocket-upgrade.

Управление: `journalctl -u simpletest-api -f`, `systemctl restart simpletest-api simpletest-next`.

Обновление кода на сервере:
```bash
cd /opt/simpletest && sudo -u simpletest git pull
cd frontend && sudo -u simpletest npm run build \
  && sudo -u simpletest cp -r .next/static .next/standalone/.next/static
sudo systemctl restart simpletest-api simpletest-next
```

---

## 4. Данные, которые НЕ переезжают через git (переносить руками)

Эти файлы в `.gitignore` (секреты/локальные данные). Если история и настройки нужны
на новой машине — скопируйте их **после** клонирования, **до** первого запуска:

| Что | Файл/папка | Содержимое |
|-----|-----------|-----------|
| Основная БД | `simpletest.db` | метрики, настройки приложения (LLM-ключи из UI, стенды Ревизора, Логи VPS, custom LLM) |
| Векторная БД | `db/chroma_db/`, `db/chroma_data/` | эталоны (RAG) |
| Подключения к БД | `data/testdata_connections.json` | хосты/логины/пароли Тестовых данных |
| JDBC-драйверы | `data/jdbc_drivers.json` + `data/jdbc_drivers/` | реестр драйверов и сами .jar |
| Kafka-подключения | `data/kafka_explorer_connections.json` | брокеры/SASL Просмотра Kafka |
| Сессии генерации | `data/gen_sessions.json` | история генераций тест-кейсов |
| Корп. CA bundle | `certs/ca-bundle.pem` | если собирался для корп. прокси |

Одной командой (со старой машины на новую):

```bash
rsync -av \
  simpletest.db db/chroma_db db/chroma_data \
  data/testdata_connections.json data/jdbc_drivers.json data/jdbc_drivers \
  data/kafka_explorer_connections.json data/gen_sessions.json \
  user@новая-машина:/путь/до/SimpleTest/
```

Чего-то из списка может не быть — это нормально (создастся при первом использовании).

---

## 5. ⚠️ Машинно-зависимые пути — проверить после переноса

В данных хранятся **абсолютные пути старой машины**. После переноса поправить в UI:

1. **Настройки → LLM Провайдеры → GigaChat «Подключение»** — пути к сертификатам
   (CA/client cert/key), если использовался режим «По сертификату».
2. **Просмотр Kafka → Подключения** — пути к ключу/сертификату/CA у SSL-подключений.
3. **Автотестирование** — путь к папке фреймворка (`data/autotest_run_config.json`).
4. `.env` — `SSL_CERT_FILE`/`GIGACHAT_*_PATH`, если заданы.

`data/jdbc_drivers/` переносится папкой целиком — пути внутри реестра относительные,
править не нужно.

---

## 6. Проверка после миграции (5 минут)

```bash
curl -s http://localhost:8000/healthz          # → {"status":"ok"}
```

В браузере (`http://localhost:3000` или домен):
1. Логин `Sber911`/`1234567` → открылась Генерация.
2. Сайдбар «СТАТУС LLM» — хотя бы один провайдер зелёный (иначе — Настройки → ключ).
3. Настройки: карточки открываются, «Тестовые данные → Настройка драйверов» показывает
   3 встроенных драйвера (+ ваши, если переносили `data/jdbc_drivers*`).
4. Генерация Smoke на коротком требовании → кейсы + саммари времени → Экспорт → XML.
5. Если используется JDBC: `java -version` работает, тест подключения к БД зелёный.

---

## 7. Известные грабли

- **Python 3.13/3.14** — chromadb не встанет. Только 3.10–3.12.
- **JPype/JVM**: .jar-драйвер, добавленный «Настройкой драйверов» после старта бэкенда,
  заработает только после перезапуска бэкенда (classpath JVM фиксируется при старте).
- **Порты заняты**: `lsof -ti :8000 | xargs kill -9` (и то же для :3000).
- **Корп. прокси/SSL**: `SSL_NO_VERIFY=1` в `.env` — быстрый обход; правильный путь —
  `bash certs/build_bundle.sh` и перезапуск бэкенда. Для старых BIG IP: `SSL_MAX_TLS12=1`.
- **uvicorn не тем питоном**: всегда `python -m uvicorn ...`, не `uvicorn` напрямую.
- Активный LLM-провайдер выбирается кликом в сайдбаре и **не запоминается** между
  перезагрузками страницы (возвращается GigaChat).
