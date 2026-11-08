"""Мок Bitbucket (Stash), Allure TestOps и Jenkins для «Трекинга AQA»."""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any, Optional

from backend.mock.common import PEOPLE, Reply, ms, not_found, now, ok, rng

# ── Bitbucket ────────────────────────────────────────────────────────────────

BRANCHES = ["master", "develop", "feature/SBER911-1204-notify-tests", "feature/SBER911-1188-map-filters",
            "bugfix/SBER911-1301-flaky-login", "release/R26.11"]
_MSGS = ["SBER911-{n}: автотесты для {s}", "SBER911-{n}: починил нестабильный тест {s}", "Рефакторинг шагов {s}",
         "SBER911-{n}: новые проверки {s}", "Обновил тестовые данные {s}", "Merge pull request #{n} from feature/{s}"]
_SUBJ = ["карточки инцидента", "уведомлений", "карты", "личного кабинета", "отчётов", "API заявок"]
_FILES = ["src/test/java/ru/sber/aqa/tests/IncidentCardTest.java", "src/test/java/ru/sber/aqa/steps/NotifySteps.java",
          "src/test/resources/data/incidents.yml", "src/main/java/ru/sber/aqa/api/ApiClient.java", "pom.xml",
          "src/test/java/ru/sber/aqa/pages/MapPage.java", "Jenkinsfile"]


def _commits(branch: str) -> list[dict]:
    out = []
    t = now()
    r = rng("bb", branch)
    for i in range(70 if branch in ("", "master", "refs/heads/master") else 25):
        t -= timedelta(hours=r.randint(1, 14), minutes=r.randint(0, 59))
        cid = f"{rng('cid', branch, i).getrandbits(160):040x}"
        a = r.choice(PEOPLE)
        msg = r.choice(_MSGS).format(n=r.randint(1000, 1400), s=r.choice(_SUBJ))
        out.append({"id": cid, "displayId": cid[:11], "message": msg,
                    "author": {"name": a["name"], "displayName": a["displayName"], "emailAddress": a["email"]},
                    "authorTimestamp": ms(t), "committerTimestamp": ms(t),
                    "parents": [{"id": "0" * 40}, {"id": "1" * 40}] if msg.startswith("Merge") else [{"id": "0" * 40}]})
    return out


def _commit(cid: str) -> dict:
    for b in ("", "develop"):
        for c in _commits(b):
            if c["id"] == cid or c["displayId"] == cid:
                return c
    r = rng("c1", cid)
    a = r.choice(PEOPLE)
    return {"id": cid, "displayId": cid[:11], "message": "Мок-коммит", "author": {"name": a["name"], "displayName": a["displayName"]},
            "authorTimestamp": ms(now()), "parents": [{"id": "0" * 40}]}


def _changes(cid: str) -> list[dict]:
    r = rng("ch", cid)
    files = r.sample(_FILES, r.randint(1, 5))
    return [{"path": {"toString": f}, "type": r.choice(["MODIFY", "MODIFY", "ADD", "DELETE"]), "srcPath": None} for f in files]


def _diff_for(cid: str, path: str) -> dict:
    r = rng("df", cid, path)
    lines_before = [f"    // строка {i}" for i in range(1, 6)]
    removed = [{"line": f"    assertEquals(\"Ожидали {i}\", expected, actual);"} for i in range(r.randint(0, 4))]
    added = [{"line": f"    step(\"Проверить {r.choice(_SUBJ)}\", () -> page.shouldBeVisible());"} for _ in range(r.randint(1, 8))]
    return {"source": {"toString": path}, "destination": {"toString": path}, "binary": False, "hunks": [{
        "sourceLine": 10, "sourceSpan": 5 + len(removed), "destinationLine": 10, "destinationSpan": 5 + len(added),
        "segments": [{"type": "CONTEXT", "lines": [{"line": x, "source": 10 + i, "destination": 10 + i} for i, x in enumerate(lines_before)]},
                     {"type": "REMOVED", "lines": [{**x, "source": 15 + i, "destination": 15} for i, x in enumerate(removed)]},
                     {"type": "ADDED", "lines": [{**x, "source": 15, "destination": 15 + i} for i, x in enumerate(added)]}]}]}


