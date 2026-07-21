"""
Сравнение LLM-моделей на саммаризации транскрибаций.

Флоу: создать сессию (промпт + транскрибация) -> прогнать N раз одну модель
-> прогнать N раз другую модель (повторить сколько нужно) -> запросить
сравнительный отчёт по накопленным прогонам.
"""
import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.model_bench_store import ModelBenchStore

router = APIRouter()


class CreateSessionRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    transcript: str = Field(..., min_length=1)


@router.post("/api/model-bench/sessions")
def create_session(req: CreateSessionRequest) -> dict:
    return ModelBenchStore.create_session(req.prompt, req.transcript)


@router.get("/api/model-bench/sessions")
def list_sessions(limit: int = 50) -> list[dict]:
    return ModelBenchStore.list_sessions(limit)


@router.get("/api/model-bench/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    session = ModelBenchStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    return session


@router.delete("/api/model-bench/sessions/{session_id}")
def delete_session(session_id: str) -> dict:
    if not ModelBenchStore.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    return {"status": "deleted"}


class RunRequest(BaseModel):
    provider: str = Field(..., min_length=1)
    model: str = Field(default="")
    runs: int = Field(default=5, ge=1, le=10)


@router.post("/api/model-bench/sessions/{session_id}/run")
async def run_target(session_id: str, req: RunRequest) -> dict:
    session = ModelBenchStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")

    from agents.model_bench import run_model_batch
    try:
        results = await asyncio.to_thread(
            run_model_batch, req.provider, req.model, session["prompt"], session["transcript"], req.runs,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось запустить модель: {str(e)[:300]}")

    updated = ModelBenchStore.add_target_results(session_id, req.provider, req.model, results)
    return updated


class AnalyzeRequest(BaseModel):
    provider: str = Field(..., min_length=1)
    model: str = Field(default="")


@router.post("/api/model-bench/sessions/{session_id}/analyze")
async def analyze_session(session_id: str, req: AnalyzeRequest) -> dict:
    session = ModelBenchStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if not session.get("targets"):
        raise HTTPException(status_code=400, detail="Нет ни одного прогона — сначала запустите хотя бы одну модель")

    from agents.model_bench import analyze_report
    try:
        report = await asyncio.to_thread(
            analyze_report, req.provider, req.model, session["prompt"], session["transcript"], session["targets"],
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось получить отчёт: {str(e)[:300]}")

    return ModelBenchStore.set_report(session_id, report, req.provider, req.model)
