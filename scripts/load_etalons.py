"""
Загрузка эталонных требований в векторную БД.
Источник: Требования к получению шаблонов по инциденту.
"""

from vector_store import VectorStore

vs = VectorStore()
vs.clear_all()
print("БД очищена. Загружаю эталоны...\n")

# ============================================================
# БЛОК 1: SCOPE
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-SCOPE-001",
    content="""На странице представлены требования для получения шаблонов по инциденту.""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="scope",
    tags=["scope", "incident", "template", "tks"]
)

# ============================================================
# БЛОК 2: BUSINESS_LOGIC — Основная логика
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-BL-001",
    content="""При открытии страницы вызывается метод getWorkGroupIncidents, 
в ответе проверяется наличие объекта templates:
- если template передан — проверяется status:
  - если status = success — отображается кнопка "Получить шаблон по сбору ТКС" и вызывается метод getTemplates
  - если status = sent — отображается загрузка
  - если status = error — появляется лейбл "нет подходящих шаблонов" и появляется возможность просмотреть уведомление и обновить список шаблонов
- если template не передан — отображается кнопка "Получить шаблон по сбору ТКС" и вызывается метод requestIncidentTemplates""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="business_logic",
    tags=["logic", "status", "template", "branching", "getWorkGroupIncidents"]
)

vs.add_requirement(
    req_id="REQ-TMPL-BL-002",
    content="""После нажатия кнопки "Получить шаблон по сбору ТКС" вызывается метод getTemplates:
- в случае если шаблоны найдены — появляется уведомление о найденных шаблонах, 
  при нажатии на кнопку "Перейти к шаблону по сбору ТКС" открывается модальное окно со списком найденных шаблонов
- в случае если шаблоны не найдены — появляется лейбл "нет подходящих шаблонов" 
  и появляется возможность просмотреть уведомление и обновить список шаблонов""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="business_logic",
    tags=["logic", "getTemplates", "search_result", "branching"]
)

# ============================================================
# БЛОК 3: DATA_MODEL — Модель данных
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-DM-001",
    content="""Таблица incident_tks_template:
- id int8 (обязательное) — ID записи в таблице
- req_uuid varchar(255) (обязательное) — UUID запроса в таблице
- incident_id int8 (обязательное) — ID инцидента
- user_id varchar(255) (обязательное) — ID пользователя
- updated_by varchar(255) (необязательное) — ID обновившего запись
- created_date timestamp (обязательное) — Дата создания записи
- update_date timestamp (необязательное) — Дата обновления записи
- template_ids array[int] (необязательное) — Массив id найденных шаблонов
- workgroup_id int8 (необязательное) — ID рабочей группы
- status varchar(20) (необязательное) — Статус запроса, enum: [sent, success, error]""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="data_model",
    tags=["data_model", "table", "incident_tks_template", "status_enum"]
)

vs.add_requirement(
    req_id="REQ-TMPL-DM-002",
    content="""Таблица incident_template_user_request:
- req_uuid varchar(255) (обязательное) — Сгенерированный ID запроса для получения справки размерности 64 байта. Пример: 123e4567-e89b-12d3-a456-426655440000
- user_id int8 (обязательное) — ID пользователя, прикрепленного к запросу. Пример: 121019""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="data_model",
    tags=["data_model", "table", "incident_template_user_request", "uuid"]
)

# ============================================================
# БЛОК 4: API_METHOD — getWorkGroupIncidents
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-API-001",
    content="""Метод getWorkGroupIncidents
Путь: /sber911/ms/work-group/web/npi/
Описание: Метод для получения списка инцидентов и инструкций к ним. 
Доработка имеющегося метода для получения инцидентов по ИТ-услугам ДС в РМДС.
Логика: При вызове метода будет получен status предыдущих (если есть) записей поиска шаблона.

Request параметры:
- updateDate number (необязательное) — Дата обновления кэш. 
  Если дата обновления кэш по инцидентам < updateDate — пересчитать кэш, после чего выполнять запрос.

Response.result параметры:
- totalCount number (обязательное) — Всего сообщений
- incidents array(obj) (обязательное) — Сортировка по createDate, от новых к старым
  - smId string(255) (обязательное) — ID инцидента в SM
  - priority string(255) (обязательное) — Приоритет, enum: [largescale, critical, veryimportant, high, medium, low]
  - priorityColor string(255) (обязательное) — Цвет приоритета, определяется на back-end
  - createDate number (обязательное) — Дата начала
  - updateDate number (обязательное) — Дата завершения
  - status string(50) (обязательное) — Статус инцидента, enum: [registred, assigned, in_progress, waiting, done]
  - template object (необязательное) — Объект с информацией по шаблону
    - reqId number (обязательное) — UUID запроса на получение шаблона
    - status string(20) (обязательное) — Статус запроса из incident_tks_template.status
  - configElement object (обязательное) — Корневая АС инцидента
    - id number (обязательное) — ID АС
    - smId string(255) (обязательное) — CI АС
    - name string(255) (обязательное) — Имя АС""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="api_method",
    tags=["api", "getWorkGroupIncidents", "request", "response", "incidents", "template_status"]
)

