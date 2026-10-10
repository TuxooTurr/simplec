"""
Jira-аналитика: представления, общие на всю команду.

Представление = выборка (JQL) + группировка (до 3 уровней, любое поле) + колонки
(любые поля, включая кастомные). Это не BI-конструктор, а таблица с группировкой:
разрезы меняются как угодно, но логика остаётся простой и предсказуемой.

Подключение и токен — те же, что у регистрации дефектов (jira_defects.py).

Эндпоинты:
  GET    /api/jira/fields          — все поля Jira (id, имя, тип) для выбора колонок
  GET    /api/jira/views           — сохранённые представления
  POST   /api/jira/views           — создать / обновить представление
  DELETE /api/jira/views/{id}      — удалить представление
  POST   /api/jira/views/query     — выполнить: задачи, сгруппированные по полям
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.jira_defects import _jira_request, _load_cfg
from db.jira_views_store import JiraViewsStore
from db.postgres import get_db

router = APIRouter()

EMPTY_VALUE = "(не задано)"

# Потолок выборки: представление — обзор, а не выгрузка всей Jira. Больше тысячи
# задач в таблице никто не читает, а каждая сотня — отдельный запрос к корп. Jira.
MAX_ISSUES = 1000
_PAGE = 100
MAX_COLUMNS = 30
MAX_GROUP_LEVELS = 3

_FIELDS_TTL = 600   # список полей Jira меняется редко
_QUERY_TTL = 180    # данные задач: свежесть в пределах 3 минут, Jira не дёргаем на каждое открытие

# «Ключ» — не поле Jira, а атрибут задачи; добавляем его в список, чтобы
# он выбирался как обычная колонка или группировка.
_KEY_FIELD = {"id": "key", "name": "Ключ", "custom": False, "type": "string"}

_ISO_DT_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})")
# Спринт в Jira DC приходит строкой «com.atlassian.greenhopper...Sprint@1a2b[id=1,name=Спринт 5,...]»
_SPRINT_NAME_RE = re.compile(r"name=([^,\]]+)")


# ── Приведение значений полей к тексту ───────────────────────────────────────

def display_value(value: Any) -> str:
    """Любое значение поля Jira → короткий текст для таблицы и группировки."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "да" if value else "нет"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        m = _ISO_DT_RE.match(value)
        if m:
            return f"{m.group(1)} {m.group(2)}"
        if "greenhopper" in value:
            s = _SPRINT_NAME_RE.search(value)
            if s:
                return s.group(1)
        return value
    if isinstance(value, list):
        parts = [display_value(v) for v in value]
        return ", ".join(p for p in parts if p)
    if isinstance(value, dict):
        for k in ("displayName", "name", "value", "key"):
            if value.get(k):
                text = str(value[k])
                # каскадный список: {"value": "A", "child": {"value": "B"}}
                child = value.get("child")
                if isinstance(child, dict) and child.get("value"):
                    text += f" / {child['value']}"
                return text
        return json.dumps(value, ensure_ascii=False)[:100]
    return str(value)


def issue_to_row(issue: dict, field_ids: list[str], base_url: str) -> dict:
    """Задача Jira → строка таблицы: ключ, ссылка и текстовые значения нужных полей."""
    fields = issue.get("fields") or {}
    key = issue.get("key", "")
    values = {
        fid: (key if fid == "key" else display_value(fields.get(fid)))
        for fid in field_ids
    }
    return {"key": key, "url": f"{base_url}/browse/{key}", "values": values}


def group_rows(rows: list[dict], group_by: list[str]) -> dict:
    """Рекурсивная группировка строк по полям.

    Без группировки → {"issues": [...]}. С группировкой → {"groups": [...]},
    у каждой группы — значение, количество и вложенный уровень. Порядок групп:
    больше задач — выше; «не задано» всегда в конце, чтобы не мешать чтению.
    """
    if not group_by:
        return {"issues": rows}
    field, rest = group_by[0], group_by[1:]
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        buckets.setdefault(r["values"].get(field) or EMPTY_VALUE, []).append(r)
    ordered = sorted(buckets.items(),
                     key=lambda kv: (kv[0] == EMPTY_VALUE, -len(kv[1]), kv[0]))
    groups = []
    for value, items in ordered:
        group = {"field": field, "value": value, "count": len(items)}
        group.update(group_rows(items, rest))
        groups.append(group)
    return {"groups": groups}


# ── Запросы к Jira с кэшем ───────────────────────────────────────────────────

_fields_cache: dict[str, tuple[float, list[dict]]] = {}
_query_cache: dict[tuple, tuple[float, dict]] = {}


