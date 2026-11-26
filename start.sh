#!/usr/bin/env bash
# Shark — запуск локально (macOS / Linux)
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓] $1${NC}"; }
info() { echo -e "${BLUE}[→] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }
err()  { echo -e "${RED}[✗] $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WITH_GIGACODE=false
OPEN_BROWSER=true
FRESH_NEXT=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-gigacode) WITH_GIGACODE=true ;;
        --no-browser) OPEN_BROWSER=false ;;
        --fresh-next-cache) FRESH_NEXT=true ;;
        *) err "Использование: bash start.sh [--with-gigacode] [--no-browser] [--fresh-next-cache]" ;;
    esac
    shift
done

wait_http() {
    "$PYTHON" - "$@" <<'PYWAIT'
import os
import sys
import time
from urllib.request import ProxyHandler, build_opener

pid, url, seconds = sys.argv[1:]
opener = build_opener(ProxyHandler({}))
deadline = time.monotonic() + int(seconds)
while time.monotonic() < deadline:
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        break
    try:
        with opener.open(url, timeout=2) as response:
            if response.status == 200:
                sys.exit(0)
    except OSError:
        pass
    time.sleep(0.5)
sys.exit(1)
PYWAIT
}

check_ports() {
    "$PYTHON" - "$@" <<'PYPORTS'
import socket
import sys

for port in map(int, sys.argv[1:]):
    try:
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))
            listener.listen()
    except OSError:
        raise SystemExit(f"Порт {port} занят. Остановите прежнюю службу Shark и повторите запуск.")
PYPORTS
}

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        Shark — Запуск           ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Проверка Python 3.10+ ─────────────────────────────────────
if [[ -n "${CONDA_PREFIX:-}" ]]; then
    PYTHON="$CONDA_PREFIX/bin/python"
elif [[ -x ".venv/bin/python" ]]; then
    PYTHON="$SCRIPT_DIR/.venv/bin/python"
    source .venv/bin/activate
else
    PYTHON=""
    for cmd in python3.12 python3.11 python3.10 python3; do
        if command -v "$cmd" &>/dev/null && "$cmd" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
            PYTHON="$cmd"
            break
        fi
    done
    [[ -n "$PYTHON" ]] || err "Python 3.10+ не найден. Активируйте окружение Shark."
    "$PYTHON" -m venv .venv
    source .venv/bin/activate
    PYTHON="$SCRIPT_DIR/.venv/bin/python"
fi
[[ -x "$PYTHON" ]] && "$PYTHON" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'     || err "В выбранном окружении нужен Python 3.10+."
ok "Python $("$PYTHON" --version)"

command -v node &>/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'     || err "Нужен Node.js 20+."
ok "Node.js $(node --version)"
check_ports 8000 3000

# ── Зависимости Python ────────────────────────────────────────
# Ставим не только в пустое окружение, но и когда изменился requirements.txt:
# раньше проверялся один fastapi, и новые пакеты (playwright, mcp, cryptography)
# после обновления кода не доезжали — веб-коннектор падал с «No module named 'playwright'».
# Отметка = окружение + хэш requirements.txt; другое окружение или новый файл → pip install.
DEPS_STAMP="$("$PYTHON" - <<'PY'
import hashlib, sys
print(sys.prefix + "|" + hashlib.sha256(open("requirements.txt", "rb").read()).hexdigest())
PY
)"
if ! "$PYTHON" -c "import fastapi" &>/dev/null || [ "$(cat .deps-installed 2>/dev/null)" != "$DEPS_STAMP" ]; then
    info "Устанавливаю/обновляю зависимости Python. Первый раз — 3–10 минут (около 150 МБ), дальше — секунды."
    # Прогресс видно: раньше установка шла молча (-q) и выглядела зависшей.
    # --prefer-binary — только готовые сборки, без долгой компиляции из исходников.
    "$PYTHON" -m pip install --prefer-binary --progress-bar on -r requirements.txt \
        || err "pip install не прошёл. В корпоративной сети проверьте прокси/зеркало PyPI и повторите: pip install -r requirements.txt"
    echo "$DEPS_STAMP" > .deps-installed
    ok "Зависимости Python установлены"
fi

