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

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.api.db_connector import ensure_jvm, get_db_connection, introspect_schema
from db.jdbc_drivers_store import JdbcDriversStore
from db.testdata_connections import TestDataConnectionsStore

logger = logging.getLogger(__name__)
router = APIRouter()


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


def _validate_sql(sql: str, dialect: str = "generic") -> str:
    """
    Валидирует SQL-запрос. Разрешены ТОЛЬКО SELECT / WITH / EXPLAIN / SHOW / DESCRIBE.
    Возвращает очищенный SQL или поднимает ValueError.
    Для Oracle ограничение строк — через FETCH FIRST, для остальных — LIMIT.
    """
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        raise ValueError("Пустой запрос")

    if not _ALLOWED_START.match(cleaned):
        raise ValueError("Разрешены только SELECT-запросы (начало: SELECT, WITH, EXPLAIN, SHOW, DESCRIBE)")

    for match in _FORBIDDEN_KEYWORDS.finditer(cleaned):
        keyword = match.group(0).upper()
        # SHOW / DESCRIBE разрешены в начале
        if keyword in ("SHOW", "DESCRIBE"):
            continue
        raise ValueError(f"Запрещённое ключевое слово в запросе: {keyword}. Разрешены только SELECT-запросы")

    if dialect == "oracle":
        if not re.search(r'\b(ROWNUM|FETCH\s+FIRST)\b', cleaned, re.IGNORECASE):
            cleaned += f" FETCH FIRST {_MAX_ROWS} ROWS ONLY"
    elif not re.search(r'\bLIMIT\b', cleaned, re.IGNORECASE):
        cleaned += f" LIMIT {_MAX_ROWS}"

    return cleaned


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

def _execute_query(conn, sql: str) -> dict:
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

def _enrich_with_driver(conn: dict) -> dict:
    """Добавляет driver_name/sql_dialect (для бейджей на фронте) — денормализовано из реестра драйверов."""
    driver = JdbcDriversStore.get_driver(conn.get("driver_id", ""))
    conn["driver_name"] = driver["name"] if driver else "неизвестный драйвер"
    conn["sql_dialect"] = driver["sql_dialect"] if driver else "generic"
    return conn


@router.get("/api/testdata/connections")
def list_connections() -> list[dict]:
    return [_enrich_with_driver(c) for c in TestDataConnectionsStore.list_connections()]


class ConnectionCreateRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=100)
    driver_id: str = Field(..., min_length=1)  # id драйвера из реестра «Настройка драйверов»
    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    db_name: str = Field(default="")
    login: str = Field(default="")
    password: str = Field(default="")
    schema_name: str = Field(default="")  # для Oracle-подобных драйверов: схема


@router.post("/api/testdata/connections")
def create_connection(req: ConnectionCreateRequest) -> dict:
    if not JdbcDriversStore.get_driver(req.driver_id):
        raise HTTPException(status_code=400, detail="Драйвер не найден — выберите его в «Настройке драйверов»")
    conn = TestDataConnectionsStore.create_connection(req.model_dump())
    # Маскируем пароль в ответе
    conn_safe = _enrich_with_driver({**conn})
    if conn_safe.get("password"):
        conn_safe["password"] = "••••••••"
    return {"connection": conn_safe}


