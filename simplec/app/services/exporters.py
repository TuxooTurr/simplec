from __future__ import annotations

import os
from pathlib import Path
from typing import List, Dict, Any, Optional


def export_manual_md(manual_tests: List[Dict[str, Any]]) -> str:
    lines = ["# Manual Test Cases", ""]
    for tc in manual_tests:
        lines += [
            f"## {tc.get('id', '')}: {tc.get('title', '')}",
            f"- Priority: {tc.get('priority', '')}",
            f"- Trace: {tc.get('trace', '')}",
            "",
            "**Steps:**",
        ]
        for i, step in enumerate(tc.get("steps", []), start=1):
            lines.append(f"{i}. {step}")
        lines += ["", f"**Expected:** {tc.get('expected', '')}", ""]
    return "\n".join(lines).strip() + "\n"


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def export_java_skeleton_dir(
    skel: Dict[str, Any],
    out_dir: str = "out",
) -> Optional[str]:
    project_name = skel.get("project_name", "simplec-autotests")
    root = Path(out_dir) / project_name
    root.mkdir(parents=True, exist_ok=True)

    files = skel.get("files", {})
    if not isinstance(files, dict) or not files:
        return None

    # Записываем файлы
    for rel_path, content in files.items():
        _write_text(root / rel_path, content)

    return str(root)
