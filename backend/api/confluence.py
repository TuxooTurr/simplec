"""
Confluence (Server/DC, confluence.sberbank.ru) — подключение и проверка API для раздела «График стендов».

Оригинал графика будет жить на странице Confluence: данные — в скрытом свойстве страницы (content property, JSON,
с номером версии — одновременные правки не затирают друг друга), а таблица на странице собирается из данных.
Что из этого умеет Confluence банка, ещё не проверено, поэтому сначала — проверка:
  • чтение (GET /api/confluence/probe) — вход по маркеру доступа, пространство, страница, её свойства. Ничего не меняет;
  • запись (POST /api/confluence/probe/write) — только по кнопке: создаёт в указанном пространстве тестовую страницу,
    пишет и перечитывает свойство, проверяет отказ на устаревшей версии, обновляет тело и прикладывает JSON-файл
    (запасной вариант хранения, если свойства закрыты). Существующие страницы не трогает; тестовую можно удалить руками.

Авторизация — маркер доступа Confluence (Personal Access Token, Bearer). Он свой, не тот, что у Jira.

Эндпоинты:
  GET  /api/confluence/settings       — настройки (маркер маскируется)
  PUT  /api/confluence/settings       — сохранить настройки
  GET  /api/confluence/test           — проверка входа (текущий пользователь)
  GET  /api/confluence/probe          — проверка чтения
  POST /api/confluence/probe/write    — проверка записи на новой тестовой странице
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.jira_defects import _MASK, _get, _set
from db.postgres import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

_K_URL = "confluence_base_url"
_K_TOKEN = "confluence_token"
_K_TOKEN_PATH = "confluence_token_path"
_K_SSL_VERIFY = "confluence_ssl_verify"   # "1" / "" (пусто = выключено, корп. BIG IP)
_K_SPACE = "confluence_space"             # пространство для графика (и проверки)

DEFAULT_URL = "https://confluence.sberbank.ru"
PROBE_PROPERTY = "simpletest-probe"


def _load_cfg(db: Session) -> dict:
    return {
        "base_url": (_get(db, _K_URL, DEFAULT_URL) or DEFAULT_URL).rstrip("/"),
        "token": _get(db, _K_TOKEN, ""),
        "token_path": _get(db, _K_TOKEN_PATH, ""),
        "ssl_verify": _get(db, _K_SSL_VERIFY, "") == "1",
        "space": _get(db, _K_SPACE, ""),
    }


def _resolve_token(cfg: dict) -> str:
    if cfg["token"]:
        return cfg["token"]
    if cfg["token_path"]:
        p = Path(cfg["token_path"]).expanduser()
        if not p.exists():
            raise HTTPException(400, f"Файл маркера не найден: {cfg['token_path']}")
        token = p.read_text(encoding="utf-8").strip()
        if token:
            return token
        raise HTTPException(400, f"Файл маркера пустой: {cfg['token_path']}")
    raise HTTPException(400, "Маркер доступа Confluence не задан: создайте его в профиле Confluence → «Маркеры доступа» "
                             "и вставьте в настройках раздела «График стендов»")


def _request(cfg: dict, method: str, path: str, params: Optional[dict] = None, json_body: Any = None,
             files: Optional[dict] = None, timeout: int = 30, auth: Optional[tuple] = None) -> Any:
    """Запрос к Confluence REST API. auth=(логин, пароль) — Basic (для получения маркера), иначе Bearer маркером.
    Ошибка — HTTPException с текстом Confluence (у Confluence он в «message»)."""
    import requests

    url = cfg["base_url"] + path
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; SimpleTest-QA/1.0)"}
    if auth is None:
        headers["Authorization"] = "Bearer " + _resolve_token(cfg)
    if files:
        headers["X-Atlassian-Token"] = "no-check"   # без него Confluence отклоняет загрузку вложений (XSRF)
    logger.info("Confluence → %s %s params=%s", method, url, params)
    try:
        resp = requests.request(method, url, params=params, json=json_body, files=files, headers=headers, auth=auth,
                                verify=cfg["ssl_verify"], timeout=timeout)
    except requests.exceptions.SSLError as e:
        raise HTTPException(502, f"SSL-ошибка при подключении к Confluence: {str(e)[:200]}. "
                                 "Отключите проверку сертификата в настройках (корп. BIG IP).")
    except requests.exceptions.RequestException as e:
        raise HTTPException(502, f"Confluence недоступен ({url}): {str(e)[:200]}")
    logger.info("Confluence ← %s %s -> %s", method, url, resp.status_code)
    if resp.status_code == 401:
        raise HTTPException(401, "Confluence: маркер доступа недействителен или истёк — обновите его в настройках")
    if resp.status_code >= 400:
        detail = resp.text[:500]
        try:
            j = resp.json()
            detail = str(j.get("message") or j.get("reason") or detail)[:500]
        except ValueError:
            pass
        raise HTTPException(resp.status_code, f"Confluence: {detail}")
    if resp.status_code == 204 or not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        # Страница входа SSO вместо JSON — частый признак того, что маркер не принят шлюзом.
        raise HTTPException(502, f"Confluence ответил не JSON (возможно, страница входа): {resp.text[:200]}")


MAX_ATTACHMENT = 15 * 1024 * 1024     # картинка больше — не скачиваем (в документ встанет пометка)


def download_attachment(cfg: dict, page_id: str, filename: str) -> tuple[bytes, str]:
    """Вложение страницы (картинка, PNG-превью диаграммы) → (байты, тип). Нет такого — HTTPException 404."""
    import requests
    found = _request(cfg, "GET", f"/rest/api/content/{page_id}/child/attachment",
                     params={"filename": filename, "limit": 1}).get("results") or []
    if not found:
        raise HTTPException(404, f"Во вложениях страницы нет «{filename}»")
    path = ((found[0].get("_links") or {}).get("download")) or ""
    if not path:
        raise HTTPException(404, f"Confluence не дал ссылку на «{filename}»")
    url = path if path.startswith("http") else cfg["base_url"] + path
    try:
        resp = requests.get(url, headers={"Authorization": "Bearer " + _resolve_token(cfg),
                                          "User-Agent": "Mozilla/5.0 (compatible; SimpleTest-QA/1.0)"},
                            verify=cfg["ssl_verify"], timeout=60, stream=True)
    except requests.exceptions.RequestException as e:
        raise HTTPException(502, f"Confluence недоступен: {str(e)[:200]}")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, f"Confluence не отдал «{filename}» ({resp.status_code})")
    data = b""
    for chunk in resp.iter_content(64 * 1024):
        data += chunk
        if len(data) > MAX_ATTACHMENT:
            raise HTTPException(413, f"«{filename}» больше {MAX_ATTACHMENT // 1024 // 1024} МБ")
    return data, resp.headers.get("Content-Type", "application/octet-stream").split(";")[0]


# ── Настройки ────────────────────────────────────────────────────────────────

class ConfluenceSettingsBody(BaseModel):
    base_url: str = DEFAULT_URL
    token: str = ""
    token_path: str = ""
    ssl_verify: bool = False
    space: str = ""


@router.get("/api/confluence/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    return {"base_url": cfg["base_url"], "token": _MASK if cfg["token"] else "", "token_path": cfg["token_path"],
            "ssl_verify": cfg["ssl_verify"], "space": cfg["space"]}


@router.put("/api/confluence/settings")
def put_settings(body: ConfluenceSettingsBody, db: Session = Depends(get_db)) -> dict:
    _set(db, _K_URL, (body.base_url.strip() or DEFAULT_URL).rstrip("/"), "Confluence base URL")
    if body.token != _MASK:
        _set(db, _K_TOKEN, body.token.strip(), "Confluence PAT (секрет)")
    _set(db, _K_TOKEN_PATH, body.token_path.strip(), "Путь к файлу с маркером Confluence")
    _set(db, _K_SSL_VERIFY, "1" if body.ssl_verify else "", "Проверка SSL Confluence")
    _set(db, _K_SPACE, body.space.strip(), "Пространство Confluence для графика стендов")
    db.commit()
    return get_settings(db)


class TokenFromLoginBody(BaseModel):
    login: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    base_url: str = ""


@router.post("/api/confluence/token-from-login")
def token_from_login(body: TokenFromLoginBody, db: Session = Depends(get_db)) -> dict:
    """Маркер доступа по логину/паролю Сигмы — как у Jira (Confluence DC 7.9+: /rest/pat/latest/tokens). Пароль не хранится."""
    if body.base_url.strip():
        _set(db, _K_URL, body.base_url.strip().rstrip("/"), "Confluence base URL")
        db.commit()
    cfg = _load_cfg(db)
    try:
        result = _request(cfg, "POST", "/rest/pat/latest/tokens",
                          json_body={"name": f"SimpleTest {time.strftime('%Y-%m-%d %H:%M')}", "expirationDuration": 180},
                          auth=(body.login.strip(), body.password))
    except HTTPException as e:
        if e.status_code in (401, 403):
            raise HTTPException(e.status_code, "Confluence не выдал маркер: неверный логин/пароль или выдача маркеров по паролю "
                                               "закрыта. Создайте маркер в профиле Confluence → «Маркеры доступа» и вставьте его строкой.")
        raise
    token = result.get("rawToken", "")
    if not token:
        raise HTTPException(502, "Confluence не вернул маркер (rawToken) — создайте его в профиле Confluence и вставьте строкой")
    _set(db, _K_TOKEN, token, "Confluence PAT (секрет)")
    db.commit()
    return {"status": "ok", "token": _MASK, "expires_days": 180}


def _whoami(cfg: dict) -> dict:
    me = _request(cfg, "GET", "/rest/api/user/current")
    if me.get("type") == "anonymous" or not (me.get("username") or me.get("userKey")):
        # Confluence пускает анонимно и тогда отдаёт «anonymous» с кодом 200 — маркер не сработал.
        raise HTTPException(401, "Confluence: вход как аноним — маркер не принят")
    return {"user": me.get("displayName", ""), "name": me.get("username", "")}


@router.get("/api/confluence/test")
def test_connection(db: Session = Depends(get_db)) -> dict:
    return {"status": "ok", **_whoami(_load_cfg(db))}


# ── Проверка API ─────────────────────────────────────────────────────────────

def _shape(v: Any, depth: int = 0) -> Any:
    """Каркас ответа без данных: ключи и типы."""
    if depth > 3:
        return "…"
    if isinstance(v, dict):
        return {k: _shape(x, depth + 1) for k, x in list(v.items())[:30]}
    if isinstance(v, list):
        return [_shape(v[0], depth + 1)] if v else []
    return type(v).__name__


class _Report:
    """Отчёт проверки: шаг за шагом; ошибка шага не останавливает следующие, если им хватает данных."""

    def __init__(self) -> None:
        self.rows: list[dict] = []

    def step(self, cid: str, label: str, method: str, path: Optional[str], fn: Callable[[], Any],
             note: Optional[Callable[[Any], str]] = None, expect: Optional[int] = None,
             skip: str = "нет данных из предыдущих шагов") -> Any:
        """expect — код отказа, который здесь и должен быть (проверка защиты): тогда отказ — успех шага.
        path=None — шаг пропущен, skip — почему."""
        if path is None:
            self.rows.append({"id": cid, "label": label, "skipped": True, "reason": skip})
            return None
        t0 = time.time()
        row: dict[str, Any] = {"id": cid, "label": label, "method": method, "path": path}
        data = None
        try:
            data = fn()
            row.update(ok=expect is None, status=200, shape=_shape(data))
            if expect is not None:
                row["error"] = f"ожидали отказ {expect}, а запрос прошёл"
            elif note:
                row["note"] = note(data)
        except HTTPException as e:
            if expect is not None and e.status_code == expect:
                row.update(ok=True, status=e.status_code, note="отказ, как и должно быть")
            else:
                row.update(ok=False, status=e.status_code, error=str(e.detail)[:300])
        row["ms"] = int((time.time() - t0) * 1000)
        self.rows.append(row)
        return data

    def out(self, cfg: dict, **extra: Any) -> dict:
        done = [r for r in self.rows if not r.get("skipped")]
        return {"base_url": cfg["base_url"], "checkedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                "ok": sum(1 for r in done if r.get("ok")), "total": len(done), "results": self.rows, **extra}


def page_ref(page: str) -> tuple[str, str]:
    """«123456», ссылка …?pageId=123456 или …/pages/123456/… → ("id", "123456"); иначе ("title", текст)."""
    page = page.strip()
    m = re.search(r"pageId=(\d+)", page) or re.search(r"/pages/(\d+)", page) or re.fullmatch(r"(\d+)", page)
    return ("id", m.group(1)) if m else ("title", page)


def _count(d: Any) -> int:
    return len(d.get("results") or []) if isinstance(d, dict) else 0


@router.get("/api/confluence/probe")
def probe(space: str = "", page: str = "", db: Session = Depends(get_db)) -> dict:
    """Проверка чтения: вход, пространство, страница (id, ссылка или название) и её свойства. Ничего не меняет."""
    cfg = _load_cfg(db)
    space = (space or cfg["space"]).strip()
    rep = _Report()
    rep.step("whoami", "Вход по маркеру: текущий пользователь", "GET", "/rest/api/user/current",
             lambda: _whoami(cfg), lambda d: f"{d['user']} ({d['name']})")
    rep.step("space", "Пространство", "GET", f"/rest/api/space/{space}" if space else None,
             lambda: _request(cfg, "GET", f"/rest/api/space/{space}"),
             lambda d: f"{d.get('name', '')} · тип {d.get('type', '?')}", skip="пространство не указано")
    found: Optional[dict] = None
    if page.strip():
        kind, ref = page_ref(page)
        if kind == "id":
            found = rep.step("page", "Страница по id", "GET", f"/rest/api/content/{ref}",
                             lambda: _request(cfg, "GET", f"/rest/api/content/{ref}", {"expand": "version,space"}),
                             lambda d: f"«{d.get('title', '')}» · версия {(d.get('version') or {}).get('number')}")
        else:
            res = rep.step("page", "Страница по названию", "GET", "/rest/api/content" if space else None,
                           lambda: _request(cfg, "GET", "/rest/api/content", {"spaceKey": space, "title": ref, "expand": "version"}),
                           lambda d: f"найдено: {_count(d)}", skip="для поиска по названию укажите пространство")
            found = ((res or {}).get("results") or [None])[0]
    pid = str((found or {}).get("id") or "")
    no_page = "страница не найдена" if page.strip() else "страница не указана"
    rep.step("properties", "Свойства страницы (здесь будут данные графика)", "GET",
             f"/rest/api/content/{pid}/property" if pid else None,
             lambda: _request(cfg, "GET", f"/rest/api/content/{pid}/property"), lambda d: f"свойств: {_count(d)}", skip=no_page)
    rep.step("attachments", "Вложения страницы (запасной вариант хранения)", "GET",
             f"/rest/api/content/{pid}/child/attachment" if pid else None,
             lambda: _request(cfg, "GET", f"/rest/api/content/{pid}/child/attachment"), lambda d: f"вложений: {_count(d)}",
             skip=no_page)
    return rep.out(cfg, space=space)


class ProbeWriteBody(BaseModel):
    space: str = Field(..., min_length=1)
    parent: str = ""    # страница-родитель (id или ссылка); пусто — в корень пространства


def _storage(text: str) -> dict:
    return {"storage": {"value": text, "representation": "storage"}}


def _ver(d: Any) -> int:
    return int(((d or {}).get("version") or {}).get("number") or 0) if isinstance(d, dict) else 0


@router.post("/api/confluence/probe/write")
def probe_write(body: ProbeWriteBody, db: Session = Depends(get_db)) -> dict:
    """
    Проверка записи на новой тестовой странице: создать → свойство (записать, перечитать, обновить, отказ на старой
    версии) → обновить тело таблицей → приложить JSON → комментарий-заявка (оставить, прочитать, ответить на него).
    Существующие страницы не трогает.
    """
    cfg = _load_cfg(db)
    space = body.space.strip()
    rep = _Report()
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    new: dict[str, Any] = {"type": "page", "title": f"SimpleTest — проверка API {stamp}", "space": {"key": space},
                           "body": _storage("<p>Тестовая страница SimpleTest: проверка API для графика стендов. Можно удалить.</p>")}
    if body.parent.strip():
        kind, ref = page_ref(body.parent)
        if kind == "id":
            new["ancestors"] = [{"id": ref}]
    page = rep.step("create", "Создать тестовую страницу", "POST", "/rest/api/content",
                    lambda: _request(cfg, "POST", "/rest/api/content", json_body=new),
                    lambda d: f"id {d.get('id')} · версия {_ver(d)}")
    pid = str((page or {}).get("id") or "")
    p = f"/rest/api/content/{pid}/property"
    value = {"format": "simpletest.stand-schedule", "version": 1, "bookings": [], "checkedAt": stamp}
    rep.step("prop-create", "Свойство: записать JSON", "POST", p if pid else None,
             lambda: _request(cfg, "POST", p, json_body={"key": PROBE_PROPERTY, "value": value}),
             lambda d: f"версия свойства {_ver(d)}")
    got = rep.step("prop-read", "Свойство: перечитать", "GET", f"{p}/{PROBE_PROPERTY}" if pid else None,
                   lambda: _request(cfg, "GET", f"{p}/{PROBE_PROPERTY}"),
                   lambda d: "значение совпало" if d.get("value") == value
                   else f"значение другое: {json.dumps(d.get('value'), ensure_ascii=False)[:150]}")
    ver = _ver(got)
    rep.step("prop-update", "Свойство: обновить со следующей версией", "PUT", f"{p}/{PROBE_PROPERTY}" if ver else None,
             lambda: _request(cfg, "PUT", f"{p}/{PROBE_PROPERTY}", json_body={
                 "key": PROBE_PROPERTY, "value": {**value, "bookings": [1]}, "version": {"number": ver + 1}}),
             lambda d: f"версия свойства {_ver(d)}")
    # Ту же версию второй раз: так выглядит запись второй команды, которая читала график до первой. Должен быть отказ.
    rep.step("prop-conflict", "Свойство: запись со старой версией — должен быть отказ (защита от затирания)", "PUT",
             f"{p}/{PROBE_PROPERTY}" if ver else None,
             lambda: _request(cfg, "PUT", f"{p}/{PROBE_PROPERTY}", json_body={
                 "key": PROBE_PROPERTY, "value": value, "version": {"number": ver + 1}}),
             expect=409)
    pver = _ver(page)
    table = ("<table><tbody><tr><th>Стенд</th><th>День</th><th>Команда</th><th>КЭ</th></tr>"
             f"<tr><td>Major-Check</td><td>{stamp[:10]}</td><td>Проверка</td><td>—</td></tr></tbody></table>")
    rep.step("body-update", "Обновить тело страницы таблицей", "PUT", f"/rest/api/content/{pid}" if pver else None,
             lambda: _request(cfg, "PUT", f"/rest/api/content/{pid}", json_body={
                 "id": pid, "type": "page", "title": new["title"], "version": {"number": pver + 1},
                 "body": _storage("<p>График стендов (проверка SimpleTest). Правки — через SimpleTest.</p>" + table)}),
             lambda d: f"версия страницы {_ver(d)}")
    rep.step("attach", "Приложить JSON-файл (запасной вариант хранения)", "POST",
             f"/rest/api/content/{pid}/child/attachment" if pid else None,
             lambda: _request(cfg, "POST", f"/rest/api/content/{pid}/child/attachment", files={
                 "file": ("stand-schedule.json", json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json")}),
             lambda d: f"вложений: {_count(d)}")
    # Заявки на установку коллеги оставляют комментариями к странице стенда, SimpleTest их читает и отвечает итогом.
    comment = rep.step("comment-create", "Комментарий-заявка: оставить на странице", "POST", "/rest/api/content" if pid else None,
                       lambda: _request(cfg, "POST", "/rest/api/content", json_body={
                           "type": "comment", "container": {"id": pid, "type": "page"},
                           "body": _storage("<p>Сервис: notify<br/>Дата: 23.10<br/>Команда: B2C</p>")}),
                       lambda d: f"id {d.get('id')}")
    cid = str((comment or {}).get("id") or "")
    rep.step("comment-read", "Комментарии страницы: прочитать с текстом и автором", "GET",
             f"/rest/api/content/{pid}/child/comment" if cid else None,
             lambda: _request(cfg, "GET", f"/rest/api/content/{pid}/child/comment",
                              {"expand": "body.storage,history", "limit": 50}),
             lambda d: "заявка прочитана" if any(str(x.get("id")) == cid and "notify" in str(((x.get("body") or {}).get("storage") or {}).get("value"))
                                                 for x in (d.get("results") or [])) else f"комментариев: {_count(d)}, заявки среди них нет")
    rep.step("comment-reply", "Ответ на комментарий (итог заявки)", "POST", "/rest/api/content" if cid else None,
             lambda: _request(cfg, "POST", "/rest/api/content", json_body={
                 "type": "comment", "container": {"id": pid, "type": "page"}, "ancestors": [{"id": cid}],
                 "body": _storage("<p>Принято: notify, 23.10, B2C (проверка SimpleTest)</p>")}),
             lambda d: f"ответ id {d.get('id')}")
    url = f"{cfg['base_url']}/pages/viewpage.action?pageId={pid}" if pid else ""
    return rep.out(cfg, space=space, page=url)
