# GIGACODE.md — SimpleTest для GigaCode CLI

Карта проекта и правила работы для агента GigaCode. Подробный контекст проекта —
`ForChat.md`, правила разработки — `CLAUDE.md`. MCP-серверы настраиваются глобально
в `~/.gigacode/settings.json` (не в репозитории): токены туда вписывает пользователь.

## Какой MCP для какой задачи

| MCP | Для чего | Для чего НЕ подходит |
|---|---|---|
| `simpletest` (свой, `mcp_server/` этого репозитория) | Логи dropup: проекты, сервисы, поды, разбор ошибок, сводка по стенду. Требования, оформление баг-репорта, представления Jira-аналитики SimpleTest | Запись в Jira — сервер только читает |
| `jira` (mcp-atlassian, Jira DC по PAT) | JQL, чтение задач и требований, создание дефекта в SBER911 | Zephyr Scale: в mcp-atlassian инструментов Zephyr нет (проверь `tools/list`). Тест-кейсы выгружаются XML из SimpleTest |
| `playwright` (@playwright/mcp) | E2E интерфейса SimpleTest (`localhost:3000`), ручное исследование страниц | Логи dropup — для них `simpletest` (готовые инструменты вместо кликов) |
| `web-fetch` (mcp-server-fetch) | Открытые адреса без входа: `/healthz`, публичные JSON | Kibana, Grafana, консоль dropup — за SSO, сессии у fetch нет. API SimpleTest — нужен Bearer-токен, а fetch не передаёт заголовки |

### Подключение `simpletest` к GigaCode

```bash
gigacode mcp add simpletest \
  -e DROPUP_CONSOLE_URL=https://console-openshift-console.apps.<кластер> \
  -e SIMPLETEST_LOGIN=<логин SimpleTest> -e SIMPLETEST_PASSWORD=<пароль SimpleTest> \
  /полный/путь/к/simplec-main/scripts/simpletest-mcp.sh
```

- Зависимости — из `requirements.txt` (`mcp`, `playwright`); браузер — установленный Google Chrome,
  скачивать браузеры Playwright не нужно. Другой браузер: `MCP_WEB_BROWSER_PATH=/путь/к/исполняемому`.
- Первый вызов `dropup_login` откроет окно консоли — входит человек. Сессия хранится в
  `~/.simpletest/mcp-web/` (профиль браузера и `session-cookies.json` с правами 0600); истечёт —
  инструменты попросят войти снова.
- Один процесс на профиль браузера. Если нужен доступ и из GigaCode, и из SimpleTest — запускать
  `scripts/simpletest-mcp.sh --http` (http://127.0.0.1:8765/mcp) и подключаться к нему по HTTP.

| Инструмент | Что делает |
|---|---|
| `logs_analyze` | **Главный для логов**: имя сервиса → ошибки за N минут через источник, записанный в SimpleTest |
| `logs_saved_services` | Сохранённые имена микросервисов анализатора |
| `web_scenarios`, `web_run` | Операции веб-коннекторов (записаны человеком в SimpleTest) и их запуск с параметрами: `web_run(id, params={"incident": "INC…"})`. Операция может что-то менять на ресурсе — запускать только по просьбе пользователя |
| `dropup_status`, `dropup_login` | Прямой доступ к консоли OpenShift: есть ли сессия; открыть окно входа |
| `dropup_projects`, `dropup_services`, `dropup_pods` | Проекты (стенды), сервисы с версиями образов, поды с рестартами и CrashLoop |
| `dropup_triage` | Логи сервиса за N минут → группы ошибок по причине, важность, стеки |
| `dropup_check` | Сводка по стенду: 🟢/🟡/🔴, поды, рестарты, главная ошибка каждого сервиса |
| `dropup_logs` | Сырые строки с фильтром grep |
| `simpletest_requirements`, `simpletest_requirement` | Библиотека требований SimpleTest |
| `simpletest_format_bug` | Черновик баг-репорта по шаблону SimpleTest (в Jira не создаёт) |
| `simpletest_jira_views`, `simpletest_jira_view_run` | Представления Jira-аналитики SimpleTest |

Рекомендации к настройке:
- Закрепить версию Playwright MCP: `npx @playwright/mcp@0.0.83` вместо `@latest` — в
  корпоративной сети обновление «латеста» может сломать всё без предупреждения.
- Требования из Confluence: у того же `mcp-atlassian` есть Confluence — добавить
  `CONFLUENCE_URL` и `CONFLUENCE_PERSONAL_TOKEN` в env сервера `jira`.

## Карта SimpleTest (после реструктуризации 10.10.2026)

Сайдбар: **Тестовая модель** (генерация кейсов, бывшее «Ручное тестирование») ·
Тестовые данные · Дефекты · Просмотр Kafka · **Генераторы событий** · Данные (только
«Требования») · Тестирование моделей LLM.

Скрыты, код сохранён: Автотестирование и Ревизор. **Логи** — новый анализатор: имя сервиса
→ ошибки за N минут; источник — сценарий веб-коннектора (Генераторы событий → Веб-коннекторы),
записанный человеком под своей сессией. Не опирайся на старые `/api/logs/*` (VPS-подключения)
и `/api/revisor/*`: в корп. контуре они ни к чему не подключены.

Генераторы событий — хаб плиток: Метрики ОД и ТКС (только superuser), Jobs и по
плитке на каждую папку алертов. Внутри папки — скрипты, редактирование, запуск в
Jupyter-ядре и **ответ ядра в виде чата**: контакт = топик Kafka, в сообщении тело и
получатели (`frontend/lib/kernelMessages.ts`).

| Что | Где |
|---|---|
| Поля Jira SBER911 (форматы, КЭ, ИТ-услуга) — единственный источник | `backend/api/jira_constants.py` |
| Создание дефекта в Jira | `backend/api/jira_defects.py` |
| Шаблон баг-репорта (промпт) | `backend/api/bugs.py` → `_format_bug_sync` |
| Jira-аналитика (представления) | `backend/api/jira_views.py` |
| Скрипты и папки алертов | `data/alert_scripts.json`, `data/alert_folders.json` |

## Скрипты алертов: как попасть в чат точно

Чат узнаёт привычные строки скриптов («✅ → topic partition=…», «✅ Отправлено
topic=…», «Адресат: …», JSON-тело перед отправкой). Для новых скриптов надёжнее
печатать маркер одной строкой после отправки:

```python
print("@@ST_MSG " + json.dumps({"topic": TOPIC, "body": payload,
      "recipients": [RECIPIENT_AGENT], "key": key}, ensure_ascii=False))
```

## Правила

- **Запись в Jira — только после явного подтверждения пользователя.** Сначала показать
  черновик дефекта, потом создавать.
- Формат полей SBER911 не выдумывать — брать из `jira_constants.py`.
- Секреты (PAT, пароли, ключи подписи) не писать в файлы репозитория. Исключение,
  о котором нужно помнить: в скриптах алертов «МПР» и «Alert Reflex» уже лежит ключ
  подписи JWT тестового контура — не копировать его в новые места.
- SSL: SimpleTest по умолчанию ходит в Jira без проверки сертификата (BIG IP).
  Для MCP проверку не отключать, пока нет реальной SSL-ошибки.
- Запуск SimpleTest: `bash start.sh`; тесты: `python -m pytest tests -q`.
