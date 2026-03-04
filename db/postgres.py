"""
PostgreSQL-соединение для Генератора метрик.

DATABASE_URL задаётся через .env — при переезде на Сбер-инфраструктуру
меняется только эта переменная, код не трогается.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://simpletest:simpletest@localhost:5432/metrics",
)

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


def init_db():
    """Создать все таблицы если не существуют (идемпотентно).

    В multi-worker uvicorn воркеры стартуют параллельно и оба вызывают
    create_all. Первый успевает создать таблицы, второй получает IntegrityError
    на pg_catalog — это нормально, таблицы уже есть.
    """
    from db.metrics_models import Base as MetricsBase  # noqa: F401
    from sqlalchemy.exc import IntegrityError
    try:
        MetricsBase.metadata.create_all(bind=engine)
    except IntegrityError:
        # Race condition: другой воркер уже создал таблицы — всё OK
        pass
