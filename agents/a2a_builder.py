"""
Построитель A2A-сообщений для Kafka (протокол A2A SUPPORT_PLATFORM).

Генерирует:
  - JWT-заголовки Authorization и MessageToken (HS256)
  - JSON-RPC 2.0 обёртку вокруг alert-контента
  - Kafka headers list

Использование:
    payload_str, kafka_headers = build_a2a_message(
        system_ci     = "CI0000000",
        sender        = "alert_service",
        recipient     = "sber.support_platform.channel_agent",
        sender_id_aef = "CI00213821",
        recipient_id_aef = "CI00293210",
        alert_text    = json.dumps(alert_dict),
        jwt_secret    = os.getenv("A2A_JWT_SECRET"),
    )
    KafkaClient.send(topic, payload_str, key=str(uuid4()), headers=kafka_headers, partition=0)
"""

import json
import uuid
import os
from datetime import datetime, timezone
from typing import Optional


def build_a2a_message(
    system_ci:       str,
    sender:          str,
    recipient:       str,
    sender_id_aef:   str,
    recipient_id_aef: str,
    alert_text:      str,
    jwt_secret:      Optional[str] = None,
) -> tuple[str, list[tuple[str, bytes]]]:
    """
    Returns:
        (payload_json_str, kafka_headers)
    where kafka_headers = list of (header_name: str, header_value: bytes)
    """
    import jwt as pyjwt  # PyJWT

    secret = jwt_secret or os.getenv("A2A_JWT_SECRET", "SBER911_SECRET_KEY")
    alg    = "HS256"
    now    = datetime.now(timezone.utc)

    # ── Authorization JWT ──────────────────────────────────────────────────
    auth_payload = {
        "iss": "https://sber911.sberbank.ru/",
        "sub": "Тех. пользователь Sber911",
        "upn": "CI02000001IFTsber911",
        "exp": "1759102365673",
        "iat": str(int(now.timestamp() * 1000)),
        "pid": "CI02000001IFTsber911",
        "jti": str(uuid.uuid4()),
    }
    auth_token = "Bearer " + pyjwt.encode(
        auth_payload, secret, algorithm=alg,
        headers={"alg": alg, "typ": "JWT"},
    )

    # ── MessageToken JWT ───────────────────────────────────────────────────
    message_meta = {
        "senderAgentName":    sender,
        "recipientAgentName": recipient,
        "senderIdAEF":        sender_id_aef,
        "recipientIdAEF":     recipient_id_aef,
        "systemCi":           system_ci,
        "agentModelVersion":  "PRO 2.0",
        "a2aSessionId":       "none",
        "gigaChatSessionId":  "none",
    }
    message_token = pyjwt.encode(
        message_meta, secret, algorithm=alg,
        headers={"alg": alg, "typ": "JWT"},
    )

    # ── Kafka headers ──────────────────────────────────────────────────────
    headers: list[tuple[str, bytes]] = [
        ("Authorization",      auth_token.encode("utf-8")),
        ("MessageToken",       message_token.encode("utf-8")),
        ("SenderAgentName",    sender.encode("utf-8")),
        ("RecipientAgentName", recipient.encode("utf-8")),
        ("SystemCi",           system_ci.encode("utf-8")),
        ("Timestamp",          now.strftime("%Y-%m-%dT%H:%M:%SZ").encode("utf-8")),
    ]

    # ── JSON-RPC 2.0 message body ──────────────────────────────────────────
    message = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/send",
        "params": {
            "message": {
                "contextId": str(uuid.uuid4()),
                "kind":      "message",
                "role":      "agent",
                "parts": [
                    {"kind": "text", "text": alert_text},
                ],
                "messageId": str(uuid.uuid4()),
            },
            "metadata": {},
        },
    }

    return json.dumps(message, ensure_ascii=False), headers


def build_a2a_mpr_message(
    system_ci:        str,
    sender:           str,
    recipient:        str,
    sender_id_aef:    str,
    recipient_id_aef: str,
    mpr_data:         dict,
    jwt_secret:       Optional[str] = None,
) -> tuple[str, list[tuple[str, bytes]]]:
    """
    A2A-сообщение для МпР (Мероприятие по регламенту).
    Использует parts с kind="data" вместо kind="text".

    Returns:
        (payload_json_str, kafka_headers)
    """
    import jwt as pyjwt  # PyJWT

    secret = jwt_secret or os.getenv("A2A_JWT_SECRET", "SBER911_SECRET_KEY")
    alg    = "HS256"
    now    = datetime.now(timezone.utc)

    # ── Authorization JWT ──────────────────────────────────────────────────
    auth_payload = {
        "iss": "https://sber911.sberbank.ru/",
        "sub": "Тех. пользователь Sber911",
        "upn": "CI02000001IFTsber911",
        "exp": "1759102365673",
        "iat": str(int(now.timestamp() * 1000)),
        "pid": "CI02000001IFTsber911",
        "jti": str(uuid.uuid4()),
    }
    auth_token = "Bearer " + pyjwt.encode(
        auth_payload, secret, algorithm=alg,
        headers={"alg": alg, "typ": "JWT"},
    )

    # ── MessageToken JWT ───────────────────────────────────────────────────
    message_meta = {
        "senderAgentName":    sender,
        "recipientAgentName": recipient,
        "senderIdAEF":        sender_id_aef,
        "recipientIdAEF":     recipient_id_aef,
        "systemCi":           system_ci,
        "agentModelVersion":  "PRO 2.0",
        "a2aSessionId":       "none",
        "gigaChatSessionId":  "none",
    }
    message_token = pyjwt.encode(
        message_meta, secret, algorithm=alg,
        headers={"alg": alg, "typ": "JWT"},
    )

    # ── Kafka headers ──────────────────────────────────────────────────────
    headers: list[tuple[str, bytes]] = [
        ("Authorization",      auth_token.encode("utf-8")),
        ("MessageToken",       message_token.encode("utf-8")),
        ("SenderAgentName",    sender.encode("utf-8")),
        ("RecipientAgentName", recipient.encode("utf-8")),
        ("SystemCi",           system_ci.encode("utf-8")),
        ("Timestamp",          now.strftime("%Y-%m-%dT%H:%M:%SZ").encode("utf-8")),
    ]

    # ── JSON-RPC 2.0 message body (data-части для МпР) ────────────────────
    context_id = f"mpr#{uuid.uuid4()}"
    message = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/send",
        "params": {
            "message": {
                "contextId": context_id,
                "kind":      "message",
                "role":      "agent",
                "parts": [
                    {"kind": "data", "data": {"type": "mpr", "value": mpr_data}},
                ],
                "messageId": str(uuid.uuid4()),
            },
            "metadata": {},
        },
    }

    return json.dumps(message, ensure_ascii=False), headers
