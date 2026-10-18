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

import hashlib
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
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


_NEXT_VARIANT = (400, 404, 405)   # «такого запроса здесь нет / не в таком виде» — пробуем следующий вариант


def _first_working(cfg: dict, kind: str, variants: list[tuple[str, dict]], timeout: int = 30) -> Any:
    """
    Пробует варианты, начиная с уже сработавшего. Следующий — только на 400/404/405; таймаут, 5xx, 401, 403 — сразу
    наверх (другой вариант их не исправит). Не сработал ни один — показываем ошибку первого варианта, а не запасного:
    у запасного она бесполезна («Must provide a query parameter» прятала настоящую причину).
    """
    key = (cfg["base_url"], kind)
    order = list(range(len(variants)))
    if key in _working:
        order.remove(_working[key]); order.insert(0, _working[key])
    errors: list[HTTPException] = []
    for i in order:
        path, params = variants[i]
        try:
            data = _jira_request(cfg, "GET", path, params=params, timeout=timeout)
            _working[key] = i
            return data
        except HTTPException as e:
            if e.status_code not in _NEXT_VARIANT:
                raise
            errors.append(e)
    real = next((e for e in errors if e.status_code not in (404, 405)), errors[-1] if errors else None)
    raise real or HTTPException(502, "Zephyr: ни один вариант запроса не сработал")


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


RUN_TYPE_FIELD = "Вид тестирования"


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
        # Вид прогона (Регресс, Новый функционал…) — пользовательское поле прогона SBER911.
        "type": _name((r.get("customFields") or {}).get(RUN_TYPE_FIELD)) if isinstance(r.get("customFields"), dict) else "",
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

def tree_from_paths(paths: list[str], extra: Optional[list[str]] = None) -> list[dict]:
    """Пути кейсов «/A/B» → дерево [{name, path, count, children}] (count — кейсы в папке и вложенных).
    extra — пустые папки (созданы в SimpleTest, кейсов ещё нет): узлы есть, счётчик не растёт."""
    root: dict[str, Any] = {"children": {}}
    for p in extra or []:
        node, acc = root, ""
        for part in [x for x in (p or "").split("/") if x]:
            acc += "/" + part
            node = node["children"].setdefault(part, {"name": part, "path": acc, "count": 0, "children": {}})
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


# ── Индекс модели: все кейсы проекта без шагов — в памяти и на диске ─────────
#
# Внутренний foldertree на стенде закрыт (403), поэтому дерево строится из путей кейсов — а их ~4000.
# Полная выгрузка дорогая, поэтому модель держится индексом: в памяти процесса и копией на диске
# (data/zephyr_index — общий для всех пользователей сервера, переживает перезапуск). Дерево, кейсы папки и
# отбор крит регресса считаются по индексу без похода в Jira. Обновление — целиком по кнопке, по папке
# («Обновить папку») или по одному кейсу (открыли карточку); созданное через «Применить» дописывается сразу.

_ROOT = Path(__file__).resolve().parents[2]
_INDEX_DIR = _ROOT / "data" / "zephyr_index"
INDEX_FIELDS = "key,name,folder,status,priority,owner,updatedOn,issueLinks,labels,customFields"
FIRST_PAGE = 200           # 1000 за раз стенд не успевал отдать за таймаут; реальный предел — по ответу
WAVE = 6                   # страниц параллельно — не больше, чтобы не нагружать Jira
PAGE_TIMEOUT = 90          # секунд на страницу модели: стенд медленный (3 прогона — 1,4 с)
_index: dict[tuple[str, str], dict] = {}
_locks: dict[tuple[str, str], threading.Lock] = {}
_no_fields: set[str] = set()   # стенды, где параметр fields не принимается — грузим без него
_failed: dict[tuple[str, str], tuple[float, HTTPException]] = {}   # последняя неудачная загрузка модели


def _slim(c: dict) -> dict:
    return {**norm_case(c), "customFields": c.get("customFields") if isinstance(c.get("customFields"), (dict, list)) else {}}


def _index_file(base: str, project: str) -> Path:
    tag = hashlib.sha1(base.encode()).hexdigest()[:8]
    return _INDEX_DIR / f"{project}_{tag}.json"


def _save_index(base: str, project: str, idx: dict) -> None:
    try:
        _INDEX_DIR.mkdir(parents=True, exist_ok=True)
        tmp = _index_file(base, project).with_suffix(".tmp")
        tmp.write_text(json.dumps({"loadedAt": idx["loadedAt"], "cases": list(idx["cases"].values()),
                                   "folders": sorted(idx.get("folders", set()))}, ensure_ascii=False), "utf-8")
        tmp.replace(_index_file(base, project))
    except OSError as e:
        logger.warning("Zephyr: индекс не сохранился на диск: %s", e)


# Прогон в поиске приходит со всеми строками кейсов (items) — у регресса их сотни, страница из 200 таких прогонов
# не укладывалась в таймаут. Для списка нужны только эти поля: прогресс берётся из executionSummary и testCaseCount.
RUN_FIELDS = ("key,name,status,folder,version,projectVersion,issueKey,customFields,owner,"
              "plannedStartDate,plannedEndDate,testCaseCount,executionSummary,projectKey")
RUN_PAGE = 50              # прогоны тяжелее кейсов — страница меньше
SMALL_PAGE = 10            # запасной размер страницы, если обычная не уложилась в таймаут


