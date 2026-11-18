"""Local PVS service account with encrypted password."""
from __future__ import annotations

import json
import os
from tempfile import NamedTemporaryFile

from db.paths import DATA_DIR
from webconnect.secrets import SecretError, decrypt, encrypt

_FILE = DATA_DIR / "pvs_credentials.json"


def load() -> tuple[str, str] | None:
    try:
        item = json.loads(_FILE.read_text(encoding="utf-8"))
        login, encrypted = item["login"], item["password_enc"]
        if not isinstance(login, str) or not isinstance(encrypted, str) or not login or not encrypted:
            raise ValueError
        return login, encrypted
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise SecretError("Не удалось прочитать сохранённую учётную запись PVS.") from exc


def save(login: str, password: str) -> None:
    encrypted = encrypt(password)
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=_FILE.parent, delete=False) as tmp:
        try:
            json.dump({"login": login, "password_enc": encrypted}, tmp)
            tmp.close()
            os.replace(tmp.name, _FILE)
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)


def clear() -> None:
    _FILE.unlink(missing_ok=True)


def environment() -> dict[str, str]:
    stored = load()
    return {"OPENSEARCH_USERNAME": stored[0], "OPENSEARCH_PASSWORD": decrypt(stored[1])} if stored else {}
