"""Find business versions in requirements and reuse already documented pages."""
from __future__ import annotations

import asyncio
import hashlib
import re

from agents.md_diff import diff

_HEAD = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_LIST = re.compile(r"^\s*(?:[-+*]\s+|\d+[.)]\s+)")
_VERSION = re.compile(
    r"^(?:(?:версия|version|редакция)\s*[№:.]?\s*(?:[vв]\.?\s*)?|[vв]\.?\s*)"
    r"(\d+(?:\.\d+)*)(?=$|[\s:.)—–-])", re.I,
)
_INLINE = re.compile(r"(?<!\w)(?:[vв]\.?\s*|версия\s+)(\d+(?:\.\d+)*)\s*[—–:-]\s*", re.I)
_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_VERSION_COLUMN = re.compile(r"\b(?:верси[яию]|version|редакция|релиз)\b", re.I)
_SEPARATOR = re.compile(r":?-{2,}:?")


def version_order(label: str) -> tuple[int, ...]:
    return tuple(map(int, label[1:].split(".")))


def _plain(text: str) -> str:
    return re.sub(r"\*\*|__|`|~~", "", text).strip()


def _label(text: str, *, numeric: bool = False) -> str:
    plain = _plain(text)
    match = _VERSION.match(plain)
    if not match and numeric:
        match = re.fullmatch(r"(\d+(?:\.\d+)*)", plain)
    if not match:
        return ""
    return "V" + ".".join(part.lstrip("0") or "0" for part in match[1].split("."))


def _cells(line: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<!\\)\|", line.strip().removeprefix("|").removesuffix("|"))]


def _version_table(lines: list[str]) -> dict[str, list[str]]:
    if len(lines) < 2:
        return {}
    header = _cells(lines[0])
    has_header = all(_SEPARATOR.fullmatch(cell) for cell in _cells(lines[1]))
    data_lines = lines[2:] if has_header else lines
    data = [_cells(line) for line in data_lines]
    named_column = next((i for i, cell in enumerate(header) if _VERSION_COLUMN.search(_plain(cell))), None) if has_header else None
    out: dict[str, list[str]] = {}
    columns = [(i, _label(cell)) for i, cell in enumerate(header)] if has_header and named_column is None else []
    if any(label and any(i < len(row) and _label(row[i]) for row in data) for i, label in columns):
        # Confluence Markdown uses the first row as a header even when the source table has no header.
        has_header, columns = False, []
        data_lines, data = [lines[0], *data_lines], [header, *data]
    version_columns = {i for i, label in columns if label}
    has_version_headers = bool(version_columns) and all(
        not _label(row[0]) for row in data if row and row[0] and 0 not in version_columns
    )
    if has_version_headers and (len(version_columns) > 1 or next(iter(version_columns)) > 0):
        for i, label in columns:
            if not label:
                continue
            rows = []
            for row in data:
                if i >= len(row) or not row[i] or row[i] in ("—", "-"):
                    continue
                common = [f"{name}: {value}" for j, (name, value) in enumerate(zip(header, row))
                          if j not in version_columns and value]
                rows.append(" · ".join([*common, row[i]]))
            if rows:
                out.setdefault(label, []).append("\n".join(f"- {row}" for row in rows))
        return out

    column = named_column
    if column is None:
        scores = [sum(bool(_label(row[i])) for row in data if i < len(row)) for i in range(len(header))]
        if not scores or not max(scores):
            return {}
        column = scores.index(max(scores))
    group = ""
    rows: dict[str, list[str]] = {}
    for row, line in zip(data, data_lines):
        cell = row[column] if column < len(row) else ""
        if cell:
            group = _label(cell, numeric=named_column is not None)
        if group:
            rows.setdefault(group, []).append(line)
    return {label: ["\n".join([*(lines[:2] if has_header else []), *group_lines])]
            for label, group_lines in rows.items()}


def explicit_versions(text: str) -> dict[str, str]:
    """Recognize headers, version paragraphs/lists and Confluence tables outside code blocks."""
    versions: dict[str, list[str]] = {}
    lines = text.splitlines()
    body: list[str] = []
    active = ""
    level = parent_level = 0
    fence = ""

    def finish():
        if active and body:
            versions.setdefault(active, []).append("\n".join(body).strip())
        body.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        match = _FENCE.match(line)
        if fence or match:
            if match:
                if not fence:
                    fence = match[1]
                elif match[1].startswith(fence):
                    fence = ""
            if active:
                body.append(line)
            continue
        if line.lstrip().startswith("|"):
            table = [line]
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                table.append(lines[i])
                i += 1
            rows = _version_table(table)
            if rows:
                for label, parts in rows.items():
                    versions.setdefault(label, []).extend(parts)
            elif active:
                body.extend(table)
            continue
        heading = _HEAD.match(line)
        plain = _plain(heading[2] if heading else _LIST.sub("", line.lstrip("> ")))
        inline = list(_INLINE.finditer(plain))
        if len(inline) > 1 and (inline[0].start() == 0 or _VERSION_COLUMN.search(plain[:inline[0].start()])):
            finish()
            active = ""
            for index, match in enumerate(inline):
                end = inline[index + 1].start() if index + 1 < len(inline) else len(plain)
                label = _label(plain[match.start():end])
                versions.setdefault(label, []).append(plain[match.start():end].strip(" ;"))
            continue
        label = _label(plain)
        if label:
            finish()
            active, level = label, len(heading[1]) if heading else parent_level
            body.append(line)
        elif heading:
            parent_level = len(heading[1])
            if active and parent_level <= level:
                finish()
                active = ""
            if active:
                body.append(line)
        elif active and not line.startswith("> Источник:"):
            body.append(line)
    finish()
    return {label: "\n\n".join(dict.fromkeys(parts)) for label, parts in sorted(versions.items(), key=lambda p: version_order(p[0]))}


