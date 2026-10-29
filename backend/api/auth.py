"""
Авторизация — Bearer-токен сессии.

Вход — логином и паролем Jira: пароль проверяет Jira, тут же проверяются маркеры (PAT) Jira и Confluence —
свои рабочие остаются, иначе выпускаются новые (corp_auth.sign_in). Пароль не хранится.
Универсальная учётная запись (USERS) — вход без Jira: дома, без корпоративной сети; маркеры тогда получают
в настройках, как раньше.
Права у всех вошедших одинаковые (роль superuser); разделение прав — когда появится общий сервер.

REST:
  POST /api/auth/login  — войти (login + password) → {token, login, role, display_name, source, tokens?}
  POST /api/auth/logout — выйти
  GET  /api/auth/me     — текущий пользователь
"""

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.postgres import get_db

router = APIRouter()

USERS: dict[str, dict] = {
    "Sber911": {
        "password": "1234567",
        "role": "superuser",
        "display_name": "Sber911",
    },
}

_sessions: dict[str, dict] = {}


class LoginRequest(BaseModel):
    login: str
    password: str


def _extract_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return ""


def get_current_user(request: Request) -> Optional[dict]:
    token = _extract_token(request)
    return _sessions.get(token) if token else None


def require_user(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user


def require_superuser(request: Request) -> dict:
    user = require_user(request)
    if user["role"] != "superuser":
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return user


@router.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user_data = USERS.get(req.login.strip())
    if user_data:
        # Универсальная учётная запись — без Jira; неверный пароль к ней в Jira не уходит.
        if user_data["password"] != req.password:
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        session = {"login": req.login.strip(), "role": user_data["role"], "display_name": user_data["display_name"], "source": "local"}
        tokens = None
    else:
        from backend.api.corp_auth import sign_in
        r = sign_in(req.login, req.password, db)
        session = {"login": r["login"], "role": "superuser", "display_name": r["display_name"], "source": "jira"}
        tokens = r["tokens"]
    token = secrets.token_hex(32)
    _sessions[token] = session
    return {"token": token, **session, **({"tokens": tokens} if tokens is not None else {})}


@router.post("/api/auth/logout")
def logout(request: Request):
    token = _extract_token(request)
    _sessions.pop(token, None)
    return {"status": "ok"}


@router.get("/api/auth/me")
def me(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user
