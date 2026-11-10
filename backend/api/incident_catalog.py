"""
Каталог «Генератора инцидентов»: услуги (КЭ), на которые регистрируем тестовые инциденты, и ~20 сценариев событий —
по образцам реальных инцидентов (без людей и телефонов: везде «Уточняется»). Сценарий для каждого инцидента
выбирается случайно; время в тексте — момент отправки.

Три вида событий:
  • monitoring — авто-инцидент от мониторинга (Zabbix): один хост, несколько хостов кластера, все узлы,
                 «хост не определён» (сработал групповой триггер), БД, Kafka, сертификат, сеть;
  • manual     — обращение пользователя, зарегистрированное вручную: свои тексты на каждую услугу, плюс
                 «не работает у всех» и «жалобы разные — непонятно, что сломалось»;
  • alert      — алерт системы мониторинга (Рефлекс): первичный анализ, корневая причина, отклонения, рекомендации.
У каждого события — заголовок, текст описания и инструкция (Markdown) для «с инструкцией».

КЭ: три встроенные (SERVICES) и свои — команда добавляет их в интерфейсе (data/incident_gen.json, ключ services).
У КЭ отмечено, есть ли на стенде логи и метрики: от этого зависят проверки «без логов» / «без метрик» из ноутбука
test_incident_pakage_generator.ipynb — сам инцидент этого не задаёт, задаёт выбор КЭ.

Сценарии (SCENARIOS, 15) — готовые наборы: какие события брать, приоритет, нужна ли инструкция, сколько других
инцидентов на АС зарегистрировать рядом, «массовый» и «потенциальный ВПИ». Покрывают сочетания ноутбука
(инструкция × другие инциденты на АС) и добавляют виды событий: один хост, кластер, хост не определён, массовый,
БД, обращения, алерты Рефлекса, ВПИ, сеть и сертификаты.
"""

from __future__ import annotations

import random
import re
from datetime import datetime, timedelta
from typing import Optional

SERVICES: list[dict] = [
    {"ci": "CI02302514", "name": "ПКАП анализ состояния клиента корпоративного бизнеса", "crit": "Business Critical",
     "hosts": ["pvlsb-pkap0012", "pvlsb-pkap0014", "pvlsb-pkap0021", "pvlsb-pkap0027"], "app": "paonlineng", "db": "pkap_core",
     "topic": "pkap.client-state", "logs": None, "metrics": None},
    {"ci": "CI00233293", "name": "Sber911", "crit": "Business Critical",
     "hosts": ["pvlsb-s911app03", "pvlsb-s911app07", "pvlsb-s911gw02", "pvlsb-s911app11"], "app": "sber911-incident-card",
     "db": "sber911", "topic": "sber911.incidents", "logs": True, "metrics": True},
    {"ci": "CI00641491", "name": "ППРБ ФЛ Платформа", "crit": "Mission Critical",
     "hosts": ["pvlsb-pprbfl0105", "pvlsb-pprbfl0118", "pvlsb-pprbfl0122", "pvlsb-pprbfl0131"], "app": "pprb-fl-gateway",
     "db": "pprb_fl", "topic": "pprb.fl.payments", "logs": False, "metrics": True},
]

