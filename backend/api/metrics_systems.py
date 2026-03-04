"""
CRUD для услуг и метрик Генератора метрик.
Итерация 1: управление услугами + создание/удаление/переключение метрик.
"""

import hashlib
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.postgres import get_db
from db.metrics_models import (
    TestSystem, TestMetric,
    TestMetricValuesConfig, TestMetricBaselineConfig,
    TestMetricThresholdsConfig, TestMetricHealthConfig,
)

router = APIRouter()

CI_RE = re.compile(r"^CI\d{8}$")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _check_ci(ci: str, field: str):
    if not CI_RE.match(ci):
        raise HTTPException(400, f"{field} должен быть формата CI + 8 цифр (например CI05084264)")


def _compute_hash(it_service_ci: str, mon_system_ci: str, object_id: str, mon_system_metric_id: str) -> str:
    raw = it_service_ci + mon_system_ci + object_id + mon_system_metric_id
    return hashlib.sha256(raw.encode()).hexdigest()


def _system_row(s: TestSystem, db: Session) -> dict:
    total  = db.query(func.count(TestMetric.id)).filter(TestMetric.test_system_id == s.id).scalar() or 0
    active = db.query(func.count(TestMetric.id)).filter(
        TestMetric.test_system_id == s.id, TestMetric.is_active == True
    ).scalar() or 0
    last_sent = db.query(func.max(TestMetric.last_sent_at)).filter(
        TestMetric.test_system_id == s.id
    ).scalar()
    return {
        "id":            s.id,
        "itServiceCi":   s.it_service_ci,
        "name":          s.name,
        "monSystemCi":   s.mon_system_ci,
        "isActive":      s.is_active,
        "metricsTotal":  total,
        "metricsActive": active,
        "lastSentAt":    last_sent.isoformat() if last_sent else None,
        "createdAt":     s.created_at.isoformat(),
    }


def _metric_row(m: TestMetric) -> dict:
    return {
        "id":                 m.id,
        "testSystemId":       m.test_system_id,
        "metricHash":         m.metric_hash,
        "metricName":         m.metric_name,
        "metricDescription":  m.metric_description,
        "metricType":         m.metric_type,
        "metricGroup":        m.metric_group,
        "metricUnit":         m.metric_unit,
        "metricPeriodSec":    m.metric_period_sec,
        "objectCi":           m.object_ci,
        "objectId":           m.object_id,
        "objectName":         m.object_name,
        "objectType":         m.object_type,
        "monSystemMetricId":  m.mon_system_metric_id,
        "purposeTypeHint":    m.purpose_type_hint,
        "specVersion":        m.spec_version,
        "isActive":           m.is_active,
        "lastSentAt":         m.last_sent_at.isoformat() if m.last_sent_at else None,
        "createdAt":          m.created_at.isoformat(),
    }


# ── Systems ───────────────────────────────────────────────────────────────────

class SystemCreate(BaseModel):
    itServiceCi: str
    name: str
    monSystemCi: str


class SystemUpdate(BaseModel):
    name: Optional[str] = None
    monSystemCi: Optional[str] = None


@router.get("/api/metrics/systems")
def get_systems(db: Session = Depends(get_db)):
    systems = db.query(TestSystem).order_by(TestSystem.created_at.desc()).all()
    total_metrics  = db.query(func.count(TestMetric.id)).scalar() or 0
    active_metrics = db.query(func.count(TestMetric.id)).filter(TestMetric.is_active == True).scalar() or 0
    return {
        "systems":       [_system_row(s, db) for s in systems],
        "totalSystems":  len(systems),
        "activeSystems": sum(1 for s in systems if s.is_active),
        "totalMetrics":  total_metrics,
        "activeMetrics": active_metrics,
    }


