"""
Генератор значений метрик и построитель Kafka-сообщений для Sber911.
Чистые функции без доступа к БД.
"""

import json
import math
import random
import time
from datetime import datetime, timezone
from typing import Optional


# ── Value generation ──────────────────────────────────────────────────────────

def generate_value(
    pattern: str,
    value_min: float,
    value_max: float,
    sine_period_min: Optional[int] = None,
    spike_interval_min: Optional[int] = None,
) -> float:
    """
    Генерирует числовое значение метрики по паттерну.

    Patterns:
        constant — всегда value_min
        random   — равномерное случайное в [min, max]
        sine     — синусоида min..max с периодом sine_period_min минут
        spike    — обычно value_min, последние 5% интервала = value_max
    """
    vmin = float(value_min)
    vmax = float(value_max)

    if pattern == "constant":
        return vmin

    if pattern == "random":
        return round(random.uniform(vmin, vmax), 4)

    if pattern == "sine":
        period_sec = (sine_period_min or 60) * 60
        t = time.time()
        phase = (t % period_sec) / period_sec           # 0..1
        sine_val = math.sin(2 * math.pi * phase)        # -1..1
        amplitude = (vmax - vmin) / 2
        midpoint  = (vmax + vmin) / 2
        return round(midpoint + amplitude * sine_val, 4)

    if pattern == "spike":
        interval_sec = (spike_interval_min or 15) * 60
        t = time.time()
        pos = t % interval_sec
        if pos >= interval_sec * 0.95:
            return vmax
        return vmin

    # fallback → random
    return round(random.uniform(vmin, vmax), 4)


# ── Baseline calculation ──────────────────────────────────────────────────────

def calculate_baseline(
    enabled: bool,
    calc_method: str,
    current_value: float,
    fixed_value: Optional[float] = None,
    offset_value: Optional[float] = None,
) -> Optional[float]:
    """Рассчитывает значение базовой линии или None если baseline отключён."""
    if not enabled:
        return None
    if calc_method == "fixed":
        return float(fixed_value) if fixed_value is not None else 0.0
    if calc_method == "offset":
        return round(current_value + float(offset_value or 0), 4)
    return None


# ── Health calculation ────────────────────────────────────────────────────────

def _evaluate_thresholds(
    value: float,
    threshold_rows: list[dict],
    combination_selector: str,
) -> int:
    """
    Оценивает value по threshold_rows.
    combination_selector: "best" (min health_type) | "worst" (max health_type).
    Возвращает 1 (OK) если ни одна строка не совпала.
    """
    matching = []
    for row in threshold_rows:
        min_v = row.get("min_value")
        max_v = row.get("max_value")
        lo = float(min_v) if min_v is not None else float("-inf")
        hi = float(max_v) if max_v is not None else float("inf")
        if lo <= value <= hi:
            matching.append(int(row["health_type"]))
    if not matching:
        return 1
    return min(matching) if combination_selector == "best" else max(matching)


# in-process flap counter — safe при workers=1
_flap_counter: dict[int, int] = {}


