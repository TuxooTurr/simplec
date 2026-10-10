"""MCP-сервер SimpleTest: разбор ответов Kubernetes и инструменты через MCP-клиент.

Сеть и браузер подменены: консоль dropup и API SimpleTest — заглушки. Проверяется,
что инструменты зарегистрированы, вызываются по протоколу MCP и честно сообщают
об ошибках (без сессии, без учётки).
"""

import asyncio

import pytest
from mcp import Client

import mcp_server.server as S
from mcp_server.dropup import ConsoleError, NotLoggedIn, parse_pods, parse_workloads, selector_to_query
from mcp_server.simpletest_api import SimpleTestError

# ── Разбор ответов Kubernetes ────────────────────────────────────────────────

DEPLOYMENTS = {"kind": "DeploymentList", "items": [{
    "metadata": {"name": "pay-api"},
    "spec": {"replicas": 2, "selector": {"matchLabels": {"app": "pay-api", "tier": "api"}},
             "template": {"spec": {"containers": [{"name": "app", "image": "registry/sber/pay-api:1.4.2"}]}}},
    "status": {"readyReplicas": 1},
}]}
DEPLOYMENT_CONFIGS = {"kind": "DeploymentConfigList", "items": [{
    "metadata": {"name": "legacy"},
    "spec": {"replicas": 1, "selector": {"app": "legacy"},
             "template": {"spec": {"containers": [{"name": "legacy", "image": "registry/legacy@sha256:abc"}]}}},
    "status": {"readyReplicas": 1},
}]}
PODS = {"items": [
    {"metadata": {"name": "pay-api-1"}, "spec": {"containers": [{"name": "app"}]},
     "status": {"phase": "Running", "startTime": "2026-10-10T10:00:00Z",
                "containerStatuses": [{"ready": True, "restartCount": 0, "state": {"running": {}}}]}},
    {"metadata": {"name": "pay-api-2"}, "spec": {"containers": [{"name": "app"}]},
     "status": {"phase": "Running",
                "containerStatuses": [{"ready": False, "restartCount": 7,
                                       "state": {"waiting": {"reason": "CrashLoopBackOff"}}}]}},
]}


def test_селектор_в_запрос():
    assert selector_to_query({"tier": "api", "app": "pay-api"}) == "app=pay-api,tier=api"


def test_сервисы_из_deployment_и_deploymentconfig():
    services = parse_workloads(DEPLOYMENTS, DEPLOYMENT_CONFIGS)
    assert [s["name"] for s in services] == ["legacy", "pay-api"]
    pay = services[1]
    assert pay["kind"] == "Deployment" and pay["ready"] == 1 and pay["replicas"] == 2
    assert pay["selector"] == {"app": "pay-api", "tier": "api"}
    assert services[0]["selector"] == {"app": "legacy"}   # у DeploymentConfig селектор плоский


def test_поды_рестарты_и_crashloop():
    pods = parse_pods(PODS)
    assert pods[0]["ready"] and pods[0]["restarts"] == 0
    assert not pods[1]["ready"] and pods[1]["restarts"] == 7 and pods[1]["waiting"] == ["CrashLoopBackOff"]


# ── Инструменты через протокол MCP ───────────────────────────────────────────

class FakeConsole:
    base_url = "https://console.example"

    def __init__(self, logged_in=True):
        self.logged_in = logged_in

    async def whoami(self):
        return "16538296" if self.logged_in else None

    async def list_services(self, ns):
        if not self.logged_in:
            raise NotLoggedIn("Сессия dropup отсутствует — вызови dropup_login")
        return parse_workloads(DEPLOYMENTS)

    async def service_logs(self, ns, service, since_minutes=15, tail_lines=3000):
        if service == "broken":
            raise ConsoleError("Сервис «broken» не найден")
        lines = [("pay-api-1", f"2026-10-10T12:00:0{i}Z ERROR Payment {i} failed: timeout") for i in range(6)]
        lines += [("pay-api-1", "2026-10-10T12:00:09Z INFO ok")]
        return parse_pods(PODS), lines


