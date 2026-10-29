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
        "estimatedTime": c.get("estimatedTime") if isinstance(c.get("estimatedTime"), (int, float)) else None,   # мс
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
        "created": r.get("createdOn") or "",
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
        "executionTime": x.get("executionTime") if isinstance(x.get("executionTime"), (int, float)) else None,   # мс
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
INDEX_FIELDS = "key,name,folder,status,priority,owner,updatedOn,issueLinks,labels,customFields,estimatedTime"
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
RUN_FIELDS = ("key,name,status,folder,version,projectVersion,issueKey,customFields,owner,createdOn,"
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


MAX_CASES_LIST = 20000      # кейсов папки в ответе списка: вся модель (~4000) с запасом


def _cf_text(x: Any) -> str:
    return ("Да" if x else "Нет") if isinstance(x, bool) else _name(x) if isinstance(x, dict) else "" if x is None else str(x).strip()


def cf_plain(cf: Any) -> dict[str, Any]:
    """Пользовательские поля кейса → {имя: строка | [строки]}: флажок — «Да»/«Нет», объект — его имя, пустое — нет."""
    pairs = cf.items() if isinstance(cf, dict) else [(f.get("name", ""), f.get("value")) for f in (cf or []) if isinstance(f, dict)]
    out: dict[str, Any] = {}
    for name, v in pairs:
        if isinstance(v, list):
            vals = [t for t in (_cf_text(x) for x in v) if t]
            if vals:
                out[str(name)] = vals
        else:
            t = _cf_text(v)
            if t:
                out[str(name)] = t
    return out


def in_folder(case_folder: str, folder: str, children: bool) -> bool:
    """Кейс в папке: точно в ней или (children) в ней и во всех вложенных на любой глубине. "" — весь проект."""
    if not folder:
        return True
    f = case_folder or ""
    return f == folder or (children and f.startswith(folder.rstrip("/") + "/"))


@router.get("/api/zephyr/cases")
def cases(project: str = Query(..., min_length=1), folder: str = "", text: str = "", children: bool = False,
          db: Session = Depends(get_db)) -> dict:
    """Кейсы папки (children=true — и всех вложенных) или поиск по названию/ключу — по индексу, без запроса в Jira.
    Все кейсы папки, с пользовательскими полями (значения — строкой, флажок — «Да»/«Нет», несколько — списком):
    по ним фронт сортирует и фильтрует — фильтр работает на уровне выбранной папки."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper())
    t = text.strip().lower()
    out = [c for c in idx["cases"].values()
           if in_folder(c.get("folder") or "", folder, children) and (not t or t in c["name"].lower() or t in c["key"].lower())]
    out.sort(key=lambda c: _key_num(c["key"]))
    return {"cases": [{**c, "customFields": cf_plain(c.get("customFields"))} for c in out[:MAX_CASES_LIST]], "total": len(out)}


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
    # Названия кейсов — из модели проекта (в прогоне Zephyr отдаёт только ключи); модели нет — без названий.
    try:
        cases_ = get_index(cfg, proj)["cases"]
    except HTTPException:
        cases_ = {}
    rows = [{**x, "name": (cases_.get(x["testCaseKey"]) or {}).get("name", "")} for x in rows]
    return {**norm_run(r), "items": rows}


@router.post("/api/zephyr/run/{key}/pass")
def pass_run(key: str, db: Session = Depends(get_db)) -> dict:
    """«Пройти прогон»: всем кейсам прогона, у которых ещё не Pass, — результат Pass в Jira."""
    full = run(key, db=db)
    todo = [x["testCaseKey"] for x in full["items"] if x["testCaseKey"] and x["status"].strip().lower() != "pass"]
    out = save_results(full["key"], ResultsBody(results=[CaseResult(testCaseKey=k, status="Pass") for k in todo]), db=db)
    try:   # прогресс в списке прогонов — уже с новыми результатами
        cfg = _load_cfg(db)
        fresh = _jira_request(cfg, "GET", f"{ATM}/testrun/{full['key']}")
        _index_put(cfg, _runs_key(str(fresh.get("projectKey") or full["key"].split("-")[0]).upper()), [_slim_run(fresh)])
    except HTTPException as e:
        logger.warning("Zephyr: прогон %s пройден, но не перечитан: %s", full["key"], e.detail)
    return {**out, "skipped": len(full["items"]) - len(todo), "total": len(full["items"])}


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


_TRACE_FIELD_RE = re.compile(r"issue|trace|link|jira", re.I)
_ISSUE_IN_TEXT_RE = re.compile(r"\b[A-Z][A-Z0-9_]*-\d+\b")     # ключ задачи; прогон (SBER911-C709) не совпадёт
_RUN_IN_TEXT_RE = re.compile(r"\b[A-Z][A-Z0-9_]*-C\d+\b")


def trace_summary(r: Any) -> str:
    """
    Поля прогона, похожие на отслеживание (issueKey, issueKeys, issueLinks, traceLinks, issueCount…), → «поле=ключи».
    Только ключи задач и числа, без текста: так в отчёте видно, отдаёт ли API всё отслеживание, а не одну задачу.
    """
    if not isinstance(r, dict):
        return "отслеживание: ответ не объект"
    parts = []
    for k, v in r.items():
        if not _TRACE_FIELD_RE.search(k):
            continue
        if v is None or isinstance(v, (bool, int, float)):
            parts.append(f"{k}={v}")
            continue
        keys = sorted(set(_ISSUE_IN_TEXT_RE.findall(json.dumps(v, ensure_ascii=False))))
        parts.append(f"{k}=[{', '.join(keys)}]" if keys else f"{k}: {type(v).__name__} без ключей задач")
    return "отслеживание: " + (" · ".join(parts) if parts else "полей нет")


@router.get("/api/zephyr/probe")
def probe(project: str = Query("SBER911", min_length=1), samples: bool = False, run: str = "", issue: str = "",
          run_id: str = "", db: Session = Depends(get_db)) -> dict:
    """
    Проверяет запросы чтения обоих вариантов и возвращает отчёт: что сработало, код ответа, каркас ответа
    (ключи и типы, без данных). samples=true — ещё и начало ответа (для разбора формата; там будут данные).
    Ничего не меняет в Jira.
    """
    cfg = _load_cfg(db)
    project = project.strip().upper()
    found: dict[str, str] = {}
    if run.strip():    # прогон, у которого в отслеживании и релиз, и стори, — чтобы увидеть, как API его отдаёт
        found["run"] = run.strip().upper()
    if issue.strip():
        found["issue"] = issue.strip().upper()
    if run_id.strip().isdigit():   # числовой id прогона — из адреса запроса на странице прогона в Zephyr
        found["run_id"] = run_id.strip()
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
    run_obj: dict[str, Any] = {}
    check("run-get-v1", "Прогон целиком: testrun/{key}", lambda: f"{ATM}/testrun/{found['run']}" if found.get("run") else None,
          remember=lambda d: run_obj.update(d) if isinstance(d, dict) else None)
    if run_obj:
        results[-1]["note"] = trace_summary(run_obj)
    check("run-results-v1", "Результаты прогона: testrun/{key}/testresults",
          lambda: f"{ATM}/testrun/{found['run']}/testresults" if found.get("run") else None)
    check("run-get-doc", "Прогон целиком: testcycle/{key}", lambda: f"{ATM}/testcycle/{found['run']}" if found.get("run") else None)
    # Отслеживание прогона, где кроме релиза стоят стори: отдаёт ли его API целиком хоть где-то. Поиск по отслеживанию
    # стенд не понимает (в TQL только projectKey и folder), поэтому прогон ищется по своей папке — ответ поиска
    # бывает полнее, чем testrun/{key}.
    def run_in(store: dict) -> Callable[[Any], None]:
        return lambda d: store.update(items=_items(d))

    def note_run_in(store: dict) -> None:
        if "items" not in store:
            return
        hit = next((x for x in store["items"] if str(x.get("key", "")).upper() == found.get("run")), None)
        results[-1]["note"] = trace_summary(hit) if hit else f"прогона {found.get('run')} нет среди {len(store['items'])} в папке"

    folder = str(run_obj.get("folder") or "")
    folder_q = _q_query(project, 'folder = "' + folder.replace('"', '\\"') + '"') if folder else ""
    by_folder: dict[str, Any] = {}
    check("run-trace-folder", "Отслеживание прогона: поиск по его папке (целиком)",
          lambda: f"{ATM}/testrun/search" if folder_q else None, {"query": folder_q, "maxResults": 200}, run_in(by_folder))
    note_run_in(by_folder)
    by_fields: dict[str, Any] = {}
    check("run-trace-folder-fields", "Отслеживание прогона: поиск по папке с fields issueKeys/issueLinks/traceLinks",
          lambda: f"{ATM}/testrun/search" if folder_q else None,
          {"query": folder_q, "maxResults": 200, "fields": "key,issueKey,issueKeys,issueLinks,traceLinks,issueCount"},
          run_in(by_fields))
    note_run_in(by_fields)
    internal: dict[str, Any] = {}
    check("run-trace-internal", "Отслеживание прогона: внутренний API (попытка; если закрыт — 403, как дерево)",
          lambda: f"{TESTS}/testrun/search" if found.get("run") and found.get("pid") else None,
          {"query": f'testRun.projectId IN ({found.get("pid", "")}) AND testRun.key IN ("{found.get("run", "")}")',
           "fields": "id,key,traceLinks", "maxResults": 1},
          lambda d: internal.update(items=_items(d)))
    if internal.get("items"):
        results[-1]["note"] = trace_summary(internal["items"][0])
    # Отслеживание так, как его читает страница прогона в Zephyr (её блок связей работает, в отличие от блока в Jira):
    # внутренний tracelinks/issue по числовому id прогона. В ответе — Jira-задачи числовыми id (issueId), ключи
    # SBER911-… — поиском Jira «id in (…)». Числовой id публичный API не отдаёт: пробуем внутренний testrun/{ключ},
    # иначе id вводят руками.
    by_key: dict[str, Any] = {}
    check("run-id-internal", "Числовой id прогона по ключу: внутренний testrun/{ключ}",
          lambda: f"{TESTS}/testrun/{found['run']}" if found.get("run") else None, {"fields": "id,key"},
          lambda d: by_key.update(id=str(d.get("id") or "")) if isinstance(d, dict) else None)
    if by_key.get("id"):
        found.setdefault("run_id", by_key["id"])
        results[-1]["note"] = f"id {by_key['id']}"
    links_: dict[str, Any] = {}
    check("run-tracelinks", "Отслеживание прогона: tracelinks/issue по id (как страница прогона в Zephyr)",
          lambda: f"{TESTS}/testrun/{found['run_id']}/tracelinks/issue" if found.get("run_id") else None,
          {"fields": "id,issueId,type(id,index,name,i18nKey,systemKey),testCaseId,testRunId,testPlanId"},
          lambda d: links_.update(items=_items(d)))
    issue_ids = sorted({str(x.get("issueId")) for x in links_.get("items", []) if x.get("issueId")}, key=int)
    if "items" in links_:
        results[-1]["note"] = f"связей: {len(links_['items'])} · issueId: {', '.join(issue_ids) or 'нет'}"
    keys_: dict[str, str] = {}
    check("run-tracelinks-keys", "Ключи задач из отслеживания: поиск Jira «id in (…)»",
          lambda: "/rest/api/2/search" if issue_ids else None,
          {"jql": f"id in ({','.join(issue_ids)})", "fields": "issuetype", "maxResults": 100},
          lambda d: keys_.update({str(i.get("id")): f"{i.get('key')} ({_name((i.get('fields') or {}).get('issuetype'))})"
                                  for i in (d.get("issues") or []) if isinstance(i, dict)}) if isinstance(d, dict) else None)
    if keys_:
        results[-1]["note"] = "отслеживание: " + ", ".join(keys_[i] for i in issue_ids if i in keys_)
    links: dict[str, Any] = {}
    check("issue-remotelinks", "Ссылки задачи в Jira (remotelink): пишет ли Zephyr туда прогоны",
          lambda: f"/rest/api/2/issue/{found['issue']}/remotelink" if found.get("issue") else None,
          remember=lambda d: links.update(raw=d))
    if "raw" in links:
        runs_ = sorted(set(_RUN_IN_TEXT_RE.findall(json.dumps(links["raw"], ensure_ascii=False))))
        results[-1]["note"] = f"ссылок: {len(_items(links['raw']))} · прогоны в них: {', '.join(runs_) or 'нет'}"
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
    check("trace-tql", "Прогоны по отслеживанию: поиск issueKeys IN (задача)",
          lambda: f"{ATM}/testrun/search" if found.get("issue") else None,
          {"query": _q_query(project, f'issueKeys IN ("{found.get("issue", "")}")'), "maxResults": 20, "fields": RUN_FIELDS})

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
    """Значения полей по модели — для выпадающих списков «Условий», фильтров и массовой правки: статусы, приоритеты,
    владельцы, метки и пользовательские поля с типом (kinds: bool — флажок, multi — несколько значений,
    number — число, text — строка/список выбора)."""
    cfg = _load_cfg(db)
    idx = get_index(cfg, project.strip().upper())
    def count(d: dict[str, int], t: str) -> None:
        if t:
            d[t] = d.get(t, 0) + 1

    statuses: dict[str, int] = {}
    priorities: dict[str, int] = {}
    owners: dict[str, int] = {}
    labels: dict[str, int] = {}
    fields: dict[str, dict[str, int]] = {}
    kinds: dict[str, str] = {}
    for c in idx["cases"].values():
        count(statuses, _name(c.get("status")))
        count(priorities, _name(c.get("priority")))
        count(owners, _name(c.get("owner")))
        for l in c.get("labels") or []:
            count(labels, str(l).strip())
        cf = c.get("customFields") or {}
        pairs = cf.items() if isinstance(cf, dict) else [(f.get("name", ""), f.get("value")) for f in cf if isinstance(f, dict)]
        for name, v in pairs:
            name = str(name)
            vals = fields.setdefault(name, {})
            kind = "multi" if isinstance(v, list) else "bool" if isinstance(v, bool) else \
                "number" if isinstance(v, (int, float)) else "text" if v is not None else ""
            if kind:
                # Разный тип у разных кейсов: где-то списком — поле на несколько значений, иначе — строка.
                prev = kinds.get(name)
                kinds[name] = kind if prev in (None, kind) else "multi" if "multi" in (prev, kind) else "text"
            for x in (v if isinstance(v, list) else [v]):
                t = _cf_text(x)
                if t and (t in vals or len(vals) < 200):
                    vals[t] = vals.get(t, 0) + 1
    top = lambda d: [k for k, _ in sorted(d.items(), key=lambda x: (-x[1], x[0]))]
    return {"statuses": top(statuses), "priorities": top(priorities), "owners": top(owners), "labels": top(labels)[:300],
            "fields": {k: top(v)[:100] for k, v in sorted(fields.items(), key=lambda x: -sum(x[1].values()))},
            "kinds": kinds}


# ── Релизы: строки с маркерами, стори и их прогоны ───────────────────────────
#
# Прогоны к релизу прикрепляют руками в Zephyr: в отслеживании прогона — номер релиза (и стори). SimpleTest берёт
# прогоны, у которых в отслеживании релиз, и для каждой стори релиза смотрит, есть ли она в отслеживании этих прогонов.
#
# Всё отслеживание прогона публичный API отдаёт только поиском (TQL `issueKeys IN (…)`), если стенд его понимает;
# в самом прогоне видна одна задача — issueKey. Не понимает — считаем по issueKey и честно помечаем (traceSource).
# Список релизов — data/zephyr_releases.json, общий для всех.

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
    p.pop("links", None)   # ручные связи прогон↔релиз прежних версий: теперь отслеживание ставят в Zephyr
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
        p.get("nf", {}).pop(key, None)    # сохранённые НФ-прогоны и покрытие этого релиза — вместе со строкой
        _rel_save(data)
    return p


_trace_tql: dict[str, bool] = {}   # стенд понимает поиск прогонов по отслеживанию (issueKeys IN …)?


def trace_runs(cfg: dict, project: str, issue: str) -> Optional[list[dict]]:
    """Прогоны, у которых задача есть в отслеживании (поиск TQL). Стенд такой поиск не понимает (400) — None."""
    base = cfg["base_url"]
    if _trace_tql.get(base) is False:
        return None
    params = {"query": _q_query(project, f'issueKeys IN ("{issue}")'), "startAt": 0, "maxResults": 200, "fields": RUN_FIELDS}
    try:
        data = _jira_request(cfg, "GET", f"{ATM}/testrun/search", params=params, timeout=PAGE_TIMEOUT)
    except HTTPException as e:
        if e.status_code != 400:
            raise
        _trace_tql[base] = False
        logger.info("Zephyr: поиск прогонов по отслеживанию не поддерживается (%s) — считаю по issueKey", e.detail)
        return None
    _trace_tql[base] = True
    return [_slim_run(r) for r in _items(data) if r.get("key")]


@router.get("/api/zephyr/release/{key}/board")
def release_board(key: str, project: str = Query(..., min_length=1), db: Session = Depends(get_db)) -> dict:
    """
    Строка релиза: задача релиза (КЭ, стори по связям); прогоны с релизом в отслеживании; для каждой стори —
    прогоны релиза, в отслеживании которых она есть. traceSource: tql — по всему отслеживанию (поиск);
    issueKey — стенд поиск не понимает: прогоны релиза — с релизом в issueKey, прогоны стори — со стори в issueKey.
    """
    cfg = _load_cfg(db)
    project = project.strip().upper()
    rel = release(key, db=db)
    clean = lambda r: {k: v for k, v in r.items() if k != "customFields"}
    order = lambda rs: sorted(rs, key=lambda r: _key_num(r["key"]), reverse=True)
    rel_runs = trace_runs(cfg, project, rel["key"])
    if rel_runs is not None:
        keys = {r["key"] for r in rel_runs}
        with ThreadPoolExecutor(max_workers=WAVE) as pool:
            found = dict(zip([s_["key"] for s_ in rel["stories"]],
                             pool.map(lambda s_: trace_runs(cfg, project, s_["key"]) or [], rel["stories"])))
        story_runs = {k: [clean(r) for r in v if r["key"] in keys] for k, v in found.items()}
        source = "tql"
    else:
        idx = get_index(cfg, project, kind="testrun")
        by_issue: dict[str, list[dict]] = {}
        for r in idx["cases"].values():
            if r.get("issueKey"):
                by_issue.setdefault(str(r["issueKey"]).upper(), []).append(r)
        rel_runs = by_issue.get(rel["key"], [])
        story_runs = {s_["key"]: [clean(r) for r in by_issue.get(s_["key"], [])] for s_ in rel["stories"]}
        source = "issueKey"
    # Сохранённый список НФ-прогонов релиза: сверка добавляет найденные (кроме убранных руками); прогоны,
    # которые API не показывает с релизом (релиз — не основная задача), добавляют руками — они остаются.
    with _releases_lock:
        data = _rel_load()
        # Прогоны регресса, откреплённые от релиза в SimpleTest (собирают новый): в строке релиза их больше нет.
        detached = set(_rel_project(data, project).get("regressDetached", {}).get(rel["key"], []))
        rel_runs = [r for r in rel_runs if r["key"] not in detached]
        nf = _rel_nf(_rel_project(data, project), rel["key"])
        for r in rel_runs:
            if is_nf_type(r.get("type", "")) and r["key"] not in nf["runs"] and r["key"] not in nf["removed"]:
                nf["runs"].append(r["key"])
            if r["key"] in nf["runs"]:
                nf["runInfo"][r["key"]] = _run_info(r)
        nf["syncedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
        _rel_save(data)
        stored = dict(nf)
    nf_runs = [_nf_run_view(cfg, project, k, stored) for k in stored["runs"]]
    # Прогоны, прикреплённые к стори в SimpleTest (API отслеживание готового прогона не пишет), — к найденным в Zephyr.
    attached = {s_: list(v) for s_, v in (stored.get("attached") or {}).items()}
    for s_, runs_ in attached.items():
        have = {r["key"] for r in story_runs.get(s_, [])}
        story_runs.setdefault(s_, []).extend(
            {**v, "attached": True} for v in (_nf_run_view(cfg, project, k, stored) for k in runs_ if k not in have) if v)
    return {"release": rel, "runs": order(clean(r) for r in rel_runs),
            "storyRuns": {k: order(v) for k, v in story_runs.items()}, "traceSource": source,
            "nfRuns": order(r for r in nf_runs if r), "attached": attached,
            "jiraLinked": {s_: list(v) for s_, v in (stored.get("jiraLinks") or {}).items()},
            "jiraLinksStale": _links_stale(stored)}


# ── НФ-прогоны релиза и прогоны стори — у нас, а не в API ────────────────────
#
# Полное отслеживание прогона API не отдаёт и не пишет (внутренний /rest/tests — 403), поэтому:
#   • список НФ-прогонов релиза хранится в data/zephyr_releases.json (сверка по issueKey + ручное добавление);
#   • прогоны стори: найденные в Zephyr (стори в issueKey прогона) + прикреплённые в SimpleTest (attached:
#     стори → прогоны) — «Прикрепить имеющийся» или «Создать НФ-прогон» на стори (стори в отслеживании при создании).

def is_nf_type(t: str) -> bool:
    """Вид прогона «Новый функционал» / «НФ…» — как runKind во фронте."""
    return bool(re.search(r"^нф(?![а-яё])|нов\S*\s+функц", t.strip().lower()))


def _rel_nf(p: dict, rel: str) -> dict:
    nf = p.setdefault("nf", {}).setdefault(rel, {})
    for k, v in (("runs", []), ("removed", []), ("attached", {}), ("runInfo", {}), ("jiraLinks", {})):
        nf.setdefault(k, v)
    # До 24.10.2026 связи стори ↔ прогон правили руками в «Покрытии» (manual) — отмеченные переносим в прикреплённые.
    for story, runs_ in (nf.pop("manual", None) or {}).items():
        for run, on in runs_.items():
            if on and run not in nf["attached"].setdefault(story, []):
                nf["attached"][story].append(run)
    nf.pop("coverage", None)
    nf.pop("stories", None)
    return nf


def _run_info(r: dict) -> dict:
    """Что нужно для расчёта покрытия без API: название и задача отслеживания."""
    return {"name": r.get("name") or "", "issueKey": str(r.get("issueKey") or "").upper(), "type": r.get("type") or ""}


def _nf_run_view(cfg: dict, project: str, key: str, nf: dict) -> Optional[dict]:
    """Прогон из списка релиза — карточкой: из индекса прогонов, иначе из сохранённого снимка."""
    try:
        r = (get_index(cfg, project, kind="testrun")["cases"]).get(key)
    except HTTPException:
        r = None
    if r:
        return {k: v for k, v in r.items() if k != "customFields"}
    info = nf["runInfo"].get(key) or {}
    return {"key": key, "name": info.get("name", ""), "status": "", "folder": "", "version": "", "issueKey": info.get("issueKey", ""),
            "type": info.get("type", ""), "owner": "", "created": "", "plannedStart": "", "plannedEnd": "", "total": 0, "counts": {}}


class NfRunsEdit(BaseModel):
    project: str = Field(..., min_length=1)
    add: str = ""
    remove: str = ""


@router.post("/api/zephyr/release/{key}/nf-runs")
def release_nf_runs(key: str, body: NfRunsEdit, db: Session = Depends(get_db)) -> dict:
    """Добавить прогон в список НФ релиза руками (по номеру) или убрать (сверка его больше не вернёт)."""
    rel, project = _issue_key(key, "Номер релиза"), body.project.strip().upper()
    info = None
    if body.add.strip():
        run = body.add.strip().upper()
        if not _RUN_RE.match(run):
            raise HTTPException(422, "Номер прогона — в формате SBER911-C709")
        r = _jira_request(_load_cfg(db), "GET", f"{ATM}/testrun/{run}")
        info = _run_info(norm_run(r))
    with _releases_lock:
        data = _rel_load()
        nf = _rel_nf(_rel_project(data, project), rel)
        if info is not None:
            run = body.add.strip().upper()
            if run not in nf["runs"]:
                nf["runs"].append(run)
            nf["removed"] = [x for x in nf["removed"] if x != run]
            nf["runInfo"][run] = info
        if body.remove.strip():
            run = body.remove.strip().upper()
            nf["runs"] = [x for x in nf["runs"] if x != run]
            if run not in nf["removed"]:
                nf["removed"].append(run)
            nf["runInfo"].pop(run, None)
        _rel_save(data)
        return {"runs": list(nf["runs"]), "removed": list(nf["removed"])}


class RegressDetach(BaseModel):
    project: str = Field(..., min_length=1)
    run: str = Field(..., min_length=1)


@router.post("/api/zephyr/release/{key}/regress-detach")
def release_regress_detach(key: str, body: RegressDetach) -> dict:
    """Открепить прогон регресса от релиза — чтобы собрать новый. Только в SimpleTest: API отслеживание прогона
    не меняет, поэтому в Zephyr релиз у прогона остаётся (уберите вручную, если нужно)."""
    rel, run = _issue_key(key, "Номер релиза"), body.run.strip().upper()
    if not _RUN_RE.match(run):
        raise HTTPException(422, "Номер прогона — в формате SBER911-C709")
    with _releases_lock:
        data = _rel_load()
        lst = _rel_project(data, body.project.strip().upper()).setdefault("regressDetached", {}).setdefault(rel, [])
        if run not in lst:
            lst.append(run)
        _rel_save(data)
        return {"detached": list(lst)}


class StoriesAttach(BaseModel):
    project: str = Field(..., min_length=1)
    stories: list[str] = Field(..., min_length=1, max_length=500)
    run: str = Field(..., min_length=1)


# ── Привязка стори к прогону в Jira ──────────────────────────────────────────
#
# Отслеживание готового прогона Zephyr не меняется через API (публичный пишет одну задачу и только при создании,
# внутренний — 403). Поэтому привязка ставится и в Jira: на стори — ссылка (remote link) на прогон Zephyr,
# видна в разделе «Ссылки» задачи. globalId у ссылки свой на каждый прогон — повторная привязка не плодит дублей,
# открепление удаляет именно её. Связь в SimpleTest (attached) остаётся основной для доски релиза; где ссылка
# в Jira уже стоит — в jiraLinks.

def _link_id(run: str) -> str:
    return f"simpletest:zephyr-run:{run}"


def run_url(base_url: str, run: str) -> str:
    """Прогон в Zephyr — страница прогона с правкой (кейсы, отслеживание, поля), а не плеер прохождения (#/testPlayer)."""
    return f"{base_url}/secure/Tests.jspa#/testRun/{run}"


# Версия адреса в ссылках на стори: 1 — плеер (#/testPlayer), 2 — страница прогона. Ссылки старой версии релиз
# помечает устаревшими (jiraLinksStale), «Записать привязки в Jira» переписывает их тем же globalId — без дублей.
LINK_V = 2


def _links_stale(nf: dict) -> bool:
    return bool(nf.get("jiraLinks")) and nf.get("jiraLinksV") != LINK_V


def jira_link_run(cfg: dict, story: str, run: str, info: dict, rel: str) -> None:
    title = f"{run} · {info.get('name') or 'прогон Zephyr'}"
    _jira_request(cfg, "POST", f"/rest/api/2/issue/{story}/remotelink", json_body={
        "globalId": _link_id(run),
        "application": {"type": "simpletest.zephyr", "name": "Zephyr Scale"},
        "relationship": "НФ-прогон",
        "object": {"url": run_url(cfg["base_url"], run), "title": title[:255],
                   "summary": f"Прогон нового функционала релиза {rel}"},
    })


def jira_unlink_run(cfg: dict, story: str, run: str) -> None:
    try:
        _jira_request(cfg, "DELETE", f"/rest/api/2/issue/{story}/remotelink", params={"globalId": _link_id(run)})
    except HTTPException as e:
        if e.status_code != 404:                       # ссылки уже нет — это и нужно
            raise


def _mark_jira(nf: dict, story: str, run: str, on: bool) -> None:
    links = nf.setdefault("jiraLinks", {})
    if on and not links:                    # первая ссылка релиза — сразу нового вида
        nf["jiraLinksV"] = LINK_V
    cur = [x for x in links.get(story, []) if x != run] + ([run] if on else [])
    if cur:
        links[story] = cur
    else:
        links.pop(story, None)


@router.post("/api/zephyr/release/{key}/attach")
def release_attach(key: str, body: StoriesAttach, db: Session = Depends(get_db)) -> dict:
    """
    Прикрепить имеющийся прогон к стори релиза: связь в SimpleTest (стори красится «Прогон есть», прогон встаёт в НФ
    релиза) и ссылка на прогон на самой стори в Jira. Ошибка Jira не отменяет привязку в SimpleTest — она в ответе
    (jira: {стори: "ok" | текст ошибки}), и ссылку можно дописать позже кнопкой «Записать привязки в Jira».
    """
    rel, project = _issue_key(key, "Номер релиза"), body.project.strip().upper()
    run = body.run.strip().upper()
    if not _RUN_RE.match(run):
        raise HTTPException(422, "Номер прогона — в формате SBER911-C709")
    cfg = _load_cfg(db)
    info = _run_info(norm_run(_jira_request(cfg, "GET", f"{ATM}/testrun/{run}")))
    stories = [_issue_key(x, "Номер стори") for x in body.stories]
    jira: dict[str, str] = {}
    for st in stories:
        try:
            jira_link_run(cfg, st, run, info, rel)
            jira[st] = "ok"
        except HTTPException as e:
            jira[st] = str(e.detail)
    with _releases_lock:
        data = _rel_load()
        nf = _rel_nf(_rel_project(data, project), rel)
        for st in stories:
            runs_ = nf.setdefault("attached", {}).setdefault(st, [])
            if run not in runs_:
                runs_.append(run)
            _mark_jira(nf, st, run, jira[st] == "ok")
        if run not in nf["runs"]:
            nf["runs"].append(run)
        nf["removed"] = [x for x in nf["removed"] if x != run]
        nf["runInfo"][run] = info
        _rel_save(data)
        return {"attached": nf["attached"], "jiraLinked": nf["jiraLinks"], "jira": jira}


class StoryDetach(BaseModel):
    project: str = Field(..., min_length=1)
    story: str = Field(..., min_length=1)
    run: str = Field(..., min_length=1)


@router.post("/api/zephyr/release/{key}/detach")
def release_detach(key: str, body: StoryDetach, db: Session = Depends(get_db)) -> dict:
    """Открепить прогон от стори: в SimpleTest и ссылку на стори в Jira. Ошибка Jira — в ответе (jira), связь в
    SimpleTest всё равно снимается."""
    rel, story, run = _issue_key(key, "Номер релиза"), _issue_key(body.story, "Номер стори"), body.run.strip().upper()
    jira = "ok"
    try:
        jira_unlink_run(_load_cfg(db), story, run)
    except HTTPException as e:
        jira = str(e.detail)
    with _releases_lock:
        data = _rel_load()
        nf = _rel_nf(_rel_project(data, body.project.strip().upper()), rel)
        att = nf.setdefault("attached", {})
        att[story] = [x for x in att.get(story, []) if x != run]
        if not att[story]:
            att.pop(story)
        if jira == "ok":
            _mark_jira(nf, story, run, False)
        _rel_save(data)
        return {"attached": att, "jiraLinked": nf["jiraLinks"], "jira": jira}


class JiraSyncBody(BaseModel):
    project: str = Field(..., min_length=1)


@router.post("/api/zephyr/release/{key}/attached/jira")
def release_attached_to_jira(key: str, body: JiraSyncBody, db: Session = Depends(get_db)) -> dict:
    """Дописать в Jira ссылки для привязок, которых там ещё нет (сделаны до этой функции или Jira тогда не ответила),
    и переписать устаревшие (ссылка вела в плеер, а не на страницу прогона)."""
    rel, project = _issue_key(key, "Номер релиза"), body.project.strip().upper()
    cfg = _load_cfg(db)
    with _releases_lock:
        nf = dict(_rel_nf(_rel_project(_rel_load(), project), rel))
    stale = _links_stale(nf)
    todo = [(st, run) for st, runs_ in (nf.get("attached") or {}).items() for run in runs_
            if stale or run not in (nf.get("jiraLinks") or {}).get(st, [])]
    results: list[dict] = []
    infos: dict[str, dict] = {}
    for st, run in todo:
        info = infos.get(run) or (nf.get("runInfo") or {}).get(run) or {}
        if not info.get("name"):                      # старые привязки без снимка прогона — название берём из Zephyr
            try:
                info = _run_info(norm_run(_jira_request(cfg, "GET", f"{ATM}/testrun/{run}")))
            except HTTPException:
                pass
        infos[run] = info
        try:
            jira_link_run(cfg, st, run, info, rel)
            results.append({"story": st, "run": run, "ok": True})
        except HTTPException as e:
            results.append({"story": st, "run": run, "ok": False, "error": str(e.detail)})
    with _releases_lock:
        data = _rel_load()
        live = _rel_nf(_rel_project(data, project), rel)
        for r in results:
            if r["ok"]:
                _mark_jira(live, r["story"], r["run"], True)
        if all(r["ok"] for r in results):
            live["jiraLinksV"] = LINK_V
        _rel_save(data)
        return {"results": results, "jiraLinked": live.get("jiraLinks", {}), "jiraLinksStale": _links_stale(live)}


def nf_type_value(cfg: dict, project: str) -> str:
    """Как на стенде называется вид «Новый функционал» у прогонов: первый НФ-вид из индекса прогонов."""
    try:
        for r in get_index(cfg, project, kind="testrun")["cases"].values():
            if is_nf_type(r.get("type") or ""):
                return r["type"]
    except HTTPException:
        pass
    return "Новый функционал"


def story_cases(cfg: dict, project: str, story: str) -> list[str]:
    """Кейсы, привязанные к стори в Zephyr (связи кейса с задачами), — по индексу модели."""
    idx = get_index(cfg, project)["cases"]
    return sorted((k for k, c in idx.items() if story in [str(x).upper() for x in c.get("issueLinks") or []]), key=_key_num)


@router.get("/api/zephyr/release/{key}/story-cases")
def release_story_cases(key: str, project: str = Query(..., min_length=1), stories: str = "", db: Session = Depends(get_db)) -> dict:
    """Сколько кейсов привязано к каждой стори — до создания НФ-прогонов (прогон без кейсов не создаём)."""
    cfg = _load_cfg(db)
    keys = [_issue_key(x, "Номер стори") for x in stories.split(",") if x.strip()]
    return {"cases": {k: story_cases(cfg, project.strip().upper(), k) for k in keys}, "type": nf_type_value(cfg, project.strip().upper())}


class StoryRunsCreate(BaseModel):
    project: str = Field(..., min_length=1)
    stories: list[dict] = Field(..., min_length=1, max_length=100)   # [{key, summary}]
    folder: str = ""
    type: str = ""


@router.post("/api/zephyr/release/{key}/story-runs")
def release_story_runs(key: str, body: StoryRunsCreate, db: Session = Depends(get_db)) -> dict:
    """
    НФ-прогон на каждую выбранную стори: стори — в отслеживании (API ставит задачу только при создании),
    кейсы — привязанные к стори, вид — НФ. Созданный прогон сразу в НФ релиза и у стори. Нет кейсов — не создаём.
    """
    cfg = _load_cfg(db)
    rel, project = _issue_key(key, "Номер релиза"), body.project.strip().upper()
    run_type = body.type.strip() or nf_type_value(cfg, project)
    results = []
    for st in body.stories:
        story = _issue_key(str(st.get("key", "")), "Номер стори")
        cases_ = story_cases(cfg, project, story)
        if not cases_:
            results.append({"story": story, "error": "к стори не привязано ни одного кейса — прикрепите имеющийся прогон"})
            continue
        name = f"НФ-{story} · {str(st.get('summary') or '').strip()}".strip(" ·")[:255]
        try:
            r = create_run(RunCreate(project=project, name=name, issueKey=story, caseKeys=cases_, folder=body.folder, type=run_type), db)
        except HTTPException as e:
            if e.status_code == 401:
                raise
            results.append({"story": story, "error": str(e.detail)[:300]})
            continue
        with _releases_lock:
            data = _rel_load()
            nf = _rel_nf(_rel_project(data, project), rel)
            if r["key"] not in nf["runs"]:
                nf["runs"].append(r["key"])
            nf["runInfo"][r["key"]] = {"name": name, "issueKey": story, "type": run_type}
            runs_ = nf.setdefault("attached", {}).setdefault(story, [])
            if r["key"] not in runs_:
                runs_.append(r["key"])
            _rel_save(data)
        results.append({"story": story, "run": r["key"], "cases": len(cases_), "warnings": r.get("warnings", [])})
    return {"results": results, "created": sum(1 for x in results if x.get("run"))}


# ── Выравнивание КЭ: все КЭ релиза — на все его стори ────────────────────────
#
# По процессу у каждой стори релиза должны стоять все КЭ релиза. Добавляются только недостающие, свои КЭ стори
# не трогаются. Как поле КЭ принимает запись, на стенде ещё не проверено, поэтому:
#   • план (GET …/ke-plan) — только чтение: что у кого есть и чего не хватает + как поле объявлено у стори
#     (editmeta: есть ли на экране правки, тип, операции) — это и есть проверка API;
#   • запись (POST …/ke-apply) — только по кнопке; значения КЭ уходят в том же виде, в каком Jira их отдаёт
#     у релиза, ответ Jira по каждой стори виден как есть.

_STORY_RE = re.compile(r"истори|стори|story", re.I)    # как isStory во фронте (ReleasesView)


def _raw_list(v: Any) -> list:
    return [x for x in v if x not in (None, "")] if isinstance(v, list) else [] if v in (None, "", {}) else [v]


def _ke_ident(x: Any) -> str:
    """Чем одна КЭ отличается от другой: код (CI…/id), иначе название; непонятное значение — целиком."""
    items = _ke_items(x)
    if items:
        return items[0]["id"] or items[0]["name"].lower()
    return json.dumps(x, ensure_ascii=False, sort_keys=True)


def _ke_label(x: Any) -> str:
    items = _ke_items(x)
    return items[0]["label"] if items else str(x)


def _release_ke_raw(cfg: dict, key: str) -> dict:
    """Задача релиза: поле КЭ (id и название), его значения как есть и стори по связям."""
    data = _jira_request(cfg, "GET", f"/rest/api/2/issue/{key}", params={"expand": "names", "fields": "*all"})
    fields = data.get("fields") or {}
    names = data.get("names") or {}
    fid = next((f for f, title in names.items() if _fname(str(title)) == "кэ" and _raw_list(fields.get(f))), "") \
        or next((f for f, title in names.items() if _fname(str(title)) == "кэ"), "") or KE_FIELD_ID
    return {"key": key, "summary": fields.get("summary") or "", "field": fid, "fieldName": str(names.get(fid) or "КЭ"),
            "raw": _raw_list(fields.get(fid)),
            "stories": [x for x in linked_issues(fields.get("issuelinks")) if _STORY_RE.search(x["issuetype"])]}


def _ke_editmeta(cfg: dict, story: str, fid: str) -> dict:
    """Как поле КЭ объявлено у стори для правки: на экране ли, тип, операции. Ошибка — текстом, без исключения."""
    try:
        meta = (_jira_request(cfg, "GET", f"/rest/api/2/issue/{story}/editmeta").get("fields") or {}).get(fid)
    except HTTPException as e:
        return {"story": story, "error": str(e.detail)[:300]}
    if not isinstance(meta, dict):
        return {"story": story, "onScreen": False}
    schema = meta.get("schema") or {}
    allowed = meta.get("allowedValues")
    return {"story": story, "onScreen": True, "name": meta.get("name") or "", "required": bool(meta.get("required")),
            "schema": {k: schema.get(k) for k in ("type", "items", "custom") if schema.get(k)},
            "operations": list(meta.get("operations") or []),
            "allowedValues": len(allowed) if isinstance(allowed, list) else None}


def _ke_mode(check: dict, n_release: int) -> tuple[str, str]:
    """Как писать поле: set — всем списком, add — по одной, "" — нельзя (и почему)."""
    if check.get("error"):
        return "", f"Не удалось прочитать настройки поля у стори: {check['error']}"
    if not check.get("onScreen"):
        return "", "Поля КЭ нет на экране редактирования стори — Jira не даст его изменить"
    ops = check.get("operations") or []
    multi = (check.get("schema") or {}).get("type") == "array"
    if not multi and n_release > 1:
        return "", "У стори в поле КЭ помещается одно значение, а у релиза их несколько"
    if "set" in ops:
        return "set", ""
    if multi and "add" in ops:
        return "add", ""
    return "", f"Поле не принимает ни set, ни add (операции: {', '.join(ops) or 'нет'})"


def ke_plan(cfg: dict, key: str) -> dict:
    rel = _release_ke_raw(cfg, _issue_key(key, "Номер релиза"))
    fid, rel_raw = rel["field"], rel["raw"]

    def one(st: dict) -> dict:
        row = {"key": st["key"], "summary": st["summary"], "status": st["status"], "ke": [], "missing": [], "raw": []}
        try:
            data = _jira_request(cfg, "GET", f"/rest/api/2/issue/{st['key']}", params={"fields": fid})
        except HTTPException as e:
            return {**row, "error": str(e.detail)[:300]}
        raw = _raw_list((data.get("fields") or {}).get(fid))
        have = {_ke_ident(x) for x in raw}
        missing = [x for x in rel_raw if _ke_ident(x) not in have]
        return {**row, "ke": [_ke_label(x) for x in raw], "missing": [_ke_label(x) for x in missing], "raw": raw,
                "missingRaw": missing}

    with ThreadPoolExecutor(max_workers=WAVE) as pool:
        stories = list(pool.map(one, rel["stories"]))
    probe_on = next((x["key"] for x in stories if x.get("missingRaw")), stories[0]["key"] if stories else "")
    check = _ke_editmeta(cfg, probe_on, fid) if probe_on else {}
    mode, why = _ke_mode(check, len(rel_raw)) if probe_on else ("", "")
    return {"release": {"key": rel["key"], "summary": rel["summary"], "field": fid, "fieldName": rel["fieldName"],
                        "ke": [_ke_label(x) for x in rel_raw], "raw": rel_raw},
            "stories": stories, "check": check, "mode": mode, "blocked": why}


def _public_plan(plan: dict) -> dict:
    """Наружу — без сырых значений стори (они нужны только записи), но с сырыми КЭ релиза — по ним видно формат поля."""
    return {**plan, "stories": [{k: v for k, v in x.items() if k not in ("raw", "missingRaw")} for x in plan["stories"]]}


@router.get("/api/zephyr/release/{key}/ke-plan")
def release_ke_plan(key: str, db: Session = Depends(get_db)) -> dict:
    """КЭ релиза и стори: чего не хватает каждой стори + как поле КЭ объявлено у стори (проверка API). Только чтение."""
    return _public_plan(ke_plan(_load_cfg(db), key))


class KeApplyBody(BaseModel):
    stories: list[str] = Field(default_factory=list)   # каким стори добавить (пусто — всем, кому не хватает)
    # Стори → КЭ (подписи, как в плане), которые ей не добавлять: сняли крестиком на маркере.
    exclude: dict[str, list[str]] = Field(default_factory=dict)


@router.post("/api/zephyr/release/{key}/ke-apply")
def release_ke_apply(key: str, body: KeApplyBody, db: Session = Depends(get_db)) -> dict:
    """Добавить стори релиза недостающие КЭ релиза. Свои КЭ стори остаются. Ответ Jira — по каждой стори."""
    cfg = _load_cfg(db)
    plan = ke_plan(cfg, key)
    if not plan["mode"]:
        raise HTTPException(409, plan["blocked"] or "Запись поля КЭ невозможна")
    fid, mode = plan["release"]["field"], plan["mode"]
    wanted = {k.strip().upper() for k in body.stories if k.strip()}
    skip = {k.strip().upper(): set(v) for k, v in body.exclude.items()}
    todo = []
    for x in plan["stories"]:
        if not x.get("missingRaw") or (wanted and x["key"] not in wanted):
            continue
        off = skip.get(x["key"], set())
        keep = [(lbl, raw) for lbl, raw in zip(x["missing"], x["missingRaw"]) if lbl not in off]
        if keep:
            todo.append({**x, "missing": [k for k, _ in keep], "missingRaw": [r for _, r in keep]})

    def one(row: dict) -> dict:
        if mode == "add":
            payload = {"update": {fid: [{"add": x} for x in row["missingRaw"]]}}
        elif (plan["check"].get("schema") or {}).get("type") == "array":
            payload = {"fields": {fid: row["raw"] + row["missingRaw"]}}
        elif row["raw"]:
            return {"key": row["key"], "ok": False, "error": "У стори уже стоит другая КЭ, а поле держит одно значение — не затираю"}
        else:
            payload = {"fields": {fid: row["missingRaw"][0]}}
        try:
            _jira_request(cfg, "PUT", f"/rest/api/2/issue/{row['key']}", json_body=payload)
            return {"key": row["key"], "ok": True, "added": row["missing"]}
        except HTTPException as e:
            return {"key": row["key"], "ok": False, "error": str(e.detail)[:500]}

    with ThreadPoolExecutor(max_workers=WAVE) as pool:
        results = list(pool.map(one, todo))
    return {"results": results, "plan": _public_plan(ke_plan(cfg, key))}



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
    return {"key": key, "url": run_url(cfg["base_url"], key), "issueKey": tracked, "warnings": warnings}


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

MAX_XML = 50 * 1024 * 1024    # модель на тысячи кейсов с шагами — десятки МБ


def _cf_value(ftype: str, val: str) -> Any:
    """Значение пользовательского поля из XML по его типу: флажок — bool, число — число, несколько значений — список."""
    if ftype == "CHECKBOX":
        return val.lower() == "true"
    if ftype in ("NUMBER", "DECIMAL"):
        try:
            return int(val) if re.fullmatch(r"-?\d+", val) else float(val)
        except ValueError:
            return val
    if ftype in ("MULTI_CHOICE_SELECT_LIST", "MULTI_SELECT"):
        return [x.strip() for x in val.split(",") if x.strip()]
    return val


def _x(el: Any, tag: str) -> str:
    """Текст дочернего тега (CDATA — тот же текст), без пробелов по краям."""
    node = el.find(tag) if el is not None else None
    return (node.text or "").strip() if node is not None and node.text else ""


def parse_zephyr_xml(text: str) -> dict:
    """Zephyr XML (`<project><folders/><testCases/>`) → {folders: [пути], cases: [...]}. Без внешних сущностей и DTD."""
    import xml.etree.ElementTree as ET

    if len(text.encode("utf-8")) > MAX_XML:
        raise HTTPException(413, "Файл больше 50 МБ")
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
            custom[name] = _cf_value(ftype, val)
        steps = [{"description": _x(s, "description"), "testData": _x(s, "testData"), "expectedResult": _x(s, "expectedResult")}
                 for s in sorted(tc.findall("./testScript/steps/step"), key=lambda s: int(s.get("index") or 0))]
        script = tc.find("testScript")
        if not steps and script is not None and _x(script, "text"):
            steps = [{"description": _x(script, "text"), "testData": "", "expectedResult": ""}]
        folder = _x(tc, "folder")
        est = _x(tc, "estimatedTime")
        cases.append({
            "id": f"x{i}", "name": _x(tc, "name"), "folder": folder if folder.startswith("/") or not folder else "/" + folder,
            "objective": _x(tc, "objective"), "precondition": _x(tc, "precondition"),
            "priority": _x(tc, "priority"), "status": _x(tc, "status"),
            "labels": [(l.text or "").strip() for l in tc.findall("./labels/label") if (l.text or "").strip()],
            "issueLinks": [k for k in (_x(x, "key") for x in tc.findall("./issues/issue")) if k],
            "estimatedTime": int(est) if est.isdigit() else None,
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
    issueLinks: list[str] = Field(default_factory=list)    # ключи задач Jira (связи кейса)
    estimatedTime: Optional[int] = None                    # мс
    customFields: dict[str, Any] = Field(default_factory=dict)
    steps: list[StagedStep] = Field(default_factory=list)


class ApplyBody(BaseModel):
    project: str = Field(..., min_length=1)
    folders: list[str] = Field(default_factory=list)       # новые папки (пути); родители досоздаются сами
    cases: list[StagedCase] = Field(default_factory=list, max_length=500)
    # Большая модель уходит пачками: папки — первым запросом, дальше пачки кейсов без повторного создания папок.
    skipFolders: bool = False


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
    if with_custom and c.issueLinks:
        p["issueLinks"] = c.issueLinks
    if c.estimatedTime:
        p["estimatedTime"] = c.estimatedTime
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
    wanted = [] if body.skipFolders else sorted({a for p in [*body.folders, *(c.folder for c in body.cases)] if p for a in _ancestors(p)},
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
            if e.status_code == 400 and (c.customFields or c.issueLinks):
                # Пользовательские поля и связи из XML могут не совпасть с проектом (другой проект, нет задачи) —
                # кейс важнее: создаём без них и говорим, что не встало.
                try:
                    data = _jira_request(cfg, "POST", f"{ATM}/testcase", json_body=_case_payload(project, c, False))
                    row["key"] = (data or {}).get("key", "")
                    lost = [*c.customFields, *(["связи: " + ", ".join(c.issueLinks)] if c.issueLinks else [])]
                    row["warning"] = f"создан без пользовательских полей и связей ({', '.join(lost)}): {str(e.detail)[:200]}"
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
            "labels": c.labels, "owner": "", "updated": now, "issueLinks": c.issueLinks, "customFields": c.customFields,
            "estimatedTime": c.estimatedTime,
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
    customFields: Optional[dict[str, Any]] = None     # «Вид тестирования», «Крит. регресс»… — по имени поля Zephyr


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
    if body.customFields:
        p["customFields"] = body.customFields
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


class CasesBulk(BaseModel):
    project: str = Field(..., min_length=1)
    keys: list[str] = Field(..., min_length=1, max_length=500)


def _each(keys: list[str], f: Callable[[str], None]) -> tuple[list[str], list[dict]]:
    """f по каждому кейсу параллельно (не больше WAVE запросов разом); сбой одного не роняет остальные."""
    ok: list[str] = []
    errors: list[dict] = []
    def one(k: str) -> None:
        try:
            f(k); ok.append(k)
        except HTTPException as e:
            if e.status_code == 401:
                raise
            errors.append({"key": k, "error": str(e.detail)[:300]})
    with ThreadPoolExecutor(max_workers=WAVE) as pool:
        list(pool.map(one, dict.fromkeys(k.strip().upper() for k in keys)))
    return ok, errors


@router.post("/api/zephyr/cases/delete")
def delete_cases(body: CasesBulk, db: Session = Depends(get_db)) -> dict:
    """Удалить несколько кейсов из Zephyr; в ответе — что удалилось и ошибки по остальным."""
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    ok, errors = _each(body.keys, lambda k: _jira_request(cfg, "DELETE", f"{ATM}/testcase/{k}"))
    _index_put(cfg, project, [], remove=ok)
    return {"deleted": ok, "errors": errors}


class CasesEdit(CasesBulk):
    status: Optional[str] = None
    priority: Optional[str] = None
    owner: Optional[str] = None
    objective: Optional[str] = None
    precondition: Optional[str] = None
    estimatedTime: Optional[int] = None                    # мс
    labelsAdd: list[str] = Field(default_factory=list)     # добавить метки к уже стоящим
    labelsRemove: list[str] = Field(default_factory=list)  # убрать метки
    issueLinksAdd: list[str] = Field(default_factory=list) # добавить связи с задачами к уже стоящим
    customFields: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/zephyr/cases/edit")
def edit_cases(body: CasesEdit, db: Session = Depends(get_db)) -> dict:
    """Изменить несколько кейсов разом: любые поля — статус, приоритет, владелец, цель, предусловие, длительность,
    метки (добавить / убрать), связи (добавить), пользовательские поля. Не переданное — не трогаем."""
    cfg = _load_cfg(db)
    project = body.project.strip().upper()
    base: dict[str, Any] = {}
    for k in ("status", "priority", "owner", "objective", "precondition"):
        v = getattr(body, k)
        if v is not None and v.strip():
            base[k] = v.strip()
    if body.estimatedTime is not None and body.estimatedTime >= 0:
        base["estimatedTime"] = body.estimatedTime
    if body.customFields:
        base["customFields"] = body.customFields
    add = [x.strip() for x in body.labelsAdd if x.strip()]
    drop = {x.strip().lower() for x in body.labelsRemove if x.strip()}
    links = [x.strip().upper() for x in body.issueLinksAdd if x.strip()]
    if not base and not add and not drop and not links:
        raise HTTPException(422, "Нечего менять — выберите хотя бы одно поле")
    idx = get_index(cfg, project)["cases"]
    fresh: list[dict] = []

    def one(k: str) -> None:
        payload = dict(base)
        if add or drop:
            cur = [*((idx.get(k) or {}).get("labels") or []), *add]
            payload["labels"] = [l for l in dict.fromkeys(cur) if l.strip().lower() not in drop]
        if links:
            payload["issueLinks"] = list(dict.fromkeys([*((idx.get(k) or {}).get("issueLinks") or []), *links]))
        _jira_request(cfg, "PUT", f"{ATM}/testcase/{k}", json_body=payload)
        fresh.append(_slim(_jira_request(cfg, "GET", f"{ATM}/testcase/{k}")))
    ok, errors = _each(body.keys, one)
    _index_put(cfg, project, fresh)
    return {"updated": ok, "errors": errors}


# ── Выгрузка модели в XML и удаление папки ───────────────────────────────────
#
# Выгрузка: выбранная папка со всеми вложенными (или весь проект) → тот же Zephyr XML, что принимает «Новая модель
# из XML» (parse_zephyr_xml): папки, кейсы со всеми полями, шагами, связями и пользовательскими полями. Индекс шагов
# не хранит — кейсы читаются из Jira пачками (export/cases, xml=true — сразу кусок XML), фронт показывает прогресс
# и склеивает файл: начало и конец — export/frame, кейсы — куски пачек. Обратно на сервер ничего большого не уходит.
# Удаление папки: публичный API папки не удаляет (id папок не отдаёт) — удаляются все её кейсы (с вложенными),
# пустая папка в Zephyr остаётся (удаляется в интерфейсе Zephyr), из дерева SimpleTest уходит (folder/forget).

class FolderKeys(BaseModel):
    project: str = Field(..., min_length=1)
    folder: str = ""                                        # "" — весь проект


@router.post("/api/zephyr/folder/keys")
def folder_keys(body: FolderKeys, db: Session = Depends(get_db)) -> dict:
    """Все кейсы папки и вложенных (ключи по порядку) и все папки под ней, включая пустые."""
    cfg = _load_cfg(db)
    project, folder = body.project.strip().upper(), _clean_path(body.folder)
    idx = get_index(cfg, project)
    rows = sorted((c for c in idx["cases"].values() if in_folder(c.get("folder") or "", folder, True)),
                  key=lambda c: (c.get("folder") or "", _key_num(c["key"])))
    paths = {a for f in [*(c.get("folder") or "" for c in rows), *idx.get("folders", set())] for a in _ancestors(f)}
    folders = sorted(p for p in paths if in_folder(p, folder, True))
    return {"folder": folder, "keys": [c["key"] for c in rows], "folders": folders}


class ExportKeys(BaseModel):
    project: str = Field(..., min_length=1)
    keys: list[str] = Field(..., min_length=1, max_length=200)
    # xml=true — вместо кейсов готовый кусок XML этой пачки (<testCase>…); start — номер первого кейса пачки в файле.
    xml: bool = False
    start: int = Field(0, ge=0)


def full_case(c: dict) -> dict:
    """Кейс из Jira → всё, что уходит в XML выгрузки."""
    return {**norm_case(c), "objective": c.get("objective") or c.get("description") or "",
            "precondition": c.get("precondition") or "", "steps": norm_steps(c), "component": _name(c.get("component")),
            "customFields": c.get("customFields") if isinstance(c.get("customFields"), dict) else {}}


@router.post("/api/zephyr/export/cases")
def export_cases(body: ExportKeys, db: Session = Depends(get_db)) -> dict:
    """Полные кейсы (с шагами) пачкой — для выгрузки; по WAVE запросов разом, порядок — как в запросе."""
    cfg = _load_cfg(db)
    got: dict[str, dict] = {}
    ok, errors = _each(body.keys, lambda k: got.__setitem__(k, full_case(_jira_request(cfg, "GET", f"{ATM}/testcase/{k}"))))
    order = list(dict.fromkeys(k.strip().upper() for k in body.keys))
    rows = [got[k] for k in order if k in got]
    if body.xml:
        return {"xml": "".join(case_xml(c, body.start + i) + "\n" for i, c in enumerate(rows)), "count": len(rows), "errors": errors}
    return {"cases": rows, "errors": errors}


def _cdata(v: Any) -> str:
    s_ = "" if v is None else str(v)
    return "<![CDATA[" + s_.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def _cf_xml(name: str, v: Any) -> str:
    from xml.sax.saxutils import quoteattr
    if isinstance(v, bool):
        t, val = "CHECKBOX", "true" if v else "false"
    elif isinstance(v, (int, float)):
        t, val = "NUMBER", str(v)
    elif isinstance(v, list):
        t, val = "MULTI_CHOICE_SELECT_LIST", ", ".join(_name(x) for x in v)
    elif isinstance(v, dict):
        t, val = "SINGLE_CHOICE_SELECT_LIST", _name(v)
    else:
        t, val = ("MULTI_LINE_TEXT" if "\n" in str(v) else "SINGLE_LINE_TEXT"), str(v)
    return f"<customField name={quoteattr(name)} type={quoteattr(t)}><value>{_cdata(val)}</value></customField>"


def xml_frame(project: str, folders: list[str]) -> tuple[str, str]:
    """Начало Zephyr XML (проект, папки, открытый <testCases>) и конец — между ними встают кейсы (case_xml)."""
    from xml.sax.saxutils import escape, quoteattr
    head = ['<?xml version="1.0" encoding="UTF-8"?>', "<project>", f"<projectKey>{escape(project)}</projectKey>",
            f"<exportDate>{time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}</exportDate>", "<folders>"]
    head += [f'<folder fullPath={quoteattr(p.lstrip("/"))} index="{i}"/>' for i, p in enumerate(folders)]
    head += ["</folders>", "<testCases>"]
    return "\n".join(head) + "\n", "</testCases>\n</project>"


def case_xml(c: dict, i: int) -> str:
    """Один кейс → <testCase> (формат выгрузки Zephyr Scale; его же разбирает parse_zephyr_xml). i — номер в файле."""
    from xml.sax.saxutils import escape, quoteattr
    x = [f'<testCase id="{i + 1}" key={quoteattr(c.get("key", ""))}>']
    x.append(f"<name>{_cdata(c.get('name'))}</name>")
    for tag in ("objective", "precondition", "priority", "status", "owner", "component"):
        if c.get(tag):
            x.append(f"<{tag}>{_cdata(c[tag])}</{tag}>")
    x.append(f"<folder>{_cdata((c.get('folder') or '').lstrip('/'))}</folder>")
    if c.get("estimatedTime"):
        x.append(f"<estimatedTime>{int(c['estimatedTime'])}</estimatedTime>")
    if c.get("labels"):
        x.append("<labels>" + "".join(f"<label>{_cdata(l)}</label>" for l in c["labels"]) + "</labels>")
    if c.get("issueLinks"):
        x.append("<issues>" + "".join(f"<issue><key>{escape(k)}</key></issue>" for k in c["issueLinks"]) + "</issues>")
    cf = c.get("customFields") or {}
    if cf:
        x.append("<customFields>" + "".join(_cf_xml(n, v) for n, v in cf.items() if v not in (None, "", [])) + "</customFields>")
    steps = c.get("steps") or []
    x.append('<testScript type="steps"><steps>' + "".join(
        f'<step index="{j}"><description>{_cdata(st.get("description"))}</description>'
        f'<testData>{_cdata(st.get("testData"))}</testData><expectedResult>{_cdata(st.get("expectedResult"))}</expectedResult></step>'
        for j, st in enumerate(steps)) + "</steps></testScript>")
    x.append("</testCase>")
    return "".join(x)


def build_zephyr_xml(project: str, folders: list[str], cases_: list[dict]) -> str:
    """Кейсы и папки → Zephyr XML целиком (xml_frame + case_xml)."""
    head, tail = xml_frame(project, folders)
    return head + "".join(case_xml(c, i) + "\n" for i, c in enumerate(cases_)) + tail


class ExportFrame(BaseModel):
    project: str = Field(..., min_length=1)
    folders: list[str] = Field(default_factory=list)


@router.post("/api/zephyr/export/frame")
def export_frame(body: ExportFrame) -> dict:
    """Начало и конец файла выгрузки: кейсы между ними фронт склеивает из пачек export/cases (xml=true).
    Весь файл одним запросом не собираем: тело с тысячами кейсов — десятки МБ, прокси dev-режима Next режет его
    на 10 МБ (Internal Server Error на 3851 кейсе)."""
    head, tail = xml_frame(body.project.strip().upper(), body.folders)
    return {"head": head, "tail": tail}


class FolderForget(BaseModel):
    project: str = Field(..., min_length=1)
    folder: str = Field(..., min_length=2)


@router.post("/api/zephyr/folder/forget")
def forget_folder(body: FolderForget, db: Session = Depends(get_db)) -> dict:
    """Убрать папку и вложенные из дерева SimpleTest после удаления их кейсов. Кейсы, что не удалились, держат папку."""
    cfg = _load_cfg(db)
    project, folder = body.project.strip().upper(), _clean_path(body.folder)
    idx = get_index(cfg, project)
    left = sum(1 for c in idx["cases"].values() if in_folder(c.get("folder") or "", folder, True))
    with _locks.setdefault((cfg["base_url"], project), threading.Lock()):
        fs = idx.setdefault("folders", set())
        for f in [f for f in fs if in_folder(f, folder, True)]:
            fs.discard(f)
        _save_index(cfg["base_url"], project, idx)
    return {"folder": folder, "casesLeft": left}
