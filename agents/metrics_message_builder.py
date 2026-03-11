"""
Генератор значений метрик и построитель Kafka-сообщений для Sber911.
Чистые функции без доступа к БД.

Sber911 — 3 раздельных потока:
  DATA       — значения метрик (каждый period_sec)
  METADATA   — описание метрики (при старте + каждые 24 ч)
  THRESHOLDS — пороги/базалайн (при старте + каждые 24 ч, если включены)
"""

import json
import math
import random
import time
from datetime import datetime, timezone
from typing import Optional


# ── Health int → Sber911 status string ───────────────────────────────────────

HEALTH_TO_STATUS: dict[int, str] = {
    1: "normal",
    2: "warning",
    3: "high",
    4: "critical",
    5: "wide_ranging",
}


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


# ── DATA message ──────────────────────────────────────────────────────────────

def build_data_message(
    metric_hash: str,
    value: float,
    baseline: Optional[float],
    health: Optional[int],
    version: str = "1.0",
) -> dict:
    """DATA-сообщение: значение метрики. Отправляется каждый period_sec."""
    return {
        "version": version,
        "metrics": {
            "data": [{
                "metric_hash":    metric_hash,
                "metric_value":   value,
                "baseline_value": baseline,
                "metric_ts":      int(time.time()),
                "metric_status":  HEALTH_TO_STATUS.get(health) if health is not None else None,
            }]
        },
    }


# ── METADATA message ──────────────────────────────────────────────────────────

def build_metadata_message(
    metric_hash: str,
    mon_system_ci: str,
    it_service_ci: str,
    object_ci: Optional[str],
    object_id: str,
    object_name: str,
    object_type: Optional[str],
    metric_id: str,
    metric_name: str,
    metric_description: str,
    metric_type: str,
    metric_group: str,
    metric_unit: str,
    metric_period_sec: int,
    version: str = "1.0",
) -> dict:
    """METADATA-сообщение: описание метрики. При регистрации + каждые 24 ч."""
    return {
        "version":            version,
        "metric_hash":        metric_hash,
        "mon_system_ci":      mon_system_ci,
        "it_service_ci":      it_service_ci,
        "object_ci":          object_ci,
        "object_id":          object_id,
        "object_name":        object_name,
        "object_type":        object_type,
        "metric_id":          metric_id,
        "metric_name":        metric_name,
        "metric_description": metric_description,
        "metric_type":        metric_type,
        "metric_group":       metric_group,
        "metric_unit":        metric_unit,
        "metric_period_sec":  metric_period_sec,
    }


# ── THRESHOLDS message ────────────────────────────────────────────────────────

def build_thresholds_message(
    metric_hash: str,
    threshold_rows: list[dict],
    combination_selector: str = "worst",
    baseline_deviation: Optional[float] = None,
    version: str = "1.0",
) -> dict:
    """THRESHOLDS-сообщение: пороги. При старте + каждые 24 ч (если включены)."""
    thresholds = []
    for row in threshold_rows:
        ht = int(row["health_type"])
        thresholds.append({
            "min":    float(row["min_value"]) if row.get("min_value") is not None else None,
            "max":    float(row["max_value"]) if row.get("max_value") is not None else None,
            "status": HEALTH_TO_STATUS.get(ht, "normal"),
        })
    return {
        "version":             version,
        "metric_hash":         metric_hash,
        "threshold":           thresholds,
        "combination_selector": combination_selector,
        "baseline_deviation":  baseline_deviation,
        "threshold_ts":        int(time.time()),
    }


# ── Preview (все 3 сообщения без отправки) ────────────────────────────────────

def build_preview(
    metric_id: int,
    metric_hash: str,
    mon_system_ci: str,
    it_service_ci: str,
    object_ci: Optional[str],
    object_id: str,
    object_name: str,
    object_type: Optional[str],
    mon_system_metric_id: str,
    metric_name: str,
    metric_description: str,
    metric_type: str,
    metric_group: str,
    metric_unit: str,
    metric_period_sec: int,
    metric_created_at: Optional[datetime],
    values_cfg: dict,
    baseline_cfg: dict,
    health_cfg: dict,
    thresholds_cfg: dict,
    threshold_rows: list[dict],
) -> dict:
    """Строит превью всех 3 сообщений для UI (без отправки в Kafka)."""
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

    data_msg = build_data_message(metric_hash, value, baseline, health)

    meta_msg = build_metadata_message(
        metric_hash=metric_hash,
        mon_system_ci=mon_system_ci,
        it_service_ci=it_service_ci,
        object_ci=object_ci,
        object_id=object_id,
        object_name=object_name,
        object_type=object_type,
        metric_id=mon_system_metric_id,
        metric_name=metric_name,
        metric_description=metric_description,
        metric_type=metric_type,
        metric_group=metric_group,
        metric_unit=metric_unit,
        metric_period_sec=metric_period_sec,
    )

    thr_msg_json: Optional[str] = None
    if thresholds_cfg.get("enabled") and threshold_rows:
        baseline_deviation: Optional[float] = None
        if baseline_cfg.get("enabled"):
            cm = baseline_cfg.get("calc_method", "offset")
            if cm == "offset":
                ov = baseline_cfg.get("offset_value")
                baseline_deviation = float(ov) if ov is not None else None
            elif cm == "fixed":
                fv = baseline_cfg.get("fixed_value")
                baseline_deviation = float(fv) if fv is not None else None
        thr_msg = build_thresholds_message(
            metric_hash=metric_hash,
            threshold_rows=threshold_rows,
            combination_selector=thresholds_cfg.get("combination_selector", "worst"),
            baseline_deviation=baseline_deviation,
        )
        thr_msg_json = json.dumps(thr_msg, ensure_ascii=False, indent=2)

    return {
        "value":                   value,
        "baseline":                baseline,
        "health":                  health,
        "data_message_json":       json.dumps(data_msg, ensure_ascii=False, indent=2),
        "metadata_message_json":   json.dumps(meta_msg, ensure_ascii=False, indent=2),
        "thresholds_message_json": thr_msg_json,
    }