def _page(cfg: dict, project: str, extra: str, start: int, size: int, kind: str = "testcase") -> list[dict]:
    """Страница поиска кейсов или прогонов с узким набором полей; стенд не принял fields — без него (и запоминаем)."""
    base = cfg["base_url"]
    mark = base if kind == "testcase" else f"{base}#{kind}"
    fields = "" if mark in _no_fields else INDEX_FIELDS if kind == "testcase" else RUN_FIELDS
    try:
        return _items(_first_working(cfg, kind, _search_variants(kind, project, extra, start, size, fields), PAGE_TIMEOUT))
    except HTTPException as e:
        if e.status_code != 400 or not fields:
            raise
        _no_fields.add(mark)
        logger.info("Zephyr: параметр fields не принят (%s) — гружу целиком", kind)
        return _items(_first_working(cfg, kind, _search_variants(kind, project, extra, start, size), PAGE_TIMEOUT))


def fetch_all(cfg: dict, project: str, extra: str = "", kind: str = "testcase") -> list[dict]:
    """Все кейсы (или прогоны) по запросу: первая страница → реальный размер страницы → остальные волнами параллельно."""
    want = FIRST_PAGE if kind == "testcase" else RUN_PAGE
    try:
        first = _page(cfg, project, extra, 0, want, kind)
    except HTTPException as e:
        # Стенд не успел отдать страницу (обычно — прогоны целиком, если fields не учтён): пробуем страницу поменьше.
        if kind == "testcase" or e.status_code != 502 or "timed out" not in str(e.detail).lower():
            raise
        logger.warning("Zephyr: страница %s по %s не успела (%s) — пробую по %s", kind, want, e.detail, SMALL_PAGE)
        want = SMALL_PAGE
        first = _page(cfg, project, extra, 0, want, kind)
    if len(first) < want:
        if not first:
            return []
        # Меньше, чем просили: либо кейсы кончились, либо у сервера свой предел страницы — проверяем.
        nxt = _page(cfg, project, extra, len(first), want, kind)
        if not nxt:
            return first
        size, out, start = len(first), first + nxt, len(first) * 2
        if len(nxt) < size:
            return out
    else:
        size, out, start = want, first, want
    with ThreadPoolExecutor(max_workers=WAVE) as pool:
        while start < MAX_ALL:
            offsets = [start + i * size for i in range(WAVE)]
            pages = list(pool.map(lambda o: _page(cfg, project, extra, o, size, kind), offsets))
            for pg in pages:
                out += pg
                if len(pg) < size:
                    return out
            start += WAVE * size
    return out


MAX_ALL = 30000


def _runs_key(project: str) -> str:
    """Индекс прогонов живёт рядом с индексом кейсов под своим именем (файл SBER911~runs_<tag>.json)."""
    return f"{project}~runs"


def _slim_run(r: dict) -> dict:
    return {**norm_run(r), "customFields": r.get("customFields") if isinstance(r.get("customFields"), dict) else {}}


def get_index(cfg: dict, project: str, refresh: bool = False, kind: str = "testcase") -> dict:
    """
    Индекс проекта: память → диск → Jira. Одновременные запросы ждут одну загрузку, а не грузят каждый свою.
    Загрузка упала, пока запрос ждал, — он получает ту же ошибку, а не начинает загрузку заново (иначе дерево
    и список кейсов грузили модель по очереди и не укладывались в таймаут прокси — «Internal Server Error»).
    """
    key = (cfg["base_url"], project if kind == "testcase" else _runs_key(project))
    lock = _locks.setdefault(key, threading.Lock())
    arrived = time.time()
    with lock:
        fail = _failed.get(key)
        if fail and fail[0] >= arrived:
            raise HTTPException(fail[1].status_code, fail[1].detail)
        if not refresh:
            if key in _index:
                return _index[key]
            f = _index_file(*key)
            if f.exists():
                try:
                    raw = json.loads(f.read_text("utf-8"))
                    _index[key] = {"loadedAt": raw.get("loadedAt", 0), "cases": {c["key"]: c for c in raw.get("cases", []) if c.get("key")},
                                   "folders": set(raw.get("folders", []))}
                    return _index[key]
                except (OSError, ValueError) as e:
                    logger.warning("Zephyr: индекс на диске повреждён (%s) — гружу из Jira", e)
        t0 = time.time()
        try:
            rows = fetch_all(cfg, project, kind=kind)
        except HTTPException as e:
            _failed[key] = (time.time(), e)
            logger.error("Zephyr: %s %s не загрузились за %.1f с: %s", "кейсы" if kind == "testcase" else "прогоны",
                         project, time.time() - t0, e.detail)
            raise
        _failed.pop(key, None)
        # Пустые папки, созданные в SimpleTest, в кейсах не видны — переносим их из прежнего индекса.
        keep = (_index.get(key) or {}).get("folders", set())
        slim = _slim if kind == "testcase" else _slim_run
        idx = {"loadedAt": time.time(), "cases": {c["key"]: slim(c) for c in rows if c.get("key")}, "folders": set(keep)}
        logger.info("Zephyr: %s %s загружены — %s за %.1f с", "кейсы" if kind == "testcase" else "прогоны",
                    project, len(idx["cases"]), time.time() - t0)
        _index[key] = idx
        _save_index(*key, idx)
        return idx


def _index_put(cfg: dict, project: str, cases_: list[dict], drop_folder: Optional[str] = None,
               remove: Optional[list[str]] = None, folders: Optional[list[str]] = None) -> None:
    """Точечная правка индекса: заменить кейсы папки (drop_folder), добавить/обновить кейсы, убрать кейсы (remove),
    запомнить пустые папки (folders)."""
    key = (cfg["base_url"], project)
    idx = _index.get(key)
    if idx is None:
        return
    with _locks.setdefault(key, threading.Lock()):
        if drop_folder is not None:
            for k in [k for k, c in idx["cases"].items() if c.get("folder") == drop_folder]:
                del idx["cases"][k]
        for k in remove or []:
            idx["cases"].pop(k, None)
        for c in cases_:
            if c.get("key"):
                idx["cases"][c["key"]] = c
        if folders:
            idx.setdefault("folders", set()).update(folders)
        _save_index(*key, idx)


