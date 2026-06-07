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


class SaveConfigRequest(BaseModel):
    config: AutotestRunConfig


class RunScriptRequest(BaseModel):
    script_id: str
    tags: list[str] = Field(default_factory=list)
    test_types: list[str] = Field(default_factory=list)
    microservice: str = ""
    build_version: str = ""
    trigger: Literal["manual", "autorun"] = "manual"


class CheckBuildsRequest(BaseModel):
    execute: bool = True


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


def _run_script_sync(
    *,
    config: dict,
    script: dict,
    tags: list[str],
    test_types: list[str],
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
    timeout = max(10, min(int(script.get("timeout_sec") or 1200), 24 * 60 * 60))

    env = os.environ.copy()
    env.update({
        "AUTOTEST_FRAMEWORK_PATH": framework_path,
        "AUTOTEST_TAGS": ",".join(selected_tags),
        "AUTOTEST_SERVICE_TAG": microservice,
        "AUTOTEST_TYPES": ",".join(selected_types),
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