def bitbucket(method: str, path: str, params: dict, body: Any) -> Optional[Reply]:
    if path.endswith("/plugins/servlet/applinks/whoami"):
        return Reply(200, "mock_user")
    if "/rest/access-tokens/1.0/users/" in path:
        return ok({"id": "1", "name": "Shark mock", "token": "mock-token"})
    m = re.search(r"/rest/api/1\.0/projects/[^/]+/repos/[^/]+(/.*)?$", path)
    if not m:
        return None
    tail = (m.group(1) or "").strip("/")
    if tail == "branches":
        f = str(params.get("filterText", "")).lower()
        vals = [{"id": f"refs/heads/{b}", "displayId": b, "isDefault": b == "master"} for b in BRANCHES if f in b.lower()]
        return ok({"values": vals, "isLastPage": True, "size": len(vals)})
    if tail == "branches/default":
        return ok({"id": "refs/heads/master", "displayId": "master", "isDefault": True})
    if tail == "commits":
        until = str(params.get("until", "")).replace("refs/heads/", "")
        vals = _commits(until)
        return ok({"values": vals, "isLastPage": True, "size": len(vals), "start": 0})
    m2 = re.match(r"commits/([0-9a-f]+)(/.*)?$", tail)
    if m2:
        cid, rest = m2.group(1), (m2.group(2) or "").strip("/")
        if not rest:
            return ok(_commit(cid))
        if rest == "changes":
            return ok({"values": _changes(cid), "isLastPage": True})
        if rest == "diff":
            return ok({"diffs": [_diff_for(cid, c["path"]["toString"]) for c in _changes(cid)], "truncated": False})
        if rest.startswith("diff/"):
            return ok({"diffs": [_diff_for(cid, rest[5:])], "truncated": False})
    return None


# ── Allure TestOps ───────────────────────────────────────────────────────────

_TESTS = ["Создание инцидента оператором", "Смена статуса инцидента", "Уведомление о назначении", "Фильтр карты по району",
          "Выгрузка отчёта за сутки", "Вход по ролям", "Поиск по адресу", "SLA: просрочка реакции", "API: создание заявки",
          "API: получение карточки", "Личный кабинет: история", "Push при смене статуса"]


def _launches() -> list[dict]:
    out, t = [], now()
    for i in range(14):
        t -= timedelta(hours=rng("lt", i).randint(2, 9))
        lid = 50000 - i
        r = rng("launch", lid)
        out.append({"id": lid, "name": f"{r.choice(['Регресс', 'Смоук', 'Ночной прогон', 'API'])} {r.choice(['master', 'develop', 'R26.11'])} #{900 - i}",
                    "createdDate": ms(t), "closed": i > 0, "createdBy": r.choice(PEOPLE)["name"],
                    "tags": [{"name": r.choice(["regress", "smoke", "nightly"])}]})
    return out


def _stat(lid: int) -> list[dict]:
    r = rng("stat", lid)
    total = r.randint(40, 180)
    failed, broken, skipped = r.randint(0, 9), r.randint(0, 4), r.randint(0, 6)
    return [{"status": "passed", "count": total - failed - broken - skipped}, {"status": "failed", "count": failed},
            {"status": "broken", "count": broken}, {"status": "skipped", "count": skipped}]


def _result(rid: int) -> dict:
    r = rng("res", rid)
    st = r.choice(["passed"] * 6 + ["failed", "broken", "skipped"])
    start = ms(now() - timedelta(hours=r.randint(1, 30)))
    dur = r.randint(800, 90000)
    name = r.choice(_TESTS)
    return {"id": rid, "name": name, "fullName": f"ru.sber.aqa.tests.{name.split(':')[0].replace(' ', '')}Test.test",
            "status": st, "start": start, "stop": start + dur, "duration": dur, "testCaseId": 7000 + rid % 300,
            "message": "expected: <Назначен> but was: <Новый>" if st == "failed" else "TimeoutException: 30 s" if st == "broken" else "",
            "trace": "org.opentest4j.AssertionFailedError: expected: <Назначен> but was: <Новый>\n\tat IncidentTest.java:42" if st == "failed" else "",
            "assignee": r.choice(PEOPLE)["name"],
            "labels": [{"name": "epic", "value": r.choice(["Инциденты", "Уведомления", "Карта"])},
                       {"name": "feature", "value": r.choice(["Создание", "Статусы", "Фильтры"])},
                       {"name": "story", "value": name}],
            "parameters": [{"name": "stand", "value": "ИФТ"}]}


def _steps(rid: int) -> dict:
    res = _result(rid)
    bad = res["status"] in ("failed", "broken")
    steps = [{"name": "Авторизоваться оператором", "status": "passed", "duration": 1200, "steps": []},
             {"name": "Открыть карточку инцидента", "status": "passed", "duration": 2300, "steps": [
                 {"name": "GET /api/incidents/911", "status": "passed", "duration": 340,
                  "attachments": [{"id": rid * 10 + 1, "name": "response.json", "contentType": "application/json", "contentLength": 512}]}]},
             {"name": "Сменить статус на «Назначен»", "status": res["status"] if bad else "passed", "duration": 4100,
              "message": res["message"], "steps": []}]
    return {"steps": steps, "attachments": []}


