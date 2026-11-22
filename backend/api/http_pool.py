"""Общий пул HTTP-соединений для Jira, Confluence и сервисов AQA (Bitbucket, TestOps, Jenkins).

`requests.request(...)` на каждый вызов открывает новое TCP- и TLS-соединение; на массовых
операциях (Zephyr, трекинг AQA, опрос Главной) это сотни рукопожатий с корпоративным шлюзом.
Общая сессия держит соединения открытыми (keep-alive) и переиспользует их.

Куки между запросами не сохраняются — как и раньше с `requests.request`: сервер обслуживает
разных пользователей, и чужая сессия Jira не должна подмешиваться к чужому запросу.
Куки внутри одного запроса (цепочка редиректов) работают как прежде.
"""
from __future__ import annotations

import threading
from http.cookiejar import DefaultCookiePolicy

import requests
from requests.adapters import HTTPAdapter

# Пулы ключуются по хосту; соединений на хост — с запасом под пачки Zephyr/AQA и пул потоков FastAPI.
POOL_PER_HOST = 64

_lock = threading.Lock()
_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                s = requests.Session()
                s.cookies.set_policy(DefaultCookiePolicy(allowed_domains=[]))   # пустой список — не сохранять ничего
                adapter = HTTPAdapter(pool_connections=16, pool_maxsize=POOL_PER_HOST)
                s.mount("https://", adapter)
                s.mount("http://", adapter)
                _session = s
    return _session


def request(method: str, url: str, **kwargs) -> requests.Response:
    """Тот же контракт, что у `requests.request`, но через общий пул соединений."""
    return session().request(method, url, **kwargs)
