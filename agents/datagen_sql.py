"""
Сборка SQL для генератора данных.

Только построение выражений и проверки — исполнение и транзакции живут в
backend/api/datagen.py. Разделение намеренное: всё, что здесь, тестируется
без живой базы.

Главное правило: генератор умеет ТОЛЬКО вставлять. Ни UPDATE, ни DELETE, ни
DDL здесь не собираются и не пропускаются — отдельная проверка на выходе
ловит попытку протащить их через имя таблицы или колонки.
"""

import re
from typing import Any, Iterable, Optional

# Имя таблицы/колонки: буквы, цифры, _ и одна точка-разделитель схемы.
# Кавычки, пробелы, ; и скобки исключены — через них уходит инъекция.
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Ключевые слова, которых не должно быть в собранном запросе.
_FORBIDDEN = re.compile(
    r"\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|MERGE|CALL|EXEC(UTE)?)\b",
    re.IGNORECASE,
)

MAX_ROWS_PER_RUN = 1000     # потолок строк за один прогон
MAX_ROWS_PER_ACTION = 500   # потолок строк за одно нажатие кнопки


class SqlBuildError(ValueError):
    """Некорректный идентификатор или превышен лимит — до обращения к БД."""


def quote_ident(name: str, quote: str = '"') -> str:
    """Экранирует имя таблицы/колонки, проверяя каждую часть.

    Имена приходят из интроспекции самой БД, но пользователь может подсунуть
    своё через настройки — поэтому проверяем, а не доверяем.
    """
    if not name or not isinstance(name, str):
        raise SqlBuildError("Пустое имя объекта")
    parts = name.split(".")
    if len(parts) > 2:
        raise SqlBuildError(f"Недопустимое имя: {name!r}")
    for p in parts:
        if not _IDENT.match(p):
            raise SqlBuildError(f"Недопустимый идентификатор: {p!r}")
    return ".".join(f"{quote}{p}{quote}" for p in parts)


def build_insert(table: str, columns: Iterable[str], quote: str = '"') -> str:
    """INSERT с плейсхолдерами — значения передаются параметрами, не в текст."""
    cols = list(columns)
    if not cols:
        raise SqlBuildError("Нет колонок для вставки")
    table_sql = quote_ident(table, quote)
    cols_sql = ", ".join(quote_ident(c, quote) for c in cols)
    marks = ", ".join("?" for _ in cols)
    sql = f"INSERT INTO {table_sql} ({cols_sql}) VALUES ({marks})"
    assert_insert_only(sql)
    return sql


def build_select_by_marker(table: str, pk_column: str, marker_column: str,
                           quote: str = '"', limit: int = 1) -> str:
    """Фолбэк для получения ключа только что вставленной строки.

    Нужен там, где драйвер не отдаёт getGeneratedKeys (частый случай на Oracle):
    ищем свежую строку по тест-метке и забираем её первичный ключ.
    """
    sql = (f"SELECT {quote_ident(pk_column, quote)} FROM {quote_ident(table, quote)} "
           f"WHERE {quote_ident(marker_column, quote)} = ? "
           f"ORDER BY {quote_ident(pk_column, quote)} DESC")
    return sql if limit <= 0 else f"{sql} LIMIT {int(limit)}"


def build_select_options(table: str, id_column: str, label_column: str,
                         quote: str = '"', limit: int = 500) -> str:
    """Список записей для выпадающего списка: id + подпись."""
    return (f"SELECT {quote_ident(id_column, quote)}, {quote_ident(label_column, quote)} "
            f"FROM {quote_ident(table, quote)} "
            f"ORDER BY {quote_ident(id_column, quote)} DESC LIMIT {int(limit)}")


def build_count_children(child_table: str, fk_column: str, quote: str = '"',
                         marker_column: str = "") -> str:
    """Сколько строк-детей уже привязано к родителю.

    marker_column задан — считаем только помеченные тестовые: чужих участников
    в чужой ТКС мы не считаем своими и не трогаем.
    """
    sql = (f"SELECT COUNT(*) FROM {quote_ident(child_table, quote)} "
           f"WHERE {quote_ident(fk_column, quote)} = ?")
    if marker_column:
        sql += f" AND {quote_ident(marker_column, quote)} LIKE ?"
    return sql


def build_select_children_ids(child_table: str, id_column: str, fk_column: str,
                              quote: str = '"', marker_column: str = "",
                              limit: int = 500) -> str:
    """Идентификаторы детей — чтобы удалять адресно, а не условием по таблице."""
    sql = (f"SELECT {quote_ident(id_column, quote)} FROM {quote_ident(child_table, quote)} "
           f"WHERE {quote_ident(fk_column, quote)} = ?")
    if marker_column:
        sql += f" AND {quote_ident(marker_column, quote)} LIKE ?"
    return sql + f" ORDER BY {quote_ident(id_column, quote)} DESC LIMIT {int(limit)}"