@router.put("/api/testdata/connections/{conn_id}")
def update_connection(conn_id: str, req: ConnectionCreateRequest) -> dict:
    if not JdbcDriversStore.get_driver(req.driver_id):
        raise HTTPException(status_code=400, detail="Драйвер не найден — выберите его в «Настройке драйверов»")
    updated = TestDataConnectionsStore.update_connection(conn_id, req.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    safe = _enrich_with_driver({**updated})
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
            conn, driver = get_db_connection(conn_cfg)
            cur = conn.cursor()
            if driver.get("sql_dialect") == "oracle":
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
        conn, _driver = get_db_connection(conn_cfg)
        try:
            schema = introspect_schema(conn)
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

        driver = JdbcDriversStore.get_driver(conn_cfg.get("driver_id", ""))
        dialect = driver.get("sql_dialect", "generic") if driver else "generic"

        try:
            validated_sql = _validate_sql(req.sql, dialect)
        except ValueError as e:
            results[conn_id] = {"error": str(e), "rows": [], "columns": []}
            continue

        def _run(cfg=conn_cfg, sql=validated_sql):
            conn, _ = get_db_connection(cfg)
            try:
                return _execute_query(conn, sql)
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
        driver = JdbcDriversStore.get_driver(conn_cfg.get("driver_id", ""))
        db_types.add(driver["name"] if driver else "SQL")
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
    db_type = list(db_types)[0] if db_types else "SQL"

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
        driver = JdbcDriversStore.get_driver(conn_cfg.get("driver_id", ""))
        db_types.add(driver["name"] if driver else "SQL")
        schema = conn_cfg.get("cached_schema")
        if schema:
            schemas_parts.append(_schema_to_text(schema, conn_cfg.get("display_name", "")))

    schemas_text = "\n\n".join(schemas_parts) if schemas_parts else "(схема неизвестна)"
    db_type = list(db_types)[0] if db_types else "SQL"

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


# ── Реестр JDBC-драйверов («Настройка драйверов», как в DBeaver) ─────────────
# Все типы БД — PostgreSQL, MySQL, Oracle (встроенные, предзаполненные) и любые
# свои — подключаются одинаково: класс + шаблон URL + .jar-библиотека.

_MAX_JAR_SIZE = 100 * 1024 * 1024  # 100 МБ


@router.get("/api/testdata/drivers")
def list_drivers() -> list[dict]:
    return JdbcDriversStore.list_drivers()


class DriverCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    driver_class: str = Field(..., min_length=1)
    url_template: str = Field(..., min_length=1)
    default_port: Optional[int] = None
    default_db_name: str = Field(default="")
    default_login: str = Field(default="")


@router.post("/api/testdata/drivers")
def create_driver(req: DriverCreateRequest) -> dict:
    """Создать новый пользовательский драйвер (вкладка «Настройки»). Библиотека добавляется отдельно."""
    driver = JdbcDriversStore.create_driver(req.model_dump())
    return {"driver": driver}


@router.put("/api/testdata/drivers/{driver_id}")
def update_driver(driver_id: str, req: DriverCreateRequest) -> dict:
    """Обновить настройки драйвера — доступно и для встроенных (PostgreSQL/MySQL/Oracle)."""
    updated = JdbcDriversStore.update_driver(driver_id, req.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Драйвер не найден")
    return {"driver": updated}


@router.delete("/api/testdata/drivers/{driver_id}")
def delete_driver(driver_id: str) -> dict:
    ok = JdbcDriversStore.delete_driver(driver_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Встроенный драйвер нельзя удалить, либо драйвер не найден")
    return {"status": "deleted"}


@router.post("/api/testdata/drivers/{driver_id}/library")
async def upload_driver_library(driver_id: str, file: UploadFile = File(...)) -> dict:
    """Загрузить/заменить .jar драйвера (вкладка «Библиотека»)."""
    if not JdbcDriversStore.get_driver(driver_id):
        raise HTTPException(status_code=404, detail="Драйвер не найден")
    if not file.filename or not file.filename.lower().endswith(".jar"):
        raise HTTPException(status_code=400, detail="Ожидается .jar файл")

    content = await file.read()
    if len(content) > _MAX_JAR_SIZE:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 100 МБ)")

    updated = JdbcDriversStore.set_library(driver_id, content, file.filename)
    return {"driver": updated}


@router.delete("/api/testdata/drivers/{driver_id}/library")
def remove_driver_library(driver_id: str) -> dict:
    updated = JdbcDriversStore.remove_library(driver_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Драйвер не найден")
    return {"driver": updated}


@router.post("/api/testdata/drivers/{driver_id}/test")
async def test_driver(driver_id: str) -> dict:
    """Проверяет, что jar и указанный класс драйвера загружаются в JVM (без подключения к реальной БД)."""
    driver = JdbcDriversStore.get_driver(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Драйвер не найден")
    if not driver.get("jar_filename"):
        return {"status": "red", "message": "Библиотека (.jar) не загружена — добавьте её во вкладке «Библиотека»"}

    def _test():
        try:
            jvm_jars = ensure_jvm()
            jar_path = str(JdbcDriversStore.jar_path(driver))
            if jar_path not in jvm_jars:
                return {
                    "status": "yellow",
                    "message": "Библиотека добавлена после запуска сервера — перезапустите бэкенд для проверки",
                }
            import jpype
            jpype.JClass(driver["driver_class"])
            return {"status": "green", "message": "Класс драйвера успешно загружен"}
        except Exception as e:
            return {"status": "red", "message": f"Ошибка загрузки драйвера: {str(e)[:300]}"}

    return await asyncio.to_thread(_test)
