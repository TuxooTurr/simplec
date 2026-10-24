"""
Единая учётная запись: логин и пароль Сигмы один на Jira и Confluence — вводим один раз, маркеры доступа (PAT)
получаем для обеих систем сразу. Пароль нигде не хранится: он нужен только на время запроса маркеров.

Результат — по каждой системе отдельно: одна может выдать маркер, а другая отказать (закрыта выдача по паролю,
недоступна сеть) — тогда видно, где именно и почему.

  GET  /api/corp-auth/status — у каких систем есть маркер и адреса
  POST /api/corp-auth/login  — логин + пароль → маркеры Jira и Confluence
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api import confluence, jira_defects
from db.postgres import get_db

router = APIRouter()
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
