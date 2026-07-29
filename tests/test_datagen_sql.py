"""Тесты сборки SQL и защит генератора данных."""

import pytest

from agents.datagen_sql import (
    MAX_ROWS_PER_ACTION, SqlBuildError, assert_insert_only, build_insert,
    build_select_by_marker, check_row_limit, check_table_allowed, quote_ident,
    rows_to_params,
)


def test_insert_с_плейсхолдерами():
    sql = build_insert("public.conference", ["name", "created_at"])
    assert sql == 'INSERT INTO "public"."conference" ("name", "created_at") VALUES (?, ?)'


def test_значения_идут_параметрами_а_не_текстом():
    rows = [{"name": "ТЕСТ ТКС-1", "user_id": 5}, {"name": "ТЕСТ ТКС-2", "user_id": 6}]
    assert rows_to_params(rows, ["name", "user_id"]) == [("ТЕСТ ТКС-1", 5), ("ТЕСТ ТКС-2", 6)]


def test_пропущенная_колонка_становится_None():
    assert rows_to_params([{"a": 1}], ["a", "b"]) == [(1, None)]


@pytest.mark.parametrize("bad", [
    'conference"; DROP TABLE users; --',
    "conference; DELETE FROM x",
    "schema.sub.table",
    "conference members",
    "",
    "1abc",
])
def test_инъекция_через_имя_объекта_отклоняется(bad):
    with pytest.raises(SqlBuildError):
        quote_ident(bad)


@pytest.mark.parametrize("sql", [
    "UPDATE conference SET name='x'",
    "DELETE FROM conference",
    "DROP TABLE conference",
    "TRUNCATE conference",
    'INSERT INTO "a" ("b") VALUES (?); DROP TABLE x',
])
def test_всё_кроме_insert_блокируется(sql):
    with pytest.raises(SqlBuildError):
        assert_insert_only(sql)


def test_обычный_insert_проходит_проверку():
    assert_insert_only('INSERT INTO "public"."conference" ("name") VALUES (?)')


def test_лимит_строк_за_нажатие():
    check_row_limit(1)
    check_row_limit(MAX_ROWS_PER_ACTION)
    with pytest.raises(SqlBuildError):
        check_row_limit(MAX_ROWS_PER_ACTION + 1)
    with pytest.raises(SqlBuildError):
        check_row_limit(0)


def test_запись_только_в_разрешённые_таблицы():
    allowed = ["public.conference", "public.conference_members"]
    check_table_allowed("public.conference", allowed)
    with pytest.raises(SqlBuildError):
        check_table_allowed("public.users", allowed)
    # пустой whitelist — запрет по умолчанию, а не разрешение
    with pytest.raises(SqlBuildError):
        check_table_allowed("public.conference", [])


def test_фолбэк_на_поиск_ключа_по_метке():
    sql = build_select_by_marker("public.conference", "id", "name")
    assert sql.startswith('SELECT "id" FROM "public"."conference" WHERE "name" = ?')
    assert "ORDER BY" in sql and "LIMIT 1" in sql
