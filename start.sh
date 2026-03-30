#!/usr/bin/env bash
# SimpleTest — запуск локально (macOS / Linux)
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓] $1${NC}"; }
info() { echo -e "${BLUE}[→] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }
err()  { echo -e "${RED}[✗] $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        SimpleTest — Запуск           ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Проверка Python 3.12 ──────────────────────────────────────
PYTHON=""
for cmd in python3.12 python3 python; do
    if command -v "$cmd" &>/dev/null; then
        VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
        MAJOR=${VER%%.*}; MINOR=${VER##*.}
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 12 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done
[ -z "$PYTHON" ] && err "Python 3.12+ не найден. Установите: https://python.org"
ok "Python $($PYTHON --version)"

# ── Проверка Node.js ──────────────────────────────────────────
command -v node &>/dev/null || err "Node.js не найден. Установите: https://nodejs.org"
ok "Node.js $(node --version)"

# ── Виртуальное окружение ─────────────────────────────────────
if [ ! -f ".venv/bin/activate" ]; then
    info "Создаю виртуальное окружение..."
    "$PYTHON" -m venv .venv
    ok "Виртуальное окружение создано"
fi
source .venv/bin/activate

# ── Зависимости Python ────────────────────────────────────────
if ! python -c "import fastapi" &>/dev/null 2>&1; then
    info "Устанавливаю зависимости Python (может занять несколько минут)..."
    pip install -q -r requirements.txt
    ok "Зависимости Python установлены"
fi

# ── Зависимости Node.js ───────────────────────────────────────
if [ ! -d "frontend/node_modules" ]; then
    info "Устанавливаю зависимости Node.js..."
    npm install --prefix frontend --silent
    ok "Node.js зависимости установлены"
fi

# ── Настройка .env ────────────────────────────────────────────
if [ ! -f ".env" ]; then
    info "Создаю .env из шаблона..."
    cp .env.example .env
    echo ""
    warn "Файл .env создан. Заполните обязательные поля:"
    echo "   APP_SECRET  — любая случайная строка"
    echo "   ADMIN_PASS  — пароль администратора (мин. 12 символов)"
    echo "   DEEPSEEK_API_KEY — ключ DeepSeek (или другой LLM)"
    echo ""
    echo "Отредактируйте .env и нажмите Enter для продолжения..."
    ${EDITOR:-nano} .env
    read -r
fi

# ── Запуск бэкенда ────────────────────────────────────────────
info "Запускаю бэкенд (порт 8000)..."
python -m uvicorn backend.main:app --port 8000 &
BACKEND_PID=$!

# Ждём пока бэкенд стартует
for i in {1..15}; do
    sleep 1
    if curl -sf http://localhost:8000/healthz &>/dev/null; then
        ok "Бэкенд запущен (PID $BACKEND_PID)"
        break
    fi
    if [ $i -eq 15 ]; then
        err "Бэкенд не стартовал за 15 секунд. Проверьте логи."
    fi
done

# ── Запуск фронтенда ──────────────────────────────────────────
info "Запускаю фронтенд (порт 3000)..."
npm run dev --prefix frontend &
FRONTEND_PID=$!

sleep 4

# ── Открыть браузер ───────────────────────────────────────────
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:3000 &>/dev/null &
elif command -v open &>/dev/null; then
    open http://localhost:3000
fi

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║  SimpleTest запущен!                                 ║"
echo "  ║  Фронтенд:  http://localhost:3000                    ║"
echo "  ║  API:       http://localhost:8000                    ║"
echo "  ║                                                      ║"
echo "  ║  Нажмите Ctrl+C для остановки                        ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""

# Ждём Ctrl+C и останавливаем оба процесса
trap "echo ''; info 'Останавливаю...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; ok 'Остановлено'; exit 0" INT TERM
wait
