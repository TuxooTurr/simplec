#!/usr/bin/env python3
"""Copy a Shark release over an existing local installation, preserving its state."""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote

from dotenv import load_dotenv
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

_EXCLUDES = (
    ".git", ".env", ".env.*", "*.env", "*.env.local", ".venv", "node_modules", ".next", "__pycache__",
    ".deps-installed", "*.tsbuildinfo", ".work", "/data", "/data_mock", "/out", "/db/chroma_db",
    "/db/chroma_data", "/db/logs", "*.db*", "*.sqlite*", "*.log", "*.pem", "*.key", "*.p12", "*.pfx", ".cert_key",
)
_PATH_SETTINGS = (
    "SHARK_DATA_DIR", "SIMPLETEST_SECRET_KEY_FILE", "OPENSEARCH_CA_CERT_PATH", "OPENSEARCH_CLIENT_CERT_PATH",
    "OPENSEARCH_CLIENT_KEY_PATH", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "GIGACODE_TOKEN_FILE", "ETHER_BROWSER_PROFILE",
)


def _local_path(root: Path, value: str) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    path = path if path.is_absolute() else root / path
    # Keep the configured directory entry even if it is a symlink to an external store.
    return path.absolute()


def _protected_paths(root: Path) -> set[Path]:
    load_dotenv(root / ".env")
    settings = _local_path(root, os.getenv("SHARK_ENV_FILE", "").strip())
    if settings:
        if not settings.is_file():
            raise ValueError("Файл SHARK_ENV_FILE не найден.")
        load_dotenv(settings, override=True)
    protected = {p for key in _PATH_SETTINGS if (p := _local_path(root, os.getenv(key, "")))}
    if settings:
        protected.add(settings)
    database_url = os.getenv("DATABASE_URL", "")
    if database_url and database_url.startswith("sqlite"):
        try:
            database = make_url(database_url).database
        except ArgumentError:
            raise ValueError("Не удалось определить путь к рабочей базе SQLite.") from None
        if database and database not in (":memory:", "file::memory:"):
            database_path = unquote(database[5:]) if database.startswith("file:") else database
            path = _local_path(root, database_path)
            if path is not None:
                protected.update({path, *(Path(str(path) + suffix) for suffix in ("-wal", "-shm", "-journal"))})
    return protected


def _rsync_pattern(path: Path) -> str:
    name = path.as_posix()
    if any(char in name for char in "*?[\\"):
        name = "".join("\\" + char if char in "*?[\\" else char for char in name)
    return "/" + name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Распакованная новая версия Shark")
    parser.add_argument("destination", type=Path, help="Рабочая установка Shark")
    parser.add_argument("--apply", action="store_true", help="Применить обновление. Без флага показывается план.")
    args = parser.parse_args()
    source, destination = args.source.resolve(), args.destination.resolve()
    if source == destination or source.is_relative_to(destination) or destination.is_relative_to(source):
        parser.error("Укажите два отдельных, невложенных каталога.")
    for root in (source, destination):
        if not (root / "start.sh").is_file() or not (root / "frontend/package-lock.json").is_file():
            parser.error("Оба каталога должны содержать проект Shark.")
    if not shutil.which("rsync"):
        parser.error("В окружении отсутствует rsync.")

    # Relative paths in the running application are resolved from the installation root.
    os.chdir(destination)
    try:
        protected = _protected_paths(destination)
    except ValueError as exc:
        parser.error(str(exc))
    exclusions = set(_EXCLUDES)
    for path in protected:
        for candidate in (path, path.resolve()):
            if candidate == destination:
                parser.error("Каталог рабочих данных совпадает с корнем установки.")
            if candidate.is_relative_to(destination):
                exclusions.add(_rsync_pattern(candidate.relative_to(destination)))
    command = ["rsync", "-rltp", "--safe-links", "--checksum", "--itemize-changes"]
    if not args.apply:
        command.append("--dry-run")
    command += ["--exclude=" + item for item in sorted(exclusions - set(_EXCLUDES))]
    command += ["--include=.env.example", "--include=.env.local.example"]
    command += ["--exclude=" + item for item in _EXCLUDES]
    return subprocess.run([*command, "--", str(source) + "/", str(destination) + "/"]).returncode


if __name__ == "__main__":
    raise SystemExit(main())
