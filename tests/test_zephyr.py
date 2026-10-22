"""Zephyr Tool, этап 1 (чтение): разбор форматов ответа, перебор вариантов запроса, дерево папок, отчёт проверки."""

import pytest
from fastapi import HTTPException

import backend.api.zephyr as z

CFG = {"base_url": "https://jira.example", "token": "t", "token_path": "", "ssl_verify": False}


@pytest.fixture
def jira(monkeypatch, tmp_path):
    """Подставная Jira: routes[путь] = ответ или HTTPException; calls — что спрашивали. Индекс — во временной папке."""
    state = {"routes": {}, "calls": []}
    monkeypatch.setattr(z, "_load_cfg", lambda db: CFG)
    monkeypatch.setattr(z, "_INDEX_DIR", tmp_path / "zephyr_index")
    monkeypatch.setattr(z, "_RELEASES_FILE", tmp_path / "zephyr_releases.json")
    z._working.clear(); z._project_ids.clear(); z._index.clear(); z._locks.clear(); z._no_fields.clear(); z._failed.clear(); z._trace_tql.clear()

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


def test_дерево_из_индекса_модели(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [{"key": "ICON-T1", "folder": "/A"}, {"key": "ICON-T2", "folder": "/A/B"}] if p["startAt"] == 0 else []
    out = z.tree(project="sber911", db=None)
    assert out["source"] == "index" and out["folders"][0]["count"] == 2
    assert jira["calls"][0][1]["fields"] == z.INDEX_FIELDS            # без шагов — только нужные поля


def _paged(total: int, cap: int):
    """Поиск, который отдаёт не больше cap кейсов за страницу, всего total."""
    def r(p):
        start, size = p["startAt"], min(p["maxResults"], cap)
        return [{"key": f"ICON-T{i}", "folder": "/F", "name": f"Кейс {i}"} for i in range(start, min(start + size, total))]
    return r


def test_загрузка_страницами_по_200_и_не_теряет_кейсы(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = _paged(3990, 1000)
    rows = z.fetch_all(CFG, "SBER911")
    assert len(rows) == 3990 and len({r["key"] for r in rows}) == 3990
    starts = sorted(c[1]["startAt"] for c in jira["calls"])
    assert starts[:3] == [0, 200, 400] and all(c[1]["maxResults"] == 200 for c in jira["calls"])


def test_загрузка_определяет_предел_страницы_меньше_200(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = _paged(950, 100)
    rows = z.fetch_all(CFG, "SBER911")
    assert len(rows) == 950 and len({r["key"] for r in rows}) == 950


def test_страница_модели_ждёт_дольше_обычного_запроса(jira):
    seen = []
    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        seen.append(timeout)
        return []
    z._jira_request = req   # monkeypatch фикстуры вернёт исходную функцию
    z.fetch_all(CFG, "SBER911")
    assert seen and all(t == z.PAGE_TIMEOUT for t in seen)


def test_таймаут_основного_варианта_не_прячется_за_запасным(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = HTTPException(502, "Jira недоступна: Read timed out")
    jira["routes"]["/rest/atm/1.0/testcase/search/"] = HTTPException(400, "Jira: Must provide a query parameter")
    with pytest.raises(HTTPException) as e:
        z.fetch_all(CFG, "SBER911")
    assert e.value.status_code == 502 and "timed out" in e.value.detail
    assert [c[0] for c in jira["calls"]] == ["/rest/atm/1.0/testcase/search"]   # запасной даже не спрашивали


def test_оба_варианта_400_показываю_ошибку_основного(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = HTTPException(400, "Jira: maxResults слишком большой")
    jira["routes"]["/rest/atm/1.0/testcase/search/"] = HTTPException(400, "Jira: Must provide a query parameter")
    with pytest.raises(HTTPException) as e:
        z.get_index(CFG, "SBER911")
    assert "maxResults" in e.value.detail


def test_ждущий_запрос_получает_ошибку_загрузки_а_не_грузит_заново(jira):
    import threading
    gate, started = threading.Event(), threading.Event()
    def slow(p):
        started.set(); gate.wait(5)
        raise HTTPException(502, "Jira недоступна: Read timed out")
    jira["routes"]["/rest/atm/1.0/testcase/search"] = slow
    errs: list = []
    def call():
        try: z.get_index(CFG, "SBER911")
        except HTTPException as e: errs.append(e.status_code)
    t1 = threading.Thread(target=call); t1.start(); started.wait(5)
    t2 = threading.Thread(target=call); t2.start()
    import time as _t; _t.sleep(0.05); gate.set(); t1.join(5); t2.join(5)
    assert errs == [502, 502] and len(jira["calls"]) == 1


def test_fields_не_принят_гружу_без_него(jira):
    def r(p):
        if "fields" in p:
            raise HTTPException(400, "Jira: fields")
        return [{"key": "ICON-T1", "folder": "/A"}] if p["startAt"] == 0 else []
    jira["routes"]["/rest/atm/1.0/testcase/search"] = r
    jira["routes"]["/rest/atm/1.0/testcase/search/"] = HTTPException(400, "Jira: Must provide a query parameter")
    assert [x["key"] for x in z.fetch_all(CFG, "SBER911")] == ["ICON-T1"]


def test_индекс_с_диска_без_запроса_в_jira(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = _paged(3, 1000)
    z.get_index(CFG, "SBER911")
    z._index.clear(); jira["calls"].clear()
    idx = z.get_index(CFG, "SBER911")
    assert len(idx["cases"]) == 3 and jira["calls"] == []


def test_кейсы_папки_и_поиск_по_индексу(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [
        {"key": "ICON-T10", "folder": "/A", "name": "Вход по паролю"}, {"key": "ICON-T2", "folder": "/A", "name": "Выход"},
        {"key": "ICON-T3", "folder": "/B", "name": "Вход по биометрии"}] if p["startAt"] == 0 else []
    assert [c["key"] for c in z.cases(project="SBER911", folder="/A", text="", db=None)["cases"]] == ["ICON-T2", "ICON-T10"]
    assert [c["key"] for c in z.cases(project="SBER911", folder="", text="вход", db=None)["cases"]] == ["ICON-T3", "ICON-T10"]


def test_обновить_папку_меняет_только_её(jira):
    state = {"v": 1}
    def r(p):
        if "folder" in p["query"]:
            return [{"key": "ICON-T1", "folder": "/A", "name": f"Новое имя {state['v']}"}] if p["startAt"] == 0 else []
        return [{"key": "ICON-T1", "folder": "/A", "name": "Старое"}, {"key": "ICON-T2", "folder": "/A", "name": "Удалённый"},
                {"key": "ICON-T3", "folder": "/B", "name": "Другая папка"}] if p["startAt"] == 0 else []
    jira["routes"]["/rest/atm/1.0/testcase/search"] = r
    z.get_index(CFG, "SBER911")
    z.refresh_folder(z.FolderRefresh(project="SBER911", folder="/A"), db=None)
    names = {k: c["name"] for k, c in z._index[(CFG["base_url"], "SBER911")]["cases"].items()}
    assert names == {"ICON-T1": "Новое имя 1", "ICON-T3": "Другая папка"}


def test_401_не_маскируется_перебором(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = HTTPException(401, "токен")
    with pytest.raises(HTTPException) as e:
        z.get_index(CFG, "SBER911")
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



def test_проверка_показывает_всё_отслеживание_прогона_без_текста(jira):
    run = {"key": "SBER911-C709", "name": "Секретный прогон", "folder": "/Release 26/НФ", "issueKey": "SBER911-100",
           "issueCount": 3}
    jira["routes"]["/rest/api/2/project/SBER911"] = {"id": "11000"}
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C709"] = run
    jira["routes"]["/rest/atm/1.0/testrun/search"] = lambda p: (
        [{**run, "issueKeys": ["SBER911-100", "SBER911-201", "SBER911-202"]}] if "folder" in p["query"] else [run])
    jira["routes"]["/rest/tests/1.0/testrun/search"] = HTTPException(403, "Jira: нет прав на операцию (403)")
    jira["routes"]["/rest/api/2/issue/SBER911-201/remotelink"] = [
        {"object": {"title": "Секретная ссылка", "url": "https://jira.example/secure/Tests.jspa#/testPlayer/SBER911-C709"}}]
    rep = z.probe(project="SBER911", samples=False, run="sber911-c709", issue="SBER911-201", db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["run-get-v1"]["note"] == "отслеживание: issueKey=[SBER911-100] · issueCount=3"
    assert by["run-trace-folder"]["note"] == (
        "отслеживание: issueKey=[SBER911-100] · issueCount=3 · issueKeys=[SBER911-100, SBER911-201, SBER911-202]")
    assert 'folder = "/Release 26/НФ"' in by["run-trace-folder"]["params"]["query"]
    assert "issueKeys" in by["run-trace-folder-fields"]["params"]["fields"]
    assert by["run-trace-internal"]["status"] == 403
    assert by["issue-remotelinks"]["note"] == "ссылок: 1 · прогоны в них: SBER911-C709"
    assert "Секретн" not in str(rep)                                # ключи и числа — да, текст — нет



def test_проверка_читает_отслеживание_по_числовому_id_и_переводит_в_ключи(jira):
    jira["routes"]["/rest/tests/1.0/testrun/SBER911-C710"] = HTTPException(403, "Jira: нет прав на операцию (403)")
    jira["routes"]["/rest/tests/1.0/testrun/1313743/tracelinks/issue"] = [
        {"id": 1, "issueId": "25075530", "testRunId": 1313743, "type": {"systemKey": "RELATED"}},
        {"id": 2, "issueId": "24913854", "testRunId": 1313743, "type": {"systemKey": "RELATED"}}]
    jira["routes"]["/rest/api/2/search"] = lambda p: {"issues": [
        {"id": "24913854", "key": "SBER911-28847", "fields": {"issuetype": {"name": "Релиз"}}},
        {"id": "25075530", "key": "SBER911-29231", "fields": {"issuetype": {"name": "История"}}}]}
    rep = z.probe(project="SBER911", samples=False, run="SBER911-C710", run_id="1313743", db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["run-id-internal"]["status"] == 403                    # id по ключу не достали — взяли введённый
    assert by["run-tracelinks"]["path"] == "/rest/tests/1.0/testrun/1313743/tracelinks/issue"
    assert by["run-tracelinks"]["note"] == "связей: 2 · issueId: 24913854, 25075530"
    assert ("/rest/api/2/search", {"jql": "id in (24913854,25075530)", "fields": "issuetype", "maxResults": 100}) in jira["calls"]
    assert by["run-tracelinks-keys"]["note"] == "отслеживание: SBER911-28847 (Релиз), SBER911-29231 (История)"


def test_id_прогона_по_ключу_из_внутреннего_api(jira):
    jira["routes"]["/rest/tests/1.0/testrun/SBER911-C710"] = {"id": 1313743, "key": "SBER911-C710"}
    jira["routes"]["/rest/tests/1.0/testrun/1313743/tracelinks/issue"] = []
    rep = z.probe(project="SBER911", samples=False, run="SBER911-C710", db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["run-id-internal"]["note"] == "id 1313743" and by["run-tracelinks"]["note"] == "связей: 0 · issueId: нет"
    assert by["run-tracelinks-keys"]["skipped"]

def test_проверка_отслеживания_пропускается_без_прогона(jira):
    rep = z.probe(project="SBER911", samples=False, db=None)
    by = {r["id"]: r for r in rep["results"]}
    assert by["run-trace-folder"]["skipped"] and by["run-trace-internal"]["skipped"] and by["issue-remotelinks"]["skipped"]
    assert by["run-tracelinks"]["skipped"]

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


def test_кэ_кейса_в_поле_ас_с_кодом_ci_совпадает_с_кэ_релиза():
    case_ke = z._ke_items("Рабочая группа [CI07841867]")
    assert case_ke == [{"id": "CI07841867", "name": "Рабочая группа", "label": "Рабочая группа (CI07841867)"}]
    # В релизе КЭ — опция Jira {id опции, value с кодом}: сравниваем по коду из текста, а не по id опции
    assert z.ke_match(case_ke, z._ke_items({"id": "555", "value": "Рабочая группа [CI07841867]"}))
    assert z.ke_match(case_ke, z._ke_items("ci07841867"))
    assert z.ke_match(case_ke, z._ke_items("Рабочая группа"))
    assert not z.ke_match(case_ke, z._ke_items("Другая группа [CI1]"))


def _case(key, crit="Да", typ="Регресс", ke="Управление приоритетными событиями (3521751)", status="Approved"):
    # «Крит регресс» без точки — проверка, что имя поля сравнивается без точек и пробелов
    return {"key": key, "name": key, "status": status,
            "customFields": {"Крит регресс": crit, "Вид тестирования": typ, "АС": ke}}


def test_отбор_крит_регресса_и_счётчики_отсева():
    cases = [_case("T1"), _case("T2", crit="Нет"), _case("T3", typ="Смоук"), _case("T4", ke="Чужая (9)"), _case("T5", crit=True),
             _case("T6", status="Draft"), _case("T7", status="Утверждено")]
    out, stats = z.crit_filter(cases, z._ke_items(["3521751"]), z.CritCriteria())
    assert [c["key"] for c in out] == ["T1", "T5", "T7"]            # «Утверждено» = Approved
    assert stats == {"checked": 6, "no_status": 1, "no_crit": 1, "no_type": 1, "no_ke": 1}
    assert out[0]["ke"] == ["Управление приоритетными событиями (3521751)"]


def test_релиз_отдаёт_кэ_из_поля_sber911(jira):
    jira["routes"]["/rest/api/2/issue/SBER911-12345"] = {
        "fields": {"summary": "Релиз 2.0", "status": {"name": "Открыт"}, "customfield_18300": [{"id": "3521751", "value": "УПС"}],
                   "customfield_1": "x"},
        "names": {"customfield_18300": "КЭ", "customfield_1": "Прочее"}}
    r = z.release("sber911-12345", db=None)
    assert r["summary"] == "Релиз 2.0" and r["ke"] == [{"id": "3521751", "name": "УПС", "label": "УПС (3521751)"}]
    assert jira["calls"][0][1] == {"expand": "names", "fields": "*all"}


def test_релиз_берёт_только_поле_кэ_без_кэ_дистрибутива(jira):
    jira["routes"]["/rest/api/2/issue/SBER911-12345"] = {
        "fields": {"summary": "Р", "customfield_2": "Рабочая группа [CI07841867]", "customfield_3": "Дистрибутив D-10.074.00 (12)"},
        "names": {"customfield_2": "КЭ:", "customfield_3": "КЭ дистрибутива:"}}
    r = z.release("SBER911-12345", db=None)
    assert [k["id"] for k in r["ke"]] == ["CI07841867"] and r["keSources"] == ["КЭ: (customfield_2)"]


def test_создание_прогона_с_отслеживанием_релиза(jira, monkeypatch):
    sent = {}

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        if method == "GET":   # после создания прогон перечитывается в индекс прогонов
            return {"key": "SBER911-C77", "name": "Крит регресс", "issueKey": "SBER911-12345", "projectKey": "SBER911"}
        sent.update(method=method, path=path, body=json_body)
        return {"key": "SBER911-C77"}
    monkeypatch.setattr(z, "_jira_request", req)
    z._index[(CFG["base_url"], z._runs_key("SBER911"))] = {"loadedAt": 0, "cases": {}, "folders": set()}
    r = z.create_run(z.RunCreate(project="sber911", name="Крит регресс", issueKey="sber911-12345", caseKeys=["T1", "T2", "T1"]), db=None)
    assert r["key"] == "SBER911-C77" and sent["method"] == "POST" and sent["path"] == "/rest/atm/1.0/testrun"
    assert z._index[(CFG["base_url"], z._runs_key("SBER911"))]["cases"]["SBER911-C77"]["issueKey"] == "SBER911-12345"
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


def test_крит_регресс_по_индексу_и_список_полей(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [_case("ICON-T1"), _case("ICON-T2", crit="Нет")] if p["startAt"] == 0 else []
    r = z.crit_cases(z.CritBody(project="SBER911", ke=["3521751"]), db=None)
    assert [c["key"] for c in r["cases"]] == ["ICON-T1"]
    assert set(r["stats"]["fields"]) == {"Крит регресс", "Вид тестирования", "АС"}


def test_применить_дописывает_созданное_в_индекс(jira, monkeypatch):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = _paged(1, 1000)
    z.get_index(CFG, "SBER911")
    real = z._jira_request

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        if method == "POST" and path.endswith("/testcase"):
            return {"key": "ICON-T777"}
        if method == "POST":
            return {"id": 1}
        return real(cfg, method, path, params=params, json_body=json_body, timeout=timeout)
    monkeypatch.setattr(z, "_jira_request", req)
    z.apply_model(z.ApplyBody(project="SBER911", cases=[z.StagedCase(id="x0", name="Новый", folder="/Новая")]), db=None)
    assert z._index[(CFG["base_url"], "SBER911")]["cases"]["ICON-T777"]["folder"] == "/Новая"


# ── Правка структуры ─────────────────────────────────────────────────────────

@pytest.fixture
def model(jira, monkeypatch):
    """Индекс из трёх кейсов + запись всех запросов записи (POST/PUT/DELETE)."""
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [
        {"key": "ICON-T1", "folder": "/Авторизация", "name": "Вход"},
        {"key": "ICON-T2", "folder": "/Авторизация/Негатив", "name": "Неверный пароль"},
        {"key": "ICON-T3", "folder": "/Платежи", "name": "СБП"}] if p["startAt"] == 0 else []
    z.get_index(CFG, "SBER911")
    writes = []
    real = z._jira_request

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        if method != "GET":
            writes.append((method, path, json_body))
            return {"key": "ICON-T50"} if path.endswith("/testcase") else {}
        if path.startswith("/rest/atm/1.0/testcase/ICON-"):
            k = path.rsplit("/", 1)[1]
            c = dict(z._index[(CFG["base_url"], "SBER911")]["cases"].get(k) or {"key": k, "name": "Новый", "folder": "/Платежи"})
            for m, p_, b in writes:
                if p_.endswith(k) and b:
                    c.update(b)
            return c
        return real(cfg, method, path, params=params, json_body=json_body, timeout=timeout)
    monkeypatch.setattr(z, "_jira_request", req)
    return writes


def _cases():
    return {k: c["folder"] for k, c in z._index[(CFG["base_url"], "SBER911")]["cases"].items()}


def test_пустая_папка_видна_в_дереве(model):
    z.create_folder(z.FolderCreate(project="SBER911", path="/Платежи/ /Новая "), db=None)
    assert model == [("POST", "/rest/atm/1.0/folder", {"projectKey": "SBER911", "name": "/Платежи", "type": "TEST_CASE"}),
                     ("POST", "/rest/atm/1.0/folder", {"projectKey": "SBER911", "name": "/Платежи/Новая", "type": "TEST_CASE"})]
    tree = z.tree(project="SBER911", db=None)["folders"]
    pay = next(f for f in tree if f["name"] == "Платежи")
    assert pay["count"] == 1 and pay["children"][0] == {"name": "Новая", "path": "/Платежи/Новая", "count": 0, "children": []}


def test_переименование_папки_переносит_кейсы_с_вложенными(model):
    r = z.move_folder(z.FolderMove(project="SBER911", source="/Авторизация", target="/Вход в систему"), db=None)
    assert r["moved"] == 2 and r["errors"] == []
    assert ("PUT", "/rest/atm/1.0/testcase/ICON-T2", {"folder": "/Вход в систему/Негатив"}) in model
    assert _cases() == {"ICON-T1": "/Вход в систему", "ICON-T2": "/Вход в систему/Негатив", "ICON-T3": "/Платежи"}
    assert [f["name"] for f in z.tree(project="SBER911", db=None)["folders"]] == ["Вход в систему", "Платежи"]


def test_папку_нельзя_внутрь_самой_себя(model):
    with pytest.raises(HTTPException) as e:
        z.move_folder(z.FolderMove(project="SBER911", source="/Авторизация", target="/Авторизация/Негатив/Х"), db=None)
    assert e.value.status_code == 422 and model == []


def test_перенос_кейсов_в_папку(model):
    r = z.move_cases(z.CasesMove(project="SBER911", keys=["ICON-T1", "ICON-T3", "ICON-T3"], folder="/Платежи"), db=None)
    assert r["moved"] == 1 and _cases()["ICON-T1"] == "/Платежи"         # T3 уже там — не трогаем


def test_правка_кейса_только_переданные_поля_шаги_целиком(model):
    out = z.update_case("icon-t1", z.CaseEdit(project="SBER911", name=" Вход по паролю ",
                                              steps=[z.StagedStep(description="Открыть", expectedResult="Открыто")]), db=None)
    put = [w for w in model if w[0] == "PUT"][0]
    assert put == ("PUT", "/rest/atm/1.0/testcase/ICON-T1", {"name": "Вход по паролю", "testScript": {
        "type": "STEP_BY_STEP", "steps": [{"description": "Открыть", "testData": "", "expectedResult": "Открыто"}]}})
    assert out["name"] == "Вход по паролю"


def test_удаление_кейса_убирает_из_модели(model):
    z.delete_case("ICON-T3", project="SBER911", db=None)
    assert ("DELETE", "/rest/atm/1.0/testcase/ICON-T3", None) in model and "ICON-T3" not in _cases()


# ── Релизы: стори, прогоны, маркеры ──────────────────────────────────────────

def _run(key, issue="", typ="Регресс"):
    return {"key": key, "name": key, "issueKey": issue, "customFields": {"Вид тестирования": typ},
            "items": [{"testCaseKey": "ICON-T1", "status": "Pass"}]}


def _release_route(jira):
    jira["routes"]["/rest/api/2/issue/SBER911-100"] = {
        "fields": {"summary": "Релиз 26", "status": {"name": "Открыт"}, "customfield_2": "Рабочая группа [CI07841867]",
                   "issuelinks": [
                       {"type": {"name": "Relates", "outward": "включает", "inward": "входит в"},
                        "outwardIssue": {"key": "SBER911-11", "fields": {"summary": "Стори А", "status": {"name": "Готово"}, "issuetype": {"name": "История"}}}},
                       {"type": {"name": "Relates", "outward": "включает", "inward": "входит в"},
                        "inwardIssue": {"key": "SBER911-12", "fields": {"summary": "Стори Б", "status": {"name": "В работе"}, "issuetype": {"name": "История"}}}}]},
        "names": {"customfield_2": "КЭ"}}


def test_прогон_знает_свой_вид_тестирования():
    assert z.norm_run(_run("SBER911-C1", typ="Новый функционал"))["type"] == "Новый функционал"


def test_стори_релиза_по_связям_задачи(jira):
    _release_route(jira)
    r = z.release("SBER911-100", db=None)
    assert [(s["key"], s["summary"], s["link"]) for s in r["stories"]] == [("SBER911-11", "Стори А", "включает"),
                                                                            ("SBER911-12", "Стори Б", "входит в")]


def test_строка_релиза_без_поиска_по_отслеживанию_считает_по_issuekey(jira):
    _release_route(jira)
    def search(p):
        if "issueKeys" in p["query"]:
            raise HTTPException(400, "Jira: unknown field issueKeys")
        return [_run("SBER911-C1", "SBER911-100"), _run("SBER911-C2", "SBER911-11", "Новый функционал"),
                _run("SBER911-C4", "SBER911-999")] if p["startAt"] == 0 else []
    jira["routes"]["/rest/atm/1.0/testrun/search"] = search
    b = z.release_board("SBER911-100", project="SBER911", db=None)
    assert b["traceSource"] == "issueKey"
    assert [r["key"] for r in b["runs"]] == ["SBER911-C1"] and b["runs"][0]["type"] == "Регресс"
    assert [r["key"] for r in b["storyRuns"]["SBER911-11"]] == ["SBER911-C2"] and b["storyRuns"]["SBER911-12"] == []


def test_строка_релиза_по_всему_отслеживанию_прогонов(jira):
    """Прогоны C1, C2 — с релизом в отслеживании; стори 11 есть в отслеживании C2, стори 12 — только в чужом C9."""
    _release_route(jira)
    trace = {"SBER911-100": ["SBER911-C1", "SBER911-C2"], "SBER911-11": ["SBER911-C2"], "SBER911-12": ["SBER911-C9"]}
    def search(p):
        q = p["query"]
        issue = q.split('issueKeys IN ("')[1].split('"')[0]
        assert p["fields"] == z.RUN_FIELDS
        return [_run(k, "SBER911-100") for k in trace.get(issue, [])]
    jira["routes"]["/rest/atm/1.0/testrun/search"] = search
    b = z.release_board("SBER911-100", project="SBER911", db=None)
    assert b["traceSource"] == "tql"
    assert [r["key"] for r in b["runs"]] == ["SBER911-C2", "SBER911-C1"]
    assert [r["key"] for r in b["storyRuns"]["SBER911-11"]] == ["SBER911-C2"]
    assert b["storyRuns"]["SBER911-12"] == []            # C9 не прогон релиза — стори не покрыта


def test_релизы_в_simpletest_добавить_убрать(jira):
    z.releases_add(z.ReleaseAdd(project="sber911", key="sber911-1"))
    z.releases_add(z.ReleaseAdd(project="SBER911", key="SBER911-2"))
    assert z.releases_list(project="SBER911")["releases"] == ["SBER911-2", "SBER911-1"]
    z.releases_remove("SBER911-1", project="SBER911")
    assert z.releases_list(project="SBER911") == {"releases": ["SBER911-2"]}
    with pytest.raises(HTTPException):
        z.releases_add(z.ReleaseAdd(project="SBER911", key="релиз"))


def test_список_прогонов_из_индекса_новые_сверху(jira):
    jira["routes"]["/rest/atm/1.0/testrun/search"] = lambda p: [_run("SBER911-C2"), _run("SBER911-C10")] if p["startAt"] == 0 else []
    assert [r["key"] for r in z.runs(project="SBER911", db=None)["runs"]] == ["SBER911-C10", "SBER911-C2"]
    jira["calls"].clear()
    z.runs(project="SBER911", db=None)
    assert jira["calls"] == []                                       # второй раз — из индекса


def test_значения_полей_для_выпадающих_списков(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [
        {"key": "ICON-T1", "status": "Approved", "customFields": {"Крит. регресс": True, "Вид тестирования": "Регресс"}},
        {"key": "ICON-T2", "status": "Approved", "customFields": {"Крит. регресс": False, "Вид тестирования": "Регресс"}},
        {"key": "ICON-T3", "status": "Draft", "customFields": {"Вид тестирования": "Новый функционал", "Домен": ["Sigma", "Omega"]}},
    ] if p["startAt"] == 0 else []
    v = z.field_values(project="SBER911", db=None)
    assert v["statuses"] == ["Approved", "Draft"]
    assert v["fields"]["Вид тестирования"] == ["Регресс", "Новый функционал"]
    assert set(v["fields"]["Крит. регресс"]) == {"Да", "Нет"} and v["fields"]["Домен"] == ["Omega", "Sigma"]


# ── Прогон регресса: создание с релизом в отслеживании ──────────────────────

def _create_env(monkeypatch, reject_custom=False, tracked="SBER911-100"):
    sent = []
    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        if method == "GET":
            return {"key": "SBER911-C9", "issueKey": tracked, "projectKey": "SBER911", "customFields": {"Вид тестирования": "Регресс"}}
        sent.append(json_body)
        if reject_custom and "customFields" in json_body:
            raise HTTPException(400, "Jira: customFields: unknown field")
        return {"key": "SBER911-C9"}
    monkeypatch.setattr(z, "_jira_request", req)
    return sent


def test_прогон_регресса_с_релизом_и_видом_тестирования(jira, monkeypatch):
    sent = _create_env(monkeypatch)
    r = z.create_run(z.RunCreate(project="SBER911", name="Регресс", issueKey="sber911-100", caseKeys=["T1"], type="Регресс"), db=None)
    assert sent == [{"projectKey": "SBER911", "name": "Регресс", "items": [{"testCaseKey": "T1"}], "issueKey": "SBER911-100",
                     "customFields": {"Вид тестирования": "Регресс"}}]
    assert r["issueKey"] == "SBER911-100" and r["warnings"] == []


def test_вид_тестирования_не_принят_создаю_без_него(jira, monkeypatch):
    sent = _create_env(monkeypatch, reject_custom=True)
    r = z.create_run(z.RunCreate(project="SBER911", name="Регресс", issueKey="SBER911-100", caseKeys=["T1"], type="Регресс"), db=None)
    assert len(sent) == 2 and "customFields" not in sent[1] and sent[1]["issueKey"] == "SBER911-100"
    assert r["key"] == "SBER911-C9" and "Вид тестирования" in r["warnings"][0]


def test_предупреждаю_если_релиз_не_встал_в_отслеживание(jira, monkeypatch):
    _create_env(monkeypatch, tracked="")
    r = z.create_run(z.RunCreate(project="SBER911", name="Регресс", issueKey="SBER911-100", caseKeys=["T1"]), db=None)
    assert r["issueKey"] == "" and "не поставил SBER911-100" in r["warnings"][0]


def test_весь_регресс_по_кэ_без_признака_крит():
    cases = [_case("T1"), _case("T2", crit="Нет"), _case("T3", typ="Смоук")]
    out, _ = z.crit_filter(cases, z._ke_items(["3521751"]), z.CritCriteria(only_crit=False))
    assert [c["key"] for c in out] == ["T1", "T2"]


def test_прогоны_грузятся_лёгкими_страницами_без_строк_кейсов(jira):
    calls = []
    def r(p):
        calls.append(p)
        return [_run(f"SBER911-C{i}") for i in range(p["startAt"], min(p["startAt"] + p["maxResults"], 120))]
    jira["routes"]["/rest/atm/1.0/testrun/search"] = r
    assert len(z.runs(project="SBER911", db=None)["runs"]) == 120
    assert all(c["maxResults"] == z.RUN_PAGE and c["fields"] == z.RUN_FIELDS for c in calls)
    assert "items" not in z.RUN_FIELDS and "executionSummary" in z.RUN_FIELDS


def test_прогоны_fields_не_принят_гружу_целиком(jira):
    def r(p):
        if "fields" in p:
            raise HTTPException(400, "Jira: fields")
        return [_run("SBER911-C1")] if p["startAt"] == 0 else []
    jira["routes"]["/rest/atm/1.0/testrun/search"] = r
    jira["routes"]["/rest/atm/1.0/testcycle/search"] = HTTPException(404, "Jira: not found")
    assert [x["key"] for x in z.runs(project="SBER911", db=None)["runs"]] == ["SBER911-C1"]


def test_прогресс_прогона_из_сводки_без_строк_кейсов():
    r = z.norm_run({"key": "SBER911-C1", "testCaseCount": 40, "executionSummary": {"Pass": 30, "Fail": 2}})
    assert r["total"] == 40 and r["counts"] == {"Pass": 30, "Fail": 2}


def test_первая_страница_не_успела_пробую_поменьше(jira):
    def r(p):
        if p["maxResults"] > z.SMALL_PAGE:
            raise HTTPException(502, "Jira недоступна: Read timed out. (read timeout=90)")
        return [_run(f"SBER911-C{i}") for i in range(p["startAt"], min(p["startAt"] + p["maxResults"], 25))]
    jira["routes"]["/rest/atm/1.0/testrun/search"] = r
    assert len(z.runs(project="SBER911", db=None)["runs"]) == 25


# ── Прогон: кейсы с названиями, «Пройти прогон»; массовые правки кейсов ─────

def test_прогон_с_названиями_кейсов_и_временем_прохождения(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [{"key": "ICON-T1", "name": "Вход"}] if p["startAt"] == 0 else []
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C1"] = {"key": "SBER911-C1", "projectKey": "SBER911", "createdOn": "2026-10-01T09:00:00Z",
                                                          "items": [{"testCaseKey": "ICON-T1", "status": "Pass"}]}
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C1/testresults"] = [{"testCaseKey": "ICON-T1", "status": "Pass", "executionTime": 65000}]
    r = z.run("SBER911-C1", db=None)
    assert r["created"] == "2026-10-01T09:00:00Z"
    it = r["items"][0]
    assert (it["name"], it["executionTime"], it["status"]) == ("Вход", 65000, "Pass")


def test_пройти_прогон_ставит_pass_только_непройденным(jira, monkeypatch):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: []
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C1"] = {"key": "SBER911-C1", "projectKey": "SBER911",
        "items": [{"testCaseKey": "T1", "status": "Pass"}, {"testCaseKey": "T2", "status": "Fail"}, {"testCaseKey": "T3"}]}
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C1/testresults"] = []
    sent = {}
    monkeypatch.setattr(z, "_write_variants", lambda cfg, kind, method, variants: sent.update(body=variants[0][1]) or {})
    r = z.pass_run("SBER911-C1", db=None)
    assert [x["testCaseKey"] for x in sent["body"]] == ["T2", "T3"] and all(x["status"] == "Pass" for x in sent["body"])
    assert (r["saved"], r["skipped"], r["total"]) == (2, 1, 3)


def test_удалить_несколько_кейсов(jira, monkeypatch):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [{"key": "T1"}, {"key": "T2"}, {"key": "T3"}] if p["startAt"] == 0 else []
    z.get_index(CFG, "SBER911")
    calls = []
    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        calls.append((method, path))
        if path.endswith("/T2"):
            raise HTTPException(403, "Jira: нет прав на операцию (403)")
        return {}
    monkeypatch.setattr(z, "_jira_request", req)
    r = z.delete_cases(z.CasesBulk(project="SBER911", keys=["t1", "T2", "T3"]), db=None)
    assert sorted(r["deleted"]) == ["T1", "T3"] and r["errors"][0]["key"] == "T2"
    assert sorted(z._index[(CFG["base_url"], "SBER911")]["cases"]) == ["T2"]


def test_изменить_несколько_кейсов_метки_добавляются(jira, monkeypatch):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [{"key": "T1", "labels": ["старая"]}, {"key": "T2"}] if p["startAt"] == 0 else []
    z.get_index(CFG, "SBER911")
    puts = {}
    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        k = path.rsplit("/", 1)[1]
        if method == "PUT":
            puts[k] = json_body
            return {}
        return {"key": k, "status": "Approved", "labels": puts[k].get("labels", [])}
    monkeypatch.setattr(z, "_jira_request", req)
    r = z.edit_cases(z.CasesEdit(project="SBER911", keys=["T1", "T2"], status="Approved", labelsAdd=["регресс"],
                                 customFields={"Крит. регресс": True}), db=None)
    assert sorted(r["updated"]) == ["T1", "T2"] and r["errors"] == []
    assert puts["T1"] == {"status": "Approved", "customFields": {"Крит. регресс": True}, "labels": ["старая", "регресс"]}
    assert puts["T2"]["labels"] == ["регресс"]
    with pytest.raises(HTTPException):
        z.edit_cases(z.CasesEdit(project="SBER911", keys=["T1"]), db=None)


# ── Выравнивание КЭ релиза на стори ──────────────────────────────────────────

KE_A = {"id": "1", "value": "Платформа [CI001]"}
KE_B = {"id": "2", "value": "Мобильное приложение [CI002]"}
KE_C = {"id": "3", "value": "Своя КЭ стори [CI003]"}


def _ke_release(jira, story_ke: dict, meta: dict | None = None):
    """Релиз с КЭ A и B, связанные стори и дефект; story_ke — КЭ стори; meta — поле КЭ в editmeta."""
    link = lambda k, t: {"type": {"outward": "включает"}, "outwardIssue": {"key": k, "fields": {"summary": k, "issuetype": {"name": t}, "status": {"name": "Открыт"}}}}
    jira["routes"]["/rest/api/2/issue/SBER911-100"] = {
        "names": {"customfield_18300": "КЭ", "customfield_1": "КЭ дистрибутива"},
        "fields": {"summary": "Релиз", "customfield_18300": [KE_A, KE_B], "customfield_1": "D-10",
                   "issuelinks": [link("SBER911-1", "История"), link("SBER911-2", "Story"), link("SBER911-9", "Дефект")]}}
    for k, v in story_ke.items():
        jira["routes"][f"/rest/api/2/issue/{k}"] = {"fields": {"customfield_18300": v}}
    if meta is None:
        meta = {"schema": {"type": "array", "custom": "ke"}, "operations": ["add", "set", "remove"]}
    jira["routes"]["/rest/api/2/issue/SBER911-1/editmeta"] = {"fields": {"customfield_18300": meta} if meta else {}}


def test_план_кэ_показывает_недостающие_и_проверку_поля(jira):
    _ke_release(jira, {"SBER911-1": [KE_A, KE_C], "SBER911-2": [KE_A, KE_B]})
    plan = z.release_ke_plan("sber911-100", db=None)
    st = {x["key"]: x for x in plan["stories"]}
    assert set(st) == {"SBER911-1", "SBER911-2"}                                  # дефект — не стори
    assert st["SBER911-1"]["missing"] == ["Мобильное приложение (CI002)"] and st["SBER911-2"]["missing"] == []
    assert "raw" not in st["SBER911-1"] and "missingRaw" not in st["SBER911-1"]
    assert plan["release"]["field"] == "customfield_18300" and plan["mode"] == "set"
    assert plan["check"]["schema"]["type"] == "array" and plan["check"]["story"] == "SBER911-1"


def test_запись_кэ_дописывает_недостающие_и_не_трогает_свои(jira, monkeypatch):
    _ke_release(jira, {"SBER911-1": [KE_A, KE_C], "SBER911-2": [KE_A, KE_B]})
    sent = []
    real = z._jira_request
    monkeypatch.setattr(z, "_jira_request", lambda cfg, m, p, **kw: sent.append((p, kw.get("json_body"))) or {} if m == "PUT" else real(cfg, m, p, **kw))
    out = z.release_ke_apply("SBER911-100", z.KeApplyBody(), db=None)
    assert sent == [("/rest/api/2/issue/SBER911-1", {"fields": {"customfield_18300": [KE_A, KE_C, KE_B]}})]
    assert out["results"] == [{"key": "SBER911-1", "ok": True, "added": ["Мобильное приложение (CI002)"]}]


def test_запись_кэ_операцией_add_если_set_нет(jira, monkeypatch):
    _ke_release(jira, {"SBER911-1": [], "SBER911-2": [KE_B]}, {"schema": {"type": "array"}, "operations": ["add", "remove"]})
    sent = []
    real = z._jira_request
    monkeypatch.setattr(z, "_jira_request", lambda cfg, m, p, **kw: sent.append((p, kw.get("json_body"))) or {} if m == "PUT" else real(cfg, m, p, **kw))
    z.release_ke_apply("SBER911-100", z.KeApplyBody(stories=["SBER911-2"]), db=None)
    assert sent == [("/rest/api/2/issue/SBER911-2", {"update": {"customfield_18300": [{"add": KE_A}]}})]


def test_запись_кэ_запрещена_если_поля_нет_на_экране_или_оно_одно(jira):
    _ke_release(jira, {"SBER911-1": [], "SBER911-2": []}, {})
    plan = z.release_ke_plan("SBER911-100", db=None)
    assert plan["mode"] == "" and "экране" in plan["blocked"]
    with pytest.raises(HTTPException) as e:
        z.release_ke_apply("SBER911-100", z.KeApplyBody(), db=None)
    assert e.value.status_code == 409
    _ke_release(jira, {"SBER911-1": [], "SBER911-2": []}, {"schema": {"type": "option"}, "operations": ["set"]})
    assert "одно значение" in z.release_ke_plan("SBER911-100", db=None)["blocked"]


def test_ошибка_jira_по_одной_стори_не_останавливает_остальные(jira, monkeypatch):
    _ke_release(jira, {"SBER911-1": [], "SBER911-2": []})
    real = z._jira_request

    def req(cfg, m, p, **kw):
        if m == "PUT":
            if p.endswith("SBER911-1"):
                raise HTTPException(400, "Jira: customfield_18300: неверное значение")
            return {}
        return real(cfg, m, p, **kw)
    monkeypatch.setattr(z, "_jira_request", req)
    res = {r["key"]: r for r in z.release_ke_apply("SBER911-100", z.KeApplyBody(), db=None)["results"]}
    assert not res["SBER911-1"]["ok"] and "неверное значение" in res["SBER911-1"]["error"]
    assert res["SBER911-2"]["ok"]


# ── НФ-прогоны релиза и покрытие стори — расчёт у нас ────────────────────────

def _nf_search(jira):
    """Прогоны: C1 — регресс релиза, C2 — НФ релиза (стори 11 в названии), C3 — НФ без релиза (видна стори)."""
    def search(p):
        if "issueKeys" in p["query"]:
            raise HTTPException(400, "Jira: unknown field issueKeys")
        if p["startAt"]:
            return []
        c2 = {**_run("SBER911-C2", "SBER911-100", "Новый функционал"), "name": "НФ-SBER911-11 · Стори А"}
        return [_run("SBER911-C1", "SBER911-100"), c2, _run("SBER911-C3", "SBER911-12", "Новый функционал")]
    jira["routes"]["/rest/atm/1.0/testrun/search"] = search


def test_нф_прогоны_релиза_сохраняются_и_дополняются_руками(jira):
    _release_route(jira); _nf_search(jira)
    b = z.release_board("SBER911-100", project="SBER911", db=None)
    assert [r["key"] for r in b["nfRuns"]] == ["SBER911-C2"]            # регресс и чужой НФ — не в списке
    # C3 API с релизом не показывает (видна стори) — добавляем руками; C2 убираем — сверка его не вернёт
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C3"] = {**_run("SBER911-C3", "SBER911-12", "Новый функционал"), "name": "НФ общий"}
    z.release_nf_runs("SBER911-100", z.NfRunsEdit(project="SBER911", add="sber911-c3"), db=None)
    z.release_nf_runs("SBER911-100", z.NfRunsEdit(project="SBER911", remove="SBER911-C2"), db=None)
    b = z.release_board("SBER911-100", project="SBER911", db=None)
    assert [r["key"] for r in b["nfRuns"]] == ["SBER911-C3"]
    with pytest.raises(HTTPException):
        z.release_nf_runs("SBER911-100", z.NfRunsEdit(project="SBER911", add="не прогон"), db=None)


def test_покрытие_стори_авто_по_названию_и_issuekey_и_ручная_правка(jira):
    _release_route(jira); _nf_search(jira)
    z.release_board("SBER911-100", project="SBER911", db=None)
    jira["routes"]["/rest/atm/1.0/testrun/SBER911-C3"] = {**_run("SBER911-C3", "SBER911-12", "Новый функционал"), "name": "НФ общий"}
    z.release_nf_runs("SBER911-100", z.NfRunsEdit(project="SBER911", add="SBER911-C3"), db=None)
    cov = z.release_coverage("SBER911-100", z.CoverageBody(project="SBER911"), db=None)
    assert cov["stories"]["SBER911-11"] == [{"run": "SBER911-C2", "auto": True}]     # номер в названии
    assert cov["stories"]["SBER911-12"] == [{"run": "SBER911-C3", "auto": True}]     # issueKey
    assert (cov["covered"], cov["total"]) == (2, 2)
    # ручная правка: стори 11 есть и в общем C3; у стори 12 C3 снимаем — Jira не трогаем
    z.release_coverage_manual("SBER911-100", z.CoverageManual(project="SBER911", story="SBER911-11", run="SBER911-C3", linked=True))
    cov = z.release_coverage_manual("SBER911-100", z.CoverageManual(project="SBER911", story="SBER911-12", run="SBER911-C3", linked=False))
    assert [x["run"] for x in cov["stories"]["SBER911-11"]] == ["SBER911-C2", "SBER911-C3"]
    assert cov["stories"]["SBER911-11"][1] == {"run": "SBER911-C3", "auto": False, "manual": True}
    assert cov["stories"]["SBER911-12"] == [] and cov["covered"] == 1
    cov = z.release_coverage_manual("SBER911-100", z.CoverageManual(project="SBER911", story="SBER911-12", run="SBER911-C3", linked=None))
    assert cov["stories"]["SBER911-12"] == [{"run": "SBER911-C3", "auto": True}]     # вернули авто
    assert z.release_board("SBER911-100", project="SBER911", db=None)["coverage"]["covered"] == 2


def test_номер_стори_в_названии_не_путается_с_длинным():
    info = {"name": "НФ-SBER911-29231 · тема", "issueKey": ""}
    assert z.story_in_run("SBER911-29231", info)
    assert not z.story_in_run("SBER911-2923", info)
    assert not z.story_in_run("SBER911-9231", info)
    assert z.is_nf_type("Новый функционал") and z.is_nf_type("НФ") and not z.is_nf_type("Регресс")


# ── Выгрузка модели, вложенные папки, удаление папки ─────────────────────────

def test_кейсы_папки_с_вложенными_по_тумблеру(model):
    keys = lambda r: [c["key"] for c in r["cases"]]
    assert keys(z.cases(project="SBER911", folder="/Авторизация", db=None)) == ["ICON-T1"]
    assert keys(z.cases(project="SBER911", folder="/Авторизация", children=True, db=None)) == ["ICON-T1", "ICON-T2"]
    # «/Авторизация2» — не вложенная в «/Авторизация», хоть и начинается так же
    assert not z.in_folder("/Авторизация2", "/Авторизация", True)


def test_ключи_и_папки_под_папкой_включая_пустые(model):
    z.create_folder(z.FolderCreate(project="SBER911", path="/Авторизация/Пустая/Глубже"), db=None)
    r = z.folder_keys(z.FolderKeys(project="SBER911", folder="/Авторизация"), db=None)
    assert r["keys"] == ["ICON-T1", "ICON-T2"]
    assert r["folders"] == ["/Авторизация", "/Авторизация/Негатив", "/Авторизация/Пустая", "/Авторизация/Пустая/Глубже"]
    assert len(z.folder_keys(z.FolderKeys(project="SBER911"), db=None)["keys"]) == 3        # весь проект


def test_выгрузка_xml_туда_и_обратно_все_поля():
    cases = [{
        "key": "ICON-T1", "name": "Вход <по> паролю & ]]> хвост", "folder": "/Авторизация/Негатив", "objective": "Цель",
        "precondition": "<p>Есть учётка</p>", "priority": "High", "status": "Approved", "labels": ["регресс", "web"],
        "owner": "ivanov", "issueLinks": ["SBER911-5", "SBER911-6"], "estimatedTime": 300000,
        "customFields": {"Крит. регресс": True, "Команда": "QA", "Баллы": 3, "КЭ": ["CI01", "CI02"], "Пусто": ""},
        "steps": [{"description": "Открыть", "testData": "user1", "expectedResult": "Открыта"},
                  {"description": "Нажать", "testData": "", "expectedResult": "Вход"}],
    }]
    xml = z.build_zephyr_xml("SBER911", ["/Авторизация", "/Авторизация/Негатив", "/Авторизация/Пустая"], cases)
    back = z.parse_zephyr_xml(xml)
    assert back["folders"] == ["/Авторизация", "/Авторизация/Негатив", "/Авторизация/Пустая"]   # пустая папка тоже
    c = back["cases"][0]
    for k in ("name", "folder", "objective", "precondition", "priority", "status", "labels", "issueLinks", "estimatedTime"):
        assert c[k] == cases[0][k], k
    assert c["customFields"] == {"Крит. регресс": True, "Команда": "QA", "Баллы": 3, "КЭ": ["CI01", "CI02"]}
    assert c["steps"] == [{k: s[k] for k in ("description", "testData", "expectedResult")} for s in cases[0]["steps"]]


def test_выгрузка_полных_кейсов_пачкой_по_порядку(jira):
    for k in ("T1", "T2"):
        jira["routes"][f"/rest/atm/1.0/testcase/{k}"] = {"key": k, "name": k, "folder": "/A", "testScript": {"steps": [{"description": "шаг"}]}}
    r = z.export_cases(z.ExportKeys(project="SBER911", keys=["t2", "T1", "T9"]), db=None)
    assert [c["key"] for c in r["cases"]] == ["T2", "T1"] and r["cases"][0]["steps"][0]["description"] == "шаг"
    assert r["errors"][0]["key"] == "T9"


def test_пачка_кейсов_без_повторного_создания_папок_со_связями(jira, monkeypatch):
    calls = []

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        calls.append((path, json_body))
        return {"key": "SBER911-T1"} if path.endswith("/testcase") else {"id": 1}
    monkeypatch.setattr(z, "_jira_request", req)
    r = z.apply_model(z.ApplyBody(project="SBER911", skipFolders=True, cases=[
        z.StagedCase(id="x0", name="Кейс", folder="/A/B", issueLinks=["SBER911-5"], estimatedTime=60000)]), db=None)
    assert r["created"] == 1 and not any(p.endswith("/folder") for p, _ in calls)
    assert calls[0][1]["issueLinks"] == ["SBER911-5"] and calls[0][1]["estimatedTime"] == 60000


def test_удаление_папки_убирает_её_из_дерева_если_кейсов_не_осталось(model):
    z.create_folder(z.FolderCreate(project="SBER911", path="/Авторизация/Пустая"), db=None)
    z.delete_cases(z.CasesBulk(project="SBER911", keys=["ICON-T1", "ICON-T2"]), db=None)
    r = z.forget_folder(z.FolderForget(project="SBER911", folder="/Авторизация"), db=None)
    assert r["casesLeft"] == 0
    paths = [n["path"] for n in z.tree(project="SBER911", db=None)["folders"]]
    assert paths == ["/Платежи"]
    assert [m for m, p, _ in model if m == "DELETE"] == ["DELETE", "DELETE"]          # кейсы удалены в Jira


def test_выгрузка_пачками_склеивается_в_тот_же_файл(jira):
    """Файл выгрузки склеивается из кусков пачек (export/cases xml=true) и рамки (export/frame) — без отправки
    всех кейсов обратно на сервер (прокси Next режет тело на 10 МБ)."""
    keys = [f"T{i}" for i in range(5)]
    for k in keys:
        jira["routes"][f"/rest/atm/1.0/testcase/{k}"] = {"key": k, "name": f"Кейс {k}", "folder": "/A/B",
                                                          "testScript": {"steps": [{"description": "шаг", "expectedResult": "ок"}]}}
    parts, start = [], 0
    for chunk in (keys[:2], keys[2:]):
        r = z.export_cases(z.ExportKeys(project="SBER911", keys=chunk, xml=True, start=start), db=None)
        parts.append(r["xml"]); start += r["count"]
    frame = z.export_frame(z.ExportFrame(project="SBER911", folders=["/A", "/A/B"]))
    glued = frame["head"] + "".join(parts) + frame["tail"]
    back = z.parse_zephyr_xml(glued)
    assert [c["name"] for c in back["cases"]] == [f"Кейс {k}" for k in keys]
    assert back["folders"] == ["/A", "/A/B"] and back["cases"][4]["steps"][0]["expectedResult"] == "ок"
    assert 'id="5"' in glued                                       # нумерация сквозная между пачками


# ── Фильтры, сортировка и массовая правка ────────────────────────────────────

def test_список_кейсов_с_пользовательскими_полями_без_обрезки(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [
        {"key": f"T{i}", "folder": "/A", "name": f"К{i}", "customFields": {"Крит. регресс": i % 2 == 0, "КЭ": ["CI1", "CI2"], "Пусто": None}}
        for i in range(2500)] if p["startAt"] == 0 else []
    r = z.cases(project="SBER911", folder="/A", db=None)
    assert r["total"] == 2500 and len(r["cases"]) == 2500                    # раньше — первые 2000
    assert r["cases"][0]["customFields"] == {"Крит. регресс": "Да", "КЭ": ["CI1", "CI2"]}


def test_значения_полей_с_типами(jira):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [
        {"key": "T1", "status": "Approved", "priority": "High", "owner": "ivanov", "labels": ["web"],
         "customFields": {"Крит": True, "КЭ": ["CI1"], "Баллы": 3, "Команда": "QA"}},
        {"key": "T2", "status": "Draft", "priority": "Normal", "customFields": {"Крит": False, "КЭ": "CI2", "Команда": "Dev"}},
    ] if p["startAt"] == 0 else []
    r = z.field_values(project="SBER911", db=None)
    assert r["kinds"] == {"Крит": "bool", "КЭ": "multi", "Баллы": "number", "Команда": "text"}
    assert set(r["priorities"]) == {"High", "Normal"} and r["owners"] == ["ivanov"] and r["labels"] == ["web"]
    assert set(r["fields"]["КЭ"]) == {"CI1", "CI2"}


def test_массовая_правка_любых_полей(jira, monkeypatch):
    jira["routes"]["/rest/atm/1.0/testcase/search"] = lambda p: [
        {"key": "T1", "labels": ["старая", "убрать"], "issueLinks": ["SBER911-1"]}] if p["startAt"] == 0 else []
    z.get_index(CFG, "SBER911")
    puts = {}

    def req(cfg, method, path, params=None, json_body=None, timeout=30, **kw):
        k = path.rsplit("/", 1)[1]
        if method == "PUT":
            puts[k] = json_body
            return {}
        return {"key": k, **puts.get(k, {})}
    monkeypatch.setattr(z, "_jira_request", req)
    r = z.edit_cases(z.CasesEdit(project="SBER911", keys=["T1"], owner="petrov", estimatedTime=600000, objective="Цель",
                                 labelsAdd=["новая"], labelsRemove=["Убрать"], issueLinksAdd=["sber911-2"],
                                 customFields={"КЭ": ["CI1", "CI2"]}), db=None)
    assert r["updated"] == ["T1"]
    assert puts["T1"] == {"owner": "petrov", "objective": "Цель", "estimatedTime": 600000, "customFields": {"КЭ": ["CI1", "CI2"]},
                          "labels": ["старая", "новая"], "issueLinks": ["SBER911-1", "SBER911-2"]}
