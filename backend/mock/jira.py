"""
Мок Jira: REST v2, Zephyr Scale (ATM), Structure, PAT.

Задача по ключу придумывается детерминированно (тот же ключ — та же задача), поэтому списки Jira tool с настоящими
ключами SBER911-… открываются и показывают правдоподобные данные. Правки (поля, переходы, новые задачи) живут в памяти
до перезапуска бэкенда.
"""
from __future__ import annotations

import re
import threading
from datetime import timedelta
from typing import Any, Optional
from urllib.parse import unquote

from backend.mock.common import ME, PEOPLE, Reply, jira_dt, jira_user, not_found, now, ok, rng

_lock = threading.Lock()
_overrides: dict[str, dict] = {}          # key → поля, изменённые через API
_created: dict[str, dict] = {}            # новые задачи
_ids: dict[str, str] = {}                 # id → key
_next_new = [9000]

PROJECTS = [
    {"id": "10100", "key": "SBER911", "name": "СберБанк 911"},
    {"id": "10200", "key": "PKAP", "name": "Платформа контроля аварийных процессов"},
    {"id": "10300", "key": "MONIT", "name": "Мониторинг"},
]
BASE_COUNT = 60                           # задач в «проекте» для запросов без ключей

# ── Справочники ──────────────────────────────────────────────────────────────

_CAT = {
    "new": {"id": 2, "key": "new", "colorName": "blue-gray", "name": "К выполнению"},
    "indeterminate": {"id": 4, "key": "indeterminate", "colorName": "yellow", "name": "В работе"},
    "done": {"id": 3, "key": "done", "colorName": "green", "name": "Готово"},
}
STATUSES = [
    ("1", "Открыт", "new"), ("3", "В работе", "indeterminate"), ("10001", "На ревью", "indeterminate"),
    ("10002", "Тестирование", "indeterminate"), ("10003", "Подтверждение исправления", "indeterminate"),
    ("10004", "Готово", "done"), ("6", "Закрыт", "done"), ("10005", "Отклонен", "done"),
]
_ST = {name: {"id": sid, "name": name, "statusCategory": _CAT[cat]} for sid, name, cat in STATUSES}

TYPES = {
    "Эпик": {"id": "10000", "name": "Эпик", "subtask": False},
    "История": {"id": "10001", "name": "История", "subtask": False},
    "Дефект": {"id": "10004", "name": "Дефект", "subtask": False},
    "Задача": {"id": "10002", "name": "Задача", "subtask": False},
    "Релиз": {"id": "10010", "name": "Релиз", "subtask": False},
}
PRIORITIES = [{"id": str(i), "name": n} for i, n in enumerate(["Блокирующий", "Критический", "Высокий", "Средний", "Низкий"], 1)]
RESOLUTIONS = [{"id": "1", "name": "Исправлено"}, {"id": "2", "name": "Не будет исправлено"}, {"id": "3", "name": "Дубликат"},
               {"id": "10000", "name": "Готово"}]
COMPONENTS = ["Шлюз заявок", "Карта инцидентов", "Уведомления", "Личный кабинет", "Интеграция ЕФС", "Отчёты"]
TEAMS = ["911-Команда-БазовыеСервисы", "911-Команда-Инциденты", "911-Команда-Мониторинг", "911-Команда-Отчётность"]
KE = ["КЭ 911 Шлюз (CI02111111)", "КЭ 911 Карта (CI02122222)", "КЭ 911 Нотификации (CI02133333)"]
VERSIONS = [
    {"id": "20001", "name": "R26.10", "released": True, "releaseDate": "2026-10-20"},
    {"id": "20002", "name": "R26.11", "released": False, "releaseDate": "2026-11-24"},
    {"id": "20003", "name": "R26.12", "released": False, "releaseDate": "2026-12-22"},
]

F_EPIC_LINK, F_EPIC_NAME, F_SP, F_SPRINT = "customfield_10006", "customfield_10008", "customfield_10002", "customfield_10004"
F_KE, F_ENV, F_TEAM = "customfield_11001", "customfield_11002", "customfield_12010"
F_PLAN_START, F_PLAN_END = "customfield_12001", "customfield_12002"

