from __future__ import annotations

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from agents import log_assertions, logs_investigation as investigation
from agents import logs_mcp
from agents.logs_mcp import DEFAULT_ARGS, DemoLogSource, LogSourceError, McpLogSource, Record, normalize
from backend.api import mcp_logs
from backend.api import auth
from db import pvs_credentials
from webconnect import secrets

START = datetime(2026, 11, 19, 9, 0, tzinfo=timezone.utc)
END = START + timedelta(minutes=30)


def test_recognizes_errors_and_masks_secrets_from_structured_and_plain_logs():
    records, truncated = normalize({"logs": [
        {"service": "payments-api", "severity": "info", "message": "Проверок ERROR не было"},
        {"service.name": "ledger-service", "level": "WARN", "statusCode": 503,
         "message": "trace_id=linked Authorization: Bearer top.secret password=my-pass"},
    ], "hasMore": True}, None, 30)
    assert not records[0].error and records[1].error and truncated
    assert records[1].service == "ledger-service" and records[1].traceId == "linked"
    assert "top.secret" not in records[1].message and "my-pass" not in records[1].message

    actual, _ = normalize("ERROR Missing connection\n    at ConnectionPool.read(Connection.java:10)\nINFO recovered", "payments-api", 30)
    assert [row.error for row in actual] == [True, False]
    assert "Connection.java:10" in actual[0].stack[0]


def test_mcp_arguments_are_bounded_and_only_supported_optional_arguments_go_to_tool():
    calls = []

    async def call_tool(name, args):
        calls.append((name, args))
        return SimpleNamespace(is_error=False, structured_content=None,
                               content=[SimpleNamespace(type="text", text='{"records": []}')])

    names = {**DEFAULT_ARGS, "service": "app", "start": "from", "end": "to"}
    schema = {"properties": {k: {} for k in ("app", "from", "to", "limit", "errorsOnly")}, "required": ["from", "to"]}
    source = McpLogSource(SimpleNamespace(call_tool=call_tool), SimpleNamespace(name="fetch_logs", input_schema=schema), names)
    answer = asyncio.run(source.search(service=None, start=START, end=END, limit=40,
                                       errors_only=True, trace_id="unsupported"))
    assert answer == {"records": []}
    assert calls == [("fetch_logs", {"from": START.isoformat(), "to": END.isoformat(), "limit": 40, "errorsOnly": True})]
    schema["required"].append("app")
    with pytest.raises(LogSourceError, match="конкретный сервис"):
        asyncio.run(source.search(service=None, start=START, end=END, limit=40))
    assert len(calls) == 1


