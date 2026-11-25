"""Render generated PlantUML on the Shark server using PlantUML's sandbox profile."""
import os
import re
import shutil
import subprocess
from pathlib import Path

_DIAGRAM = re.compile(r"(?ms)^[ \t]{0,3}\x60{3}(?:plantuml|puml)[ \t]*\n(.*?)^[ \t]{0,3}\x60{3}[^\S\n]*$"
                      r"|^[ \t]{0,3}(@startuml\b.*?^[ \t]{0,3}@enduml\b[^\S\n]*)")
_PNG = b"\x89PNG\r\n\x1a\n"


def render_markdown(markdown: str, save_image) -> tuple[str, list[str]]:
    errors = []
    jar = os.getenv("PLANTUML_JAR", "").strip()
    exe = shutil.which("plantuml")
    command = ["java", "-DPLANTUML_SECURITY_PROFILE=SANDBOX", "-jar", jar] if jar and Path(jar).is_file() else [exe] if exe else []
    env = dict(os.environ, PLANTUML_SECURITY_PROFILE="SANDBOX")
    rendered = 0

    def replace(match):
        nonlocal rendered
        rendered += 1
        diagram = (match.group(1) or match.group(2)).strip()
        if not diagram.lower().startswith("@startuml"):
            diagram = f"@startuml\n{diagram}\n@enduml"
        if not command:
            message = "Для отрисовки схем настройте PlantUML на сервере Shark."
        elif len(diagram) > 30000 or rendered > 24:
            message = "Превышен лимит размера или количества схем."
        else:
            try:
                result = subprocess.run([*command, "-pipe", "-tpng", "-charset", "UTF-8"],
                                        input=diagram.encode(), capture_output=True, timeout=12, env=env)
                if result.returncode or not result.stdout.startswith(_PNG):
                    raise ValueError("PlantUML")
                url = save_image(result.stdout)
                return f"\n![Схема PlantUML {rendered}]({url})\n"
            except (OSError, ValueError, subprocess.TimeoutExpired):
                message = "PlantUML не смог обработать схему. Проверьте её синтаксис."
        if message not in errors:
            errors.append(message)
        return f"\n> Схема {rendered}. {message}\n"

    return _DIAGRAM.sub(replace, markdown), errors
