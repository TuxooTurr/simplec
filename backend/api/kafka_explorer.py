"""
Просмотр Kafka — реестр подключений + снапшот последних N сообщений топика.

REST:
  GET    /api/kafka/connections            — список подключений (пароль маскирован)
  POST   /api/kafka/connections            — создать
  PUT    /api/kafka/connections/{id}        — изменить
  DELETE /api/kafka/connections/{id}        — удалить
  POST   /api/kafka/connections/{id}/test   — проверить подключение (список топиков)
  GET    /api/kafka/topics?connection_id=…  — все топики брокера
  POST   /api/kafka/messages                — последние N сообщений топика + серверный фильтр

Это снапшот (НЕ realtime): читаем последние `limit` записей и фильтруем на сервере.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.kafka_client import KafkaClient
from db.kafka_explorer_store import KafkaExplorerStore

router = APIRouter()


class ConnectionBody(BaseModel):
    name: str = ""
    bootstrap_servers: str = ""
    security_protocol: str = "PLAINTEXT"
    sasl_mechanism: str = ""
    sasl_username: str = ""
    sasl_password: str = ""
    ssl_cafile: str = ""
    ssl_certfile: str = ""
    ssl_keyfile: str = ""
    ssl_verify: bool = True
    default_limit: int = 50


class MessagesBody(BaseModel):
    connection_id: str
    topic: str
    limit: int = 50
    filter: str = ""


def _require_conn(conn_id: str) -> dict:
    conn = KafkaExplorerStore.get_connection(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    return conn


def _matches(msg: dict, needle: str) -> bool:
    if not needle:
        return True
    n = needle.lower()
    if n in (msg.get("value") or "").lower():
        return True
    if n in (str(msg.get("key") or "")).lower():
        return True
    for h in msg.get("headers", []):
        try:
            if n in f"{h[0]}{h[1]}".lower():
                return True
        except (IndexError, TypeError):
            continue
    return False


@router.get("/api/kafka/connections")
def list_connections() -> list[dict]:
    return KafkaExplorerStore.list_connections()


@router.post("/api/kafka/connections")
def create_connection(body: ConnectionBody) -> dict:
    if not body.bootstrap_servers.strip():
        raise HTTPException(status_code=400, detail="Укажите bootstrap servers (host:port)")
    return KafkaExplorerStore.create_connection(body.model_dump())


@router.put("/api/kafka/connections/{conn_id}")
def update_connection(conn_id: str, body: ConnectionBody) -> dict:
    updated = KafkaExplorerStore.update_connection(conn_id, body.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    return updated


@router.delete("/api/kafka/connections/{conn_id}")
def delete_connection(conn_id: str) -> dict:
    if not KafkaExplorerStore.delete_connection(conn_id):
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    return {"status": "deleted"}


@router.post("/api/kafka/connections/{conn_id}/test")
async def test_connection(conn_id: str) -> dict:
    conn = _require_conn(conn_id)
    cfg = KafkaExplorerStore.to_kafka_cfg(conn)
    try:
        topics = await asyncio.to_thread(KafkaClient.list_topics, cfg)
        return {"status": "ok", "topics_count": len(topics)}
    except Exception as exc:  # noqa: BLE001 — показываем причину пользователю
        raise HTTPException(status_code=502, detail=f"Не удалось подключиться: {exc}")


@router.get("/api/kafka/topics")
async def get_topics(connection_id: str) -> dict:
    conn = _require_conn(connection_id)
    cfg = KafkaExplorerStore.to_kafka_cfg(conn)
    try:
        topics = await asyncio.to_thread(KafkaClient.list_topics, cfg)
        return {"topics": topics}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Не удалось получить топики: {exc}")


@router.post("/api/kafka/messages")
async def get_messages(body: MessagesBody) -> dict:
    conn = _require_conn(body.connection_id)
    cfg = KafkaExplorerStore.to_kafka_cfg(conn)
    limit = max(1, min(int(body.limit or 50), 1000))
    if not body.topic.strip():
        raise HTTPException(status_code=400, detail="Не выбран топик")
    try:
        messages = await asyncio.to_thread(KafkaClient.fetch_recent, body.topic, limit, cfg)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Ошибка чтения топика: {exc}")

    needle = (body.filter or "").strip()
    filtered = [m for m in messages if _matches(m, needle)] if needle else messages
    return {
        "topic": body.topic,
        "limit": limit,
        "scanned": len(messages),   # сколько последних сообщений просмотрено
        "matched": len(filtered),
        "messages": filtered,
    }
