"""
API тестовых данных: подключения к внешним БД, выполнение SELECT-запросов,
LLM-генерация SQL, предложение скриптов создания данных.

БЕЗОПАСНОСТЬ: выполняются ТОЛЬКО SELECT-запросы.
Любые DML/DDL (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE) —
запрещены и отклоняются на уровне валидации.

Эндпоинты:
  CRUD подключений:
    GET    /api/testdata/connections               — список подключений
    POST   /api/testdata/connections               — создать подключение
    PUT    /api/testdata/connections/{id}           — обновить подключение
    DELETE /api/testdata/connections/{id}           — удалить подключение
    POST   /api/testdata/connections/{id}/test      — тест соединения
    POST   /api/testdata/connections/{id}/introspect — получить схему БД

  Запросы:
    POST   /api/testdata/query                      — выполнить SELECT
    POST   /api/testdata/generate-query              — LLM генерирует SQL
    POST   /api/testdata/suggest-script              — LLM предлагает скрипт создания данных
"""

import asyncio
import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.testdata_connections import TestDataConnectionsStore

logger = logging.getLogger(__name__)
router = APIRouter()

# ── DB Connector ──────────────────────────────────────────────────────────────

_DEFAULT_PORTS = {
    "postgresql": 5432,
    "mysql": 3306,
    "oracle": 1521,
}


def _get_db_connection(conn_config: dict):
    """
    Создаёт соединение к внешней БД по конфигу.
    Возвращает (connection, db_type).
    """
    db_type = conn_config.get("db_type", "postgresql")
    host = conn_config.get("host", "localhost")
    port = conn_config.get("port", _DEFAULT_PORTS.get(db_type, 5432))
    db_name = conn_config.get("db_name", "")
    login = conn_config.get("login", "")
    password = conn_config.get("password", "")

    if db_type == "postgresql":
        try:
            import psycopg2
        except ImportError:
            raise RuntimeError("psycopg2 не установлен. Установите: pip install psycopg2-binary")
        conn = psycopg2.connect(
            host=host, port=port, dbname=db_name,
            user=login, password=password,
            connect_timeout=10,
        )
        conn.set_session(readonly=True)
        return conn, db_type

    elif db_type == "mysql":
        try:
            import mysql.connector
        except ImportError:
            raise RuntimeError("mysql-connector-python не установлен. Установите: pip install mysql-connector-python")
        conn = mysql.connector.connect(
            host=host, port=port, database=db_name,
            user=login, password=password,
            connect_timeout=10,
        )
        return conn, db_type

    elif db_type == "oracle":
        try:
            import oracledb
        except ImportError:
            raise RuntimeError("oracledb не установлен. Установите: pip install oracledb")
        dsn = oracledb.makedsn(host, port, service_name=db_name)
        conn = oracledb.connect(user=login, password=password, dsn=dsn)
        return conn, db_type

    else:
        raise ValueError(f"Неподдерживаемый тип БД: {db_type}")


# ── SQL Safety ────────────────────────────────────────────────────────────────

_FORBIDDEN_KEYWORDS = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|'
    r'EXEC|EXECUTE|CALL|MERGE|REPLACE|LOAD|COPY|SET|DO|LOCK|UNLOCK|'
    r'RENAME|VACUUM|REINDEX|CLUSTER|DISCARD|PREPARE|DEALLOCATE|LISTEN|'
    r'NOTIFY|COMMENT|SECURITY|REASSIGN|IMPORT|EXPORT)\b',
    re.IGNORECASE
)

_ALLOWED_START = re.compile(
    r'^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC)\b',
    re.IGNORECASE
)

_MAX_ROWS = 500
_QUERY_TIMEOUT_SEC = 30


