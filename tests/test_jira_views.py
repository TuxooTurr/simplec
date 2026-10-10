"""Jira-аналитика: представления (выборка + группировка + колонки).

Реальной Jira в тестах нет: запросы подменяются, проверяется наша логика —
приведение значений полей к тексту, группировка, постраничная выборка с потолком,
кэш и хранилище представлений.
"""

import pytest

import backend.api.jira_views as JV
from db import jira_views_store as store_mod
from db.jira_views_store import JiraViewsStore


# ── Значения полей ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    (None, ""),
    ("Открыт", "Открыт"),
    (3.0, "3"),
    (2.5, "2.5"),
    (True, "да"),
    ({"displayName": "Иванов Иван", "name": "ivanov"}, "Иванов Иван"),
    ({"name": "Высокий", "id": "2"}, "Высокий"),
    ({"value": "ИФТ"}, "ИФТ"),
    ({"value": "Платёж", "child": {"value": "СБП"}}, "Платёж / СБП"),
    ([{"name": "Back"}, {"name": "Front"}], "Back, Front"),
    (["a", None, "b"], "a, b"),
    ("2026-10-08T14:35:00.000+0300", "2026-10-08 14:35"),
    ("com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=7,name=Спринт 42,state=ACTIVE]", "Спринт 42"),
])
def test_значение_поля_в_текст(raw, expected):
    assert JV.display_value(raw) == expected


def test_строка_таблицы_содержит_ключ_и_ссылку():
    issue = {"key": "SBER911-1", "fields": {"summary": "Падает оплата", "assignee": None}}
    row = JV.issue_to_row(issue, ["key", "summary", "assignee"], "https://jira")
    assert row["url"] == "https://jira/browse/SBER911-1"
    assert row["values"] == {"key": "SBER911-1", "summary": "Падает оплата", "assignee": ""}


# ── Группировка ──────────────────────────────────────────────────────────────

def _row(key, **values):
    return {"key": key, "url": "", "values": values}


ROWS = [
    _row("A-1", tester="Петров", status="Открыт"),
    _row("A-2", tester="Иванов", status="Открыт"),
    _row("A-3", tester="Иванов", status="Закрыт"),
    _row("A-4", tester="", status="Открыт"),
]


def test_без_группировки_плоский_список():
    assert JV.group_rows(ROWS, []) == {"issues": ROWS}


def test_группы_по_убыванию_а_не_задано_в_конце():
    groups = JV.group_rows(ROWS, ["tester"])["groups"]
    assert [(g["value"], g["count"]) for g in groups] == [
        ("Иванов", 2), ("Петров", 1), (JV.EMPTY_VALUE, 1),
    ]


def test_вложенная_группировка():
    ivanov = JV.group_rows(ROWS, ["tester", "status"])["groups"][0]
    assert ivanov["value"] == "Иванов"
    assert [(g["value"], g["count"]) for g in ivanov["groups"]] == [("Закрыт", 1), ("Открыт", 1)]
    assert ivanov["groups"][0]["issues"][0]["key"] == "A-3"


# ── Выборка из Jira ──────────────────────────────────────────────────────────

CFG = {"base_url": "https://jira", "token": "t", "token_path": "", "ssl_verify": False}


class FakeJira:
    """Подмена _jira_request: отдаёт total задач страницами и считает запросы."""

    def __init__(self, total):
        self.total = total
        self.search_calls = []

    def __call__(self, cfg, method, path, params=None, **kw):
        if path == "/rest/api/2/field":
            return [{"id": "summary", "name": "Тема"},
                    {"id": "customfield_1", "name": "Тестировщик", "custom": True,
                     "schema": {"type": "user"}}]
        assert path == "/rest/api/2/search"
        self.search_calls.append(params)
        start = params["startAt"]
        n = max(0, min(params["maxResults"], self.total - start))
        issues = [{"key": f"X-{start + i}",
                   "fields": {"summary": "s", "customfield_1": {"displayName": "Иванов"}}}
                  for i in range(n)]
        return {"total": self.total, "issues": issues}


@pytest.fixture
def fake(monkeypatch):
    def install(total):
        f = FakeJira(total)
        monkeypatch.setattr(JV, "_jira_request", f)
        monkeypatch.setattr(JV, "_load_cfg", lambda db: dict(CFG))
        JV._fields_cache.clear()
        JV._query_cache.clear()
        return f
    return install


def _query(**kw):
    body = {"jql": "project = X", "columns": ["key", "summary"], "group_by": ["customfield_1"]}
    body.update(kw)
    return JV.run_query(JV.QueryBody(**body), db=None)


def test_выборка_группирует_и_подписывает_поля(fake):
    fake(total=3)
    res = _query()
    assert res["total"] == 3 and res["truncated"] is False
    assert res["group_by"] == [{"id": "customfield_1", "name": "Тестировщик"}]
    assert res["groups"][0]["value"] == "Иванов" and res["groups"][0]["count"] == 3


def test_поле_группировки_запрашивается_даже_без_колонки(fake):
    f = fake(total=1)
    _query()
    assert "customfield_1" in f.search_calls[0]["fields"]
    assert "key" not in f.search_calls[0]["fields"].split(",")


def test_потолок_выборки(fake):
    f = fake(total=5000)
    res = _query()
    assert res["loaded"] == JV.MAX_ISSUES
    assert res["truncated"] is True
    assert len(f.search_calls) == JV.MAX_ISSUES // JV._PAGE


def test_кэш_и_обновление_мимо_кэша(fake):
    f = fake(total=1)
    _query()
    _query()
    assert len(f.search_calls) == 1
    _query(refresh=True)
    assert len(f.search_calls) == 2


def test_лимит_уровней_группировки(fake):
    fake(total=1)
    with pytest.raises(JV.HTTPException):
        _query(group_by=["a", "b", "c", "d"])


# ── Хранилище представлений ──────────────────────────────────────────────────

def test_хранилище_создать_обновить_удалить(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_VIEWS_FILE", tmp_path / "jira_views.json")
    v = JiraViewsStore.save_view({"name": "Нагрузка", "jql": "project = X",
                                  "columns": ["key"], "group_by": ["assignee"]})
    assert v["id"].startswith("view-")
    created = v["created_at"]

    JiraViewsStore.save_view({**v, "name": "Нагрузка QA"})
    views = JiraViewsStore.list_views()
    assert len(views) == 1
    assert views[0]["name"] == "Нагрузка QA" and views[0]["created_at"] == created

    assert JiraViewsStore.delete_view(v["id"]) is True
    assert JiraViewsStore.delete_view(v["id"]) is False
