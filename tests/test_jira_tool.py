"""Jira tool: чтение задач из настоящей Jira и смена статусов.

Реальной Jira в тестах нет: _jira_request подменяется, проверяется наша логика —
приведение задач к плоскому виду, поиск по ключам с добором по одной, связи,
переходы, разбор дерева структуры.
"""

import pytest
from fastapi import HTTPException

import backend.api.jira_tool as JT

CFG = {"base_url": "https://jira", "token": "t", "token_path": "", "ssl_verify": False,
       "labels": [], "issuetype": "Дефект"}


def _issue(key, **fields):
    return {"key": key, "id": key.split("-")[1], "fields": fields}


class FakeJira:
    """Отвечает на запросы по таблице «путь → функция», запоминает вызовы."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, cfg, method, path, json_body=None, params=None, auth=None, timeout=30):
        self.calls.append((method, path, params, json_body))
        for prefix, fn in self.routes.items():
            if path.startswith(prefix):
                return fn(method, path, params or {}, json_body)
        raise HTTPException(404, f"нет маршрута {path}")


@pytest.fixture
def jira(monkeypatch):
    for cache in (JT._catalog_cache, JT._projects_cache, JT._project_fields_cache, JT._statuses_cache):
        cache.clear()
    monkeypatch.setattr(JT, "_load_cfg", lambda db: dict(CFG))

    def install(routes):
        fake = FakeJira(routes)
        monkeypatch.setattr(JT, "_jira_request", fake)
        return fake
    return install


# ── Приведение задачи ────────────────────────────────────────────────────────

def test_задача_плоская_пустые_поля_выкинуты():
    issue = _issue("SBER911-1",
                   summary="Падает оплата", status={"name": "Открыт"}, assignee=None,
                   components=[{"name": "Back"}, {"name": "iOS"}], labels=[],
                   created="2026-10-08T14:35:00.000+0300", customfield_10002=3.0,
                   issuelinks=[{"outwardIssue": {"key": "SBER911-2"}}, {"inwardIssue": {"key": "SBER911-3"}}],
                   comment={"comments": []})
    n = JT.norm_issue(issue, "https://jira")
    assert n["url"] == "https://jira/browse/SBER911-1"
    assert n["fields"] == {
        "summary": "Падает оплата", "status": "Открыт", "components": ["Back", "iOS"],
        # дата остаётся в формате Jira — переводит в местное время фронтенд
        "created": "2026-10-08T14:35:00.000+0300", "customfield_10002": "3",
        "issuelinks": ["SBER911-2", "SBER911-3"],
    }


@pytest.mark.parametrize("schema, fid, kind", [
    ({"type": "string"}, "summary", "text"),
    ({"type": "string"}, "description", "longtext"),
    ({"type": "string", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:textarea"}, "customfield_1", "longtext"),
    ({"type": "datetime"}, "created", "datetime"),
    ({"type": "array", "items": "component"}, "components", "multi"),
    ({"type": "priority"}, "priority", "option"),
    ({"type": "user"}, "assignee", "user"),
])
def test_тип_поля(schema, fid, kind):
    assert JT.field_kind({"id": fid, "schema": schema}) == kind


# ── Каталог ──────────────────────────────────────────────────────────────────

def test_каталог_эпик_линк_по_схеме_и_порядок_статусов(jira):
    jira({
        "/rest/api/2/field": lambda *a: [
            {"id": "summary", "name": "Тема", "schema": {"type": "string"}},
            {"id": "customfield_777", "name": "Ссылка на эпик", "custom": True,
             "schema": {"type": "any", "custom": "com.pyxis.greenhopper.jira:gh-epic-link"}},
        ],
        "/rest/api/2/status": lambda *a: [
            {"name": "Закрыт", "statusCategory": {"key": "done"}},
            {"name": "Открыт", "statusCategory": {"key": "new"}},
            {"name": "В работе", "statusCategory": {"key": "indeterminate"}},
        ],
        "/rest/api/2/priority": lambda *a: [{"name": "Блокирующий"}, {"name": "Низкий"}],
        "/rest/api/2/resolution": lambda *a: (_ for _ in ()).throw(HTTPException(403, "нет прав")),
    })
    c = JT.catalog(db=None)
    assert c["epic_link"] == "customfield_777"
    assert [s["name"] for s in c["statuses"]] == ["Открыт", "В работе", "Закрыт"]
    assert c["priorities"] == ["Блокирующий", "Низкий"]
    assert c["resolutions"] == []          # справочник недоступен — не роняем каталог


def test_каталог_без_токена_падает_честно(jira):
    jira({"/rest/api/2/field": lambda *a: (_ for _ in ()).throw(HTTPException(401, "токен"))})
    with pytest.raises(HTTPException) as e:
        JT.catalog(db=None)
    assert e.value.status_code == 401


# ── Задачи по ключам ─────────────────────────────────────────────────────────

def test_задачи_по_ключам_и_ненайденные(jira):
    fake = jira({"/rest/api/2/search": lambda m, p, params, b: {
        "total": 1, "issues": [_issue("SBER911-10", summary="Есть")]}})
    res = JT.issues_by_keys(JT.KeysBody(keys=["sber911-10", "SBER911-11", "мусор", "SBER911-10"]), db=None)
    assert [i["key"] for i in res["issues"]] == ["SBER911-10"]
    assert res["missing"] == ["SBER911-11"]
    params = fake.calls[0][2]
    assert params["jql"] == "key in (SBER911-10, SBER911-11)"
    assert params["validateQuery"] == "false"


def test_пачка_отвергнута_добираем_по_одной(jira):
    def search(*a):
        raise HTTPException(400, "An issue with key 'SBER911-11' does not exist")

    def issue(m, path, *a):
        if path.endswith("SBER911-11"):
            raise HTTPException(404, "нет")
        return _issue("SBER911-10", summary="Есть")

    jira({"/rest/api/2/search": search, "/rest/api/2/issue/": issue})
    res = JT.issues_by_keys(JT.KeysBody(keys=["SBER911-10", "SBER911-11"]), db=None)
    assert [i["key"] for i in res["issues"]] == ["SBER911-10"]
    assert res["missing"] == ["SBER911-11"]


def test_ключи_бьются_на_пачки(jira):
    fake = jira({"/rest/api/2/search": lambda *a: {"total": 0, "issues": []}})
    JT.issues_by_keys(JT.KeysBody(keys=[f"SBER911-{i}" for i in range(1, 251)]), db=None)
    assert len([c for c in fake.calls if c[1] == "/rest/api/2/search"]) == 3


# ── Связанные: стори эпика и связи ───────────────────────────────────────────

def test_связанные_по_эпик_линку_и_связям(jira):
    def search(m, p, params, b):
        if params["jql"].startswith("cf[10006]"):
            return {"total": 1, "issues": [_issue("SBER911-21", issuetype={"name": "История"})]}
        return {"total": 1, "issues": [_issue("SBER911-30", issuetype={"name": "Дефект"})]}

    fake = jira({
        "/rest/api/2/field": lambda *a: [{"id": "customfield_10006", "name": "Epic Link",
                                          "schema": {"custom": "com.pyxis.greenhopper.jira:gh-epic-link"}}],
        "/rest/api/2/status": lambda *a: [], "/rest/api/2/priority": lambda *a: [],
        "/rest/api/2/resolution": lambda *a: [],
        "/rest/api/2/search": search,
    })
    res = JT.related(JT.RelatedBody(epics=["SBER911-20"], linked=["SBER911-30", "SBER911-21"]), db=None)
    assert sorted(i["key"] for i in res["issues"]) == ["SBER911-21", "SBER911-30"]
    jqls = [c[2]["jql"] for c in fake.calls if c[1] == "/rest/api/2/search"]
    # уже найденную по эпику задачу второй раз не запрашиваем
    assert jqls == ["cf[10006] in (SBER911-20)", "key in (SBER911-30)"]


# ── Переходы ─────────────────────────────────────────────────────────────────

def test_переходы_и_обязательное_решение(jira):
    def tr(m, path, params, b):
        if "SBER911-2" in path:
            raise HTTPException(403, "нет прав")
        return {"transitions": [
            {"id": "11", "name": "В работу", "to": {"name": "В работе"}},
            {"id": "31", "name": "Выполнить", "to": {"name": "Выполнен"},
             "fields": {"resolution": {"required": True, "allowedValues": [{"id": "10000", "name": "Готово"}]}}},
        ]}

    jira({"/rest/api/2/issue/": tr})
    res = JT.transitions(JT.KeysBody(keys=["SBER911-1", "SBER911-2"]), db=None)["issues"]
    assert res["SBER911-1"]["transitions"][1] == {"id": "31", "name": "Выполнить", "to": "Выполнен",
                                                  "resolution_required": True,
                                                  "resolutions": [{"id": "10000", "name": "Готово"}]}
    assert "нет прав" in res["SBER911-2"]["error"]


def test_выполнение_переходов_с_решением(jira):
    def do(m, path, params, body):
        if "SBER911-2" in path:
            raise HTTPException(400, "Jira: resolution: обязательно")
        return {}

    fake = jira({"/rest/api/2/issue/": do})
    res = JT.apply_transitions(JT.TransitionBody(changes=[
        JT.TransitionChange(key="SBER911-1", transition_id="31", resolution="10000"),
        JT.TransitionChange(key="SBER911-2", transition_id="31"),
    ]), db=None)
    assert res["done"] == 1
    assert res["results"][1]["ok"] is False
    body = next(c[3] for c in fake.calls if "SBER911-1" in c[1])
    # Решение уходит id из allowedValues перехода, а не названием
    assert body == {"transition": {"id": "31"}, "fields": {"resolution": {"id": "10000"}}}


# ── Люди → поля Jira ─────────────────────────────────────────────────────────

def test_человек_пишется_в_поле_по_схеме_а_нет_поля_молча_пропуск(jira):
    meta = {
        "SBER911-1": {"customfield_1": {"name": "Тестировщик", "schema": {"type": "user"}},
                      "customfield_2": {"name": "Аналитики", "schema": {"type": "array", "items": "user"}},
                      "customfield_3": {"name": "Бэкенд", "schema": {"type": "string"}},
                      "labels": {"name": "Метки", "schema": {"type": "array", "items": "string"}}},
        "SBER911-2": {},   # дефект: полей направлений нет
    }

    def do(m, path, params, body):
        key = path.split("/")[5]
        return {"fields": meta[key]} if path.endswith("/editmeta") else {}

    fake = jira({"/rest/api/2/issue/": do})
    res = JT.write_people_fields(JT.PersonChangesBody(changes=[
        JT.PersonChange(key="SBER911-1", field="customfield_1", user="ivanov"),
        JT.PersonChange(key="SBER911-1", field="customfield_2", user="petrov", prev="sidorov"),
        JT.PersonChange(key="SBER911-1", field="customfield_3", user="kim", display="Ким Анна"),
        JT.PersonChange(key="SBER911-1", field="labels", user="kim"),
        JT.PersonChange(key="SBER911-2", field="customfield_2", user="petrov"),
        JT.PersonChange(key="SBER911-1", field="customfield_1", user=""),
    ]), db=None)
    r = res["results"]
    assert [x.get("ok") for x in r[:3]] == [True, True, True]
    assert r[3]["ok"] is False and "не для людей" in r[3]["error"]
    assert r[4] == {"key": "SBER911-2", "field": "customfield_2", "skipped": True}
    puts = [c[3] for c in fake.calls if c[0] == "PUT"]
    assert puts == [
        {"fields": {"customfield_1": {"name": "ivanov"}}},
        {"update": {"customfield_2": [{"remove": {"name": "sidorov"}}, {"add": {"name": "petrov"}}]}},
        {"fields": {"customfield_3": "Ким Анна"}},
        {"fields": {"customfield_1": None}},                      # сняли человека — поле очищено
    ]
    # editmeta — один раз на задачу
    assert sum(1 for c in fake.calls if c[1].endswith("/editmeta")) == 2


def test_поиск_пользователей_jira(jira):
    jira({"/rest/api/2/user/search": lambda m, p, params, b: [
        {"name": "ivanov-ia", "displayName": "Иванов Илья", "emailAddress": "i@x", "active": True}, {"displayName": "без логина"}]})
    assert JT.find_users(JT.UsersQuery(q="иван"), db=None) == {
        "users": [{"name": "ivanov-ia", "display": "Иванов Илья", "email": "i@x", "active": True}]}


# ── Структура ────────────────────────────────────────────────────────────────

def test_формула_структуры():
    assert JT.parse_formula("1:0:5/77,2:1:10001,3:1:10002:x,мусор") == [
        (1, 0, "5/77"), (2, 1, "10001"), (3, 1, "10002")]


def test_дерево_по_глубине():
    tree = JT.build_tree([
        {"depth": 0, "folder": "Эпики"}, {"depth": 1, "key": "A-1"}, {"depth": 2, "key": "A-2"},
        {"depth": 0, "folder": "Дефекты"}, {"depth": 1, "key": "A-3"},
    ])
    assert tree == [
        {"folder": "Эпики", "children": [{"key": "A-1", "children": [{"key": "A-2", "children": []}]}]},
        {"folder": "Дефекты", "children": [{"key": "A-3", "children": []}]},
    ]


def test_структура_папки_и_ключи_из_значений(jira):
    jira({
        "/rest/structure/2.0/forest/latest": lambda *a: {
            "formula": "1:0:3/50,2:1:10001", "itemTypes": {"3": "com.almworks.jira.structure:type-folder"}},
        "/rest/structure/2.0/value": lambda m, p, params, body: {"responses": [{
            "rows": body["requests"][0]["rows"],
            "data": [{"attribute": {"id": "key"}, "values": ["", "SBER911-5"]},
                     {"attribute": {"id": "summary"}, "values": ["Дефекты", "Падает оплата"]}],
        }]},
    })
    res = JT.structure_tree(7, db=None)
    assert res["root"] == [{"folder": "Дефекты", "children": [{"key": "SBER911-5", "children": []}]}]


def test_структура_без_значений_ключи_по_id(jira):
    jira({
        "/rest/structure/2.0/forest/latest": lambda *a: {
            "formula": "1:0:3/50,2:1:10001", "itemTypes": {"3": "com.almworks.jira.structure:type-folder"}},
        "/rest/structure/2.0/value": lambda *a: (_ for _ in ()).throw(HTTPException(404, "нет")),
        "/rest/api/2/search": lambda m, p, params, b: {"total": 1, "issues": [{"id": "10001", "key": "SBER911-5"}]},
    })
    res = JT.structure_tree(7, db=None)
    assert res["root"] == [{"folder": "Папка 50", "children": [{"key": "SBER911-5", "children": []}]}]


def test_нет_плагина_структуры(jira):
    jira({})
    with pytest.raises(HTTPException) as e:
        JT.structures(db=None)
    assert "Structure" in e.value.detail


# ── Релиз = версия Jira (fixVersion) ─────────────────────────────────────────

@pytest.mark.parametrize("ref, expected", [
    ("https://jira.sberbank.ru/projects/SBER911/versions/2568004", ("2568004", "SBER911")),
    ("https://jira.sberbank.ru/projects/SBER911/versions/2568004?selectedTab=issues", ("2568004", "SBER911")),
    ("2568004", ("2568004", "")),
    ("Релиз 16/10. БС", ("", "")),
])
def test_ссылка_на_версию(ref, expected):
    assert JT.parse_version_ref(ref) == expected


def _catalog_routes():
    return {
        "/rest/api/2/field": lambda *a: [{"id": "customfield_10006", "name": "Epic Link",
                                          "schema": {"custom": "com.pyxis.greenhopper.jira:gh-epic-link"}}],
        "/rest/api/2/status": lambda *a: [], "/rest/api/2/priority": lambda *a: [],
        "/rest/api/2/resolution": lambda *a: [],
    }


def test_состав_релиза_по_fix_version(jira):
    def search(m, p, params, b):
        if params["jql"].startswith("fixVersion"):
            return {"total": 2, "issues": [
                _issue("SBER911-2", summary="Стори", issuetype={"name": "История"}, customfield_10006="SBER911-50"),
                _issue("SBER911-3", summary="Дефект", issuetype={"name": "Дефект"}),
            ]}
        return {"total": 1, "issues": [_issue("SBER911-50", summary="Эпик", issuetype={"name": "Epic"})]}

    fake = jira({**_catalog_routes(),
                 "/rest/api/2/version/2568004": lambda *a: {"id": "2568004", "name": "Релиз 16/10. БС", "released": False,
                                                            "releaseDate": "2026-10-16"},
                 "/rest/api/2/search": search})
    res = JT.release("https://jira.sberbank.ru/projects/SBER911/versions/2568004", db=None)
    assert res["release"]["name"] == "Релиз 16/10. БС"
    assert res["release"]["url"] == "https://jira/projects/SBER911/versions/2568004"
    assert [i["key"] for i in res["issues"]] == ["SBER911-2", "SBER911-3"]
    assert [e["key"] for e in res["epics"]] == ["SBER911-50"]
    jqls = [c[2]["jql"] for c in fake.calls if c[1] == "/rest/api/2/search"]
    assert jqls[0] == "fixVersion = 2568004"


def test_релиз_по_названию_версии(jira):
    jira({**_catalog_routes(),
          "/rest/api/2/project/SBER911/versions": lambda *a: [{"id": "100", "name": "Релиз 16/10. БС"}],
          "/rest/api/2/version/100": lambda *a: {"id": "100", "name": "Релиз 16/10. БС"},
          "/rest/api/2/search": lambda *a: {"total": 0, "issues": []}})
    res = JT.release("релиз 16/10. бс", project="SBER911", db=None)
    assert res["release"]["id"] == "100"
    with pytest.raises(HTTPException) as e:
        JT.release("Нет такого", project="SBER911", db=None)
    assert e.value.status_code == 404
