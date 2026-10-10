"""Веб-коннекторы: записанный запрос → шаблон и обратно; ответ ресурса → строки логов."""

import json
from datetime import datetime, timezone

from webconnect.extract import extract_lines, log_likeness
from webconnect.templates import detect_login, render, templatize, templatize_steps, uses_window, window_vars

AT = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def test_kibana_post_тело_с_сервисом_и_окном_времени():
    body = {"query": {"bool": {"filter": [
        {"match_phrase": {"kubernetes.container_name": "pay-api"}},
        {"range": {"@timestamp": {"gte": "2026-10-10T11:45:00.000Z", "lte": "2026-10-10T12:00:00.000Z"}}},
    ]}}, "size": 500}
    tpl = templatize({"method": "POST", "url": "https://kibana.sber/api/console/proxy?path=logs-*%2F_search&method=GET",
                      "body": json.dumps(body), "headers": {"kbn-xsrf": "true", "Cookie": "sid=секрет"}},
                     "pay-api", AT)
    assert tpl["kind"] == "request"
    assert "{service}" in tpl["body"] and "{from_iso}" in tpl["body"] and "{to_iso}" in tpl["body"]
    assert tpl["headers"] == {"kbn-xsrf": "true"}            # cookie не сохраняется
    out = json.loads(render(tpl["body"], "notify", 10, AT))
    rng = out["query"]["bool"]["filter"][1]["range"]["@timestamp"]
    assert out["query"]["bool"]["filter"][0]["match_phrase"]["kubernetes.container_name"] == "notify"
    assert rng["gte"] == "2026-10-10T11:50:00.000Z" and rng["lte"] == "2026-10-10T12:00:00.000Z"
    assert out["size"] == 500                                 # прочие числа не тронуты


def test_epoch_в_query_и_число_остаётся_числом():
    tpl = templatize({"method": "GET",
                      "url": "https://loki.sber/loki/api/v1/query_range?query=%7Bapp%3D%22pay-api%22%7D"
                             "&start=1791583200000000000&end=1791584100000000000&limit=1000"}, "pay-api", AT)
    assert "start={from_ns}" in tpl["url"] and "end={to_ns}" in tpl["url"] and "limit=1000" in tpl["url"]
    url = render(tpl["url"], "notify", 10, AT)
    assert "notify" in url and str(int(AT.timestamp() * 1e9)) in url

    body = {"from": 1791583200000, "to": 1791584100000, "service": "pay-api"}
    tpl2 = templatize({"method": "POST", "url": "https://x/api/logs", "body": json.dumps(body)}, "pay-api", AT)
    out = json.loads(render(tpl2["body"], "notify", 10, AT))
    assert isinstance(out["from"], int) and out["to"] - out["from"] == 600_000


def test_since_seconds_и_сервис_в_пути():
    tpl = templatize({"method": "GET", "url": "https://logs.sber/services/pay-api/tail?sinceSeconds=900"}, "pay-api", AT)
    assert tpl["url"].endswith("/services/{service}/tail?sinceSeconds={since_seconds}")
    assert render(tpl["url"], "notify", 10, AT).endswith("/services/notify/tail?sinceSeconds=600")


def test_случайные_числа_не_считаются_временем():
    tpl = templatize({"method": "GET", "url": "https://x/api/logs?id=12345&offset=1700000000000&q=pay-api"}, "pay-api", AT)
    assert "id=12345" in tpl["url"] and "offset=1700000000000" in tpl["url"]   # 2023 год — далеко от записи
    assert tpl["found"]["time"] == []


def test_консоль_openshift_распознаётся_как_логи_сервиса():
    tpl = templatize({"method": "GET", "url": "https://console.apps.x/api/kubernetes/api/v1/namespaces/"
                      "ci02264516-ift/pods/pay-api-7d9f-abc12/log?container=app&sinceSeconds=600&timestamps=true"},
                     "pay-api", AT)
    assert tpl["kind"] == "k8s_logs" and tpl["namespace"] == "ci02264516-ift" and tpl["container"] == "app"


