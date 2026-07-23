"""
Сравнение LLM-моделей на саммаризации транскрибаций.

Флоу: создать сессию (промпт + транскрибация) -> прогнать N раз одну модель
-> прогнать N раз другую модель (повторить сколько нужно) -> запросить
сравнительный отчёт по накопленным прогонам.
"""
import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from db.model_bench_store import ModelBenchStore
from db.model_bench_scenarios_store import ModelBenchScenariosStore

router = APIRouter()


class CreateSessionRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    transcript: str = Field(..., min_length=1)
    # Доп. рекомендации судье из выбранного при создании сценария — сохраняются
    # на сессии, чтобы (пере)анализ отчёта не требовал заново помнить/выбирать сценарий.
    judge_instructions: str = Field(default="")


@router.post("/api/model-bench/sessions")
def create_session(req: CreateSessionRequest) -> dict:
    return ModelBenchStore.create_session(req.prompt, req.transcript, req.judge_instructions)


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

    from agents.llm_client import LLMClient
    from agents.model_bench import run_model_batch
    try:
        results = await asyncio.to_thread(
            run_model_batch, req.provider, req.model, session["prompt"], session["transcript"], req.runs,
        )
    except Exception as e:
        _, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=400, detail=f"Не удалось запустить модель: {friendly}")

    updated = ModelBenchStore.add_target_results(session_id, req.provider, req.model, results)
    if not updated:
        raise HTTPException(status_code=404, detail="Сессия исчезла во время выполнения — начните заново")
    return updated


class AnalyzeRequest(BaseModel):
    # Судья — модель, выбранная пользователем для всей платформы (глобальный
    # провайдер из шапки), без выбора конкретной модели: chat() берёт дефолт
    # провайдера сам. Судья намеренно не выбирается в этой панели отдельно.
    provider: str = Field(..., min_length=1)


@router.post("/api/model-bench/sessions/{session_id}/analyze")
async def analyze_session(session_id: str, req: AnalyzeRequest) -> dict:
    session = ModelBenchStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if not session.get("targets"):
        raise HTTPException(status_code=400, detail="Нет ни одного прогона — сначала запустите хотя бы одну модель")

    from agents.llm_client import LLMClient
    from agents.model_bench import analyze_report
    try:
        report, best = await asyncio.to_thread(
            analyze_report, req.provider, session["prompt"], session["transcript"], session["targets"],
            session.get("judge_instructions", ""),
        )
    except Exception as e:
        _, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=400, detail=f"Не удалось получить отчёт: {friendly}")

    updated = ModelBenchStore.set_report(session_id, report, req.provider, best)
    if not updated:
        raise HTTPException(status_code=404, detail="Сессия исчезла во время выполнения — начните заново")
    return updated


@router.get("/api/model-bench/sessions/{session_id}/stats")
def get_session_stats(session_id: str) -> list[dict]:
    """Технические метрики по накопленным прогонам — доступны сразу после
    запуска моделей, без ожидания отчёта судьи (латентность/токены не требуют LLM)."""
    session = ModelBenchStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    from agents.model_bench import compute_stats
    return compute_stats(session.get("targets", []))


@router.get("/api/model-bench/sessions/{session_id}/report.pptx")
def get_session_pptx(session_id: str) -> Response:
    session = ModelBenchStore.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if not session.get("targets"):
        raise HTTPException(status_code=400, detail="Нет ни одного прогона — нечего экспортировать")

    from agents.model_bench_export import build_pptx
    try:
        data = build_pptx(session)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="model-bench-{session_id}.pptx"'},
    )


# ── Сценарии — сохранённые дефолты для промпта/транскрибации ──────────────────

class ScenarioBody(BaseModel):
    name: str = Field(..., min_length=1)
    prompt: str = Field(default="")
    transcript: str = Field(default="")
    judge_instructions: str = Field(default="")


@router.get("/api/model-bench/scenarios")
def list_scenarios() -> list[dict]:
    return ModelBenchScenariosStore.list_scenarios()


@router.post("/api/model-bench/scenarios")
def create_scenario(body: ScenarioBody) -> dict:
    return ModelBenchScenariosStore.add_scenario(body.name, body.prompt, body.transcript, body.judge_instructions)


@router.delete("/api/model-bench/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str) -> dict:
    if not ModelBenchScenariosStore.delete_scenario(scenario_id):
        raise HTTPException(status_code=404, detail="Сценарий не найден")
    return {"status": "deleted"}
