"""
Асинхронный планировщик отправки метрик в Kafka.
Синглтон — создаётся один раз при старте FastAPI через lifespan.

Требует --workers 1 (один asyncio event loop = один планировщик без дублей).
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


class MetricsScheduler:

    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}

    # ── Public API ────────────────────────────────────────────────────────────

    async def start_metric(self, metric_id: int) -> None:
        """Запустить задачу отправки для метрики (идемпотентно)."""
        existing = self._tasks.get(metric_id)
        if existing and not existing.done():
            return
        task = asyncio.create_task(
            self._run_metric(metric_id),
            name=f"metric_{metric_id}",
        )
        self._tasks[metric_id] = task
        logger.info(f"[Scheduler] started metric_id={metric_id}")

    async def stop_metric(self, metric_id: int) -> None:
        """Остановить задачу для метрики."""
        task = self._tasks.pop(metric_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        logger.info(f"[Scheduler] stopped metric_id={metric_id}")

    async def start_all(self) -> None:
        """Загрузить все активные метрики из БД и запустить задачи."""
        metric_ids = await asyncio.to_thread(self._load_active_metric_ids)
        for mid in metric_ids:
            await self.start_metric(mid)
        logger.info(f"[Scheduler] start_all: {len(metric_ids)} metrics")

    async def stop_all(self) -> None:
        """Остановить все задачи."""
        ids = list(self._tasks.keys())
        for mid in ids:
            await self.stop_metric(mid)
        logger.info(f"[Scheduler] stop_all: {len(ids)} metrics")

    def running_ids(self) -> list[int]:
        """ID метрик с живыми задачами."""
        return [mid for mid, t in self._tasks.items() if not t.done()]

    # ── Internal ──────────────────────────────────────────────────────────────

    @staticmethod
    def _load_active_metric_ids() -> list[int]:
        from db.postgres import SessionLocal
        from db.metrics_models import TestMetric, TestSystem
        db = SessionLocal()
        try:
            rows = (
                db.query(TestMetric.id)
                .join(TestSystem, TestMetric.test_system_id == TestSystem.id)
                .filter(TestMetric.is_active == True, TestSystem.is_active == True)
                .all()
            )
            return [r[0] for r in rows]
        finally:
            db.close()

    async def _run_metric(self, metric_id: int) -> None:
        """
        Основной цикл метрики:
          1. Получить период из БД
          2. Спать period_sec секунд
          3. Отправить сообщение в Kafka
          4. Повторить
        """
        while True:
            period_sec = await asyncio.to_thread(self._get_period, metric_id)
            if period_sec is None:
                logger.warning(f"[Scheduler] metric_id={metric_id} not found, stopping")
                self._tasks.pop(metric_id, None)
                return

            try:
                await asyncio.sleep(period_sec)
            except asyncio.CancelledError:
                return

            await self._send_once(metric_id)

    @staticmethod
    def _get_period(metric_id: int) -> Optional[int]:
        from db.postgres import SessionLocal
        from db.metrics_models import TestMetric
        db = SessionLocal()
        try:
            m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
            return m.metric_period_sec if m else None
        finally:
            db.close()

    async def _send_once(self, metric_id: int) -> None:
        """Один цикл: сгенерировать значение → отправить в Kafka → записать лог."""
        try:
            await asyncio.to_thread(self._do_send, metric_id)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[Scheduler] metric_id={metric_id} outer error: {e}")

    @staticmethod
    def _do_send(metric_id: int) -> None:
        """Синхронная отправка — выполняется в отдельном потоке."""
        from db.postgres import SessionLocal
        from db.metrics_models import (
            TestMetric, TestMetricValuesConfig, TestMetricBaselineConfig,
            TestMetricThresholdsConfig, TestMetricHealthConfig, GenerationLog,
        )
        from backend.api.metrics_settings import get_kafka_config
        from agents.metrics_message_builder import (
            generate_value, calculate_baseline, calculate_health, build_kafka_message,
        )
        from agents.kafka_client import KafkaClient

        db = SessionLocal()
        # Инициализируем до try — чтобы передать в error-лог даже при ошибке Kafka
        value: Optional[float]    = None
        baseline: Optional[float] = None
        health: Optional[int]     = None
        try:
            m = db.query(TestMetric).filter(TestMetric.id == metric_id).first()
            if not m or not m.is_active:
                return

            system = m.system
            if not system or not system.is_active:
                return

            vc = m.values_config
            bc = m.baseline_config
            tc = m.thresholds_config
            hc = m.health_config

            rows: list[dict] = []
            if tc and tc.threshold_rows:
                rows = [
                    {
                        "health_type": r.health_type,
                        "min_value":   float(r.min_value) if r.min_value is not None else None,
                        "max_value":   float(r.max_value) if r.max_value is not None else None,
                        "is_percent":  r.is_percent,
                    }
                    for r in tc.threshold_rows
                ]

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
                metric_hash=m.metric_hash,
                metric_name=m.metric_name,
                metric_description=m.metric_description,
                metric_type=m.metric_type,
                metric_group=m.metric_group,
                metric_unit=m.metric_unit,
                metric_period_sec=m.metric_period_sec,
                object_ci=m.object_ci,
                object_id=m.object_id,
                object_name=m.object_name,
                object_type=m.object_type,
                mon_system_metric_id=m.mon_system_metric_id,
                purpose_type_hint=m.purpose_type_hint,
                spec_version=m.spec_version,
                it_service_ci=system.it_service_ci,
                mon_system_ci=system.mon_system_ci,
                value=value,
                baseline=baseline,
                health=health,
                thresholds_enabled=tc.enabled if tc else False,
                threshold_rows=rows,
                combination_selector=tc.combination_selector if tc else "worst",
                threshold_type=tc.threshold_type if tc else "threshold",
            )
            msg_str = json.dumps(msg, ensure_ascii=False)

            cfg = get_kafka_config(db)
            topic = cfg.get("kafka_topic", "metadata")

            result = KafkaClient.send(topic, msg_str, key=m.metric_hash)

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
            logger.debug(f"[Scheduler] metric_id={metric_id} sent ok, value={value}")

        except Exception as e:
            logger.error(f"[Scheduler] metric_id={metric_id} send error: {e}")
            try:
                db.add(GenerationLog(
                    test_metric_id=metric_id,
                    value_sent=value,
                    baseline_sent=baseline,
                    health_sent=health,
                    status="error",
                    error_message=str(e)[:2000],
                ))
                db.commit()
            except Exception:
                db.rollback()
        finally:
            db.close()


# ── Singleton ─────────────────────────────────────────────────────────────────

scheduler = MetricsScheduler()
