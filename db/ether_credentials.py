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
    clear_owner()

# Кто подключил Эфир (логин Shark). Сессия Эфира одна на сервер — писать от её имени (ответ в чат, ответ на письмо)
# может только этот пользователь Shark; остальные видят ленту и переписку только на чтение. Не секрет.
_OWNER = DATA_DIR / 'ether_owner.json'


def set_owner(login):
    _OWNER.parent.mkdir(parents=True, exist_ok=True)
    _OWNER.write_text(json.dumps({'login': str(login or '')}, ensure_ascii=False), encoding='utf-8')


def owner():
    try: return str(json.loads(_OWNER.read_text(encoding='utf-8')).get('login') or '')
    except (OSError, ValueError, AttributeError): return os.getenv('ETHER_OWNER_LOGIN', '').strip()


def clear_owner():
    _OWNER.unlink(missing_ok=True)
