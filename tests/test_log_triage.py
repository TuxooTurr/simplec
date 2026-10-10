"""Разбор логов: повторы склеиваются в группы, стек прикрепляется к ошибке."""

from mcp_server.log_triage import normalize, parse_lines, render_markdown, triage

POD = "pay-api-7d9f-abc12"


def L(*lines, pod=POD):
    return [(pod, l) for l in lines]


def test_нормализация_убирает_изменчивое():
    a = normalize("Order 12345 failed for user ivan@sber.ru id=3f2a9c1e-1b2c-4d5e-8f90-1234567890ab at 10.0.0.15:8080")
    b = normalize("Order 777 failed for user petr@sber.ru id=00000000-1111-2222-3333-444444444444 at 10.1.2.3:9090")
    assert a == b
    assert "<uuid>" in a and "<email>" in a and "<ip>" in a


def test_java_стек_прикрепляется_и_повторы_склеиваются():
    one = [
        "2026-10-10T12:00:01.000000000Z 2026-10-10 12:00:01.000 ERROR [exec-1] c.s.PayService - Payment 101 failed",
        "java.lang.NullPointerException: null",
        "\tat com.sber.pay.PayService.charge(PayService.java:42)",
        "\tat com.sber.pay.Api.post(Api.java:10)",
        "\t... 12 more",
    ]
    two = [l.replace("101", "202").replace("12:00:01", "12:05:09") for l in one]
    res = triage(L(*one) + L(*two, pod="pay-api-7d9f-xyz99"))
    # Исключение со следующей строки — часть той же ошибки, а не отдельное событие.
    assert res["errors"] == 2
    assert len(res["groups"]) == 1
    top = res["groups"][0]
    assert top["count"] == 2
    assert top["exception"] == "java.lang.NullPointerException"
    assert top["category"] == "NPE"
    assert top["first_ts"].startswith("2026-10-10T12:00:01") and top["last_ts"].startswith("2026-10-10T12:05:09")
    assert set(top["pods"]) == {POD, "pay-api-7d9f-xyz99"}


def test_исключение_с_новой_строки_становится_отдельным_событием_со_стеком():
    events = parse_lines(L(
        "java.lang.IllegalStateException: Bean config missing",
        "\tat org.springframework.Foo.bar(Foo.java:1)",
        "Caused by: java.io.FileNotFoundException: app.yml",
        "INFO Started in 3.2s",
    ))
    assert len(events) == 2
    assert events[0].is_error and len(events[0].stack) == 2
    assert events[0].exception == "java.lang.IllegalStateException"
    assert not events[1].is_error


def test_python_traceback_суть_в_последней_строке():
    res = triage(L(
        "Traceback (most recent call last):",
        '  File "/app/main.py", line 10, in handle',
        "    x = payload['id']",
        "KeyError: 'id'",
    ))
    assert len(res["groups"]) == 1
    g = res["groups"][0]
    assert g["message"] == "KeyError: 'id'"
    assert g["exception"] == "KeyError"


def test_json_логи():
    res = triage(L(
        '{"@timestamp":"2026-10-10T12:00:00Z","level":"ERROR","message":"DB timeout after 30000 ms","logger":"repo"}',
        '{"@timestamp":"2026-10-10T12:00:05Z","level":"ERROR","message":"DB timeout after 31000 ms","logger":"repo"}',
        '{"level":"INFO","message":"ok"}',
    ))
    assert res["events"] == 3 and res["errors"] == 2
    assert len(res["groups"]) == 1
    assert res["groups"][0]["category"] == "timeout"
    # время берётся из поля @timestamp, если у строки нет префикса Kubernetes
    assert res["groups"][0]["first_ts"] == "2026-10-10T12:00:00Z"
    assert res["groups"][0]["last_ts"] == "2026-10-10T12:00:05Z"


def test_http_5xx_считается_ошибкой():
    res = triage(L("INFO GET /api/pay status=503 in 12ms", "INFO GET /api/pay status=200 in 3ms"))
    assert res["errors"] == 1
    assert res["groups"][0]["category"] == "network"


def test_важность_и_порядок():
    lines = L(*["ERROR Kafka send failed: timeout"] * 60, "FATAL java.lang.OutOfMemoryError: Java heap space")
    groups = triage(lines)["groups"]
    assert [g["severity"] for g in groups] == ["critical", "high"]


def test_отступ_без_ошибки_не_склеивается():
    events = parse_lines(L("INFO Config loaded:", "  db.url = jdbc:postgresql://x", "INFO Ready"))
    assert len(events) == 3


def test_отчёт_без_ошибок_и_с_ошибками():
    assert "Ошибок не найдено" in render_markdown(triage(L("INFO all good")))
    md = render_markdown(triage(L("ERROR boom 1", "ERROR boom 2")), title="pay-api")
    assert "## pay-api" in md and "| 1 |" in md and "boom" in md