# ── Мониторинг (Zabbix) ──────────────────────────────────────────────────────
# scope: one — один хост, many — несколько хостов кластера, all — все узлы услуги, unknown — групповой триггер,
# хост не определён. В problem подставляются {db} {topic} {lag} {days} {ms}.
MONITORING = [
    {"id": "cpu", "scope": "one", "title": "Утилизация CPU выше 80 %", "trigger": "CPU_UTIL_80",
     "problem": "На БН зафиксировано превышение порога 80 % утилизации CPU",
     "steps": ["Проверить загрузку CPU на хосте и процессы-лидеры.", "Сверить с нагрузкой приложения и регламентными заданиями.",
               "При устойчивой нагрузке — вывести узел из балансировки и перезапустить по регламенту."]},
    {"id": "cpu-cluster", "scope": "many", "title": "Утилизация CPU выше 90 % на нескольких узлах кластера", "trigger": "CPU_UTIL_90_CLUSTER",
     "problem": "Превышение порога 90 % утилизации CPU одновременно на нескольких узлах кластера",
     "steps": ["Сравнить нагрузку по узлам: равномерная ли балансировка.", "Проверить, не запущено ли тяжёлое регламентное задание на всех узлах.",
               "При росте входящего трафика — согласовать ограничение нагрузки или масштабирование."]},
    {"id": "disk", "scope": "one", "title": "Заполнение /var более 90 %", "trigger": "FS_VAR_90",
     "problem": "Свободного места на /var меньше 10 %",
     "steps": ["Найти крупные файлы на /var.", "Очистить или заархивировать старые логи по регламенту ротации.", "Проверить настройки logrotate."]},
    {"id": "memory", "scope": "one", "title": "Нехватка оперативной памяти, активный swap", "trigger": "MEM_SWAP_USED",
     "problem": "Свободной памяти меньше 5 %, использование swap выше 60 %",
     "steps": ["Найти процессы с наибольшим потреблением памяти.", "Проверить настройки heap приложения.", "Перезапустить узел по регламенту при деградации."]},
    {"id": "health", "scope": "one", "title": "Не отвечает проверка работоспособности приложения", "trigger": "APP_HEALTH_DOWN",
     "problem": "Health-check приложения не отвечает 3 раза подряд (HTTP 503)",
     "steps": ["Проверить статус процесса/пода и последние перезапуски.", "Посмотреть логи старта и подключения к БД.",
               "Перезапустить узел; не поднимается — эскалировать на сопровождение платформы."]},
    {"id": "all-down", "scope": "all", "title": "Недоступны все узлы приложения", "trigger": "APP_ALL_NODES_DOWN",
     "problem": "Все узлы приложения не отвечают на проверку работоспособности, услуга недоступна полностью",
     "steps": ["Объявить массовый инцидент по регламенту.", "Проверить балансировщик, сеть и общие зависимости (БД, Kafka, СУДИР).",
               "Проверить последние изменения: релизы, конфигурации, сертификаты.", "Собрать штаб сопровождения и смежных команд."]},
    {"id": "unreachable", "scope": "many", "title": "Хосты недоступны по сети (ping)", "trigger": "ICMP_PING_LOSS",
     "problem": "Потеря ICMP-пакетов 100 % в течение 5 минут",
     "steps": ["Проверить доступность хостов с соседних серверов и из другого ЦОД.", "Запросить у сетевой команды состояние коммутаторов сегмента.",
               "Проверить, не проводятся ли регламентные работы в ЦОД."]},
    {"id": "unknown-host", "scope": "unknown", "title": "Сработал групповой триггер, хост не определён", "trigger": "GROUP_AVAILABILITY",
     "problem": "Доступность группы хостов ниже 70 %; конкретный хост в событии не указан",
     "steps": ["Открыть в мониторинге состав группы и найти узлы в статусе PROBLEM.", "Проверить, не изменился ли состав группы после последних работ.",
               "Если узлы не находятся — эскалировать на команду мониторинга для разбора триггера."]},
    {"id": "db-pool", "scope": "one", "title": "Исчерпан пул соединений к БД", "trigger": "DB_POOL_EXHAUSTED",
     "problem": "Активных соединений к БД {db} 100 % от размера пула, запросы ждут в очереди",
     "steps": ["Проверить долгие транзакции и блокировки в БД.", "Посмотреть утечку соединений в логах приложения.", "Временно увеличить пул или перезапустить узел."]},
    {"id": "kafka-lag", "scope": "unknown", "title": "Растёт отставание чтения из Kafka", "trigger": "KAFKA_CONSUMER_LAG",
     "problem": "Отставание группы потребителей топика {topic} — {lag} сообщений и растёт",
     "steps": ["Проверить, живы ли все потребители группы.", "Посмотреть ошибки обработки сообщений в логах.", "Проверить, не выросла ли входящая нагрузка на топик."]},
    {"id": "cert", "scope": "one", "title": "Истекает сертификат TLS", "trigger": "TLS_CERT_EXPIRE",
     "problem": "Сертификат TLS истекает через {days} дн.",
     "steps": ["Найти сертификат и его владельца.", "Заказать перевыпуск по регламенту.", "Запланировать замену в окно работ."]},
    {"id": "net-latency", "scope": "many", "title": "Рост сетевой задержки между ЦОД", "trigger": "NET_RTT_HIGH",
     "problem": "Сетевая задержка между узлами в разных ЦОД — {ms} мс (норма до 5 мс)",
     "steps": ["Проверить маршрут и потери между ЦОД.", "Уточнить у сетевой команды плановые работы.", "Временно перевести трафик на один ЦОД, если деградация критична."]},
]