# ── Эндпоинты чтения ─────────────────────────────────────────────────────────

@router.get("/api/zephyr/index")
def index_info(project: str = Query(..., min_length=1), refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    """Состояние модели: сколько кейсов и когда загружена. refresh=true — перечитать всё из Jira."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper(), refresh)
    return {"total": len(idx["cases"]), "loadedAt": idx["loadedAt"]}


class FolderRefresh(BaseModel):
    project: str = Field(..., min_length=1)
    folder: str = Field(..., min_length=1)


@router.post("/api/zephyr/index/folder")
def refresh_folder(body: FolderRefresh, db: Session = Depends(get_db)) -> dict:
    """Перечитать из Jira кейсы одной папки (без вложенных) — без полной перезагрузки модели."""
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    get_index(cfg, project)
    folder = body.folder.strip()
    rows = fetch_all(cfg, project, f'folder = "{folder.replace(chr(34), "")}"')
    _index_put(cfg, project, [_slim(c) for c in rows], drop_folder=folder)
    return {"folder": folder, "total": len(rows)}


@router.get("/api/zephyr/tree")
def tree(project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    """Дерево папок — из путей кейсов индекса (внутренний foldertree на стенде закрыт)."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper())
    paths = [c.get("folder") or "" for c in idx["cases"].values()]
    return {"source": "index", "folders": tree_from_paths(paths, sorted(idx.get("folders", set()))), "total": len(paths), "loadedAt": idx["loadedAt"]}


def _key_num(k: str) -> tuple[str, int]:
    m = re.match(r"^(.*?)(\d+)$", k)
    return (m.group(1), int(m.group(2))) if m else (k, 0)


@router.get("/api/zephyr/cases")
def cases(project: str = Query(..., min_length=1), folder: str = "", text: str = "",
          db: Session = Depends(get_db)) -> dict:
    """Кейсы папки (без вложенных) или поиск по названию/ключу — по индексу, без запроса в Jira."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper())
    t = text.strip().lower()
    out = [c for c in idx["cases"].values()
           if (not folder or c.get("folder") == folder) and (not t or t in c["name"].lower() or t in c["key"].lower())]
    out.sort(key=lambda c: _key_num(c["key"]))
    return {"cases": [{k: v for k, v in c.items() if k != "customFields"} for c in out[:2000]], "total": len(out)}


@router.get("/api/zephyr/case/{key}")
def case(key: str, project: str = "", db: Session = Depends(get_db)) -> dict:
    """Кейс целиком (шаги) — и заодно освежает его запись в индексе."""
    cfg = _load_cfg(db)
    c = _jira_request(cfg, "GET", f"{ATM}/testcase/{key.strip().upper()}")
    proj = (project or c.get("projectKey") or "").strip().upper()
    if proj:
        _index_put(cfg, proj, [_slim(c)])
    return {**norm_case(c), "objective": c.get("objective") or c.get("description") or "",
            "precondition": c.get("precondition") or "", "steps": norm_steps(c),
            "estimatedTime": c.get("estimatedTime"), "component": _name(c.get("component")),
            "customFields": c.get("customFields") or {}}


@router.get("/api/zephyr/runs")
def runs(project: str = Query(..., min_length=1), refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    """Все прогоны проекта — из индекса прогонов (новые сверху); refresh=true — перечитать из Jira."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper(), refresh, kind="testrun")
    out = sorted(idx["cases"].values(), key=lambda r: _key_num(r["key"]), reverse=True)
    return {"runs": [{k: v for k, v in r.items() if k != "customFields"} for r in out], "loadedAt": idx["loadedAt"]}


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
    proj = str(r.get("projectKey") or key.split("-")[0]).upper()
    _index_put(cfg, _runs_key(proj), [_slim_run(r)])     # прогресс прогона в списке — свежий
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
              remember: Optional[Callable[[Any], None]] = None, timeout: int = 20) -> None:
        p = path()
        if p is None:
            results.append({"id": cid, "label": label, "skipped": True, "reason": "нет данных из предыдущих проверок"})
            return
        t0 = time.time()
        row: dict[str, Any] = {"id": cid, "label": label, "method": "GET", "path": p, "params": params or {}}
        try:
            data = _jira_request(cfg, "GET", p, params=params, timeout=timeout)
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
            issue = next((x.get("issueKey") for x in items if x.get("issueKey")), None)   # задача из отслеживания прогона
            if store == "run" and issue:
                found.setdefault("issue", str(issue))
        return f

    check("jira-project", "Проект в Jira (id для внутреннего API)", lambda: f"/rest/api/2/project/{project}",
          remember=lambda d: found.__setitem__("pid", str(d.get("id", ""))) if isinstance(d, dict) and d.get("id") else None)
    check("case-search-v1", "Поиск кейсов: query=projectKey (публичный v1)", lambda: f"{ATM}/testcase/search",
          {"query": _q_query(project), "maxResults": 3}, first_key("case"))
    page: dict[str, Any] = {}
    check("case-page", f"Страница модели: {FIRST_PAGE} кейсов, только нужные поля", lambda: f"{ATM}/testcase/search",
          {"query": _q_query(project), "maxResults": FIRST_PAGE, "fields": INDEX_FIELDS},
          lambda d: page.__setitem__("items", _items(d)), timeout=PAGE_TIMEOUT)
    if "items" in page:   # сколько отдал сервер за раз и учёл ли fields (шаги в ответе = тяжёлая загрузка)
        steps = any(isinstance(c.get("testScript"), dict) for c in page["items"])
        results[-1]["note"] = f"кейсов: {len(page['items'])} · шаги в ответе: {'да — fields не учтён, ответ тяжелее' if steps else 'нет'}"
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
    # Связи задачи с кейсами и прогонами (вся «трассировка» Zephyr, а не только issueKey прогона): если стенд их отдаёт,
    # прогоны, привязанные к релизу и стори руками в Zephyr, можно читать отсюда.
    check("issue-cases", "Кейсы задачи: issuelink/{задача}/testcases",
          lambda: f"{ATM}/issuelink/{found['issue']}/testcases" if found.get("issue") else None)
    check("issue-runs", "Прогоны задачи: issuelink/{задача}/testruns",
          lambda: f"{ATM}/issuelink/{found['issue']}/testruns" if found.get("issue") else None)

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
# Код КЭ в конце строки: «Рабочая группа [CI07841867]» (поле «АС» кейса) или «Название (3521751)».
_KE_ID_RE = re.compile(r"[\(\[]\s*([A-Za-z]{0,4}\d+)\s*[\)\]]\s*$")
_KE_BARE_RE = re.compile(r"^[A-Za-z]{0,4}\d+$")