class FakeSimpleTest:
    def __init__(self, fail=False):
        self.fail = fail

    async def request(self, method, path, **kw):
        if self.fail:
            raise SimpleTestError("Не заданы SIMPLETEST_LOGIN и SIMPLETEST_PASSWORD")
        if path == "/api/requirements":
            return [{"id": "r1", "name": "Оплата СБП", "feature": "Платежи", "text": "Текст", "qa_doc": "Док"},
                    {"id": "r2", "name": "Вход", "feature": "Auth", "text": "Т2", "qa_doc": ""}]
        if path == "/api/log-analyzer/run":
            return {"service": kw["json"]["service"], "minutes": kw["json"]["minutes"], "source": "x", "lines": 3,
                    "events": 3, "errors": 2, "scenario": {"name": "Логи · Kibana"},
                    "groups": [{"fingerprint": "f", "message": "timeout", "exception": "", "level": "ERROR",
                                "count": 2, "first_ts": None, "last_ts": None, "pods": [], "category": "timeout",
                                "severity": "low", "sample_stack": []}]}
        if path == "/api/bugs/format":
            fields = {name: value for name, (_, value) in kw["files"]}
            return {"report": f"# [{fields['platform']}][Pay] {fields['description'][:20]}", "priority": "Высокий"}
        raise AssertionError(path)


def call(tool, args=None, console=None, simpletest=None, monkeypatch=None):
    monkeypatch.setattr(S, "_console", console or FakeConsole())
    monkeypatch.setattr(S, "_simpletest", simpletest or FakeSimpleTest())

    async def run():
        async with Client(S.mcp) as client:
            return await client.call_tool(tool, args or {})
    res = asyncio.run(run())
    return res.is_error, "\n".join(c.text for c in res.content if getattr(c, "text", None))


def test_все_инструменты_зарегистрированы():
    async def run():
        async with Client(S.mcp) as client:
            return [t.name for t in (await client.list_tools()).tools]
    names = set(asyncio.run(run()))
    assert {"simpletest_requirements", "simpletest_requirement", "simpletest_format_bug",
            "simpletest_jira_views", "simpletest_jira_view_run",
            "dropup_status", "dropup_login", "dropup_projects", "dropup_services",
            "dropup_pods", "dropup_logs", "dropup_triage", "dropup_check",
            "logs_analyze", "logs_saved_services", "web_scenarios", "web_run"} <= names


def test_требования_с_фильтром(monkeypatch):
    err, text = call("simpletest_requirements", {"query": "сбп"}, monkeypatch=monkeypatch)
    assert not err and "r1" in text and "r2" not in text and "QA-документация" in text


def test_баг_репорт_передаёт_поля_формы(monkeypatch):
    err, text = call("simpletest_format_bug", {"description": "Падает оплата по СБП", "platform": "Front"},
                     monkeypatch=monkeypatch)
    assert not err and text.startswith("# [Front][Pay]") and "Высокий" in text


def test_без_учётки_simpletest_ошибка_с_подсказкой(monkeypatch):
    err, text = call("simpletest_requirements", simpletest=FakeSimpleTest(fail=True), monkeypatch=monkeypatch)
    assert err and "SIMPLETEST_LOGIN" in text


def test_статус_без_сессии_подсказывает_вход(monkeypatch):
    err, text = call("dropup_status", console=FakeConsole(logged_in=False), monkeypatch=monkeypatch)
    assert not err and "dropup_login" in text


def test_разбор_логов_сервиса(monkeypatch):
    err, text = call("dropup_triage", {"namespace": "ift", "service": "pay-api"}, monkeypatch=monkeypatch)
    assert not err
    assert "medium" in text and "| 6 |" in text          # 6 одинаковых ошибок → одна группа
    assert "CrashLoopBackOff" in text and "рестартов: 7" in text


def test_сводка_по_стенду_не_падает_на_одном_сервисе(monkeypatch):
    err, text = call("dropup_check", {"namespace": "ift", "services": ["pay-api", "broken"]}, monkeypatch=monkeypatch)
    assert not err and "pay-api" in text and "не найден" in text


def test_нет_сессии_это_ошибка_инструмента(monkeypatch):
    err, text = call("dropup_services", {"namespace": "ift"}, console=FakeConsole(logged_in=False),
                     monkeypatch=monkeypatch)
    assert err and "dropup_login" in text


def test_анализ_логов_через_simpletest(monkeypatch):
    err, text = call("logs_analyze", {"service": "pay-api", "minutes": 5}, monkeypatch=monkeypatch)
    assert not err and "pay-api · последние 5 мин" in text and "Логи · Kibana" in text and "timeout" in text
