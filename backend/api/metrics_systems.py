"""
CRUD для услуг и метрик Генератора метрик.
Итерация 1: управление услугами + создание/удаление/переключение метрик.
"""

import hashlib
import re
import uuid
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
    GenerationLog,
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


def _metric_row(m: TestMetric, last_value: float | None = None, last_health: int | None = None) -> dict:
    vc = m.values_config
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
        "lastSentValue":      last_value,
        "lastSentHealth":     last_health,
        "createdAt":          m.created_at.isoformat(),
        "valuePattern":       vc.pattern if vc else "random",
        "valueMin":           float(vc.value_min) if vc else 0.0,
        "valueMax":           float(vc.value_max) if vc else 100.0,
    }


def _last_value(metric_id: int, db: Session) -> tuple[float | None, int | None]:
    """Последнее отправленное значение + health из GenerationLog."""
    log = (
        db.query(GenerationLog.value_sent, GenerationLog.health_sent)
        .filter(GenerationLog.test_metric_id == metric_id)
        .order_by(GenerationLog.id.desc())
        .first()
    )
    if not log:
        return None, None
    val = float(log.value_sent) if log.value_sent is not None else None
    hlt = int(log.health_sent) if log.health_sent is not None else None
    return val, hlt


def _last_values_bulk(metric_ids: list[int], db: Session) -> dict[int, tuple[float | None, int | None]]:
    """Batch-версия: один запрос для всего списка метрик, возвращает (value, health)."""
    if not metric_ids:
        return {}
    sub = (
        db.query(
            GenerationLog.test_metric_id,
            func.max(GenerationLog.id).label("lid"),
        )
        .filter(GenerationLog.test_metric_id.in_(metric_ids))
        .group_by(GenerationLog.test_metric_id)
        .subquery()
    )
    rows = (
        db.query(GenerationLog.test_metric_id, GenerationLog.value_sent, GenerationLog.health_sent)
        .join(sub, GenerationLog.id == sub.c.lid)
        .all()
    )
    return {
        r.test_metric_id: (
            float(r.value_sent) if r.value_sent is not None else None,
            int(r.health_sent) if r.health_sent is not None else None,
        )
        for r in rows
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
async def toggle_system(system_id: int, db: Session = Depends(get_db)):
    from agents.metrics_scheduler import scheduler
    s = db.query(TestSystem).filter(TestSystem.id == system_id).first()
    if not s:
        raise HTTPException(404, "Услуга не найдена")
    s.is_active = not s.is_active
    db.commit()
    all_metrics = db.query(TestMetric).filter(TestMetric.test_system_id == system_id).all()
    if s.is_active:
        # Активируем все метрики услуги при включении
        db.query(TestMetric).filter(TestMetric.test_system_id == system_id).update({"is_active": True})
        db.commit()
        for m in all_metrics:
            await scheduler.start_metric(m.id)
    else:
        db.query(TestMetric).filter(TestMetric.test_system_id == system_id).update({"is_active": False})
        db.commit()
        for m in all_metrics:
            await scheduler.stop_metric(m.id)
    return {"id": system_id, "isActive": s.is_active}


@router.post("/api/metrics/toggle-all")
async def toggle_all(action: str = "start", db: Session = Depends(get_db)):
    """action: 'start' | 'stop'"""
    from agents.metrics_scheduler import scheduler
    new_state = (action == "start")
    db.query(TestSystem).update({"is_active": new_state})
    db.query(TestMetric).update({"is_active": new_state})
    db.commit()
    if new_state:
        await scheduler.start_all()
    else:
        await scheduler.stop_all()
    return {"action": action, "ok": True}


# ── Metrics ───────────────────────────────────────────────────────────────────

class MetricCreate(BaseModel):
    metricName:      str
    metricType:      str           # Availability | Errors | Latency | Traffic | Saturation | Other
    metricUnit:      str = ""
    metricPeriodSec: int = 60
    ke:              Optional[str] = None   # КЭ: CI-код (CI\d{8}) или название
    valueMin:        float = 0.0
    valueMax:        float = 100.0
    valuePattern:    str = "random"


class MetricUpdate(BaseModel):
    metricName:      Optional[str]   = None
    metricType:      Optional[str]   = None
    metricUnit:      Optional[str]   = None
    metricPeriodSec: Optional[int]   = None
    ke:              Optional[str]   = None
    valueMin:        Optional[float] = None
    valueMax:        Optional[float] = None
    valuePattern:    Optional[str]   = None


VALID_TYPES    = {"Availability", "Errors", "Latency", "Traffic", "Saturation", "Other"}
VALID_PATTERNS = {"constant", "random", "sine", "spike"}
CI_METRIC_RE   = re.compile(r"^CI\d{8}$")


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
    last_val = _last_values_bulk([m.id for m in metrics], db)
    return {"metrics": [_metric_row(m, *last_val.get(m.id, (None, None))) for m in metrics]}


@router.post("/api/metrics/systems/{system_id}/metrics", status_code=201)
async def create_metric(system_id: int, body: MetricCreate, db: Session = Depends(get_db)):
    s = db.query(TestSystem).filter(TestSystem.id == system_id).first()
    if not s:
        raise HTTPException(404, "Услуга не найдена")

    if body.metricType not in VALID_TYPES:
        raise HTTPException(400, f"metricType должен быть одним из: {', '.join(sorted(VALID_TYPES))}")
    if body.metricPeriodSec < 10:
        raise HTTPException(400, "Минимальный период отправки — 10 секунд")

    # Лимиты
    sys_count   = db.query(func.count(TestMetric.id)).filter(TestMetric.test_system_id == system_id).scalar() or 0
    total_count = db.query(func.count(TestMetric.id)).scalar() or 0
    if sys_count >= 100:
        raise HTTPException(400, "Достигнут лимит в 100 метрик на услугу")
    if total_count >= 1000:
        raise HTTPException(400, "Достигнут глобальный лимит в 1000 метрик")

    # Автогенерация полей объекта из КЭ или услуги
    ke = (body.ke or "").strip()
    ke_is_ci   = bool(CI_METRIC_RE.match(ke)) if ke else False
    object_id  = ke if ke_is_ci else s.it_service_ci
    object_name = ke if ke else s.name
    object_ci  = ke if ke_is_ci else None
    mon_sm_id  = uuid.uuid4().hex[:16]     # временно; заменит NetWall на контуре ИФТ

    metric_hash = _compute_hash(s.it_service_ci, s.mon_system_ci, object_id, mon_sm_id)

    pattern = body.valuePattern if body.valuePattern in VALID_PATTERNS else "random"

    m = TestMetric(
        test_system_id       = system_id,
        metric_hash          = metric_hash,
        metric_name          = body.metricName.strip(),
        metric_description   = "",
        metric_type          = body.metricType,
        metric_group         = "App",
        metric_unit          = body.metricUnit.strip(),
        metric_period_sec    = body.metricPeriodSec,
        object_ci            = object_ci,
        object_id            = object_id,
        object_name          = object_name,
        object_type          = None,
        mon_system_metric_id = mon_sm_id,
        purpose_type_hint    = None,
        spec_version         = "1.0",
        # Наследуем состояние услуги: если услуга запущена — метрика сразу активна
        is_active            = s.is_active,
    )
    db.add(m)
    db.flush()

    # Создаём конфиги: ValuesConfig с реальными min/max/pattern, остальные — дефолтные
    db.add(TestMetricValuesConfig(
        test_metric_id     = m.id,
        pattern            = pattern,
        value_min          = body.valueMin,
        value_max          = body.valueMax,
    ))
    db.add(TestMetricBaselineConfig(test_metric_id=m.id))
    db.add(TestMetricThresholdsConfig(test_metric_id=m.id))
    db.add(TestMetricHealthConfig(test_metric_id=m.id))

    db.commit()
    db.refresh(m)

    # Если услуга активна — сразу запускаем метрику в планировщике
    if m.is_active:
        from agents.metrics_scheduler import scheduler
        await scheduler.start_metric(m.id)

    return _metric_row(m)   # lastSentValue=None для только что созданной метрики


@router.get("/api/metrics/metrics/{metric_id}")
def get_metric(metric_id: int, db: Session = Depends(get_db)):
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    return _metric_row(m, *_last_value(m.id, db))


@router.patch("/api/metrics/metrics/{metric_id}")
async def update_metric(metric_id: int, body: MetricUpdate, db: Session = Depends(get_db)):
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")

    period_changed = False

    if body.metricName is not None:
        if not body.metricName.strip():
            raise HTTPException(400, "metricName не может быть пустым")
        m.metric_name = body.metricName.strip()
    if body.metricType is not None:
        if body.metricType not in VALID_TYPES:
            raise HTTPException(400, f"metricType должен быть одним из: {', '.join(sorted(VALID_TYPES))}")
        m.metric_type = body.metricType
    if body.metricUnit is not None:
        m.metric_unit = body.metricUnit.strip()
    if body.metricPeriodSec is not None:
        if body.metricPeriodSec < 10:
            raise HTTPException(400, "Минимальный период отправки — 10 секунд")
        if m.metric_period_sec != body.metricPeriodSec:
            period_changed = True
        m.metric_period_sec = body.metricPeriodSec
    if body.ke is not None:
        ke = body.ke.strip()
        ke_is_ci = bool(CI_METRIC_RE.match(ke)) if ke else False
        s = db.query(TestSystem).filter(TestSystem.id == m.test_system_id).first()
        m.object_ci   = ke if ke_is_ci else None
        m.object_id   = ke if ke_is_ci else (s.it_service_ci if s else m.object_id)
        m.object_name = ke if ke else (s.name if s else m.object_name)

    # Обновляем ValuesConfig
    vc = m.values_config
    if vc:
        if body.valueMin is not None:
            vc.value_min = body.valueMin
        if body.valueMax is not None:
            vc.value_max = body.valueMax
        if body.valuePattern is not None:
            vc.pattern = body.valuePattern if body.valuePattern in VALID_PATTERNS else "random"

    db.commit()
    db.refresh(m)

    # Перезапускаем планировщик если изменился период и метрика активна
    if period_changed and m.is_active:
        from agents.metrics_scheduler import scheduler
        await scheduler.stop_metric(metric_id)
        await scheduler.start_metric(metric_id)

    return _metric_row(m, *_last_value(m.id, db))


@router.delete("/api/metrics/metrics/{metric_id}")
def delete_metric(metric_id: int, db: Session = Depends(get_db)):
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    db.delete(m)
    db.commit()
    return {"status": "deleted", "id": metric_id}


@router.post("/api/metrics/metrics/{metric_id}/toggle")
async def toggle_metric(metric_id: int, db: Session = Depends(get_db)):
    from agents.metrics_scheduler import scheduler
    m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
    if not m:
        raise HTTPException(404, "Метрика не найдена")
    m.is_active = not m.is_active
    db.commit()
    if m.is_active:
        await scheduler.start_metric(metric_id)
    else:
        await scheduler.stop_metric(metric_id)
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
