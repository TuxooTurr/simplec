"""
Соединение с БД для SimpleTest.

DATABASE_URL задаётся через .env:
  PostgreSQL:  postgresql://user:pass@localhost:5432/metrics
  SQLite:      sqlite:///./simpletest.db   (без Docker, для локального запуска)
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://simpletest:simpletest@localhost:5432/metrics",
)

_is_sqlite = DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,   # авто-переконнект при обрыве
        pool_size=5,
        max_overflow=10,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI Dependency — сессия БД на запрос."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _apply_column_migrations():
    """Добавляет новые колонки в существующие таблицы (IF NOT EXISTS).
    create_all не трогает уже существующие таблицы — этот шаг необходим.
    """
    stmts = [
        "ALTER TABLE test_systems ADD COLUMN IF NOT EXISTS started_by              VARCHAR(255)",
        "ALTER TABLE test_systems ADD COLUMN IF NOT EXISTS started_at              TIMESTAMP",
        "ALTER TABLE test_metrics ADD COLUMN IF NOT EXISTS last_metadata_sent_at   TIMESTAMP",
        "ALTER TABLE test_metrics ADD COLUMN IF NOT EXISTS last_thresholds_sent_at TIMESTAMP",
        # Удалить устаревший единый топик (заменён на 3 отдельных)
        "DELETE FROM metrics_settings WHERE key = 'kafka_topic'",
    ]
    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))


def init_db():
    """Создать все таблицы если не существуют (идемпотентно).

    В multi-worker uvicorn воркеры стартуют параллельно и оба вызывают
    create_all. Первый успевает создать таблицы, второй получает IntegrityError
    на pg_catalog — это нормально, таблицы уже есть.

    Для SQLite миграции пропускаются: create_all создаёт схему сразу актуальной.
    """
    from db.metrics_models import Base as MetricsBase  # noqa: F401
    from sqlalchemy.exc import IntegrityError
    try:
        MetricsBase.metadata.create_all(bind=engine)
        if not _is_sqlite:
            _apply_column_migrations()
    except IntegrityError:
        # Race condition: другой воркер уже создал таблицы — всё OK
        pass
