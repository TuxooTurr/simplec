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

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from backend.api import (
    auth, generation, etalons, bugs, system, alerts,
    metrics_systems, metrics_settings, metrics_builder,
    revisor, autotests_gen,
)
from backend.auth import require_auth
from db.user_store import ensure_default_user
from db.postgres import init_db

# Создать пользователя по умолчанию если база пуста
ensure_default_user()

# Инициализировать таблицы PostgreSQL (идемпотентно)
try:
    init_db()
except Exception as _e:
    warnings.warn(f"PostgreSQL недоступен, Генератор метрик не будет работать: {_e}")


@asynccontextmanager
async def lifespan(app_: FastAPI):
    # Startup: запустить планировщик метрик
    try:
        from agents.metrics_scheduler import scheduler
        await scheduler.start_all()
    except Exception as _e:
        warnings.warn(f"Scheduler failed to start: {_e}")
    yield
    # Shutdown: остановить все задачи
    try:
        from agents.metrics_scheduler import scheduler
        await scheduler.stop_all()
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


app.add_middleware(SecurityHeadersMiddleware)

# CORS — разрешаем только свой домен + localhost для разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://simpletest.pro",
        "https://www.simpletest.pro",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
)

# ─── Открытые роутеры (без авторизации) ─────────────────────────────────────
app.include_router(auth.router)

# /healthz и /api/system/providers — публичные (для nginx health check и LLM статуса на login)
app.include_router(system.router)

# ─── Защищённые роутеры (require_auth) ──────────────────────────────────────
_auth_dep = [Depends(require_auth)]

app.include_router(generation.router,       dependencies=_auth_dep)
app.include_router(etalons.router,          dependencies=_auth_dep)
app.include_router(bugs.router,             dependencies=_auth_dep)
app.include_router(alerts.router,           dependencies=_auth_dep)
app.include_router(metrics_systems.router,  dependencies=_auth_dep)
app.include_router(metrics_settings.router, dependencies=_auth_dep)
app.include_router(metrics_builder.router,  dependencies=_auth_dep)
app.include_router(revisor.router,          dependencies=_auth_dep)
app.include_router(autotests_gen.router,    dependencies=_auth_dep)

# Раздача Next.js static build (если собран)
_FRONTEND_OUT = _ROOT / "frontend" / "out"
if _FRONTEND_OUT.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_OUT), html=True), name="static")
