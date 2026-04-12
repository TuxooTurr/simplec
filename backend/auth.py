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
    """Авторизация отключена — всегда возвращаем 'local'."""
    return "local"


async def ws_require_auth(websocket: WebSocket) -> Optional[str]:
    """Авторизация отключена — WebSocket всегда разрешён."""
    return "local"


SESSION_HOURS = _SESSION_HOURS
