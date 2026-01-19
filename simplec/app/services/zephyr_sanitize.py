from __future__ import annotations

import re
from typing import Any, Dict, List


_LAYER_ORDER = ["UI", "API", "DB", "Kafka"]


def _ensure_expected_format(s: str) -> str:
    """
    Ensure one-line: 'UI: ... API: ... DB: ... Kafka: ...' with all layers present.
    """
    s = " ".join((s or "").split())  # collapse whitespace/newlines

    # Extract any existing "X: ..." chunks
    found: Dict[str, str] = {}
    for layer in _LAYER_ORDER:
        m = re.search(rf"\b{layer}:\s*(.*?)(?=\b(?:UI|API|DB|Kafka):|$)", s)
        if m:
            found[layer] = m.group(1).strip()

    # If nothing parsed, treat whole string as UI
    if not found and s:
        found["UI"] = s

    # Normalize "Нет ..." to N/A
    for k, v in list(found.items()):
        if re.search(r"^(нет|отсутств|не предусмотр|n/a)\b", v.strip(), flags=re.IGNORECASE):
            found[k] = "N/A"

    parts = [f"{layer}: {found.get(layer, 'N/A')}" for layer in _LAYER_ORDER]
    return " ".join(parts).strip()


def _infer_labels_priority(text: str) -> tuple[list[str], str | None]:
    t = (text or "").lower()
    labels: list[str] = []
    prio: str | None = None

    if any(k in t for k in ["auth", "логин", "вход", "авторизац"]):
        labels.append("auth")

    if any(k in t for k in ["ошиб", "неверн", "invalid", "incorrect"]):
        labels.append("negative")
        prio = prio or "P2"

    if any(k in t for k in ["блокиров", "lock", "locked", "5 попыт", "bruteforce", "security"]):
        labels.extend(["security", "lockout"])
        prio = "P0"

    return sorted(set(labels)), prio

def sanitize_zephyr_import(data: Dict[str, Any], platform: str, feature: str) -> Dict[str, Any]:
    if data.get("schema") != "simplec.zephyr_import.v1":
        raise ValueError("Unsupported schema")

    tcs: List[Dict[str, Any]] = data.get("testCases") or []
    if not isinstance(tcs, list):
        raise ValueError("testCases must be a list")

    for tc in tcs:
        tc["status"] = "требуется согласование"
        tc.setdefault("labels", [])
        tc.setdefault("customFields", {})
        tc["customFields"].setdefault("platform", platform)
        tc["customFields"].setdefault("feature", feature)

        # infer labels/priority from name+description (best-effort)
        src_text = f"{tc.get('name','')}\n{tc.get('description','')}"
        inferred_labels, inferred_prio = _infer_labels_priority(src_text)
        tc.setdefault('labels', [])
        tc['labels'] = sorted(set(list(tc.get('labels') or []) + inferred_labels))
        if inferred_prio and tc.get('priority') not in ['P0','P1','P2','P3']:
            tc['priority'] = inferred_prio
        elif inferred_prio:
            # if already set, keep stricter priority (P0 highest)
            order = {'P0':0,'P1':1,'P2':2,'P3':3}
            cur = tc.get('priority','P2')
            tc['priority'] = min([cur, inferred_prio], key=lambda x: order.get(x, 9))

        steps = tc.get("steps") or []
        if not steps:
            tc["steps"] = [{"action": "N/A", "testData": "", "result": "UI: N/A API: N/A DB: N/A Kafka: N/A"}]
            continue

        for st in steps:
            st.setdefault("action", "")
            st.setdefault("testData", "")
            st["result"] = _ensure_expected_format(st.get("result", ""))

    return data
