"""
Эндпоинты авторизации: login, logout, me.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from backend.auth import (
    COOKIE_NAME,
    SESSION_HOURS,
    create_token,
    require_auth,
)
from db.user_store import get_user, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
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
    token = create_token(req.username)
    import os as _os
    secure = _os.getenv("COOKIE_SECURE", "1") != "0"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_HOURS * 3600,
        path="/",
        secure=secure,  # True на проде (HTTPS), False локально (COOKIE_SECURE=0)
    )
    return {"username": req.username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me")
def me(username: str = Depends(require_auth)):
    return {"username": username}
