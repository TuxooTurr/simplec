"""Общий пул HTTP: одна сессия на процесс, куки между запросами разных пользователей не переживают запрос."""
import requests
from backend.api import http_pool


def test_одна_сессия_и_пул_на_хост():
    s = http_pool.session()
    assert s is http_pool.session()
    assert s.get_adapter("https://jira.example")._pool_maxsize == http_pool.POOL_PER_HOST


def test_куки_ответа_не_сохраняются_между_запросами():
    jar = http_pool.session().cookies
    resp = requests.Response()
    resp.headers["Set-Cookie"] = "JSESSIONID=чужая; Path=/"
    req = requests.Request("GET", "https://jira.example/rest/api/2/myself").prepare()
    from requests.cookies import extract_cookies_to_jar
    resp.raw = type("Raw", (), {"_original_response": type("O", (), {"msg": type("M", (), {
        "get_all": lambda self, name, default=None: ["JSESSIONID=x; Path=/"]})()})()})()
    extract_cookies_to_jar(jar, req, resp.raw)
    assert len(jar) == 0