def testops(method: str, path: str, params: dict, body: Any) -> Optional[Reply]:
    if path.endswith("/api/uaa/oauth/token"):
        return ok({"access_token": "mock-jwt", "expires_in": 3600, "token_type": "bearer"})
    m = re.search(r"/api/rs/(.*)$", path)
    if not m:
        return None
    t = m.group(1).strip("/")
    if t == "launch":
        page, size = int(params.get("page", 0) or 0), int(params.get("size", 50) or 50)
        all_ = _launches()
        return ok({"content": all_[page * size:(page + 1) * size], "totalPages": 1, "totalElements": len(all_)})
    m2 = re.match(r"launch/(\d+)(?:/(\w+))?$", t)
    if m2:
        lid, rest = int(m2.group(1)), m2.group(2)
        if rest == "statistic":
            return ok(_stat(lid))
        if rest == "env":
            return ok([{"name": "stand", "value": "ИФТ"}, {"name": "browser", "value": "chrome 130"}])
        return ok(next((x for x in _launches() if x["id"] == lid), {"id": lid, "name": f"Запуск {lid}", "createdDate": ms(now())}))
    if t == "testresult":
        lid = int(params.get("launchId", 0) or 0)
        total = sum(x["count"] for x in _stat(lid))
        ids = [lid * 1000 + i for i in range(min(total, 120))]
        return ok({"content": [_result(i) for i in ids], "totalPages": 1, "totalElements": len(ids)})
    if t == "testresult/attachment":
        return ok({"content": [], "totalPages": 0})
    m3 = re.match(r"testresult/attachment/(\d+)/content$", t)
    if m3:
        return Reply(200, '{\n  "id": 911,\n  "status": "Новый",\n  "address": "Москва, ул. Вавилова, 19"\n}',
                     content_type="application/json")
    m4 = re.match(r"testresult/(\d+)(?:/(\w+))?$", t)
    if m4:
        rid, rest = int(m4.group(1)), m4.group(2)
        if rest in ("execution", "scenario"):
            return ok(_steps(rid))
        return ok(_result(rid))
    return None


# ── Jenkins ──────────────────────────────────────────────────────────────────

_queue: dict[int, int] = {}


def _builds() -> list[dict]:
    out, t = [], now()
    for i in range(10):
        t -= timedelta(hours=rng("jb", i).randint(3, 20))
        n = 412 - i
        r = rng("build", n)
        out.append({"number": n, "url": f"https://jenkins.mock/job/AQA_TEST/{n}/", "displayName": f"#{n} {r.choice(['regress', 'smoke'])}",
                    "result": r.choice(["SUCCESS", "SUCCESS", "UNSTABLE", "FAILURE"]), "building": i == 0 and r.random() < 0.5,
                    "timestamp": ms(t), "duration": r.randint(300_000, 2_400_000)})
    return out


def jenkins(method: str, path: str, params: dict, body: Any) -> Optional[Reply]:
    m = re.search(r"/queue/item/(\d+)/api/json$", path)
    if m:
        qid = int(m.group(1))
        n = _queue.get(qid)
        return ok({"cancelled": False, "executable": {"number": n, "url": f"https://jenkins.mock/job/AQA_TEST/{n}/"}}) if n \
            else not_found(f"очередь {qid}")
    if path.endswith("/buildWithParameters") or path.endswith("/build"):
        qid = 7000 + len(_queue)
        _queue[qid] = 413 + len(_queue)
        return Reply(201, "", headers={"Location": f"https://jenkins.mock/queue/item/{qid}/"})
    if path.endswith("/api/json") and "/job/" in path:
        params_def = [
            {"_class": "hudson.model.ChoiceParameterDefinition", "type": "ChoiceParameterDefinition", "name": "STAND",
             "description": "Стенд", "choices": ["IFT", "PSI"], "defaultParameterValue": {"value": "IFT"}},
            {"type": "StringParameterDefinition", "name": "TAGS", "description": "Теги JUnit", "defaultParameterValue": {"value": "regress"}},
            {"type": "BooleanParameterDefinition", "name": "RERUN_FAILED", "description": "Перезапуск упавших",
             "defaultParameterValue": {"value": True}},
        ]
        return ok({"_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob", "name": "AQA_TEST", "displayName": "AQA_TEST",
                   "url": "https://jenkins.mock/job/AQA_TEST/", "buildable": True,
                   "property": [{"parameterDefinitions": params_def}], "builds": _builds()})
    return None
