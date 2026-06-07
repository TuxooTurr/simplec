"""
Авторизация — два пользователя, cookie/Bearer-токен.

REST:
  POST /api/auth/login  — войти (login + password)
  POST /api/auth/logout — выйти
  GET  /api/auth/me     — текущий пользователь
"""

import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

USERS: dict[str, dict] = {
    "Sber911": {
        "password": "1234567",
        "role": "superuser",
        "display_name": "Sber911",
    },
    "SberMonitoring": {
        "password": "1234567",
        "role": "monitoring",
        "display_name": "SberMonitoring",
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
def login(req: LoginRequest):
    user_data = USERS.get(req.login)
    if not user_data or user_data["password"] != req.password:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    token = secrets.token_hex(32)
    session = {
        "login": req.login,
        "role": user_data["role"],
        "display_name": user_data["display_name"],
    }
    _sessions[token] = session
    return {"token": token, **session}


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