def _validate_sql(sql: str) -> str:
    """
    Валидирует SQL-запрос. Разрешены ТОЛЬКО SELECT / WITH / EXPLAIN / SHOW / DESCRIBE.
    Возвращает очищенный SQL или поднимает ValueError.
    """
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        raise ValueError("Пустой запрос")

    if not _ALLOWED_START.match(cleaned):
        raise ValueError("Разрешены только SELECT-запросы (начало: SELECT, WITH, EXPLAIN, SHOW, DESCRIBE)")

    # Проверяем на запрещённые ключевые слова в теле запроса
    # Исключаем CTE (WITH ... AS (SELECT ...)) — они допустимы
    # Проверяем после первого SELECT
    check_body = cleaned
    if check_body.upper().startswith("WITH"):
        # У CTE SELECT может быть внутри скобок — проверяем только финальный запрос
        pass  # CTE безопасны если нет DML

    # Ищем запрещённые ключевые слова, но пропускаем их внутри строковых литералов
    # Простая проверка: ищем DML-ключевые слова как отдельные слова
    for match in _FORBIDDEN_KEYWORDS.finditer(cleaned):
        keyword = match.group(0).upper()
        # SHOW / DESCRIBE разрешены в начале
        if keyword in ("SHOW", "DESCRIBE"):
            continue
        raise ValueError(f"Запрещённое ключевое слово в запросе: {keyword}. Разрешены только SELECT-запросы")

    # Добавляем LIMIT если его нет
    if not re.search(r'\bLIMIT\b', cleaned, re.IGNORECASE):
        # Для Oracle используем FETCH FIRST
        cleaned += f" LIMIT {_MAX_ROWS}"

    return cleaned


def _validate_sql_oracle(sql: str) -> str:
    """Oracle-специфичная валидация — ROWNUM вместо LIMIT."""
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        raise ValueError("Пустой запрос")

    if not _ALLOWED_START.match(cleaned):
        raise ValueError("Разрешены только SELECT-запросы")

    for match in _FORBIDDEN_KEYWORDS.finditer(cleaned):
        keyword = match.group(0).upper()
        if keyword in ("SHOW", "DESCRIBE"):
            continue
        raise ValueError(f"Запрещённое ключевое слово: {keyword}")

    # Oracle: добавляем ограничение строк через FETCH FIRST
    if not re.search(r'\b(ROWNUM|FETCH\s+FIRST)\b', cleaned, re.IGNORECASE):
        cleaned += f" FETCH FIRST {_MAX_ROWS} ROWS ONLY"

    return cleaned


# ── Schema introspect ─────────────────────────────────────────────────────────

def _introspect_postgresql(conn) -> dict:
    """Получить схему PostgreSQL: таблицы + колонки."""
    cur = conn.cursor()
    cur.execute("""
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema, table_name
        LIMIT 200
    """)
    tables = cur.fetchall()

    schema = {}
    for tschema, tname in tables:
        full_name = f"{tschema}.{tname}" if tschema != "public" else tname
        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (tschema, tname))
        columns = []
        for col_name, data_type, nullable, default in cur.fetchall():
            columns.append({
                "name": col_name,
                "type": data_type,
                "nullable": nullable == "YES",
                "default": default,
            })
        schema[full_name] = columns

    cur.close()
    return schema


