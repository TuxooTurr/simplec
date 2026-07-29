"""Тесты разбора схемы для генератора данных — без подключения к БД."""

from agents.datagen_schema import (
    FILLED_BY_DB, OPTIONAL, REQUIRED, SchemaGraph,
)


def col(name, **kw):
    base = {"name": name, "type": "varchar", "nullable": True, "default": None,
            "pk": False, "autoincrement": False, "unique": False, "fk": None}
    base.update(kw)
    return base


# Реальный кейс: ТКС и её участники.
SCHEMA = {
    "public.conference": [
        col("id", type="int8", nullable=False, pk=True, autoincrement=True),
        col("name", nullable=False),
        col("created_at", type="timestamp", nullable=False, default="now()"),
        col("description"),
    ],
    "public.conference_members": [
        col("id", type="int8", nullable=False, pk=True, autoincrement=True),
        col("conference_id", type="int8", nullable=False,
            fk={"table": "public.conference", "column": "id"}),
        col("user_id", type="int8", nullable=False),
        col("role", nullable=False, default="'member'"),
    ],
}


def test_связь_читается_из_внешнего_ключа():
    g = SchemaGraph(SCHEMA)
    assert g.children_of("public.conference") == ["public.conference_members"]
    link = g.link_between("public.conference", "public.conference_members")
    assert link.name == "conference_id"
    assert link.fk["column"] == "id"


def test_родитель_вставляется_раньше_ребёнка():
    g = SchemaGraph(SCHEMA)
    # порядок выбора намеренно обратный
    order, cycle = g.insertion_order(["public.conference_members", "public.conference"])
    assert cycle == []
    assert order.index("public.conference") < order.index("public.conference_members")


def test_кто_заполняет_колонку():
    g = SchemaGraph(SCHEMA)
    conf = g.get("public.conference")
    assert conf.column("id").fill_mode == FILLED_BY_DB        # автоинкремент
    assert conf.column("created_at").fill_mode == FILLED_BY_DB  # default
    assert conf.column("name").fill_mode == REQUIRED          # NOT NULL без default
    assert conf.column("description").fill_mode == OPTIONAL   # nullable


def test_от_пользователя_не_требуют_ни_id_ни_fk():
    """id проставит БД, conference_id подставит генератор из родителя."""
    g = SchemaGraph(SCHEMA)
    required = {c.name for c in g.get("public.conference_members").required_columns()}
    assert required == {"user_id"}


def test_предупреждаем_о_невыбранном_родителе():
    g = SchemaGraph(SCHEMA)
    gaps = g.missing_parents(["public.conference_members"])
    assert gaps == {"public.conference_members": {"public.conference"}}
    # оба выбраны — предупреждать не о чем
    assert g.missing_parents(["public.conference", "public.conference_members"]) == {}


def test_циклические_ключи_не_зацикливают_а_возвращаются():
    schema = {
        "a": [col("id", pk=True), col("b_id", fk={"table": "b", "column": "id"})],
        "b": [col("id", pk=True), col("a_id", fk={"table": "a", "column": "id"})],
    }
    order, cycle = SchemaGraph(schema).insertion_order(["a", "b"])
    assert order == []
    assert set(cycle) == {"a", "b"}


def test_самоссылка_не_считается_зависимостью():
    """Дерево (parent_id -> та же таблица) не должно блокировать само себя."""
    schema = {
        "tree": [col("id", pk=True), col("parent_id", fk={"table": "tree", "column": "id"})],
    }
    order, cycle = SchemaGraph(schema).insertion_order(["tree"])
    assert order == ["tree"]
    assert cycle == []


def test_цепочка_из_трёх_уровней():
    schema = {
        "org":  [col("id", pk=True)],
        "conf": [col("id", pk=True), col("org_id", fk={"table": "org", "column": "id"})],
        "memb": [col("id", pk=True), col("conf_id", fk={"table": "conf", "column": "id"})],
    }
    order, cycle = SchemaGraph(schema).insertion_order(["memb", "conf", "org"])
    assert cycle == []
    assert order == ["org", "conf", "memb"]


def test_пустая_схема_не_падает():
    g = SchemaGraph({})
    assert g.insertion_order([]) == ([], [])
    assert g.missing_parents(["нет"]) == {}
