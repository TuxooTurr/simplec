"""
Единая учётная запись: логин и пароль Сигмы один на Jira и Confluence — вводим один раз, маркеры доступа (PAT)
получаем для обеих систем сразу. Пароль нигде не хранится: он нужен только на время запроса маркеров.

Результат — по каждой системе отдельно: одна может выдать маркер, а другая отказать (закрыта выдача по паролю,
недоступна сеть) — тогда видно, где именно и почему.

  GET  /api/corp-auth/status — у каких систем есть маркер и адреса
  POST /api/corp-auth/login  — логин + пароль → маркеры Jira и Confluence

Вход в SimpleTest по логину Jira — sign_in (зовёт /api/auth/login): пароль проверяет сама Jira, затем маркеры —
свои рабочие остаются (повторный вход), чужие, истёкшие или отсутствующие выпускаются заново (первый вход).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api import confluence, jira_defects
from db.postgres import get_db

router = APIRouter()
logger = logging.getLogger(__name__)
NAMES = {"jira": "Jira", "confluence": "Confluence"}


class CorpLogin(BaseModel):
    login: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    jira: bool = True
    confluence: bool = True


def _status(db: Session) -> dict:
    j, c = jira_defects._load_cfg(db), confluence._load_cfg(db)
    return {
        "jira": {"base_url": j["base_url"], "hasToken": bool(j["token"] or j["token_path"])},
        "confluence": {"base_url": c["base_url"], "hasToken": bool(c["token"] or c["token_path"])},
    }


@router.get("/api/corp-auth/status")
def status(db: Session = Depends(get_db)) -> dict:
    return _status(db)


@router.post("/api/corp-auth/login")
def login(body: CorpLogin, db: Session = Depends(get_db)) -> dict:
    results: dict[str, dict] = {}
    targets = [("jira", body.jira, jira_defects.token_from_login, jira_defects.TokenFromLoginBody),
               ("confluence", body.confluence, confluence.token_from_login, confluence.TokenFromLoginBody)]
    for name, on, fn, Body in targets:
        if not on:
            continue
        try:
            fn(Body(login=body.login, password=body.password, base_url=""), db)
            results[name] = {"ok": True, "text": "маркер получен (действует 180 дней)"}
        except HTTPException as e:
            db.rollback()
            text = str(e.detail)
            if e.status_code in (401, 403):
                # Общий текст про «маркер недействителен» тут сбивает: при входе по паролю 401 — это логин/пароль.
                text = (f"неверный логин или пароль, либо выдача маркеров по паролю закрыта в {NAMES[name]} — тогда создайте "
                        f"маркер в профиле {NAMES[name]} («Маркеры доступа») и вставьте его строкой в настройках")
            results[name] = {"ok": False, "text": text}
        except Exception as e:                                    # сеть, SSL и прочее — текстом, без падения
            db.rollback()
            results[name] = {"ok": False, "text": f"{type(e).__name__}: {str(e)[:300]}"}
    if not results:
        raise HTTPException(422, "Не выбрано ни одной системы")
    return {"results": results, **_status(db)}


# ── Вход в SimpleTest по логину Jira ─────────────────────────────────────────

def _same_user(name: str, login: str) -> bool:
    return bool(name) and name.strip().lower() == login.strip().lower()


def _ensure_token(system: str, login: str, password: str, db: Session) -> dict:
    """
    Маркер системы для этого пользователя: есть и принадлежит ему — оставляем («reused»); нет, истёк или чужой
    (на этом SimpleTest раньше входил другой) — выпускаем новый по паролю («new»). Сбой — «error» с причиной:
    вход в SimpleTest он не отменяет, маркер можно получить позже в настройках.
    """
    mod = jira_defects if system == "jira" else confluence
    cfg = mod._load_cfg(db)
    if not cfg["base_url"]:
        return {"state": "error", "text": f"адрес {NAMES[system]} не задан в настройках"}
    if cfg["token"] or cfg["token_path"]:
        try:
            name = (jira_defects._jira_request(cfg, "GET", "/rest/api/2/myself", timeout=15).get("name", "")
                    if system == "jira" else confluence._whoami(cfg)["name"])
            if _same_user(name, login):
                return {"state": "reused"}
        except HTTPException:
            pass                                      # истёк, отозван, файла нет — выпускаем новый
    try:
        mod.token_from_login(mod.TokenFromLoginBody(login=login, password=password, base_url=""), db)
        return {"state": "new"}
    except HTTPException as e:
        db.rollback()
        return {"state": "error", "text": str(e.detail)}
    except Exception as e:                            # noqa: BLE001 — сеть, SSL: вход это не ломает
        db.rollback()
        return {"state": "error", "text": f"{type(e).__name__}: {str(e)[:200]}"}


def sign_in(login: str, password: str, db: Session) -> dict:
    """Пароль проверяет Jira (GET /myself по Basic). Прошёл — маркеры Jira и Confluence; ответ: кто вошёл и что с маркерами."""
    cfg = jira_defects._load_cfg(db)
    if not cfg["base_url"]:
        raise HTTPException(503, "Адрес Jira не задан — войдите универсальной учётной записью и укажите его в настройках Jira")
    try:
        me = jira_defects._jira_request(cfg, "GET", "/rest/api/2/myself", auth=(login.strip(), password), timeout=15)
    except HTTPException as e:
        if e.status_code == 401:
            raise HTTPException(401, "Неверный логин или пароль Jira")
        if e.status_code == 403:
            # Jira после нескольких неверных паролей требует капчу — по API тогда не пускает даже с верным.
            raise HTTPException(403, "Jira не пускает по паролю: после нескольких неверных попыток она просит капчу. "
                                     "Войдите в Jira в браузере, затем повторите вход здесь")
        logger.warning("Вход по Jira: Jira не ответила: %s", e.detail)
        raise HTTPException(503, f"Jira не ответила ({e.detail}). Без Jira войдите универсальной учётной записью")
    name = str(me.get("name") or login).strip()
    tokens = {sys_: _ensure_token(sys_, name, password, db) for sys_ in ("jira", "confluence")}
    return {"login": name, "display_name": str(me.get("displayName") or name), "tokens": tokens}
