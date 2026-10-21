"""Дефект из окна дефектов стори: после создания — связь со сторей (тип «Relates» или подходящий из Jira)."""

from fastapi import HTTPException

import backend.api.jira_defects as jd


def _fake(types, fail=False):
    calls = []

    def req(cfg, method, path, json_body=None, **kw):
        calls.append((method, path, json_body))
        if path == "/rest/api/2/issueLinkType":
            return {"issueLinkTypes": types}
        if path == "/rest/api/2/issueLink":
            if fail:
                raise HTTPException(400, "No issue link type with name")
            return {}
        raise AssertionError(path)
    return req, calls


def test_связь_типом_relates(monkeypatch):
    req, calls = _fake([{"name": "Blocks", "inward": "is blocked by", "outward": "blocks"},
                        {"name": "Relates", "inward": "relates to", "outward": "relates to"}])
    monkeypatch.setattr(jd, "_jira_request", req)
    warnings: list[str] = []
    assert jd.link_issue({}, "SBER911-9", "SBER911-1", warnings) and not warnings
    assert calls[-1][2] == {"type": {"name": "Relates"}, "inwardIssue": {"key": "SBER911-9"}, "outwardIssue": {"key": "SBER911-1"}}


def test_русская_jira_связь_по_описанию(monkeypatch):
    req, calls = _fake([{"name": "Блокирует", "inward": "блокируется", "outward": "блокирует"},
                        {"name": "Ссылка", "inward": "связано с", "outward": "связано с"}])
    monkeypatch.setattr(jd, "_jira_request", req)
    jd.link_issue({}, "A-1", "A-2", [])
    assert calls[-1][2]["type"] == {"name": "Ссылка"}


def test_не_связалось_предупреждение(monkeypatch):
    req, _ = _fake([], fail=True)
    monkeypatch.setattr(jd, "_jira_request", req)
    warnings: list[str] = []
    assert not jd.link_issue({}, "A-1", "A-2", warnings)
    assert "связь с A-2 не создалась" in warnings[0]