def calculate_health(
    metric_id: int,
    enabled: bool,
    calc_method: str,
    value: float,
    fixed_status: Optional[int] = None,
    health_pattern: Optional[str] = None,
    flap_interval_min: Optional[int] = None,
    degrade_hours: Optional[int] = None,
    metric_created_at: Optional[datetime] = None,
    thresholds_enabled: bool = False,
    combination_selector: str = "worst",
    threshold_rows: Optional[list[dict]] = None,
) -> Optional[int]:
    """Рассчитывает статус здоровья (1=OK .. 5=Critical) или None если отключён."""
    if not enabled:
        return None

    if calc_method == "fixed":
        return int(fixed_status or 1)

    if calc_method == "pattern":
        pat = health_pattern or "stable_ok"
        if pat == "stable_ok":
            return 1
        if pat == "degrading":
            hours = float(degrade_hours or 4)
            if metric_created_at:
                now = datetime.now(timezone.utc)
                created = metric_created_at
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                elapsed_h = (now - created).total_seconds() / 3600
                progress = min(elapsed_h / hours, 1.0)
            else:
                progress = 0.5
            return min(5, max(1, int(1 + progress * 4)))
        if pat == "flapping":
            interval_calls = max(1, int((flap_interval_min or 5) * 60 / 10))
            count = _flap_counter.get(metric_id, 0)
            _flap_counter[metric_id] = count + 1
            return 1 if (count // interval_calls) % 2 == 0 else 3
        return 1

    if calc_method == "auto":
        if thresholds_enabled and threshold_rows:
            return _evaluate_thresholds(value, threshold_rows, combination_selector)
        return 1

    return 1


# ── Kafka message builder ─────────────────────────────────────────────────────

def build_kafka_message(
    metric_hash: str,
    metric_name: str,
    metric_description: str,
    metric_type: str,
    metric_group: str,
    metric_unit: str,
    metric_period_sec: int,
    object_ci: Optional[str],
    object_id: str,
    object_name: str,
    object_type: Optional[str],
    mon_system_metric_id: str,
    purpose_type_hint: Optional[int],
    spec_version: str,
    it_service_ci: str,
    mon_system_ci: str,
    value: float,
    baseline: Optional[float],
    health: Optional[int],
    thresholds_enabled: bool = False,
    threshold_rows: Optional[list[dict]] = None,
    combination_selector: str = "worst",
    threshold_type: str = "threshold",
) -> dict:
    """Строит полное JSON-сообщение для Kafka (формат Sber911 metadata-топика)."""
    now_iso = datetime.now(timezone.utc).isoformat()

    msg: dict = {
        "specVersion":       spec_version or "1.0",
        "metricHash":        metric_hash,
        "itServiceCi":       it_service_ci,
        "monSystemCi":       mon_system_ci,
        "metricName":        metric_name,
        "metricDescription": metric_description,
        "metricType":        metric_type,
        "metricGroup":       metric_group,
        "metricUnit":        metric_unit,
        "metricPeriodSec":   metric_period_sec,
        "objectId":          object_id,
        "objectName":        object_name,
        "monSystemMetricId": mon_system_metric_id,
        "timestamp":         now_iso,
        "value":             value,
    }

    if object_ci:
        msg["objectCi"] = object_ci
    if object_type:
        msg["objectType"] = object_type
    if purpose_type_hint is not None:
        msg["purposeTypeHint"] = purpose_type_hint
    if baseline is not None:
        msg["baseline"] = baseline
    if health is not None:
        msg["healthStatus"] = health

    if thresholds_enabled and threshold_rows:
        msg["thresholds"] = {
            "combinationSelector": combination_selector,
            "thresholdType":       threshold_type,
            "rows": [
                {
                    "healthType": r["health_type"],
                    "minValue":   r["min_value"],
                    "maxValue":   r["max_value"],
                    "isPercent":  r.get("is_percent", False),
                }
                for r in threshold_rows
            ],
        }

    return msg


def build_preview(
    metric_id: int,
    metric_hash: str,
    metric_name: str,
    metric_description: str,
    metric_type: str,
    metric_group: str,
    metric_unit: str,
    metric_period_sec: int,
    object_ci: Optional[str],
    object_id: str,
    object_name: str,
    object_type: Optional[str],
    mon_system_metric_id: str,
    purpose_type_hint: Optional[int],
    spec_version: str,
    it_service_ci: str,
    mon_system_ci: str,
    metric_created_at: Optional[datetime],
    values_cfg: dict,
    baseline_cfg: dict,
    health_cfg: dict,
    thresholds_cfg: dict,
    threshold_rows: list[dict],
) -> dict:
    """Строит превью сообщения для UI (без отправки)."""
    value = generate_value(
        pattern=values_cfg.get("pattern", "random"),
        value_min=float(values_cfg.get("value_min", 0)),
        value_max=float(values_cfg.get("value_max", 100)),
        sine_period_min=values_cfg.get("sine_period_min"),
        spike_interval_min=values_cfg.get("spike_interval_min"),
    )

    baseline = calculate_baseline(
        enabled=baseline_cfg.get("enabled", False),
        calc_method=baseline_cfg.get("calc_method", "offset"),
        current_value=value,
        fixed_value=baseline_cfg.get("fixed_value"),
        offset_value=baseline_cfg.get("offset_value"),
    )

    health = calculate_health(
        metric_id=metric_id,
        enabled=health_cfg.get("enabled", False),
        calc_method=health_cfg.get("calc_method", "auto"),
        value=value,
        fixed_status=health_cfg.get("fixed_status"),
        health_pattern=health_cfg.get("health_pattern"),
        flap_interval_min=health_cfg.get("flap_interval_min"),
        degrade_hours=health_cfg.get("degrade_hours"),
        metric_created_at=metric_created_at,
        thresholds_enabled=thresholds_cfg.get("enabled", False),
        combination_selector=thresholds_cfg.get("combination_selector", "worst"),
        threshold_rows=threshold_rows,
    )

    msg = build_kafka_message(
        metric_hash=metric_hash, metric_name=metric_name,
        metric_description=metric_description, metric_type=metric_type,
        metric_group=metric_group, metric_unit=metric_unit,
        metric_period_sec=metric_period_sec, object_ci=object_ci,
        object_id=object_id, object_name=object_name, object_type=object_type,
        mon_system_metric_id=mon_system_metric_id,
        purpose_type_hint=purpose_type_hint, spec_version=spec_version,
        it_service_ci=it_service_ci, mon_system_ci=mon_system_ci,
        value=value, baseline=baseline, health=health,
        thresholds_enabled=thresholds_cfg.get("enabled", False),
        threshold_rows=threshold_rows,
        combination_selector=thresholds_cfg.get("combination_selector", "worst"),
        threshold_type=thresholds_cfg.get("threshold_type", "threshold"),
    )

    return {
        "value":               value,
        "baseline":            baseline,
        "health":              health,
        "thresholds_included": thresholds_cfg.get("enabled", False),
        "message_json":        json.dumps(msg, ensure_ascii=False, indent=2),
    }
