from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from openai import OpenAI

from simplec.app.services.template_config import load_manual_template


SYSTEM_PROMPT = """Ты генератор manual test cases для Zephyr.
Верни ТОЛЬКО валидный JSON без markdown и без пояснений.

Нужно сформировать JSON в формате:

{
  "schema": "simplec.zephyr_import.v1",
  "context": {"platform": "...", "feature": "..."},
  "testCases": [
    {
      "name": "...",                       // формат: [<platform>][<feature>] <Title>
      "description": "...",
      "preconditions": "...",              // одной строкой, можно с \\n
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
- Description и Preconditions — отдельные поля.
- Steps: обязательно action и result; testData может быть пустым.
- Result ВСЕГДА одной строкой и содержит 4 секции: UI:, API:, DB:, Kafka:. Если слой не применим — N/A.
- status всегда "требуется согласование".
- Используй сокращения UI/API/DB/Kafka.
- trace: используй id требования (например REQ-1).
"""


def _name(platform: str, feature: str, title: str) -> str:
    tpl = load_manual_template()
    return tpl.naming.name_format.format(platform=platform, feature=feature, title=title).strip()


def generate_zephyr_import_openai(normalized: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Не задан OPENAI_API_KEY")

    client = OpenAI(api_key=api_key)

    items: List[Dict[str, Any]] = normalized.get("items", [])
    context = {"platform": platform, "feature": feature}

    # Дадим модели структуру входа + жёсткие требования к выходу
    user_payload = {
        "context": context,
        "requirements": [
            {"id": it.get("id"), "text": it.get("text")}
            for it in items
        ],
        "requirements_count": len(items),
        "output_contract": {
            "schema": "simplec.zephyr_import.v1",
            "status_fixed": "требуется согласование",
            "expected_format": "UI: ... API: ... DB: ... Kafka: ...",
            "name_format_example": _name(platform, feature, "Короткий заголовок"),
        },
    }

    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        temperature=0.2,
    )

    content = resp.choices[0].message.content or ""
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"LLM вернул не-JSON. Ответ:\n{content}") from e

    # Мини-валидация
    if data.get("schema") != "simplec.zephyr_import.v1":
        raise RuntimeError(f"Неверная schema в ответе LLM: {data.get('schema')}")
    if "testCases" not in data or not isinstance(data["testCases"], list):
        raise RuntimeError("LLM не вернул testCases[]")

    # Дожмём status на всякий случай
    for tc in data["testCases"]:
        tc["status"] = "требуется согласование"
        tc.setdefault("customFields", {})
        tc["customFields"].setdefault("platform", platform)
        tc["customFields"].setdefault("feature", feature)

    return data
