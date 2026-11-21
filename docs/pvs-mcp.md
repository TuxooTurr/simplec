# PVS MCP на ИФТ

При установке или обновлении Shark в корпоративном контуре ГигаКод выполняет шаги ниже на хосте, где запускается бэкенд Shark. Для прямого доступа из ГигаКод Desktop тот же MCP регистрируется в настройках Desktop. Оба клиента запускают свой процесс по stdio.

## 1. Установить сервер из AI-market

1. Получите утверждённую версию из каталога `InSourceHub_AI/AI_market`, папка `mcp/pvs-mcp`. Разместите её вне репозитория Shark, например в `/home/work/$USER/pvs-mcp`. При обновлении используйте версию из корпоративного каталога.
2. На хосте Shark установите `uv` в отдельное окружение под `/home/work/$USER`. Используйте корпоративную конфигурацию пакетного индекса. README PVS указывает `uv` версии 0.13.0 или новее.

```bash
work_dir="/home/work/$USER"
uv_venv="$work_dir/.venvs/uv"
pvs_venv="$work_dir/.venvs/pvs-mcp"
pvs_src="$work_dir/pvs-mcp"
test -f "$pvs_src/pyproject.toml"

python3 -m venv "$uv_venv"
"$uv_venv/bin/python" -m pip install 'uv>=0.13.0'
"$uv_venv/bin/uv" --version
export UV_CACHE_DIR="$work_dir/.cache/uv"
export UV_TOOL_DIR="$work_dir/.local/share/uv/tools"
export UV_TOOL_BIN_DIR="$work_dir/.local/bin"

if [ -f "$pvs_src/uv.lock" ]; then
  UV_PROJECT_ENVIRONMENT="$pvs_venv" "$uv_venv/bin/uv" sync --project "$pvs_src" --locked --no-dev
else
  python3 -m venv "$pvs_venv"
  "$uv_venv/bin/uv" pip install --python "$pvs_venv/bin/python" "$pvs_src"
fi
test -x "$pvs_venv/bin/opensearch-mcp-server-py"
```

