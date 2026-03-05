"""
REST-эндпоинты для конфигурации генерации метрик (Message Builder).
Итерация 2: чтение/запись конфигов + ручная отправка + логи + превью.
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.postgres import get_db
from db.metrics_models import (
    TestMetric, TestMetricValuesConfig, TestMetricBaselineConfig,
    TestMetricThresholdsConfig, TestMetricThresholdRow,
    TestMetricHealthConfig, GenerationLog,
)

router = APIRouter()

# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ValuesConfigUpdate(BaseModel):
    pattern:            str   = "random"
    value_min:          float = 0.0
    value_max:          float = 100.0
    sine_period_min:    Optional[int] = None
    spike_interval_min: Optional[int] = None


class BaselineConfigUpdate(BaseModel):
    enabled:      bool            = False
    calc_method:  str             = "offset"
    fixed_value:  Optional[float] = None
    offset_value: Optional[float] = 0.0


class ThresholdRowInput(BaseModel):
    health_type: int
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None
    is_percent:  bool = False


class ThresholdsConfigUpdate(BaseModel):
    enabled:              bool  = False
    combination_selector: str   = "worst"
    threshold_type:       str   = "threshold"
    exceed_enabled:       bool  = False
    exceed_level:         Optional[int] = None
    exceed_mode:          Optional[str] = None
    exceed_interval_min:  Optional[int] = None
    rows:                 list[ThresholdRowInput] = []


class HealthConfigUpdate(BaseModel):
    enabled:           bool            = False
    calc_method:       str             = "auto"
    fixed_status:      Optional[int]   = None
    health_pattern:    Optional[str]   = None
    flap_interval_min: Optional[int]   = 5
    degrade_hours:     Optional[int]   = 4


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_metric_or_404(metric_id: int, db: Session) -> TestMetric:
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    return m


def _ser_values(vc: Optional[TestMetricValuesConfig]) -> dict:
    if not vc:
        return {"pattern": "random", "value_min": 0.0, "value_max": 100.0,
                "sine_period_min": None, "spike_interval_min": None}
    return {
        "pattern":            vc.pattern,
        "value_min":          float(vc.value_min),
        "value_max":          float(vc.value_max),
        "sine_period_min":    vc.sine_period_min,
        "spike_interval_min": vc.spike_interval_min,
    }


def _ser_baseline(bc: Optional[TestMetricBaselineConfig]) -> dict:
    if not bc:
        return {"enabled": False, "calc_method": "offset", "fixed_value": None, "offset_value": 0.0}
    return {
        "enabled":      bc.enabled,
        "calc_method":  bc.calc_method,
        "fixed_value":  float(bc.fixed_value) if bc.fixed_value is not None else None,
        "offset_value": float(bc.offset_value) if bc.offset_value is not None else None,
    }


def _ser_thresholds(tc: Optional[TestMetricThresholdsConfig]) -> dict:
    if not tc:
        return {"enabled": False, "combination_selector": "worst", "threshold_type": "threshold",
                "exceed_enabled": False, "exceed_level": None, "exceed_mode": None,
                "exceed_interval_min": None, "rows": []}
    return {
        "enabled":              tc.enabled,
        "combination_selector": tc.combination_selector,
        "threshold_type":       tc.threshold_type,
        "exceed_enabled":       tc.exceed_enabled,
        "exceed_level":         tc.exceed_level,
        "exceed_mode":          tc.exceed_mode,
        "exceed_interval_min":  tc.exceed_interval_min,
        "rows": [
            {
                "id":          r.id,
                "health_type": r.health_type,
                "min_value":   float(r.min_value) if r.min_value is not None else None,
                "max_value":   float(r.max_value) if r.max_value is not None else None,
                "is_percent":  r.is_percent,
            }
            for r in tc.threshold_rows
        ],
    }


def _ser_health(hc: Optional[TestMetricHealthConfig]) -> dict:
    if not hc:
        return {"enabled": False, "calc_method": "auto", "fixed_status": None,
                "health_pattern": None, "flap_interval_min": 5, "degrade_hours": 4}
    return {
        "enabled":           hc.enabled,
        "calc_method":       hc.calc_method,
        "fixed_status":      hc.fixed_status,
        "health_pattern":    hc.health_pattern,
        "flap_interval_min": hc.flap_interval_min,
        "degrade_hours":     hc.degrade_hours,
    }


def _ser_log(log: GenerationLog) -> dict:
    return {
        "id":             log.id,
        "sentAt":         log.sent_at.isoformat() if log.sent_at else None,
        "valueSent":      float(log.value_sent) if log.value_sent is not None else None,
        "baselineSent":   float(log.baseline_sent) if log.baseline_sent is not None else None,
        "healthSent":     log.health_sent,
        "thresholdsSent": log.thresholds_sent,
        "kafkaOffset":    log.kafka_offset,
        "status":         log.status,
        "errorMessage":   log.error_message,
        "messageJson":    log.message_json,
    }


def _build_rows(tc: TestMetricThresholdsConfig) -> list[dict]:
    return [
        {
            "health_type": r.health_type,
            "min_value":   float(r.min_value) if r.min_value is not None else None,
            "max_value":   float(r.max_value) if r.max_value is not None else None,
            "is_percent":  r.is_percent,
        }
        for r in tc.threshold_rows
    ] if tc and tc.threshold_rows else []


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/metrics/metrics/{metric_id}/builder")
def get_builder(metric_id: int, db: Session = Depends(get_db)):
    """Все 4 конфига метрики одним запросом."""
    m = _get_metric_or_404(metric_id, db)
    return {
        "metricId":        m.id,
        "metricName":      m.metric_name,
        "metricPeriodSec": m.metric_period_sec,
        "isActive":        m.is_active,
        "valuesConfig":    _ser_values(m.values_config),
        "baselineConfig":  _ser_baseline(m.baseline_config),
        "thresholdsConfig": _ser_thresholds(m.thresholds_config),
        "healthConfig":    _ser_health(m.health_config),
    }


@router.put("/api/metrics/metrics/{metric_id}/values-config")
def update_values(metric_id: int, body: ValuesConfigUpdate, db: Session = Depends(get_db)):
    m = _get_metric_or_404(metric_id, db)
    if body.pattern not in {"constant", "random", "sine", "spike"}:
        raise HTTPException(400, "pattern должен быть одним из: constant, random, sine, spike")
    if body.value_min > body.value_max:
        raise HTTPException(400, "value_min не может быть больше value_max")

    vc = m.values_config
    if not vc:
        vc = TestMetricValuesConfig(test_metric_id=metric_id)
        db.add(vc)

    vc.pattern            = body.pattern
    vc.value_min          = body.value_min
    vc.value_max          = body.value_max
    vc.sine_period_min    = body.sine_period_min
    vc.spike_interval_min = body.spike_interval_min
    db.commit()
    db.refresh(vc)
    return _ser_values(vc)


@router.put("/api/metrics/metrics/{metric_id}/baseline-config")
def update_baseline(metric_id: int, body: BaselineConfigUpdate, db: Session = Depends(get_db)):
    m = _get_metric_or_404(metric_id, db)
    if body.calc_method not in {"fixed", "offset"}:
        raise HTTPException(400, "calc_method должен быть fixed или offset")

    bc = m.baseline_config
    if not bc:
        bc = TestMetricBaselineConfig(test_metric_id=metric_id)
        db.add(bc)

    bc.enabled      = body.enabled
    bc.calc_method  = body.calc_method
    bc.fixed_value  = body.fixed_value
    bc.offset_value = body.offset_value
    db.commit()
    db.refresh(bc)
    return _ser_baseline(bc)


@router.put("/api/metrics/metrics/{metric_id}/thresholds-config")
def update_thresholds(metric_id: int, body: ThresholdsConfigUpdate, db: Session = Depends(get_db)):
    m = _get_metric_or_404(metric_id, db)
    if len(body.rows) > 5:
        raise HTTPException(400, "Максимум 5 строк порогов")

    tc = m.thresholds_config
    if not tc:
        tc = TestMetricThresholdsConfig(test_metric_id=metric_id)
        db.add(tc)
        db.flush()

    tc.enabled              = body.enabled
    tc.combination_selector = body.combination_selector
    tc.threshold_type       = body.threshold_type
    tc.exceed_enabled       = body.exceed_enabled
    tc.exceed_level         = body.exceed_level
    tc.exceed_mode          = body.exceed_mode
    tc.exceed_interval_min  = body.exceed_interval_min

    for r in list(tc.threshold_rows):
        db.delete(r)
    db.flush()

    for row in body.rows:
        if row.health_type not in range(1, 6):
            raise HTTPException(400, "health_type должен быть от 1 до 5")
        db.add(TestMetricThresholdRow(
            thresholds_config_id=tc.id,
            health_type=row.health_type,
            min_value=row.min_value,
            max_value=row.max_value,
            is_percent=row.is_percent,
        ))

    db.commit()
    db.refresh(tc)
    return _ser_thresholds(tc)


@router.put("/api/metrics/metrics/{metric_id}/health-config")
def update_health(metric_id: int, body: HealthConfigUpdate, db: Session = Depends(get_db)):
    m = _get_metric_or_404(metric_id, db)
    if body.calc_method not in {"auto", "fixed", "pattern"}:
        raise HTTPException(400, "calc_method должен быть auto, fixed или pattern")
    if body.calc_method == "fixed" and body.fixed_status not in range(1, 6):
        raise HTTPException(400, "fixed_status должен быть от 1 до 5")
    if body.calc_method == "pattern" and body.health_pattern not in {
        "stable_ok", "degrading", "flapping"
    }:
        raise HTTPException(400, "health_pattern должен быть stable_ok, degrading или flapping")

    hc = m.health_config
    if not hc:
        hc = TestMetricHealthConfig(test_metric_id=metric_id)
        db.add(hc)

    hc.enabled           = body.enabled
    hc.calc_method       = body.calc_method
    hc.fixed_status      = body.fixed_status
    hc.health_pattern    = body.health_pattern
    hc.flap_interval_min = body.flap_interval_min
    hc.degrade_hours     = body.degrade_hours
    db.commit()
    db.refresh(hc)
    return _ser_health(hc)


@router.post("/api/metrics/metrics/{metric_id}/send-now")
async def send_now(metric_id: int, db: Session = Depends(get_db)):
    """Немедленная отправка одного сообщения (вне расписания)."""
    from agents.metrics_message_builder import (
        generate_value, calculate_baseline, calculate_health, build_kafka_message,
    )
    from backend.api.metrics_settings import get_kafka_config
    from agents.kafka_client import KafkaClient

    m = _get_metric_or_404(metric_id, db)
    system = m.system
    if not system:
        raise HTTPException(400, "Метрика не привязана к услуге")

    vc = m.values_config
    bc = m.baseline_config
    tc = m.thresholds_config
    hc = m.health_config
    rows = _build_rows(tc)

    value = generate_value(
        pattern=vc.pattern if vc else "random",
        value_min=float(vc.value_min) if vc else 0.0,
        value_max=float(vc.value_max) if vc else 100.0,
        sine_period_min=vc.sine_period_min if vc else None,
        spike_interval_min=vc.spike_interval_min if vc else None,
    )
    baseline = calculate_baseline(
        enabled=bc.enabled if bc else False,
        calc_method=bc.calc_method if bc else "offset",
        current_value=value,
        fixed_value=float(bc.fixed_value) if bc and bc.fixed_value is not None else None,
        offset_value=float(bc.offset_value) if bc and bc.offset_value is not None else None,
    )
    health = calculate_health(
        metric_id=metric_id,
        enabled=hc.enabled if hc else False,
        calc_method=hc.calc_method if hc else "auto",
        value=value,
        fixed_status=hc.fixed_status if hc else None,
        health_pattern=hc.health_pattern if hc else None,
        flap_interval_min=hc.flap_interval_min if hc else None,
        degrade_hours=hc.degrade_hours if hc else None,
        metric_created_at=m.created_at,
        thresholds_enabled=tc.enabled if tc else False,
        combination_selector=tc.combination_selector if tc else "worst",
        threshold_rows=rows,
    )

    msg = build_kafka_message(
        metric_hash=m.metric_hash, metric_name=m.metric_name,
        metric_description=m.metric_description, metric_type=m.metric_type,
        metric_group=m.metric_group, metric_unit=m.metric_unit,
        metric_period_sec=m.metric_period_sec, object_ci=m.object_ci,
        object_id=m.object_id, object_name=m.object_name, object_type=m.object_type,
        mon_system_metric_id=m.mon_system_metric_id,
        purpose_type_hint=m.purpose_type_hint, spec_version=m.spec_version,
        it_service_ci=system.it_service_ci, mon_system_ci=system.mon_system_ci,
        value=value, baseline=baseline, health=health,
        thresholds_enabled=tc.enabled if tc else False,
        threshold_rows=rows,
        combination_selector=tc.combination_selector if tc else "worst",
        threshold_type=tc.threshold_type if tc else "threshold",
    )
    msg_str = json.dumps(msg, ensure_ascii=False)

    kafka_cfg = get_kafka_config(db)
    topic = kafka_cfg.get("kafka_topic", "metadata")

    def _send_sync():
        return KafkaClient.send(topic, msg_str, key=m.metric_hash)

    try:
        result = await asyncio.to_thread(_send_sync)
        m.last_sent_at = datetime.now(timezone.utc)
        db.add(GenerationLog(
            test_metric_id=metric_id,
            value_sent=value,
            baseline_sent=baseline,
            health_sent=health,
            thresholds_sent=bool(tc and tc.enabled),
            kafka_offset=result.get("offset"),
            status="success",
            message_json=msg_str,
        ))
        db.commit()
        return {
            "ok":         True,
            "value":      value,
            "baseline":   baseline,
            "health":     health,
            "offset":     result.get("offset"),
            "partition":  result.get("partition"),
            "topic":      topic,
            "messageJson": msg_str,
        }
    except Exception as e:
        db.add(GenerationLog(
            test_metric_id=metric_id,
            status="error",
            error_message=str(e)[:2000],
        ))
        db.commit()
        return {"ok": False, "error": str(e)}


@router.get("/api/metrics/metrics/{metric_id}/logs")
def get_logs(metric_id: int, limit: int = 20, db: Session = Depends(get_db)):
    _get_metric_or_404(metric_id, db)
    logs = (
        db.query(GenerationLog)
        .filter(GenerationLog.test_metric_id == metric_id)
        .order_by(GenerationLog.sent_at.desc())
        .limit(min(limit, 100))
        .all()
    )
    return {"logs": [_ser_log(log) for log in logs]}


@router.get("/api/metrics/metrics/{metric_id}/preview")
def preview_message(metric_id: int, db: Session = Depends(get_db)):
    """Генерирует превью сообщения без отправки в Kafka."""
    from agents.metrics_message_builder import build_preview

    m = _get_metric_or_404(metric_id, db)
    system = m.system
    if not system:
        raise HTTPException(400, "Метрика не привязана к услуге")

    tc = m.thresholds_config
    rows = _build_rows(tc)

    return build_preview(
        metric_id=metric_id,
        metric_hash=m.metric_hash, metric_name=m.metric_name,
        metric_description=m.metric_description, metric_type=m.metric_type,
        metric_group=m.metric_group, metric_unit=m.metric_unit,
        metric_period_sec=m.metric_period_sec, object_ci=m.object_ci,
        object_id=m.object_id, object_name=m.object_name, object_type=m.object_type,
        mon_system_metric_id=m.mon_system_metric_id,
        purpose_type_hint=m.purpose_type_hint, spec_version=m.spec_version,
        it_service_ci=system.it_service_ci, mon_system_ci=system.mon_system_ci,
        metric_created_at=m.created_at,
        values_cfg=_ser_values(m.values_config),
        baseline_cfg=_ser_baseline(m.baseline_config),
        health_cfg=_ser_health(m.health_config),
        thresholds_cfg=_ser_thresholds(tc),
        threshold_rows=rows,
    )