def test_pvs_search_over_stdio_uses_opensearch_contract_and_preserves_log_fields(tmp_path, monkeypatch):
    script = tmp_path / "pvs_contract.py"
    script.write_text(
        """import json
import os
import time
from mcp.server.mcpserver import MCPServer

mcp = MCPServer("PVS contract test")

@mcp.tool(name="SearchIndexTool", structured_output=False)
def search(index: str, query_dsl: dict, size: int, format: str = "json") -> str:
    assert os.environ["OPENSEARCH_PASSWORD"] == "fake-secret"
    assert "UNRELATED_SECRET" not in os.environ
    assert (index, size, format) == ("ift-logs", 100, "json")
    filters = query_dsl["query"]["bool"]["filter"]
    assert {"term": {"k8s.ns.keyword": "sber911-sigma-back"}} in filters
    if {"term": {"trace.keyword": "slow-trace"}} in filters:
        time.sleep(0.2)
    assert filters[1]["range"]["@timestamp"]["gte"] == "2026-11-19T09:00:00+00:00"
    assert query_dsl["sort"] == [{"@timestamp": "desc"}]
    if len(filters) > 2:
        assert {"term": {"app.keyword": "ledger-service"}} in filters
        assert "ERROR" in next(item["terms"]["severity.keyword"] for item in filters if "terms" in item)
        assert {"term": {"trace.keyword": "test-trace"}} in filters
    doc = {"k8s": {"ns": "sber911-sigma-back"}, "app": "ledger-service", "severity": "error",
           "detail": "database unavailable", "trace": "test-trace", "correlation": "request-1",
           "@timestamp": "2026-11-19T09:03:00Z", "context": {"result": "FAILED"}}
    response = {"hits": {"total": {"value": 101}, "hits": [{"_source": doc}]}}
    return f"Search results from {index} (JSON format):\\n{json.dumps(response)}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
""",
        encoding="utf-8",
    )
    settings = {
        "LOGS_MCP_PROFILE": "pvs", "LOGS_MCP_TOOL": "", "LOGS_MCP_TRANSPORT": "stdio",
        "LOGS_MCP_COMMAND": sys.executable, "LOGS_MCP_STDIO_ARGS": json.dumps([str(script)]),
        "LOGS_MCP_STDIO_ENV": '["OPENSEARCH_PASSWORD"]',
        "OPENSEARCH_PASSWORD": "fake-secret", "UNRELATED_SECRET": "fake-other-secret",
        "LOGS_MCP_NAMESPACE": "sber911-sigma-back", "LOGS_PVS_INDEX": "ift-logs",
        "LOGS_PVS_FIELDS": json.dumps({
            "namespace": "k8s.ns.keyword", "service": "app.keyword", "timestamp": "@timestamp",
            "level": "severity.keyword", "message": "detail", "traceId": "trace.keyword",
            "requestId": "correlation.keyword",
        }),
    }
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(logs_mcp, "MOCK", False)

    async def check():
        async with logs_mcp.open_source() as source:
            await source.search(service=None, start=START, end=END, limit=500)
            return await log_assertions.read_matching(source, START, END, log_assertions.LogFilter(
                service="ledger-service", trace_id="test-trace", request_id="request-1", levels=("ERROR",),
                field="context.result", value="FAILED", errors_only=True,
            ), 500)

    result = asyncio.run(check())
    assert result.truncated
    assert len(result.records) == 1
    row = result.records[0]
    assert (row.service, row.level, row.error) == ("ledger-service", "ERROR", True)
    assert row.message == "database unavailable" and row.namespace == "sber911-sigma-back"

    async def check_deadline():
        async with logs_mcp.open_source() as source:
            with monkeypatch.context() as settings:
                settings.setattr(logs_mcp, "_request_timeout", lambda: 0.01)
                await source.search(service="ledger-service", start=START, end=END, limit=500, trace_id="slow-trace")

    with pytest.raises(logs_mcp.LogSourceTimeout, match="MCP не ответил на поиск"):
        asyncio.run(check_deadline())


