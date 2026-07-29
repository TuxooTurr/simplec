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
