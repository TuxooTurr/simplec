"""Extract release sections from a requirement and keep already documented releases."""
from __future__ import annotations

import asyncio
import hashlib
import re

from agents.md_diff import diff

_VERSION = re.compile(r"^\s{0,3}#{1,6}\s+(?:версия\s*|[vв]\s*)(\d+(?:\.\d+)*)(?=\s|[:.)—–-]|$)", re.I | re.M)


def version_sections(item: dict) -> list[tuple[str, str]]:
    text = item["text"]
    sections = {}
    matches = list(_VERSION.finditer(text))
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        label = "V" + match[1]
        sections.setdefault(label, []).append(text[match.start():end].strip())
    if sections:
        return [(label, "\n\n".join(parts)) for label, parts in sections.items()]

    snapshots = [(v["n"], v.get("text", "")) for v in item.get("versions", [])]
    previous = item.get("qa_source_text", "")
    n = item.get("version", 1)
    old_n = item.get("qa_content_version", n)
    if previous:
        if previous == text:
            return []
        snapshots = []
        n = max(n, old_n + 1)
    snapshots.append((n, text))
    out = []
    old = previous
    for version, current in snapshots:
        if not current.strip():
            continue
        content = current
        if old:
            content = "\n".join(
                f"- {c['section'] + ': ' if c['section'] else ''}{c['text']}"
                for c in diff(old, current)["items"] if c["kind"] != "removed"
            )
        if content.strip() or current != old:
            out.append((f"V{version}", content or "В этой версии убраны пункты; новых требований нет."))
        old = current
    return out


async def build_release_pages(item: dict, build_markdown, render_markdown) -> list[dict]:
    existing = {p["id"]: p for p in item.get("release_pages", [])}
    pending = version_sections(item)
    if len(pending) > 20:
        raise ValueError("В исходнике больше 20 версий. Обработайте их отдельными документами.")
    for label, body in pending:
        fingerprint = hashlib.sha256(body.encode()).hexdigest()
        old = existing.get(label)
        if old and old.get("fingerprint") == fingerprint:
            continue
        markdown = await asyncio.to_thread(build_markdown, label, body)
        if not markdown.strip():
            raise ValueError(f"Модель вернула пустое описание {label}.")
        existing[label] = {"id": label, "fingerprint": fingerprint, "source": markdown, "requirement": body}
    out = []
    for page in sorted(existing.values(), key=lambda p: tuple(map(int, p["id"][1:].split(".")))):
        rendered = await asyncio.to_thread(render_markdown, page.get("source", page.get("markdown", "")))
        out.append({**page, "markdown": rendered})
    return out