def test_wait_retries_failed_and_empty_log_reads(monkeypatch):
    calls = []

    class Source:
        async def search(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise LogSourceError("Временно недоступен")
            return {"records": [] if len(calls) == 2 else [{
                "service": "payments-api", "timestamp": START.isoformat(), "message": "operation finished",
            }]}

    @asynccontextmanager
    async def open_test_source():
        yield Source()

    monkeypatch.setattr(log_assertions, "open_source", open_test_source)
    filters = log_assertions.LogFilter(service="payments-api", text="finished")
    result = asyncio.run(log_assertions.wait_for_logs(START, END, filters, timeout=1, interval=0.005))
    assert len(result.records) == 1 and len(calls) == 3
    assert all(call["start"] == START and call["end"] == END for call in calls)


def test_single_mcp_deadline_and_partial_pvs_results_are_distinct(monkeypatch):
    monkeypatch.setattr(logs_mcp, "_request_timeout", lambda: 0.01)

    async def slow_tool(name, arguments):
        await asyncio.sleep(1)

    with pytest.raises(logs_mcp.LogSourceTimeout, match="0.01 с"):
        asyncio.run(logs_mcp._call_search(SimpleNamespace(call_tool=slow_tool), SimpleNamespace(name="pvs"), {}))

    class PartialSource:
        async def search(self, **kwargs):
            return {"timed_out": True, "hits": {"hits": [{"_source": {
                "service": "payments-api", "level": "ERROR", "message": "Stored before timeout",
            }}]}}

    result = asyncio.run(log_assertions.read_matching(PartialSource(), START, END, log_assertions.LogFilter(), 100))
    assert result.truncated and result.timed_out and len(result.records) == 1


def test_background_query_can_finish_after_the_start_request_and_can_be_cancelled(monkeypatch):
    monkeypatch.setattr(mcp_logs, "_jobs", {})
    monkeypatch.setitem(auth._sessions, "log-session", {"role": "superuser"})
    monkeypatch.setitem(auth._sessions, "other-log-session", {"role": "superuser"})
    app = FastAPI()
    app.include_router(mcp_logs.router)

    async def scenario():
        release = asyncio.Event()
        cancelled = asyncio.Event()

        async def slow_query(body):
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
            return {"records": [], "errorCount": 0, "truncated": False, "timedOut": False}

        monkeypatch.setattr(mcp_logs, "query", slow_query)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                     headers={"Authorization": "Bearer log-session"}) as client:
            payload = {"start": START.isoformat(), "end": END.isoformat(), "errorsOnly": True}
            started = await client.post("/api/mcp-logs/query/jobs", json=payload)
            assert started.status_code == 202 and not release.is_set()
            job_id = started.json()["id"]
            path = f"/api/mcp-logs/jobs/{job_id}"
            progress = await client.get(path)
            status = progress.json()
            assert status["status"] == "running" and status["phase"] == "search" and status["seconds"] >= 0
            assert progress.headers["cache-control"] == "no-store"
            forbidden = await client.get(path, headers={"Authorization": "Bearer other-log-session"})
            assert forbidden.status_code == 404
            release.set()
            await asyncio.wait_for(asyncio.shield(mcp_logs._jobs[job_id].task), 1)
            done = (await client.get(path)).json()
            assert done["status"] == "done" and done["result"]["records"] == []

            release.clear()
            started = await client.post("/api/mcp-logs/query/jobs", json=payload)
            path = f"/api/mcp-logs/jobs/{started.json()['id']}"
            await asyncio.sleep(0)
            assert (await client.delete(path)).status_code == 200
            await asyncio.wait_for(cancelled.wait(), 1)
            assert (await client.get(path)).json()["status"] == "cancelled"

            monkeypatch.setattr(mcp_logs, "_job_timeout", lambda: 0.01)
            started = await client.post("/api/mcp-logs/query/jobs", json=payload)
            job_id = started.json()["id"]
            await asyncio.wait_for(asyncio.shield(mcp_logs._jobs[job_id].task), 1)
            expired = (await client.get(f"/api/mcp-logs/jobs/{job_id}")).json()
            assert expired["status"] == "timeout" and "превысила лимит" in expired["detail"]

    asyncio.run(scenario())


def test_errors_only_works_for_all_and_single_service(monkeypatch):
    calls = []

    class Source(DemoLogSource):
        async def search(self, **kwargs):
            calls.append(kwargs)
            return await super().search(**{**kwargs, "errors_only": False})  # источник игнорирует фильтр

    @asynccontextmanager
    async def source():
        yield Source()

    monkeypatch.setattr(mcp_logs, "configured", lambda: True)
    monkeypatch.setattr(mcp_logs, "open_source", source)
    monkeypatch.setattr(mcp_logs, "_services", lambda: ["payments-api", "ledger-service", "notifications-api"])
    all_errors = asyncio.run(mcp_logs.query(mcp_logs.Query(start=START, end=END, errorsOnly=True)))
    pay = asyncio.run(mcp_logs.query(mcp_logs.Query(start=START, end=END, service="payments-api")))
    assert {r.service for r in all_errors["records"]} == set(logs_mcp.DEMO_SERVICES)
    assert all_errors["errorCount"] == 3 and all(r.error for r in all_errors["records"])
    assert len(pay["records"]) == 2 and pay["errorCount"] == 1
    assert calls[0]["service"] is None and calls[0]["errors_only"]
    assert calls[1]["service"] == "payments-api"
    with pytest.raises(HTTPException) as err:
        asyncio.run(mcp_logs.query(mcp_logs.Query(start=START, end=END, service="unknown")))
    assert err.value.status_code == 422 and len(calls) == 2


