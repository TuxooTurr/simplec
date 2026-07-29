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
    драйверы грузятся динамически в load_jdbc_driver).

    convertStrings=True — как это делает сам jaydebeapi.connect(): без него
    java.sql-строки (getString в интроспекции схемы) возвращались бы как
    java.lang.String, а не python str, и падала бы JSON-сериализация."""
    import jpype

    if jpype.isJVMStarted():
        return
    with _jvm_lock:
        if not jpype.isJVMStarted():
            jpype.startJVM(convertStrings=True)


def _ensure_jaydebeapi_ready() -> None:
    """Готовит окружение jaydebeapi для соединения, собранного в обход
    jaydebeapi.connect() (мы грузим драйвер своим URLClassLoader).

    jaydebeapi.connect() при каждом вызове делает две вещи, которые иначе
    не выполняются и приводят к ошибкам:
      1. attachThreadToJVM() — иначе доступ к JVM из потока пула
         (asyncio.to_thread у нас во всех вызовах БД) нестабилен;
      2. лениво инициализирует таблицу типов SQL→Python (_converters) и
         _java_array_byte — без них Cursor.fetchone() падает с
         'NoneType' object has no attribute 'get'.

    Реплицируем ровно ту же инициализацию (ветка JPype ≥ 0.7)."""
    import jaydebeapi
    import jpype

    if not jpype.isThreadAttachedToJVM():
        jpype.attachThreadToJVM()
        jpype.java.lang.Thread.currentThread().setContextClassLoader(
            jpype.java.lang.ClassLoader.getSystemClassLoader()
        )

    if jaydebeapi._converters is None:
        Types = jpype.JClass("java.sql.Types")
        Modifier = jpype.JClass("java.lang.reflect.Modifier")
        types_map = {}
        for f in Types.class_.getFields():
            if Modifier.isStatic(f.getModifiers()):
                types_map[str(f.getName())] = int(f.get(None))
        jaydebeapi._init_types(types_map)

    if getattr(jaydebeapi, "_java_array_byte", None) is None:
        jaydebeapi._java_array_byte = lambda data: jpype.JArray(jpype.JByte, 1)(data)


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
    _ensure_jaydebeapi_ready()   # attach thread + инициализация _converters (иначе fetchone падает)
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


def _safe_meta(fn, default):
    """Необязательные метаданные: экзотический драйвер не должен ронять интроспекцию.

    getPrimaryKeys/getImportedKeys/getIndexInfo объявлены в JDBC, но у части
    драйверов бросают исключение или возвращают мусор. Отсутствие этих данных
    ухудшает подсказки, но не должно лишать пользователя схемы целиком.
    """
    try:
        return fn()
    except Exception:
        return default


def _primary_keys(meta, tschema, tname) -> set:
    def _run():
        out, rs = set(), meta.getPrimaryKeys(None, tschema, tname)
        try:
            while rs.next():
                out.add(rs.getString("COLUMN_NAME"))
        finally:
            rs.close()
        return out
    return _safe_meta(_run, set())


def _foreign_keys(meta, tschema, tname) -> dict:
    """{колонка-источник: {"table": "схема.таблица", "column": "колонка"}}.

    Это главный источник иерархии для генератора данных: связь
    conference_members.conference_id → conference.id читается из самой БД,
    а не описывается пользователем руками.
    """
    def _run():
        out, rs = {}, meta.getImportedKeys(None, tschema, tname)
        try:
            while rs.next():
                pk_schema = rs.getString("PKTABLE_SCHEM")
                pk_table = rs.getString("PKTABLE_NAME")
                out[rs.getString("FKCOLUMN_NAME")] = {
                    "table": f"{pk_schema}.{pk_table}" if pk_schema else pk_table,
                    "column": rs.getString("PKCOLUMN_NAME"),
                }
        finally:
            rs.close()
        return out
    return _safe_meta(_run, {})


def _unique_columns(meta, tschema, tname) -> set:
    """Колонки под уникальным индексом — по одной на индекс (составные пропускаем:
    для них правило заполнения задаётся вручную)."""
    def _run():
        by_index, rs = {}, meta.getIndexInfo(None, tschema, tname, True, True)
        try:
            while rs.next():
                col = rs.getString("COLUMN_NAME")
                idx = rs.getString("INDEX_NAME")
                if col and idx:
                    by_index.setdefault(idx, []).append(col)
        finally:
            rs.close()
        return {cols[0] for cols in by_index.values() if len(cols) == 1}
    return _safe_meta(_run, set())


def introspect_schema(conn, max_tables: int = 200) -> dict:
    """
    Generic-интроспекция через стандартный java.sql.DatabaseMetaData — работает
    для любого JDBC-совместимого драйвера одинаково (PostgreSQL/MySQL/Oracle/свой).

    Формат намеренно сохранён прежним — {"схема.таблица": [колонки]} — чтобы не
    ломать кэш подключений, текстовое описание для LLM и типы на фронте. Каждая
    колонка дополнена признаками, нужными генератору данных:
      pk            — входит в первичный ключ
      autoincrement — значение проставляет сама БД
      unique        — под уникальным индексом
      fk            — {"table", "column"} или None
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
    for tschema, tname in tables[:max_tables]:
        full_name = f"{tschema}.{tname}" if tschema else tname
        pks = _primary_keys(meta, tschema, tname)
        fks = _foreign_keys(meta, tschema, tname)
        uniques = _unique_columns(meta, tschema, tname)

        cols_rs = meta.getColumns(None, tschema, tname, "%")
        columns = []
        try:
            while cols_rs.next():
                name = cols_rs.getString("COLUMN_NAME")
                # IS_AUTOINCREMENT появился в JDBC 4.0 — у старых драйверов колонки нет
                auto = _safe_meta(lambda: cols_rs.getString("IS_AUTOINCREMENT"), "") or ""
                columns.append({
                    "name": name,
                    "type": cols_rs.getString("TYPE_NAME"),
                    "nullable": cols_rs.getInt("NULLABLE") == 1,
                    "default": cols_rs.getString("COLUMN_DEF"),
                    "pk": name in pks,
                    "autoincrement": auto.upper() == "YES",
                    "unique": name in uniques,
                    "fk": fks.get(name),
                })
        finally:
            cols_rs.close()
        schema[full_name] = columns

    return schema
