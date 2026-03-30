@echo off
chcp 65001 >nul
title SimpleTest — Запуск

echo.
echo  ╔══════════════════════════════════════╗
echo  ║        SimpleTest — Запуск           ║
echo  ╚══════════════════════════════════════╝
echo.

:: ── Проверка Python 3.12 ─────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не найден. Установите Python 3.12: https://python.org
    pause
    exit /b 1
)

for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [✓] Python %PYVER%

:: ── Проверка Node.js ─────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден. Установите Node.js 20+: https://nodejs.org
    pause
    exit /b 1
)
for /f %%v in ('node --version') do echo [✓] Node.js %%v

:: ── Виртуальное окружение ────────────────────────────────────
if not exist ".venv\Scripts\activate.bat" (
    echo.
    echo [→] Создаю виртуальное окружение...
    python -m venv .venv
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось создать venv
        pause
        exit /b 1
    )
    echo [✓] Виртуальное окружение создано
)

:: ── Зависимости Python ───────────────────────────────────────
if not exist ".venv\Lib\site-packages\fastapi" (
    echo.
    echo [→] Устанавливаю зависимости Python (может занять несколько минут)...
    call .venv\Scripts\activate.bat
    pip install -q -r requirements.txt
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось установить зависимости
        pause
        exit /b 1
    )
    echo [✓] Зависимости установлены
) else (
    call .venv\Scripts\activate.bat
)

:: ── Зависимости Node.js ──────────────────────────────────────
if not exist "frontend\node_modules" (
    echo.
    echo [→] Устанавливаю зависимости Node.js...
    cd frontend
    npm install --silent
    cd ..
    echo [✓] Node.js зависимости установлены
)

:: ── Настройка .env ───────────────────────────────────────────
if not exist ".env" (
    echo.
    echo [→] Создаю .env из шаблона...
    copy .env.example .env >nul
    echo.
    echo  ╔══════════════════════════════════════════════════════╗
    echo  ║  Файл .env создан. Откройте его и заполните:         ║
    echo  ║    APP_SECRET  — любая случайная строка              ║
    echo  ║    ADMIN_PASS  — пароль администратора (мин. 12 симв)║
    echo  ║    DEEPSEEK_API_KEY — ключ DeepSeek (или другой LLM) ║
    echo  ╚══════════════════════════════════════════════════════╝
    echo.
    echo Нажмите любую клавишу после заполнения .env...
    notepad .env
    pause >nul
)

:: ── Запуск бэкенда ───────────────────────────────────────────
echo.
echo [→] Запускаю бэкенд (порт 8000)...
start "SimpleTest Backend" cmd /k "title SimpleTest Backend && call .venv\Scripts\activate.bat && python -m uvicorn backend.main:app --port 8000"

:: Ждём пока бэкенд стартует
timeout /t 4 /nobreak >nul

:: ── Запуск фронтенда ─────────────────────────────────────────
echo [→] Запускаю фронтенд (порт 3000)...
start "SimpleTest Frontend" cmd /k "title SimpleTest Frontend && cd frontend && npm run dev"

:: Ждём и открываем браузер
timeout /t 6 /nobreak >nul
echo.
echo [✓] Открываю браузер...
start http://localhost:3000

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║  SimpleTest запущен!                                 ║
echo  ║  Фронтенд:  http://localhost:3000                    ║
echo  ║  API:       http://localhost:8000                    ║
echo  ║                                                      ║
echo  ║  Закройте окна "Backend" и "Frontend" для остановки  ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
pause
