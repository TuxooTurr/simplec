"""
Загрузка тест-кейсов и пар требование-тест в векторную БД.
"""

from vector_store import VectorStore

vs = VectorStore()

print(f"До загрузки: {vs.get_stats()}")
print("Загружаю тест-кейсы...\n")

# ============================================================
# ТЕСТ-КЕЙСЫ
# ============================================================

# TC-4001: Кнопка при отсутствии template
vs.add_test_case(
    tc_id="SBER911-T4001",
    content="""W [RAG ТКС] Отображение кнопки Найти шаблон для сбора ТКС при отсутствии объекта template.
Цель: Проверить что для инцидента без ранее созданных запросов на поиск шаблонов в меню AI-функции отображается активная кнопка инициации RAG-поиска.
Предусловия: Пользователь авторизован, в таблице incident_tks_template отсутствуют записи для инцидента.
Шаги:
1. Открыть страницу РМДС -> Страница загружена, getWorkGroupIncidents HTTP 200, поле template отсутствует
2. Нажать меню AI-функции -> Кнопка Найти шаблон для сбора ТКС активна, индикатор загрузки отсутствует""",
    name="Отображение кнопки при отсутствии template",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["ui", "initial_state", "no_template", "button"]
)

# TC-4002: Индикатор загрузки при status sent
vs.add_test_case(
    tc_id="SBER911-T4002",
    content="""W [RAG ТКС] Отображение индикатора загрузки при template.status sent.
Цель: Проверить что если предыдущий запрос на RAG-поиск в статусе sent отображается индикатор загрузки и кнопки недоступны.
Предусловия: В таблице incident_tks_template существует запись status sent.
Шаги:
1. Открыть РМДС -> getWorkGroupIncidents HTTP 200, template.status равен sent, БД подтверждает status sent
2. Проверить UI инцидента -> Спиннер отображается, кнопки Найти/Получить шаблон отсутствуют, getTemplates НЕ вызывается""",
    name="Индикатор загрузки при status sent",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["ui", "initial_state", "status_sent", "spinner", "loading"]
)

# TC-4003: Автовызов getTemplates при status success
vs.add_test_case(
    tc_id="SBER911-T4003",
    content="""W [RAG ТКС] Автоматический вызов getTemplates и кнопка Получить шаблон при template.status success.
Цель: Проверить что при загрузке РМДС если RAG-поиск завершился успехом автоматически вызывается getTemplates и отображается кнопка получения результатов.
Предусловия: В таблице incident_tks_template status success, найдено 3 шаблона.
Шаги:
1. Открыть РМДС -> getWorkGroupIncidents HTTP 200, template.status success, кнопка Получить шаблон отображается
2. Проверить DevTools -> POST getTemplates автовызов, refresh false, ответ содержит 3 шаблона с полями id name description conference""",
    name="Автовызов getTemplates при status success",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["ui", "api", "initial_state", "status_success", "getTemplates", "auto_call"]
)

# TC-4004: Лейбл ошибки при status error
vs.add_test_case(
    tc_id="SBER911-T4004",
    content="""W [RAG ТКС] Лейбл Нет подходящих шаблонов и кнопка повтора при template.status error.
Цель: Проверить что при загрузке РМДС если RAG-поиск завершился ошибкой отображается лейбл ошибки кнопка повтора и возможность просмотра уведомления.
Предусловия: В таблице incident_tks_template status error, template_ids NULL, уведомление доставлено.
Шаги:
1. Открыть РМДС -> getWorkGroupIncidents HTTP 200, template.status error, лейбл Нет подходящих шаблонов, кнопка повтора, кнопка просмотра уведомления""",
    name="Лейбл ошибки при status error",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["ui", "initial_state", "status_error", "error_label", "retry"]
)

# TC-4005: MAX created_date при нескольких записях
vs.add_test_case(
    tc_id="SBER911-T4005",
    content="""W [RAG ТКС] Возврат последней записи template MAX created_date при нескольких записях в БД.
Цель: Проверить что при нескольких записях поиска шаблонов по инциденту getWorkGroupIncidents возвращает данные из записи с максимальной created_date.
Предусловия: 3 записи в БД: id 101 error, id 102 success, id 103 sent (последняя).
Шаги:
1. Проверить ответ API -> template.reqId соответствует id 103, template.status sent, БД SELECT ORDER BY created_date DESC LIMIT 1
2. Проверить UI -> спиннер отображается (соответствует sent)""",
    name="MAX created_date при нескольких записях",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["api", "db", "initial_state", "max_created_date", "multiple_records"]
)