# ── Обращения пользователей ──────────────────────────────────────────────────
MANUAL = {
    "CI02302514": [
        {"id": "card", "title": "Не открывается карточка клиента КБ",
         "text": "При открытии карточки клиента корпоративного бизнеса вечный индикатор загрузки, данные анализа состояния не отображаются. Воспроизводится у нескольких сотрудников отделения."},
        {"id": "score", "title": "Неверный расчёт показателя состояния клиента",
         "text": "Показатель финансового состояния клиента не пересчитывается после загрузки свежей отчётности, в карточке остаются данные за прошлый квартал."},
        {"id": "export", "title": "Ошибка при выгрузке отчёта в Excel",
         "text": "При выгрузке отчёта по портфелю клиентов в Excel появляется сообщение «Внутренняя ошибка сервера», файл не формируется."},
    ],
    "CI00233293": [
        {"id": "card", "title": "Карточка инцидента не сохраняется",
         "text": "Дежурный не может сохранить карточку инцидента: после нажатия «Сохранить» ошибка 500, введённые данные пропадают."},
        {"id": "list", "title": "Долго грузится список инцидентов",
         "text": "Список инцидентов дежурной смены загружается больше минуты, фильтр по статусу не применяется."},
        {"id": "notify", "title": "Не приходят уведомления о новых инцидентах",
         "text": "Дежурным не приходят push- и e-mail уведомления о новых инцидентах, в журнале уведомлений записей нет."},
    ],
    "CI00641491": [
        {"id": "login", "title": "Не выполняется вход клиентов в приложение",
         "text": "Клиенты физических лиц получают ошибку при входе в приложение, доля неуспешных входов растёт."},
        {"id": "pay", "title": "Платёж висит в статусе «В обработке»",
         "text": "Платежи клиентов ФЛ остаются в статусе «В обработке» более 30 минут, повторная отправка недоступна."},
        {"id": "history", "title": "Не отображается история операций",
         "text": "В разделе «История операций» у клиентов пустой список, при обновлении — сообщение «Сервис временно недоступен»."},
    ],
}
MANUAL_COMMON = [
    {"id": "outage", "title": "Не работает у всех пользователей",
     "text": "Услуга «{name}» недоступна у всех пользователей: страница не открывается, массовые обращения из разных подразделений."},
    {"id": "unclear", "title": "Жалобы разные — непонятно, что сломалось",
     "text": "Поступают обращения из разных подразделений с разными симптомами (медленная работа, ошибки при сохранении, пустые списки). Какие серверы и компоненты затронуты — не установлено."},
]
# Обращения для КЭ без своих текстов (свои КЭ): общие формулировки с названием услуги.
MANUAL_GENERIC = [
    {"id": "error", "title": "Ошибка при выполнении операции",
     "text": "В услуге «{name}» при выполнении операции появляется сообщение «Внутренняя ошибка сервера», операция не выполняется. Воспроизводится у нескольких сотрудников."},
    {"id": "slow", "title": "Медленно открываются экраны",
     "text": "Экраны услуги «{name}» открываются больше минуты, часть запросов завершается по таймауту."},
    {"id": "data", "title": "Не отображаются данные",
     "text": "В услуге «{name}» пустые списки и карточки: данные не подгружаются, при обновлении страницы — «Сервис временно недоступен»."},
]
MANUAL_STEPS = ["Уточнить у обратившегося время, объект и скриншот ошибки.", "Найти запрос в логах приложения по времени обращения.",
                "Проверить статусы связанных сервисов и последние релизы.", "Передать на 2-ю линию сопровождения с собранными данными."]