def _fetch_fields(cfg: dict) -> list[dict]:
    hit = _fields_cache.get(cfg["base_url"])
    if hit and time.time() - hit[0] < _FIELDS_TTL:
        return hit[1]
    raw = _jira_request(cfg, "GET", "/rest/api/2/field")
    fields = [_KEY_FIELD] + sorted(
        (
            {
                "id": f.get("id", ""),
                "name": f.get("name", ""),
                "custom": bool(f.get("custom")),
                "type": (f.get("schema") or {}).get("type", ""),
            }
            for f in raw if f.get("id")
        ),
        key=lambda f: f["name"].lower(),
    )
    _fields_cache[cfg["base_url"]] = (time.time(), fields)
    return fields


def _search_all(cfg: dict, jql: str, field_ids: list[str]) -> tuple[list[dict], int]:
    """Все задачи по JQL постранично, но не больше MAX_ISSUES. Возвращает (задачи, total)."""
    jira_fields = [f for f in field_ids if f != "key"] or ["summary"]
    issues: list[dict] = []
    start, total = 0, 1
    while start < total and start < MAX_ISSUES:
        data = _jira_request(cfg, "GET", "/rest/api/2/search", params={
            "jql": jql, "fields": ",".join(jira_fields),
            "maxResults": _PAGE, "startAt": start,
        })
        total = int(data.get("total", 0))
        page = data.get("issues", []) or []
        issues.extend(page)
        if not page:
            break
        start += _PAGE
    return issues[:MAX_ISSUES], total


# ── Модели ───────────────────────────────────────────────────────────────────

def _check_layout(columns: list[str], group_by: list[str]) -> None:
    if len(columns) > MAX_COLUMNS:
        raise HTTPException(422, f"Колонок не больше {MAX_COLUMNS}")
    if len(group_by) > MAX_GROUP_LEVELS:
        raise HTTPException(422, f"Уровней группировки не больше {MAX_GROUP_LEVELS}")


class ViewBody(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    jql: str = Field(..., min_length=1, max_length=2000)
    columns: list[str] = Field(default_factory=lambda: ["key", "summary", "status", "priority", "assignee"])
    group_by: list[str] = Field(default_factory=list)


class QueryBody(BaseModel):
    jql: str = Field(..., min_length=1, max_length=2000)
    columns: list[str] = Field(default_factory=lambda: ["key", "summary", "status", "priority", "assignee"])
    group_by: list[str] = Field(default_factory=list)
    refresh: bool = False   # True — мимо кэша (кнопка «Обновить»)


# ── Эндпоинты ────────────────────────────────────────────────────────────────

@router.get("/api/jira/fields")
def list_fields(db: Session = Depends(get_db)) -> dict:
    return {"fields": _fetch_fields(_load_cfg(db))}


@router.get("/api/jira/views")
def list_views() -> dict:
    return {"views": JiraViewsStore.list_views()}


@router.post("/api/jira/views")
def save_view(body: ViewBody) -> dict:
    _check_layout(body.columns, body.group_by)
    return JiraViewsStore.save_view(body.model_dump())


@router.delete("/api/jira/views/{view_id}")
def delete_view(view_id: str) -> dict:
    if not JiraViewsStore.delete_view(view_id):
        raise HTTPException(404, "Представление не найдено")
    return {"status": "deleted"}


@router.post("/api/jira/views/query")
def run_query(body: QueryBody, db: Session = Depends(get_db)) -> dict:
    _check_layout(body.columns, body.group_by)
    cfg = _load_cfg(db)
    jql = body.jql.strip()

    # Поля группировки нужны в выборке, даже если их нет среди колонок.
    field_ids = list(dict.fromkeys(["key"] + body.columns + body.group_by))
    cache_key = (cfg["base_url"], jql, tuple(field_ids), tuple(body.group_by))

    hit = _query_cache.get(cache_key)
    if hit and not body.refresh and time.time() - hit[0] < _QUERY_TTL:
        return hit[1]

    issues, total = _search_all(cfg, jql, field_ids)
    rows = [issue_to_row(i, field_ids, cfg["base_url"]) for i in issues]

    names = {f["id"]: f["name"] for f in _fetch_fields(cfg)}
    result = {
        "total": total,
        "loaded": len(rows),
        "truncated": total > len(rows),
        "columns": [{"id": c, "name": names.get(c, c)} for c in body.columns],
        "group_by": [{"id": g, "name": names.get(g, g)} for g in body.group_by],
        "fetched_at": time.time(),
        **group_rows(rows, body.group_by),
    }
    _query_cache[cache_key] = (time.time(), result)
    return result
