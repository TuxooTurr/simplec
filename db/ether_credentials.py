"""Encrypted local session for read-only Efir MCP. Never returned through the API."""
import json
import os
from tempfile import NamedTemporaryFile
from db.paths import DATA_DIR
from webconnect.secrets import encrypt, decrypt, SecretError
_FILE = DATA_DIR / 'ether_cookies.json'

def load():
    try:
        item = json.loads(_FILE.read_text(encoding='utf-8'))
        return decrypt(item['cookie_enc'])
    except FileNotFoundError: return None
    except (OSError, ValueError, TypeError, KeyError) as exc: raise SecretError('Не удалось прочитать сессию Эфира. Подключитесь заново.') from exc

def save(cookie):
    encrypted = encrypt(cookie)
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile('w', encoding='utf-8', dir=_FILE.parent, delete=False) as tmp:
        try:
            json.dump({'cookie_enc': encrypted}, tmp)
            tmp.close(); os.chmod(tmp.name, 0o600); os.replace(tmp.name, _FILE)
        finally:
            if os.path.exists(tmp.name): os.unlink(tmp.name)

def clear():
    _FILE.unlink(missing_ok=True)
