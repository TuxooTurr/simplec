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

В разделе «Данные» требования — документы в дереве папок (как страницы в Notion): папки вложенные,
документ можно переименовать, перенести, поправить исходник (PATCH).
"""
import asyncio
from typing import Optional

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
    folder_id: str = Field(default="")


@router.get("/api/requirements")
def list_requirements(feature: str = Query(default="")) -> list[dict]:
    return RequirementsStore.list_requirements(feature)


@router.post("/api/requirements")
def add_requirement(body: AddRequirementBody) -> dict:
    if not RequirementsStore.folder_exists(body.folder_id):
        raise HTTPException(status_code=404, detail="Папки уже нет — обновите дерево")
    return RequirementsStore.add_requirement(body.name, body.feature, body.text, body.qa_doc, body.qa_doc_truncated,
                                             body.folder_id)


class FolderBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    parent_id: str = Field(default="")


class FolderPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    parent_id: Optional[str] = None


@router.get("/api/requirements/folders")
def list_folders() -> list[dict]:
    return RequirementsStore.list_folders()


@router.post("/api/requirements/folders")
def add_folder(body: FolderBody) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Название папки пустое")
    try:
        return RequirementsStore.add_folder(body.name, body.parent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Родительской папки уже нет — обновите дерево")


@router.patch("/api/requirements/folders/{folder_id}")
def update_folder(folder_id: str, body: FolderPatch) -> dict:
    if body.name is not None and not body.name.strip():
        raise HTTPException(status_code=422, detail="Название папки пустое")
    try:
        item = RequirementsStore.update_folder(folder_id, body.name, body.parent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Папки, куда переносите, уже нет — обновите дерево")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if item is None:
        raise HTTPException(status_code=404, detail="Папка не найдена")
    return item


@router.delete("/api/requirements/folders/{folder_id}")
def delete_folder(folder_id: str) -> dict:
    moved = RequirementsStore.delete_folder(folder_id)
    if moved is None:
        raise HTTPException(status_code=404, detail="Папка не найдена")
    return {"status": "deleted", "moved": moved}


class RequirementPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    feature: Optional[str] = None
    text: Optional[str] = Field(default=None, min_length=1)
    folder_id: Optional[str] = None


@router.patch("/api/requirements/{req_id}")
def update_requirement(req_id: str, body: RequirementPatch) -> dict:
    """Заголовок, фича, исходник, папка. Правка исходника не трогает QA-документ: его пересобирают кнопкой."""
    fields = body.model_dump(exclude_none=True)
    if "name" in fields:
        fields["name"] = fields["name"].strip()
        if not fields["name"]:
            raise HTTPException(status_code=422, detail="Заголовок пустой")
    if "feature" in fields:
        fields["feature"] = fields["feature"].strip()
    if "folder_id" in fields and not RequirementsStore.folder_exists(fields["folder_id"]):
        raise HTTPException(status_code=404, detail="Папки уже нет — обновите дерево")
    if not fields:
        raise HTTPException(status_code=422, detail="Нечего менять")
    item = RequirementsStore.update_requirement(req_id, **fields)
    if not item:
        raise HTTPException(status_code=404, detail="Требование не найдено")
    return item


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
            gen.generate_qa_doc, item["text"], item.get("feature", ""), "", True
        )
    except Exception as e:
        _, friendly = LLMClient.classify_error(e)
        raise HTTPException(status_code=400, detail=f"Не удалось сгенерировать документацию: {friendly}")

    updated = RequirementsStore.update_requirement(req_id, qa_doc=qa_doc, qa_doc_truncated=truncated)
    if not updated:
        raise HTTPException(status_code=404, detail="Требование исчезло во время генерации — начните заново")
    return updated
