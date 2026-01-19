from __future__ import annotations

import re
from typing import Dict, Any, List


def normalize_requirements(raw_text: str) -> Dict[str, Any]:
    """
    MVP-нормализация:
    - режем на "пункты" по строкам
    - отмечаем вероятные требования по словам должен/должна/должны/shall/must
    """
    text = (raw_text or "").strip()
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

    req_markers = re.compile(r"\b(должен|должна|должны|must|shall|should)\b", re.IGNORECASE)

    items: List[Dict[str, Any]] = []
    for i, ln in enumerate(lines, start=1):
        items.append(
            {
                "id": f"REQ-L{i:04d}",
                "text": ln,
                "is_requirement_like": bool(req_markers.search(ln)),
            }
        )

    return {
        "version": "mvp-0",
        "raw_len": len(text),
        "items": items,
    }
