"""
Обёртка над kafka-python KafkaProducer.

Конфигурация через env-переменные:
  KAFKA_BOOTSTRAP_SERVERS  — хост:порт (через запятую), по умолчанию localhost:9092
  KAFKA_SECURITY_PROTOCOL  — PLAINTEXT | SSL | SASL_PLAINTEXT | SASL_SSL
  KAFKA_SASL_MECHANISM     — PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512
  KAFKA_SASL_USERNAME      — логин
  KAFKA_SASL_PASSWORD      — пароль
  KAFKA_SSL_CAFILE         — путь к CA-файлу
"""

import os
from typing import Optional


class KafkaClient:

    @staticmethod
    def _build_producer():
        from kafka import KafkaProducer  # type: ignore

        servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
        protocol = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT").upper()

        kwargs: dict = {
            "bootstrap_servers": [s.strip() for s in servers.split(",")],
            "security_protocol": protocol,
            "request_timeout_ms": 10_000,
            "max_block_ms": 10_000,
        }

        if protocol in ("SASL_PLAINTEXT", "SASL_SSL"):
            mechanism = os.getenv("KAFKA_SASL_MECHANISM", "PLAIN")
            username   = os.getenv("KAFKA_SASL_USERNAME", "")
            password   = os.getenv("KAFKA_SASL_PASSWORD", "")
            kwargs["sasl_mechanism"] = mechanism
            kwargs["sasl_plain_username"] = username
            kwargs["sasl_plain_password"] = password

        if protocol in ("SSL", "SASL_SSL"):
            cafile = os.getenv("KAFKA_SSL_CAFILE", "")
            if cafile:
                kwargs["ssl_cafile"] = cafile

        return KafkaProducer(**kwargs)

    @classmethod
    def send(
        cls,
        topic:     str,
        payload:   str,
        key:       Optional[str] = None,
        headers:   Optional[list[tuple[str, bytes]]] = None,
        partition: Optional[int] = None,
    ) -> dict:
        """
        Отправить сообщение в Kafka.

        Args:
            headers:   Kafka headers — list of (name: str, value: bytes).
                       Используется для A2A-протокола (JWT заголовки).
            partition: Явный номер партиции. None = автовыбор по ключу/round-robin.

        Returns:
            {"offset": int, "partition": int, "timestamp": int}
        """
        producer = cls._build_producer()
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
