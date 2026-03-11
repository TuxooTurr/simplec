"""
Эндпоинты авторизации: login, logout, me, register.
"""

import os as _os
import re
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from backend.auth import (
    COOKIE_NAME,
    SESSION_HOURS,
    create_token,
    require_auth,
)
from db.user_store import get_user, verify_password, create_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

_SECURE = _os.getenv("COOKIE_SECURE", "1") != "0"

# ─── Простой in-memory rate limiter ─────────────────────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
_login_lock = Lock()
_LOGIN_LIMIT = 10       # попыток
_LOGIN_WINDOW = 60      # секунд


def _check_rate_limit(ip: str) -> None:
    now = time.time()
    with _login_lock:
        attempts = [t for t in _login_attempts[ip] if now - t < _LOGIN_WINDOW]
        if len(attempts) >= _LOGIN_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много попыток входа. Попробуйте через минуту.",
            )
        attempts.append(now)
        _login_attempts[ip] = attempts


def _validate_password(password: str) -> None:
    if len(password) < 12:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Пароль должен содержать минимум 12 символов",
        )
    if not re.search(r"[A-Za-zА-Яа-яЁё]", password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Пароль должен содержать хотя бы одну букву",
        )
    if not re.search(r"\d", password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Пароль должен содержать хотя бы одну цифру",
        )


def _set_auth_cookie(response: Response, username: str) -> None:
    token = create_token(username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_HOURS * 3600,
        path="/",
        secure=_SECURE,
    )


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(req: LoginRequest, response: Response, request: Request):
    _check_rate_limit(request.client.host if request.client else "unknown")
    user = get_user(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    _set_auth_cookie(response, req.username)
    return {"username": req.username}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, response: Response):
    if len(req.username.strip()) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Логин должен содержать минимум 3 символа",
        )
    _validate_password(req.password)
    try:
        create_user(req.username.strip(), req.password)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    # Автоматически логиним после регистрации
    _set_auth_cookie(response, req.username.strip())
    return {"username": req.username.strip()}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me")
def me(username: str = Depends(require_auth)):
    return {"username": username}
