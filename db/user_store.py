"""
Хранилище пользователей: data/users.json с bcrypt-хэшами паролей.

При первом запуске, если users.json пуст, создаётся пользователь
из переменных ADMIN_USER / ADMIN_PASS (по умолчанию: admin / simpletest).

Используем bcrypt напрямую (без passlib) для совместимости с bcrypt 4.0+/5.0+.
Пароль усекается до 72 байт перед хэшированием (ограничение алгоритма bcrypt).
"""

import json
import os
from pathlib import Path

import bcrypt as _bcrypt_lib

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_USERS_FILE = _DATA_DIR / "users.json"

_TRUNCATE = 72  # bcrypt hard limit


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


def _encode(plain: str) -> bytes:
    """UTF-8 encode + truncate to bcrypt limit."""
    return plain.encode("utf-8")[:_TRUNCATE]


# ─── Public API ──────────────────────────────────────────────────────────────

def get_user(username: str) -> dict | None:
    return next((u for u in _load() if u["username"] == username), None)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt_lib.checkpw(_encode(plain), hashed.encode("utf-8"))
    except Exception:
        return False


def hash_password(plain: str) -> str:
    return _bcrypt_lib.hashpw(_encode(plain), _bcrypt_lib.gensalt()).decode("utf-8")


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
