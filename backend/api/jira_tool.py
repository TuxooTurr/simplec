"""
Jira tool: данные настоящей Jira для списков планирования и назначения.

Подключение и токен — те же, что у регистрации дефектов (jira_defects.py):
Настройки → Jira. Списки, участники, свои поля и трудозатраты хранятся у SimpleTest,
здесь — только чтение задач из Jira и смена их статусов.

Задача уходит на фронтенд «плоской»: ключ, ссылка и поля в виде текста
(строка или список строк). Пустые поля не передаются — у корп. Jira сотни
пользовательских полей, почти все пустые. Даты остаются в формате Jira (ISO с
часовым поясом): фронтенд сам переводит их в «дд.мм.гггг чч:мм» по местному времени.

Эндпоинты:
  GET  /api/jira/tool/catalog                — поля, статусы, приоритеты, решения (общие на сервер)
  GET  /api/jira/tool/projects               — проекты: ключ и название
  GET  /api/jira/tool/project-fields         — поля, которые заполнены в задачах проекта
  POST /api/jira/tool/issues                 — задачи по ключам
  POST /api/jira/tool/search                 — задачи по JQL
  POST /api/jira/tool/related                — стори и дефекты эпиков (Epic Link) и связанные задачи
  GET  /api/jira/tool/statuses               — статусы проекта по типам задач
  POST /api/jira/tool/transitions            — какие переходы доступны задачам
  POST /api/jira/tool/transition             — выполнить переходы
  GET  /api/jira/tool/structures             — структуры (плагин Structure)
  GET  /api/jira/tool/structures/{id}        — дерево структуры: папки и задачи
"""

from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.jira_defects import _jira_request, _load_cfg
from db.postgres import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# Список — рабочий инструмент, а не выгрузка всей Jira: тысяча задач — потолок.
MAX_ISSUES = 1000
MAX_KEYS = 1000
_PAGE = 100
# Ключей в одном JQL «key in (…)» — длинный запрос корп. прокси может не пропустить.
_KEYS_PER_QUERY = 100
MAX_TRANSITION_KEYS = 200
MAX_STRUCTURE_ROWS = 5000
_WORKERS = 8

_CATALOG_TTL = 600        # поля и статусы сервера меняются редко
_PROJECT_TTL = 600

# Поля, которые нужны всегда: от них зависят тип, этап, дефекты и связи.
SYSTEM_FIELDS = [
    "summary", "issuetype", "status", "priority", "assignee", "reporter", "components", "fixVersions",
    "labels", "resolution", "created", "updated", "duedate", "description", "environment", "issuelinks",
]
_SKIP_FIELDS = {"comment", "worklog", "attachment", "watches", "votes", "timetracking", "progress",
                "aggregateprogress", "thumbnail", "lastViewed", "workratio", "aggregatetimespent",
                "aggregatetimeestimate", "aggregatetimeoriginalestimate"}
_LONG_TEXT = {"description", "environment"}
_EPIC_LINK_SCHEMA = "com.pyxis.greenhopper.jira:gh-epic-link"
_DEFAULT_EPIC_LINK = "customfield_10006"

_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
_PROJECT_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_SPRINT_NAME_RE = re.compile(r"name=([^,\]]+)")


# ── Значения полей → текст ───────────────────────────────────────────────────

def norm_value(v: Any) -> Any:
    """Значение поля Jira → строка, список строк или None (пусто)."""
    if v is None or v == "" or v == [] or v == {}:
        return None
    if isinstance(v, bool):
        return "да" if v else "нет"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        if "greenhopper" in v and "Sprint@" in v:
            m = _SPRINT_NAME_RE.search(v)
            if m:
                return m.group(1)
        return v
    if isinstance(v, list):
        out: list[str] = []
        for x in v:
            n = norm_value(x)
            if isinstance(n, list):
                out.extend(n)
            elif n:
                out.append(n)
        return out or None
    if isinstance(v, dict):
        for k in ("displayName", "name", "value", "key"):
            if v.get(k):
                text = str(v[k])
                child = v.get("child")
                if isinstance(child, dict) and child.get("value"):
                    text += f" / {child['value']}"
                return text
        return None
    return str(v)


def linked_keys(links: Any) -> Optional[list[str]]:
    """issuelinks → ключи связанных задач (в обе стороны)."""
    if not isinstance(links, list):
        return None
    keys = []
    for link in links:
        other = (link or {}).get("outwardIssue") or (link or {}).get("inwardIssue") or {}
        if other.get("key"):
            keys.append(other["key"])
    return list(dict.fromkeys(keys)) or None


