"""Синхронизация участников ТКС на фейковой БД."""

import random

import pytest

from agents.datagen_presets import SYNC_TCS
from agents.datagen_sql import (
    SqlBuildError, assert_safe_delete, assert_safe_update, build_delete_by_ids,
    build_update_column,
)
from agents.datagen_sync import list_parents, plan_sync, sync_members

RND = lambda: random.Random(20260729)


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._rows = []

    def execute(self, sql, params=None):
        params = list(params or [])
        self.conn.log.append((sql, params))
        low = sql.lower()
        if low.startswith("select") and "count(*)" in low:
            self._rows = [(self.conn.total_children,)]
        elif low.startswith("select") and '"id"' in low and '"tcsmember"' in low:
            self._rows = [(i,) for i in self.conn.own_ids]
        elif low.startswith("select"):
            self._rows = list(self.conn.parents)
        elif low.startswith("delete"):
            self.conn.deleted += len(params)
        elif low.startswith("update"):
            self.conn.updated_to = params[0]

    def executemany(self, sql, params):
        if self.conn.fail_on_insert:
            raise RuntimeError("нарушение ограничения")
        self.conn.log.append((sql, list(params)))
        self.conn.inserted += len(list(params))

    def fetchall(self):
        return self._rows

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
    def __init__(self, own_ids=(), total_children=0, fail_on_insert=False):
        self.jconn = FakeJConn()
        self.own_ids = list(own_ids)
        self.total_children = total_children
        self.parents = [(4374, "3117 - Сервисы"), (128, "ВКС по инциденту")]
        self.log = []
        self.inserted = 0
        self.deleted = 0
        self.updated_to = None
        self.committed = 0
        self.rolled_back = 0
        self.fail_on_insert = fail_on_insert

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1


def test_список_ткс_для_выпадающего_списка():
    conn = FakeConn()
    assert list_parents(conn, SYNC_TCS) == [(4374, "3117 - Сервисы"), (128, "ВКС по инциденту")]


def test_план_добавления():
    conn = FakeConn(own_ids=[1, 2], total_children=2)
    plan = plan_sync(conn, SYNC_TCS, parent_id=4374, target=5)
    assert (plan.current, plan.to_insert, plan.to_delete) == (2, 3, 0)
    assert plan.update_count_to == 5
    assert "добавить 3" in plan.describe()


def test_план_удаления():
    conn = FakeConn(own_ids=[1, 2, 3, 4, 5], total_children=5)
    plan = plan_sync(conn, SYNC_TCS, parent_id=4374, target=2)
    assert (plan.to_insert, plan.to_delete) == (0, 3)
    assert plan.update_count_to == 2


def test_добавление_вставляет_и_обновляет_счётчик():
    conn = FakeConn(own_ids=[1], total_children=1)
    res = sync_members(conn, SYNC_TCS, parent_id=4374, target=4, rnd=RND())
    assert res.ok and res.inserted == 3 and res.deleted == 0
    assert res.count_updated and conn.updated_to == 4
    assert conn.committed == 1
    assert all(r["tcs"] == 4374 for r in res.rows)


def test_удаление_удаляет_только_своих():
    """Чужие участники (без метки) в own_ids не попадают, значит не удаляются."""
    conn = FakeConn(own_ids=[10, 11, 12], total_children=8)   # всего 8, наших 3
    res = sync_members(conn, SYNC_TCS, parent_id=4374, target=1, rnd=RND())
    assert res.ok and res.deleted == 2 and res.inserted == 0
    # счётчик = всего − удалённые, чужие остаются учтёнными
    assert conn.updated_to == 6


def test_ошибка_откатывает_всю_синхронизацию():
    """Иначе счётчик разошёлся бы с фактическим числом строк."""
    conn = FakeConn(own_ids=[], total_children=0, fail_on_insert=True)
    res = sync_members(conn, SYNC_TCS, parent_id=4374, target=3, rnd=RND())
    assert not res.ok
    assert conn.rolled_back == 1 and conn.committed == 0
    assert res.inserted == 0 and not res.count_updated


def test_обновляется_только_разрешённая_колонка():
    with pytest.raises(SqlBuildError, match="обновлять нельзя"):
        build_update_column("tcs", "nm", "id", allowed_columns=["cnt"])
    sql = build_update_column("tcs", "cnt", "id", allowed_columns=["cnt"])
    assert sql == 'UPDATE "tcs" SET "cnt" = ? WHERE "id" = ?'


def test_update_без_where_запрещён():
    with pytest.raises(SqlBuildError, match="без WHERE"):
        assert_safe_update('UPDATE "tcs" SET "cnt" = 0')


def test_delete_только_по_перечню_идентификаторов():
    sql = build_delete_by_ids("tcsmember", "id", [1, 2, 3])
    assert sql == 'DELETE FROM "tcsmember" WHERE "id" IN (?, ?, ?)'
    with pytest.raises(SqlBuildError):
        assert_safe_delete('DELETE FROM "tcsmember" WHERE "tcs" = 4374')   # условием по родителю
    with pytest.raises(SqlBuildError):
        build_delete_by_ids("tcsmember", "id", [])                          # без списка


def test_отрицательное_количество_отклоняется():
    conn = FakeConn()
    assert not plan_sync(conn, SYNC_TCS, parent_id=1, target=-1).ok


def test_чужая_таблица_не_синхронизируется():
    cfg = {**SYNC_TCS, "child_table": "users"}
    conn = FakeConn()
    assert "не разрешена" in plan_sync(conn, cfg, parent_id=1, target=1).error


def test_ноль_участников_удаляет_всех_своих():
    conn = FakeConn(own_ids=[1, 2], total_children=2)
    res = sync_members(conn, SYNC_TCS, parent_id=4374, target=0, rnd=RND())
    assert res.ok and res.deleted == 2 and conn.updated_to == 0
