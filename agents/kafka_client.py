"""
Обёртка над kafka-python KafkaProducer.

Конфигурация через env-переменные (fallback):
  KAFKA_BOOTSTRAP_SERVERS  — хост:порт (через запятую), по умолчанию localhost:9092
  KAFKA_SECURITY_PROTOCOL  — PLAINTEXT | SSL | SASL_PLAINTEXT | SASL_SSL
  KAFKA_SASL_MECHANISM     — PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512
  KAFKA_SASL_USERNAME      — логин
  KAFKA_SASL_PASSWORD      — пароль
  KAFKA_SSL_CAFILE         — путь к CA-файлу
  KAFKA_SSL_CERTFILE       — путь к клиентскому сертификату
  KAFKA_SSL_KEYFILE        — путь к приватному ключу клиента
  KAFKA_SSL_PASSWORD       — пароль приватного ключа, если он зашифрован

Или через явный kafka_cfg: dict (приоритет над env).
"""

import os
from typing import Optional


class KafkaClient:

    @staticmethod
    def _build_producer_kwargs(kafka_cfg: Optional[dict] = None) -> dict:
        cfg = kafka_cfg or {}
        servers  = cfg.get("kafka_bootstrap_servers") or os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
        protocol = (cfg.get("kafka_security_protocol") or os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT")).upper()
        bootstrap_servers = [s.strip() for s in str(servers).split(",") if s.strip()] or ["localhost:9092"]

        kwargs: dict = {
            "bootstrap_servers": bootstrap_servers,
            "security_protocol": protocol,
            "request_timeout_ms": 10_000,
            "max_block_ms": 10_000,
        }

        if protocol in ("SASL_PLAINTEXT", "SASL_SSL"):
            mechanism = cfg.get("kafka_sasl_mechanism") or os.getenv("KAFKA_SASL_MECHANISM", "PLAIN")
            username   = cfg.get("kafka_sasl_username") or os.getenv("KAFKA_SASL_USERNAME", "")
            password   = cfg.get("kafka_sasl_password") or os.getenv("KAFKA_SASL_PASSWORD", "")
            kwargs["sasl_mechanism"] = mechanism
            kwargs["sasl_plain_username"] = username
            kwargs["sasl_plain_password"] = password

        if protocol in ("SSL", "SASL_SSL"):
            cafile = cfg.get("kafka_ssl_cafile") or os.getenv("KAFKA_SSL_CAFILE", "")
            certfile = cfg.get("kafka_ssl_certfile") or os.getenv("KAFKA_SSL_CERTFILE", "")
            keyfile = cfg.get("kafka_ssl_keyfile") or os.getenv("KAFKA_SSL_KEYFILE", "")
            ssl_password = cfg.get("kafka_ssl_password") or os.getenv("KAFKA_SSL_PASSWORD", "")
            verify = cfg.get("kafka_ssl_verify", True)
            if isinstance(verify, str):
                verify = verify.strip().lower() not in ("0", "false", "no", "нет")

            if not verify:
                # Без валидации сертификата брокера (самоподписанные серты на стендах):
                # kafka-python при заданном ssl_context использует только его.
                import ssl
                ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                if cafile:
                    ctx.load_verify_locations(cafile=cafile)
                if certfile:
                    ctx.load_cert_chain(certfile=certfile, keyfile=keyfile or None,
                                        password=ssl_password or None)
                kwargs["ssl_context"] = ctx
                kwargs["ssl_check_hostname"] = False
            else:
                if cafile:
                    kwargs["ssl_cafile"] = cafile
                if certfile:
                    kwargs["ssl_certfile"] = certfile
                if keyfile:
                    kwargs["ssl_keyfile"] = keyfile
                if ssl_password:
                    kwargs["ssl_password"] = ssl_password

        return kwargs

    @staticmethod
    def _build_producer(kafka_cfg: Optional[dict] = None):
        from kafka import KafkaProducer  # type: ignore

        return KafkaProducer(**KafkaClient._build_producer_kwargs(kafka_cfg))

    # ── Consumer (просмотр топиков) ───────────────────────────────────────────

    @staticmethod
    def _build_consumer_kwargs(kafka_cfg: Optional[dict] = None) -> dict:
        """Те же параметры соединения, что и у producer, но без producer-only ключей."""
        kwargs = KafkaClient._build_producer_kwargs(kafka_cfg)
        kwargs.pop("max_block_ms", None)  # producer-only — KafkaConsumer его не принимает
        kwargs.update({
            "enable_auto_commit": False,
            "auto_offset_reset": "latest",
            "consumer_timeout_ms": 4000,
        })
        return kwargs

    @classmethod
    def list_topics(cls, kafka_cfg: Optional[dict] = None) -> list[str]:
        """Список всех топиков на брокере (отсортирован, без внутренних __ топиков)."""
        from kafka import KafkaConsumer  # type: ignore

        consumer = KafkaConsumer(**cls._build_consumer_kwargs(kafka_cfg))
        try:
            topics = consumer.topics() or set()
        finally:
            consumer.close()
        return sorted(t for t in topics if not str(t).startswith("__"))

    @staticmethod
    def _record_to_dict(rec) -> dict:
        def _dec(b):
            if b is None:
                return None
            if isinstance(b, (bytes, bytearray)):
                return bytes(b).decode("utf-8", "replace")
            return str(b)

        headers = []
        for h in (rec.headers or []):
            try:
                hk, hv = h
                headers.append([str(hk), _dec(hv)])
            except (ValueError, TypeError):
                continue
        return {
            "offset":    rec.offset,
            "partition": rec.partition,
            "timestamp": rec.timestamp,
            "key":       _dec(rec.key),
            "value":     _dec(rec.value) or "",
            "headers":   headers,
        }

    @classmethod
    def fetch_recent(
        cls,
        topic:     str,
        limit:     int = 50,
        kafka_cfg: Optional[dict] = None,
    ) -> list[dict]:
        """
        Последние `limit` сообщений топика (снапшот, НЕ realtime).
        Читает до `limit` записей из каждой партиции, затем берёт глобально
        последние `limit` по времени. Возвращает по убыванию времени.
        """
        from kafka import KafkaConsumer, TopicPartition  # type: ignore

        limit = max(1, min(int(limit or 50), 1000))
        consumer = KafkaConsumer(**cls._build_consumer_kwargs(kafka_cfg))
        messages: list[dict] = []
        try:
            parts = consumer.partitions_for_topic(topic)
            if not parts:
                return []
            tps = [TopicPartition(topic, p) for p in parts]
            consumer.assign(tps)
            begin = consumer.beginning_offsets(tps)
            end = consumer.end_offsets(tps)

            target = 0
            for tp in tps:
                start = max(begin.get(tp, 0), end.get(tp, 0) - limit)
                consumer.seek(tp, start)
                target += max(0, end.get(tp, 0) - start)
            if target == 0:
                return []

            empty_polls = 0
            while len(messages) < target and empty_polls < 3:
                batch = consumer.poll(timeout_ms=1500, max_records=500)
                if not batch:
                    empty_polls += 1
                    continue
                for _tp, recs in batch.items():
                    for rec in recs:
                        messages.append(cls._record_to_dict(rec))
        finally:
            consumer.close()

        messages.sort(key=lambda m: m.get("timestamp") or 0, reverse=True)
        return messages[:limit]

    @classmethod
    def send(
        cls,
        topic:     str,
        payload:   str,
        key:       Optional[str] = None,
        headers:   Optional[list[tuple[str, bytes]]] = None,
        partition: Optional[int] = None,
        kafka_cfg: Optional[dict] = None,
    ) -> dict:
        """
        Отправить сообщение в Kafka.

        Args:
            headers:   Kafka headers — list of (name: str, value: bytes).
                       Используется для A2A-протокола (JWT заголовки).
            partition: Явный номер партиции. None = автовыбор по ключу/round-robin.
            kafka_cfg: Опциональный конфиг из БД. Если None — читает из os.getenv.

        Returns:
            {"offset": int, "partition": int, "timestamp": int}
        """
        producer = cls._build_producer(kafka_cfg)
        try:
            key_bytes   = key.encode("utf-8") if key else None
            value_bytes = payload.encode("utf-8")

            send_kwargs: dict = {"value": value_bytes, "key": key_bytes}
            if headers:
                send_kwargs["headers"] = headers
            if partition is not None:
                send_kwargs["partition"] = partition

            future = producer.send(topic, **send_kwargs)
            producer.flush(timeout=10)
            record_meta = future.get(timeout=10)
            return {
                "offset":    record_meta.offset,
                "partition": record_meta.partition,
                "timestamp": record_meta.timestamp,
            }
        finally:
            producer.close(timeout=5)