def _ke_split(s: str) -> tuple[str, str]:
    """«Название [CI123]» → (CI123, Название); «CI123» / «777» → (код, ""); иначе ("", строка)."""
    s = s.strip()
    m = _KE_ID_RE.search(s)
    if m:
        return m.group(1).upper(), _KE_ID_RE.sub("", s).strip()
    return (s.upper(), "") if _KE_BARE_RE.match(s) else ("", s)


def _ke_items(v: Any) -> list[dict]:
    """Значение поля КЭ → [{id, name, label}]: объекты {id, value}, строки «название (id)» / «название [CI…]», голые коды.
    У объекта код берётся из текста значения, если он там есть, — id опции Jira лишь запасной вариант."""
    out: list[dict] = []
    for x in (v if isinstance(v, list) else [v] if v not in (None, "", [], {}) else []):
        if isinstance(x, dict):
            kid, name = _ke_split(str(x.get("value") or x.get("name") or x.get("displayName") or ""))
            kid = kid or str(x.get("id") or "").strip().upper()
        else:
            kid, name = _ke_split(str(x))
        if kid or name:
            out.append({"id": kid, "name": name, "label": f"{name} ({kid})" if name and kid else name or kid})
    return out


def ke_match(case_ke: list[dict], wanted: list[dict]) -> bool:
    """КЭ кейса совпадает с одной из КЭ релиза: по коду (CI… или числовой id) или по названию без регистра."""
    for a in case_ke:
        for b in wanted:
            if a["id"] and a["id"] == b["id"]:
                return True
            if a["name"] and b["name"] and a["name"].lower() == b["name"].lower():
                return True
    return False


_YES = {"да", "yes", "true", "1", "истина"}


def _fname(n: str) -> str:
    """Имя поля для сравнения: без регистра, точек и пробелов — «Крит. регресс» = «Крит регресс»."""
    return re.sub(r"[^0-9a-zа-яё]", "", str(n).lower())


def _cf(case: dict, name: str) -> Any:
    """Пользовательское поле кейса по имени (Zephyr отдаёт customFields словарём «имя → значение»)."""
    cf = case.get("customFields") or {}
    want = _fname(name)
    if isinstance(cf, dict):
        for k, v in cf.items():
            if _fname(k) == want:
                return v
    if isinstance(cf, list):   # другие версии: [{name, value}]
        for f in cf:
            if isinstance(f, dict) and _fname(f.get("name", "")) == want:
                return f.get("value")
    return None


# Статусы кейса: API отдаёт английские названия, в интерфейсе Zephyr — русские.
_STATUS_SYN = [{"утверждено", "утвержден", "approved"}, {"черновик", "draft"}, {"устарел", "устарело", "deprecated"}]


def status_match(actual: str, wanted: str) -> bool:
    a, w = actual.strip().lower(), wanted.strip().lower()
    return a == w or any(a in g and w in g for g in _STATUS_SYN)


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
    status: str = "Утверждено"                # = Approved в API
    crit_field: str = "Крит. регресс"         # так поле называется в выгрузках Zephyr SBER911
    crit_value: str = "Да"
    type_field: str = "Вид тестирования"
    type_value: str = "Регресс"
    ke_field: str = "АС"                      # КЭ кейса в SBER911 — поле «АС»: «Рабочая группа [CI07841867]»
    only_crit: bool = True                    # False — весь регресс по КЭ, без признака «Крит. регресс»


class CritBody(BaseModel):
    project: str = Field(..., min_length=1)
    ke: list[str] = Field(default_factory=list)            # «название (id)» или id — что выбрано из релиза
    criteria: CritCriteria = Field(default_factory=CritCriteria)