def build_update_column(table: str, column: str, key_column: str,
                        quote: str = '"', allowed_columns: Optional[Iterable[str]] = None) -> str:
    """UPDATE ровно одной колонки по первичному ключу.

    Колонка обязана быть в allowed_columns: генератор правит существующие —
    возможно боевые — записи, и менять он вправе только счётчик участников.
    WHERE только по ключу: условие без ключа задело бы всю таблицу.
    """
    allowed = set(allowed_columns or [])
    if not allowed:
        raise SqlBuildError("Не задан список колонок, разрешённых к обновлению")
    if column not in allowed:
        raise SqlBuildError(f"Колонку {column!r} обновлять нельзя. Разрешены: {sorted(allowed)}")
    sql = (f"UPDATE {quote_ident(table, quote)} SET {quote_ident(column, quote)} = ? "
           f"WHERE {quote_ident(key_column, quote)} = ?")
    assert_safe_update(sql)
    return sql


def build_delete_by_ids(table: str, id_column: str, ids: list, quote: str = '"') -> str:
    """DELETE строго по перечню идентификаторов.

    Никаких условий вида «по родителю» или «по метке» в самом DELETE: список id
    заранее получен отдельным SELECT и проверен. Ошибка в условии здесь стоила бы
    удалённых чужих строк.
    """
    if not ids:
        raise SqlBuildError("Не указаны строки для удаления")
    if len(ids) > MAX_ROWS_PER_ACTION:
        raise SqlBuildError(f"За раз можно удалить не больше {MAX_ROWS_PER_ACTION} строк")
    marks = ", ".join("?" for _ in ids)
    sql = (f"DELETE FROM {quote_ident(table, quote)} "
           f"WHERE {quote_ident(id_column, quote)} IN ({marks})")
    assert_safe_delete(sql)
    return sql


def assert_safe_update(sql: str) -> None:
    """UPDATE допустим только с WHERE и без вложенных выражений."""
    cleaned = (sql or "").strip()
    if not re.match(r"^\s*UPDATE\s+", cleaned, re.IGNORECASE):
        raise SqlBuildError("Ожидался UPDATE")
    if not re.search(r"\bWHERE\b", cleaned, re.IGNORECASE):
        raise SqlBuildError("UPDATE без WHERE запрещён — задело бы всю таблицу")
    if ";" in cleaned.rstrip(";"):
        raise SqlBuildError("Несколько выражений в одном запросе запрещены")
    if re.search(r"\b(DELETE|DROP|TRUNCATE|ALTER|CREATE|INSERT)\b", cleaned, re.IGNORECASE):
        raise SqlBuildError("Посторонняя операция внутри UPDATE")


def assert_safe_delete(sql: str) -> None:
    """DELETE допустим только с WHERE ... IN (...) по идентификаторам."""
    cleaned = (sql or "").strip()
    if not re.match(r"^\s*DELETE\s+FROM\s+", cleaned, re.IGNORECASE):
        raise SqlBuildError("Ожидался DELETE FROM")
    if not re.search(r"\bWHERE\b.+\bIN\s*\(", cleaned, re.IGNORECASE):
        raise SqlBuildError("DELETE разрешён только по перечню идентификаторов")
    if ";" in cleaned.rstrip(";"):
        raise SqlBuildError("Несколько выражений в одном запросе запрещены")
    if re.search(r"\b(UPDATE|DROP|TRUNCATE|ALTER|CREATE|INSERT)\b", cleaned, re.IGNORECASE):
        raise SqlBuildError("Посторонняя операция внутри DELETE")


def assert_insert_only(sql: str) -> None:
    """Последний барьер перед отправкой в БД.

    Проверка отдельная от валидатора SELECT-режима в testdata.py: там логика
    обратная (пропускать только чтение), и переиспользовать её наоборот нельзя.
    """
    cleaned = (sql or "").strip()
    if not cleaned:
        raise SqlBuildError("Пустой запрос")
    if not re.match(r"^\s*INSERT\s+INTO\b", cleaned, re.IGNORECASE):
        raise SqlBuildError("Генератор данных выполняет только INSERT")
    if ";" in cleaned.rstrip(";"):
        raise SqlBuildError("Несколько выражений в одном запросе запрещены")
    found = _FORBIDDEN.search(cleaned)
    if found:
        raise SqlBuildError(f"Запрещённое ключевое слово: {found.group(0).upper()}")


def check_row_limit(count: int, per_action: bool = True) -> None:
    limit = MAX_ROWS_PER_ACTION if per_action else MAX_ROWS_PER_RUN
    if count < 1:
        raise SqlBuildError("Количество строк должно быть больше нуля")
    if count > limit:
        raise SqlBuildError(f"За раз можно вставить не больше {limit} строк (запрошено {count})")


def check_table_allowed(table: str, whitelist: Optional[Iterable[str]]) -> None:
    """Писать можно только в таблицы, явно разрешённые на подключении.

    Без этого опечатка в настройке отправила бы строки в соседнюю — возможно,
    боевую — таблицу той же схемы.
    """
    allowed = set(whitelist or [])
    if not allowed:
        raise SqlBuildError("Для подключения не задан список разрешённых таблиц")
    if table not in allowed:
        raise SqlBuildError(f"Таблица {table!r} не разрешена для записи")


def rows_to_params(rows: list[dict[str, Any]], columns: list[str]) -> list[tuple]:
    """Строки-словари → кортежи параметров в порядке колонок."""
    return [tuple(r.get(c) for c in columns) for r in rows]