# TC-4006: Первый запрос requestIncidentTemplates
vs.add_test_case(
    tc_id="SBER911-T4006",
    content="""W [RAG ТКС] Успешный первый запрос RAG-поиска через requestIncidentTemplates без предыдущего id.
Цель: Проверить полный позитивный сценарий первого запроса на поиск шаблонов: нажатие кнопки, вызов API, создание записей в БД, переход UI в состояние ожидания.
Предусловия: template отсутствует, нет записей в incident_tks_template.
Шаги:
1. Нажать Найти шаблон для сбора ТКС -> POST requestIncidentTemplates HTTP 200, incidentId, id НЕ передан, ответ: id, status sent, updateDate
2. Проверить БД -> incident_tks_template: новая запись status sent, incident_template_user_request: запись с req_uuid и user_id
3. Проверить UI -> кнопка скрыта, спиннер отображается, повторное нажатие не инициирует новый запрос""",
    name="Первый запрос requestIncidentTemplates",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["api", "db", "ui", "request_templates", "first_request", "e2e"]
)

# TC-4007: Получение 3 шаблонов через getTemplates
vs.add_test_case(
    tc_id="SBER911-T4007",
    content="""W [RAG ТКС] Успешное получение 3 шаблонов через getTemplates refresh false и отображение модального окна.
Цель: Проверить полный сценарий получения найденных шаблонов: вызов getTemplates, информационное окно, модальное окно со списком.
Предусловия: template.status success, найдено 3 шаблона.
Шаги:
1. Нажать Получить шаблон -> POST getTemplates HTTP 200, refresh false, ответ: 3 шаблона
2. Проверить информационное окно -> текст Шаблоны найдены, кнопка Перейти к шаблону
3. Нажать Перейти к шаблону -> модальное окно с 3 шаблонами, name, description, statusType, кнопка обновления, кнопка Отправить""",
    name="Получение шаблонов через getTemplates",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["api", "ui", "getTemplates", "modal", "templates_found", "e2e"]
)

# TC-4008: Шаблон не найден — пустой массив
vs.add_test_case(
    tc_id="SBER911-T4008",
    content="""W [RAG ТКС] Отображение информационного окна Шаблон не найден при пустом массиве templates.
Цель: Проверить что при пустом массиве шаблонов отображается информационное окно с сообщением и кнопкой повторного поиска.
Предусловия: template.status success, шаблоны не найдены, template_ids пустой массив.
Шаги:
1. Вызвать getTemplates -> HTTP 200, templates пустой массив
2. Проверить информационное окно -> текст Шаблон не найден, кнопка повторного поиска
3. Закрыть окно -> у инцидента информация о том что шаблоны не найдены, кнопка повтора refresh true""",
    name="Шаблон не найден — пустой массив",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["api", "ui", "getTemplates", "empty_result", "not_found", "retry"]
)

# TC-4009: Максимум 5 шаблонов
vs.add_test_case(
    tc_id="SBER911-T4009",
    content="""W [RAG ТКС] Получение максимального количества 5 шаблонов и проверка структуры каждого объекта.
Цель: Проверить что при нахождении более 5 шаблонов возвращается максимум 5 и каждый содержит все обязательные поля.
Предусловия: RAG нашел 7 шаблонов, maxItems=5.
Шаги:
1. Вызвать getTemplates -> HTTP 200, templates массив ровно 5 объектов
2. Проверить структуру -> id, name, description, conference.externalId, conference.statusType
3. Проверить UI -> модальное окно с 5 шаблонами""",
    name="Максимум 5 шаблонов и проверка структуры",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["api", "ui", "getTemplates", "maxItems", "schema_validation", "boundary"]
)

# TC-4010: Просмотр детальной информации по шаблону
vs.add_test_case(
    tc_id="SBER911-T4010",
    content="""W [RAG ТКС] Просмотр детальной информации по шаблону — открытие в новой вкладке браузера.
Цель: Проверить что при клике на шаблон в модальном окне открывается новая вкладка с детальной информацией через /template/data.
Предусловия: Модальное окно с шаблонами открыто, шаблон id 13255.
Шаги:
1. Кликнуть на шаблон -> новая вкладка, модальное окно остается, вызов /template/data с id 13255, HTTP 200
2. Проверить содержимое -> название, описание, участники конференции, тип конференции""",
    name="Просмотр детальной информации по шаблону",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    priority="normal",
    element_type="test_case",
    tags=["ui", "api", "template_detail", "new_tab", "template_data"]
)

print(f"Тест-кейсы загружены: {vs.test_cases.count()}")

# ============================================================
# ПАРЫ ТРЕБОВАНИЕ → ТЕСТ
# ============================================================
print("\nЗагружаю пары требование-тест...")