def crit_filter(cases: list[dict], wanted: list[dict], c: CritCriteria) -> tuple[list[dict], dict]:
    """Отбор крит регресса + счётчики отсева (чтобы было видно, на каком условии кейсы отвалились)."""
    stats: dict[str, Any] = {"checked": 0, "no_status": 0, "no_crit": 0, "no_type": 0, "no_ke": 0}
    yes = c.crit_value.strip().lower()
    out = []
    for case in cases:
        if c.status.strip() and not status_match(_name(case.get("status")), c.status):
            stats["no_status"] += 1
            continue
        stats["checked"] += 1
        crit = _cf_texts(_cf(case, c.crit_field))
        if c.only_crit and not any(x == yes or (yes in _YES and x in _YES) for x in crit):
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
        # Только поле «КЭ»: в «КЭ дистрибутива» лежит версия, по ней кейсы не отбираются.
        if _fname(title) == "кэ" or (fid == KE_FIELD_ID and not title):
            items = _ke_items(val)
            if items:
                sources.append(f"{title or fid} ({fid})")
                ke += items
    uniq = list({(k["id"] or k["name"].lower()): k for k in ke}.values())
    return {"key": key, "summary": fields.get("summary") or "", "status": _name(fields.get("status")),
            "issuetype": _name(fields.get("issuetype")), "url": f"{cfg['base_url']}/browse/{key}",
            "ke": uniq, "keSources": sources, "stories": linked_issues(fields.get("issuelinks"))}


def linked_issues(links: Any) -> list[dict]:
    """Связи задачи (issuelinks) → задачи по ним: стори релиза прикреплены к его задаче связями."""
    out: dict[str, dict] = {}
    for ln in links if isinstance(links, list) else []:
        if not isinstance(ln, dict):
            continue
        other = ln.get("outwardIssue") or ln.get("inwardIssue")
        if not isinstance(other, dict) or not other.get("key"):
            continue
        f = other.get("fields") or {}
        t = ln.get("type") or {}
        out.setdefault(other["key"], {
            "key": other["key"], "summary": f.get("summary") or "", "status": _name(f.get("status")),
            "issuetype": _name(f.get("issuetype")),
            "link": str((t.get("outward") if ln.get("outwardIssue") else t.get("inward")) or t.get("name") or ""),
        })
    return sorted(out.values(), key=lambda x: _key_num(x["key"]))


@router.post("/api/zephyr/crit-cases")
def crit_cases(body: CritBody, db: Session = Depends(get_db)) -> dict:
    """Кейсы крит регресса по КЭ релиза — по индексу модели (без выгрузки кейсов из Jira).
    В ответе — какие пользовательские поля есть у кейсов: по ним правят названия в «Условиях»."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, body.project.strip().upper())
    rows = list(idx["cases"].values())
    wanted = [k for s_ in body.ke for k in _ke_items(s_)]
    cases_out, stats = crit_filter(rows, wanted, body.criteria)
    seen: dict[str, int] = {}
    for c in rows:
        cf = c.get("customFields") or {}
        for k in (cf.keys() if isinstance(cf, dict) else [f.get("name", "") for f in cf if isinstance(f, dict)]):
            seen[str(k)] = seen.get(str(k), 0) + 1
    stats["fields"] = [k for k, _ in sorted(seen.items(), key=lambda x: -x[1])][:40]
    return {"cases": cases_out, "stats": stats, "loadedAt": idx["loadedAt"]}


@router.get("/api/zephyr/field-values")
def field_values(project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    """Значения для выпадающих списков «Условий»: статусы кейсов и значения пользовательских полей — по модели."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper())
    statuses: dict[str, int] = {}
    fields: dict[str, dict[str, int]] = {}
    for c in idx["cases"].values():
        st = _name(c.get("status"))
        if st:
            statuses[st] = statuses.get(st, 0) + 1
        cf = c.get("customFields") or {}
        pairs = cf.items() if isinstance(cf, dict) else [(f.get("name", ""), f.get("value")) for f in cf if isinstance(f, dict)]
        for name, v in pairs:
            vals = fields.setdefault(str(name), {})
            for x in (v if isinstance(v, list) else [v]):
                t = ("Да" if x else "Нет") if isinstance(x, bool) else _name(x) if isinstance(x, dict) else "" if x is None else str(x).strip()
                if t and len(vals) < 200:
                    vals[t] = vals.get(t, 0) + 1
    top = lambda d: [k for k, _ in sorted(d.items(), key=lambda x: (-x[1], x[0]))]
    return {"statuses": top(statuses),
            "fields": {k: top(v)[:100] for k, v in sorted(fields.items(), key=lambda x: -sum(x[1].values()))}}


# ── Релизы: строки с маркерами, стори и их прогоны ───────────────────────────
#
# Строка релиза: прогон регресса (релиз в отслеживании прогона, вид «Регресс»), стори релиза (связи задачи релиза)
# и у каждой — есть ли прогон НФ (стори в отслеживании прогона, вид «Новый функционал»), и прогоны НФ самого релиза.
#
# Прогонов у релиза сколько угодно, релизов у прогона — тоже. В Zephyr это «отслеживание» прогона, но публичный API
# Server отдаёт и принимает только одну задачу (issueKey, и только при создании), а внутренний API на стенде — 403.
# Поэтому прогон релиза = релиз в issueKey прогона (из Zephyr) + связи, добавленные в SimpleTest (links). Список
# релизов и связи — data/zephyr_releases.json, общий для всех.

_RELEASES_FILE = _ROOT / "data" / "zephyr_releases.json"
_releases_lock = threading.Lock()