def _introspect_mysql(conn) -> dict:
    """Получить схему MySQL: таблицы + колонки."""
    cur = conn.cursor()
    db_name = conn.database
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = %s AND table_type = 'BASE TABLE'
        ORDER BY table_name
        LIMIT 200
    """, (db_name,))
    tables = cur.fetchall()

    schema = {}
    for (tname,) in tables:
        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (db_name, tname))
        columns = []
        for col_name, data_type, nullable, default in cur.fetchall():
            columns.append({
                "name": col_name,
                "type": data_type,
                "nullable": nullable == "YES",
                "default": default,
            })
        schema[tname] = columns

    cur.close()
    return schema


def _introspect_oracle(conn) -> dict:
    """Получить схему Oracle: таблицы + колонки."""
    cur = conn.cursor()
    cur.execute("""
        SELECT table_name FROM user_tables
        ORDER BY table_name
        FETCH FIRST 200 ROWS ONLY
    """)
    tables = cur.fetchall()

    schema = {}
    for (tname,) in tables:
        cur.execute("""
            SELECT column_name, data_type, nullable, data_default
            FROM user_tab_columns
            WHERE table_name = :tname
            ORDER BY column_id
        """, {"tname": tname})
        columns = []
        for col_name, data_type, nullable, default in cur.fetchall():
            columns.append({
                "name": col_name,
                "type": data_type,
                "nullable": nullable == "Y",
                "default": str(default).strip() if default else None,
            })
        schema[tname] = columns

    cur.close()
    return schema


def _introspect_schema(conn, db_type: str) -> dict:
    """Роутер introspect по типу БД."""
    if db_type == "postgresql":
        return _introspect_postgresql(conn)
    elif db_type == "mysql":
        return _introspect_mysql(conn)
    elif db_type == "oracle":
        return _introspect_oracle(conn)
    return {}


def _schema_to_text(schema: dict, db_name: str = "") -> str:
    """Конвертирует схему БД в текстовое описание для LLM-промпта."""
    if not schema:
        return ""
    lines = []
    if db_name:
        lines.append(f"=== База данных: {db_name} ===")
    for table_name, columns in schema.items():
        cols_desc = []
        for col in columns:
            nullable = "NULL" if col.get("nullable") else "NOT NULL"
            cols_desc.append(f"  {col['name']} {col['type']} {nullable}")
        lines.append(f"TABLE {table_name} (\n" + ",\n".join(cols_desc) + "\n)")
    return "\n\n".join(lines)


# ── Execute query ─────────────────────────────────────────────────────────────

def _execute_query(conn, db_type: str, sql: str) -> dict:
    """
    Выполняет SELECT-запрос и возвращает результат.
    Returns: {"columns": [...], "rows": [...], "row_count": int}
    """
    cur = conn.cursor()
    cur.execute(sql)
    columns = [desc[0] for desc in cur.description] if cur.description else []
    rows = cur.fetchall()
    cur.close()

    # Конвертируем значения в JSON-совместимые типы
    json_rows = []
    for row in rows:
        json_row = []
        for val in row:
            if val is None:
                json_row.append(None)
            elif isinstance(val, (int, float, bool)):
                json_row.append(val)
            elif isinstance(val, bytes):
                json_row.append(val.hex()[:100])
            else:
                json_row.append(str(val))
        json_rows.append(json_row)

    return {
        "columns": columns,
        "rows": json_rows,
        "row_count": len(json_rows),
    }


# ── LLM helpers ──────────────────────────────────────────────────────────────

def _generate_sql_via_llm(
    provider: str,
    requirement: str,
    schemas_text: str,
    db_type: str = "postgresql",
) -> str:
    """LLM генерирует SELECT-запрос на основании требования и схемы БД."""
    from agents.llm_client import LLMClient

    llm = LLMClient(provider=provider)

    prompt = f"""Ты — эксперт по SQL. Сгенерируй ТОЛЬКО SELECT-запрос для поиска тестовых данных.

ТРЕБОВАНИЕ:
{requirement}

СХЕМА БАЗЫ ДАННЫХ ({db_type.upper()}):
{schemas_text}

ПРАВИЛА:
1. ТОЛЬКО SELECT-запросы. Никаких INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. Используй синтаксис {db_type.upper()}.
3. Ограничь результат — добавь LIMIT 100 (или FETCH FIRST 100 ROWS ONLY для Oracle).
4. Используй понятные алиасы для колонок.
5. Если требование неоднозначно — выбирай наиболее вероятную интерпретацию.
6. Верни ТОЛЬКО SQL-запрос, без пояснений, без markdown-разметки.

SQL:"""

    response = llm.chat(prompt)
    # Очищаем от markdown code blocks
    sql = response.strip()
    sql = re.sub(r'^```(?:sql)?\s*', '', sql)
    sql = re.sub(r'\s*```$', '', sql)
    return sql.strip()


def _suggest_insert_script(
    provider: str,
    requirement: str,
    schemas_text: str,
    db_type: str = "postgresql",
    query_result_empty: bool = True,
) -> str:
    """LLM генерирует INSERT-скрипт для создания тестовых данных (НЕ выполняется!)."""
    from agents.llm_client import LLMClient

    llm = LLMClient(provider=provider)

    prompt = f"""Ты — эксперт по SQL и тестовым данным. Подходящие тестовые данные НЕ НАЙДЕНЫ в базе.

Сгенерируй SQL-скрипт для СОЗДАНИЯ необходимых тестовых данных.

ТРЕБОВАНИЕ:
{requirement}

СХЕМА БАЗЫ ДАННЫХ ({db_type.upper()}):
{schemas_text}

ПРАВИЛА:
1. Создай INSERT-скрипт с реалистичными тестовыми данными.
2. Используй синтаксис {db_type.upper()}.
3. Добавь комментарии к каждому блоку INSERT.
4. Если нужных таблиц нет — добавь CREATE TABLE перед INSERT.
5. Генерируй 5-10 строк данных для каждой таблицы.
6. Данные должны соответствовать требованию и быть реалистичными.
7. Добавь в начале комментарий: -- ⚠️ СКРИПТ НЕ ВЫПОЛНЕН АВТОМАТИЧЕСКИ. Проверьте и запустите вручную.
8. Верни ТОЛЬКО SQL-скрипт.

