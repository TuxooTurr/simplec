from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from gigachat import GigaChat
from gigachat.models import Chat, Messages

from simplec.app.services.zephyr_sanitize import sanitize_zephyr_import
from simplec.app.services.zephyr_validate import validate_zephyr_import


SYSTEM_PROMPT = """Ты генератор manual test cases для Zephyr.
Верни ТОЛЬКО валидный JSON без markdown и без пояснений.

Формат строго такой:

{
  "schema": "simplec.zephyr_import.v1",
  "context": {"platform": "...", "feature": "..."},
  "testCases": [
    {
      "name": "[<platform>][<feature>] <Title>",
      "description": "...",
      "preconditions": "...",
      "status": "требуется согласование",
      "priority": "P0|P1|P2|P3",
      "labels": ["..."],
      "customFields": {"trace": "REQ-1", "platform":"...", "feature":"..."},
      "steps": [
        {"action": "...", "testData": "...", "result": "UI: ... API: ... DB: ... Kafka: ..."}
      ]
    }
  ]
}

Правила:
- status всегда "требуется согласование"
- result всегда одной строкой с 4 секциями UI/API/DB/Kafka; если не применимо — N/A
- steps: минимум 1 шаг
"""


def generate_zephyr_import_gigachat(normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
    auth_key = os.getenv("GIGACHAT_AUTH_KEY") or os.getenv("GIGACHAT_TOKEN")
    if not auth_key:
        raise RuntimeError("Нужно задать GIGACHAT_AUTH_KEY (Authorization Key)")

    context = {"platform": platform, "feature": feature}
    items: List[Dict[str, Any]] = normalized.get("items", [])

    payload = {
        "context": context,
        "requirements": [{"id": it.get("id"), "text": it.get("text")} for it in items],
        "output_contract": {
            "schema": "simplec.zephyr_import.v1",
            "status_fixed": "требуется согласование",
            "expected_format": "UI: ... API: ... DB: ... Kafka: ...",
        },
    }

    llm = GigaChat(credentials=auth_key, verify_ssl_certs=False)

    chat_req = Chat(
        messages=[
            Messages(role="system", content=SYSTEM_PROMPT),
            Messages(role="user", content=json.dumps(payload, ensure_ascii=False)),
        ],
        temperature=0.2,
    )

    resp = llm.chat(chat_req)

    content = resp.choices[0].message.content if resp and resp.choices else ""
    if not content:
        raise RuntimeError("GigaChat вернул пустой ответ")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"GigaChat вернул не-JSON. Ответ:\n{content}") from e

    if data.get("schema") != "simplec.zephyr_import.v1":
        raise RuntimeError(f"Неверная schema: {data.get('schema')}")
    if "testCases" not in data or not isinstance(data["testCases"], list):
        raise RuntimeError("Нет testCases[]")

    data = sanitize_zephyr_import(data, platform=platform, feature=feature)
    validate_zephyr_import(data)
    return data
