"""
Единая точка подключения к внешним БД — через JDBC (jaydebeapi + JPype),
как в DBeaver. Используется и «Тестовыми данными» (testdata.py), и «Джобами»
(jobs.py), так как оба ссылаются на один и тот же реестр подключений
(db/testdata_connections.py) и один и тот же реестр драйверов
(db/jdbc_drivers_store.py).

Почему JDBC для всех типов (включая PostgreSQL/MySQL/Oracle), а не нативные
Python-драйверы: единообразие с DBeaver и с реестром «свой драйвер» — все БД
подключаются одинаково: класс драйвера + .jar-библиотека + шаблон URL.

Важное ограничение JPype: JVM запускается один раз за процесс, classpath
фиксируется при старте. Драйвер, у которого библиотека добавлена ПОСЛЕ
первого запуска JVM, начнёт работать только после перезапуска бэкенда.
"""

import threading

from db.jdbc_drivers_store import JdbcDriversStore

_jvm_lock = threading.Lock()
_jvm_jars: set[str] = set()


def ensure_jvm() -> set[str]:
    """Запускает JVM (один раз за процесс) с classpath из всех драйверов, у которых есть .jar."""
    import jpype

    if jpype.isJVMStarted():
        return _jvm_jars

    with _jvm_lock:
        if jpype.isJVMStarted():
            return _jvm_jars
        jar_paths = []
        for d in JdbcDriversStore.list_drivers():
            p = JdbcDriversStore.jar_path(d)
            if p:
                jar_paths.append(str(p))
        jpype.startJVM(classpath=jar_paths)
        _jvm_jars.update(jar_paths)
        return _jvm_jars


def get_driver_for_connection(conn_config: dict) -> dict:
    driver_id = conn_config.get("driver_id", "")
    driver = JdbcDriversStore.get_driver(driver_id)
    if not driver:
        raise ValueError("Драйвер для этого подключения не найден. Проверьте настройки в «Настройке драйверов»")
    if not driver.get("jar_filename"):
        raise ValueError(f"У драйвера «{driver['name']}» не загружена библиотека (.jar). Добавьте её во вкладке «Библиотека»")
    return driver


def get_db_connection(conn_config: dict):
    """
    Создаёт JDBC-соединение к внешней БД по конфигу подключения.
    Возвращает (connection, driver) — driver содержит sql_dialect/name для
    дальнейшей dialect-специфичной логики (валидация SQL, тестовый запрос).
    """
    try:
        import jaydebeapi
    except ImportError:
        raise RuntimeError("jaydebeapi не установлен. Установите: pip install jaydebeapi JPype1")

    driver = get_driver_for_connection(conn_config)
    jar_path = str(JdbcDriversStore.jar_path(driver))

    jvm_jars = ensure_jvm()
    if jar_path not in jvm_jars:
        raise RuntimeError(
            f"Библиотека драйвера «{driver['name']}» добавлена после запуска сервера — JVM уже стартовала без неё "
            "в classpath. Перезапустите бэкенд, чтобы драйвер заработал."
        )

    host = conn_config.get("host", "localhost")
    port = conn_config.get("port", driver.get("default_port") or 0)
    db_name = conn_config.get("db_name", "")
    login = conn_config.get("login", "")
    password = conn_config.get("password", "")

    try:
        url = driver["url_template"].format(host=host, port=port, db_name=db_name)
    except (KeyError, IndexError) as e:
        raise ValueError(f"Некорректный шаблон URL драйвера: отсутствует плейсхолдер {e}")

    conn = jaydebeapi.connect(driver["driver_class"], url, [login, password], jar_path)
    return conn, driver


def introspect_schema(conn) -> dict:
    """
    Generic-интроспекция через стандартный java.sql.DatabaseMetaData — работает
    для любого JDBC-совместимого драйвера одинаково (PostgreSQL/MySQL/Oracle/свой).
    """
    jconn = conn.jconn
    meta = jconn.getMetaData()

    tables_rs = meta.getTables(None, None, "%", ["TABLE"])
    tables: list[tuple] = []
    try:
        while tables_rs.next():
            tables.append((tables_rs.getString("TABLE_SCHEM"), tables_rs.getString("TABLE_NAME")))
    finally:
        tables_rs.close()

    schema: dict = {}
    for tschema, tname in tables[:200]:
        full_name = f"{tschema}.{tname}" if tschema else tname
        cols_rs = meta.getColumns(None, tschema, tname, "%")
        columns = []
        try:
            while cols_rs.next():
                columns.append({
                    "name": cols_rs.getString("COLUMN_NAME"),
                    "type": cols_rs.getString("TYPE_NAME"),
                    "nullable": cols_rs.getInt("NULLABLE") == 1,
                    "default": cols_rs.getString("COLUMN_DEF"),
                })
        finally:
            cols_rs.close()
        schema[full_name] = columns

    return schema
