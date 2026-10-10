"""
Шифрование паролей техучёток веб-коннекторов.

Пароль хранится в data/web_connectors.json только зашифрованным (Fernet: AES +
подпись). Ключ — вне репозитория: переменная SIMPLETEST_SECRET_KEY или файл
~/.simpletest/secret.key (создаётся при первом использовании, права 0600).
Без ключа сохранённые пароли расшифровать нельзя — и это нормально: при смене
машины пароль просто вводится заново.
"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

_KEY_FILE = Path(os.environ.get("SIMPLETEST_SECRET_KEY_FILE",
                                str(Path.home() / ".simpletest" / "secret.key"))).expanduser()


class SecretError(Exception):
    pass


def _fernet() -> Fernet:
    key = os.environ.get("SIMPLETEST_SECRET_KEY", "").strip()
    if not key:
        if not _KEY_FILE.exists():
            _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
            _KEY_FILE.write_bytes(Fernet.generate_key())
            os.chmod(_KEY_FILE, 0o600)
        key = _KEY_FILE.read_text(encoding="utf-8").strip()
    return Fernet(key.encode())


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as e:
        raise SecretError("Сохранённый пароль не расшифровывается (сменился ключ или машина) — "
                          "введите пароль в настройках коннектора заново.") from e
