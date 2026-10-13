#!/usr/bin/env bash
# SimpleTest — быстрая установка на новый компьютер
# Использование: bash install.sh
#
# Поддерживает: venv (macOS/Linux) и Conda (активируй env перед запуском)

set -e

echo "=== SimpleTest installer ==="
echo ""

# 1. Python — определяем исполняемый файл
if [ -n "${CONDA_DEFAULT_ENV:-}" ] || [ -n "${CONDA_PREFIX:-}" ]; then
    PYTHON="python"
    echo "Режим: Conda окружение (${CONDA_DEFAULT_ENV:-$(basename ${CONDA_PREFIX})})"
else
    PYTHON=${PYTHON:-python3}
    echo "Режим: venv"
fi

if ! command -v $PYTHON &>/dev/null; then
    echo "ERROR: Python не найден. Установите Python 3.10+ или активируйте Conda-окружение."
    exit 1
fi

PY_VER=$($PYTHON -c "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}')")
PY_MAJOR=${PY_VER%%.*}; PY_MINOR=${PY_VER##*.}
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
    echo "ERROR: Нужен Python 3.10+, найден $($PYTHON --version). Обновите Python или Conda-окружение."
    exit 1
fi
echo "Python: $($PYTHON --version)"

# 2. Virtual environment (только если не Conda)
VENV_DIR=".venv"
if [ -n "${CONDA_DEFAULT_ENV:-}" ] || [ -n "${CONDA_PREFIX:-}" ]; then
    echo "Venv: пропускаю (используется Conda)"
else
    if [ ! -d "$VENV_DIR" ]; then
        echo "Создаю виртуальное окружение..."
        $PYTHON -m venv $VENV_DIR
    fi
    source $VENV_DIR/bin/activate
    echo "Venv: активирован"
fi

# 3. Dependencies
echo "Устанавливаю зависимости Python (около 150 МБ, 3–10 минут; прогресс ниже)..."
pip install --quiet --upgrade pip
# --prefer-binary — только готовые сборки, без компиляции из исходников.
pip install --prefer-binary --progress-bar on -r requirements.txt
# Та же отметка, что проверяет start.sh: при следующем запуске повторно ставить не будет.
python - > .deps-installed <<'PY'
import hashlib, sys
print(sys.prefix + "|" + hashlib.sha256(open("requirements.txt", "rb").read()).hexdigest())
PY
echo "Зависимости Python: установлены"

# 3a. Зависимости фронтенда — здесь же, чтобы первый start.sh не ставил их сам.
if command -v npm &>/dev/null; then
    echo "Устанавливаю зависимости фронтенда (около 370 МБ, 1–5 минут)..."
    npm ci --prefix frontend --no-audit --no-fund --loglevel=error
    shasum -a 256 frontend/package-lock.json | cut -d' ' -f1 > frontend/.deps-installed
    echo "Зависимости фронтенда: установлены"
else
    echo "ВНИМАНИЕ: npm не найден — зависимости фронтенда поставит start.sh после установки Node.js 20."
fi

# 3b. Модель для поиска похожих эталонов (~80 МБ). Без этого шага она скачается при первой
# генерации, и та будет долго «висеть». Сеть закрыта — не страшно: скачается позже сама.
echo "Скачиваю модель для поиска по эталонам (около 80 МБ)..."
python - <<'PY' || echo "ВНИМАНИЕ: модель не скачалась (сеть?) — скачается при первом использовании «Данных»."
from chromadb.utils import embedding_functions
embedding_functions.DefaultEmbeddingFunction()(["проверка"])
print("Модель поиска: готова")
PY

# 4. .env setup
if [ ! -f ".env" ]; then
    echo ""
    echo "Файл .env не найден. Создаю из шаблона..."
    cp .env.example .env
    chmod 600 .env
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  Введите GIGACHAT_AUTH_KEY (Base64 строка из СберID) ║"
    echo "╚══════════════════════════════════════════════════════╝"
    read -s -p "GIGACHAT_AUTH_KEY: " gc_key
    echo ""
    if [ -n "$gc_key" ]; then
        sed -i.bak "s|^GIGACHAT_AUTH_KEY=.*|GIGACHAT_AUTH_KEY=$gc_key|" .env && rm -f .env.bak
        echo "Ключ сохранён в .env"
    else
        echo "ВНИМАНИЕ: ключ не введён. Настройте .env вручную."
    fi
else
    echo ".env: уже существует, пропускаю"
fi

# 5. Data dirs
mkdir -p out db/chroma_db data
echo "Директории: созданы"

echo ""
echo "=== Готово! ==="
echo ""
echo "Запуск:"
if [ -n "${CONDA_DEFAULT_ENV:-}" ] || [ -n "${CONDA_PREFIX:-}" ]; then
    echo "  bash start.sh"
else
    echo "  bash start.sh"
    echo "  # или вручную:"
    echo "  source $VENV_DIR/bin/activate"
    echo "  python -m uvicorn backend.main:app --port 8000"
fi
echo ""
