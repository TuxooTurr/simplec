"""
FastAPI точка входа.

Запуск (dev):
    uvicorn backend.main:app --reload --port 8000

Запуск (prod):
    uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
"""

import sys
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

# Добавляем корень проекта (SimpleC/) в sys.path, чтобы импортировать agents/ и db/
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

# ── Корпоративные SSL-сертификаты (Sber BIG IP proxy) ────────────────────────
import os as _os
_CERTS_BUNDLE = _ROOT / "certs" / "ca-bundle.pem"
if _CERTS_BUNDLE.exists():
    _CERTS_PATH = str(_CERTS_BUNDLE)
    _os.environ.setdefault("SSL_CERT_FILE",      _CERTS_PATH)
    _os.environ.setdefault("REQUESTS_CA_BUNDLE", _CERTS_PATH)
    _os.environ.setdefault("CURL_CA_BUNDLE",     _CERTS_PATH)
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from backend.api import (
    auth, generation, etalons, bugs, system, alerts, kernel,
    metrics_systems, metrics_settings, metrics_builder,
    revisor, autotests_gen, autotest_runs, app_settings,
    testdata, jobs, logs,
    device_farm, device_farm_ws,
)
from db.postgres import init_db

# Инициализировать таблицы PostgreSQL (идемпотентно)
try:
    init_db()
except Exception as _e:
    warnings.warn(f"PostgreSQL недоступен, Генератор метрик не будет работать: {_e}")


@asynccontextmanager
async def lifespan(app_: FastAPI):
    # Startup: применить настройки из БД к os.environ
    try:
        from db.postgres import SessionLocal
        _db = SessionLocal()
        app_settings.apply_saved_settings_to_env(_db)
        _db.close()
    except Exception as _e:
        warnings.warn(f"Settings load failed: {_e}")
    # Startup: запустить планировщик метрик
    try:
        from agents.metrics_scheduler import scheduler
        await scheduler.start_all()
    except Exception as _e:
        warnings.warn(f"Scheduler failed to start: {_e}")
    # Startup: запустить монитор автозапуска автотестов
    try:
        await autotest_runs.start_autorun_monitor()
    except Exception as _e:
        warnings.warn(f"Autotest autorun monitor failed to start: {_e}")
    # Startup: запустить менеджер фермы устройств
    try:
        from backend.farm.manager import farm_manager
        await farm_manager.start()
    except Exception as _e:
        warnings.warn(f"Farm manager failed to start: {_e}")
    yield
    # Shutdown: остановить все задачи
    try:
        from agents.metrics_scheduler import scheduler
        await scheduler.stop_all()
    except Exception:
        pass
    try:
        await autotest_runs.stop_autorun_monitor()
    except Exception:
        pass
    try:
        from backend.farm.manager import farm_manager
        await farm_manager.stop()
    except Exception:
        pass


app = FastAPI(
    title="SimpleTest API",
    description="AI-генератор тест-кейсов для Jira Zephyr Scale",
    version="3.1.0",
    lifespan=lifespan,
    # Отключаем автогенерацию документации на проде (опционально)
    # docs_url=None, redoc_url=None,
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Добавляет стандартные security-заголовки ко всем ответам."""
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response


class AuthMiddleware(BaseHTTPMiddleware):
    """Проверяет Bearer-токен на всех /api/ путях, кроме публичных."""

    _PUBLIC = frozenset({"/api/auth/login", "/api/auth/me", "/healthz"})

    async def dispatch(self, request: StarletteRequest, call_next):
        path = request.url.path
        if path in self._PUBLIC or not path.startswith("/api/") or path.startswith("/api/farm/agents/"):
            return await call_next(request)
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)
        from backend.api.auth import get_current_user
        user = get_current_user(request)
        if not user:
            from starlette.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Не авторизован"})
        request.state.user = user
        return await call_next(request)


app.add_middleware(AuthMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# CORS — разрешаем только свой домен + localhost для разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://simpletest.pro",
        "https://www.simpletest.pro",
        "http://localhost:3000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# ─── Роутеры приложения ──────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(system.router)
app.include_router(generation.router)
app.include_router(etalons.router)
app.include_router(bugs.router)
app.include_router(alerts.router)
app.include_router(kernel.router)
app.include_router(metrics_systems.router)
app.include_router(metrics_settings.router)
app.include_router(metrics_builder.router)
app.include_router(revisor.router)
app.include_router(autotests_gen.router)
app.include_router(autotest_runs.router)
app.include_router(app_settings.router)
app.include_router(testdata.router)
app.include_router(jobs.router)
app.include_router(logs.router)
app.include_router(device_farm.router)
app.include_router(device_farm_ws.router)

# Раздача Next.js static build (если собран)
_FRONTEND_OUT = _ROOT / "frontend" / "out"
if _FRONTEND_OUT.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_OUT), html=True), name="static")