# Пара 1: Логика status → 4 теста начального состояния
vs.add_pair(
    pair_id="PAIR-BL001-T4001",
    requirement_text="""При открытии страницы вызывается метод getWorkGroupIncidents, если template не передан — отображается кнопка Найти шаблон для сбора ТКС и вызывается метод requestIncidentTemplates""",
    test_case_xml="""<testCase key="SBER911-T4001">
<name>W [RAG ТКС] Отображение кнопки Найти шаблон при отсутствии template</name>
<objective>Проверить кнопку при отсутствии template</objective>
<precondition>В таблице incident_tks_template отсутствуют записи</precondition>
<steps>
<step>Открыть РМДС -> template отсутствует в ответе</step>
<step>Нажать AI-функции -> кнопка Найти шаблон активна</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["no_template", "initial_state", "button"]
)

vs.add_pair(
    pair_id="PAIR-BL001-T4002",
    requirement_text="""При открытии страницы если template передан и status = sent то отображается загрузка""",
    test_case_xml="""<testCase key="SBER911-T4002">
<name>W [RAG ТКС] Индикатор загрузки при template.status sent</name>
<objective>Проверить спиннер при status sent</objective>
<precondition>В БД запись status sent</precondition>
<steps>
<step>Открыть РМДС -> template.status sent</step>
<step>Проверить UI -> спиннер, кнопки недоступны</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["status_sent", "spinner", "loading"]
)

vs.add_pair(
    pair_id="PAIR-BL001-T4003",
    requirement_text="""При открытии страницы если template передан и status = success то отображается кнопка Получить шаблон по сбору ТКС и вызывается метод getTemplates""",
    test_case_xml="""<testCase key="SBER911-T4003">
<name>W [RAG ТКС] Автовызов getTemplates при template.status success</name>
<objective>Проверить автовызов getTemplates и кнопку при success</objective>
<precondition>В БД status success, 3 шаблона</precondition>
<steps>
<step>Открыть РМДС -> template.status success, кнопка Получить шаблон</step>
<step>DevTools -> POST getTemplates автовызов, 3 шаблона</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["status_success", "getTemplates", "auto_call"]
)

vs.add_pair(
    pair_id="PAIR-BL001-T4004",
    requirement_text="""При открытии страницы если template передан и status = error то появляется лейбл нет подходящих шаблонов и возможность просмотреть уведомление и обновить список""",
    test_case_xml="""<testCase key="SBER911-T4004">
<name>W [RAG ТКС] Лейбл ошибки при template.status error</name>
<objective>Проверить лейбл ошибки и кнопку повтора</objective>
<precondition>В БД status error, template_ids NULL, уведомление доставлено</precondition>
<steps>
<step>Открыть РМДС -> template.status error, лейбл, кнопка повтора, кнопка уведомления</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["status_error", "error_label", "retry", "notification"]
)

# Пара 5: API requestIncidentTemplates → первый запрос
vs.add_pair(
    pair_id="PAIR-API002-T4006",
    requirement_text="""Метод requestIncidentTemplates: при отправке запроса id пользователя добавляется в таблицу, проверяется наличие записи в статусе sent. Формируется новый id при отсутствии ранее созданных запросов со статусом != error""",
    test_case_xml="""<testCase key="SBER911-T4006">
<name>W [RAG ТКС] Первый запрос requestIncidentTemplates без предыдущего id</name>
<objective>E2E: кнопка -> API -> БД -> UI</objective>
<precondition>template отсутствует, нет записей в БД</precondition>
<steps>
<step>Нажать кнопку -> POST requestIncidentTemplates HTTP 200, status sent</step>
<step>Проверить БД -> новые записи в обеих таблицах</step>
<step>Проверить UI -> спиннер, кнопка скрыта</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["requestIncidentTemplates", "first_request", "e2e"]
)

# Пара 6: getTemplates найдены → модальное окно
vs.add_pair(
    pair_id="PAIR-BL002-T4007",
    requirement_text="""После нажатия кнопки вызывается getTemplates: если шаблоны найдены — появляется уведомление, при нажатии Перейти к шаблону открывается модальное окно со списком""",
    test_case_xml="""<testCase key="SBER911-T4007">
<name>W [RAG ТКС] Получение 3 шаблонов через getTemplates и модальное окно</name>
<objective>E2E: getTemplates -> информационное окно -> модальное окно</objective>
<precondition>template.status success, 3 шаблона</precondition>
<steps>
<step>Нажать Получить шаблон -> POST getTemplates HTTP 200, 3 шаблона</step>
<step>Информационное окно -> Шаблоны найдены</step>
<step>Перейти к шаблону -> модальное окно, 3 шаблона, кнопки</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["getTemplates", "templates_found", "modal", "e2e"]
)

