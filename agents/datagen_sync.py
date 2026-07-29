"""
Синхронизация участников ТКС.

Пользователь выбирает существующую ТКС и говорит, сколько в ней должно быть
участников. Дальше считается разница и выполняется минимум действий:
добавить недостающих, удалить лишних, обновить счётчик в родительской строке.

Всё — одной транзакцией: иначе в tcs.cnt осталось бы число, не совпадающее
с фактическим количеством строк в tcsmember.

Важное ограничение: трогаем только СВОИ строки. Участники без тест-метки
считаются чужими — их не удаляем и не учитываем как свои. ТКС при этом может
быть боевой: её строку мы правим, но лишь в одной разрешённой колонке.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from agents.datagen_sql import (
    SqlBuildError, build_count_children, build_delete_by_ids, build_insert,
    build_select_children_ids, build_select_options, build_update_column,
    check_row_limit, check_table_allowed, rows_to_params,
)
from agents.datagen_values import build_row, ensure_marker_present

logger = logging.getLogger(__name__)


@dataclass
class SyncPlan:
    """Что произойдёт. Показывается пользователю до запуска."""
    parent_id: Any
    current: int = 0
    target: int = 0
    to_insert: int = 0
    to_delete: int = 0
    update_count_to: int = 0
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error

    def describe(self) -> str:
        if self.error:
            return self.error
        parts = []
        if self.to_insert:
            parts.append(f"добавить {self.to_insert}")
        if self.to_delete:
            parts.append(f"удалить {self.to_delete}")
        parts.append(f"счётчик → {self.update_count_to}")
        return ", ".join(parts)


@dataclass
class SyncResult:
    inserted: int = 0
    deleted: int = 0
    count_updated: bool = False
    error: str = ""
    rows: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.error


def list_parents(conn, cfg: dict, limit: int = 500) -> list[tuple]:
    """Список ТКС для выпадающего списка: [(id, подпись), …]."""
    sql = build_select_options(cfg["parent_table"], cfg["parent_id_column"],
                               cfg["parent_label_column"], limit=limit)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        return [(r[0], r[1]) for r in (cur.fetchall() or [])]
    finally:
        try:
            cur.close()
        except Exception:
            pass


def _own_children_ids(conn, cfg: dict, parent_id: Any) -> list:
    """Идентификаторы наших (помеченных) участников этой ТКС."""
    marker_col = cfg.get("child_marker_column") or ""
    sql = build_select_children_ids(
        cfg["child_table"], cfg["child_id_column"], cfg["child_fk_column"],
        marker_column=marker_col,
    )
    params: list = [parent_id]
    if marker_col:
        params.append(f"{cfg['marker']}%")
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return [r[0] for r in (cur.fetchall() or [])]
    finally:
        try:
            cur.close()
        except Exception:
            pass


def _total_children(conn, cfg: dict, parent_id: Any) -> int:
    """Сколько всего участников в ТКС — включая чужих: именно это число
    записывается в счётчик, ведь оно отражает реальное состояние."""
    sql = build_count_children(cfg["child_table"], cfg["child_fk_column"])
    cur = conn.cursor()
    try:
        cur.execute(sql, [parent_id])
        row = cur.fetchone()
        return int(row[0]) if row else 0
    finally:
        try:
            cur.close()
        except Exception:
            pass


def plan_sync(conn, cfg: dict, parent_id: Any, target: int) -> SyncPlan:
    """Считает разницу, ничего не меняя."""
    plan = SyncPlan(parent_id=parent_id, target=target)
    try:
        if target < 0:
            raise SqlBuildError("Количество участников не может быть отрицательным")
        check_table_allowed(cfg["child_table"], cfg.get("allowed_tables"))
        check_table_allowed(cfg["parent_table"], cfg.get("allowed_tables"))
        if target:
            check_row_limit(target, per_action=True)

        own = _own_children_ids(conn, cfg, parent_id)
        plan.current = len(own)
        diff = target - plan.current
        plan.to_insert = max(0, diff)
        plan.to_delete = max(0, -diff)

        total = _total_children(conn, cfg, parent_id)
        plan.update_count_to = total + plan.to_insert - plan.to_delete
    except SqlBuildError as e:
        plan.error = str(e)
    except Exception as e:
        plan.error = f"{type(e).__name__}: {str(e)[:200]}"
    return plan


def sync_members(conn, cfg: dict, parent_id: Any, target: int,
                 rnd=None, dry_run: bool = False) -> SyncResult:
    """Приводит число участников к target и обновляет счётчик в родителе."""
    result = SyncResult()
    plan = plan_sync(conn, cfg, parent_id, target)
    if not plan.ok:
        result.error = plan.error
        return result
    if dry_run:
        result.rows = []
        return result

    rules = cfg["child_rules"]
    if not ensure_marker_present(rules, cfg["marker"]):
        result.error = ("В правилах участника нет тест-метки — без неё нельзя "
                        "отличить своих от чужих и безопасно удалять")
        return result

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
        # 1. Добавить недостающих
        if plan.to_insert:
            rows = [build_row(rules, index=i,
                              parent_values={cfg["child_fk_column"]: parent_id},
                              marker=cfg["marker"], rnd=rnd)
                    for i in range(plan.to_insert)]
            columns = sorted({c for r in rows for c in r})
            cur.executemany(build_insert(cfg["child_table"], columns),
                            rows_to_params(rows, columns))
            result.inserted = len(rows)
            result.rows = rows

        # 2. Удалить лишних — только своих, адресно по идентификаторам
        if plan.to_delete:
            own = _own_children_ids(conn, cfg, parent_id)
            victims = own[:plan.to_delete]
            if victims:
                cur.execute(build_delete_by_ids(cfg["child_table"], cfg["child_id_column"], victims),
                            victims)
                result.deleted = len(victims)

        # 3. Обновить счётчик в родителе
        cur.execute(
            build_update_column(cfg["parent_table"], cfg["parent_count_column"],
                                cfg["parent_id_column"],
                                allowed_columns=cfg.get("parent_updatable_columns")),
            [plan.update_count_to, parent_id],
        )
        result.count_updated = True

        conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            logger.exception("Откат не удался при синхронизации ТКС %s", parent_id)
        result.error = f"{type(e).__name__}: {str(e)[:300]}"
        result.inserted = result.deleted = 0
        result.count_updated = False
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
