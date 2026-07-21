"""
Панель запуска автотестов.

REST:
  GET  /api/autotest-runs/config       — настройки панели
  PUT  /api/autotest-runs/config       — сохранить настройки панели
  GET  /api/autotest-runs/history      — история запусков
  POST /api/autotest-runs/run          — запустить пользовательский скрипт
  POST /api/autotest-runs/check-builds — проверить источник версий сборок и запустить правила
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.autotest_runs_store import AutotestRunsStore

router = APIRouter()

TEST_TYPES = {"api", "e2e", "frontend", "mobile", "dt"}
SCRIPT_EXTENSIONS = {".sh", ".bash", ".py", ".cmd", ".bat"}
SCRIPT_NAME_HINTS = (
    "run", "test", "smoke", "regress", "regression", "api", "e2e",
    "autotest", "qa", "check", "suite",
)
SCRIPT_SKIP_DIRS = {
    ".git", ".idea", ".vscode", ".venv", "venv", "node_modules",
    ".next", "dist", "out", "target", "build", ".gradle", "__pycache__",
}
SCRIPT_SCAN_MAX_DEPTH = 5
SCRIPT_SCAN_LIMIT = 250


class RunScript(BaseModel):
    id: str = ""
    name: str
    script_path: str = ""
    work_dir: str = ""
    default_tags: list[str] = Field(default_factory=list)
    test_types: list[str] = Field(default_factory=list)
    microservices: list[str] = Field(default_factory=list)
    enabled: bool = True
    timeout_sec: int = 1200
    ui_size: str = "md"
    ui_order: int = 0


class AutorunRule(BaseModel):
    id: str = ""
    name: str
    microservice: str = "*"
    script_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    use_microservice_as_tag: bool = True
    test_types: list[str] = Field(default_factory=list)
    enabled: bool = True
    ui_size: str = "md"
    ui_order: int = 0


class AutorunConfig(BaseModel):
    enabled: bool = False
    source_type: Literal["url", "file"] = "url"
    source_url: str = ""
    source_file_path: str = ""
    poll_interval_sec: int = 120
    version_regex: str = r"(?P<microservice>[A-Za-z0-9_.-]+)\s*[:=]\s*(?P<version>[A-Za-z0-9_.-]+)"
    run_on_first_seen: bool = False
    rules: list[AutorunRule] = Field(default_factory=list)
    last_seen: dict[str, str] = Field(default_factory=dict)
    last_check_at: str = ""


class AutotestRunConfig(BaseModel):
    framework_path: str = ""
    selected_types: list[str] = Field(default_factory=list)
    selected_tags: list[str] = Field(default_factory=list)
    scripts: list[RunScript] = Field(default_factory=list)
    autorun: AutorunConfig = Field(default_factory=AutorunConfig)
    # LLM-сгенерированные понятные названия кейсов/папок: {id -> название}
    test_labels: dict[str, str] = Field(default_factory=dict)
    analyzed_at: str = ""


class SaveConfigRequest(BaseModel):
    config: AutotestRunConfig


class RunScriptRequest(BaseModel):
    script_id: str
    tags: list[str] = Field(default_factory=list)
    test_types: list[str] = Field(default_factory=list)
    tests: list[str] = Field(default_factory=list)
    microservice: str = ""
    build_version: str = ""
    trigger: Literal["manual", "autorun"] = "manual"


class CheckBuildsRequest(BaseModel):
    execute: bool = True


class CreateScenarioRequest(BaseModel):
    name: str = ""
    tests: list[str] = Field(default_factory=list)
    test_types: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class AnalyzeTreeRequest(BaseModel):
    provider: str = ""


class ScriptOption(BaseModel):
    name: str
    path: str
    relative_path: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tail_text(value: object, limit: int = 12000) -> str:
    if value is None:
        return ""
    return str(value)[-limit:]


def _add_history_safe(entry: dict) -> Optional[str]:
    try:
        AutotestRunsStore.add_history(entry)
    except Exception as exc:
        return f"Запуск выполнен, но аудит не сохранился: {exc}"
    return None


def _clean_list(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        clean = str(value).strip()
        if clean and clean not in result:
            result.append(clean)
    return result


def _find_script(config: dict, script_id: str) -> dict:
    for script in config.get("scripts", []):
        if script.get("id") == script_id:
            return script
    raise HTTPException(status_code=404, detail=f"Скрипт '{script_id}' не найден")


def _script_command(script_path: Path) -> list[str]:
    suffix = script_path.suffix.lower()
    if suffix == ".py":
        return [sys.executable, str(script_path)]
    if suffix in {".sh", ".bash"}:
        return ["bash", str(script_path)]
    if suffix in {".cmd", ".bat"} and os.name == "nt":
        return [str(script_path)]
    if os.access(script_path, os.X_OK):
        return [str(script_path)]
    return ["bash", str(script_path)]


def _candidate_script_paths(script_path_raw: str, config: dict, script: dict) -> list[Path]:
    raw_path = Path(script_path_raw).expanduser()
    if raw_path.is_absolute():
        return [raw_path]

    candidates: list[Path] = []
    framework_path_raw = str(config.get("framework_path", "")).strip()
    work_dir_raw = str(script.get("work_dir", "")).strip()

    for base_raw in (work_dir_raw, framework_path_raw):
        if not base_raw:
            continue
        base = Path(base_raw).expanduser()
        if not base.is_absolute() and framework_path_raw:
            base = Path(framework_path_raw).expanduser() / base
        candidates.append(base / raw_path)

    candidates.append(Path.cwd() / raw_path)
    return candidates


def _resolve_script_path(script_path_raw: str, config: dict, script: dict) -> Path:
    checked: list[str] = []
    for candidate in _candidate_script_paths(script_path_raw, config, script):
        resolved = candidate.expanduser().resolve()
        if str(resolved) in checked:
            continue
        checked.append(str(resolved))
        if not resolved.exists():
            continue
        if not resolved.is_file():
            raise ValueError(f"Путь ведет не к файлу: {resolved}")
        return resolved

    hint = ""
    if checked:
        hint = ". Проверенные варианты: " + "; ".join(checked[:4])
    raise ValueError(f"Скрипт не найден: {script_path_raw}{hint}")


def _resolve_work_dir(work_dir_raw: str, framework_path: str, script_path: Path) -> Path:
    if not work_dir_raw:
        if framework_path:
            work_dir = Path(framework_path).expanduser().resolve()
            if work_dir.exists() and work_dir.is_dir():
                return work_dir
        return script_path.parent

    raw = Path(work_dir_raw).expanduser()
    candidates = [raw] if raw.is_absolute() else []
    if framework_path and not raw.is_absolute():
        candidates.append(Path(framework_path).expanduser() / raw)
    if not raw.is_absolute():
        candidates.append(Path.cwd() / raw)

    checked: list[str] = []
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if str(resolved) in checked:
            continue
        checked.append(str(resolved))
        if resolved.exists() and resolved.is_dir():
            return resolved

    hint = ""
    if checked:
        hint = ". Проверенные варианты: " + "; ".join(checked[:4])
    raise ValueError(f"Рабочая папка не найдена: {work_dir_raw}{hint}")


def _looks_like_run_script(path: Path) -> bool:
    if not path.is_file():
        return False
    name = path.name.lower()
    if path.suffix.lower() in SCRIPT_EXTENSIONS:
        return True
    if any(hint in name for hint in SCRIPT_NAME_HINTS) and os.access(path, os.X_OK):
        return True
    return False


def _scan_script_options(root_raw: str) -> tuple[Path, list[dict]]:
    if not root_raw.strip():
        return Path(), []

    root = Path(root_raw).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Папка фреймворка не найдена: {root}")

    options: list[dict] = []
    for current_root, dirnames, filenames in os.walk(root):
        current = Path(current_root)
        try:
            depth = len(current.relative_to(root).parts)
        except ValueError:
            depth = 0
        if depth >= SCRIPT_SCAN_MAX_DEPTH:
            dirnames[:] = []
        else:
            dirnames[:] = [
                name for name in dirnames
                if name not in SCRIPT_SKIP_DIRS and not name.startswith(".cache")
            ]

        for filename in filenames:
            candidate = current / filename
            if not _looks_like_run_script(candidate):
                continue
            relative = candidate.relative_to(root)
            options.append({
                "name": candidate.name,
                "path": str(candidate),
                "relative_path": str(relative),
            })
            if len(options) >= SCRIPT_SCAN_LIMIT:
                options.sort(key=lambda item: (item["relative_path"].count(os.sep), item["relative_path"].lower()))
                return root, options

    options.sort(key=lambda item: (item["relative_path"].count(os.sep), item["relative_path"].lower()))
    return root, options


# ── Test-tree discovery ───────────────────────────────────────────────────────
# Lightweight regex parsing of JUnit5 Java/Kotlin tests, mirroring the project
# analyzer in autotests_gen.py. We surface classes + @Test methods + @Tag so the
# UI can show a checkable tree of real cases instead of opaque scripts.

TEST_DIR_CANDIDATES = (
    ("src", "test", "java"),
    ("src", "test", "kotlin"),
    ("src", "androidTest", "java"),
    ("src", "androidTest", "kotlin"),
    ("tests",),
    ("test",),
)
TEST_SCAN_FILE_LIMIT = 400

_RE_PACKAGE = re.compile(r"^\s*package\s+([\w.]+)", re.MULTILINE)
_RE_DISPLAY = re.compile(r'@DisplayName\s*\(\s*"((?:[^"\\]|\\.)*)"')
_RE_TAG = re.compile(r'@Tag\s*\(\s*"([^"]*)"')
_RE_TEST_ANNO = re.compile(r"@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b")
_RE_ANNO_STRIP = re.compile(r"@\w+\s*(?:\([^)]*\))?")
_RE_CLASS = re.compile(r"\bclass\s+(\w+)")
_RE_KT_BACKTICK = re.compile(r"\bfun\s+`([^`]+)`\s*\(")
_RE_METHOD_NAME = re.compile(r"(\w+)\s*\(")
_METHOD_KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "new", "synchronized", "fun"}


def _test_dirs(root: Path) -> list[Path]:
    dirs = [root.joinpath(*parts) for parts in TEST_DIR_CANDIDATES]
    found = [d for d in dirs if d.exists() and d.is_dir()]
    return found or [root]


def _parse_test_file(text: str, rel_path: str) -> Optional[dict]:
    """Extract one test class (name, display, tags, @Test methods) from a source file."""
    pkg_match = _RE_PACKAGE.search(text)
    package = pkg_match.group(1) if pkg_match else ""

    class_name = ""
    class_display = ""
    class_tags: list[str] = []
    methods: list[dict] = []
    found_class = False

    pending_display = ""
    pending_tags: list[str] = []
    seen_test = False

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("//") or line.startswith("*") or line.startswith("/*"):
            continue

        dn = _RE_DISPLAY.search(line)
        if dn:
            pending_display = dn.group(1)
        tags = _RE_TAG.findall(line)
        if tags:
            pending_tags.extend(tags)
        if _RE_TEST_ANNO.search(line):
            seen_test = True

        # strip annotations so an inline `@Test void foo()` still exposes the signature
        code = _RE_ANNO_STRIP.sub("", line).strip()
        if not code:
            continue

        if not found_class:
            cls = _RE_CLASS.search(code)
            if cls:
                class_name = cls.group(1)
                class_display = pending_display
                class_tags = list(dict.fromkeys(pending_tags))
                found_class = True
                pending_display, pending_tags, seen_test = "", [], False
            continue

        if seen_test:
            bt = _RE_KT_BACKTICK.search(code)
            name = bt.group(1) if bt else ""
            if not name:
                mm = _RE_METHOD_NAME.search(code)
                candidate = mm.group(1) if mm else ""
                if candidate and candidate not in _METHOD_KEYWORDS:
                    name = candidate
            if name:
                methods.append({
                    "id": f"{package + '.' if package else ''}{class_name}#{name}",
                    "name": name,
                    "display": pending_display or name,
                    "tags": list(dict.fromkeys(pending_tags)),
                })
                pending_display, pending_tags, seen_test = "", [], False
            continue

        # plain code line outside a pending test — drop stale method annotations
        pending_display, pending_tags = "", []

    if not found_class or not methods:
        return None

    return {
        "id": f"{package + '.' if package else ''}{class_name}",
        "type": "class",
        "name": class_name,
        "display": class_display or class_name,
        "package": package,
        "file": rel_path,
        "tags": class_tags,
        "methods": methods,
    }


def _discover_tests_sync(framework_path_raw: str) -> dict:
    root_raw = (framework_path_raw or "").strip()
    empty = {"root": "", "total": 0, "tags": [], "classes": [], "parseable": False}
    if not root_raw:
        return empty

    root = Path(root_raw).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Папка фреймворка не найдена: {root}")

    classes: list[dict] = []
    all_tags: list[str] = []
    scanned = 0
    for base in _test_dirs(root):
        for pattern in ("*.java", "*.kt"):
            for fpath in base.rglob(pattern):
                if scanned >= TEST_SCAN_FILE_LIMIT:
                    break
                if any(part in SCRIPT_SKIP_DIRS for part in fpath.parts):
                    continue
                scanned += 1
                try:
                    text = fpath.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                if not _RE_TEST_ANNO.search(text):
                    continue
                try:
                    rel = str(fpath.relative_to(root))
                except ValueError:
                    rel = fpath.name
                parsed = _parse_test_file(text, rel)
                if not parsed:
                    continue
                classes.append(parsed)
                for tag in parsed["tags"]:
                    all_tags.append(tag)
                for method in parsed["methods"]:
                    all_tags.extend(method["tags"])

    classes.sort(key=lambda c: (c["package"], c["name"]))
    total = sum(len(c["methods"]) for c in classes)
    tags = sorted(dict.fromkeys(all_tags))
    return {
        "root": str(root),
        "total": total,
        "tags": tags,
        "classes": classes,
        "parseable": bool(classes),
    }


# ── Scenario script generation ────────────────────────────────────────────────
# "Создать сценарий" turns a tree selection into a real runnable script written
# into the framework, registered as a run scenario.

def _detect_build_tool(root: Path) -> str:
    if (root / "pom.xml").exists():
        return "maven"
    if (root / "build.gradle").exists() or (root / "build.gradle.kts").exists():
        return "gradle"
    return "unknown"


def _slugify(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", (name or "").strip()).strip("-").lower()
    return slug or f"scenario-{int(time.time())}"


def _maven_selector(sel: str) -> str:
    cls, _, method = sel.partition("#")
    simple = cls.rsplit(".", 1)[-1]
    return f"{simple}#{method}" if method else simple


def _gradle_selector(sel: str) -> str:
    cls, _, method = sel.partition("#")
    return f"{cls}.{method}" if method else cls


def _build_scenario_script(name: str, build_tool: str, tests: list[str]) -> str:
    head = (
        "#!/usr/bin/env bash\n"
        f"# Сгенерировано SimpleTest — сценарий: {name}\n"
        "# Запускает фиксированный набор тест-кейсов. Список можно отредактировать вручную.\n"
        "set -euo pipefail\n"
        'cd "$(dirname "$0")/.."\n\n'
    )
    if build_tool == "maven":
        joined = ",".join(_maven_selector(t) for t in tests)
        body = f"mvn -q -Dtest='{joined}' test\n" if joined else "mvn -q test\n"
    elif build_tool == "gradle":
        flags = " ".join(f"--tests '{_gradle_selector(t)}'" for t in tests)
        body = (
            "if [ -x ./gradlew ]; then GRADLE=./gradlew; else GRADLE=gradle; fi\n"
            f'"$GRADLE" test {flags}'.rstrip() + "\n"
        )
    else:
        listing = "\n".join(tests) or "(весь набор)"
        body = (
            'echo "Build-инструмент не распознан — отредактируйте скрипт под ваш фреймворк."\n'
            "cat <<'TESTS'\n" + listing + "\nTESTS\n"
            "exit 1\n"
        )
    return head + body


def _merge_labels(result: dict, config: dict) -> dict:
    labels = config.get("test_labels") or {}
    for c in result.get("classes", []):
        c["label"] = labels.get(c["id"], "")
        for m in c.get("methods", []):
            m["label"] = labels.get(m["id"], "")
    result["analyzed"] = bool(labels)
    result["analyzed_at"] = config.get("analyzed_at", "")
    return result


def _test_tree_sync(root_raw: str, config: dict) -> dict:
    return _merge_labels(_discover_tests_sync(root_raw), config)


def _analyze_tree_sync(provider: str) -> dict:
    from agents.llm_client import LLMClient, Message

    config = AutotestRunsStore.get_config()
    root = str(config.get("framework_path", "")).strip()
    if not root:
        raise ValueError("Сначала подключите папку с автотестами")
    tree = _discover_tests_sync(root)
    if not tree.get("parseable"):
        return {"labels": {}, "analyzed": False, "total": 0}

    items: list[dict] = []
    for c in tree["classes"]:
        items.append({"id": c["id"], "kind": "папка/группа", "name": c["name"], "hint": c["display"]})
        for m in c["methods"]:
            items.append({"id": m["id"], "kind": "тест-кейс", "name": m["name"], "hint": m["display"], "group": c["name"]})
    items = items[:300]

    prompt = (
        "Ты помогаешь QA-инженеру разобраться в автотестах.\n"
        "Ниже — список папок/групп и тест-кейсов с техническими именами (поле name) "
        "и подсказкой (hint).\n"
        "Для каждого элемента придумай КОРОТКОЕ понятное название на русском (3–7 слов): "
        "для группы — что это за набор, для тест-кейса — что он проверяет.\n"
        "Верни СТРОГО JSON-объект вида {\"<id>\": \"<понятное название>\"} без markdown и пояснений.\n\n"
        + json.dumps(items, ensure_ascii=False)
    )
    llm = LLMClient(provider=provider)
    # До 300 элементов — на больших деревьях тестов ответ реально мог упираться
    # в лимит токенов (незакрытый JSON-объект падал с ValueError без объяснения).
    resp = llm.chat_continued(
        [Message(role="user", content=prompt)], temperature=0.2, max_tokens=2000,
        continuation_instruction=(
            "Ты остановился посередине JSON-объекта. Продолжи ТОЧНО со следующей пары "
            "\"id\": \"название\" — не повторяй уже перечисленные, не открывай новый '{', "
            "не закрывай '}', просто следующие пары через запятую."
        ),
    )
    raw = (resp.content or "").strip()

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    try:
        parsed = json.loads(match.group(0) if match else raw)
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"Не удалось разобрать ответ LLM: {exc}") from exc

    valid = {it["id"] for it in items}
    labels = {str(k): str(v).strip() for k, v in parsed.items() if str(k) in valid and str(v).strip()}

    config["test_labels"] = labels
    config["analyzed_at"] = _now_iso()
    AutotestRunsStore.save_config(config)
    return {"labels": labels, "total": len(labels), "analyzed": True, "analyzed_at": config["analyzed_at"]}


def _run_script_sync(
    *,
    config: dict,
    script: dict,
    tags: list[str],
    test_types: list[str],
    tests: list[str] | None = None,
    microservice: str = "",
    build_version: str = "",
    trigger: str = "manual",
    rule_id: str = "",
    rule_name: str = "",
) -> dict:
    if not script.get("enabled", True):
        raise ValueError(f"Скрипт '{script.get('name')}' выключен")

    script_path_raw = str(script.get("script_path", "")).strip()
    if not script_path_raw:
        raise ValueError("Укажите путь до скрипта запуска")

    framework_path = str(config.get("framework_path", "")).strip()
    script_path = _resolve_script_path(script_path_raw, config, script)
    work_dir_raw = str(script.get("work_dir", "")).strip()
    work_dir = _resolve_work_dir(work_dir_raw, framework_path, script_path)

    selected_tags = _clean_list(tags or script.get("default_tags", []))
    selected_types = [t for t in _clean_list(test_types or script.get("test_types", [])) if t in TEST_TYPES]
    selected_tests = _clean_list(tests or [])
    timeout = max(10, min(int(script.get("timeout_sec") or 1200), 24 * 60 * 60))

    env = os.environ.copy()
    env.update({
        "AUTOTEST_FRAMEWORK_PATH": framework_path,
        "AUTOTEST_TAGS": ",".join(selected_tags),
        "AUTOTEST_SERVICE_TAG": microservice,
        "AUTOTEST_TYPES": ",".join(selected_types),
        # Конкретные выбранные в дереве кейсы (pkg.Class или pkg.Class#method).
        # Скрипт фреймворка прокидывает их в JUnit (-Dtest=… / --select-method).
        "AUTOTEST_TESTS": ",".join(selected_tests),
        "AUTOTEST_MICROSERVICE": microservice,
        "AUTOTEST_BUILD_VERSION": build_version,
        "AUTOTEST_TRIGGER": trigger,
    })

    started = _now_iso()
    t0 = time.perf_counter()
    command = _script_command(script_path)
    try:
        proc = subprocess.run(
            command,
            cwd=str(work_dir),
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except OSError as exc:
        raise ValueError(f"Не удалось запустить скрипт: {exc}") from exc
    duration_ms = round((time.perf_counter() - t0) * 1000)
    script_name = script.get("name", script_path.name)
    audit_type = "button" if trigger == "manual" else "autorun"
    audit_name = script_name if trigger == "manual" else (rule_name or "Автозапуск")
    result = {
        "id": f"run-{int(time.time() * 1000)}",
        "script_id": script.get("id", ""),
        "script_name": script_name,
        "button_name": script_name,
        "rule_id": rule_id,
        "rule_name": rule_name,
        "audit_type": audit_type,
        "audit_name": audit_name,
        "trigger": trigger,
        "status": "ok" if proc.returncode == 0 else "error",
        "exit_code": proc.returncode,
        "tags": selected_tags,
        "test_types": selected_types,
        "tests": selected_tests,
        "microservice": microservice,
        "build_version": build_version,
        "started_at": started,
        "duration_ms": duration_ms,
        "stdout": _tail_text(getattr(proc, "stdout", "")),
        "stderr": _tail_text(getattr(proc, "stderr", "")),
        "command": " ".join(command),
        "work_dir": str(work_dir),
    }
    history_warning = _add_history_safe(result)
    if history_warning:
        result["history_warning"] = history_warning
    return result


def _fetch_build_source(config: dict) -> str:
    autorun = config.get("autorun", {})
    if autorun.get("source_type") == "file":
        path = Path(str(autorun.get("source_file_path", "")).strip()).expanduser()
        if not path.exists() or not path.is_file():
            raise ValueError(f"Файл с версиями сборок не найден: {path}")
        return path.read_text(encoding="utf-8", errors="replace")

    url = str(autorun.get("source_url", "")).strip()
    if not url:
        raise ValueError("Укажите URL, где SimpleTest должен проверять версии сборок")
    with httpx.Client(timeout=20.0, verify=False) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.text


def _parse_build_versions(config: dict, source_text: str) -> dict[str, str]:
    autorun = config.get("autorun", {})
    pattern = autorun.get("version_regex") or r"(?P<microservice>[A-Za-z0-9_.-]+)\s*[:=]\s*(?P<version>[A-Za-z0-9_.-]+)"
    try:
        regex = re.compile(pattern, re.MULTILINE)
    except re.error as exc:
        raise ValueError(f"Некорректное регулярное выражение версий: {exc}") from exc

    detected: dict[str, str] = {}
    for match in regex.finditer(source_text):
        groups = match.groupdict()
        if "microservice" in groups and "version" in groups:
            microservice = groups["microservice"]
            version = groups["version"]
        elif len(match.groups()) >= 2:
            microservice, version = match.group(1), match.group(2)
        else:
            continue
        microservice = str(microservice).strip()
        version = str(version).strip()
        if microservice and version:
            detected[microservice] = version
    return detected


def _rule_matches(rule: dict, microservice: str) -> bool:
    rule_service = str(rule.get("microservice", "*")).strip()
    if not rule_service or rule_service == "*":
        return True
    return rule_service.lower() == microservice.lower()


def _rule_effective_tags(rule: dict, microservice: str) -> list[str]:
    tags = _clean_list(rule.get("tags", []))
    service_tag = str(microservice).strip()
    if rule.get("use_microservice_as_tag", True) and service_tag:
        if service_tag.lower() not in {tag.lower() for tag in tags}:
            tags.append(service_tag)
    return tags


def _check_builds_sync(*, execute: bool) -> dict:
    config = AutotestRunsStore.get_config()
    autorun = config.get("autorun", {})
    source_text = _fetch_build_source(config)
    detected = _parse_build_versions(config, source_text)
    previous = dict(autorun.get("last_seen") or {})
    run_on_first_seen = bool(autorun.get("run_on_first_seen", False))

    changes = []
    runs = []
    for microservice, version in detected.items():
        old_version = previous.get(microservice)
        if old_version == version:
            continue
        previous[microservice] = version
        changes.append({
            "microservice": microservice,
            "old_version": old_version or "",
            "new_version": version,
            "first_seen": not bool(old_version),
        })
        should_run = bool(old_version) or run_on_first_seen
        if not execute or not should_run:
            continue
        for rule in autorun.get("rules", []):
            if not rule.get("enabled", True) or not _rule_matches(rule, microservice):
                continue
            effective_tags = _rule_effective_tags(rule, microservice)
            for script_id in rule.get("script_ids", []):
                script = _find_script(config, script_id)
                try:
                    runs.append(_run_script_sync(
                        config=config,
                        script=script,
                        tags=effective_tags,
                        test_types=script.get("test_types", []),
                        microservice=microservice,
                        build_version=version,
                        trigger="autorun",
                        rule_id=rule.get("id", ""),
                        rule_name=rule.get("name", ""),
                    ))
                except Exception as exc:
                    error_run = {
                        "id": f"run-{int(time.time() * 1000)}",
                        "script_id": script_id,
                        "script_name": script.get("name", script_id),
                        "button_name": script.get("name", script_id),
                        "rule_id": rule.get("id", ""),
                        "rule_name": rule.get("name", ""),
                        "audit_type": "autorun",
                        "audit_name": rule.get("name", "Автозапуск"),
                        "trigger": "autorun",
                        "status": "error",
                        "exit_code": None,
                        "tags": effective_tags,
                        "test_types": script.get("test_types", []),
                        "microservice": microservice,
                        "build_version": version,
                        "started_at": _now_iso(),
                        "duration_ms": 0,
                        "stdout": "",
                        "stderr": str(exc),
                    }
                    history_warning = _add_history_safe(error_run)
                    if history_warning:
                        error_run["history_warning"] = history_warning
                    runs.append(error_run)

    AutotestRunsStore.update_autorun_state(last_seen=previous, last_check_at=_now_iso())
    return {
        "detected": detected,
        "changes": changes,
        "runs": runs,
        "checked_at": _now_iso(),
    }


@router.get("/api/autotest-runs/config")
def get_config() -> dict:
    return AutotestRunsStore.get_config()


@router.put("/api/autotest-runs/config")
def save_config(req: SaveConfigRequest) -> dict:
    return AutotestRunsStore.save_config(req.config.model_dump())


@router.get("/api/autotest-runs/history")
def get_history(limit: int = 20) -> list[dict]:
    return AutotestRunsStore.get_history(limit=limit)


@router.get("/api/autotest-runs/script-options")
def get_script_options(framework_path: str = "") -> dict:
    config = AutotestRunsStore.get_config()
    root_raw = framework_path.strip() or str(config.get("framework_path", "")).strip()
    try:
        root, options = _scan_script_options(root_raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "root": str(root) if root_raw else "",
        "options": options,
    }


@router.get("/api/autotest-runs/test-tree")
async def get_test_tree(framework_path: str = "") -> dict:
    config = AutotestRunsStore.get_config()
    root_raw = framework_path.strip() or str(config.get("framework_path", "")).strip()
    try:
        return await asyncio.to_thread(_test_tree_sync, root_raw, config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ошибка чтения тест-кейсов: {exc}")


@router.post("/api/autotest-runs/analyze-tree")
async def analyze_tree(req: AnalyzeTreeRequest) -> dict:
    provider = (req.provider or "").strip()
    if not provider:
        raise HTTPException(status_code=400, detail="LLM-провайдер не выбран")
    try:
        return await asyncio.to_thread(_analyze_tree_sync, provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        from agents.llm_client import LLMClient
        is_llm, msg = LLMClient.classify_error(exc)
        raise HTTPException(status_code=503 if is_llm else 500, detail=msg)


def _create_scenario_sync(req: CreateScenarioRequest) -> dict:
    config = AutotestRunsStore.get_config()
    framework_path = str(config.get("framework_path", "")).strip()
    if not framework_path:
        raise ValueError("Сначала подключите папку с автотестами")
    root = Path(framework_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Папка фреймворка не найдена: {root}")

    name = (req.name or "").strip() or "Сценарий"
    tests = _clean_list(req.tests)
    build_tool = _detect_build_tool(root)

    runners_dir = root / "simpletest-runners"
    runners_dir.mkdir(exist_ok=True)
    slug = _slugify(name)
    target = runners_dir / f"{slug}.sh"
    if target.exists():
        target = runners_dir / f"{slug}-{int(time.time())}.sh"
    target.write_text(_build_scenario_script(name, build_tool, tests), encoding="utf-8")
    os.chmod(target, 0o755)

    script = {
        "id": f"script-{int(time.time() * 1000)}",
        "name": name,
        "script_path": str(target.relative_to(root)),
        "work_dir": "",
        "default_tags": _clean_list(req.tags),
        "test_types": [t for t in _clean_list(req.test_types) if t in TEST_TYPES] or ["e2e"],
        "microservices": ["*"],
        "enabled": True,
        "timeout_sec": 1800,
        "ui_size": "md",
        "ui_order": len(config.get("scripts", [])),
    }
    config.setdefault("scripts", []).append(script)
    saved = AutotestRunsStore.save_config(config)
    return {"script": script, "path": str(target), "build_tool": build_tool, "config": saved}


@router.post("/api/autotest-runs/create-scenario")
async def create_scenario(req: CreateScenarioRequest) -> dict:
    try:
        return await asyncio.to_thread(_create_scenario_sync, req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Не удалось создать скрипт сценария: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ошибка создания сценария: {exc}")


@router.post("/api/autotest-runs/run")
async def run_script(req: RunScriptRequest) -> dict:
    config = AutotestRunsStore.get_config()
    script = _find_script(config, req.script_id)
    try:
        return await asyncio.to_thread(
            _run_script_sync,
            config=config,
            script=script,
            tags=req.tags,
            test_types=req.test_types,
            tests=req.tests,
            microservice=req.microservice,
            build_version=req.build_version,
            trigger=req.trigger,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Скрипт превысил таймаут запуска")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ошибка запуска скрипта: {exc}")


@router.post("/api/autotest-runs/check-builds")
async def check_builds(req: CheckBuildsRequest) -> dict:
    try:
        return await asyncio.to_thread(_check_builds_sync, execute=req.execute)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Источник версий сборок недоступен: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ошибка проверки сборок: {exc}")


_autorun_task: Optional[asyncio.Task] = None


async def _autorun_loop() -> None:
    while True:
        config = AutotestRunsStore.get_config()
        autorun = config.get("autorun", {})
        interval = max(30, int(autorun.get("poll_interval_sec") or 120))
        if autorun.get("enabled"):
            try:
                await asyncio.to_thread(_check_builds_sync, execute=True)
            except Exception as exc:
                _add_history_safe({
                    "id": f"autorun-error-{int(time.time() * 1000)}",
                    "script_id": "",
                    "script_name": "Автозапуск",
                    "button_name": "",
                    "rule_id": "",
                    "rule_name": "",
                    "audit_type": "autorun",
                    "audit_name": "Ошибка автозапуска",
                    "trigger": "autorun",
                    "status": "error",
                    "exit_code": None,
                    "tags": [],
                    "test_types": [],
                    "microservice": "",
                    "build_version": "",
                    "started_at": _now_iso(),
                    "duration_ms": 0,
                    "stdout": "",
                    "stderr": str(exc),
                })
        await asyncio.sleep(interval)


async def start_autorun_monitor() -> None:
    global _autorun_task
    if _autorun_task is None or _autorun_task.done():
        _autorun_task = asyncio.create_task(_autorun_loop())


async def stop_autorun_monitor() -> None:
    global _autorun_task
    if _autorun_task and not _autorun_task.done():
        _autorun_task.cancel()
        try:
            await _autorun_task
        except asyncio.CancelledError:
            pass
    _autorun_task = None