@router.post("/api/metrics/systems", status_code=201)
def create_system(body: SystemCreate, db: Session = Depends(get_db)):
    _check_ci(body.itServiceCi, "itServiceCi")
    _check_ci(body.monSystemCi, "monSystemCi")
    if not body.name.strip():
        raise HTTPException(400, "name обязательно")
    if db.query(TestSystem).filter(TestSystem.it_service_ci == body.itServiceCi).first():
        raise HTTPException(409, f"Услуга {body.itServiceCi} уже существует")
    if db.query(func.count(TestSystem.id)).scalar() >= 50:
        raise HTTPException(400, "Достигнут лимит в 50 услуг")

    s = TestSystem(
        it_service_ci=body.itServiceCi,
        name=body.name.strip(),
        mon_system_ci=body.monSystemCi,
        is_active=False,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _system_row(s, db)


@router.put("/api/metrics/systems/{system_id}")
def update_system(system_id: int, body: SystemUpdate, db: Session = Depends(get_db)):
    s = db.query(TestSystem).filter(TestSystem.id == system_id).first()
    if not s:
        raise HTTPException(404, "Услуга не найдена")
    if body.name is not None:
        s.name = body.name.strip()
    if body.monSystemCi is not None:
        _check_ci(body.monSystemCi, "monSystemCi")
        s.mon_system_ci = body.monSystemCi
    db.commit()
    db.refresh(s)
    return _system_row(s, db)


@router.delete("/api/metrics/systems/{system_id}")
def delete_system(system_id: int, db: Session = Depends(get_db)):
    s = db.query(TestSystem).filter(TestSystem.id == system_id).first()
    if not s:
        raise HTTPException(404, "Услуга не найдена")
    db.delete(s)
    db.commit()
    return {"status": "deleted", "id": system_id}


@router.post("/api/metrics/systems/{system_id}/toggle")
def toggle_system(system_id: int, db: Session = Depends(get_db)):
    s = db.query(TestSystem).filter(TestSystem.id == system_id).first()
    if not s:
        raise HTTPException(404, "Услуга не найдена")
    s.is_active = not s.is_active
    # TODO iteration 2: start/stop scheduler for all metrics of this system
    db.commit()
    return {"id": system_id, "isActive": s.is_active}


@router.post("/api/metrics/toggle-all")
def toggle_all(action: str = "start", db: Session = Depends(get_db)):
    """action: 'start' | 'stop'"""
    new_state = (action == "start")
    db.query(TestSystem).update({"is_active": new_state})
    # TODO iteration 2: start/stop scheduler
    db.commit()
    return {"action": action, "ok": True}


# ── Metrics ───────────────────────────────────────────────────────────────────

class MetricCreate(BaseModel):
    metricName: str
    metricDescription: str
    metricType: str          # Availability | Errors | Latency | Traffic | Saturation | Other
    metricGroup: str         # App | Infra
    metricUnit: str
    metricPeriodSec: int = 60
    objectCi: Optional[str] = None
    objectId: str
    objectName: str
    objectType: Optional[str] = None   # null | AI-AGENT
    monSystemMetricId: str
    purposeTypeHint: Optional[int] = None
    specVersion: str = "1.0"


VALID_TYPES  = {"Availability", "Errors", "Latency", "Traffic", "Saturation", "Other"}
VALID_GROUPS = {"App", "Infra"}


@router.get("/api/metrics/systems/{system_id}/metrics")
def get_system_metrics(system_id: int, db: Session = Depends(get_db)):
    if not db.query(TestSystem).filter(TestSystem.id == system_id).first():
        raise HTTPException(404, "Услуга не найдена")
    metrics = (
        db.query(TestMetric)
        .filter(TestMetric.test_system_id == system_id)
        .order_by(TestMetric.created_at.desc())
        .all()
    )
    return {"metrics": [_metric_row(m) for m in metrics]}


@router.post("/api/metrics/systems/{system_id}/metrics", status_code=201)
def create_metric(system_id: int, body: MetricCreate, db: Session = Depends(get_db)):
    s = db.query(TestSystem).filter(TestSystem.id == system_id).first()
    if not s:
        raise HTTPException(404, "Услуга не найдена")

    if body.metricType not in VALID_TYPES:
        raise HTTPException(400, f"metricType должен быть одним из: {', '.join(VALID_TYPES)}")
    if body.metricGroup not in VALID_GROUPS:
        raise HTTPException(400, f"metricGroup должен быть одним из: {', '.join(VALID_GROUPS)}")
    if body.metricPeriodSec < 10:
        raise HTTPException(400, "Минимальный период отправки — 10 секунд")

    # Лимиты
    sys_count   = db.query(func.count(TestMetric.id)).filter(TestMetric.test_system_id == system_id).scalar() or 0
    total_count = db.query(func.count(TestMetric.id)).scalar() or 0
    if sys_count >= 100:
        raise HTTPException(400, "Достигнут лимит в 100 метрик на услугу")
    if total_count >= 1000:
        raise HTTPException(400, "Достигнут глобальный лимит в 1000 метрик")

    metric_hash = _compute_hash(s.it_service_ci, s.mon_system_ci, body.objectId, body.monSystemMetricId)
    if db.query(TestMetric).filter(TestMetric.metric_hash == metric_hash).first():
        raise HTTPException(409, "Метрика с такими ключевыми полями уже существует (hash совпадает)")

    m = TestMetric(
        test_system_id       = system_id,
        metric_hash          = metric_hash,
        metric_name          = body.metricName.strip(),
        metric_description   = body.metricDescription.strip(),
        metric_type          = body.metricType,
        metric_group         = body.metricGroup,
        metric_unit          = body.metricUnit.strip(),
        metric_period_sec    = body.metricPeriodSec,
        object_ci            = body.objectCi or None,
        object_id            = body.objectId.strip(),
        object_name          = body.objectName.strip(),
        object_type          = body.objectType or None,
        mon_system_metric_id = body.monSystemMetricId.strip(),
        purpose_type_hint    = body.purposeTypeHint,
        spec_version         = body.specVersion or "1.0",
        is_active            = False,
    )
    db.add(m)
    db.flush()

    # Создаём дефолтные конфиги для всех секций
    db.add(TestMetricValuesConfig(test_metric_id=m.id))
    db.add(TestMetricBaselineConfig(test_metric_id=m.id))
    db.add(TestMetricThresholdsConfig(test_metric_id=m.id))
    db.add(TestMetricHealthConfig(test_metric_id=m.id))

    db.commit()
    db.refresh(m)
    return _metric_row(m)


@router.get("/api/metrics/metrics/{metric_id}")
def get_metric(metric_id: int, db: Session = Depends(get_db)):
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    return _metric_row(m)


@router.delete("/api/metrics/metrics/{metric_id}")
def delete_metric(metric_id: int, db: Session = Depends(get_db)):
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    db.delete(m)
    db.commit()
    return {"status": "deleted", "id": metric_id}


@router.post("/api/metrics/metrics/{metric_id}/toggle")
def toggle_metric(metric_id: int, db: Session = Depends(get_db)):
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    m.is_active = not m.is_active
    # TODO iteration 2: start/stop scheduler for this metric
    db.commit()
    return {"id": metric_id, "isActive": m.is_active}


# ── Dashboard stats ───────────────────────────────────────────────────────────

@router.get("/api/metrics/status")
def get_status(db: Session = Depends(get_db)):
    """Быстрый дашборд: счётчики для шапки."""
    total_systems  = db.query(func.count(TestSystem.id)).scalar() or 0
    active_systems = db.query(func.count(TestSystem.id)).filter(TestSystem.is_active == True).scalar() or 0
    total_metrics  = db.query(func.count(TestMetric.id)).scalar() or 0
    active_metrics = db.query(func.count(TestMetric.id)).filter(TestMetric.is_active == True).scalar() or 0
    return {
        "totalSystems":  total_systems,
        "activeSystems": active_systems,
        "totalMetrics":  total_metrics,
        "activeMetrics": active_metrics,
    }