FIELDS = [
    *[{"id": fid, "name": name, "custom": False, "navigable": True, "schema": schema} for fid, name, schema in [
        ("summary", "Тема", {"type": "string", "system": "summary"}),
        ("issuetype", "Тип задачи", {"type": "issuetype", "system": "issuetype"}),
        ("status", "Статус", {"type": "status", "system": "status"}),
        ("priority", "Приоритет", {"type": "priority", "system": "priority"}),
        ("assignee", "Исполнитель", {"type": "user", "system": "assignee"}),
        ("reporter", "Автор", {"type": "user", "system": "reporter"}),
        ("components", "Компоненты", {"type": "array", "items": "component", "system": "components"}),
        ("fixVersions", "Исправить в версиях", {"type": "array", "items": "version", "system": "fixVersions"}),
        ("labels", "Метки", {"type": "array", "items": "string", "system": "labels"}),
        ("resolution", "Решение", {"type": "resolution", "system": "resolution"}),
        ("created", "Создано", {"type": "datetime", "system": "created"}),
        ("updated", "Обновлено", {"type": "datetime", "system": "updated"}),
        ("duedate", "Срок исполнения", {"type": "date", "system": "duedate"}),
        ("resolutiondate", "Дата решения", {"type": "datetime", "system": "resolutiondate"}),
        ("description", "Описание", {"type": "string", "system": "description"}),
        ("environment", "Окружение", {"type": "string", "system": "environment"}),
        ("issuelinks", "Связанные задачи", {"type": "array", "items": "issuelinks", "system": "issuelinks"}),
        ("project", "Проект", {"type": "project", "system": "project"}),
    ]],
    {"id": F_EPIC_LINK, "name": "Epic Link", "custom": True, "navigable": True,
     "schema": {"type": "any", "custom": "com.pyxis.greenhopper.jira:gh-epic-link", "customId": 10006}},
    {"id": F_EPIC_NAME, "name": "Epic Name", "custom": True, "navigable": True,
     "schema": {"type": "string", "custom": "com.pyxis.greenhopper.jira:gh-epic-label", "customId": 10008}},
    {"id": F_SP, "name": "Story Points", "custom": True, "navigable": True,
     "schema": {"type": "number", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:float", "customId": 10002}},
    {"id": F_SPRINT, "name": "Sprint", "custom": True, "navigable": True,
     "schema": {"type": "array", "items": "string", "custom": "com.pyxis.greenhopper.jira:gh-sprint", "customId": 10004}},
    {"id": F_KE, "name": "КЭ", "custom": True, "navigable": True,
     "schema": {"type": "option", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:select", "customId": 11001}},
    {"id": F_ENV, "name": "Среда обнаружения", "custom": True, "navigable": True,
     "schema": {"type": "option", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:select", "customId": 11002}},
    {"id": F_TEAM, "name": "Команда", "custom": True, "navigable": True,
     "schema": {"type": "option", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:select", "customId": 12010}},
    {"id": F_PLAN_START, "name": "Плановое начало", "custom": True, "navigable": True,
     "schema": {"type": "date", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:datepicker", "customId": 12001}},
    {"id": F_PLAN_END, "name": "Плановое окончание", "custom": True, "navigable": True,
     "schema": {"type": "date", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:datepicker", "customId": 12002}},
]

_SUBJECTS = ["карточки инцидента", "формы заявки", "уведомлений о статусе", "выгрузки отчёта", "поиска по адресу",
             "личного кабинета оператора", "интеграции с ЕФС", "журнала событий", "карты происшествий", "SLA-таймера",
             "ролевой модели", "фильтров списка", "экспорта в Excel", "push-уведомлений", "истории изменений"]
_STORY = ["Доработка {}", "Новый экран {}", "Оптимизация {}", "Переход на новый API для {}", "Аудит {}"]
_DEFECT = ["Ошибка 500 при сохранении {}", "Не отображается кнопка у {}", "Неверная сортировка {}",
           "Дублируются записи {}", "Таймаут при загрузке {}", "Падает валидация {}"]
_TASK = ["Подготовить тестовые данные для {}", "Написать автотесты для {}", "Обновить документацию {}",
         "Провести нагрузочное тестирование {}"]
_EPIC = ["Развитие {}", "Редизайн {}", "Импортозамещение {}", "Стабилизация {}"]


def _split(key: str) -> tuple[str, int]:
    p, _, n = key.partition("-")
    return p, int(n) if n.isdigit() else 0


def _pinned() -> set[str]:
    try:
        from backend.api.aqa_tracking import PINNED_EPICS
        return {k.upper() for k in PINNED_EPICS}
    except Exception:
        return set()


def _type_of(n: int, key: str = "") -> str:
    if key and key.upper() in _pinned():                   # эпики роадмапа AQA — всегда эпики
        return "Эпик"
    if n >= 1000:                                      # дети эпиков: 1000 + эпик*10 + i
        return "Дефект" if n % 10 in (3, 7) else "История"
    if n % 17 == 0 or n in (5, 12):
        return "Эпик"
    return ["История", "История", "Дефект", "Задача", "Дефект", "История"][n % 6]


def _epic_of(project: str, n: int, r) -> Optional[str]:
    if n >= 1000:
        return f"{project}-{(n - 1000) // 10}"
    if _type_of(n, f"{project}-{n}") in ("Эпик", "Релиз"):
        return None
    return r.choice([f"{project}-5", f"{project}-12", f"{project}-17", f"{project}-34", None])


def _generate(key: str) -> dict:
    project, n = _split(key)
    r = rng("jira", key)
    itype = _type_of(n, key)
    subject = r.choice(_SUBJECTS)
    summary = r.choice({"Эпик": _EPIC, "История": _STORY, "Дефект": _DEFECT, "Задача": _TASK}.get(itype, _STORY)).format(subject)
    if itype == "Эпик":
        status = r.choice(["В работе", "В работе", "Открыт", "Готово"])
    else:
        status = r.choice([s[1] for s in STATUSES])
    created = now() - timedelta(days=r.randint(3, 120), hours=r.randint(0, 23))
    updated = min(now(), created + timedelta(days=r.randint(0, 40), hours=r.randint(0, 23)))
    assignee = r.choice(PEOPLE + [None]) if itype != "Эпик" else r.choice(PEOPLE)
    reporter = r.choice(PEOPLE)
    plan_start = (now() + timedelta(days=r.randint(-40, 20))).date()
    plan_end = plan_start + timedelta(days=r.randint(7, 60))
    done = _ST[status]["statusCategory"]["key"] == "done"
    fields: dict[str, Any] = {
        "summary": summary,
        "issuetype": TYPES[itype],
        "status": _ST[status],
        "priority": r.choice(PRIORITIES),
        "assignee": jira_user(assignee) if assignee else None,
        "reporter": jira_user(reporter),
        "components": [{"name": c} for c in r.sample(COMPONENTS, r.randint(0, 2))],
        "fixVersions": [{"id": v["id"], "name": v["name"]} for v in r.sample(VERSIONS, r.randint(0, 1))],
        "labels": r.sample(["911-Команда-БазовыеСервисы", "регресс", "техдолг", "UX", "мобильный"], r.randint(0, 2)),
        "resolution": {"name": "Готово"} if done else None,
        "resolutiondate": jira_dt(updated) if done else None,
        "created": jira_dt(created),
        "updated": jira_dt(updated),
        "duedate": plan_end.isoformat() if r.random() < 0.5 else None,
        "description": f"h3. Описание\n{summary}.\n\nh3. Критерии приёмки\n# Работает в Chrome и Яндекс Браузере\n# Покрыто автотестами",
        "environment": "ИФТ" if itype == "Дефект" else None,
        "issuelinks": [],
        "project": next((p for p in PROJECTS if p["key"] == project), {"key": project, "name": project}),
        F_EPIC_LINK: _epic_of(project, n, r),
        F_EPIC_NAME: summary if itype == "Эпик" else None,
        F_SP: r.choice([1, 2, 3, 5, 8, None]) if itype in ("История", "Задача") else None,
        F_SPRINT: [f"com.atlassian.greenhopper.service.sprint.Sprint@1[id=4{r.randint(10, 30)},state=ACTIVE,name=Спринт {r.randint(40, 46)},goal=]"]
                  if itype != "Эпик" else None,
        F_KE: {"value": r.choice(KE)},
        F_ENV: {"value": r.choice(["ИФТ", "ПСИ", "ПРОМ"])} if itype == "Дефект" else None,
        F_TEAM: {"value": r.choice(TEAMS)},
        F_PLAN_START: plan_start.isoformat() if itype in ("Эпик", "История") else None,
        F_PLAN_END: plan_end.isoformat() if itype in ("Эпик", "История") else None,
    }
    if itype == "Дефект" and r.random() < 0.6:
        other = f"{project}-{r.randint(1, BASE_COUNT)}"
        fields["issuelinks"] = [{"id": "1", "type": {"name": "Relates", "inward": "relates to", "outward": "relates to"},
                                 "outwardIssue": {"key": other}}]
    return fields


def _num_id(key: str) -> str:
    project, n = _split(key)
    base = next((int(p["id"]) for p in PROJECTS if p["key"] == project), 10900)
    iid = str(base * 1000 + n)
    _ids[iid] = key
    return iid


def issue(key: str) -> dict:
    key = key.upper()
    with _lock:
        fields = dict(_created.get(key) or _generate(key))
        fields.update(_overrides.get(key, {}))
    return {"id": _num_id(key), "key": key, "self": f"https://jira.mock/rest/api/2/issue/{key}", "fields": fields}


def _project_keys(project: str) -> list[str]:
    return [f"{project}-{n}" for n in range(1, BASE_COUNT + 1)] + [k for k in _created if k.startswith(project + "-")]


def _epic_children(epic: str) -> list[str]:
    project, n = _split(epic)
    count = rng("children", epic).randint(3, 8)
    kids = [f"{project}-{1000 + n * 10 + i}" for i in range(1, count + 1)]
    kids += [k for k in _project_keys(project) if issue(k)["fields"].get(F_EPIC_LINK) == epic and k not in kids]
    return kids


# ── JQL: настолько, насколько нужно экранам ──────────────────────────────────

_LIST_RE = r"\(([^)]*)\)"
_TYPE_ALIASES = {"epic": "эпик", "story": "история", "bug": "дефект", "task": "задача", "release": "релиз"}


def _items(s: str) -> list[str]:
    return [x.strip().strip('"\'').upper() for x in s.split(",") if x.strip()]


def jql_keys(jql: str) -> list[str]:
    q = jql.strip()
    m = re.search(r"\b(?:key|issuekey)\s+in\s*" + _LIST_RE, q, re.I)
    if m:
        return _items(m.group(1))
    m = re.search(r"\b(?:key|issuekey)\s*=\s*\"?([A-Z][A-Z0-9_]*-\d+)", q, re.I)
    if m:
        return [m.group(1).upper()]
    m = re.search(r"\bid\s+in\s*" + _LIST_RE, q, re.I)
    if m:
        return [_ids.get(i, "") for i in _items(m.group(1)) if _ids.get(i)]
    m = re.search(r"(?:cf\[10006\]|\"epic link\"|epic\s*link)\s+in\s*" + _LIST_RE, q, re.I)
    if m:
        return [k for e in _items(m.group(1)) for k in _epic_children(e)]
    m = re.search(r"(?:cf\[10006\]|\"epic link\"|epic\s*link)\s*=\s*\"?([A-Z][A-Z0-9_]*-\d+)", q, re.I)
    if m:
        return _epic_children(m.group(1).upper())
    m = re.search(r"\bfixVersion\s*=\s*\"?([\w.]+)", q, re.I)
    if m:
        v = m.group(1)
        name = next((x["name"] for x in VERSIONS if x["id"] == v or x["name"] == v), v)
        return [k for k in _project_keys("SBER911") if any(f["name"] == name for f in issue(k)["fields"]["fixVersions"])]
    m = re.search(r"\bproject\s*(?:=|in)\s*\(?\"?([A-Z][A-Z0-9_]*)", q, re.I)
    keys = _project_keys(m.group(1).upper() if m else "SBER911")
    m = re.search(r"\b(?:issuetype|type)\s*=\s*\"?([^\"\s)]+)", q, re.I)
    if m:
        want = _TYPE_ALIASES.get(m.group(1).lower(), m.group(1).lower())
        keys = [k for k in keys if issue(k)["fields"]["issuetype"]["name"].lower() == want]
    if re.search(r"currentUser\(\)", q, re.I):
        keys = keys[::3]
    return keys


def search(params: dict) -> Reply:
    keys = list(dict.fromkeys(jql_keys(str(params.get("jql", "")))))
    start, size = int(params.get("startAt", 0) or 0), int(params.get("maxResults", 50) or 50)
    page = [issue(k) for k in keys[start:start + size]]
    return ok({"startAt": start, "maxResults": size, "total": len(keys), "issues": page})


# ── Изменения ────────────────────────────────────────────────────────────────

def _apply(key: str, values: dict) -> None:
    with _lock:
        cur = _overrides.setdefault(key, {})
        for fid, v in values.items():
            if fid == "assignee" and isinstance(v, dict):
                p = next((x for x in PEOPLE if x["name"] == v.get("name")), None)
                v = jira_user(p) if p else ({**ME} if v.get("name") else None)
            elif fid == "priority" and isinstance(v, dict):
                v = next((x for x in PRIORITIES if x["name"] == v.get("name") or x["id"] == v.get("id")), v)
            cur[fid] = v
        cur["updated"] = jira_dt(now())


def _put_issue(key: str, body: dict) -> Reply:
    values = dict(body.get("fields") or {})
    for fid, ops in (body.get("update") or {}).items():
        for op in ops if isinstance(ops, list) else []:
            if "set" in op:
                values[fid] = op["set"]
            elif "add" in op and fid == "labels":
                values[fid] = [*issue(key)["fields"].get("labels", []), op["add"]]
    _apply(key, values)
    return Reply(204, None)


def _transitions(key: str) -> Reply:
    return ok({"transitions": [{"id": sid, "name": name, "to": _ST[name], "fields": {}} for sid, name, _ in STATUSES]})


def _do_transition(key: str, body: dict) -> Reply:
    tid = str((body.get("transition") or {}).get("id", ""))
    name = next((n for sid, n, _ in STATUSES if sid == tid), None)
    if not name:
        return Reply(400, {"errorMessages": [f"Мок: переход {tid} не найден"]})
    values: dict[str, Any] = {"status": _ST[name]}
    res = (body.get("fields") or {}).get("resolution")
    if res:
        values["resolution"] = res
    _apply(key, values)
    return Reply(204, None)


def _create(body: dict) -> Reply:
    f = dict(body.get("fields") or {})
    project = str((f.get("project") or {}).get("key") or "SBER911")
    with _lock:
        _next_new[0] += 1
        key = f"{project}-{_next_new[0]}"
        base = _generate(key)
        itype = (f.get("issuetype") or {}).get("name") or "Задача"
        base.update({"summary": f.get("summary") or "Новая задача", "issuetype": TYPES.get(itype, {"id": "1", "name": itype}),
                     "status": _ST["Открыт"], "resolution": None, "created": jira_dt(now()), "updated": jira_dt(now()),
                     "description": f.get("description") or "", "reporter": ME, "labels": f.get("labels") or []})
        _created[key] = base
    return Reply(201, {"id": _num_id(key), "key": key, "self": f"https://jira.mock/rest/api/2/issue/{key}"})


def _editmeta() -> Reply:
    editable = {"summary", "assignee", "priority", "labels", "duedate", "description", "components", "fixVersions",
                F_PLAN_START, F_PLAN_END, F_SP, F_KE, F_TEAM, F_ENV}
    return ok({"fields": {f["id"]: {"name": f["name"], "schema": f["schema"], "required": f["id"] == "summary",
                                    "operations": ["set"],
                                    **({"allowedValues": [{"value": v, "id": str(i)} for i, v in enumerate(
                                        KE if f["id"] == F_KE else TEAMS if f["id"] == F_TEAM else ["ИФТ", "ПСИ", "ПРОМ"])]}
                                       if f["schema"].get("type") == "option" else {})}
                          for f in FIELDS if f["id"] in editable}})


def _createmeta_types(project: str) -> Reply:
    vals = [{**t, "description": ""} for t in TYPES.values()]
    return ok({"values": vals, "total": len(vals), "isLast": True, "maxResults": 50, "startAt": 0})


def _createmeta_fields(project: str, type_id: str) -> Reply:
    keep = {"summary", "description", "assignee", "priority", "labels", "components", "fixVersions", "duedate",
            F_EPIC_LINK, F_KE, F_ENV, F_TEAM}
    vals = [{"fieldId": f["id"], "name": f["name"], "schema": f["schema"], "required": f["id"] == "summary",
             "operations": ["set"]} for f in FIELDS if f["id"] in keep]
    return ok({"values": vals, "total": len(vals), "isLast": True, "maxResults": 50, "startAt": 0})


# ── Zephyr Scale (ATM) ───────────────────────────────────────────────────────

_FOLDERS = ["/Регресс/Шлюз заявок", "/Регресс/Карта инцидентов", "/Регресс/Уведомления", "/Смоук", "/Новая функциональность/R26.11"]
_tc_overrides: dict[str, dict] = {}
_tc_deleted: set[str] = set()


def testcase(key: str) -> dict:
    project, n = _split(key)
    r = rng("tc", key)
    subject = r.choice(_SUBJECTS)
    tc = {
        "key": key, "projectKey": project, "name": f"Проверка {subject}: {r.choice(['позитивный сценарий', 'граничные значения', 'ошибка валидации', 'права доступа'])}",
        "folder": r.choice(_FOLDERS), "status": r.choice(["Approved", "Approved", "Draft", "Deprecated"]),
        "priority": r.choice(["High", "Normal", "Normal", "Low"]), "owner": r.choice(PEOPLE)["name"],
        "objective": f"Убедиться, что {subject} работает по требованию.", "precondition": "Пользователь авторизован в АС 911",
        "labels": r.sample(["регресс", "смоук", "крит"], r.randint(0, 2)),
        "createdOn": jira_dt(now() - timedelta(days=r.randint(10, 300))), "updatedOn": jira_dt(now() - timedelta(days=r.randint(0, 9))),
        "issueLinks": [f"SBER911-{r.randint(1, BASE_COUNT)}"],
        "testScript": {"type": "STEP_BY_STEP", "steps": [
            {"index": i, "description": d, "expectedResult": e} for i, (d, e) in enumerate([
                ("Открыть раздел", "Раздел открыт"), (f"Заполнить {subject}", "Поля заполнены"),
                ("Нажать «Сохранить»", "Данные сохранены, показано уведомление")])]},
        "customFields": {"Крит регресс": r.random() < 0.3},
    }
    tc.update(_tc_overrides.get(key, {}))
    return tc


def _tc_search(params: dict) -> Reply:
    q = str(params.get("query", ""))
    m = re.search(r'projectKey\s*=\s*"?([A-Z0-9_]+)', q)
    project = m.group(1) if m else "SBER911"
    m = re.search(r'key\s+IN\s*\(([^)]*)\)', q, re.I)
    keys = _items(m.group(1)) if m else [f"{project}-T{n}" for n in range(1, 121)]
    keys = [k for k in keys if k not in _tc_deleted]
    start, size = int(params.get("startAt", 0) or 0), int(params.get("maxResults", 200) or 200)
    return ok([testcase(k) for k in keys[start:start + size]])


def testrun(key: str) -> dict:
    r = rng("tr", key)
    project = key.split("-")[0]
    items = []
    for i in range(r.randint(6, 18)):
        st = r.choice(["Pass", "Pass", "Pass", "Fail", "Not Executed", "In Progress", "Blocked"])
        items.append({"id": i + 1, "testCaseKey": f"{project}-T{r.randint(1, 120)}", "status": st, "userKey": r.choice(PEOPLE)["name"],
                      "executionDate": jira_dt(now() - timedelta(hours=r.randint(1, 200))) if st not in ("Not Executed",) else None})
    return {"key": key, "name": f"Прогон {r.choice(['регресса', 'НФ', 'смоук'])} {r.choice(['R26.10', 'R26.11'])}",
            "projectKey": project, "status": r.choice(["Done", "In Progress", "Not Executed"]),
            "folder": "/Релизы", "owner": r.choice(PEOPLE)["name"], "issueKey": f"SBER911-{r.randint(1, BASE_COUNT)}",
            "createdOn": jira_dt(now() - timedelta(days=r.randint(1, 30))), "items": items,
            "plannedStartDate": jira_dt(now() - timedelta(days=5)), "plannedEndDate": jira_dt(now() + timedelta(days=5))}


def _tr_search(params: dict) -> Reply:
    q = str(params.get("query", ""))
    m = re.search(r'projectKey\s*=\s*"?([A-Z0-9_]+)', q)
    project = m.group(1) if m else "SBER911"
    runs = [testrun(f"{project}-C{n}") for n in range(1, 25)]
    for r in runs:
        r.pop("items", None)
    return ok(runs)


# ── Маршрутизация ────────────────────────────────────────────────────────────

def handle(method: str, path: str, params: dict, body: Any) -> Optional[Reply]:
    p = unquote(path)
    if p.startswith("/rest/atm/1.0/") or p.startswith("/rest/tests/1.0/"):
        return _atm(method, p.split("/", 4)[-1], params, body or {})
    if p.startswith("/rest/structure/2.0/"):
        tail = p[len("/rest/structure/2.0/"):]
        if tail == "structure":
            return ok({"structures": [{"id": 101, "name": "Релизы SBER911", "description": "Мок", "owner": jira_user(PEOPLE[0])}]})
        if tail.startswith("forest"):
            return ok({"formula": "", "itemTypes": {}, "version": {"signature": 1, "version": 1}})
        if tail == "value":
            return ok({"responses": [{"rows": [], "data": []}]})
        return None
    if p == "/rest/pat/latest/tokens" and method == "POST":
        return ok({"id": 1, "name": "Shark mock", "rawToken": "mock-token", "expiringAt": jira_dt(now() + timedelta(days=180))})
    if not p.startswith("/rest/api/2/"):
        return None
    t = p[len("/rest/api/2/"):].rstrip("/")
    parts = t.split("/")
    if t == "myself":
        return ok(ME)
    if t == "search":
        if method == "POST":
            return search({**params, **(body or {})})
        return search(params)
    if t == "field":
        return ok(FIELDS)
    if t == "status":
        return ok(list(_ST.values()))
    if t == "priority":
        return ok(PRIORITIES)
    if t == "resolution":
        return ok(RESOLUTIONS)
    if t == "issueLinkType":
        return ok({"issueLinkTypes": [{"id": "1", "name": "Relates", "inward": "relates to", "outward": "relates to"},
                                      {"id": "2", "name": "Blocks", "inward": "is blocked by", "outward": "blocks"}]})
    if t == "project":
        return ok(PROJECTS)
    if t in ("user/search", "user/assignable/search", "user/picker"):
        q = str(params.get("username") or params.get("query") or "").lower()
        users = [jira_user(x) for x in PEOPLE if not q or q in x["name"] or q in x["displayName"].lower()]
        return ok({"users": users} if t == "user/picker" else users)
    if t == "issueLink" and method == "POST":
        return Reply(201, None)
    if t == "issue" and method == "POST":
        return _create(body or {})
    if parts[0] == "issue" and parts[1:2] == ["createmeta"]:
        if len(parts) == 2:
            return ok({"projects": [{**pr, "issuetypes": list(TYPES.values())} for pr in PROJECTS]})
        if len(parts) == 4:
            return _createmeta_types(parts[2])
        if len(parts) == 5:
            return _createmeta_fields(parts[2], parts[4])
    if parts[0] == "issue" and len(parts) >= 2:
        key = parts[1].upper()
        if not re.match(r"^[A-Z][A-Z0-9_]*-\d+$", key):
            key = _ids.get(parts[1], "")
            if not key:
                return not_found(f"задача {parts[1]}")
        rest = parts[2:]
        if not rest:
            if method == "GET":
                return ok(issue(key))
            if method == "PUT":
                return _put_issue(key, body or {})
            if method == "DELETE":
                return Reply(204, None)
        if rest == ["transitions"]:
            return _transitions(key) if method == "GET" else _do_transition(key, body or {})
        if rest == ["editmeta"]:
            return _editmeta()
        if rest == ["assignee"]:
            _apply(key, {"assignee": body or {}})
            return Reply(204, None)
        if rest[0] == "remotelink":
            return ok([]) if method == "GET" else Reply(201 if method == "POST" else 204, {"id": 1} if method == "POST" else None)
        if rest[0] == "attachments":
            return ok([{"id": "1", "filename": "file"}])
        if rest[0] == "comment":
            return ok({"comments": [], "total": 0}) if method == "GET" else Reply(201, {"id": "1"})
    if parts[0] == "project" and len(parts) >= 2:
        pk = parts[1].upper()
        pr = next((x for x in PROJECTS if x["key"] == pk), {"id": "10900", "key": pk, "name": pk})
        if len(parts) == 2:
            return ok({**pr, "issueTypes": list(TYPES.values()), "components": [{"name": c} for c in COMPONENTS]})
        if parts[2] == "components":
            return ok([{"id": str(i), "name": c} for i, c in enumerate(COMPONENTS)])
        if parts[2] == "versions":
            return ok(VERSIONS)
        if parts[2] == "statuses":
            return ok([{"id": t["id"], "name": t["name"], "subtask": False, "statuses": list(_ST.values())} for t in TYPES.values()])
    if parts[0] == "version" and len(parts) == 2:
        v = next((x for x in VERSIONS if x["id"] == parts[1]), None)
        return ok(v) if v else not_found(f"версия {parts[1]}")
    return None


def _atm(method: str, tail: str, params: dict, body: Any) -> Optional[Reply]:
    parts = tail.strip("/").split("/")
    if parts[0] == "testcase":
        if parts[1:] == ["search"]:
            return _tc_search(params)
        if len(parts) == 1 and method == "POST":
            r = rng("newtc", str(body))
            key = f"{body.get('projectKey', 'SBER911')}-T{r.randint(500, 999)}"
            _tc_overrides[key] = {k: v for k, v in body.items() if k in ("name", "folder", "objective", "precondition", "status", "priority")}
            return Reply(201, {"key": key, "id": r.randint(1000, 9999)})
        if len(parts) == 2:
            key = parts[1].upper()
            if method == "GET":
                return ok(testcase(key)) if key not in _tc_deleted else not_found(f"кейс {key}")
            if method == "PUT":
                _tc_overrides.setdefault(key, {}).update({k: v for k, v in (body or {}).items() if not isinstance(v, (dict, list)) or k == "labels"})
                return Reply(200, {})
            if method == "DELETE":
                _tc_deleted.add(key)
                return Reply(204, None)
    if parts[0] == "testrun":
        if parts[1:] == ["search"]:
            return _tr_search(params)
        if len(parts) == 2:
            return ok(testrun(parts[1].upper()))
        if parts[2:] == ["testresults"]:
            run = testrun(parts[1].upper())
            return ok([{"id": it["id"], "testCaseKey": it["testCaseKey"], "status": it["status"], "userKey": it["userKey"],
                        "executionDate": it["executionDate"], "comment": "", "scriptResults": []} for it in run["items"]])
        if len(parts) >= 4 and parts[2] == "testcase":
            return Reply(201, {"id": 1})
    if parts[0] == "folder" and method == "POST":
        return Reply(201, {"id": rng("folder", str(body)).randint(100, 9999)})
    if parts[0] == "testresult":
        return Reply(201, {"id": 1})
    return None