# ── Алерты (Рефлекс) ─────────────────────────────────────────────────────────
ALERT = [
    {"id": "heap", "title": "Высокое использование heap JVM", "level": "PERFORMANCE",
     "cause": "Высокое использование heap JVM {app}",
     "deviation": "Heap JVM воркера {app} = {value} байт (порог 480 MB). Возможна нехватка памяти.",
     "factors": "переполнение памяти JVM, утечка памяти, неэффективное управление памятью приложением",
     "external": "высокая нагрузка на приложение, недостаточная конфигурация ресурсов JVM",
     "actions": "анализ логов приложения, проверка настроек JVM, мониторинг использования памяти"},
    {"id": "errors", "title": "Рост доли ошибок HTTP 5xx", "level": "ERROR",
     "cause": "Рост доли ответов HTTP 5xx сервиса {app}",
     "deviation": "Доля ответов 5xx = {pct} % (базовая линия 0.3 %), отклонение +{dev} %.",
     "factors": "ошибки приложения после релиза, недоступность зависимого сервиса, исчерпание пула соединений к БД",
     "external": "рост нагрузки, деградация сети между ЦОД",
     "actions": "анализ логов и трассировок запросов с ошибкой, проверка зависимостей, откат последнего релиза при необходимости"},
    {"id": "latency", "title": "Рост времени ответа сервиса", "level": "PERFORMANCE",
     "cause": "Рост времени ответа {app}",
     "deviation": "95-й перцентиль времени ответа = {ms} мс (базовая линия 350 мс), отклонение +{dev} %.",
     "factors": "медленные запросы к БД {db}, блокировки, нехватка CPU",
     "external": "пиковая нагрузка, регламентные работы смежных систем",
     "actions": "анализ медленных запросов, проверка планов выполнения и блокировок в БД, проверка утилизации ресурсов"},
    {"id": "db-down", "title": "Недоступна база данных", "level": "AVAILABILITY",
     "cause": "Недоступна БД {db}: приложение {app} не получает соединения",
     "deviation": "Доля успешных подключений к БД = 0 % (базовая линия 100 %).",
     "factors": "остановка или переключение кластера БД, исчерпание соединений, проблемы с сетью до БД",
     "external": "регламентные работы на кластере БД, сбой хранилища",
     "actions": "проверка состояния кластера БД, проверка переключения на реплику, проверка сетевой доступности"},
    {"id": "multi", "title": "Деградация нескольких компонентов одновременно", "level": "ERROR",
     "cause": "Одновременная деградация нескольких компонентов {app}; общий источник не определён",
     "deviation": "Ошибки выросли у {n} компонентов из {total}, время ответа +{dev} %.",
     "factors": "общая зависимость (БД, Kafka, СУДИР), сеть, конфигурация, выкатка на все узлы",
     "external": "работы в ЦОД, сбой смежной платформы",
     "actions": "поиск общей зависимости по трассировкам, проверка последних изменений, сбор штаба смежных команд"},
]


CI_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$")
CRITS = ["Mission Critical", "Business Critical", "Business Operational", "Office Productivity"]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "app"


