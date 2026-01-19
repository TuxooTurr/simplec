from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict


def _new_out_dir() -> str:
    # milliseconds to avoid collisions on fast repeated runs
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")[:-3]
    out_dir = os.path.join("out", f"run-{ts}")
    os.makedirs(out_dir, exist_ok=True)
    return out_dir


def write_artifacts(
    manual_md: str,
    report: Dict[str, Any],
    normalized: Dict[str, Any],
    zephyr_import: Dict[str, Any] | None = None,
) -> str:
    out_dir = _new_out_dir()

    with open(os.path.join(out_dir, "manual_tests.md"), "w", encoding="utf-8") as f:
        f.write(manual_md)

    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with open(os.path.join(out_dir, "normalized.json"), "w", encoding="utf-8") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)

    if zephyr_import is not None:
        with open(os.path.join(out_dir, "zephyr_import.json"), "w", encoding="utf-8") as f:
            json.dump(zephyr_import, f, ensure_ascii=False, indent=2)

    return out_dir