def test_окно_времени():
    v = window_vars(10, AT)
    assert v["since_seconds"] == "600" and v["from_iso"] == "2026-10-10T11:50:00.000Z"
    assert int(v["to_ms"]) - int(v["from_ms"]) == 600_000


# ── Извлечение строк ─────────────────────────────────────────────────────────

def test_elastic_hits():
    body = json.dumps({"hits": {"hits": [
        {"_source": {"@timestamp": "2026-10-10T12:00:00Z", "level": "ERROR", "message": "boom",
                     "kubernetes": {"pod_name": "pay-1"}}},
        {"_source": {"@timestamp": "2026-10-10T12:00:01Z", "message": "ok"}},
    ]}})
    lines = extract_lines(body, "application/json")
    assert lines[0][0] == "pay-1" and json.loads(lines[0][1])["level"] == "ERROR"
    assert lines[1] == (None, "2026-10-10T12:00:01Z ok")


def test_kibana_bsearch_и_loki():
    kb = json.dumps({"rawResponse": {"hits": {"hits": [{"_source": {"message": "x"}}]}}})
    assert extract_lines(kb) == [(None, "x")]
    loki = json.dumps({"data": {"result": [{"stream": {"pod": "pay-1"}, "values": [["1791583200000000000", "ERROR boom"]]}]}})
    src, line = extract_lines(loki)[0]
    assert src == "pay-1" and line.endswith("ERROR boom") and line.startswith("2026-")


def test_текст_и_похожесть_на_логи():
    text = "\n".join(f"2026-10-10T12:00:{i:02d}Z ERROR boom {i}" for i in range(50))
    assert len(extract_lines(text, "text/plain")) == 50
    assert log_likeness(text, "text/plain", "/pods/x/log") > 70
    assert log_likeness('{"user": "ivan"}', "application/json") < 20



def test_несколько_параметров_длинное_значение_первым():
    tpl = templatize({"method": "GET", "url": "https://x/api/tickets?team=pay&service=pay-api&q=pay-api-v2"},
                     {"team": "pay", "service": "pay-api", "svc2": "pay-api-v2"}, AT)
    assert "service={service}" in tpl["url"] and "q={svc2}" in tpl["url"] and "team={team}" in tpl["url"]
    assert render(tpl["url"], {"team": "core", "service": "auth", "svc2": "auth-v3"}, 10, AT).endswith(
        "team=core&service=auth&q=auth-v3")


def test_окно_времени_определяется():
    assert uses_window("a {from_iso} b") and not uses_window("{service}", None)


def test_форма_входа_находится_по_шагу_с_паролем():
    steps = [{"type": "goto", "url": "https://x/login"}, {"type": "fill", "selector": "#u", "value": "u"},
             {"type": "fill", "selector": "#p", "value": "", "secret": True}, {"type": "press", "selector": "#p", "key": "Enter"},
             {"type": "click", "selector": "#menu"}]
    login = detect_login(steps)
    assert login["user_selector"] == "#u" and login["password_selector"] == "#p"
    assert login["submit"]["type"] == "press" and login["login_url"] == "https://x/login" and login["end_index"] == 4
    assert detect_login([{"type": "click", "selector": "#a"}]) is None


def test_шаги_без_пароля_и_лишних_переходов():
    steps = [{"type": "goto", "url": "https://x/search"}, {"type": "fill", "selector": "#q", "value": "pay-api"},
             {"type": "click", "selector": "#go", "text": "Найти"}, {"type": "goto", "url": "https://x/search?q=pay-api"}]
    tpl = templatize_steps(steps, {"service": "pay-api"})
    assert tpl["start_url"] == "https://x/search"
    assert [s["type"] for s in tpl["steps"]] == ["fill", "click"] and tpl["steps"][0]["value"] == "{service}"