[Карточка PVS MCP в AI-market](https://onework.sigma.sbrf.ru/sc/InSourceHub_AI/AI_market?path=mcp%2Fpvs-mcp)

## 2. Подключить ГигаКод Desktop и проверить маппинг

В настройках MCP добавьте сервер `pvs` с транспортом `stdio`. Команда — абсолютный путь к `/home/work/<пользователь>/.venvs/pvs-mcp/bin/opensearch-mcp-server-py`, аргументы — пустой список. Если Desktop работает на отдельном хосте, выполните установку и там с учётом доступа к PVS.

В блоке «Переменные окружения» сервера укажите параметры подключения. Те же переменные понадобятся окружению запуска Shark.

| Переменная | Значение |
|---|---|
| `OPENSEARCH_URL` | `https://tsles-sber00075.esrt.sber.ru:19200` |
| `OPENSEARCH_USERNAME` | `pvs_user` |
| `OPENSEARCH_PASSWORD` | Секрет из корпоративного хранилища или секрет окружения прогона |
| `OPENSEARCH_SSL_VERIFY` | `true` |
| `OPENSEARCH_CA_CERT_PATH` | Абсолютный путь к корпоративной цепочке CA; для указанного ИФТ обязателен |
| `OPENSEARCH_CLIENT_CERT_PATH`, `OPENSEARCH_CLIENT_KEY_PATH` | Абсолютные пути к клиентскому сертификату и ключу; на указанном ИФТ требуется mTLS |

Для ГигаКод Desktop и CI передавайте пароль через окружение запуска из корпоративного хранилища. В репозитории Shark файл `.env` отслеживается Git. При переходе на IAM обновите окружение или конфигурацию самого PVS MCP по документации этого контура.

1. В ГигаКод проверьте подключение и список инструментов. В README указаны `ListIndexTool`, `IndexMappingTool` и `SearchIndexTool`. Если имена в `tools/list` отличаются, используйте объявленные имена.
2. По сведениям ИФТ от 20.11.2026 индекс логов — `sber-app-*`. Сверьте его и маппинг на целевой установке через `IndexMappingTool`. При наличии прав `ListIndexTool` поможет уточнить индекс/алиас; 403 на каталог не мешает поиску по известному индексу. Поля времени, namespace, уровня и сервиса должны соответствовать маппингу, точное совпадение — индексируемому полю `keyword`. Значения сервиса должны совпадать со справочником Shark.
3. Через `SearchIndexTool` выполните поиск по `sber911-sigma-back` за короткий период. Сверьте время, сервис и сообщение найденной записи в [веб-интерфейсе PVS](https://tsles-sber00076.esrt.sber.ru:15601). Логи из других namespace появятся по мере их подключения.

Пример аргументов `SearchIndexTool` с известным маппингом ИФТ. Подставьте время известной операции в ISO 8601 с часовым поясом; при другом источнике замените индекс и поля проверенными значениями.

```json
{
  "index": "sber-app-*",
  "format": "json",
  "size": 5,
  "query_dsl": {
    "query": {
      "bool": {
        "filter": [
          {"term": {"k8s.namespace.name.keyword": "sber911-sigma-back"}},
          {"range": {"timestamp": {"gte": "<начало периода>", "lte": "<конец периода>"}}}
        ]
      }
    }
  }
}
```

## 3. Подключить раздел «Логи» в Shark

После `bash install.sh` добавьте настройки в окружение запуска бэкенда Shark. Ниже — известный маппинг ИФТ от 20.11.2026; при отличии целевого источника используйте проверенные значения из шага 2. Задайте также пути CA, client cert/key из таблицы выше; файлы остаются вне репозитория.

```bash
export LOGS_MCP_PROFILE=pvs
export LOGS_MCP_TRANSPORT=stdio
export LOGS_MCP_COMMAND="/home/work/$USER/.venvs/pvs-mcp/bin/opensearch-mcp-server-py"
export OPENSEARCH_URL=https://tsles-sber00075.esrt.sber.ru:19200
export OPENSEARCH_SSL_VERIFY=true
export LOGS_MCP_NAMESPACE=sber911-sigma-back
export LOGS_PVS_INDEX='sber-app-*'
export LOGS_PVS_FIELDS='{"namespace":"k8s.namespace.name.keyword","service":"service.name.keyword","timestamp":"timestamp","level":"level.keyword","message":"message","traceId":"mdc.traceId.keyword","stack":"stackTrace"}'
```

Если имя из `tools/list` отличается от `SearchIndexTool`, задайте `LOGS_MCP_TOOL`. Запустите Shark через `bash start.sh` в настроенном окружении. Откройте **Настройки → Подключения → PVS MCP**, введите логин и пароль сервисной учётки, затем нажмите «Сохранить» и «Проверить подключение». Та же форма открывается по кнопке «Подключения» в шапке раздела «Логи». Настройка доступна администратору Shark.

Shark хранит пароль в зашифрованном локальном хранилище. Для stdio сохранённая учётка применяется сразу и имеет приоритет над `OPENSEARCH_USERNAME` и `OPENSEARCH_PASSWORD` из окружения. Кнопка «Убрать сохранённую учётку» возвращает настройки окружения. CI может использовать только переменные окружения.

В режиме `SHARK_MOCK=1` проверка использует демонстрационные данные. PVS выдаёт до 100 последних событий за запрос. Режим «Только ошибки» фильтрует по настроенному полю уровня. Если выдача ограничена, сузьте период.

Поиск и разбор из экрана «Логи» выполняются в фоне. Shark показывает этап, время ожидания и кнопку «Отменить». Для одного вызова MCP используется `LOGS_MCP_REQUEST_TIMEOUT` (по умолчанию 120 секунд, допустимо 5–600), для всей операции — `LOGS_MCP_JOB_TIMEOUT` (900 секунд, допустимо 30–3600). В режиме stdio таймаут PVS `OPENSEARCH_TIMEOUT` по умолчанию следует за таймаутом вызова MCP. Если у PVS настроены собственные серверные лимиты, он может вернуть неполную выдачу раньше. Такие результаты помечаются на экране.

Для приёмки откройте «Логи». Проверьте выдачу по всем сервисам и по одному сервису, затем «Только ошибки» за период с известной ошибкой. Если в сообщении есть ссылка на сервис из справочника, запустите разбор и проверьте связанные события в том же namespace. При обновлении Shark сохраняются внешнее окружение и путь к установленному MCP. Если обновилась сборка самого MCP, повторите установку и сверку `tools/list`.

### Проверка из тестового раннера

На хосте ИФТ выполните действие, создающее известное событие, и передайте окно теста с часовым поясом и часть сообщения. Запускайте из корня Shark с активированным Python-окружением проекта и теми же переменными, что у бэкенда.

```bash
PVS_SMOKE=1 PVS_SMOKE_FROM='<ISO 8601>' PVS_SMOKE_TO='<ISO 8601>' \
  PVS_SMOKE_EXPECTED_TEXT='<часть сообщения>' \
  python -m pytest -q tests/test_pvs_ift_smoke.py
```

Опционально задайте `PVS_SMOKE_SERVICE`, `PVS_SMOKE_REQUEST_ID`, `PVS_SMOKE_TRACE_ID` и `PVS_SMOKE_TIMEOUT` в секундах. Проверка ждёт доставки события за фиксированный период.

Для Python-автотестов доступны `fetch_logs` и `wait_for_logs` из `agents.log_assertions`. Время должно включать часовой пояс; ожидание опрашивает фиксированное окно теста:

```python
from agents.log_assertions import LogFilter, fetch_logs, wait_for_logs

# test_started_at/test_finished_at — datetime с часовым поясом.
scope = dict(namespace="sber911-sigma-back", service=service_name, trace_id=trace_id)
observed = await wait_for_logs(
    test_started_at, test_finished_at, LogFilter(**scope, text="операция записана"),
    timeout=45, interval=2,
)
assert observed.records
errors = await fetch_logs(test_started_at, test_finished_at, LogFilter(**scope, levels=("ERROR",)))
assert not errors.truncated
assert not errors.records
```

Выбирайте событие завершающего шага операции и учитывайте задержку доставки ошибок: одна ранняя запись не доказывает отсутствие более поздних ERROR. Можно искать точное значение JSON-поля через `field="context.result", value="SUCCESS"`. При неполной выдаче сузьте период или добавьте trace ID. `requestId` в известном маппинге ИФТ отсутствует; не используйте его как обязательный фильтр этого источника.

## Справочник микросервисов

В разделе «Логи» нажмите «Обновить микросервисы из логов». `POST /api/mcp-logs/catalog/refresh` получает имена агрегацией за 72 часа в заданном namespace, кеширует на 12 часов; `?force=true` обновляет принудительно. Период меняется `LOGS_PVS_SERVICES_HOURS`. Ошибка/неполная агрегация сохраняет предыдущий справочник. Пустой успешный ответ означает, что за период сервисов нет. Индекс, namespace и маппинг входят в ключ кеша — чужой справочник при смене подключения не используется.
