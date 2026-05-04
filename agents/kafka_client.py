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
            if cafile:
                kwargs["ssl_cafile"] = cafile
            certfile = cfg.get("kafka_ssl_certfile") or os.getenv("KAFKA_SSL_CERTFILE", "")
            if certfile:
                kwargs["ssl_certfile"] = certfile
            keyfile = cfg.get("kafka_ssl_keyfile") or os.getenv("KAFKA_SSL_KEYFILE", "")
            if keyfile:
                kwargs["ssl_keyfile"] = keyfile
            ssl_password = cfg.get("kafka_ssl_password") or os.getenv("KAFKA_SSL_PASSWORD", "")
            if ssl_password:
                kwargs["ssl_password"] = ssl_password

        return kwargs

    @staticmethod
    def _build_producer(kafka_cfg: Optional[dict] = None):
        from kafka import KafkaProducer  # type: ignore

        return KafkaProducer(**KafkaClient._build_producer_kwargs(kafka_cfg))

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