def normalize_service(d: dict) -> dict:
    """Своя КЭ: пустые поля — разумные значения, чтобы тексты событий собирались (хосты, приложение, БД, топик)."""
    ci = str(d.get("ci") or "").strip()
    name = str(d.get("name") or "").strip() or ci
    app = _slug(str(d.get("app") or "").strip() or ci)
    hosts = [h.strip() for h in (d.get("hosts") or []) if str(h).strip()][:12]
    if not hosts:
        short = re.sub(r"[^a-z0-9]", "", app)[:10] or "app"
        hosts = [f"pvlsb-{short}{n:02d}" for n in (1, 2, 3, 4)]

    def flag(v):
        return None if v is None else bool(v)
    return {"ci": ci, "name": name, "crit": d.get("crit") if d.get("crit") in CRITS else "Business Critical",
            "hosts": hosts, "app": app, "db": str(d.get("db") or "").strip() or app.replace("-", "_"),
            "topic": str(d.get("topic") or "").strip() or f"{app}.events",
            "logs": flag(d.get("logs")), "metrics": flag(d.get("metrics"))}


def custom_services() -> list[dict]:
    from db import incident_gen_store as store
    return [normalize_service(x) for x in store.read().get("services") or []]


def all_services() -> list[dict]:
    """Встроенные и свои КЭ; у своих — custom: True."""
    builtin = {s["ci"] for s in SERVICES}
    return [{**s, "custom": False} for s in SERVICES] + [
        {**s, "custom": True} for s in custom_services() if s["ci"] not in builtin]


def service(ci: str) -> dict:
    for s in all_services():
        if s["ci"] == ci:
            return s
    raise KeyError(ci)


def manual_pool(ci: str) -> list[dict]:
    """Обращения услуги: свои тексты (у встроенных КЭ) или общие, плюс «не работает у всех» и «непонятно, что сломалось»."""
    return MANUAL.get(ci) or MANUAL_GENERIC


def scenarios(ci: str) -> list[tuple[str, str, str]]:
    """Все события для услуги: [(вид, id, заголовок)] — из них при отправке выбирается случайный."""
    service(ci)
    return ([("monitoring", m["id"], m["title"]) for m in MONITORING]
            + [("manual", m["id"], m["title"]) for m in manual_pool(ci) + MANUAL_COMMON]
            + [("alert", a["id"], a["title"]) for a in ALERT])


# ── Сценарии ─────────────────────────────────────────────────────────────────
# events — из каких событий выбирается случайное для основного инцидента:
#   "monitoring:*" — любое событие мониторинга, "monitoring:cpu" — конкретное, "monitoring@one|many|all|unknown" — по
#   масштабу; "manual:own" — обращения по услуге, "manual:outage" / "manual:unclear"; "alert:*", "alert:heap" и т.д.
# extra — сколько других инцидентов на ту же АС зарегистрировать рядом (случайно от–до, раньше основного, без инструкции).
# notebook — какой сценарий test_sc.json это покрывает (для сверки).