def test_follows_referenced_service_and_stops_at_different_trace(monkeypatch):
    asked = []

    class Source:
        async def search(self, **kwargs):
            asked.append(kwargs)
            if kwargs["service"] == "ledger-service":
                return {"records": [{"service": "ledger-service", "level": "ERROR", "traceId": "same",
                                     "message": "payments-api retry; ledger-db failed"}]}
            return {"records": [{"service": "ledger-db", "level": "ERROR", "traceId": "unrelated",
                                 "message": "notifications-api unavailable"}]}

    @asynccontextmanager
    async def source():
        yield Source()

    monkeypatch.setattr(investigation, "open_source", source)
    initial = Record(service="payments-api", level="ERROR", message="ledger-service.svc: HTTP 503, unknown-ms",
                     timestamp=(START + timedelta(minutes=12)).isoformat(), traceId="same", error=True)
    steps, limited = asyncio.run(investigation.follow_dependencies([initial], [
        "payments-api", "ledger-service", "ledger-db", "notifications-api",
    ], START, END))
    assert [(r.service, r.correlation) for r in steps] == [("ledger-service", "trace"), ("ledger-db", "time")]
    assert [q["service"] for q in asked] == ["ledger-service", "ledger-db"] and not limited
    assert asked[0]["start"] == START + timedelta(minutes=7) and asked[0]["trace_id"] == "same"


def test_failed_lookup_does_not_discard_other_evidence(monkeypatch):
    @asynccontextmanager
    async def source():
        raise LogSourceError("Нет ответа")
        yield  # async generator for the context manager

    monkeypatch.setattr(investigation, "open_source", source)
    initial = Record(service="payments-api", level="ERROR", message="ledger-service: HTTP 503", error=True)
    steps, _ = asyncio.run(investigation.follow_dependencies([initial], ["ledger-service"], START, END))
    assert len(steps) == 1 and steps[0].service == "ledger-service" and steps[0].correlation == "unavailable"


def test_no_results_by_trace_retries_by_time_and_labels_evidence(monkeypatch):
    trace_arguments = []

    class Source:
        supports_trace = True

        async def search(self, trace_id="", **kwargs):
            trace_arguments.append(trace_id)
            return {"records": [] if trace_id else [{"level": "ERROR", "message": "Нет подключения"}]}

    @asynccontextmanager
    async def source():
        yield Source()

    monkeypatch.setattr(investigation, "open_source", source)
    initial = Record(service="payments-api", level="ERROR", message="ledger-service: HTTP 503", traceId="lost", error=True)
    steps, _ = asyncio.run(investigation.follow_dependencies([initial], ["ledger-service"], START, END))
    assert trace_arguments == ["lost", ""]
    assert len(steps) == 1 and steps[0].correlation == "time" and steps[0].records[0].message == "Нет подключения"


def test_model_receives_related_evidence_with_correlation_and_without_tokens(monkeypatch):
    import json
    from agents import llm_client

    captured = {}

    class Model:
        def __init__(self, provider, timeout):
            captured["provider"] = provider

        def chat(self, messages, **kwargs):
            assert [m.role for m in messages] == ["system", "user"]
            captured["evidence"] = json.loads(messages[-1].content)
            return llm_client.LLMResponse(content=json.dumps({
                "title": "Не подтверждается оплата", "summary": "Сервис не ответил", "impact": "Нет подтверждения",
                "cause": "Связанные события совпали по времени, но причина пока гипотеза", "nextSteps": [],
            }))

    monkeypatch.setattr(llm_client, "LLMClient", Model)
    event = Record(service="payments-api", message="ledger-service недоступен token=top.secret", error=True)
    related = Record(service="ledger-service", message="Таймаут соединения", error=True)
    lookup = investigation.Lookup(service="ledger-service", fromService="payments-api", correlation="time", records=[related])
    result = investigation._diagnose([event], [lookup], "custom_corp", False)
    assert result.title == "Не подтверждается оплата" and captured["provider"] == "custom_corp"
    assert "top.secret" not in str(captured["evidence"])
    assert captured["evidence"]["related"][0]["correlation"] == "time"
    assert captured["evidence"]["related"][0]["records"][0]["message"] == "Таймаут соединения"


