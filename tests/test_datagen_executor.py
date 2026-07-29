"""Тесты исполнителя на фейковом соединении — без живой БД."""

import random

import pytest

from agents.datagen_executor import execute_action, plan_action
from agents.datagen_sql import SqlBuildError

ALLOWED = ["public.conference", "public.conference_members"]

CONF_ACTION = {
    "label": "Добавить ТКС",
    "table": "public.conference",
    "count": 2,
    "rules": {
        "name": {"rule": "pattern", "value": "{marker} ТКС-{n}"},
        "status": {"rule": "const", "value": "active"},
    },
}


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._prep = None
        self._rows = []

    def executemany(self, sql, params):
        if self.conn.fail_on_insert:
            raise RuntimeError("нарушение ограничения")
        self.conn.executed.append((sql, list(params)))

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, list(params or [])))
        self._rows = [(555,)] if self.conn.marker_lookup_returns else []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def close(self):
        pass


class FakeJConn:
    def __init__(self):
        self.autocommit = True

    def getAutoCommit(self):
        return self.autocommit

    def setAutoCommit(self, v):
        self.autocommit = v


class FakeConn:
    """Минимальный аналог jaydebeapi-соединения."""

    def __init__(self, fail_on_insert=False, marker_lookup_returns=False):
        self.jconn = FakeJConn()
        self.executed = []
        self.committed = 0
        self.rolled_back = 0
        self.fail_on_insert = fail_on_insert
        self.marker_lookup_returns = marker_lookup_returns

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1


def test_предпросмотр_показывает_строки_и_ничего_не_пишет():
    rows = plan_action(CONF_ACTION)
    assert [r["name"] for r in rows] == ["ТЕСТ ТКС-1", "ТЕСТ ТКС-2"]
    assert all(r["status"] == "active" for r in rows)


def test_без_тест_метки_действие_отклоняется():
    action = {**CONF_ACTION, "rules": {"name": {"rule": "pattern", "value": "ТКС-{n}"}}}
    with pytest.raises(SqlBuildError, match="тест-метк"):
        plan_action(action)


def test_успешная_вставка_коммитится():
    conn = FakeConn()
    res = execute_action(conn, CONF_ACTION, allowed_tables=ALLOWED)
    assert res.ok and res.inserted == 2
    assert conn.committed == 1 and conn.rolled_back == 0
    sql, params = conn.executed[0]
    assert sql.startswith('INSERT INTO "public"."conference"')
    assert len(params) == 2


def test_ошибка_откатывает_всё_действие():
    """Иначе осталась бы ТКС без участников."""
    conn = FakeConn(fail_on_insert=True)
    res = execute_action(conn, CONF_ACTION, allowed_tables=ALLOWED)
    assert not res.ok
    assert conn.rolled_back == 1 and conn.committed == 0
    assert res.inserted == 0


def test_чужая_таблица_не_пишется():
    conn = FakeConn()
    res = execute_action(conn, {**CONF_ACTION, "table": "public.users"}, allowed_tables=ALLOWED)
    assert not res.ok and "не разрешена" in res.error
    assert conn.executed == []


def test_ключ_ищется_по_метке_если_драйвер_его_не_отдал():
    conn = FakeConn(marker_lookup_returns=True)
    res = execute_action(conn, {**CONF_ACTION, "count": 1}, allowed_tables=ALLOWED,
                         pk_column="id", marker_column="name")
    assert res.ok and res.keys == [555]
    assert any("SELECT" in sql for sql, _ in conn.executed)


def test_участники_получают_ключ_родителя():
    members = {
        "label": "Добавить участников",
        "table": "public.conference_members",
        "count": 3,
        "rules": {
            "conference_id": {"rule": "from_parent"},
            "user_name": {"rule": "pattern", "value": "{marker} Участник-{n}"},
        },
    }
    conn = FakeConn()
    res = execute_action(conn, members, allowed_tables=ALLOWED,
                         parent_values={"conference_id": 42})
    assert res.ok and res.inserted == 3
    assert all(r["conference_id"] == 42 for r in res.rows)


def test_автокоммит_возвращается_как_был():
    conn = FakeConn()
    assert conn.jconn.getAutoCommit() is True
    execute_action(conn, CONF_ACTION, allowed_tables=ALLOWED)
    assert conn.jconn.getAutoCommit() is True


def test_превышение_лимита_строк():
    conn = FakeConn()
    res = execute_action(conn, {**CONF_ACTION, "count": 10_000}, allowed_tables=ALLOWED)
    assert not res.ok and "не больше" in res.error
    assert conn.executed == []


def test_одинаковый_seed_даёт_одинаковые_строки():
    a = plan_action({**CONF_ACTION, "rules": {
        "name": {"rule": "pattern", "value": "{marker}-{rnd}"}}}, rnd=random.Random(1))
    b = plan_action({**CONF_ACTION, "rules": {
        "name": {"rule": "pattern", "value": "{marker}-{rnd}"}}}, rnd=random.Random(1))
    assert a == b
