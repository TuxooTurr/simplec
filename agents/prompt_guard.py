"""
Защита от prompt injection и вредоносного ввода.
"""

import re


DANGEROUS_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"ignore\s+(all\s+)?above",
    r"disregard\s+(all\s+)?previous",
    r"forget\s+(all\s+)?previous",
    r"you\s+are\s+now",
    r"act\s+as\s+if",
    r"pretend\s+(to\s+be|you\s+are)",
    r"system\s*:\s*",
    r"<\|im_start\|>",
    r"<\|im_end\|>",
    r"$$INST$$",
    r"$$/INST$$",
    r"<<SYS>>",
    r"<</SYS>>",
]

MAX_INPUT_LENGTH = 100000  # 100K символов


def sanitize_input(text: str) -> dict:
    result = {
        "text": text,
        "warnings": [],
        "blocked": False,
    }

    if not text or not text.strip():
        result["warnings"].append("Пустой ввод")
        return result

    if len(text) > MAX_INPUT_LENGTH:
        result["text"] = text[:MAX_INPUT_LENGTH]
        result["warnings"].append(
            "Текст обрезан до " + str(MAX_INPUT_LENGTH) + " символов"
        )

    text_lower = text.lower()
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, text_lower):
            result["warnings"].append(
                "Обнаружен подозрительный паттерн: " + pattern
            )
            result["text"] = re.sub(
                pattern, "[FILTERED]", result["text"],
                flags=re.IGNORECASE
            )

    null_bytes = text.count("\x00")
    if null_bytes > 0:
        result["text"] = result["text"].replace("\x00", "")
        result["warnings"].append(
            "Удалено null-байтов: " + str(null_bytes)
        )

    return result


def is_safe(text: str) -> bool:
    result = sanitize_input(text)
    return len(result["warnings"]) == 0