def norm_issue(issue: dict, base_url: str) -> dict:
    key = issue.get("key", "")
    fields: dict[str, Any] = {}
    for fid, raw in (issue.get("fields") or {}).items():
        if fid in _SKIP_FIELDS:
            continue
        v = linked_keys(raw) if fid == "issuelinks" else norm_value(raw)
        if v is not None:
            fields[fid] = v
    return {"key": key, "url": f"{base_url}/browse/{key}", "fields": fields}


def field_kind(f: dict) -> str:
    """Тип поля для таблицы: от него зависят формат дат, перенос текста и сортировка."""
    schema = f.get("schema") or {}
    t = schema.get("type", "")
    custom = schema.get("custom", "")
    if f.get("id") in _LONG_TEXT or custom.endswith(":textarea"):
        return "longtext"
    if t in ("date", "datetime", "number", "user"):
        return t
    if t == "array":
        return "multi"
    if t in ("option", "priority", "status", "issuetype", "resolution", "project", "securitylevel", "option-with-child"):
        return "option"
    return "text"


# ── Запросы к Jira ───────────────────────────────────────────────────────────

def _search(cfg: dict, jql: str, limit: int = MAX_ISSUES, fields: str = "*navigable") -> tuple[list[dict], int]:
    """Задачи по JQL постранично. validateQuery=false: несуществующий ключ в «key in (…)»
    не роняет весь запрос, Jira просто его пропускает."""
    issues: list[dict] = []
    start, total = 0, 1
    while start < total and len(issues) < limit:
        data = _jira_request(cfg, "GET", "/rest/api/2/search", params={
            "jql": jql, "fields": fields, "maxResults": min(_PAGE, limit - len(issues)),
            "startAt": start, "validateQuery": "false",
        })
        total = int(data.get("total", 0) or 0)
        page = data.get("issues") or []
        issues.extend(page)
        if not page:
            break
        start += len(page)
    return issues[:limit], total


def _chunks(items: list[str], n: int) -> list[list[str]]:
    return [items[i:i + n] for i in range(0, len(items), n)]


def _by_keys(cfg: dict, keys: list[str]) -> list[dict]:
    """Задачи по ключам пачками. Если Jira всё же отвергла пачку (старый сервер валидирует
    ключи), добираем по одной — чтобы одна удалённая задача не прятала остальные."""
    out: list[dict] = []
    for chunk in _chunks(keys, _KEYS_PER_QUERY):
        try:
            found, _ = _search(cfg, f"key in ({', '.join(chunk)})", limit=len(chunk))
            out.extend(found)
        except HTTPException as e:
            if e.status_code != 400:
                raise
            for k in chunk:
                try:
                    out.append(_jira_request(cfg, "GET", f"/rest/api/2/issue/{k}", params={"fields": "*navigable"}))
                except HTTPException as e2:
                    if e2.status_code not in (400, 404):
                        raise
    return out


def _clean_keys(keys: list[str]) -> list[str]:
    out = []
    for k in keys:
        k = (k or "").strip().upper()
        if _KEY_RE.match(k):
            out.append(k)
    return list(dict.fromkeys(out))


def _project_key(project: str) -> str:
    p = (project or "").strip().upper()
    if not _PROJECT_RE.match(p):
        raise HTTPException(422, f"Некорректный ключ проекта: «{project}»")
    return p


_catalog_cache: dict[str, tuple[float, dict]] = {}
_projects_cache: dict[str, tuple[float, list]] = {}
_project_fields_cache: dict[tuple, tuple[float, list]] = {}
_statuses_cache: dict[tuple, tuple[float, dict]] = {}


def _fresh(cache: dict, key: Any, ttl: int, refresh: bool):
    hit = cache.get(key)
    if hit and not refresh and time.time() - hit[0] < ttl:
        return hit[1]
    return None


def _optional(cfg: dict, path: str) -> Any:
    """Справочник, без которого инструмент работает (решения, приоритеты): сбой — пустой список."""
    try:
        return _jira_request(cfg, "GET", path)
    except HTTPException as e:
        if e.status_code == 401:
            raise
        logger.warning("Jira tool: справочник %s недоступен: %s", path, e.detail)
        return []


# ── Модели ───────────────────────────────────────────────────────────────────

class KeysBody(BaseModel):
    keys: list[str] = Field(default_factory=list)


class SearchBody(BaseModel):
    jql: str = Field(..., min_length=1, max_length=4000)
    limit: int = Field(200, ge=1, le=MAX_ISSUES)


