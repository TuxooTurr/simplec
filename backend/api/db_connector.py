"""
Единая точка подключения к внешним БД — через JDBC (jaydebeapi + JPype),
как в DBeaver. Используется и «Тестовыми данными» (testdata.py), и «Джобами»
(jobs.py), так как оба ссылаются на один и тот же реестр подключений
(db/testdata_connections.py) и один и тот же реестр драйверов
(db/jdbc_drivers_store.py).

Почему JDBC для всех типов (включая PostgreSQL/MySQL/Oracle), а не нативные
Python-драйверы: единообразие с DBeaver и с реестром «свой драйвер» — все БД
подключаются одинаково: класс драйвера + .jar-библиотека + шаблон URL.

Горячая загрузка драйвера (без перезапуска бэкенда)
---------------------------------------------------
JVM запускается один раз за процесс, и её системный classpath после старта
изменить нельзя. Раньше это означало: добавил/заменил .jar — перезапусти сервер.

Теперь classpath при старте НЕ фиксируется. На каждое подключение .jar
загружается динамически через java.net.URLClassLoader, из него берётся класс
драйвера, создаётся экземпляр java.sql.Driver и вызывается его .connect(url,
props) напрямую (минуя DriverManager, который не видит классы из внешнего
загрузчика). Благодаря этому:
  • новую или заменённую библиотеку можно подключить без перезапуска;
  • .jar может лежать по любому пути на машине (его не обязательно копировать).
"""

import threading
from pathlib import Path

from db.jdbc_drivers_store import JdbcDriversStore

_jvm_lock = threading.Lock()


def ensure_jvm() -> None:
    """Запускает JVM один раз за процесс (без фиксированного classpath —
    драйверы грузятся динамически в load_jdbc_driver)."""
    import jpype

    if jpype.isJVMStarted():
        return
    with _jvm_lock:
        if not jpype.isJVMStarted():
            jpype.startJVM()


def load_jdbc_driver(driver_class: str, jar_path: str):
    """Загружает класс JDBC-драйвера из указанного .jar через свежий
    URLClassLoader и возвращает экземпляр java.sql.Driver.

    Свежий загрузчик на каждый вызов = горячая замена: заменили файл по пути —
    следующее подключение подхватит новую версию без перезапуска."""
    ensure_jvm()
    from jpype import JArray, JClass

    jar = Path(jar_path)
    if not jar.is_file():
        raise FileNotFoundError(
            f"Файл драйвера не найден: {jar_path}. "
            "Проверьте путь (он проверяется на машине, где запущен бэкенд) "
            "или укажите библиотеку заново во вкладке «Библиотека»."
        )

    File = JClass("java.io.File")
    URL = JClass("java.net.URL")
    URLClassLoader = JClass("java.net.URLClassLoader")
    ClassLoader = JClass("java.lang.ClassLoader")
    Class = JClass("java.lang.Class")

    url = File(str(jar)).toURI().toURL()
    loader = URLClassLoader(JArray(URL)([url]), ClassLoader.getSystemClassLoader())
    klass = Class.forName(driver_class, True, loader)
    return klass.getDeclaredConstructor().newInstance()


def get_driver_for_connection(conn_config: dict) -> dict:
    driver_id = conn_config.get("driver_id", "")
    driver = JdbcDriversStore.get_driver(driver_id)
    if not driver:
        raise ValueError("Драйвер для этого подключения не найден. Проверьте настройки в «Настройке драйверов»")
    if not JdbcDriversStore.has_library(driver):
        raise ValueError(f"У драйвера «{driver['name']}» не подключена библиотека (.jar). Добавьте её во вкладке «Библиотека»")
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

    host = conn_config.get("host", "localhost")
    port = conn_config.get("port", driver.get("default_port") or 0)
    db_name = conn_config.get("db_name", "")
    login = conn_config.get("login", "")
    password = conn_config.get("password", "")

    try:
        url = driver["url_template"].format(host=host, port=port, db_name=db_name)
    except (KeyError, IndexError) as e:
        raise ValueError(f"Некорректный шаблон URL драйвера: отсутствует плейсхолдер {e}")

    from jpype import JClass

    driver_obj = load_jdbc_driver(driver["driver_class"], jar_path)
    Properties = JClass("java.util.Properties")
    props = Properties()
    if login:
        props.setProperty("user", login)
    if password:
        props.setProperty("password", password)

    jconn = driver_obj.connect(url, props)
    if jconn is None:
        # Контракт JDBC: Driver.connect() возвращает null, если URL не для этого драйвера.
        raise RuntimeError(
            f"Драйвер «{driver['name']}» не принял URL. Проверьте шаблон URL и класс драйвера "
            "(возможно, они не соответствуют выбранной библиотеке)."
        )

    conn = jaydebeapi.Connection(jconn, jaydebeapi._converters)
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