# ============================================================
# БЛОК 5: API_METHOD — requestIncidentTemplates
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-API-002",
    content="""Метод requestIncidentTemplates
Путь: /sber911/ms/work-group/web/npi/
Описание: Метод для создания запроса на получение шаблонов.

Логика:
- Если объект template вернулся — появляется возможность обновить результат поиска
- Если объект template не вернулся — отображается кнопка "Найти шаблон для сбора ТКС"
- При отправке запроса user_id добавляется в таблицу incident_template_user_request
- Проверяется наличие записи в статусе sent — если есть, пользователь привязывается к первому запросу
- Если передан id для которого status=="success" — формируется новый запрос
- Если последний запрос не в статусе status="sent" — создается новый запрос
- Если status=="error" — проверяется есть ли более новый запрос со статусом "success" или "sent":
  - если есть — вернуть этот более новый id
  - если нет — создать новый id

Request:
- incidentId int8 (обязательное) — ID инцидента в сервисе НПИ
- id int8 (необязательное) — id запроса

Response.result:
- id number (обязательное) — Сгенерированный ID записи по RAG-запросу
- status string(64) (обязательное) — При успешном вызове всегда "sent"
- updateDate number (обязательное) — Текущая серверная дата регистрации""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="api_method",
    tags=["api", "requestIncidentTemplates", "request", "response", "status_logic"]
)

# ============================================================
# БЛОК 6: API_METHOD — getTemplates
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-API-003",
    content="""Метод getTemplates
Описание: Метод вызывается для получения и обновления списка шаблонов.

Request:
- incident_id number (обязательное) — id инцидента. Пример: 11277
- refresh boolean — флаг принудительного обновления

Response:
- updateDate timestamp (обязательное) — Время обновления
- incidentId string (обязательное) — Id инцидента. Пример: IM0247846365
- templates array[object] maxItems=5 (обязательное) — Массив шаблонов
  - id string (обязательное) — id шаблона. Пример: 13255
  - name string (обязательное) — Название шаблона
  - description string (обязательное) — Описание шаблона
  - conference object
    - externalId number (обязательное) — id конференции
    - statusType string (обязательное) — Тип конференции: tks, jazz

Пример request: {"id": 11277, "refresh": false}
Пример response: {"templates": [{"id": 13255, "name": "Мой шаблон", "description": "Описание", "conference": {"externalId": 11277, "statusType": "tks, jazz"}}]}""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="api_method",
    tags=["api", "getTemplates", "request", "response", "templates_list", "refresh"]
)

# ============================================================
# БЛОК 7: SEQUENCE — Диаграмма последовательности
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-SEQ-001",
    content="""Sequence-диаграмма получения шаблонов:
Участники: Пользователь → Веб-интерфейс → API Gateway → Backend → RAG База → БД шаблонов

Поток:
1. Пользователь нажимает кнопку получения шаблонов
2. Веб-интерфейс отправляет HTTP запрос (с параметрами) в API Gateway
3. API Gateway передает запрос в Backend
4. Backend анализирует параметр refresh:
   - Если refresh=False:
     - Проверка наличия актуальной подборки в БД шаблонов
     - Если актуальная подборка есть — возвращает шаблоны из базы → пользователю
     - Если актуальной подборки нет — запрос на RAG-поиск шаблонов → сохраняет новую подборку → возвращает результаты
   - Если refresh=True:
     - Запрос на RAG-поиск шаблонов → сохраняет новую подборку → возвращает результаты""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="sequence",
    tags=["sequence", "flow", "refresh", "rag", "integration"]
)

# ============================================================
# БЛОК 8: NOTIFICATION — Уведомления
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-NOTIF-001",
    content="""Формирование уведомлений о завершении обработки запросов:
