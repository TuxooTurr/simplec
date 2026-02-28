"""
JWT-авторизация через httpOnly cookie.

Cookie: simpletest_token = <JWT>
JWT payload: {"sub": "<username>", "exp": <timestamp>}
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, HTTPException, WebSocket, status
from jose import JWTError, jwt

COOKIE_NAME = "simpletest_token"

_SECRET    = os.getenv("APP_SECRET", "changeme-please-set-APP_SECRET-in-env")
_ALGORITHM = "HS256"
_SESSION_HOURS = int(os.getenv("SESSION_HOURS", "24"))


def create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=_SESSION_HOURS)
    return jwt.encode({"sub": username, "exp": expire}, _SECRET, algorithm=_ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def require_auth(
    simpletest_token: Optional[str] = Cookie(default=None),
) -> str:
    """FastAPI Depends-зависимость для HTTP-маршрутов."""
    if not simpletest_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется авторизация",
        )
    username = decode_token(simpletest_token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Токен недействителен или истёк",
        )
    return username


async def ws_require_auth(websocket: WebSocket) -> Optional[str]:
    """Проверяет cookie для WebSocket-соединения. Закрывает с кодом 4001 если нет."""
    token = websocket.cookies.get(COOKIE_NAME)
    if not token:
        await websocket.close(code=4001, reason="Требуется авторизация")
        return None
    username = decode_token(token)
    if not username:
        await websocket.close(code=4001, reason="Токен недействителен")
        return None
    return username


SESSION_HOURS = _SESSION_HOURS
