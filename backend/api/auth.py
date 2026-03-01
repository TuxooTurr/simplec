"""
Эндпоинты авторизации: login, logout, me, register.
"""

import os as _os

from fastapi import APIRouter, Depends, HTTPException, Response, status
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
def login(req: LoginRequest, response: Response):
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
    if len(req.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Пароль должен содержать минимум 6 символов",
        )
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
