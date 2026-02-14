"""
Специализированные промпты для разных типов требований.
"""

from typing import Dict, List, Optional
from dataclasses import dataclass
import re


@dataclass
class PromptTemplate:
    """Шаблон промпта для типа требования."""
    name: str
    description: str
    keywords: List[str]  # Ключевые слова для автоопределения
    system_additions: str  # Дополнения к системному промпту
    example_steps: str  # Пример шагов для этого типа
    coverage_rules: str  # Правила покрытия


class PromptTemplateManager:
    """Менеджер шаблонов промптов."""
    
    TEMPLATES: Dict[str, PromptTemplate] = {
        "api": PromptTemplate(
            name="API / REST / SOAP",
            description="Тесты для API эндпоинтов",
            keywords=[
                "api", "rest", "soap", "endpoint", "эндпоинт", 
                "запрос", "request", "response", "ответ",
                "get", "post", "put", "delete", "patch",
                "json", "xml", "http", "статус", "status",
                "header", "заголовок", "body", "тело запроса"
            ],
            system_additions="""
СПЕЦИФИКА API-ТЕСТОВ:
1. В testData ОБЯЗАТЕЛЬНО указывай:
   - HTTP метод (GET/POST/PUT/DELETE)
   - URL эндпоинта с параметрами
   - Headers (Authorization, Content-Type)
   - Request body (JSON/XML)
   
2. В expectedResult ОБЯЗАТЕЛЬНО проверяй:
   - HTTP статус код (200, 201, 400, 401, 403, 404, 500)
   - Структуру response body
   - Конкретные значения полей
   - Время ответа (если указано в требованиях)

3. ОБЯЗАТЕЛЬНЫЕ НЕГАТИВНЫЕ КЕЙСЫ:
   - Невалидный токен → 401
   - Нет прав доступа → 403
   - Ресурс не найден → 404
   - Невалидные данные → 400
   - Превышение лимитов → 429
""",
            example_steps="""
<step index="0">
  <description><![CDATA[Подготовка тестовых данных]]></description>
  <testData><![CDATA[
endpoint: POST /api/v1/transactions
headers: {"Authorization": "Bearer {token}", "Content-Type": "application/json"}
body: {"amount": 1000.00, "currency": "RUB", "accountFrom": "40817810000000000001"}
  ]]></testData>
  <expectedResult><![CDATA[Токен получен, данные подготовлены]]></expectedResult>
</step>
<step index="1">
  <description><![CDATA[Отправить POST запрос на создание транзакции]]></description>
  <testData><![CDATA[curl -X POST /api/v1/transactions -H "Authorization: Bearer {token}" -d '{"amount": 1000}']]></testData>
  <expectedResult><![CDATA[<strong>API:</strong>
<ul>
<li>HTTP Status: 201 Created</li>
<li>Response содержит transactionId</li>
<li>Поле status = "PENDING"</li>
</ul>
<strong>БД:</strong>
<ul><li>Запись создана в таблице transactions</li></ul>]]></expectedResult>
</step>
""",
            coverage_rules="""
- Все HTTP методы из требований
- Все статус коды (успех + ошибки)
- Граничные значения параметров
- Пустые/null значения
- Невалидные типы данных
- Авторизация/аутентификация
"""
        ),
        
        "ui": PromptTemplate(
            name="UI / Интерфейс",
            description="Тесты для веб и мобильного интерфейса",
            keywords=[
                "экран", "страница", "кнопка", "поле", "форма",
                "отображается", "показывается", "видно", "ui",
                "интерфейс", "клик", "нажать", "ввести", "выбрать",
                "меню", "модальное окно", "попап", "dropdown",
                "чекбокс", "радиокнопка", "таблица", "список",
                "скролл", "свайп", "тап", "drag", "drop"
            ],
            system_additions="""
СПЕЦИФИКА UI-ТЕСТОВ:
1. В description используй ДЕЙСТВИЯ пользователя:
   - "Нажать кнопку X"
   - "Ввести значение Y в поле Z"
   - "Выбрать пункт меню"
   - "Прокрутить до элемента"

2. В testData указывай:
   - Локаторы элементов (если известны)
   - Вводимые значения
   - Путь навигации

3. В expectedResult РАЗДЕЛЯЙ проверки:
   - Визуальные (что видит пользователь)
   - Функциональные (что происходит)
   - Данные (что сохраняется)

4. ОБЯЗАТЕЛЬНЫЕ ПРОВЕРКИ:
   - Валидация форм (пустые поля, некорректные данные)
   - Состояния кнопок (активна/неактивна)
   - Сообщения об ошибках
   - Успешные уведомления
""",
            example_steps="""
<step index="0">
  <description><![CDATA[Подготовка: авторизоваться в системе]]></description>
  <testData><![CDATA[login: test_user, password: Test123!, URL: /login]]></testData>
  <expectedResult><![CDATA[Пользователь авторизован, главная страница открыта]]></expectedResult>
</step>
<step index="1">
  <description><![CDATA[Открыть форму создания платежа]]></description>
  <testData><![CDATA[Меню → Платежи → Создать новый]]></testData>
  <expectedResult><![CDATA[<strong>UI:</strong>
<ul>
<li>Форма "Новый платёж" отображается</li>
<li>Поля: Получатель, Сумма, Назначение — пустые</li>
<li>Кнопка "Отправить" неактивна</li>
</ul>]]></expectedResult>
</step>
<step index="2">
  <description><![CDATA[Заполнить обязательные поля]]></description>
  <testData><![CDATA[Получатель: "ООО Тест", Сумма: 1000.00, Назначение: "Оплата услуг"]]></testData>
  <expectedResult><![CDATA[<strong>UI:</strong>
<ul>
<li>Поля заполнены введёнными значениями</li>
<li>Кнопка "Отправить" стала активной</li>
<li>Ошибок валидации нет</li>
</ul>]]></expectedResult>
</step>
""",
            coverage_rules="""
- Все элементы интерфейса из требований
- Позитивный сценарий (happy path)
- Валидация каждого поля
- Граничные значения (мин/макс длина)
- Обязательные vs опциональные поля
- Состояния disabled/enabled
- Сообщения об ошибках
"""
        ),
        
        "business_logic": PromptTemplate(
            name="Бизнес-логика",
            description="Тесты бизнес-правил и расчётов",
            keywords=[
                "если", "то", "иначе", "условие", "правило",
                "расчёт", "формула", "процент", "комиссия",
                "лимит", "ограничение", "статус", "переход",
                "workflow", "процесс", "этап", "согласование",
                "проверка", "валидация", "соответствие"
            ],
            system_additions="""
СПЕЦИФИКА БИЗНЕС-ЛОГИКИ:
1. КАЖДОЕ условие if/else = ОТДЕЛЬНЫЙ тест-кейс

2. В testData указывай ВСЕ входные параметры:
   - Значения для расчётов
   - Статусы объектов
   - Роли пользователей
   - Даты и периоды

3. В expectedResult ТОЧНЫЕ значения:
   - Результаты расчётов с числами
   - Итоговые статусы
   - Изменения в данных

4. МАТРИЦА ПОКРЫТИЯ:
   - Все ветвления логики
   - Граничные значения (ровно на границе, ±1)
   - Комбинации условий
   - Исключения из правил
""",
            example_steps="""
<step index="0">
  <description><![CDATA[Подготовка данных для расчёта комиссии]]></description>
  <testData><![CDATA[
Тип клиента: "Premium"
Сумма операции: 100 000.00 RUB
Тариф: "Стандартный"
Правило: если сумма > 50000 и клиент Premium → комиссия 0.5%
  ]]></testData>
  <expectedResult><![CDATA[Данные подготовлены для теста]]></expectedResult>
</step>
<step index="1">
  <description><![CDATA[Выполнить расчёт комиссии]]></description>
  <testData><![CDATA[Вызов: calculateCommission(amount=100000, clientType="Premium")]]></testData>
  <expectedResult><![CDATA[<strong>Расчёт:</strong>
<ul>
<li>Комиссия = 100000 × 0.5% = 500.00 RUB</li>
<li>Применено правило: "Premium клиент, сумма > 50000"</li>
</ul>
<strong>БД:</strong>
<ul><li>Запись в commission_log с amount=500.00</li></ul>]]></expectedResult>
</step>
""",
            coverage_rules="""
- Каждая ветка if/else/switch
- Граничные значения числовых условий
- Все комбинации булевых условий
- Переходы между статусами
- Расчёты с проверкой точности
"""
        ),
        
        "integration": PromptTemplate(
            name="Интеграции",
            description="Тесты межсистемного взаимодействия",
            keywords=[
                "интеграция", "внешняя система", "сервис",
                "очередь", "kafka", "rabbitmq", "mq",
                "синхронизация", "обмен данными", "esb",
                "callback", "webhook", "notification",
                "асинхронный", "событие", "event"
            ],
            system_additions="""
СПЕЦИФИКА ИНТЕГРАЦИОННЫХ ТЕСТОВ:
1. УКАЗЫВАЙ системы-участники:
   - Источник данных
   - Получатель
   - Посредники (ESB, очереди)

2. В testData:
   - Формат сообщения (JSON/XML/Protobuf)
   - Топик/очередь
   - Correlation ID
   - Таймауты

3. ОБЯЗАТЕЛЬНЫЕ СЦЕНАРИИ:
   - Успешная доставка
   - Таймаут ответа
   - Недоступность внешней системы
   - Повторная отправка (retry)
   - Дубликаты сообщений
   - Некорректный формат данных

4. ПРОВЕРКИ:
   - Идемпотентность
   - Порядок сообщений
   - Транзакционность
""",
            example_steps="""
<step index="0">
  <description><![CDATA[Подготовка: настроить мок внешней системы]]></description>
  <testData><![CDATA[
Mock URL: http://mock-service:8080/api/external
Expected request: POST /process
Response: {"status": "OK", "processId": "12345"}
Delay: 100ms
  ]]></testData>
  <expectedResult><![CDATA[Мок сконфигурирован и доступен]]></expectedResult>
</step>
<step index="1">
  <description><![CDATA[Инициировать отправку данных во внешнюю систему]]></description>
  <testData><![CDATA[
Сообщение в Kafka топик: "outbound-events"
Payload: {"eventType": "ORDER_CREATED", "orderId": "ORD-001"}
  ]]></testData>
  <expectedResult><![CDATA[<strong>Kafka:</strong>
<ul><li>Сообщение отправлено в топик</li></ul>
<strong>Внешняя система:</strong>
<ul><li>Получен POST запрос с корректным payload</li></ul>
<strong>БД:</strong>
<ul><li>Статус интеграции = "SENT"</li></ul>]]></expectedResult>
</step>
""",
            coverage_rules="""
- Успешный обмен данными
- Все типы событий/сообщений
- Ошибки сети (таймаут, недоступность)
- Ошибки данных (невалидный формат)
- Retry логика
- Идемпотентность
"""
        ),
        
        "security": PromptTemplate(
            name="Безопасность",
            description="Тесты безопасности и авторизации",
            keywords=[
                "авторизация", "аутентификация", "доступ", "права",
                "роль", "permission", "токен", "jwt", "oauth",
                "пароль", "логин", "сессия", "безопасность",
                "шифрование", "encryption", "xss", "sql injection",
                "csrf", "уязвимость"
            ],
            system_additions="""
СПЕЦИФИКА SECURITY-ТЕСТОВ:
1. ПРОВЕРКИ АВТОРИЗАЦИИ:
   - Без токена → 401
   - Невалидный токен → 401
   - Истёкший токен → 401
   - Нет прав на ресурс → 403

2. ПРОВЕРКИ ПО РОЛЯМ:
   - Каждая роль = отдельные тесты
   - Матрица: роль × действие → разрешено/запрещено

3. НЕГАТИВНЫЕ СЦЕНАРИИ:
   - SQL injection в параметрах
   - XSS в текстовых полях
   - Path traversal
   - Brute force (блокировка после N попыток)

4. ДАННЫЕ:
   - Маскирование чувствительных данных в логах
   - Шифрование при передаче/хранении
""",
            example_steps="""
<step index="0">
  <description><![CDATA[Подготовка: создать пользователей с разными ролями]]></description>
  <testData><![CDATA[
user_admin: role=ADMIN, token=token_admin
user_manager: role=MANAGER, token=token_manager  
user_viewer: role=VIEWER, token=token_viewer
  ]]></testData>
  <expectedResult><![CDATA[Пользователи созданы, токены получены]]></expectedResult>
</step>
<step index="1">
  <description><![CDATA[Попытка удаления записи с ролью VIEWER]]></description>
  <testData><![CDATA[
DELETE /api/v1/records/123
Authorization: Bearer {token_viewer}
  ]]></testData>
  <expectedResult><![CDATA[<strong>API:</strong>
<ul>
<li>HTTP Status: 403 Forbidden</li>
<li>Response: {"error": "Access denied", "required_role": "ADMIN"}</li>
</ul>
<strong>БД:</strong>
<ul><li>Запись НЕ удалена</li></ul>
<strong>Логи:</strong>
<ul><li>Зафиксирована попытка несанкционированного доступа</li></ul>]]></expectedResult>
</step>
""",
            coverage_rules="""
- Все роли × все действия
- Аутентификация (валидный/невалидный/без токена)
- Авторизация (есть права/нет прав)
- Injection атаки (SQL, XSS, LDAP)
- Лимиты и блокировки
- Маскирование данных
"""
        )
    }
    
    @classmethod
    def detect_type(cls, requirement: str) -> List[str]:
        """Определяет типы требования по ключевым словам."""
        requirement_lower = requirement.lower()
        detected = []
        
        scores = {}
        for type_id, template in cls.TEMPLATES.items():
            score = sum(1 for kw in template.keywords if kw.lower() in requirement_lower)
            if score > 0:
                scores[type_id] = score
        
        # Сортируем по score и берём топ
        sorted_types = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        
        # Берём типы с score >= 2 или топ-2
        for type_id, score in sorted_types[:2]:
            if score >= 2 or len(detected) < 1:
                detected.append(type_id)
        
        # Если ничего не нашли — возвращаем business_logic как дефолт
        return detected if detected else ["business_logic"]
    
    @classmethod
    def get_enhanced_prompt(cls, requirement: str, detected_types: Optional[List[str]] = None) -> str:
        """Формирует расширенный промпт на основе типов требования."""
        if detected_types is None:
            detected_types = cls.detect_type(requirement)
        
        additions = []
        examples = []
        rules = []
        
        for type_id in detected_types:
            if type_id in cls.TEMPLATES:
                template = cls.TEMPLATES[type_id]
                additions.append(f"\n### {template.name}\n{template.system_additions}")
                examples.append(f"\n<!-- Пример для {template.name} -->\n{template.example_steps}")
                rules.append(f"\n**{template.name}:**\n{template.coverage_rules}")
        
        enhanced = "\n".join(additions)
        enhanced += "\n\nПРИМЕРЫ ШАГОВ:" + "\n".join(examples)
        enhanced += "\n\nПРАВИЛА ПОКРЫТИЯ:" + "\n".join(rules)
        
        return enhanced
    
    @classmethod
    def get_template_names(cls) -> Dict[str, str]:
        """Возвращает словарь id → название для UI."""
        return {tid: t.name for tid, t in cls.TEMPLATES.items()}


# Для тестирования
if __name__ == "__main__":
    test_req = """
    API должен принимать POST запрос на /api/v1/payments
    В теле запроса JSON с полями: amount, currency, recipient
    При успехе возвращать 201 и paymentId
    При ошибке валидации - 400
    """
    
    types = PromptTemplateManager.detect_type(test_req)
    print(f"Detected types: {types}")
    
    prompt = PromptTemplateManager.get_enhanced_prompt(test_req)
    print(f"Enhanced prompt preview:\n{prompt[:500]}...")