def test_pvs_credentials_are_admin_only_encrypted_and_forwarded_to_local_server(tmp_path, monkeypatch):
    monkeypatch.setattr(pvs_credentials, "_FILE", tmp_path / "pvs_credentials.json")
    monkeypatch.setattr(secrets, "_KEY_FILE", tmp_path / "secret.key")
    monkeypatch.delenv("SIMPLETEST_SECRET_KEY", raising=False)
    monkeypatch.setenv("LOGS_MCP_PROFILE", "pvs")
    monkeypatch.setenv("LOGS_MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("LOGS_MCP_COMMAND", sys.executable)
    monkeypatch.setenv("OPENSEARCH_USERNAME", "ci-user")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "test-ci-password")
    monkeypatch.setitem(auth._sessions, "admin", {"role": "superuser"})
    monkeypatch.setitem(auth._sessions, "person", {"role": "user"})
    app = FastAPI()
    app.include_router(mcp_logs.router)
    client = TestClient(app)
    route = "/api/mcp-logs/pvs"
    admin = {"Authorization": "Bearer admin"}
    person = {"Authorization": "Bearer person"}
    body = {"login": "test-user", "password": "synthetic-pvs-password"}
    assert client.get(route, headers=person).status_code == 403
    assert client.put(route, headers=person, json=body).status_code == 403

    stored = client.put(route, headers=admin, json=body)
    assert stored.status_code == 200 and stored.json()["credentialSource"] == "saved"
    assert stored.json()["login"] == "test-user" and body["password"] not in stored.text
    assert "password" not in client.get(route, headers=admin).json()
    assert body["password"] not in pvs_credentials._FILE.read_text()

    async def forwarded_environment():
        from contextlib import AsyncExitStack

        async with AsyncExitStack() as stack:
            return (await logs_mcp._transport(stack)).env

    assert asyncio.run(forwarded_environment())["OPENSEARCH_PASSWORD"] == body["password"]
    assert client.delete(route, headers=admin).json()["credentialSource"] == "environment"
    assert asyncio.run(forwarded_environment())["OPENSEARCH_PASSWORD"] == "test-ci-password"


def test_multi_selection_groups_same_trace_and_keeps_independent_events_separate(monkeypatch):
    monkeypatch.setattr(investigation, "MOCK", True)
    rows, _ = normalize(asyncio.run(DemoLogSource().search(
        service=None, start=START, end=END, limit=20, errors_only=True,
    )), None, 20)
    groups = asyncio.run(investigation.investigate_selection(rows, list(logs_mcp.DEMO_SERVICES), START, END, "gigachat"))["groups"]
    assert [g["correlationId"] for g in groups] == ["demo-payment-42", "demo-push-17"]
    assert [r.service for r in groups[0]["records"]] == ["payments-api", "ledger-service"]
    assert [r.service for r in groups[1]["records"]] == ["notifications-api"]
    assert "оплат" in groups[0]["result"].title.lower() and "push" in groups[1]["result"].title


def test_batch_sends_each_group_once_and_keeps_model_answers_with_matching_ids(monkeypatch):
    from agents import llm_client

    calls = []

    class Model:
        def __init__(self, provider, timeout):
            assert provider == "custom_corp"

        def chat(self, messages, **kwargs):
            calls.append(json.loads(messages[-1].content))
            return llm_client.LLMResponse(content=json.dumps({"groups": [
                {"id": i, "diagnosis": {"title": f"Группа {i}", "summary": str(i), "impact": str(i), "cause": str(i)}}
                for i in (2, 1)
            ]}))

    monkeypatch.setattr(llm_client, "LLMClient", Model)
    monkeypatch.setattr(investigation, "MOCK", False)
    records = [
        Record(service="api", message="request attempt 1", requestId="request-1"),
        Record(service="worker", message="request attempt 2", requestId="request-1"),
        Record(service="push", message="independent event"),
    ]
    groups = asyncio.run(investigation.investigate_selection(records, [], START, END, "custom_corp"))["groups"]
    assert [[r["service"] for r in group["selected"]] for group in calls[0]] == [["api", "worker"], ["push"]]
    assert len(calls) == 1 and [g["result"].title for g in groups] == ["Группа 1", "Группа 2"]


def test_pvs_queries_selected_services_in_one_search(monkeypatch):
    monkeypatch.setenv("LOGS_MCP_NAMESPACE", "ift")
    monkeypatch.setenv("LOGS_PVS_INDEX", "logs")
    monkeypatch.setenv("LOGS_PVS_FIELDS", '{"namespace":"ns","service":"app","timestamp":"time","level":"level"}')
    calls = []

    async def call(*_args, **_kwargs):
        calls.append(_args[2])
        return {"hits": {"hits": [{"_source": {"ns": "ift", "app": app, "time": END.isoformat(),
                                               "level": "ERROR", "message": app}}
                                 for app in ("a", "b", "unselected")]}}

    monkeypatch.setattr(logs_mcp, "_call_search", call)
    source = logs_mcp.PvsLogSource(None, SimpleNamespace(input_schema={"properties": {
        "index": {}, "query_dsl": {}, "size": {},
    }}))

    @asynccontextmanager
    async def open_source():
        yield source

    monkeypatch.setattr(mcp_logs, "open_source", open_source)
    monkeypatch.setattr(mcp_logs, "configured", lambda: True)
    monkeypatch.setattr(mcp_logs, "_services", lambda: ["a", "b", "unselected"])
    result = asyncio.run(mcp_logs.query(mcp_logs.Query(start=START, end=END, services=["a", "b", "a"], errorsOnly=True)))
    assert [record.service for record in result["records"]] == ["a", "b"]
    assert len(calls) == 1
    filters = calls[0]["query_dsl"]["query"]["bool"]["filter"]
    assert {"terms": {"app": ["a", "b"]}} in filters
    assert any("ERROR" in item.get("terms", {}).get("level", ()) for item in filters)