Тип: WORKGROUP_INCIDENT_TEMPLATE_READY

Параметры уведомления:
- userIds array(number) — массив user_id из incident_template_user_request по req_uuid запроса
- status string(50) — incident_tks_template.status
- id string(128) — incident_tks_template.id
- smId string(255) — incident.sm_id
- systemName string(255) — sd_system.system_name
- incidentId number — incident_tks_template.incident_id

Логика: В сервисе уведомлений адресаты определяются по массиву userIds.
Затем по шаблону WORKGROUP_INCIDENT_TEMPLATE_READY формируются уведомления (вызывается метод Web-уведомлений).""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="notification",
    tags=["notification", "push", "userIds", "template_ready"]
)

# ============================================================
# БЛОК 9: UI_REQUIREMENT — Требования к фронту
# ============================================================
vs.add_requirement(
    req_id="REQ-TMPL-UI-001",
    content="""Страница "Рабочее место дежурного по смене":
1. У инцидента в блоке "Инциденты на услугах ДС", в выпадающем меню "AI-функции" появляется кнопка "Найти шаблон для сбора ТКС".
   При нажатии вызывается метод getTemplates, возвращающий список шаблонов по инциденту.
2. После нажатия на кнопку и вызова метода getTemplates, появляется информация о поиске шаблона.""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="ui_requirement",
    tags=["ui", "button", "getTemplates", "incident_block", "ai_functions"]
)

vs.add_requirement(
    req_id="REQ-TMPL-UI-002",
    content="""Шаблон НЕ найден:
3. Появляется информационное окно о том что шаблон не найден и дополнительная информация у инцидента в блоке "Инциденты на услугах ДС" вместо кнопки "Найти шаблон для сбора ТКС".
3.1. Если пользователь закрыл информационное окно — в выпадающем меню "AI-функции" появится кнопка для открытия модального окна с информацией о поиске шаблона.
3.2. Появляется кнопка повторного получения/обновления списка шаблонов (вызывает getTemplates с refresh=true).""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="ui_requirement",
    tags=["ui", "error_state", "not_found", "modal", "refresh", "retry"]
)

vs.add_requirement(
    req_id="REQ-TMPL-UI-003",
    content="""Шаблон НАЙДЕН:
4. Появляется информационное окно с кнопкой открытия модального окна для просмотра шаблона.
   В модальном окне есть возможность:
   - обновить список шаблонов
   - отправить приглашение
   - посмотреть шаблон детально
4.1. Кнопка обновления вызывает getTemplates с refresh=true.
4.2. При нажатии на инцидент открывается новая вкладка с детальной информацией. Метод: /template/data.
4.3. Кнопка "отправить" вызывает меню с выбором типа приглашения:
   - Приглашение всем на E-mail и СМС
   - Вызвонить тех, кто разрешил
   - Вызвонить всех без исключений
   При выборе "Приглашение всем на E-mail и СМС" вызывается окно стандартного приглашения в ТКС.
   Кнопка "отправить" вызывает метод sendInvite.
   После отправки модальное окно закрывается и появляется уведомление о запуске шаблона.""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    content_type="ui_requirement",
    tags=["ui", "success_state", "modal", "invite", "sendInvite", "template_detail"]
)

# ============================================================
# Статистика
# ============================================================
stats = vs.get_stats()
print("=" * 50)
print("Загрузка завершена!")
print(f"  Требования:  {stats['requirements']}")
print(f"  Тест-кейсы:  {stats['test_cases']}")
print(f"  Пары:        {stats['pairs']}")
print("=" * 50)

# Проверяем поиск
print("\nТест поиска: 'статус шаблона error'")
results = vs.find_similar_requirements("статус шаблона error", n_results=3)
for r in results:
    print(f"  [{r['id']}] distance={r['distance']:.4f}")
    print(f"  {r['document'][:80]}...")
    print()

print("Тест поиска: 'кнопка отправить приглашение'")
results = vs.find_similar_requirements("кнопка отправить приглашение", n_results=3)
for r in results:
    print(f"  [{r['id']}] distance={r['distance']:.4f}")
    print(f"  {r['document'][:80]}...")
    print()

print("Тест поиска: 'API метод получения шаблонов request response'")
results = vs.find_similar_requirements("API метод получения шаблонов request response", n_results=3)
for r in results:
    print(f"  [{r['id']}] distance={r['distance']:.4f}")
    print(f"  {r['document'][:80]}...")
    print()