SCENARIOS: list[dict] = [
    {"id": "full", "name": "Полный набор данных", "icon": "layers",
     "short": "Инцидент с инструкцией и другими инцидентами на АС — всё, что нужно для разбора.",
     "events": ["monitoring:*", "alert:*"], "priority": "MEDIUM", "instruction": True, "extra": [1, 5], "notebook": "all"},
    {"id": "no-instruction", "name": "Без инструкции", "icon": "file-x",
     "short": "Инструкции нет, другие инциденты на АС есть: проверка, что разбор идёт без неё.",
     "events": ["monitoring:*", "alert:*"], "priority": "MEDIUM", "instruction": False, "extra": [1, 5], "notebook": "no-instruction"},
    {"id": "alone", "name": "Единственный инцидент на АС", "icon": "circle-dot",
     "short": "С инструкцией, но других инцидентов по услуге нет — история пустая.",
     "events": ["monitoring:*", "alert:*"], "priority": "MEDIUM", "instruction": True, "extra": [0, 0], "notebook": "no-add_inc"},
    {"id": "bare", "name": "Только инцидент", "icon": "file",
     "short": "Ни инструкции, ни других инцидентов: минимум данных.",
     "events": ["monitoring:*", "alert:*"], "priority": "MEDIUM", "instruction": False, "extra": [0, 0],
     "notebook": "no-instruction-add_inc"},
    {"id": "storm", "name": "Серия инцидентов на АС", "icon": "repeat",
     "short": "Основной и 5–10 похожих инцидентов по той же услуге за последние часы.",
     "events": ["monitoring@one", "monitoring@many"], "priority": "HIGH", "instruction": True, "extra": [5, 10]},
    {"id": "one-host", "name": "Сбой одного хоста", "icon": "server",
     "short": "CPU, диск, память или health-check на одном узле.",
     "events": ["monitoring@one"], "priority": "HIGH", "instruction": True, "extra": [0, 2]},
    {"id": "cluster", "name": "Несколько узлов кластера", "icon": "network",
     "short": "Проблема сразу на 2–3 хостах: CPU кластера, сеть, задержка между ЦОД.",
     "events": ["monitoring@many"], "priority": "HIGH", "instruction": True, "extra": [1, 3]},
    {"id": "unknown-host", "name": "Хост не определён", "icon": "help-circle",
     "short": "Сработал групповой триггер или отставание Kafka — конкретный узел не указан.",
     "events": ["monitoring@unknown"], "priority": "MEDIUM", "instruction": True, "extra": [0, 2]},
    {"id": "mass", "name": "Массовый: услуга недоступна", "icon": "siren",
     "short": "Недоступны все узлы, массовые обращения. Признак «массовый», критичный приоритет.",
     "events": ["monitoring:all-down", "manual:outage"], "priority": "CRITICAL", "instruction": True, "extra": [3, 6],
     "large_scale": True},
    {"id": "database", "name": "Проблемы с базой данных", "icon": "database",
     "short": "Исчерпан пул соединений или БД недоступна.",
     "events": ["monitoring:db-pool", "alert:db-down"], "priority": "HIGH", "instruction": True, "extra": [1, 3]},
    {"id": "user", "name": "Обращение пользователя", "icon": "user-round",
     "short": "Сотрудник сообщил об ошибке — зарегистрировано вручную.",
     "events": ["manual:own"], "priority": "MEDIUM", "instruction": True, "extra": [0, 1]},
    {"id": "unclear", "name": "Непонятные жалобы", "icon": "message-circle-question",
     "short": "Разные симптомы из разных подразделений, что сломалось — не ясно. Без инструкции.",
     "events": ["manual:unclear"], "priority": "MEDIUM", "instruction": False, "extra": [1, 3]},
    {"id": "alert", "name": "Алерт Рефлекса", "icon": "bell-ring",
     "short": "Алерт с первичным анализом: корневая причина, отклонения, рекомендации.",
     "events": ["alert:*"], "priority": "HIGH", "instruction": True, "extra": [0, 2]},
    {"id": "vpi", "name": "Потенциальный ВПИ", "icon": "trending-up",
     "short": "Рост ошибок или времени ответа — отмечен как потенциально влияющий на клиентов.",
     "events": ["alert:errors", "alert:latency", "alert:multi"], "priority": "HIGH", "instruction": True, "extra": [1, 3],
     "potential_vpi": True},
    {"id": "infra", "name": "Сеть и сертификаты", "icon": "shield-alert",
     "short": "Потеря пакетов, задержка между ЦОД, истекающий сертификат TLS.",
     "events": ["monitoring:unreachable", "monitoring:net-latency", "monitoring:cert"], "priority": "LOW",
     "instruction": True, "extra": [0, 1]},
]


def scenario(sid: str) -> dict:
    for sc in SCENARIOS:
        if sc["id"] == sid:
            return sc
    raise KeyError(sid)


