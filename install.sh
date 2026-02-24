#!/usr/bin/env bash
# SimpleTest — быстрая установка на новый компьютер
# Использование: bash install.sh

set -e

PYTHON=${PYTHON:-python3}
VENV_DIR=".venv"

echo "=== SimpleTest installer ==="
echo ""

# 1. Python
if ! command -v $PYTHON &>/dev/null; then
    echo "ERROR: Python 3 не найден. Установите Python 3.10+ и повторите."
    exit 1
fi
PY_VERSION=$($PYTHON --version 2>&1)
echo "Python: $PY_VERSION"

# 2. Virtual environment
if [ ! -d "$VENV_DIR" ]; then
    echo "Создаю виртуальное окружение..."
    $PYTHON -m venv $VENV_DIR
fi
source $VENV_DIR/bin/activate
echo "Venv: активирован"

# 3. Dependencies
echo "Устанавливаю зависимости..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "Зависимости: установлены"

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
        # Replace empty value in .env
        sed -i.bak "s|^GIGACHAT_AUTH_KEY=.*|GIGACHAT_AUTH_KEY=$gc_key|" .env && rm -f .env.bak
        echo "Ключ сохранён в .env"
    else
        echo "ВНИМАНИЕ: ключ не введён. Настройте .env вручную или через интерфейс приложения."
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
echo "  source $VENV_DIR/bin/activate"
echo "  streamlit run app.py"
echo ""
