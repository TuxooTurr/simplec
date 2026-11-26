from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from backend.api import dashboard, dashboard_activity as activity


def employee(**options):
    return dashboard.Widget(title="Активность сотрудника", kind="employee", jql="project = SBER911",
                            employeeLogin="qa_user", **options).model_dump()


def test_calendar_saves_one_day_without_requiring_a_name_or_an_end_date():
    widget = employee(activityPeriod="custom", activityFrom="2026-11-25", activityTimezone="Asia/Shanghai")
    assert widget["employeeName"] == ""
    assert widget["activityTo"] == ""
    assert activity.date_range(widget) == (date(2026, 11, 25), date(2026, 11, 26))
    with pytest.raises(ValueError, match="корректную дату"):
        employee(activityPeriod="custom", activityFrom="2026-11-25", activityTo="2026-11-24")


def test_bitbucket_uses_login_and_author_date_for_saved_calendar(monkeypatch):
    from contextlib import nullcontext

    monkeypatch.setattr(activity, "SessionLocal", lambda: nullcontext(None))
    monkeypatch.setattr(activity.aqa, "_cached", lambda key, refresh, run: run())
    monkeypatch.setattr(activity.aqa, "_bb_ready", lambda db: {
        "url": "https://bitbucket.test/repo", "base_url": "https://bitbucket.test", "project": "P", "repo": "repo",
    })
    zone = ZoneInfo("Asia/Shanghai")
    inside = int(datetime(2026, 11, 25, 0, 5, tzinfo=zone).timestamp() * 1000)
    outside = int(datetime(2026, 11, 26, tzinfo=zone).timestamp() * 1000)

    def commit(key, author, timestamp):
        return {"id": key, "author": author, "authorTimestamp": timestamp, "committerTimestamp": outside}

    monkeypatch.setattr(activity.aqa, "bb_commit_pages", lambda cfg, branch: iter([([
        commit("one", {"name": "QA_USER", "displayName": "Full Name"}, inside),
        commit("two", {"name": "Other Name", "emailAddress": "qa@team.test"}, inside),
        commit("three", {"displayName": "QA_USER", "name": "different_user"}, inside),
        commit("four", {"name": "qa_user"}, outside),
    ], False)]))
    widget = employee(activityPeriod="custom", activityFrom="2026-11-25", activityTimezone="Asia/Shanghai",
                      activityMetrics=["bbCommitCount", "bbCommitList"])
    result = activity._commits(widget, activity.date_range(widget), {"emailAddress": "qa@team.test"})
    assert result["metrics"][0]["value"] == 2
    assert [item["hash"] for item in result["commits"]] == ["one", "two"]


def test_hidden_sources_are_not_called(monkeypatch):
    widget = employee(activityMetrics=["jiraCreated"])
    monkeypatch.setattr(activity, "employee_profile", lambda login: {"displayName": "Имя из Jira"})
    monkeypatch.setattr(activity, "_issue_metrics", lambda widget, window, profile: {"metrics": [{"value": 1}]})

    def unexpected(*args):
        pytest.fail("Пользователь отключил источник")

    monkeypatch.setattr(activity, "_commits", unexpected)
    monkeypatch.setattr(activity, "_assigned_runs", unexpected)
    assert activity.collect(widget, activity.date_range(widget)) == ({"Jira": {"metrics": [{"value": 1}]}}, "Имя из Jira")


def test_zephyr_checks_only_runs_overlapping_the_selected_window(monkeypatch):
    from contextlib import nullcontext

    monkeypatch.setattr(activity, "SessionLocal", lambda: nullcontext(None))
    monkeypatch.setattr(activity.zephyr, "_load_cfg", lambda db: {"base_url": "https://jira.test"})
    def run(key, start, end, assignees):
        return {"key": key, "name": key, "plannedStart": start, "plannedEnd": end, "assignees": assignees}

    records = [
        run("SBER911-C3", "2026-11-23", "2026-11-25", ["qa_user"]),
        run("SBER911-C2", "2026-11-26", "2026-11-28", ["qa_user"]),
        run("SBER911-C1", "2026-11-25", "2026-11-25", ["another_user"]),
    ]
    monkeypatch.setattr(activity.zephyr, "get_index", lambda *args, **kw: {"cases": {row["key"]: row for row in records}})
    widget = employee(activityPeriod="custom", activityFrom="2026-11-25", activityMetrics=["zephyrRunList"])
    data = activity._assigned_runs(widget, activity.date_range(widget), {})
    assert data["metrics"] == []
    assert [run["key"] for run in data["runs"]] == ["SBER911-C3"]


def test_jira_defect_metrics_use_creator_assignee_tester_and_actual_history(monkeypatch):
    from contextlib import nullcontext

    monkeypatch.setattr(activity, "SessionLocal", lambda: nullcontext(None))
    monkeypatch.setattr(activity.jira, "_load_cfg", lambda db: {"issuetype": "Дефект"})
    monkeypatch.setattr(activity.jira, "catalog", lambda db: {"fields": [
        {"id": "customfield_12345", "name": "Тестировщик", "kind": "user"},
        {"id": "customfield_56789", "name": "Аналитик", "kind": "user"},
    ]})
    calls = []

    def record(day, name, field):
        return {"created": day + "T08:00:00.000+0300", "author": {"name": name}, "items": [{"field": field}]}

    history = [
        {"key": "SBER911-1", "changelog": {"total": 2, "histories": [
            record("2026-11-25", "qa_user", "priority"), record("2026-11-25", "qa_user", "assignee"),
        ]}},
        {"key": "SBER911-2", "changelog": {"total": 0, "histories": []}},
        {"key": "SBER911-3", "changelog": {"total": 1, "histories": [record("2026-11-26", "qa_user", "status")]}},
        {"key": "SBER911-4", "changelog": {"total": 1, "histories": [record("2026-11-25", "another", "status")]}},
        {"key": "SBER911-5", "changelog": {"total": 4, "histories": []}},
    ]

    def search(cfg, jql, **options):
        calls.append(jql)
        assert options["validate_query"]
        assert 'issuetype = "Дефект"' in jql
        if options.get("expand") == "changelog":
            return history, len(history)
        return [], 3

    monkeypatch.setattr(activity.jira, "_search", search)
    widget = employee(activityPeriod="custom", activityFrom="2026-11-25",
                      activityMetrics=["jiraCreated", "jiraOpenDefects", "jiraUpdated", "jiraTransitions"])
    created, active, processed = activity._issue_metrics(widget, activity.date_range(widget), {})["metrics"]
    assert 'creator = "qa_user" AND created >= "2026-11-25" AND created < "2026-11-26"' in calls[0]
    assert 'statusCategory != Done AND (assignee = "qa_user" OR cf[12345] = "qa_user")' in calls[1]
    assert [created["value"], active["value"], processed["value"]] == [3, 3, 1]
    assert processed["issueKeys"] == ["SBER911-1"]
    assert processed["partial"] is True
