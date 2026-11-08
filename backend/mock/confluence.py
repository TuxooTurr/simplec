"""Мок Confluence REST API: страницы, дети, свойства, комментарии, пространства. Правки живут в памяти."""
from __future__ import annotations

import re
import threading
from typing import Any, Optional
from urllib.parse import unquote

from backend.mock.common import ME, PEOPLE, Reply, jira_dt, not_found, now, ok, rng

_lock = threading.Lock()
_pages: dict[str, dict] = {}            # созданные и изменённые страницы
_props: dict[tuple[str, str], dict] = {}
_next = [900000]

_TITLES = ["СТ: Карточка инцидента", "СТ: Уведомления о смене статуса", "СТ: Фильтры карты", "ФТ: Личный кабинет оператора",
           "Архитектура сервиса заявок", "Регламент тестирования релиза", "График стендов ИФТ"]


def _body(title: str, r) -> str:
    rows = "".join(f"<tr><td>{i}</td><td>Требование {i}: система должна {r.choice(['сохранять', 'показывать', 'проверять', 'отправлять'])} "
                   f"{r.choice(['статус', 'адрес', 'время реакции', 'исполнителя'])}</td><td>{r.choice(['Must', 'Should', 'Could'])}</td></tr>"
                   for i in range(1, r.randint(5, 9)))
    return (f"<h1>{title}</h1><p>Документ подготовлен для проверки мок-режима Shark.</p>"
            f"<h2>Назначение</h2><p>Описание бизнес-процесса и требований к функциональности.</p>"
            f"<h2>Требования</h2><table><tbody><tr><th>№</th><th>Требование</th><th>Приоритет</th></tr>{rows}</tbody></table>"
            f"<h2>Ограничения</h2><ul><li>Время ответа до 2 с</li><li>Доступ по ролевой модели</li></ul>")


def page(pid: str, title: str = "") -> dict:
    with _lock:
        if pid in _pages:
            return _pages[pid]
    r = rng("conf", pid)
    title = title or r.choice(_TITLES)
    a = r.choice(PEOPLE)
    return {"id": pid, "type": "page", "status": "current", "title": title,
            "space": {"key": "SBER911", "name": "СберБанк 911"},
            "version": {"number": r.randint(1, 30), "when": jira_dt(now()), "by": {"displayName": a["displayName"], "username": a["name"]}},
            "history": {"createdBy": {"displayName": a["displayName"]}, "createdDate": jira_dt(now())},
            "ancestors": [{"id": "100", "title": "SBER911"}],
            "body": {"storage": {"value": _body(title, r), "representation": "storage"},
                     "view": {"value": _body(title, r), "representation": "view"}},
            "_links": {"webui": f"/pages/viewpage.action?pageId={pid}", "base": "https://confluence.mock"}}


def handle(method: str, path: str, params: dict, body: Any) -> Optional[Reply]:
    p = unquote(path)
    if p == "/rest/pat/latest/tokens" and method == "POST":
        return ok({"id": 1, "name": "Shark mock", "rawToken": "mock-token"})
    if p == "/rest/api/user/current":
        return ok({"username": ME["name"], "displayName": ME["displayName"], "type": "known"})
    m = re.match(r"/rest/api/space/([^/]+)$", p)
    if m:
        return ok({"key": m.group(1), "name": "СберБанк 911", "type": "global"})
    if p == "/rest/api/content":
        if method == "POST":
            with _lock:
                _next[0] += 1
                pid = str(_next[0])
            new = {**page(pid, (body or {}).get("title", "Новая страница")),
                   "body": {"storage": ((body or {}).get("body") or {}).get("storage") or {"value": ""}}}
            new["version"]["number"] = 1
            with _lock:
                _pages[pid] = new
            return ok(new)
        title = str(params.get("title", ""))
        if title:
            pid = str(900 + rng("title", title).randint(1, 99999))
            return ok({"results": [page(pid, title)], "size": 1})
        return ok({"results": [page(str(1000 + i)) for i in range(5)], "size": 5})
    m = re.match(r"/rest/api/content/(\d+)(?:/(.*))?$", p)
    if not m:
        return None
    pid, rest = m.group(1), (m.group(2) or "").strip("/")
    if not rest:
        if method == "PUT":
            cur = page(pid)
            upd = {**cur, "title": (body or {}).get("title", cur["title"]),
                   "version": {**cur["version"], "number": int(((body or {}).get("version") or {}).get("number") or cur["version"]["number"] + 1)}}
            if (body or {}).get("body"):
                upd["body"] = body["body"]
            with _lock:
                _pages[pid] = upd
            return ok(upd)
        return ok(page(pid))
    if rest == "child/page":
        r = rng("kids", pid)
        return ok({"results": [page(f"{pid}{i}") for i in range(r.randint(0, 3))] if len(pid) < 9 else [], "size": 0})
    if rest == "child/attachment":
        return ok({"results": [], "size": 0}) if method == "GET" else ok({"results": [{"id": "att1", "title": "file"}]})
    if rest == "child/comment":
        return ok({"results": [], "size": 0})
    if rest == "property":
        if method == "POST":
            k = str((body or {}).get("key", ""))
            with _lock:
                _props[(pid, k)] = {**(body or {}), "version": {"number": 1}}
            return ok(_props[(pid, k)])
        return ok({"results": [v for (q, _), v in _props.items() if q == pid]})
    m2 = re.match(r"property/(.+)$", rest)
    if m2:
        k = m2.group(1)
        with _lock:
            if method == "PUT":
                _props[(pid, k)] = {**(body or {}), "key": k}
                return ok(_props[(pid, k)])
            v = _props.get((pid, k))
        return ok(v) if v else not_found(f"свойство {k}")
    return None