def pool(ci: str, events: list[str]) -> list[tuple[str, str]]:
    """События сценария для услуги: [(вид, вариант)]. Пустой список — все события услуги."""
    if not events:
        return [(k, v) for k, v, _ in scenarios(ci)]
    out: list[tuple[str, str]] = []
    for token in events:
        kind, _, rest = token.partition(":")
        if "@" in kind:
            kind, scope = kind.split("@", 1)
            out += [(kind, m["id"]) for m in MONITORING if m["scope"] == scope]
        elif kind == "monitoring":
            out += [(kind, m["id"]) for m in MONITORING if rest in ("*", m["id"])]
        elif kind == "alert":
            out += [(kind, a["id"]) for a in ALERT if rest in ("*", a["id"])]
        elif kind == "manual":
            items = manual_pool(ci) if rest == "own" else (manual_pool(ci) + MANUAL_COMMON if rest == "*"
                                                            else [m for m in MANUAL_COMMON if m["id"] == rest])
            out += [(kind, m["id"]) for m in items]
    if not out:
        raise KeyError(",".join(events))
    return list(dict.fromkeys(out))


def catalog() -> dict:
    return {"services": all_services(),
            "scenarios": [{k: sc.get(k) for k in ("id", "name", "icon", "short", "events", "priority", "instruction",
                                                  "extra", "notebook")}
                          | {"large_scale": bool(sc.get("large_scale")), "potential_vpi": bool(sc.get("potential_vpi"))}
                          for sc in SCENARIOS],
            "events": len(scenarios(SERVICES[0]["ci"])), "crits": CRITS}


def _header(svc: dict, now: datetime, inner: str, auto: bool) -> str:
    return (f"Зарегистрирован: {now.strftime('%d.%m.%Y')} в {now.strftime('%H:%M')}\n"
            f"Наименование услуги: {svc['name']} ({svc['ci']})\n"
            f"Критичность АС: {svc['crit']}\n"
            "Класс среды: Промышленная эксплуатация\n"
            "Категория: Автоматизированная система\n"
            f"Описание: {inner}\n"
            f"Способ определения приоритета: {'Автоматически' if auto else 'Вручную'}\n"
            "Менеджер ИТ-услуги: Уточняется\n"
            "Назначено группе: Уточняется\n"
            "Назначено исполнителю: Уточняется\n"
            f"Обратился: {'Централизованная система инфраструктурного мониторинга' if auto else 'Уточняется'}")


def _steps(title: str, steps: list[str]) -> str:
    return "# Найденные варианты\n## Вариант 1\n### Описание\n" + title + "\n\n### Шаги\n" + "\n".join(
        f"{i}. {s}" for i, s in enumerate(steps, 1))


def _fill(svc: dict, rng: random.Random) -> dict:
    return {"app": svc["app"], "db": svc["db"], "topic": svc["topic"], "name": svc["name"],
            "value": rng.randint(500, 900) * 1024 * 1024, "pct": round(rng.uniform(4, 18), 1), "dev": rng.randint(150, 900),
            "ms": rng.randint(1200, 4800), "lag": rng.randint(50_000, 900_000), "days": rng.randint(2, 9),
            "n": rng.randint(3, 6), "total": rng.randint(7, 12)}


