"""
FastAPI точка входа.

Запуск (dev):
    uvicorn backend.main:app --reload --port 8000

Запуск (prod):
    uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 2
"""

import sys
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

from backend.api import auth, generation, etalons, bugs, system
from backend.auth import require_auth
from db.user_store import ensure_default_user

# Создать пользователя по умолчанию если база пуста
ensure_default_user()

app = FastAPI(
    title="SimpleTest API",
    description="AI-генератор тест-кейсов для Jira Zephyr Scale",
    version="2.1.0",
)

# CORS — разрешаем только свой домен + localhost для разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://simpletest.pro",
        "https://www.simpletest.pro",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Открытые роутеры (без авторизации) ─────────────────────────────────────
app.include_router(auth.router)

# /healthz и /api/system/providers — публичные (для nginx health check и LLM статуса на login)
app.include_router(system.router)

# ─── Защищённые роутеры (require_auth) ──────────────────────────────────────
_auth_dep = [Depends(require_auth)]

app.include_router(generation.router, dependencies=_auth_dep)
app.include_router(etalons.router,    dependencies=_auth_dep)
app.include_router(bugs.router,       dependencies=_auth_dep)

# Раздача Next.js static build (если собран)
_FRONTEND_OUT = _ROOT / "frontend" / "out"
if _FRONTEND_OUT.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_OUT), html=True), name="static")
