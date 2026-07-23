"""
Библиотека требований — локальный список (см. db/requirements_store.py).

Используется как переключаемый источник при генерации тест-кейсов
(свободный ввод / выбор из списка) и как контекст при регистрации
дефекта (какие требования затрагивает дефект — чтобы ИИ точнее
описывал его, зная реальные поля БД, методы API и бизнес-правила).

Также по требованию (POST /api/requirements/{id}/generate-doc) можно
переработать исходник в QA-документацию тем же генератором (Layer 1), что
используется при генерации тест-кейсов — исходник и результат хранятся
вместе в одной записи, без ChromaDB/эмбеддингов.
"""
import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from db.requirements_store import RequirementsStore

router = APIRouter()


class AddRequirementBody(BaseModel):
    name: str = Field(..., min_length=1)
    feature: str = Field(default="")
    text: str = Field(..., min_length=1)
    # Готовая QA-документация — например, из "Ручного тестирования", где Layer 1
    # уже посчитан генерацией кейсов; повторный вызов LLM тут не нужен.
    qa_doc: str = Field(default="")
    qa_doc_truncated: bool = Field(default=False)


@router.get("/api/requirements")
def list_requirements(feature: str = Query(default="")) -> list[dict]:
    return RequirementsStore.list_requirements(feature)


@router.post("/api/requirements")
def add_requirement(body: AddRequirementBody) -> dict:
    return RequirementsStore.add_requirement(body.name, body.feature, body.text, body.qa_doc, body.qa_doc_truncated)


@router.delete("/api/requirements/{req_id}")
def delete_requirement(req_id: str) -> dict:
    if not RequirementsStore.delete_requirement(req_id):
        raise HTTPException(status_code=404, detail="Требование не найдено")
    return {"status": "deleted"}


class GenerateDocBody(BaseModel):
    provider: str = Field(..., min_length=1)


@router.post("/api/requirements/{req_id}/generate-doc")
async def generate_requirement_doc(req_id: str, body: GenerateDocBody) -> dict:
    item = RequirementsStore.get_requirement(req_id)
    if not item:
        raise HTTPException(status_code=404, detail="Требование не найдено")

    from agents.llm_client import LLMClient
    from agents.layered_generator import LayeredGenerator

    try:
        llm = LLMClient(provider=body.provider)
        gen = LayeredGenerator(llm)
        qa_doc, truncated = await asyncio.to_thread(
            gen.generate_qa_doc, item["text"], item.get("feature", "")
        )
    except Exception as e:
        _, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=400, detail=f"Не удалось сгенерировать документацию: {friendly}")

    updated = RequirementsStore.update_requirement(req_id, qa_doc=qa_doc, qa_doc_truncated=truncated)
    if not updated:
        raise HTTPException(status_code=404, detail="Требование исчезло во время генерации — начните заново")
    return updated
