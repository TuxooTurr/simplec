"""
Zephyr Tool — тест-кейсы, папки и прогоны Zephyr Scale (Server/DC, плагин TM4J) на jira.sberbank.ru.

Этап 1 — только чтение и проверка API. Запись (кейсы, папки, прогоны, результаты) — следующим этапом,
по запросам, которые подтвердит проверка на рабочем стенде.

Почему два варианта запросов. Документация к стенду и публичный API Zephyr Scale Server расходятся:
  • поиск: `testcase/search?query=projectKey = "X"` (TQL, публичный v1) против `testcase/search/?JQL=project = X`;
  • прогоны (тест-циклы): `testrun/...` (v1) против `testcycle/...`;
  • дерево папок целиком в публичном v1 не отдаётся — его отдаёт внутренний API интерфейса Zephyr
    (`/rest/tests/1.0/project/{id}/foldertree/...`, на нём работает страница Tests.jspa#/v2).
Поэтому каждый запрос пробует варианты по очереди и запоминает сработавший, а `/api/zephyr/probe` проверяет
их все разом и даёт отчёт — по нему фиксируем рабочие варианты и пишем запись.

Токен — тот же PAT Jira, что у Jira tool и регистрации дефектов (`_load_cfg` / `_jira_request`).
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.jira_defects import _jira_request, _load_cfg
from db.postgres import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

ATM = "/rest/atm/1.0"        # публичный REST API Zephyr Scale Server
TESTS = "/rest/tests/1.0"    # внутренний API интерфейса Zephyr (дерево папок, справочники)

PAGE = 200                   # кейсов за запрос при обходе
MAX_CASES = 5000             # предел обхода для дерева из путей кейсов
SAMPLE_CHARS = 1500          # сколько ответа показывать в отчёте проверки

# Какой вариант запроса сработал на этом стенде: (base_url, вид) → индекс варианта.
_working: dict[tuple[str, str], int] = {}
_project_ids: dict[tuple[str, str], tuple[float, str]] = {}


# ── Варианты запросов ────────────────────────────────────────────────────────

def _q_query(project: str, extra: str = "") -> str:
    """TQL публичного v1: projectKey = "X" [AND ...]."""
    return f'projectKey = "{project}"' + (f" AND {extra}" if extra else "")


def _search_variants(kind: str, project: str, extra: str, start: int, limit: int, fields: str = "") -> list[tuple[str, dict]]:
    """(путь, параметры) для поиска кейсов (kind=testcase) или прогонов (kind=testrun) — по очереди."""
    v1 = {"query": _q_query(project, extra), "startAt": start, "maxResults": limit}
    if fields:
        v1["fields"] = fields
    doc = {"JQL": f"project = {project}" + (f" AND {extra}" if extra else ""), "startAt": start, "maxResult": limit}
    if kind == "testcase":
        return [(f"{ATM}/testcase/search", v1), (f"{ATM}/testcase/search/", doc)]
    return [(f"{ATM}/testrun/search", v1), (f"{ATM}/testcycle/search", doc)]


def _first_working(cfg: dict, kind: str, variants: list[tuple[str, dict]]) -> Any:
    """Пробует варианты, начиная с уже сработавшего. 401 — сразу наверх (токен), 404/400/405 — следующий."""
    key = (cfg["base_url"], kind)
    order = list(range(len(variants)))
    if key in _working:
        order.remove(_working[key]); order.insert(0, _working[key])
    last: Optional[HTTPException] = None
    for i in order:
        path, params = variants[i]
        try:
            data = _jira_request(cfg, "GET", path, params=params)
            _working[key] = i
            return data
        except HTTPException as e:
            if e.status_code == 401:
                raise
            last = e
    raise last or HTTPException(502, "Zephyr: ни один вариант запроса не сработал")


def _items(data: Any) -> list[dict]:
    """Список из ответа поиска: голый массив (v1) или {results|values|items: [...]} (другие версии)."""
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for k in ("results", "values", "items", "testCases", "testRuns"):
            if isinstance(data.get(k), list):
                return [x for x in data[k] if isinstance(x, dict)]
    return []


def _project_id(cfg: dict, project: str) -> str:
    """Числовой id проекта Jira (для внутреннего API) — кэш на час."""
    key = (cfg["base_url"], project)
    hit = _project_ids.get(key)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    data = _jira_request(cfg, "GET", f"/rest/api/2/project/{project}")
    pid = str(data.get("id", ""))
    if not pid:
        raise HTTPException(404, f"Проект {project} не найден в Jira")
    _project_ids[key] = (time.time(), pid)
    return pid


# ── Нормализация (форматы версий различаются — берём то, что есть) ───────────

def _name(v: Any) -> str:
    if isinstance(v, dict):
        return str(v.get("name") or v.get("displayName") or v.get("key") or "")
    return "" if v is None else str(v)


def norm_case(c: dict) -> dict:
    links = c.get("issueLinks") or c.get("issueKeys") or []
    return {
        "key": c.get("key", ""),
        "name": c.get("name") or c.get("summary") or "",
        "status": _name(c.get("status")),
        "priority": _name(c.get("priority")),
        "folder": c.get("folder") or "",
        "labels": [str(x) for x in (c.get("labels") or [])],
        "owner": _name(c.get("owner")),
        "updated": c.get("updatedOn") or c.get("updated") or "",
        "issueLinks": [x if isinstance(x, str) else _name(x) for x in links],
    }


def norm_steps(c: dict) -> list[dict]:
    """Шаги: v1 — testScript.steps[{description, testData, expectedResult}], документ — steps[{step, stepData, ...}]."""
    script = c.get("testScript") or {}
    raw = script.get("steps") if isinstance(script, dict) else None
    if raw is None:
        raw = c.get("steps") or []
    out = []
    for i, s in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(s, dict):
            continue
        out.append({
            "index": s.get("index", i),
            "description": s.get("description") or s.get("step") or "",
            "testData": s.get("testData") or s.get("stepData") or "",
            "expectedResult": s.get("expectedResult") or "",
        })
    text = script.get("text") if isinstance(script, dict) and script.get("type") == "PLAIN_TEXT" else ""
    if text and not out:
        out.append({"index": 0, "description": text, "testData": "", "expectedResult": ""})
    return out


def norm_run(r: dict) -> dict:
    items = r.get("items") or r.get("testRunItems") or []
    counts: dict[str, int] = {}
    for it in items if isinstance(items, list) else []:
        st = _name(it.get("status")) or "Not Executed"
        counts[st] = counts.get(st, 0) + 1
    summary = r.get("executionSummary")
    if isinstance(summary, dict) and not counts:
        counts = {str(k): int(v) for k, v in summary.items() if isinstance(v, (int, float))}
    return {
        "key": r.get("key", ""),
        "name": r.get("name") or "",
        "status": _name(r.get("status")),
        "folder": r.get("folder") or "",
        "version": _name(r.get("version") or r.get("projectVersion")),
        "issueKey": r.get("issueKey") or "",
        "owner": _name(r.get("owner")),
        "plannedStart": r.get("plannedStartDate") or "",
        "plannedEnd": r.get("plannedEndDate") or "",
        "total": len(items) if isinstance(items, list) and items else int(r.get("testCaseCount") or sum(counts.values()) or 0),
        "counts": counts,
    }


def norm_result(x: dict) -> dict:
    return {
        "id": x.get("id"),
        "testCaseKey": x.get("testCaseKey") or _name(x.get("testCase")),
        "status": _name(x.get("status")) or "Not Executed",
        "assignee": _name(x.get("assignedTo") or x.get("userKey")),
        "executedBy": _name(x.get("executedBy")),
        "executionDate": x.get("executionDate") or x.get("actualEndDate") or "",
        "comment": x.get("comment") or "",
        "issueLinks": [i if isinstance(i, str) else _name(i) for i in (x.get("issueLinks") or [])],
    }


# ── Дерево папок ─────────────────────────────────────────────────────────────

def tree_from_paths(paths: list[str]) -> list[dict]:
    """Пути кейсов «/A/B» → дерево [{name, path, count, children}] (count — кейсы в папке и вложенных)."""
    root: dict[str, Any] = {"children": {}}
    for p in paths:
        node = root
        acc = ""
        for part in [x for x in (p or "").split("/") if x]:
            acc += "/" + part
            node = node["children"].setdefault(part, {"name": part, "path": acc, "count": 0, "children": {}})
            node["count"] += 1

    def out(n: dict) -> list[dict]:
        return [{"name": c["name"], "path": c["path"], "count": c["count"], "children": out(c)}
                for c in sorted(n["children"].values(), key=lambda x: x["name"].lower())]
    return out(root)


def tree_from_foldertree(data: Any, parent: str = "") -> list[dict]:
    """Ответ внутреннего foldertree → то же дерево. Корень бывает объектом с children/folders или массивом."""
    if isinstance(data, list):
        nodes = data
    elif isinstance(data, dict):
        nodes = data.get("children") or data.get("folders") or []
    else:
        nodes = []
    out = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        name = str(n.get("name", ""))
        path = f"{parent}/{name}"
        kids = tree_from_foldertree(n, path)
        own = n.get("testCaseCount") if isinstance(n.get("testCaseCount"), int) else n.get("count")
        count = own if isinstance(own, int) else 0
        out.append({"id": n.get("id"), "name": name, "path": path,
                    "count": count + sum(k["count"] for k in kids), "children": kids})
    return out


# ── Эндпоинты чтения ─────────────────────────────────────────────────────────

@router.get("/api/zephyr/tree")
def tree(project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    """Дерево папок кейсов: внутренний foldertree (с пустыми папками), иначе — из путей кейсов."""
    cfg = _load_cfg(db)
    project = project.strip().upper()
    try:
        pid = _project_id(cfg, project)
        data = _jira_request(cfg, "GET", f"{TESTS}/project/{pid}/foldertree/testcase", params={"showEmptyFolders": "true"})
        folders = tree_from_foldertree(data)
        if folders:
            return {"source": "foldertree", "folders": folders}
    except HTTPException as e:
        if e.status_code == 401:
            raise
        logger.info("Zephyr: foldertree недоступен (%s) — строю дерево из путей кейсов", e.detail)
    paths: list[str] = []
    for start in range(0, MAX_CASES, PAGE):
        page = _items(_first_working(cfg, "testcase", _search_variants("testcase", project, "", start, PAGE, "key,folder")))
        paths += [c.get("folder") or "" for c in page]
        if len(page) < PAGE:
            break
    return {"source": "cases", "folders": tree_from_paths(paths), "total": len(paths),
            "truncated": len(paths) >= MAX_CASES}


@router.get("/api/zephyr/cases")
def cases(project: str = Query(..., min_length=1), folder: str = "", text: str = "",
          db: Session = Depends(get_db)) -> dict:
    """Кейсы папки (без вложенных) или поиск по названию."""
    cfg = _load_cfg(db)
    project = project.strip().upper()
    extra = []
    if folder:
        extra.append(f'folder = "{folder.replace(chr(34), "")}"')
    if text.strip():
        extra.append(f'name ~ "{text.strip().replace(chr(34), "")}"')
    out: list[dict] = []
    for start in range(0, 2000, PAGE):
        page = _items(_first_working(cfg, "testcase", _search_variants("testcase", project, " AND ".join(extra), start, PAGE)))
        out += [norm_case(c) for c in page]
        if len(page) < PAGE:
            break
    return {"cases": out}


@router.get("/api/zephyr/case/{key}")
def case(key: str, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    c = _jira_request(cfg, "GET", f"{ATM}/testcase/{key.strip().upper()}")
    return {**norm_case(c), "objective": c.get("objective") or c.get("description") or "",
            "precondition": c.get("precondition") or "", "steps": norm_steps(c),
            "estimatedTime": c.get("estimatedTime"), "component": _name(c.get("component"))}


@router.get("/api/zephyr/runs")
def runs(project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    project = project.strip().upper()
    out: list[dict] = []
    for start in range(0, 1000, PAGE):
        page = _items(_first_working(cfg, "testrun", _search_variants("testrun", project, "", start, PAGE)))
        out += [norm_run(r) for r in page]
        if len(page) < PAGE:
            break
    return {"runs": out}


@router.get("/api/zephyr/run/{key}")
def run(key: str, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    key = key.strip().upper()
    r = _first_working(cfg, "testrun-get", [(f"{ATM}/testrun/{key}", {}), (f"{ATM}/testcycle/{key}", {})])
    try:
        results = _items(_first_working(cfg, "testrun-results",
                                        [(f"{ATM}/testrun/{key}/testresults", {}), (f"{ATM}/testcycle/{key}/testRun", {})]))
    except HTTPException as e:
        if e.status_code == 401:
            raise
        results = []
    items = r.get("items") or r.get("testRunItems") or []
    by_case = {x["testCaseKey"]: x for x in (norm_result(i) for i in results) if x["testCaseKey"]}
    rows = [by_case.get(i.get("testCaseKey") or "", norm_result(i)) for i in items if isinstance(i, dict)] or list(by_case.values())
    return {**norm_run(r), "items": rows}


# ── Проверка API на стенде ───────────────────────────────────────────────────

def _shape(v: Any, depth: int = 0) -> Any:
    """Каркас ответа без данных: ключи и типы — по нему видно формат, не выдавая содержимое."""
    if depth > 3:
        return "…"
    if isinstance(v, dict):
        return {k: _shape(x, depth + 1) for k, x in list(v.items())[:40]}
    if isinstance(v, list):
        return [_shape(v[0], depth + 1)] if v else []
    return type(v).__name__


@router.get("/api/zephyr/probe")
def probe(project: str = Query("SBER911", min_length=1), samples: bool = False, db: Session = Depends(get_db)) -> dict:
    """
    Проверяет запросы чтения обоих вариантов и возвращает отчёт: что сработало, код ответа, каркас ответа
    (ключи и типы, без данных). samples=true — ещё и начало ответа (для разбора формата; там будут данные).
    Ничего не меняет в Jira.
    """
    cfg = _load_cfg(db)
    project = project.strip().upper()
    found: dict[str, str] = {}
    results: list[dict] = []

    def check(cid: str, label: str, path: Callable[[], Optional[str]], params: Optional[dict] = None,
              remember: Optional[Callable[[Any], None]] = None) -> None:
        p = path()
        if p is None:
            results.append({"id": cid, "label": label, "skipped": True, "reason": "нет данных из предыдущих проверок"})
            return
        t0 = time.time()
        row: dict[str, Any] = {"id": cid, "label": label, "method": "GET", "path": p, "params": params or {}}
        try:
            data = _jira_request(cfg, "GET", p, params=params, timeout=20)
            row.update(ok=True, status=200, shape=_shape(data))
            if samples:
                row["sample"] = json.dumps(data, ensure_ascii=False)[:SAMPLE_CHARS]
            if remember:
                remember(data)
        except HTTPException as e:
            row.update(ok=False, status=e.status_code, error=str(e.detail)[:300])
        row["ms"] = int((time.time() - t0) * 1000)
        results.append(row)

    def first_key(store: str) -> Callable[[Any], None]:
        def f(data: Any) -> None:
            items = _items(data)
            if items and items[0].get("key"):
                found.setdefault(store, items[0]["key"])
        return f

    check("jira-project", "Проект в Jira (id для внутреннего API)", lambda: f"/rest/api/2/project/{project}",
          remember=lambda d: found.__setitem__("pid", str(d.get("id", ""))) if isinstance(d, dict) and d.get("id") else None)
    check("case-search-v1", "Поиск кейсов: query=projectKey (публичный v1)", lambda: f"{ATM}/testcase/search",
          {"query": _q_query(project), "maxResults": 3}, first_key("case"))
    check("case-search-doc", "Поиск кейсов: JQL=project (как в документации)", lambda: f"{ATM}/testcase/search/",
          {"JQL": f"project = {project}", "maxResult": 3}, first_key("case"))
    check("case-get", "Кейс целиком (шаги)", lambda: f"{ATM}/testcase/{found['case']}" if found.get("case") else None)
    check("run-search-v1", "Поиск прогонов: testrun (публичный v1)", lambda: f"{ATM}/testrun/search",
          {"query": _q_query(project), "maxResults": 3}, first_key("run"))
    check("run-search-doc", "Поиск прогонов: testcycle (как в документации)", lambda: f"{ATM}/testcycle/search",
          {"JQL": f"project={project}", "maxResult": 3}, first_key("run"))
    check("run-get-v1", "Прогон целиком: testrun/{key}", lambda: f"{ATM}/testrun/{found['run']}" if found.get("run") else None)
    check("run-results-v1", "Результаты прогона: testrun/{key}/testresults",
          lambda: f"{ATM}/testrun/{found['run']}/testresults" if found.get("run") else None)
    check("run-get-doc", "Прогон целиком: testcycle/{key}", lambda: f"{ATM}/testcycle/{found['run']}" if found.get("run") else None)
    check("tree-cases", "Дерево папок кейсов (внутренний API)",
          lambda: f"{TESTS}/project/{found['pid']}/foldertree/testcase" if found.get("pid") else None, {"showEmptyFolders": "true"})
    check("tree-runs", "Дерево папок прогонов (внутренний API)",
          lambda: f"{TESTS}/project/{found['pid']}/foldertree/testrun" if found.get("pid") else None, {"showEmptyFolders": "true"})
    check("case-statuses", "Статусы кейсов (внутренний API)",
          lambda: f"{TESTS}/project/{found['pid']}/testcasestatus" if found.get("pid") else None)
    check("result-statuses", "Статусы результатов (внутренний API)",
          lambda: f"{TESTS}/project/{found['pid']}/testresultstatus" if found.get("pid") else None)
    check("environments", "Среды тестирования", lambda: f"{ATM}/environments", {"projectKey": project})

    done = [r for r in results if not r.get("skipped")]
    return {"project": project, "base_url": cfg["base_url"], "checkedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "ok": sum(1 for r in done if r.get("ok")), "total": len(done), "results": results}


# ── Крит регресс: релиз → КЭ → кейсы → прогон → прохождение ──────────────────
#
# Задача релиза (SBER911-12345) несёт список КЭ. По нему отбираются кейсы с признаком «Крит регресс» = Да,
# статусом «Утверждено», типом тестирования «Регресс» и КЭ из релиза. Из них создаётся прогон, привязанный
# к задаче релиза (отслеживание), и проходится в плеере или кнопкой «Пройти все».
#
# Запись (создание прогона, результаты) идёт тем же перебором вариантов, что чтение: публичный v1 (`testrun`),
# затем вариант документации (`testcycle`). Следующий вариант пробуется только на 404/405 — «такого запроса нет»;
# 400 значит «запрос есть, но не понравилось тело» — перебор остановится, чтобы не создать дубль.

KE_FIELD_ID = "customfield_18300"      # КЭ в SBER911 (jira_constants.FIELD_KE)
_KE_ID_RE = re.compile(r"\((\d+)\)\s*$")


def _ke_items(v: Any) -> list[dict]:
    """Значение поля КЭ → [{id, name, label}]: объекты {id, value}, строки «название (id)», голые id."""
    out: list[dict] = []
    for x in (v if isinstance(v, list) else [v] if v not in (None, "", [], {}) else []):
        if isinstance(x, dict):
            name = str(x.get("value") or x.get("name") or x.get("displayName") or "").strip()
            kid = str(x.get("id") or "").strip()
        else:
            s = str(x).strip()
            m = _KE_ID_RE.search(s)
            kid = m.group(1) if m else (s if s.isdigit() else "")
            name = _KE_ID_RE.sub("", s).strip() if m else ("" if s.isdigit() else s)
        if kid or name:
            out.append({"id": kid, "name": name, "label": f"{name} ({kid})" if name and kid else name or kid})
    return out


def ke_match(case_ke: list[dict], wanted: list[dict]) -> bool:
    """КЭ кейса совпадает с одной из КЭ релиза: по id, если он есть у обеих, иначе по названию без регистра."""
    for a in case_ke:
        for b in wanted:
            if a["id"] and b["id"]:
                if a["id"] == b["id"]:
                    return True
            elif a["name"] and b["name"] and a["name"].lower() == b["name"].lower():
                return True
    return False


_YES = {"да", "yes", "true", "1", "истина"}


def _cf(case: dict, name: str) -> Any:
    """Пользовательское поле кейса по имени (Zephyr отдаёт customFields словарём «имя → значение»)."""
    cf = case.get("customFields") or {}
    if isinstance(cf, dict):
        if name in cf:
            return cf[name]
        low = name.lower()
        for k, v in cf.items():
            if str(k).lower() == low:
                return v
    if isinstance(cf, list):   # другие версии: [{name, value}]
        for f in cf:
            if isinstance(f, dict) and str(f.get("name", "")).lower() == name.lower():
                return f.get("value")
    return None


def _cf_texts(v: Any) -> list[str]:
    if isinstance(v, bool):
        return ["да" if v else "нет"]
    if isinstance(v, list):
        return [t for x in v for t in _cf_texts(x)]
    if isinstance(v, dict):
        return [str(v.get("value") or v.get("name") or "").strip().lower()]
    return [] if v is None else [str(v).strip().lower()]


class CritCriteria(BaseModel):
    """Условия отбора — по умолчанию как в процессе SBER911; названия полей Zephyr можно поправить в интерфейсе."""
    status: str = "Утверждено"
    crit_field: str = "Крит регресс"
    crit_value: str = "Да"
    type_field: str = "Тип тестирования"
    type_value: str = "Регресс"
    ke_field: str = "КЭ"


class CritBody(BaseModel):
    project: str = Field(..., min_length=1)
    ke: list[str] = Field(default_factory=list)            # «название (id)» или id — что выбрано из релиза
    criteria: CritCriteria = Field(default_factory=CritCriteria)


def crit_filter(cases: list[dict], wanted: list[dict], c: CritCriteria) -> tuple[list[dict], dict]:
    """Отбор крит регресса + счётчики отсева (чтобы было видно, на каком условии кейсы отвалились)."""
    stats = {"checked": len(cases), "no_crit": 0, "no_type": 0, "no_ke": 0}
    yes = c.crit_value.strip().lower()
    out = []
    for case in cases:
        crit = _cf_texts(_cf(case, c.crit_field))
        if not any(x == yes or (yes in _YES and x in _YES) for x in crit):
            stats["no_crit"] += 1
            continue
        if c.type_value.strip().lower() not in _cf_texts(_cf(case, c.type_field)):
            stats["no_type"] += 1
            continue
        ke = _ke_items(_cf(case, c.ke_field))
        if wanted and not ke_match(ke, wanted):
            stats["no_ke"] += 1
            continue
        out.append({**norm_case(case), "ke": [k["label"] for k in ke]})
    return out, stats


@router.get("/api/zephyr/release/{key}")
def release(key: str, db: Session = Depends(get_db)) -> dict:
    """Задача релиза: название, статус и КЭ (поле КЭ SBER911 и любые поля с «КЭ» в названии)."""
    cfg = _load_cfg(db)
    key = key.strip().upper()
    data = _jira_request(cfg, "GET", f"/rest/api/2/issue/{key}", params={"expand": "names", "fields": "*all"})
    fields = data.get("fields") or {}
    names = data.get("names") or {}
    ke: list[dict] = []
    sources: list[str] = []
    for fid, val in fields.items():
        title = str(names.get(fid, ""))
        if fid == KE_FIELD_ID or title.strip().lower().startswith("кэ") or "конфигурационн" in title.lower():
            items = _ke_items(val)
            if items:
                sources.append(f"{title or fid} ({fid})")
                ke += items
    uniq = list({(k["id"] or k["name"].lower()): k for k in ke}.values())
    return {"key": key, "summary": fields.get("summary") or "", "status": _name(fields.get("status")),
            "issuetype": _name(fields.get("issuetype")), "url": f"{cfg['base_url']}/browse/{key}",
            "ke": uniq, "keSources": sources}


@router.post("/api/zephyr/crit-cases")
def crit_cases(body: CritBody, db: Session = Depends(get_db)) -> dict:
    """Кейсы крит регресса по КЭ релиза. В поиск уходит только статус (его понимает любой вариант запроса),
    пользовательские поля проверяются здесь — их синтаксис в запросе на разных версиях Zephyr разный."""
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    status = body.criteria.status.replace('"', "").strip()
    extra = f'status = "{status}"' if status else ""
    found: list[dict] = []
    for start in range(0, MAX_CASES, PAGE):
        page = _items(_first_working(cfg, "testcase", _search_variants("testcase", project, extra, start, PAGE)))
        found += page
        if len(page) < PAGE:
            break
    wanted = [k for s in body.ke for k in _ke_items(s)]
    cases_out, stats = crit_filter(found, wanted, body.criteria)
    return {"cases": cases_out, "stats": stats, "truncated": len(found) >= MAX_CASES}


def _write_variants(cfg: dict, kind: str, method: str, variants: list[tuple[str, Any]]) -> Any:
    """Запись по вариантам: следующий — только если запроса нет (404/405), иначе ошибка как есть."""
    key = (cfg["base_url"], kind)
    order = list(range(len(variants)))
    if key in _working:
        order.remove(_working[key]); order.insert(0, _working[key])
    last: Optional[HTTPException] = None
    for i in order:
        path, body = variants[i]
        try:
            data = _jira_request(cfg, method, path, json_body=body)
            _working[key] = i
            return data
        except HTTPException as e:
            if e.status_code not in (404, 405):
                raise
            last = e
    raise last or HTTPException(502, "Zephyr: запрос записи не найден ни в одном варианте")


class RunCreate(BaseModel):
    project: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=255)
    issueKey: str = ""                                     # задача Jira — отслеживание (номер релиза)
    caseKeys: list[str] = Field(default_factory=list)
    folder: str = ""


@router.post("/api/zephyr/runs")
def create_run(body: RunCreate, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    if not body.caseKeys:
        raise HTTPException(422, "В прогоне нет кейсов")
    payload: dict[str, Any] = {"projectKey": body.project.strip().upper(), "name": body.name.strip(),
                               "items": [{"testCaseKey": k} for k in dict.fromkeys(body.caseKeys)]}
    if body.issueKey.strip():
        payload["issueKey"] = body.issueKey.strip().upper()
    if body.folder.strip():
        payload["folder"] = body.folder.strip()
    data = _write_variants(cfg, "testrun-create", "POST", [(f"{ATM}/testrun", payload), (f"{ATM}/testcycle", payload)])
    key = (data or {}).get("key", "")
    if not key:
        raise HTTPException(502, f"Zephyr не вернул ключ прогона: {str(data)[:200]}")
    logger.info("Zephyr: создан прогон %s (%s кейсов, отслеживание %s)", key, len(payload["items"]), payload.get("issueKey"))
    return {"key": key, "url": f"{cfg['base_url']}/secure/Tests.jspa#/testPlayer/{key}"}


class StepResult(BaseModel):
    index: int
    status: str
    comment: str = ""


class CaseResult(BaseModel):
    testCaseKey: str
    status: str                                            # Pass / Fail / Blocked / Not Executed
    comment: str = ""
    executionTime: Optional[int] = None                    # мс
    issueLinks: list[str] = Field(default_factory=list)    # дефекты, заведённые при прохождении
    scriptResults: list[StepResult] = Field(default_factory=list)


class ResultsBody(BaseModel):
    results: list[CaseResult] = Field(default_factory=list)


def _result_payload(r: CaseResult, with_key: bool) -> dict:
    p: dict[str, Any] = {"status": r.status}
    if with_key:
        p["testCaseKey"] = r.testCaseKey
    if r.comment:
        p["comment"] = r.comment
    if r.executionTime:
        p["executionTime"] = r.executionTime
    if r.issueLinks:
        p["issueLinks"] = r.issueLinks
    if r.scriptResults:
        p["scriptResults"] = [s.model_dump() for s in r.scriptResults]
    return p


@router.post("/api/zephyr/run/{key}/results")
def save_results(key: str, body: ResultsBody, db: Session = Depends(get_db)) -> dict:
    """Результаты прохождения: пачкой (v1 testrun/{key}/testresults), иначе по кейсу (…/testcase/{case}/testresult).
    Сбой одного кейса не роняет остальные — в ответе список ошибок."""
    cfg = _load_cfg(db)
    key = key.strip().upper()
    if not body.results:
        return {"saved": 0, "errors": []}
    try:
        _write_variants(cfg, "testresults-bulk", "POST",
                        [(f"{ATM}/testrun/{key}/testresults", [_result_payload(r, True) for r in body.results])])
        return {"saved": len(body.results), "errors": []}
    except HTTPException as e:
        if e.status_code not in (404, 405):
            raise
    saved, errors = 0, []
    for r in body.results:
        try:
            _jira_request(cfg, "POST", f"{ATM}/testrun/{key}/testcase/{r.testCaseKey}/testresult", json_body=_result_payload(r, False))
            saved += 1
        except HTTPException as e:
            if e.status_code == 401:
                raise
            errors.append({"testCaseKey": r.testCaseKey, "error": str(e.detail)[:300]})
    return {"saved": saved, "errors": errors}


# ── Новая модель: XML (выгрузка Zephyr или генерация SimpleTest) → раскладка → «Применить» ──
#
# Разбор XML даёт папки и кейсы; раскладку (что в какую папку дерева) человек делает в интерфейсе, а «Применить»
# создаёт в Zephyr недостающие папки (родители — раньше детей) и кейсы. Папка, которая уже есть, не ошибка.

MAX_XML = 20 * 1024 * 1024


def _x(el: Any, tag: str) -> str:
    """Текст дочернего тега (CDATA — тот же текст), без пробелов по краям."""
    node = el.find(tag) if el is not None else None
    return (node.text or "").strip() if node is not None and node.text else ""


def parse_zephyr_xml(text: str) -> dict:
    """Zephyr XML (`<project><folders/><testCases/>`) → {folders: [пути], cases: [...]}. Без внешних сущностей и DTD."""
    import xml.etree.ElementTree as ET

    if len(text.encode("utf-8")) > MAX_XML:
        raise HTTPException(413, "Файл больше 20 МБ")
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
        # В выгрузках Zephyr DTD нет; с ним возможна «бомба» раскрытия сущностей — такие файлы не разбираем.
        raise HTTPException(422, "В XML есть DOCTYPE/ENTITY — это не выгрузка Zephyr")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise HTTPException(422, f"XML не разбирается: {e}")

    folders = [f.get("fullPath", "").strip() for f in root.iter("folder") if f.get("fullPath")]
    cases = []
    for i, tc in enumerate(root.iter("testCase")):
        custom: dict[str, Any] = {}
        for cf in tc.findall("./customFields/customField"):
            name, ftype = cf.get("name", ""), (cf.get("type") or "").upper()
            val = _x(cf, "value")
            if not name or val == "":
                continue
            custom[name] = val.lower() == "true" if ftype == "CHECKBOX" else val
        steps = [{"description": _x(s, "description"), "testData": _x(s, "testData"), "expectedResult": _x(s, "expectedResult")}
                 for s in sorted(tc.findall("./testScript/steps/step"), key=lambda s: int(s.get("index") or 0))]
        script = tc.find("testScript")
        if not steps and script is not None and _x(script, "text"):
            steps = [{"description": _x(script, "text"), "testData": "", "expectedResult": ""}]
        folder = _x(tc, "folder")
        cases.append({
            "id": f"x{i}", "name": _x(tc, "name"), "folder": folder if folder.startswith("/") or not folder else "/" + folder,
            "objective": _x(tc, "objective"), "precondition": _x(tc, "precondition"),
            "priority": _x(tc, "priority"), "status": _x(tc, "status"),
            "labels": [(l.text or "").strip() for l in tc.findall("./labels/label") if (l.text or "").strip()],
            "customFields": custom, "steps": steps,
        })
    paths = {("/" + p.lstrip("/")) for p in folders if p} | {c["folder"] for c in cases if c["folder"]}
    return {"folders": sorted(paths), "cases": cases}


class XmlBody(BaseModel):
    xml: str = Field(..., min_length=1)


@router.post("/api/zephyr/parse-xml")
def parse_xml(body: XmlBody) -> dict:
    out = parse_zephyr_xml(body.xml)
    if not out["cases"]:
        raise HTTPException(422, "В XML нет кейсов (<testCase>)")
    return out


class StagedStep(BaseModel):
    description: str = ""
    testData: str = ""
    expectedResult: str = ""


class StagedCase(BaseModel):
    id: str
    name: str = Field(..., min_length=1)
    folder: str = ""                                       # итоговый путь в дереве Zephyr
    objective: str = ""
    precondition: str = ""
    priority: str = ""
    status: str = ""
    labels: list[str] = Field(default_factory=list)
    customFields: dict[str, Any] = Field(default_factory=dict)
    steps: list[StagedStep] = Field(default_factory=list)


class ApplyBody(BaseModel):
    project: str = Field(..., min_length=1)
    folders: list[str] = Field(default_factory=list)       # новые папки (пути); родители досоздаются сами
    cases: list[StagedCase] = Field(default_factory=list)


def _ancestors(path: str) -> list[str]:
    parts = [p for p in path.split("/") if p]
    return ["/" + "/".join(parts[:i]) for i in range(1, len(parts) + 1)]


def _case_payload(project: str, c: StagedCase, with_custom: bool) -> dict:
    p: dict[str, Any] = {"projectKey": project, "name": c.name.strip()}
    for k in ("folder", "objective", "precondition", "priority", "status"):
        v = getattr(c, k).strip()
        if v:
            p[k] = v
    if c.labels:
        p["labels"] = c.labels
    if with_custom and c.customFields:
        p["customFields"] = c.customFields
    if c.steps:
        p["testScript"] = {"type": "STEP_BY_STEP", "steps": [s.model_dump() for s in c.steps]}
    return p


@router.post("/api/zephyr/apply")
def apply_model(body: ApplyBody, db: Session = Depends(get_db)) -> dict:
    """Создаёт папки и кейсы новой модели. Сбой одного кейса не останавливает остальные — в ответе итог по каждому."""
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    wanted = sorted({a for p in [*body.folders, *(c.folder for c in body.cases)] if p for a in _ancestors(p)},
                    key=lambda p: (p.count("/"), p))
    folder_errors: dict[str, str] = {}
    created_folders: list[str] = []
    for path in wanted:
        try:
            _jira_request(cfg, "POST", f"{ATM}/folder", json_body={"projectKey": project, "name": path, "type": "TEST_CASE"})
            created_folders.append(path)
        except HTTPException as e:
            if e.status_code == 401:
                raise
            # Уже есть — не ошибка: кейсы просто лягут в существующую папку.
            if not re.search(r"exist|существ|already|duplicate|дубл", str(e.detail), re.I):
                folder_errors[path] = str(e.detail)[:300]

    results = []
    for c in body.cases:
        row: dict[str, Any] = {"id": c.id, "name": c.name}
        bad_folder = next((folder_errors[a] for a in _ancestors(c.folder) if a in folder_errors), None)
        if bad_folder:
            row["error"] = f"папка {c.folder} не создалась: {bad_folder}"
            results.append(row)
            continue
        try:
            data = _jira_request(cfg, "POST", f"{ATM}/testcase", json_body=_case_payload(project, c, True))
            row["key"] = (data or {}).get("key", "")
        except HTTPException as e:
            if e.status_code == 401:
                raise
            if e.status_code == 400 and c.customFields:
                # Пользовательские поля из XML могут не совпасть с полями проекта — кейс важнее: создаём без них.
                try:
                    data = _jira_request(cfg, "POST", f"{ATM}/testcase", json_body=_case_payload(project, c, False))
                    row["key"] = (data or {}).get("key", "")
                    row["warning"] = f"создан без пользовательских полей ({', '.join(c.customFields)}): {str(e.detail)[:200]}"
                except HTTPException as e2:
                    if e2.status_code == 401:
                        raise
                    row["error"] = str(e2.detail)[:300]
            else:
                row["error"] = str(e.detail)[:300]
        results.append(row)
    return {"createdFolders": created_folders, "folderErrors": folder_errors, "results": results,
            "created": sum(1 for r in results if r.get("key")), "failed": sum(1 for r in results if r.get("error"))}
