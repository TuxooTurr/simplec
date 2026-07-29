"""
Исполнитель генератора данных.

Отвечает за одно: выполнить действие («добавить ТКС», «добавить участников»)
в транзакции и вернуть, что получилось. Работа с конкретным драйвером
спрятана за узким интерфейсом соединения (DB-API + .jconn), поэтому логика
проверяется на фейковом соединении, без живой базы.

Гарантии:
  * только INSERT — проверяется на каждом запросе перед отправкой;
  * всё действие в одной транзакции: ошибка на любой строке → откат целиком,
    иначе остались бы ТКС без участников;
  * ключ вставленной строки достаётся через getGeneratedKeys, а если драйвер
    его не отдаёт — поиском по тест-метке; это и есть причина, по которой
    метка обязательна.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from agents.datagen_sql import (
    SqlBuildError, build_insert, build_select_by_marker, check_row_limit,
    check_table_allowed, rows_to_params,
)
from agents.datagen_values import build_row, ensure_marker_present

logger = logging.getLogger(__name__)


@dataclass
class ActionResult:
    table: str
    inserted: int = 0
    keys: list = field(default_factory=list)      # первичные ключи вставленных строк
    rows: list = field(default_factory=list)      # что именно вставили (для журнала и превью)
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error


def plan_action(action: dict, parent_values: Optional[dict] = None,
                marker: str = "ТЕСТ", rnd=None) -> list[dict]:
    """Строки, которые уйдут в БД. Ничего не пишет — основа предпросмотра.

    Предпросмотр обязателен перед первым запуском: пользователь должен увидеть
    конкретные значения до того, как они попадут в таблицу.
    """
    count = int(action.get("count", 1))
    check_row_limit(count, per_action=True)
    rules = action.get("rules") or {}
    if not rules:
        raise SqlBuildError("Для действия не заданы правила заполнения колонок")
    if not ensure_marker_present(rules, marker):
        raise SqlBuildError(
            "В правилах нет тест-метки. Без неё сгенерированные строки не отличить "
            "от боевых и нельзя удалить за собой — добавьте {marker} в одно из полей"
        )
    return [build_row(rules, index=i, parent_values=parent_values, marker=marker, rnd=rnd)
            for i in range(count)]


def _fetch_generated_keys(cursor) -> list:
    """Ключи, выданные базой при вставке. Драйвер вправе не поддерживать —
    тогда возвращаем пусто и уходим на поиск по метке."""
    try:
        rs = cursor._prep.getGeneratedKeys()
    except Exception:
        return []
    keys = []
    try:
        while rs.next():
            keys.append(rs.getObject(1))
    except Exception:
        return []
    finally:
        try:
            rs.close()
        except Exception:
            pass
    return keys


def _find_key_by_marker(conn, table: str, pk_column: str,
                        marker_column: str, marker_value: Any) -> list:
    """Фолбэк: ищем свежую строку по значению тест-метки."""
    cur = conn.cursor()
    try:
        cur.execute(build_select_by_marker(table, pk_column, marker_column), [marker_value])
        row = cur.fetchone()
        return [row[0]] if row else []
    except Exception as e:
        logger.warning("Не удалось найти ключ по метке в %s: %s", table, e)
        return []
    finally:
        try:
            cur.close()
        except Exception:
            pass


def execute_action(conn, action: dict, *, allowed_tables, parent_values=None,
                   marker: str = "ТЕСТ", pk_column: str = "", marker_column: str = "",
                   rnd=None) -> ActionResult:
    """Выполняет одно действие в транзакции.

    conn — соединение jaydebeapi. Автокоммит снимается на время действия и
    возвращается как был: соединение может переиспользоваться другими режимами.
    """
    table = action.get("table", "")
    result = ActionResult(table=table)

    try:
        check_table_allowed(table, allowed_tables)
        rows = plan_action(action, parent_values=parent_values, marker=marker, rnd=rnd)
    except SqlBuildError as e:
        result.error = str(e)
        return result

    columns = sorted({c for r in rows for c in r})
    sql = build_insert(table, columns)          # внутри — проверка «только INSERT»
    params = rows_to_params(rows, columns)

    jconn = getattr(conn, "jconn", None)
    prev_autocommit = None
    if jconn is not None:
        try:
            prev_autocommit = jconn.getAutoCommit()
            jconn.setAutoCommit(False)
        except Exception:
            prev_autocommit = None

    cur = conn.cursor()
    try:
        cur.executemany(sql, params)
        keys = _fetch_generated_keys(cur)

        # Драйвер ключей не дал — достаём по метке, если знаем где искать.
        if not keys and pk_column and marker_column:
            marker_value = rows[0].get(marker_column)
            if marker_value is not None:
                keys = _find_key_by_marker(conn, table, pk_column, marker_column, marker_value)

        conn.commit()
        result.inserted = len(rows)
        result.rows = rows
        result.keys = keys
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            logger.exception("Откат не удался для %s", table)
        result.error = f"{type(e).__name__}: {str(e)[:300]}"
    finally:
        try:
            cur.close()
        except Exception:
            pass
        if jconn is not None and prev_autocommit is not None:
            try:
                jconn.setAutoCommit(prev_autocommit)
            except Exception:
                pass

    return result