def version_sections(item: dict) -> list[tuple[str, str]]:
    text = item["text"]
    found = explicit_versions(text)
    if found:
        return list(found.items())

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
        content = current if not old else "\n".join(
            f"- {c['kind']}: {c['section'] + ' · ' if c['section'] else ''}{c['text']}"
            + (f" (было: {c['old']})" if c.get("old") else "") for c in diff(old, current)["items"]
        )
        if content.strip() or current != old:
            out.append((f"V{version}", content or "Изменилось оформление исходника."))
        old = current
    return out


def overview_sections(markdown: str) -> list[str]:
    parts, lines = [], []
    fence = ""
    for line in markdown.splitlines(keepends=True):
        marker = _FENCE.match(line)
        if marker:
            if not fence:
                fence = marker[1]
            elif marker[1].startswith(fence):
                fence = ""
        if not fence and re.match(r"^##\s+", line) and lines:
            parts.append("".join(lines))
            lines = []
        lines.append(line)
    if lines:
        parts.append("".join(lines))
    return parts


def apply_overview_edits(sections: list[str], plan: dict) -> str:
    if not isinstance(plan, dict) or not isinstance(plan.get("replace"), list) or not isinstance(plan.get("add"), list):
        raise ValueError("Модель не вернула список правок QA-обзора.")
    edits = {}
    for edit in plan["replace"]:
        if not isinstance(edit, dict):
            raise ValueError("Некорректная правка раздела QA-обзора.")
        index, markdown = edit.get("index"), edit.get("markdown")
        if type(index) is not int or not 1 <= index <= len(sections) or index in edits or not isinstance(markdown, str):
            raise ValueError("Модель указала неверный номер или текст раздела QA-обзора.")
        edits[index] = markdown.strip() + "\n\n" if markdown.strip() else ""
    additions = plan["add"]
    if any(not isinstance(md, str) or not md.strip().startswith("## ") for md in additions):
        raise ValueError("Новые разделы QA-обзора должны начинаться с заголовка Markdown.")
    out = [edits.get(index, section) for index, section in enumerate(sections, 1)]
    insert = next((i for i, part in enumerate(out) if part.startswith("## Текст для рассказа")), len(out))
    if additions and insert and not out[insert - 1].endswith("\n\n"):
        out[insert - 1] += "\n\n"
    out[insert:insert] = [md.strip() + "\n\n" for md in additions]
    result = "".join(out).strip()
    if not result:
        raise ValueError("После правок QA-обзор оказался пустым.")
    return result


async def build_release_pages(item: dict, build_markdown, render_markdown, *,
                              versions: dict[str, str] | None = None, repair=None) -> list[dict]:
    versions = versions if versions is not None else explicit_versions(item["text"])
    pending = list(versions.items()) if versions else version_sections(item)
    existing = {p["id"]: p for p in item.get("release_pages", []) if not versions or p["id"] in versions}
    if len(pending) > 20:
        raise ValueError("В исходнике больше 20 версий. Обработайте их отдельными документами.")
    for label, body in pending:
        fingerprint = hashlib.sha256(body.encode()).hexdigest()
        old = existing.get(label)
        if old and old.get("fingerprint") == fingerprint and old.get("markdown"):
            if repair and repair(old["markdown"], old.get("source") or ""):
                source = old.get("source") or old["markdown"]
                rendered = await asyncio.to_thread(render_markdown, source)
                existing[label] = {**old, "source": source, "markdown": rendered}
            continue
        markdown = await asyncio.to_thread(build_markdown, label, body)
        if not markdown.strip():
            raise ValueError(f"Модель вернула пустое описание {label}.")
        rendered = await asyncio.to_thread(render_markdown, markdown)
        existing[label] = {"id": label, "fingerprint": fingerprint, "source": markdown, "markdown": rendered, "requirement": body}
    return sorted(existing.values(), key=lambda p: version_order(p["id"]))
