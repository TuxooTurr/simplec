"""Мок-режим (SHARK_MOCK=1): заготовки внешних сервисов и то, что настоящие данные остаются нетронутыми."""

import json
import os
import subprocess
import sys
from pathlib import Path

import backend.mock as mock
from backend.mock import jira, route

mock.DELAY = 0

ROOT = Path(__file__).resolve().parents[1]


def test_issue_is_deterministic_and_epic_children_link_back():
    a, b = jira.issue("SBER911-17"), jira.issue("SBER911-17")
    assert a["fields"]["summary"] == b["fields"]["summary"]
    assert a["fields"]["issuetype"]["name"] == "Эпик"
    kids = jira.jql_keys('cf[10006] in (SBER911-17)')
    assert kids and all(jira.issue(k)["fields"][jira.F_EPIC_LINK] == "SBER911-17" for k in kids)


def test_jql_by_keys_and_project():
    assert jira.jql_keys("key in (SBER911-1, SBER911-4321)") == ["SBER911-1", "SBER911-4321"]
    assert len(jira.jql_keys("project = SBER911 ORDER BY updated DESC")) >= jira.BASE_COUNT


def test_transition_changes_status_in_memory():
    r = route("POST", "https://jira.example/rest/api/2/issue/SBER911-3/transitions", {}, {"transition": {"id": "10004"}})
    assert r.status == 204
    assert jira.issue("SBER911-3")["fields"]["status"]["name"] == "Готово"


def test_services_are_routed_by_path_not_host():
    assert route("GET", "https://my-stash/rest/api/1.0/projects/P/repos/r/branches", {}, None).body["values"]
    assert route("GET", "https://my-testops/api/rs/launch", {"projectId": 1}, None).body["content"]
    assert route("GET", "https://my-confluence/rest/api/content/123", {}, None).body["id"] == "123"
    assert route("GET", "https://ci/job/X/api/json", {}, None).body["builds"]


def test_unknown_endpoint_is_a_clear_501():
    r = route("GET", "https://jira.example/rest/unknown/thing", {}, None)
    assert r.status == 501 and "нет заготовки" in r.body["message"]


def test_app_in_mock_mode_uses_own_data_dir(tmp_path):
    """Отдельным процессом: флаг читается при импорте. Данные и база — только в SHARK_DATA_DIR, в сеть — ничего."""
    script = (
        "from fastapi.testclient import TestClient\n"
        "from backend.main import app\n"
        "import db.postgres as p, json\n"
        "c = TestClient(app)\n"
        "t = c.post('/api/auth/login', json={'login': 'Sber911', 'password': '1234567'}).json()['token']\n"
        "h = {'Authorization': 'Bearer ' + t}\n"
        "out = {'db': p.DATABASE_URL,\n"
        "       'providers': c.get('/api/system/providers', headers=h).json(),\n"
        "       'commits': c.get('/api/aqa/commits', headers=h).status_code,\n"
        "       'search': c.post('/api/jira/tool/search', headers=h, json={'jql': 'project = SBER911', 'limit': 5}).json()}\n"
        "print('RESULT' + json.dumps(out, ensure_ascii=False))\n"
    )
    env = {**os.environ, "SHARK_MOCK": "1", "SHARK_DATA_DIR": str(tmp_path), "SHARK_MOCK_DELAY": "0"}
    proc = subprocess.run([sys.executable, "-c", script], cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)
    line = next((x for x in proc.stdout.splitlines() if x.startswith("RESULT")), "")
    assert line, proc.stderr[-2000:]
    out = json.loads(line[len("RESULT"):])
    assert str(tmp_path) in out["db"]
    assert all(p["status"] == "green" for p in out["providers"])
    assert out["commits"] == 200
    assert len(out["search"]["issues"]) == 5
