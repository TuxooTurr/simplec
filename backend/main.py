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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.api import generation, etalons, bugs, system

app = FastAPI(
    title="SimpleTest API",
    description="AI-генератор тест-кейсов для Jira Zephyr Scale",
    version="2.0.0",
)

# CORS — в проде ограничить до simpletest.pro
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Роутеры
app.include_router(system.router)
app.include_router(generation.router)
app.include_router(etalons.router)
app.include_router(bugs.router)

# Раздача Next.js static build (если собран)
_FRONTEND_OUT = _ROOT / "frontend" / "out"
if _FRONTEND_OUT.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_OUT), html=True), name="static")
