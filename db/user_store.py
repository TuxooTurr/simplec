"""
Хранилище пользователей: data/users.json с bcrypt-хэшами паролей.

При первом запуске, если users.json пуст, создаётся пользователь
из переменных ADMIN_USER / ADMIN_PASS (по умолчанию: admin / simpletest).
"""

import json
import os
from pathlib import Path

from passlib.context import CryptContext

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_USERS_FILE = _DATA_DIR / "users.json"

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ─── Internal helpers ────────────────────────────────────────────────────────

def _load() -> list[dict]:
    if not _USERS_FILE.exists():
        return []
    with open(_USERS_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save(users: list[dict]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2, ensure_ascii=False)


# ─── Public API ──────────────────────────────────────────────────────────────

def get_user(username: str) -> dict | None:
    return next((u for u in _load() if u["username"] == username), None)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_ctx.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


def create_user(username: str, password: str) -> dict:
    users = _load()
    if any(u["username"] == username for u in users):
        raise ValueError(f"Пользователь '{username}' уже существует")
    user = {"username": username, "password_hash": hash_password(password)}
    users.append(user)
    _save(users)
    return user


def list_users() -> list[str]:
    return [u["username"] for u in _load()]


def ensure_default_user() -> None:
    """Создаёт первого пользователя из .env если users.json пуст."""
    if _load():
        return
    admin_user = os.getenv("ADMIN_USER", "admin")
    admin_pass = os.getenv("ADMIN_PASS", "simpletest")
    create_user(admin_user, admin_pass)
    print(f"[auth] Создан пользователь '{admin_user}' (из ADMIN_USER/ADMIN_PASS)")
