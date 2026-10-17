"""Zephyr Tool, этап 1 (чтение): разбор форматов ответа, перебор вариантов запроса, дерево папок, отчёт проверки."""

import pytest
from fastapi import HTTPException

import backend.api.zephyr as z

CFG = {"base_url": "https://jira.example", "token": "t", "token_path": "", "ssl_verify": False}


@pytest.fixture
def jira(monkeypatch):
    """Подставная Jira: routes[путь] = ответ или HTTPException; calls — что спрашивали."""
    state = {"routes": {}, "calls": []}
    monkeypatch.setattr(z, "_load_cfg", lambda db: CFG)
    z._working.clear(); z._project_ids.clear()

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        state["calls"].append((path, params))
        r = state["routes"].get(path, HTTPException(404, "Jira: not found"))
        if isinstance(r, Exception):
            raise r
        return r(params) if callable(r) else r

    monkeypatch.setattr(z, "_jira_request", req)
    return state


# ── Разбор форматов ──────────────────────────────────────────────────────────

def test_шаги_v1_и_формат_документации():
    v1 = {"testScript": {"type": "STEP_BY_STEP", "steps": [{"index": 0, "description": "Открыть", "testData": "x", "expectedResult": "Открыто"}]}}
    doc = {"steps": [{"step": "Нажать", "stepData": "y", "expectedResult": "Нажато", "index": 0}]}
    assert z.norm_steps(v1) == [{"index": 0, "description": "Открыть", "testData": "x", "expectedResult": "Открыто"}]
    assert z.norm_steps(doc)[0]["description"] == "Нажать" and z.norm_steps(doc)[0]["testData"] == "y"


def test_шаги_простым_текстом():
    assert z.norm_steps({"testScript": {"type": "PLAIN_TEXT", "text": "Проверить вход"}})[0]["description"] == "Проверить вход"


def test_кейс_статус_и_приоритет_строкой_или_объектом():
    c = z.norm_case({"key": "SBER911-T1", "name": "Вход", "status": {"name": "Approved"}, "priority": "High",
                     "folder": "/Авторизация", "issueLinks": ["SBER911-5"]})
    assert (c["status"], c["priority"], c["folder"], c["issueLinks"]) == ("Approved", "High", "/Авторизация", ["SBER911-5"])


def test_прогон_считает_статусы_по_элементам():
    r = z.norm_run({"key": "SBER911-C1", "name": "Регресс", "items": [{"status": "Pass"}, {"status": "Fail"}, {"status": "Pass"}, {}]})
    assert r["total"] == 4 and r["counts"] == {"Pass": 2, "Fail": 1, "Not Executed": 1}


# ── Дерево ───────────────────────────────────────────────────────────────────

def test_дерево_из_путей_считает_вложенные():
    t = z.tree_from_paths(["/A/B", "/A/B", "/A", "/C", ""])
    assert [n["name"] for n in t] == ["A", "C"]
    a = t[0]
    assert a["count"] == 3 and a["children"][0] == {"name": "B", "path": "/A/B", "count": 2, "children": []}


def test_дерево_из_внутреннего_foldertree():
    data = {"name": "root", "children": [{"id": 1, "name": "A", "testCaseCount": 1, "children": [{"id": 2, "name": "B", "testCaseCount": 4, "children": []}]}]}
    t = z.tree_from_foldertree(data)
    assert t[0]["path"] == "/A" and t[0]["count"] == 5 and t[0]["children"][0]["path"] == "/A/B"


def test_дерево_без_foldertree_строится_из_кейсов(jira):
    jira["routes"]["/rest/api/2/project/SBER911"] = {"id": "11000"}
    jira["routes"]["/rest/atm/1.0/testcase/search"] = [{"key": "SBER911-T1", "folder": "/A"}, {"key": "SBER911-T2", "folder": "/A/B"}]
    out = z.tree(project="sber911", db=None)
    assert out["source"] == "cases" and out["folders"][0]["count"] == 2


# ── Перебор вариантов ────────────────────────────────────────────────────────

