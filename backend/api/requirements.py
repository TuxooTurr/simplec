"""
Библиотека требований — локальный список (см. db/requirements_store.py).

Используется как переключаемый источник при генерации тест-кейсов
(свободный ввод / выбор из списка) и как контекст при регистрации
дефекта (какие требования затрагивает дефект — чтобы ИИ точнее
описывал его, зная реальные поля БД, методы API и бизнес-правила).
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from db.requirements_store import RequirementsStore

router = APIRouter()


class AddRequirementBody(BaseModel):
    name: str = Field(..., min_length=1)
    feature: str = Field(default="")
    text: str = Field(..., min_length=1)


@router.get("/api/requirements")
def list_requirements(feature: str = Query(default="")) -> list[dict]:
    return RequirementsStore.list_requirements(feature)


@router.post("/api/requirements")
def add_requirement(body: AddRequirementBody) -> dict:
    return RequirementsStore.add_requirement(body.name, body.feature, body.text)


@router.delete("/api/requirements/{req_id}")
def delete_requirement(req_id: str) -> dict:
    if not RequirementsStore.delete_requirement(req_id):
        raise HTTPException(status_code=404, detail="Требование не найдено")
    return {"status": "deleted"}
