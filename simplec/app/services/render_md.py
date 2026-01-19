from __future__ import annotations

from typing import Any, Dict, List


def render_manual_md_from_zephyr_import(zephyr_import: Dict[str, Any]) -> str:
    ctx = zephyr_import.get("context", {}) or {}
    platform = ctx.get("platform", "")
    feature = ctx.get("feature", "")

    tcs: List[Dict[str, Any]] = zephyr_import.get("testCases", []) or []

    lines: List[str] = []
    lines.append(f"# Manual Test Cases")
    lines.append("")
    lines.append(f"**Platform:** {platform}  ")
    lines.append(f"**Feature:** {feature}")
    lines.append("")
    lines.append(f"Total: **{len(tcs)}**")
    lines.append("")

    for i, tc in enumerate(tcs, start=1):
        name = tc.get("name", f"TC-{i}")
        desc = tc.get("description", "")
        pre = tc.get("preconditions", "")
        status = tc.get("status", "")
        prio = tc.get("priority", "")
        labels = tc.get("labels", [])
        trace = (tc.get("customFields") or {}).get("trace", "")

        lines.append(f"## {i}. {name}")
        if trace:
            lines.append(f"- **Trace:** `{trace}`")
        if status:
            lines.append(f"- **Status:** {status}")
        if prio:
            lines.append(f"- **Priority:** {prio}")
        if labels:
            lines.append(f"- **Labels:** {', '.join(map(str, labels))}")
        lines.append("")

        if desc:
            lines.append("**Description:**")
            lines.append(desc)
            lines.append("")

        if pre:
            lines.append("**Preconditions:**")
            # preconditions у нас строкой; красиво сохраним переносы
            for ln in str(pre).splitlines():
                lines.append(f"- {ln}" if ln.strip() else "")
            lines.append("")

        steps = tc.get("steps", []) or []
        lines.append("**Steps:**")
        if not steps:
            lines.append("1. N/A")
        else:
            for j, st in enumerate(steps, start=1):
                action = st.get("action", "")
                test_data = st.get("testData", "")
                result = st.get("result", "")

                lines.append(f"{j}. **Action:** {action}")
                if test_data:
                    lines.append(f"   - **Test data:** {test_data}")
                if result:
                    lines.append(f"   - **Expected:** {result}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