def test_вариант_из_документации_если_v1_нет_и_он_запоминается(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search/"] = {"results": [{"key": "SBER911-T9", "name": "Кейс"}]}
    assert z.cases(project="SBER911", folder="", text="", db=None)["cases"][0]["key"] == "SBER911-T9"
    jira["calls"].clear()
    z.cases(project="SBER911", folder="", text="", db=None)
    assert jira["calls"][0][0] == "/rest/atm/1.0/testcase/search/"   # сразу сработавший вариант


def test_фильтр_по_папке_и_тексту_в_запросе(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: []
    z.cases(project="SBER911", folder="/Авторизация", text='вход "био"', db=None)
    q = jira["calls"][0][1]["query"]
    assert q == 'projectKey = "SBER911" AND folder = "/Авторизация" AND name ~ "вход био"'


def test_401_не_маскируется_перебором(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = HTTPException(401, "токен")
    with pytest.raises(HTTPException) as e:
        z.cases(project="SBER911", folder="", text="", db=None)
    assert e.value.status_code == 401


# ── Проверка API ─────────────────────────────────────────────────────────────

def test_проверка_отдаёт_каркас_без_данных_и_пропускает_зависимые(jira):
    jira["routes"]["/rest/api/2/project/SBER911"] = {"id": "11000", "key": "SBER911"}
    jira["routes"]["/rest/atm/1.0/testcase/search"] = [{"key": "SBER911-T1", "name": "Секретное имя"}]
    jira["routes"]["/rest/atm/1.0/testcase/SBER911-T1"] = {"key": "SBER911-T1", "testScript": {"steps": []}}
    rep = z.probe(project="SBER911", samples=False, db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["case-search-v1"]["ok"] and by["case-search-v1"]["shape"] == [{"key": "str", "name": "str"}]
    assert "Секретное имя" not in str(rep)                         # без samples данных в отчёте нет
    assert by["case-get"]["ok"] and by["case-search-doc"]["status"] == 404
    assert by["run-get-v1"]["skipped"]                              # прогонов не нашли — зависимые пропущены
    assert by["tree-cases"]["path"] == "/rest/tests/1.0/project/11000/foldertree/testcase"


# ── Крит регресс ─────────────────────────────────────────────────────────────

def test_кэ_из_объектов_строк_и_id():
    items = z._ke_items([{"id": "3521751", "value": "Управление приоритетными событиями"}, "Sber911. МП iOS (4000001)", "777"])
    assert [(k["id"], k["name"]) for k in items] == [("3521751", "Управление приоритетными событиями"),
                                                     ("4000001", "Sber911. МП iOS"), ("777", "")]


def test_совпадение_кэ_по_id_иначе_по_названию():
    rel = z._ke_items(["Управление приоритетными событиями (3521751)", "Без id"])
    assert z.ke_match(z._ke_items("3521751"), rel)
    assert z.ke_match(z._ke_items("без ID"), rel)
    assert not z.ke_match(z._ke_items("Другое (1)"), rel)


def _case(key, crit="Да", typ="Регресс", ke="Управление приоритетными событиями (3521751)"):
    return {"key": key, "name": key, "status": "Утверждено",
            "customFields": {"Крит регресс": crit, "Тип тестирования": typ, "КЭ": ke}}


def test_отбор_крит_регресса_и_счётчики_отсева():
    cases = [_case("T1"), _case("T2", crit="Нет"), _case("T3", typ="Смоук"), _case("T4", ke="Чужая (9)"), _case("T5", crit=True)]
    out, stats = z.crit_filter(cases, z._ke_items(["3521751"]), z.CritCriteria())
    assert [c["key"] for c in out] == ["T1", "T5"]
    assert stats == {"checked": 5, "no_crit": 1, "no_type": 1, "no_ke": 1}
    assert out[0]["ke"] == ["Управление приоритетными событиями (3521751)"]


def test_релиз_отдаёт_кэ_из_поля_sber911(jira):
    jira["routes"]["/rest/api/2/issue/SBER911-12345"] = {
        "fields": {"summary": "Релиз 2.0", "status": {"name": "Открыт"}, "customfield_18300": [{"id": "3521751", "value": "УПС"}],
                   "customfield_1": "x"},
        "names": {"customfield_18300": "КЭ", "customfield_1": "Прочее"}}
    r = z.release("sber911-12345", db=None)
    assert r["summary"] == "Релиз 2.0" and r["ke"] == [{"id": "3521751", "name": "УПС", "label": "УПС (3521751)"}]
    assert jira["calls"][0][1] == {"expand": "names", "fields": "*all"}


def test_создание_прогона_с_отслеживанием_релиза(jira, monkeypatch):
    sent = {}

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        sent.update(method=method, path=path, body=json_body)
        return {"key": "SBER911-C77"}
    monkeypatch.setattr(z, "_jira_request", req)
    r = z.create_run(z.RunCreate(project="sber911", name="Крит регресс", issueKey="sber911-12345", caseKeys=["T1", "T2", "T1"]), db=None)
    assert r["key"] == "SBER911-C77" and sent["method"] == "POST" and sent["path"] == "/rest/atm/1.0/testrun"
    assert sent["body"] == {"projectKey": "SBER911", "name": "Крит регресс", "issueKey": "SBER911-12345",
                            "items": [{"testCaseKey": "T1"}, {"testCaseKey": "T2"}]}


def test_запись_не_перебирает_варианты_на_400(jira, monkeypatch):
    calls = []

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        calls.append(path)
        raise HTTPException(400, "Jira: name: обязательное поле")
    monkeypatch.setattr(z, "_jira_request", req)
    with pytest.raises(HTTPException):
        z.create_run(z.RunCreate(project="SBER911", name="x", caseKeys=["T1"]), db=None)
    assert calls == ["/rest/atm/1.0/testrun"]       # без попытки testcycle — не плодим дубль


def test_результаты_пачкой_иначе_по_кейсу(jira, monkeypatch):
    calls = []

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        calls.append((path, json_body))
        if path.endswith("/testresults"):
            raise HTTPException(404, "нет")
        if "T2" in path:
            raise HTTPException(400, "Jira: статус неверен")
        return {}
    monkeypatch.setattr(z, "_jira_request", req)
    body = z.ResultsBody(results=[z.CaseResult(testCaseKey="T1", status="Pass"),
                                  z.CaseResult(testCaseKey="T2", status="Fail", issueLinks=["SBER911-1"],
                                               scriptResults=[z.StepResult(index=0, status="Fail", comment="не открылось")])])
    r = z.save_results("sber911-c77", body, db=None)
    assert r["saved"] == 1 and r["errors"][0]["testCaseKey"] == "T2"
    assert calls[2] == ("/rest/atm/1.0/testrun/SBER911-C77/testcase/T2/testresult",
                        {"status": "Fail", "issueLinks": ["SBER911-1"], "scriptResults": [{"index": 0, "status": "Fail", "comment": "не открылось"}]})


# ── Новая модель из XML ──────────────────────────────────────────────────────

XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<project><projectKey>SBER911</projectKey>
<folders><folder fullPath="Новая ТМ" index="0"/><folder fullPath="Новая ТМ/Вход" index="1"/></folders>
<testCases>
<testCase id="1" key="SBER911-T1">
    <customFields>
        <customField name="Крит. регресс" type="CHECKBOX"><value><![CDATA[true]]></value></customField>
        <customField name="Команда" type="SINGLE_CHOICE_SELECT_LIST"><value><![CDATA[QA]]></value></customField>
    </customFields>
    <folder><![CDATA[Новая ТМ/Вход]]></folder>
    <labels/>
    <name><![CDATA[Вход по паролю]]></name>
    <objective><![CDATA[Проверить вход]]></objective>
    <precondition><![CDATA[Есть учётка]]></precondition>
    <priority><![CDATA[High]]></priority>
    <status><![CDATA[Черновик]]></status>
    <testScript type="steps"><steps>
        <step index="1"><description><![CDATA[Нажать «Войти»]]></description><expectedResult><![CDATA[Вход]]></expectedResult><testData/></step>
        <step index="0"><description><![CDATA[Открыть форму]]></description><expectedResult><![CDATA[Открыта]]></expectedResult><testData><![CDATA[user1]]></testData></step>
    </steps></testScript>
</testCase>
</testCases></project>"""


def test_разбор_xml_модели():
    out = z.parse_zephyr_xml(XML)
    assert out["folders"] == ["/Новая ТМ", "/Новая ТМ/Вход"]
    c = out["cases"][0]
    assert (c["name"], c["folder"], c["priority"], c["status"]) == ("Вход по паролю", "/Новая ТМ/Вход", "High", "Черновик")
    assert c["customFields"] == {"Крит. регресс": True, "Команда": "QA"}
    assert [s["description"] for s in c["steps"]] == ["Открыть форму", "Нажать «Войти»"] and c["steps"][0]["testData"] == "user1"


def test_xml_с_dtd_не_разбирается():
    with pytest.raises(HTTPException) as e:
        z.parse_zephyr_xml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><project/>')
    assert e.value.status_code == 422


def test_применить_папки_по_порядку_существующая_не_ошибка_кейс_без_полей(jira, monkeypatch):
    calls = []

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        calls.append((path, json_body))
        if path.endswith("/folder") and json_body["name"] == "/Авторизация":
            raise HTTPException(400, "Jira: Folder already exists")
        if path.endswith("/testcase") and "customFields" in json_body:
            raise HTTPException(400, "Jira: customFields: неизвестное поле")
        if path.endswith("/testcase"):
            return {"key": "SBER911-T900"}
        return {"id": 1}
    monkeypatch.setattr(z, "_jira_request", req)
    body = z.ApplyBody(project="sber911", folders=["/Авторизация/Новая"], cases=[
        z.StagedCase(id="x0", name="Вход", folder="/Авторизация/Новая", customFields={"Команда": "QA"},
                     steps=[z.StagedStep(description="Открыть")])])
    r = z.apply_model(body, db=None)
    assert [c[1]["name"] for c in calls if c[0].endswith("/folder")] == ["/Авторизация", "/Авторизация/Новая"]
    assert r["folderErrors"] == {} and r["created"] == 1
    assert r["results"][0]["key"] == "SBER911-T900" and "без пользовательских полей" in r["results"][0]["warning"]
    last = calls[-1][1]
    assert last["testScript"] == {"type": "STEP_BY_STEP", "steps": [{"description": "Открыть", "testData": "", "expectedResult": ""}]}


def test_кейс_в_несозданной_папке_не_отправляется(jira, monkeypatch):
    calls = []

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        calls.append(path)
        if path.endswith("/folder"):
            raise HTTPException(403, "Jira: нет прав на операцию (403)")
        return {"key": "X"}
    monkeypatch.setattr(z, "_jira_request", req)
    r = z.apply_model(z.ApplyBody(project="SBER911", cases=[z.StagedCase(id="x0", name="Кейс", folder="/Новая")]), db=None)
    assert r["failed"] == 1 and "не создалась" in r["results"][0]["error"]
    assert not any(p.endswith("/testcase") for p in calls)