# ── Зависимости Node.js ───────────────────────────────────────
# Отметка = хэш package-lock.json: изменился (обновили проект) — доставляем, иначе не трогаем.
# npm ci — точно по lock-файлу и быстрее npm install; --no-audit/--no-fund убирают лишние
# запросы в интернет, которые в корпоративной сети висят до таймаута.
NODE_STAMP="$("$PYTHON" -c 'import hashlib; from pathlib import Path; print(hashlib.sha256(Path("frontend/package-lock.json").read_bytes()).hexdigest())')"
if [ ! -f "frontend/node_modules/next/dist/server/lib/start-server.js" ] || [ "$(cat frontend/.deps-installed 2>/dev/null)" != "$NODE_STAMP" ]; then
    info "Устанавливаю зависимости Node.js. Первый раз — 1–5 минут (около 370 МБ), дальше — секунды."
    npm ci --prefix frontend --no-audit --no-fund --loglevel=error \
        || err "npm ci не прошёл. В корпоративной сети проверьте прокси/зеркало npm и повторите: npm ci --prefix frontend"
    echo "$NODE_STAMP" > frontend/.deps-installed
    ok "Node.js зависимости установлены"
fi

# ── frontend/.env.local (WebSocket URL) ──────────────────────
if [ ! -f "frontend/.env.local" ]; then
    info "Создаю frontend/.env.local..."
    cp frontend/.env.local.example frontend/.env.local
    ok "frontend/.env.local создан"
fi

BACKEND_PID=""
FRONTEND_PID=""
BRIDGE_PID=""
stop_children() {
    local pid
    for pid in "$FRONTEND_PID" "$BACKEND_PID" "$BRIDGE_PID"; do
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
        fi
    done
}
trap stop_children EXIT
trap 'exit 0' INT TERM

if "$WITH_GIGACODE"; then
    SHARK_ENV_FILE="$("$PYTHON" - <<'PYENV'
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(".env")
settings = os.getenv("SHARK_ENV_FILE", "").strip()
print(Path(settings).expanduser() if settings else "")
PYENV
)"
    export SHARK_ENV_FILE
    BRIDGE_PORT="$("$PYTHON" - <<'PYBRIDGE'
import os
from pathlib import Path
from dotenv import load_dotenv

settings = os.getenv("SHARK_ENV_FILE")
if settings:
    load_dotenv(Path(settings).expanduser(), override=True)
print(int(os.getenv("GIGACODE_BRIDGE_PORT", "8001")))
PYBRIDGE
)"
    check_ports "$BRIDGE_PORT"
fi

if "$FRESH_NEXT"; then
    "$PYTHON" - <<'PYCACHE'
import shutil
from pathlib import Path

cache = Path("frontend/.next/dev")
if not cache.parent.is_symlink():
    if cache.is_symlink():
        cache.unlink()
    elif cache.is_dir():
        shutil.rmtree(cache)
PYCACHE
fi

if "$WITH_GIGACODE"; then
    info "Запускаю локальный мост GigaCode…"
    GIGACODE_BRIDGE_PY="${GIGACODE_BRIDGE_PY:-$PYTHON}" bash scripts/start-gigacode-bridge.sh &
    BRIDGE_PID=$!
    wait_http "$BRIDGE_PID" "http://127.0.0.1:$BRIDGE_PORT/health" 30 || err "Мост не ответил на /health."
fi

info "Запускаю бэкенд (порт 8000)..."
"$PYTHON" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
wait_http "$BACKEND_PID" http://127.0.0.1:8000/healthz 60 || err "Бэкенд не ответил на /healthz."

info "Запускаю фронтенд (порт 3000)..."
npm run dev --prefix frontend -- --hostname 127.0.0.1 --port 3000 &
FRONTEND_PID=$!
wait_http "$FRONTEND_PID" http://127.0.0.1:3000/ 120 || err "Фронтенд не ответил на HTTP-проверку."

ok "Shark запущен: http://localhost:3000"
if [[ -n "${SHARK_READY_FILE:-}" ]]; then
    : > "$SHARK_READY_FILE"
fi
if "$OPEN_BROWSER"; then
    if command -v xdg-open &>/dev/null; then
        xdg-open http://localhost:3000 &>/dev/null &
    elif command -v open &>/dev/null; then
        open http://localhost:3000 &>/dev/null &
    fi
fi

while kill -0 "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null; do
    if [[ -n "$BRIDGE_PID" ]] && ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
        err "Мост GigaCode остановился."
    fi
    sleep 1
done
err "Бэкенд или фронтенд остановился."