def render(ci: str, kind: str = "", variant: str = "", now: Optional[datetime] = None, rng: Optional[random.Random] = None) -> dict:
    """
    Событие для инцидента: {kind, variant, title, description, instruction}. Без kind — случайный сценарий из всех.
    Неизвестная услуга, вид или вариант — KeyError.
    """
    rng = rng or random.Random()
    now = now or datetime.now()
    svc = service(ci)
    if not kind:
        kind, variant, _ = rng.choice(scenarios(ci))
    f = _fill(svc, rng)
    if kind == "monitoring":
        v = next((x for x in MONITORING if x["id"] == variant), None) if variant else rng.choice(MONITORING)
        if v is None:
            raise KeyError(variant)
        hosts = {"one": [rng.choice(svc["hosts"])], "many": rng.sample(svc["hosts"], rng.randint(2, 3)),
                 "all": list(svc["hosts"]), "unknown": []}[v["scope"]]
        where = ", ".join(hosts) if hosts else "не определён"
        group = f"{v['trigger']}_{svc['app'].upper().replace('-', '_')}"
        prev = "\n".join(f"IM{rng.randint(300_000_000, 319_999_999):010d} "
                         f"{(now - timedelta(days=d, seconds=rng.randint(0, 86399))).strftime('%d.%m.%Y %H:%M:%S')}"
                         for d in sorted(rng.sample(range(3, 90), 3)))
        inner = (f"Инцидент по группе хостов {group}/{hosts[0] if len(hosts) == 1 else group.lower()}[{svc['ci']}]\n"
                 f"Проблема: {where} Промышленный - TRUE. {v['problem'].format(**f)}; High;\n"
                 "Уровень важности: высокий\n"
                 "ZABBIX сервер: Zabbix Sigma\n"
                 f"{'Хост' if len(hosts) <= 1 else 'Хосты'}: {where}\n"
                 f"Время: {now.strftime('%Y.%m.%d %H:%M:%S')}\n"
                 f"rule_id: {rng.randint(100000, 109999)}\n"
                 f"Предыдущие инциденты по группе хостов:\n{prev}\n"
                 "Отправитель: Централизованная система инфраструктурного мониторинга (CI01099976)")
        title = v["title"] + (f" — {hosts[0]}" if len(hosts) == 1 else f" — узлов: {len(hosts)}" if hosts else "")
        return {"kind": kind, "variant": v["id"], "title": title, "description": _header(svc, now, inner, True),
                "instruction": _steps(f"{v['title']} ({svc['name']}; хосты: {where}).", v["steps"])}
    if kind == "manual":
        items = manual_pool(ci) + MANUAL_COMMON
        v = next((x for x in items if x["id"] == variant), None) if variant else rng.choice(items)
        if v is None:
            raise KeyError(variant)
        text = v["text"].format(**f)
        return {"kind": kind, "variant": v["id"], "title": v["title"], "description": _header(svc, now, text, False),
                "instruction": _steps(text, MANUAL_STEPS)}
    if kind == "alert":
        v = next((x for x in ALERT if x["id"] == variant), None) if variant else rng.choice(ALERT)
        if v is None:
            raise KeyError(variant)
        pod = f"{svc['app']}-{rng.getrandbits(36):09x}-" + "".join(rng.choice("bcdfghjklmnpqrstvwxz2456789") for _ in range(5))
        number = f"P-{rng.randint(260_000_000, 269_999_999)}"
        cause = v["cause"].format(**f)
        inner = ("Алерт от системы мониторинга. Первичный анализ\n"
                 "Ключевые характеристики алерта\n"
                 f"Основная КЭ алерта: {svc['ci']}\n"
                 f"Номер алерта: {number}\n"
                 "Статус проблемы: OPEN\n"
                 f"Уровень алерта: {v['level']}\n"
                 f"Время регистрации и время закрытия алерта: {now.strftime('%H:%M')} (MSK) {now.strftime('%d.%m.%Y')} (алерт ещё не закрыт)\n"
                 f"Затронутые ИТ-услуги: {svc['ci']}\n"
                 f"Затронутые компоненты инфраструктуры: ru.sbrf.dcm.Application {svc['app']}-* ({pod})\n"
                 f"Корневая причина проблемы: {cause}\n"
                 f"Отклонения по базовым линиям: {v['deviation'].format(**f)}\n"
                 "Ссылка на алерт в АС Рефлекс\n"
                 "Потенциальные причины проблемы\n"
                 f"Возможные технические факторы: {v['factors'].format(**f)}\n"
                 f"Внешние обстоятельства: {v['external']}\n"
                 "Рекомендации по дальнейшим действиям и устранению\n"
                 f"Действия команды сопровождения: {v['actions']}\n"
                 "Проверка инфраструктуры: проверка доступности и производительности инфраструктуры, анализ нагрузки на серверы и сети")
        return {"kind": kind, "variant": v["id"], "title": f"Алерт {number}: {cause}", "description": _header(svc, now, inner, True),
                "instruction": _steps(f"{cause} ({svc['name']}).", [a.strip().capitalize() + "." for a in v["actions"].split(",")])}
    raise KeyError(kind)
