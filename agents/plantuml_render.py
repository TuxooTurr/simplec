"""Render QA diagrams offline with the PlantUML engine shipped with Shark."""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from functools import lru_cache
from threading import BoundedSemaphore
from xml.etree import ElementTree

from db.paths import ROOT

_DIAGRAM = re.compile(
    r"^[ \t]{0,3}`{3}(?:plantuml|puml)[ \t]*\r?\n(.*?)^[ \t]{0,3}`{3}[ \t]*\r?$"
    r"|^[ \t]{0,3}(@startuml\b.*?^[ \t]{0,3}@enduml\b[ \t]*\r?$)",
    re.MULTILINE | re.DOTALL | re.IGNORECASE,
)
_VENDOR = ROOT / "vendor" / "plantuml"
_LIMIT = 24
_SIZE_LIMIT = 30_000
_SVG_NS = "http://www.w3.org/2000/svg"
_RENDERERS = BoundedSemaphore(2)
logger = logging.getLogger(__name__)

LEGACY_DIAGRAM_ERRORS = (
    "Для отрисовки схем настройте PlantUML на сервере Shark.",
    "PlantUML не смог обработать схему. Проверьте её синтаксис.",
)
RENDERER_UNAVAILABLE = "Не удалось запустить встроенный рендерер PlantUML."
_SYNTAX_ERROR = "Не удалось построить схему PlantUML. Проверьте её синтаксис."
_LIMIT_ERROR = "Превышен лимит размера или количества схем."
_EXTERNAL_INCLUDE = re.compile(r"(?mi)^\s*!(?:include(?:_once|_many|url)?|import)\b(?!\s+<[^>\r\n]+>)")


def needs_rendering(markdown: str, source: str = "") -> bool:
    return bool(_DIAGRAM.search(markdown) or any(marker in markdown for marker in LEGACY_DIAGRAM_ERRORS)
                or (source and RENDERER_UNAVAILABLE in markdown))


@lru_cache(maxsize=2)
def _command(node: str) -> tuple[str, ...]:
    env = _worker_env()
    flags = subprocess.run(
        [node, "-p", "process.allowedNodeEnvironmentFlags.has('--permission')"],
        capture_output=True, timeout=5, check=True, env=env,
    )
    permission = "--permission" if flags.stdout.strip() == b"true" else "--experimental-permission"
    return (node, permission, f"--allow-fs-read={_VENDOR}", "--max-old-space-size=256", str(_VENDOR / "worker.mjs"))


def _worker_env() -> dict[str, str]:
    return {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR") if key in os.environ}


def _render(sources: list[str]) -> list[str | None]:
    node = shutil.which("node")
    if not node:
        raise FileNotFoundError("node")
    with _RENDERERS:
        result = subprocess.run(
            _command(node), input=json.dumps(sources).encode("utf-8"), capture_output=True,
            timeout=30, check=True, env=_worker_env(), cwd=_VENDOR,
        )
    images = json.loads(result.stdout)
    if not isinstance(images, list) or len(images) != len(sources):
        raise ValueError("Unrecognized PlantUML output")
    return images


def _safe_svg(data: str | None) -> bytes | None:
    if not isinstance(data, str) or not data or "<!DOCTYPE" in data.upper():
        return None
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError:
        return None
    if root.tag != f"{{{_SVG_NS}}}svg":
        return None
    for node in root.iter():
        for child in list(node):
            if child.tag.rsplit("}", 1)[-1].lower() in {"script", "foreignobject"}:
                node.remove(child)
        for name, value in list(node.attrib.items()):
            attr = name.rsplit("}", 1)[-1].lower()
            if attr.startswith("on") or (attr in {"href", "src"} and not value.startswith("#")):
                del node.attrib[name]
    return ElementTree.tostring(root, encoding="utf-8")


def render_markdown(markdown: str, save_image) -> tuple[str, list[str]]:
    matches = list(_DIAGRAM.finditer(markdown))
    if not matches:
        return markdown, []
    sources: dict[int, str] = {}
    problems: dict[int, str] = {}

    for position, match in enumerate(matches, 1):
        diagram = (match.group(1) or match.group(2) or "").strip()
        if position > _LIMIT or len(diagram) > _SIZE_LIMIT:
            problems[position] = _LIMIT_ERROR
        elif _EXTERNAL_INCLUDE.search(diagram):
            problems[position] = "Схема PlantUML ссылается на внешний файл. Включите нужный текст в саму схему."
        else:
            if not diagram.lower().startswith("@startuml"):
                diagram = f"@startuml\n{diagram}\n@enduml"
            sources[position] = diagram

    images = {}
    if sources:
        try:
            images = dict(zip(sources, _render(list(sources.values()))))
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            logger.warning("PlantUML worker failed: %s", type(exc).__name__)
            problems.update(dict.fromkeys(sources, RENDERER_UNAVAILABLE))

    output: list[str] = []
    cursor = 0
    errors: list[str] = []
    for position, match in enumerate(matches, 1):
        output.append(markdown[cursor:match.start()])
        svg = _safe_svg(images.get(position))
        if svg:
            url = save_image(svg)
            output.append(f"\n![Схема PlantUML {position}]({url})\n")
        else:
            message = problems.get(position, _SYNTAX_ERROR)
            errors.append(message)
            output.append(f"\n> Схема {position}. {message}\n")
        cursor = match.end()
    output.append(markdown[cursor:])
    return "".join(output), list(dict.fromkeys(errors))