# Пара 7: getTemplates не найдены → лейбл
vs.add_pair(
    pair_id="PAIR-BL002-T4008",
    requirement_text="""После нажатия кнопки вызывается getTemplates: если шаблоны не найдены — появляется лейбл нет подходящих шаблонов и возможность обновить список""",
    test_case_xml="""<testCase key="SBER911-T4008">
<name>W [RAG ТКС] Шаблон не найден при пустом массиве templates</name>
<objective>Проверить UI при пустом результате</objective>
<precondition>templates пустой массив</precondition>
<steps>
<step>getTemplates -> HTTP 200, templates пустой</step>
<step>Информационное окно -> Шаблон не найден</step>
<step>Закрыть -> лейбл, кнопка повтора refresh true</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["getTemplates", "empty_result", "not_found", "retry"]
)

# Пара 8: maxItems=5
vs.add_pair(
    pair_id="PAIR-API003-T4009",
    requirement_text="""Метод getTemplates: templates array[object] maxItems = 5. Каждый объект содержит id, name, description, conference с externalId и statusType""",
    test_case_xml="""<testCase key="SBER911-T4009">
<name>W [RAG ТКС] Максимум 5 шаблонов и проверка структуры</name>
<objective>Boundary: maxItems=5, валидация полей</objective>
<precondition>RAG нашел 7 шаблонов</precondition>
<steps>
<step>getTemplates -> ровно 5 объектов</step>
<step>Проверить структуру каждого: id, name, description, conference</step>
<step>UI -> 5 шаблонов в модальном окне</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["getTemplates", "maxItems", "boundary", "schema_validation"]
)

# Пара 9: Детальный просмотр шаблона
vs.add_pair(
    pair_id="PAIR-UI003-T4010",
    requirement_text="""При нажатии на инцидент открывается новая вкладка в браузере с детальной информацией о шаблоне. Метод получения информации: /template/data""",
    test_case_xml="""<testCase key="SBER911-T4010">
<name>W [RAG ТКС] Просмотр детальной информации — новая вкладка</name>
<objective>Проверить открытие новой вкладки через /template/data</objective>
<precondition>Модальное окно открыто, шаблон id 13255</precondition>
<steps>
<step>Кликнуть шаблон -> новая вкладка, /template/data id 13255, HTTP 200</step>
<step>Проверить содержимое -> название, описание, участники, тип конференции</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["template_detail", "new_tab", "template_data"]
)

# Пара 10: Выбор последней записи MAX(created_date)
vs.add_pair(
    pair_id="PAIR-DM001-T4005",
    requirement_text="""Выбирается запись из таблицы incident_tks_template по incidentId. Если записей несколько — возвращается последняя с max(created_date)""",
    test_case_xml="""<testCase key="SBER911-T4005">
<name>W [RAG ТКС] MAX created_date при нескольких записях</name>
<objective>Проверить выбор последней записи из БД</objective>
<precondition>3 записи: id 101 error, id 102 success, id 103 sent (последняя)</precondition>
<steps>
<step>API -> template.reqId = id 103, status sent</step>
<step>БД -> SELECT ORDER BY created_date DESC LIMIT 1 = id 103</step>
<step>UI -> спиннер (соответствует sent)</step>
</steps></testCase>""",
    platform="W",
    feature="INCIDENT_TEMPLATE",
    tags=["data_model", "max_created_date", "multiple_records"]
)

# ============================================================
# Итоговая статистика
# ============================================================
stats = vs.get_stats()
print("\n" + "=" * 50)
print("Загрузка завершена!")
print(f"  Требования:  {stats['requirements']}")
print(f"  Тест-кейсы:  {stats['test_cases']}")
print(f"  Пары:        {stats['pairs']}")
print("=" * 50)

# ============================================================
# Тест поиска по парам
# ============================================================
print("\n--- Тест поиска пар ---")

print("\nЗапрос: 'статус шаблона error, отображение ошибки'")
pairs = vs.find_similar_pairs("статус шаблона error, отображение ошибки", n_results=3)
for p in pairs:
    print(f"  [{p['id']}] dist={p['distance']:.4f}")
    print(f"  Требование: {p['document'][:80]}...")
    print()

print("Запрос: 'максимальное количество шаблонов ограничение'")
pairs = vs.find_similar_pairs("максимальное количество шаблонов ограничение", n_results=3)
for p in pairs:
    print(f"  [{p['id']}] dist={p['distance']:.4f}")
    print(f"  Требование: {p['document'][:80]}...")
    print()

print("Запрос: 'первый запрос на поиск, создание записи в базе'")
pairs = vs.find_similar_pairs("первый запрос на поиск, создание записи в базе", n_results=3)
for p in pairs:
    print(f"  [{p['id']}] dist={p['distance']:.4f}")
    print(f"  Требование: {p['document'][:80]}...")
    print()