def test_log_analysis_audits_uploads_live_events_rejections_and_cancellation(tmp_path, monkeypatch):
    from db import log_analysis_audit

    monkeypatch.setattr(log_analysis_audit, "_FILE", tmp_path / "audit.sqlite3")
    monkeypatch.setattr(mcp_logs, "_jobs", {})
    monkeypatch.setattr(investigation, "MOCK", True)
    monkeypatch.setattr(mcp_logs, "MAX_BYTES", 256)
    for actor, role in [("qa", "user"), ("other", "user"), ("admin", "superuser")]:
        monkeypatch.setitem(auth._sessions, actor, {"role": role, "login": actor})
    app = FastAPI()
    app.include_router(mcp_logs.router)

    async def scenario():
        prefix = "/api/mcp-logs"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                     headers={"Authorization": "Bearer qa"}) as client:
            accepted = await client.post(prefix + "/upload/jobs", data={"errorsOnly": "true"}, files=[
                ("files", ("first.log", b"INFO startup\nERROR db failed token=synthetic-secret\n  at frame\n")),
                ("files", ("second.log", b'{"level":"error","message":"second failure"}\n')),
            ])
            assert accepted.status_code == 202, accepted.text
            job_id = accepted.json()["id"]
            await mcp_logs._jobs[job_id].task
            job = (await client.get(f"{prefix}/jobs/{job_id}")).json()
            assert job["status"] == "done"
            stats = job["result"]["upload"]
            assert (stats["fileCount"], stats["eventCount"], stats["errorCount"], stats["sampleCount"]) == (2, 3, 2, 2)
            assert "synthetic-secret" not in str(job)
            assert all(row["error"] for row in job["result"]["groups"][0]["records"])
            too_big = await client.post(prefix + "/upload/jobs", files=[
                ("files", ("a.log", b"a" * 150)), ("files", ("b.log", b"b" * 150)),
            ])
            assert too_big.status_code == 413
            invalid = await client.post(prefix + "/analyze/jobs", json={})
            assert invalid.status_code == 422
            body = {"start": START.isoformat(), "end": END.isoformat(), "provider": "test-model",
                    "records": [{"service": "test", "message": "temporary evidence"}]}
            sync = await client.post(prefix + "/analyze", json=body)
            assert sync.status_code == 200

            release = asyncio.Event()

            async def wait_for_cancel(_body, _job=None):
                await release.wait()

            monkeypatch.setattr(mcp_logs, "_analyze", wait_for_cancel)
            active = (await client.post(prefix + "/analyze/jobs", json=body)).json()["id"]
            assert (await client.delete(f"{prefix}/jobs/{active}")).status_code == 200
            await asyncio.gather(mcp_logs._jobs[active].task, return_exceptions=True)
            entries = (await client.get(prefix + "/audit")).json()["entries"]
            assert {(entry["source"], entry["status"]) for entry in entries} == {
                ("file", "done"), ("file", "error"), ("pvs", "done"), ("pvs", "error"), ("pvs", "cancelled"),
            }
            assert "temporary evidence" not in str(entries) and "first.log" not in str(entries)
            assert all(entry["actor"] == "qa" and entry["finished_at"] for entry in entries)
            other = await client.get(prefix + "/audit", headers={"Authorization": "Bearer other"})
            assert not other.json()["entries"]
            admin = await client.get(prefix + "/audit", headers={"Authorization": "Bearer admin"})
            assert len(admin.json()["entries"]) == len(entries)

    asyncio.run(scenario())
