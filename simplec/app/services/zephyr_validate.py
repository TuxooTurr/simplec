from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from jsonschema import Draft202012Validator


def validate_zephyr_import(data: Dict[str, Any]) -> None:
    schema_path = Path("simplec/config/zephyr_import_v1.schema.json")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    v = Draft202012Validator(schema)
    errors = sorted(v.iter_errors(data), key=lambda e: e.path)

    if errors:
        lines = ["zephyr_import.json schema validation failed:"]
        for e in errors[:20]:
            where = "$"
            if e.path:
                where += "".join([f"[{repr(p)}]" if isinstance(p, int) else f".{p}" for p in e.path])
            lines.append(f"- {where}: {e.message}")
        if len(errors) > 20:
            lines.append(f"... and {len(errors)-20} more errors")
        raise ValueError("\n".join(lines))
