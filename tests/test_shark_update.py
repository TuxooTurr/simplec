from __future__ import annotations

from contextlib import closing
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _checkout(path: Path) -> None:
    (path / "frontend").mkdir(parents=True)
    (path / "frontend/package-lock.json").write_text("{}")
    (path / "start.sh").touch()


@pytest.mark.skipif(not shutil.which("rsync"), reason="Локальное обновление использует rsync")
def test_release_overlay_preserves_existing_runtime_and_provider_database(tmp_path):
    source, target = tmp_path / "release", tmp_path / "installed"
    _checkout(source)
    _checkout(target)

    def write(root: Path, name: str, value: str) -> None:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    write(target, ".env", "SHARK_ENV_FILE=local-config/runtime.conf\n")
    write(target, "local-config/runtime.conf",
          "DATABASE_URL=sqlite:///settings/provider.store\nSHARK_DATA_DIR=team-assets\n")
    protected = [
        "settings/provider.store", "settings/provider.store-wal", "team-assets/requirements.json",
        "data/dashboard.json", "frontend/.env.local", "simpletest.db", "certs/local.pem",
        ".work/shark-runtime/shark.log", "frontend/node_modules/next/package.json",
    ]
    for name in protected:
        write(source, name, "incoming")
        if name not in protected[:2]:
            write(target, name, "corporate")
    (target / "settings").mkdir()
    with closing(sqlite3.connect(target / protected[0])) as db, db:
        db.execute("CREATE TABLE metrics_settings (key TEXT, value TEXT)")
        db.execute("INSERT INTO metrics_settings VALUES (?, ?)", ("custom_llm_providers", "corporate"))
    write(target, protected[1], "corporate")
    write(source, ".env", "DATABASE_URL=sqlite:///overwritten.db\n")
    write(source, "local-config/runtime.conf", "incoming")
    write(source, ".env.example", "template")
    write(source, "frontend/.env.local.example", "template")
    write(source, "vendor/plantuml/engine.mjs", "bundled")
    write(source, "start.sh", "updated")
    write(target, "local-only.txt", "present")

    command = [sys.executable, str(ROOT / "scripts/update_shark.py"), str(source), str(target)]
    env = {name: value for name, value in os.environ.items() if name not in {"SHARK_ENV_FILE", "DATABASE_URL", "SHARK_DATA_DIR"}}
    subprocess.run(command, check=True, env=env, capture_output=True)
    assert not (target / "vendor").exists()
    subprocess.run([*command, "--apply"], check=True, env=env, capture_output=True)
    for name in protected[1:]:
        assert (target / name).read_text() == "corporate"
    # The synthetic WAL is intentionally not a SQLite WAL; read the primary file separately.
    (target / protected[1]).unlink()
    with sqlite3.connect(target / protected[0]) as db:
        assert db.execute("SELECT value FROM metrics_settings").fetchone() == ("corporate",)
    assert (target / ".env").read_text() == "SHARK_ENV_FILE=local-config/runtime.conf\n"
    assert (target / "local-config/runtime.conf").read_text().startswith("DATABASE_URL=sqlite:///settings/provider.store\n")
    assert (target / ".env.example").read_text() == (target / "frontend/.env.local.example").read_text() == "template"
    assert (target / "vendor/plantuml/engine.mjs").read_text() == "bundled"
    assert (target / "start.sh").read_text() == "updated"
    assert (target / "local-only.txt").read_text() == "present"


@pytest.mark.skipif(os.name != "posix", reason="Фоновый режим рассчитан на macOS/Linux")
def test_detached_restart_survives_the_cli_and_stops_only_its_session(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(ROOT / "scripts/shark_runtime.py", scripts / "shark_runtime.py")
    (tmp_path / "start.sh").write_text(
        'trap \'printf "stop\\n" >> lifecycle; exit 0\' TERM\n'
        'printf "start\\n" >> lifecycle\n'
        ': > "$SHARK_READY_FILE"\n'
        'while :; do sleep 0.2; done\n'
    )
    command = [sys.executable, str(scripts / "shark_runtime.py")]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=10)
        assert "готов" in subprocess.check_output([*command, "status"], text=True)
        subprocess.run([*command, "restart"], check=True, capture_output=True, timeout=10)
        assert (tmp_path / "lifecycle").read_text() == "start\nstop\nstart\n"
    finally:
        subprocess.run([*command, "stop"], check=True, capture_output=True, timeout=35)
    assert (tmp_path / "lifecycle").read_text() == "start\nstop\nstart\nstop\n"