SQL:"""

    response = llm.chat(prompt)
    sql = response.strip()
    sql = re.sub(r'^```(?:sql)?\s*', '', sql)
    sql = re.sub(r'\s*```$', '', sql)
    return sql.strip()


# ══════════════════════════════════════════════════════════════════════════════
#  REST API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

# ── CRUD: Connections ─────────────────────────────────────────────────────────

@router.get("/api/testdata/connections")
def list_connections() -> list[dict]:
    return TestDataConnectionsStore.list_connections()


class ConnectionCreateRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=100)
    db_type: str = Field(default="postgresql")  # postgresql, mysql, oracle
    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    db_name: str = Field(default="")
    login: str = Field(default="")
    password: str = Field(default="")
    schema_name: str = Field(default="")


@router.post("/api/testdata/connections")
def create_connection(req: ConnectionCreateRequest) -> dict:
    if req.db_type not in ("postgresql", "mysql", "oracle"):
        raise HTTPException(status_code=400, detail=f"Неподдерживаемый тип БД: {req.db_type}")
    conn = TestDataConnectionsStore.create_connection(req.model_dump())
    # Маскируем пароль в ответе
    conn_safe = {**conn}
    if conn_safe.get("password"):
        conn_safe["password"] = "••••••••"
    return {"connection": conn_safe}


@router.put("/api/testdata/connections/{conn_id}")
def update_connection(conn_id: str, req: ConnectionCreateRequest) -> dict:
    updated = TestDataConnectionsStore.update_connection(conn_id, req.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    safe = {**updated}
    if safe.get("password"):
        safe["password"] = "••••••••"
    return {"connection": safe}


@router.delete("/api/testdata/connections/{conn_id}")
def delete_connection(conn_id: str) -> dict:
    ok = TestDataConnectionsStore.delete_connection(conn_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    return {"status": "deleted"}


# ── Test connection ───────────────────────────────────────────────────────────

@router.post("/api/testdata/connections/{conn_id}/test")
async def test_connection(conn_id: str) -> dict:
    conn_cfg = TestDataConnectionsStore.get_connection(conn_id)
    if not conn_cfg:
        raise HTTPException(status_code=404, detail="Подключение не найдено")

    def _test():
        try:
            conn, db_type = _get_db_connection(conn_cfg)
            cur = conn.cursor()
            if db_type == "oracle":
                cur.execute("SELECT 1 FROM DUAL")
            else:
                cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
            conn.close()
            return {"status": "green", "message": "Соединение установлено"}
        except Exception as e:
            return {"status": "red", "message": f"Ошибка подключения: {str(e)[:300]}"}

    return await asyncio.to_thread(_test)


# ── Schema introspect ─────────────────────────────────────────────────────────

@router.post("/api/testdata/connections/{conn_id}/introspect")
async def introspect_connection(conn_id: str) -> dict:
    conn_cfg = TestDataConnectionsStore.get_connection(conn_id)
    if not conn_cfg:
        raise HTTPException(status_code=404, detail="Подключение не найдено")

    def _do():
        conn, db_type = _get_db_connection(conn_cfg)
        try:
            schema = _introspect_schema(conn, db_type)
            # Сохраняем в кэш
            TestDataConnectionsStore.update_cached_schema(conn_id, schema)
            return schema
        finally:
            conn.close()

    try:
        schema = await asyncio.to_thread(_do)
        return {
            "schema": schema,
            "table_count": len(schema),
            "column_count": sum(len(cols) for cols in schema.values()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка introspect: {str(e)[:300]}")


# ── Execute query ─────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    connection_ids: list[str] = Field(..., min_length=1)
    sql: str = Field(..., min_length=1)


@router.post("/api/testdata/query")
async def execute_query(req: QueryRequest) -> dict:
    """
    Выполняет SELECT-запрос на выбранных БД.
    Возвращает результаты для каждого подключения.
    """
    results = {}

    for conn_id in req.connection_ids:
        conn_cfg = TestDataConnectionsStore.get_connection(conn_id)
        if not conn_cfg:
            results[conn_id] = {"error": "Подключение не найдено", "rows": [], "columns": []}
            continue

        db_type = conn_cfg.get("db_type", "postgresql")

        try:
            if db_type == "oracle":
                validated_sql = _validate_sql_oracle(req.sql)
            else:
                validated_sql = _validate_sql(req.sql)
        except ValueError as e:
            results[conn_id] = {"error": str(e), "rows": [], "columns": []}
            continue

        def _run(cfg=conn_cfg, sql=validated_sql, dt=db_type):
            conn, _ = _get_db_connection(cfg)
            try:
                return _execute_query(conn, dt, sql)
            finally:
                conn.close()

        try:
            result = await asyncio.to_thread(_run)
            result["db_name"] = conn_cfg.get("display_name", conn_id)
            results[conn_id] = result
        except Exception as e:
            results[conn_id] = {
                "error": str(e)[:300],
                "rows": [],
                "columns": [],
                "db_name": conn_cfg.get("display_name", conn_id),
            }

    return {"results": results}


# ── LLM: Generate SQL ────────────────────────────────────────────────────────

class GenerateQueryRequest(BaseModel):
    connection_ids: list[str] = Field(..., min_length=1)
    requirement: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1)


@router.post("/api/testdata/generate-query")
async def generate_query(req: GenerateQueryRequest) -> dict:
    """
    LLM генерирует SELECT-запрос на основании текстового требования
    и реальной схемы подключённых БД.
    """
    # Собираем схемы выбранных БД
    schemas_parts = []
    db_types = set()

    for conn_id in req.connection_ids:
        conn_cfg = TestDataConnectionsStore.get_connection(conn_id)
        if not conn_cfg:
            continue
        db_types.add(conn_cfg.get("db_type", "postgresql"))
        schema = conn_cfg.get("cached_schema")
        if schema:
            text = _schema_to_text(schema, conn_cfg.get("display_name", ""))
            schemas_parts.append(text)

    if not schemas_parts:
        raise HTTPException(
            status_code=400,
            detail="Нет доступных схем. Выполните introspect подключений.",
        )

    schemas_text = "\n\n".join(schemas_parts)
    # Используем тип первой БД (обычно они одинаковые)
    db_type = list(db_types)[0] if db_types else "postgresql"

    try:
        sql = await asyncio.to_thread(
            _generate_sql_via_llm,
            req.provider,
            req.requirement,
            schemas_text,
            db_type,
        )
        return {"sql": sql, "db_type": db_type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации SQL: {str(e)[:300]}")


# ── LLM: Suggest insert script ───────────────────────────────────────────────

class SuggestScriptRequest(BaseModel):
    connection_ids: list[str] = Field(..., min_length=1)
    requirement: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1)


@router.post("/api/testdata/suggest-script")
async def suggest_script(req: SuggestScriptRequest) -> dict:
    """
    Когда данные НЕ найдены — LLM генерирует INSERT-скрипт.
    Скрипт НЕ выполняется, только предлагается пользователю.
    """
    schemas_parts = []
    db_types = set()

    for conn_id in req.connection_ids:
        conn_cfg = TestDataConnectionsStore.get_connection(conn_id)
        if not conn_cfg:
            continue
        db_types.add(conn_cfg.get("db_type", "postgresql"))
        schema = conn_cfg.get("cached_schema")
        if schema:
            schemas_parts.append(_schema_to_text(schema, conn_cfg.get("display_name", "")))

    schemas_text = "\n\n".join(schemas_parts) if schemas_parts else "(схема неизвестна)"
    db_type = list(db_types)[0] if db_types else "postgresql"

    try:
        script = await asyncio.to_thread(
            _suggest_insert_script,
            req.provider,
            req.requirement,
            schemas_text,
            db_type,
        )
        return {"script": script, "db_type": db_type, "warning": "Скрипт НЕ выполнен. Проверьте и запустите вручную."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации скрипта: {str(e)[:300]}")


# ── Get schemas text (for generation integration) ────────────────────────────

@router.post("/api/testdata/schemas-text")
async def get_schemas_text(connection_ids: list[str]) -> dict:
    """
    Возвращает текстовое описание схем выбранных БД.
    Используется при интеграции с генерацией тест-кейсов.
    """
    parts = []
    for conn_id in connection_ids:
        conn_cfg = TestDataConnectionsStore.get_connection(conn_id)
        if not conn_cfg:
            continue
        schema = conn_cfg.get("cached_schema")
        if schema:
            parts.append(_schema_to_text(schema, conn_cfg.get("display_name", "")))
    return {"text": "\n\n".join(parts), "connection_count": len(parts)}
