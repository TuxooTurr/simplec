"""
SQLAlchemy-модели для Генератора метрик.
Все 8 таблиц по спецификации + metrics_settings (ключ-значение для Kafka-параметров).
"""

from sqlalchemy import (
    Column, Integer, String, Boolean, Numeric,
    BigInteger, Text, DateTime, ForeignKey, func,
)
from sqlalchemy.orm import relationship
from db.postgres import Base


class TestSystem(Base):
    """Тестовые услуги (ИТ-системы)."""
    __tablename__ = "test_systems"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    it_service_ci  = Column(String(20), unique=True, nullable=False)
    name           = Column(String(255), nullable=False)
    mon_system_ci  = Column(String(20), nullable=False)
    is_active      = Column(Boolean, default=False, nullable=False)
    created_at     = Column(DateTime, server_default=func.now(), nullable=False)

    metrics = relationship(
        "TestMetric", back_populates="system", cascade="all, delete-orphan"
    )


class TestMetric(Base):
    """Шаблоны метрик."""
    __tablename__ = "test_metrics"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    test_system_id      = Column(Integer, ForeignKey("test_systems.id"), nullable=False, index=True)
    metric_hash         = Column(String(128), unique=True, nullable=False)
    metric_name         = Column(String(255), nullable=False)
    metric_description  = Column(String(255), nullable=False)
    metric_type         = Column(String(50), nullable=False)   # Availability|Errors|Latency|Traffic|Saturation|Other
    metric_group        = Column(String(50), nullable=False)   # App|Infra
    metric_unit         = Column(String(32), nullable=False)
    metric_period_sec   = Column(Integer, default=60, nullable=False)
    object_ci           = Column(String(20), nullable=True)
    object_id           = Column(String(255), nullable=False)
    object_name         = Column(String(255), nullable=False)
    object_type         = Column(String(255), nullable=True)   # null | AI-AGENT
    mon_system_metric_id = Column(String(255), nullable=False)
    purpose_type_hint   = Column(Integer, nullable=True)
    spec_version        = Column(String(10), default="1.0", nullable=False)
    is_active           = Column(Boolean, default=False, nullable=False, index=True)
    last_sent_at        = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, server_default=func.now(), nullable=False)

    system           = relationship("TestSystem", back_populates="metrics")
    values_config    = relationship("TestMetricValuesConfig",    back_populates="metric", uselist=False, cascade="all, delete-orphan")
    baseline_config  = relationship("TestMetricBaselineConfig",  back_populates="metric", uselist=False, cascade="all, delete-orphan")
    thresholds_config = relationship("TestMetricThresholdsConfig", back_populates="metric", uselist=False, cascade="all, delete-orphan")
    health_config    = relationship("TestMetricHealthConfig",    back_populates="metric", uselist=False, cascade="all, delete-orphan")
    generation_logs  = relationship("GenerationLog",             back_populates="metric", cascade="all, delete-orphan")


class TestMetricValuesConfig(Base):
    """Конфигурация значений метрики."""
    __tablename__ = "test_metric_values_config"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    test_metric_id      = Column(Integer, ForeignKey("test_metrics.id"), unique=True, nullable=False)
    enabled             = Column(Boolean, default=True, nullable=False)
    pattern             = Column(String(50), default="random", nullable=False)
    value_min           = Column(Numeric, default=0, nullable=False)
    value_max           = Column(Numeric, default=100, nullable=False)
    sine_period_min     = Column(Integer, default=60, nullable=True)
    spike_interval_min  = Column(Integer, default=15, nullable=True)

    metric = relationship("TestMetric", back_populates="values_config")


class TestMetricBaselineConfig(Base):
    """Конфигурация базовой линии."""
    __tablename__ = "test_metric_baseline_config"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    test_metric_id = Column(Integer, ForeignKey("test_metrics.id"), unique=True, nullable=False)
    enabled        = Column(Boolean, default=False, nullable=False)
    calc_method    = Column(String(20), default="offset", nullable=False)  # fixed | offset
    fixed_value    = Column(Numeric, nullable=True)
    offset_value   = Column(Numeric, default=0, nullable=True)

    metric = relationship("TestMetric", back_populates="baseline_config")


class TestMetricThresholdsConfig(Base):
    """Конфигурация порогов."""
    __tablename__ = "test_metric_thresholds_config"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    test_metric_id        = Column(Integer, ForeignKey("test_metrics.id"), unique=True, nullable=False)
    enabled               = Column(Boolean, default=False, nullable=False)
    combination_selector  = Column(String(10), default="worst", nullable=False)  # best | worst
    threshold_type        = Column(String(20), default="threshold", nullable=False)  # threshold | baseline
    exceed_enabled        = Column(Boolean, default=False, nullable=False)
    exceed_level          = Column(Integer, nullable=True)          # 3 (Warning) | 5 (Critical)
    exceed_mode           = Column(String(20), nullable=True)       # always | periodic | once
    exceed_interval_min   = Column(Integer, nullable=True)

    metric         = relationship("TestMetric", back_populates="thresholds_config")
    threshold_rows = relationship("TestMetricThresholdRow", back_populates="thresholds_config", cascade="all, delete-orphan")


class TestMetricThresholdRow(Base):
    """Строки порогов (до 5 на метрику)."""
    __tablename__ = "test_metric_threshold_rows"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    thresholds_config_id = Column(Integer, ForeignKey("test_metric_thresholds_config.id"), nullable=False)
    health_type          = Column(Integer, nullable=False)     # 1-5
    min_value            = Column(Numeric, nullable=True)      # null = -∞
    max_value            = Column(Numeric, nullable=True)      # null = +∞
    is_percent           = Column(Boolean, default=False, nullable=False)

    thresholds_config = relationship("TestMetricThresholdsConfig", back_populates="threshold_rows")


class TestMetricHealthConfig(Base):
    """Конфигурация здоровья."""
    __tablename__ = "test_metric_health_config"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    test_metric_id    = Column(Integer, ForeignKey("test_metrics.id"), unique=True, nullable=False)
    enabled           = Column(Boolean, default=False, nullable=False)
    calc_method       = Column(String(20), default="auto", nullable=False)  # auto | fixed | pattern
    fixed_status      = Column(Integer, nullable=True)       # 1-5
    health_pattern    = Column(String(20), nullable=True)    # stable_ok | degrading | flapping
    flap_interval_min = Column(Integer, default=5, nullable=True)
    degrade_hours     = Column(Integer, default=4, nullable=True)

    metric = relationship("TestMetric", back_populates="health_config")


class GenerationLog(Base):
    """Лог отправок (ротация: записи старше 7 дней удаляются)."""
    __tablename__ = "generation_log"

    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    test_metric_id  = Column(Integer, ForeignKey("test_metrics.id"), nullable=False)
    sent_at         = Column(DateTime, server_default=func.now(), nullable=False)
    value_sent      = Column(Numeric, nullable=True)
    baseline_sent   = Column(Numeric, nullable=True)
    health_sent     = Column(Integer, nullable=True)
    thresholds_sent = Column(Boolean, default=False, nullable=False)
    kafka_offset    = Column(BigInteger, nullable=True)
    status          = Column(String(20), nullable=False)   # success | error
    error_message   = Column(Text, nullable=True)
    message_json    = Column(Text, nullable=True)

    metric = relationship("TestMetric", back_populates="generation_logs")


class MetricsSettings(Base):
    """Настройки Kafka и прочие параметры (ключ-значение).
    Значения из UI перекрывают переменные окружения для планировщика.
    """
    __tablename__ = "metrics_settings"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    key         = Column(String(100), unique=True, nullable=False)
    value       = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())