def _rel_load() -> dict:
    try:
        return json.loads(_RELEASES_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def _rel_save(data: dict) -> None:
    _RELEASES_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _RELEASES_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(_RELEASES_FILE)


def _rel_project(data: dict, project: str) -> dict:
    p = data.setdefault(project, {"releases": []})
    p.setdefault("links", {})   # релиз → прогоны, добавленные к нему в SimpleTest
    return p


_ISSUE_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
_RUN_RE = re.compile(r"^[A-Z][A-Z0-9_]*-[A-Z]*\d+$")   # прогон Zephyr: SBER911-C709


def _issue_key(k: str, what: str = "Номер задачи") -> str:
    k = k.strip().upper()
    if not _ISSUE_RE.match(k):
        raise HTTPException(422, f"{what} — в формате SBER911-12345")
    return k


@router.get("/api/zephyr/releases")
def releases_list(project: str = Query(..., min_length=1)) -> dict:
    """Релизы, которые ведём в SimpleTest (строки вкладки «Релиз»)."""
    with _releases_lock:
        p = _rel_load().get(project.strip().upper()) or {}
    return {"releases": list(p.get("releases", []))}


class ReleaseAdd(BaseModel):
    project: str = Field(..., min_length=1)
    key: str = Field(..., min_length=1)


@router.post("/api/zephyr/releases")
def releases_add(body: ReleaseAdd) -> dict:
    key = _issue_key(body.key, "Номер релиза")
    with _releases_lock:
        data = _rel_load()
        p = _rel_project(data, body.project.strip().upper())
        if key not in p["releases"]:
            p["releases"].insert(0, key)
        _rel_save(data)
    return p


@router.delete("/api/zephyr/releases/{key}")
def releases_remove(key: str, project: str = Query(..., min_length=1)) -> dict:
    """Убрать строку релиза из SimpleTest (в Jira ничего не меняется)."""
    key = key.strip().upper()
    with _releases_lock:
        data = _rel_load()
        p = _rel_project(data, project.strip().upper())
        p["releases"] = [k for k in p["releases"] if k != key]
        p["links"].pop(key, None)
        _rel_save(data)
    return p


class ReleaseRuns(BaseModel):
    project: str = Field(..., min_length=1)
    runKeys: list[str] = Field(..., min_length=1)


@router.post("/api/zephyr/release/{key}/runs")
def release_add_runs(key: str, body: ReleaseRuns) -> dict:
    """Добавить прогоны к релизу (связь хранится в SimpleTest: API Zephyr не меняет отслеживание готового прогона)."""
    key = _issue_key(key, "Номер релиза")
    with _releases_lock:
        data = _rel_load()
        p = _rel_project(data, body.project.strip().upper())
        links = p["links"].setdefault(key, [])
        for rk in body.runKeys:
            rk = rk.strip().upper()
            if not _RUN_RE.match(rk):
                raise HTTPException(422, f"Ключ прогона «{rk}» — в формате SBER911-C123")
            if rk not in links:
                links.append(rk)
        _rel_save(data)
    return {"key": key, "runs": links}


@router.delete("/api/zephyr/release/{key}/runs/{run_key}")
def release_remove_run(key: str, run_key: str, project: str = Query(..., min_length=1)) -> dict:
    """Убрать прогон из релиза — только связь, добавленную в SimpleTest (отслеживание в Zephyr не трогаем)."""
    key, run_key = key.strip().upper(), run_key.strip().upper()
    with _releases_lock:
        data = _rel_load()
        p = _rel_project(data, project.strip().upper())
        p["links"][key] = [k for k in p["links"].get(key, []) if k != run_key]
        _rel_save(data)
    return {"key": key, "runs": p["links"][key]}


@router.get("/api/zephyr/release/{key}/board")
def release_board(key: str, project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    """
    Строка релиза: задача релиза (КЭ, стори по связям); прогоны релиза — с релизом в отслеживании (source=zephyr)
    и добавленные в SimpleTest (source=simpletest); прогоны каждой стори (стори в отслеживании прогона).
    """
    cfg = _load_cfg(db)
    project = project.strip().upper()
    rel = release(key, db=db)
    idx = get_index(cfg, project, kind="testrun")
    by_issue: dict[str, list[dict]] = {}
    for r in idx["cases"].values():
        if r.get("issueKey"):
            by_issue.setdefault(str(r["issueKey"]).upper(), []).append(r)
    clean = lambda r: {k: v for k, v in r.items() if k != "customFields"}
    runs_out = [{**clean(r), "source": "zephyr"} for r in by_issue.get(rel["key"], [])]
    with _releases_lock:
        linked = (_rel_load().get(project) or {}).get("links", {}).get(rel["key"], [])
    have = {r["key"] for r in runs_out}
    for rk in linked:
        if rk in have:
            continue
        r = idx["cases"].get(rk)
        runs_out.append({**clean(r), "source": "simpletest"} if r else
                        {"key": rk, "name": "", "type": "", "status": "", "issueKey": "", "total": 0, "counts": {},
                         "source": "simpletest", "missing": True})
    runs_out.sort(key=lambda r: _key_num(r["key"]), reverse=True)
    story_runs = {s["key"]: [clean(r) for r in by_issue.get(s["key"], [])] for s in rel["stories"]}
    return {"release": rel, "runs": runs_out, "storyRuns": story_runs, "runsLoadedAt": idx["loadedAt"]}


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
    type: str = ""                                         # «Вид тестирования» прогона: «Регресс» — для маркера релиза


@router.post("/api/zephyr/runs")
def create_run(body: RunCreate, db: Session = Depends(get_db)) -> dict:
    """
    Новый прогон: кейсы, задача релиза в отслеживании (issueKey — его API принимает только при создании),
    вид тестирования. Стенд не принял поле вида (400 — прогон не создан) — создаём без него и предупреждаем.
    После создания прогон перечитывается: так видно, что релиз действительно встал в отслеживание.
    """
    cfg = _load_cfg(db)
    if not body.caseKeys:
        raise HTTPException(422, "В прогоне нет кейсов")
    payload: dict[str, Any] = {"projectKey": body.project.strip().upper(), "name": body.name.strip(),
                               "items": [{"testCaseKey": k} for k in dict.fromkeys(body.caseKeys)]}
    issue = body.issueKey.strip().upper()
    if issue:
        payload["issueKey"] = issue
    if body.folder.strip():
        payload["folder"] = body.folder.strip()
    warnings: list[str] = []
    variants = lambda p: [(f"{ATM}/testrun", p), (f"{ATM}/testcycle", p)]
    if body.type.strip():
        try:
            data = _write_variants(cfg, "testrun-create", "POST", variants({**payload, "customFields": {RUN_TYPE_FIELD: body.type.strip()}}))
        except HTTPException as e:
            if e.status_code != 400:
                raise
            logger.warning("Zephyr: прогон с полем «%s» не принят (%s) — создаю без него", RUN_TYPE_FIELD, e.detail)
            data = _write_variants(cfg, "testrun-create", "POST", variants(payload))
            warnings.append(f"Поле «{RUN_TYPE_FIELD}» = {body.type.strip()} стенд не принял ({e.detail}) — "
                            "прогон создан без него, поставьте вид в Zephyr вручную.")
    else:
        data = _write_variants(cfg, "testrun-create", "POST", variants(payload))
    key = (data or {}).get("key", "")
    if not key:
        raise HTTPException(502, f"Zephyr не вернул ключ прогона: {str(data)[:200]}")
    logger.info("Zephyr: создан прогон %s (%s кейсов, отслеживание %s)", key, len(payload["items"]), issue)
    tracked = ""
    try:   # перечитать: релиз в отслеживании и прогон сразу в списке прогонов и в строке релиза
        fresh = _jira_request(cfg, "GET", f"{ATM}/testrun/{key}")
        tracked = str(fresh.get("issueKey") or "").upper()
        _index_put(cfg, _runs_key(payload["projectKey"]), [_slim_run(fresh)])
    except HTTPException as e:
        logger.warning("Zephyr: прогон %s создан, но не перечитан: %s", key, e.detail)
        tracked = issue   # проверить не удалось — не пугаем ложным предупреждением
    if issue and tracked != issue:
        warnings.append(f"Прогон создан, но Zephyr не поставил {issue} в отслеживание (там: {tracked or 'пусто'}) — "
                        "добавьте релиз в отслеживание прогона в Zephyr вручную.")
    return {"key": key, "url": f"{cfg['base_url']}/secure/Tests.jspa#/testPlayer/{key}", "issueKey": tracked, "warnings": warnings}


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
    # Созданное — сразу в индекс модели: дерево обновится без полной перезагрузки из Jira.
    made = {r["id"]: r["key"] for r in results if r.get("key")}
    if made:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _index_put(cfg, project, [{
            "key": made[c.id], "name": c.name, "status": c.status, "priority": c.priority, "folder": c.folder,
            "labels": c.labels, "owner": "", "updated": now, "issueLinks": [], "customFields": c.customFields,
        } for c in body.cases if c.id in made])
    return {"createdFolders": created_folders, "folderErrors": folder_errors, "results": results,
            "created": sum(1 for r in results if r.get("key")), "failed": sum(1 for r in results if r.get("error"))}


# ── Правка структуры: папки и кейсы ──────────────────────────────────────────
#
# Публичный API v1: папку можно создать (POST /folder), кейс — создать, изменить (PUT /testcase/{key}), удалить.
# id существующих папок v1 не отдаёт (внутренний foldertree на стенде закрыт, 403), поэтому «переименовать» и
# «переместить» папку = перенести все её кейсы (с вложенными) в новый путь. Старая папка в Zephyr остаётся пустой —
# удалить её можно только в интерфейсе Zephyr; в дереве SimpleTest (оно строится по кейсам) её не будет.

def _create_folders(cfg: dict, project: str, paths: list[str]) -> dict[str, str]:
    """Папки и их родители (родители раньше). «Уже есть» — не ошибка. Возвращает ошибки по путям."""
    errors: dict[str, str] = {}
    for path in sorted({a for p in paths if p for a in _ancestors(p)}, key=lambda p: (p.count("/"), p)):
        try:
            _jira_request(cfg, "POST", f"{ATM}/folder", json_body={"projectKey": project, "name": path, "type": "TEST_CASE"})
        except HTTPException as e:
            if e.status_code == 401:
                raise
            if not re.search(r"exist|существ|already|duplicate|дубл", str(e.detail), re.I):
                errors[path] = str(e.detail)[:300]
    return errors


def _clean_path(p: str) -> str:
    parts = [x.strip() for x in p.replace("\\", "/").split("/") if x.strip()]
    return "/" + "/".join(parts) if parts else ""


class FolderCreate(BaseModel):
    project: str = Field(..., min_length=1)
    path: str = Field(..., min_length=2)


@router.post("/api/zephyr/folder")
def create_folder(body: FolderCreate, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    project, path = body.project.strip().upper(), _clean_path(body.path)
    if not path:
        raise HTTPException(422, "Пустое имя папки")
    errors = _create_folders(cfg, project, [path])
    if errors:
        raise HTTPException(502, "; ".join(f"{p}: {e}" for p, e in errors.items()))
    _index_put(cfg, project, [], folders=[path])
    return {"path": path}


def _move_cases(cfg: dict, project: str, moves: list[tuple[dict, str]]) -> dict:
    """Перенос кейсов: (запись индекса, новый путь). Сначала папки, потом PUT folder по каждому кейсу."""
    folder_errors = _create_folders(cfg, project, [to for _, to in moves])
    moved, errors = [], []
    for c, to in moves:
        bad = next((folder_errors[a] for a in _ancestors(to) if a in folder_errors), None)
        if bad:
            errors.append({"key": c["key"], "error": f"папка {to} не создалась: {bad}"})
            continue
        try:
            _jira_request(cfg, "PUT", f"{ATM}/testcase/{c['key']}", json_body={"folder": to})
            moved.append({**c, "folder": to})
        except HTTPException as e:
            if e.status_code == 401:
                raise
            errors.append({"key": c["key"], "error": str(e.detail)[:300]})
    _index_put(cfg, project, moved)
    return {"moved": len(moved), "errors": errors}


class FolderMove(BaseModel):
    project: str = Field(..., min_length=1)
    source: str = Field(..., min_length=2)                 # папка, которую переносим/переименовываем
    target: str = Field(..., min_length=2)                 # её новый полный путь


@router.post("/api/zephyr/folder/move")
def move_folder(body: FolderMove, db: Session = Depends(get_db)) -> dict:
    """Переименовать или переместить папку — переносом всех её кейсов (и вложенных папок) в новый путь."""
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    src, dst = _clean_path(body.source), _clean_path(body.target)
    if not dst or dst == src:
        raise HTTPException(422, "Новый путь совпадает со старым")
    if dst.startswith(src + "/"):
        raise HTTPException(422, "Нельзя перенести папку внутрь самой себя")
    idx = get_index(cfg, project)
    moves = [(c, dst + c["folder"][len(src):]) for c in idx["cases"].values()
             if c.get("folder") == src or (c.get("folder") or "").startswith(src + "/")]
    empty = [dst + f[len(src):] for f in idx.get("folders", set()) if f == src or f.startswith(src + "/")]
    out = _move_cases(cfg, project, moves) if moves else {"moved": 0, "errors": []}
    if empty:
        _create_folders(cfg, project, empty)
    with _locks.setdefault((cfg["base_url"], project), threading.Lock()):
        folders = idx.setdefault("folders", set())
        if not out["errors"]:
            for f in [f for f in folders if f == src or f.startswith(src + "/")]:
                folders.discard(f)
        folders.update(empty or [dst])
        _save_index(cfg["base_url"], project, idx)
    return {**out, "target": dst}


class CasesMove(BaseModel):
    project: str = Field(..., min_length=1)
    keys: list[str] = Field(default_factory=list)
    folder: str = Field(..., min_length=2)


@router.post("/api/zephyr/cases/move")
def move_cases(body: CasesMove, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    project, dst = body.project.strip().upper(), _clean_path(body.folder)
    idx = get_index(cfg, project)
    moves = [(idx["cases"][k], dst) for k in dict.fromkeys(body.keys) if k in idx["cases"] and idx["cases"][k].get("folder") != dst]
    return _move_cases(cfg, project, moves)


class CaseEdit(BaseModel):
    project: str = Field(..., min_length=1)
    name: Optional[str] = None
    folder: Optional[str] = None
    objective: Optional[str] = None
    precondition: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    labels: Optional[list[str]] = None
    issueLinks: Optional[list[str]] = None
    steps: Optional[list[StagedStep]] = None


def _edit_payload(body: CaseEdit) -> dict:
    p: dict[str, Any] = {}
    for k in ("name", "objective", "precondition", "priority", "status", "labels", "issueLinks"):
        v = getattr(body, k)
        if v is not None:
            p[k] = v.strip() if isinstance(v, str) else v
    if body.folder is not None:
        p["folder"] = _clean_path(body.folder)
    if body.steps is not None:
        p["testScript"] = {"type": "STEP_BY_STEP", "steps": [s.model_dump() for s in body.steps]}
    return p


@router.put("/api/zephyr/case/{key}")
def update_case(key: str, body: CaseEdit, db: Session = Depends(get_db)) -> dict:
    """Изменить кейс: уходят только переданные поля; шаги — целиком (testScript заменяется)."""
    cfg = _load_cfg(db)
    key, project = key.strip().upper(), body.project.strip().upper()
    payload = _edit_payload(body)
    if not payload:
        raise HTTPException(422, "Нечего сохранять")
    if payload.get("folder"):
        errors = _create_folders(cfg, project, [payload["folder"]])
        if errors:
            raise HTTPException(502, "; ".join(f"{p}: {e}" for p, e in errors.items()))
    _jira_request(cfg, "PUT", f"{ATM}/testcase/{key}", json_body=payload)
    fresh = _jira_request(cfg, "GET", f"{ATM}/testcase/{key}")
    _index_put(cfg, project, [_slim(fresh)])
    return case(key, project, db)


class CaseNew(CaseEdit):
    name: str = Field(..., min_length=1)
    folder: str = ""


@router.post("/api/zephyr/case")
def create_case(body: CaseNew, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    payload = {"projectKey": project, **_edit_payload(body)}
    if payload.get("folder"):
        errors = _create_folders(cfg, project, [payload["folder"]])
        if errors:
            raise HTTPException(502, "; ".join(f"{p}: {e}" for p, e in errors.items()))
    data = _jira_request(cfg, "POST", f"{ATM}/testcase", json_body=payload)
    key = (data or {}).get("key", "")
    if not key:
        raise HTTPException(502, f"Zephyr не вернул ключ кейса: {str(data)[:200]}")
    return update_case_index_and_get(cfg, project, key, db)


def update_case_index_and_get(cfg: dict, project: str, key: str, db: Session) -> dict:
    fresh = _jira_request(cfg, "GET", f"{ATM}/testcase/{key}")
    _index_put(cfg, project, [_slim(fresh)])
    return case(key, project, db)


@router.delete("/api/zephyr/case/{key}")
def delete_case(key: str, project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    key, project = key.strip().upper(), project.strip().upper()
    _jira_request(cfg, "DELETE", f"{ATM}/testcase/{key}")
    _index_put(cfg, project, [], remove=[key])
    return {"deleted": key}
