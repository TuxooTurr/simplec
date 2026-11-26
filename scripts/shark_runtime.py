#!/usr/bin/env python3
"""Manage a detached Shark session started by this checkout."""
from __future__ import annotations

import argparse
import fcntl
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".work" / "shark-runtime"
READY = RUNTIME / "ready"
STOP = RUNTIME / "stop"
LOG = RUNTIME / "shark.log"


def _lock(name: str, *, blocking: bool = True):
    lock = (RUNTIME / name).open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
    except BlockingIOError:
        lock.close()
        return None
    return lock


def _running() -> bool:
    lease = _lock("session.lock", blocking=False)
    if lease is None:
        return True
    lease.close()
    return False


def _stop() -> bool:
    if not _running():
        return True
    STOP.touch()
    for _ in range(120):
        time.sleep(0.25)
        if not _running():
            return True
    print(f"Службы ещё завершаются. Журнал: {LOG}", file=sys.stderr)
    return False


def _finish_child(child: subprocess.Popen) -> None:
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        child.poll()
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.2)
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def _supervise(lease_fd: int, bridge: bool) -> int:
    # The inherited lock is held only while the supervisor is alive.
    with os.fdopen(lease_fd, "a"):
        options = ["--no-browser", "--fresh-next-cache"]
        if bridge:
            options.append("--with-gigacode")
        env = dict(os.environ, SHARK_READY_FILE=str(READY))
        child = subprocess.Popen(["bash", "start.sh", *options], cwd=ROOT, env=env, start_new_session=True)
        try:
            while child.poll() is None:
                if STOP.exists():
                    return 0
                time.sleep(0.2)
            return child.returncode
        finally:
            _finish_child(child)
            READY.unlink(missing_ok=True)


def _start(bridge: bool) -> int:
    READY.unlink(missing_ok=True)
    STOP.unlink(missing_ok=True)
    LOG.touch(mode=0o600)
    lease = _lock("session.lock", blocking=False)
    if lease is None:
        return 1
    options = ["--with-gigacode"] if bridge else []
    with lease, LOG.open("ab") as log:
        process = subprocess.Popen(
            [sys.executable, __file__, "--supervise", str(lease.fileno()), *options],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True, pass_fds=(lease.fileno(),),
        )
    print(f"Запускаю Shark. Журнал: {LOG}", flush=True)
    for _ in range(2400):
        if process.poll() is not None:
            print(f"Запуск завершился с ошибкой. Журнал: {LOG}", file=sys.stderr)
            return 1
        if READY.exists():
            print("Shark готов: http://localhost:3000")
            return 0
        time.sleep(0.5)
    print(f"Запуск ещё идёт. Проверьте состояние командой status. Журнал: {LOG}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", choices=("restart", "stop", "status"), default="restart")
    parser.add_argument("--with-gigacode", action="store_true")
    parser.add_argument("--supervise", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.supervise is not None:
        return _supervise(args.supervise, args.with_gigacode)
    with _lock("control.lock"):
        if args.action == "status":
            running = _running()
            status = "готов" if running and READY.exists() else "запускается" if running else "остановлен"
            print(f"Shark {status}. Журнал: {LOG}")
            return 0 if running else 1
        if not _stop():
            return 1
        if args.action == "stop":
            print("Сессия Shark остановлена.")
            return 0
        return _start(args.with_gigacode)


if __name__ == "__main__":
    raise SystemExit(main())
