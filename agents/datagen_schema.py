"""
Разбор схемы БД для генератора данных.

Работает поверх результата introspect_schema (backend/api/db_connector.py):
схема уже прочитана из самой БД через JDBC-метаданные, поэтому здесь только
чистая логика — ни подключений, ни SQL. Благодаря этому модуль тестируется
без живой базы.

Основное:
  * граф зависимостей по внешним ключам;
  * порядок вставки (родители раньше детей) с детектированием циклов;
  * какие колонки обязан заполнить пользователь, а какие проставит сама БД.
"""

from dataclasses import dataclass, field
from typing import Iterable, Optional

# Колонку заполняет БД: автоинкремент или default на стороне сервера.
# Такие поля не требуем от пользователя — иначе форма попросит заполнить id.
FILLED_BY_DB = "db"
# Обязательна к заполнению: NOT NULL, без default, не автоинкремент.
REQUIRED = "required"
# Можно не заполнять — NULL допустим.
OPTIONAL = "optional"


@dataclass
class Column:
    name: str
    type: str = ""
    nullable: bool = True
    default: Optional[str] = None
    pk: bool = False
    autoincrement: bool = False
    unique: bool = False
    fk: Optional[dict] = None          # {"table": "схема.таблица", "column": "id"}

    @classmethod
    def from_raw(cls, raw: dict) -> "Column":
        return cls(
            name=raw.get("name", ""),
            type=raw.get("type", "") or "",
            nullable=bool(raw.get("nullable", True)),
            default=raw.get("default"),
            pk=bool(raw.get("pk", False)),
            autoincrement=bool(raw.get("autoincrement", False)),
            unique=bool(raw.get("unique", False)),
            fk=raw.get("fk") or None,
        )

    @property
    def fill_mode(self) -> str:
        """Кто отвечает за значение колонки."""
        if self.autoincrement or self.default is not None:
            return FILLED_BY_DB
        if self.nullable:
            return OPTIONAL
        return REQUIRED


@dataclass
class Table:
    name: str                                   # "схема.таблица"
    columns: list[Column] = field(default_factory=list)

    @property
    def pk_columns(self) -> list[Column]:
        return [c for c in self.columns if c.pk]

    @property
    def fk_columns(self) -> list[Column]:
        return [c for c in self.columns if c.fk]

    def column(self, name: str) -> Optional[Column]:
        return next((c for c in self.columns if c.name == name), None)

    def required_columns(self) -> list[Column]:
        """Что пользователь обязан заполнить, чтобы INSERT не упал.

        FK-колонки исключены: их значение подставляет генератор из родителя.
        """
        return [c for c in self.columns if c.fill_mode == REQUIRED and not c.fk]

    def parents(self) -> set[str]:
        """Таблицы, на которые ссылается эта (по внешним ключам). Самоссылки
        не считаем зависимостью: иначе таблица «дерева» блокировала бы сама себя."""
        return {c.fk["table"] for c in self.fk_columns
                if c.fk.get("table") and c.fk["table"] != self.name}


class SchemaGraph:
    """Граф таблиц и связей, построенный по внешним ключам."""

    def __init__(self, raw_schema: dict):
        self.tables: dict[str, Table] = {
            name: Table(name=name, columns=[Column.from_raw(c) for c in (cols or [])])
            for name, cols in (raw_schema or {}).items()
        }

    def __contains__(self, name: str) -> bool:
        return name in self.tables

    def get(self, name: str) -> Optional[Table]:
        return self.tables.get(name)

    def children_of(self, name: str) -> list[str]:
        """Таблицы, ссылающиеся на указанную, — то есть её «участники»."""
        return sorted(t.name for t in self.tables.values() if name in t.parents())

    def link_between(self, parent: str, child: str) -> Optional[Column]:
        """FK-колонка дочерней таблицы, ведущая на родителя."""
        t = self.tables.get(child)
        if not t:
            return None
        return next((c for c in t.fk_columns if c.fk.get("table") == parent), None)

    def missing_parents(self, names: Iterable[str]) -> dict[str, set[str]]:
        """Зависимости выбранных таблиц, которые пользователь не выбрал.

        Вставка ребёнка без родителя упадёт по внешнему ключу — предупреждаем
        до запуска, а не ловим отказ на середине пачки.
        """
        chosen = set(names)
        out: dict[str, set[str]] = {}
        for n in chosen:
            t = self.tables.get(n)
            if not t:
                continue
            gap = {p for p in t.parents() if p not in chosen and p in self.tables}
            if gap:
                out[n] = gap
        return out

    def insertion_order(self, names: Iterable[str]) -> tuple[list[str], list[str]]:
        """Порядок вставки: родители раньше детей.

        Возвращает (порядок, цикл). Цикл — таблицы с круговыми внешними ключами:
        разорвать его автоматически нельзя, потому что любая из вставок нарушит
        ограничение. Такие таблицы отдаём наверх, чтобы показать понятную ошибку.
        """
        chosen = [n for n in dict.fromkeys(names) if n in self.tables]
        deps = {n: {p for p in self.tables[n].parents() if p in chosen} for n in chosen}

        order: list[str] = []
        done: set[str] = set()
        # Стабильность: при равных зависимостях сохраняем порядок выбора.
        while True:
            ready = [n for n in chosen if n not in done and deps[n] <= done]
            if not ready:
                break
            order.extend(ready)
            done.update(ready)

        cycle = [n for n in chosen if n not in done]
        return order, cycle