class RelatedBody(BaseModel):
    epics: list[str] = Field(default_factory=list)
    linked: list[str] = Field(default_factory=list)


class TransitionChange(BaseModel):
    key: str
    transition_id: str
    resolution: str = ""


class TransitionBody(BaseModel):
    changes: list[TransitionChange] = Field(default_factory=list)


# ── Эндпоинты ────────────────────────────────────────────────────────────────

@router.get("/api/jira/tool/catalog")
def catalog(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    hit = _fresh(_catalog_cache, cfg["base_url"], _CATALOG_TTL, refresh)
    if hit is not None:
        return hit
    raw_fields = _jira_request(cfg, "GET", "/rest/api/2/field")
    fields = sorted(
        ({"id": f["id"], "name": f.get("name") or f["id"], "kind": field_kind(f), "custom": bool(f.get("custom"))}
         for f in raw_fields if f.get("id") and f["id"] not in _SKIP_FIELDS),
        key=lambda f: f["name"].lower(),
    )
    epic_link = next((f["id"] for f in raw_fields if (f.get("schema") or {}).get("custom") == _EPIC_LINK_SCHEMA),
                     _DEFAULT_EPIC_LINK)
    # Порядок статусов: «к выполнению» → «в работе» → «готово», внутри — как отдаёт Jira.
    cat_rank = {"new": 0, "indeterminate": 1, "done": 2}
    statuses = [
        {"name": s.get("name", ""), "category": ((s.get("statusCategory") or {}).get("key") or "")}
        for s in _optional(cfg, "/rest/api/2/status") if s.get("name")
    ]
    statuses.sort(key=lambda s: cat_rank.get(s["category"], 1))
    result = {
        "base_url": cfg["base_url"],
        "fields": fields,
        "epic_link": epic_link,
        "statuses": statuses,
        "priorities": [p["name"] for p in _optional(cfg, "/rest/api/2/priority") if p.get("name")],
        "resolutions": [r["name"] for r in _optional(cfg, "/rest/api/2/resolution") if r.get("name")],
    }
    _catalog_cache[cfg["base_url"]] = (time.time(), result)
    return result


@router.get("/api/jira/tool/projects")
def projects(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    hit = _fresh(_projects_cache, cfg["base_url"], _PROJECT_TTL, refresh)
    if hit is None:
        raw = _jira_request(cfg, "GET", "/rest/api/2/project")
        hit = sorted(({"key": p["key"], "name": p.get("name", p["key"])} for p in raw if p.get("key")),
                     key=lambda p: p["key"])
        _projects_cache[cfg["base_url"]] = (time.time(), hit)
    return {"projects": hit}


@router.get("/api/jira/tool/project-fields")
def project_fields(project: str, refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    """Поля, которые реально заполнены в последних задачах проекта. createmeta корп. Jira
    отдаёт 403, а список всех полей сервера — сотни чужих полей; выборка по задачам честнее."""
    cfg = _load_cfg(db)
    pk = _project_key(project)
    hit = _fresh(_project_fields_cache, (cfg["base_url"], pk), _PROJECT_TTL, refresh)
    if hit is None:
        issues, _ = _search(cfg, f"project = {pk} ORDER BY updated DESC", limit=_PAGE)
        used = set(SYSTEM_FIELDS)
        for i in issues:
            for fid, v in (i.get("fields") or {}).items():
                if fid not in _SKIP_FIELDS and norm_value(v) is not None:
                    used.add(fid)
        hit = sorted(used)
        _project_fields_cache[(cfg["base_url"], pk)] = (time.time(), hit)
    return {"project": pk, "fields": hit}


@router.post("/api/jira/tool/issues")
def issues_by_keys(body: KeysBody, db: Session = Depends(get_db)) -> dict:
    keys = _clean_keys(body.keys)
    if len(keys) > MAX_KEYS:
        raise HTTPException(422, f"За раз — не больше {MAX_KEYS} задач")
    if not keys:
        return {"issues": [], "missing": []}
    cfg = _load_cfg(db)
    found = [norm_issue(i, cfg["base_url"]) for i in _by_keys(cfg, keys)]
    got = {i["key"] for i in found}
    return {"issues": found, "missing": [k for k in keys if k not in got]}


@router.post("/api/jira/tool/search")
def search(body: SearchBody, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    found, total = _search(cfg, body.jql.strip(), limit=body.limit)
    return {"issues": [norm_issue(i, cfg["base_url"]) for i in found], "total": total,
            "truncated": total > len(found)}


@router.post("/api/jira/tool/related")
def related(body: RelatedBody, db: Session = Depends(get_db)) -> dict:
    """Для этапа эпика нужны все его стори, для «Дефекты (st)» — дефекты эпика и связанные
    задачи. Берём их одним вызовом: стори и дефекты по Epic Link и задачи из связей."""
    cfg = _load_cfg(db)
    epics = _clean_keys(body.epics)
    linked = _clean_keys(body.linked)
    out: dict[str, dict] = {}
    if epics:
        epic_link = catalog(db=db).get("epic_link", _DEFAULT_EPIC_LINK)
        cf = epic_link.replace("customfield_", "")
        for chunk in _chunks(epics, _KEYS_PER_QUERY):
            found, _ = _search(cfg, f"cf[{cf}] in ({', '.join(chunk)})", limit=MAX_ISSUES - len(out))
            for i in found:
                out[i["key"]] = norm_issue(i, cfg["base_url"])
            if len(out) >= MAX_ISSUES:
                break
    rest = [k for k in linked if k not in out][:max(0, MAX_ISSUES - len(out))]
    for i in _by_keys(cfg, rest):
        out[i["key"]] = norm_issue(i, cfg["base_url"])
    return {"issues": list(out.values()), "truncated": len(out) >= MAX_ISSUES}


@router.get("/api/jira/tool/statuses")
def project_statuses(project: str, refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    """Статусы проекта по типам задач — для сопоставления со статусом (st)."""
    cfg = _load_cfg(db)
    pk = _project_key(project)
    hit = _fresh(_statuses_cache, (cfg["base_url"], pk), _PROJECT_TTL, refresh)
    if hit is None:
        raw = _jira_request(cfg, "GET", f"/rest/api/2/project/{pk}/statuses")
        hit = {
            t["name"]: [s["name"] for s in (t.get("statuses") or []) if s.get("name")]
            for t in raw if t.get("name")
        }
        _statuses_cache[(cfg["base_url"], pk)] = (time.time(), hit)
    return {"project": pk, "types": hit}


def _parallel(fn, items: list) -> list:
    if len(items) <= 1:
        return [fn(x) for x in items]
    with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
        return list(pool.map(fn, items))


@router.post("/api/jira/tool/transitions")
def transitions(body: KeysBody, db: Session = Depends(get_db)) -> dict:
    """Переходы workflow, доступные каждой задаче сейчас (с учётом прав пользователя токена)."""
    keys = _clean_keys(body.keys)
    if len(keys) > MAX_TRANSITION_KEYS:
        raise HTTPException(422, f"За раз — не больше {MAX_TRANSITION_KEYS} задач")
    cfg = _load_cfg(db)

    def one(key: str) -> tuple[str, dict]:
        try:
            data = _jira_request(cfg, "GET", f"/rest/api/2/issue/{key}/transitions",
                                 params={"expand": "transitions.fields"})
        except HTTPException as e:
            if e.status_code == 401:
                raise
            return key, {"error": str(e.detail)}
        items = []
        for t in data.get("transitions") or []:
            res = ((t.get("fields") or {}).get("resolution") or {})
            items.append({
                "id": str(t.get("id", "")),
                "name": t.get("name", ""),
                "to": (t.get("to") or {}).get("name", "") or t.get("name", ""),
                "resolution_required": bool(res.get("required")),
            })
        return key, {"transitions": items}

    return {"issues": dict(_parallel(one, keys))}


@router.post("/api/jira/tool/transition")
def apply_transitions(body: TransitionBody, db: Session = Depends(get_db)) -> dict:
    changes = [c for c in body.changes if _KEY_RE.match(c.key.strip().upper()) and c.transition_id.strip()]
    if len(changes) > MAX_TRANSITION_KEYS:
        raise HTTPException(422, f"За раз — не больше {MAX_TRANSITION_KEYS} задач")
    cfg = _load_cfg(db)

    def one(c: TransitionChange) -> dict:
        payload: dict[str, Any] = {"transition": {"id": c.transition_id.strip()}}
        if c.resolution.strip():
            payload["fields"] = {"resolution": {"name": c.resolution.strip()}}
        try:
            _jira_request(cfg, "POST", f"/rest/api/2/issue/{c.key.strip().upper()}/transitions", json_body=payload)
            return {"key": c.key, "ok": True}
        except HTTPException as e:
            if e.status_code == 401:
                raise
            return {"key": c.key, "ok": False, "error": str(e.detail)}

    results = _parallel(one, changes)
    return {"results": results, "done": sum(1 for r in results if r["ok"])}


# ── Structure (ALM Works) ────────────────────────────────────────────────────

@router.get("/api/jira/tool/structures")
def structures(db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    try:
        raw = _jira_request(cfg, "GET", "/rest/structure/2.0/structure")
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(404, "В Jira нет плагина Structure (или его REST API выключен)")
        raise
    items = raw.get("structures", raw) if isinstance(raw, dict) else raw
    out = []
    for s in items or []:
        if not isinstance(s, dict) or s.get("id") is None:
            continue
        out.append({"id": int(s["id"]), "name": s.get("name") or f"Структура {s['id']}",
                    "description": s.get("description") or "", "owner": norm_value(s.get("owner")) or ""})
    return {"structures": out}


def parse_formula(formula: str) -> list[tuple[int, int, str]]:
    """«rowId:depth:item,…» → [(rowId, depth, item)]. item — id задачи или «тип/id»."""
    rows = []
    for part in (formula or "").split(","):
        bits = part.strip().split(":")
        if len(bits) < 3:
            continue
        try:
            rows.append((int(bits[0]), int(bits[1]), bits[2]))
        except ValueError:
            continue
    return rows


def build_tree(rows: list[dict]) -> list[dict]:
    """Строки структуры по порядку (depth, key | folder) → дерево узлов."""
    root: list[dict] = []
    stack: list[tuple[int, dict]] = []
    for r in rows:
        node: dict[str, Any] = {"key": r["key"]} if r.get("key") else {"folder": r.get("folder") or "Без названия"}
        node["children"] = []
        while stack and stack[-1][0] >= r["depth"]:
            stack.pop()
        (stack[-1][1]["children"] if stack else root).append(node)
        stack.append((r["depth"], node))
    return root


def _row_values(cfg: dict, sid: int, row_ids: list[int]) -> dict[int, dict]:
    """Ключ и название для строк структуры (у папки название — её имя)."""
    out: dict[int, dict] = {}
    for chunk in [row_ids[i:i + 1000] for i in range(0, len(row_ids), 1000)]:
        data = _jira_request(cfg, "POST", "/rest/structure/2.0/value", json_body={"requests": [{
            "forestSpec": {"structureId": sid}, "rows": chunk,
            "attributes": [{"id": "key", "format": "text"}, {"id": "summary", "format": "text"}],
        }]})
        resp = (data.get("responses") or [{}])[0]
        rows = resp.get("rows") or chunk
        for col in resp.get("data") or []:
            attr = (col.get("attribute") or {}).get("id")
            for rid, val in zip(rows, col.get("values") or []):
                out.setdefault(int(rid), {})[attr] = val
    return out


@router.get("/api/jira/tool/structures/{sid}")
def structure_tree(sid: int, db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    forest = _jira_request(cfg, "GET", "/rest/structure/2.0/forest/latest",
                           params={"s": json.dumps({"structureId": sid})})
    rows = parse_formula(forest.get("formula", ""))
    if len(rows) > MAX_STRUCTURE_ROWS:
        raise HTTPException(422, f"В структуре больше {MAX_STRUCTURE_ROWS} строк — импорт такого объёма не поддерживается")
    item_types = forest.get("itemTypes") or {}

    values: dict[int, dict] = {}
    try:
        values = _row_values(cfg, sid, [r[0] for r in rows])
    except HTTPException as e:
        if e.status_code == 401:
            raise
        logger.warning("Jira tool: значения строк структуры %s недоступны: %s", sid, e.detail)

    # Без значений строк ключи задач восстанавливаем по их id одним JQL на пачку.
    issue_ids = [item for _, _, item in rows if item.isdigit()]
    keys_by_id: dict[str, str] = {}
    if issue_ids and not values:
        for chunk in _chunks(issue_ids, _KEYS_PER_QUERY):
            found, _ = _search(cfg, f"id in ({', '.join(chunk)})", limit=len(chunk), fields="summary")
            keys_by_id.update({str(i.get("id")): i.get("key", "") for i in found})

    tree_rows = []
    for rid, depth, item in rows:
        v = values.get(rid, {})
        if item.isdigit():
            key = v.get("key") or keys_by_id.get(item)
            if key:
                tree_rows.append({"depth": depth, "key": key})
            continue
        kind = item_types.get(item.split("/")[0], "") if "/" in item else ""
        name = v.get("summary") or (f"Папка {item.split('/')[-1]}" if "folder" in kind else item)
        tree_rows.append({"depth": depth, "folder": name})
    return {"id": sid, "root": build_tree(tree_rows)}
