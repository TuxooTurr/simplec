"""
CRUD эндпоинты для эталонных пар требование→тест-кейс (ChromaDB).
"""
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.schemas import EtalonAddRequest

router = APIRouter()


def _get_store():
    from db.vector_store import VectorStore
    return VectorStore()


@router.get("/api/etalons")
def list_etalons(platform: str = "", feature: str = "", limit: int = 50, offset: int = 0):
    """Список всех эталонных пар с опциональной фильтрацией."""
    store = _get_store()
    try:
        where = {}
        if platform:
            where["platform"] = platform
        if feature:
            where["feature"] = feature

        kwargs = {"limit": limit, "offset": offset}
        if where:
            kwargs["where"] = where

        result = store.pairs.get(**kwargs)

        items = []
        ids = result.get("ids", [])
        docs = result.get("documents", [])
        metas = result.get("metadatas", []) or [{}] * len(ids)

        for i, pair_id in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            items.append({
                "id": pair_id,
                "req_text": docs[i] if i < len(docs) else "",
                "tc_text": meta.get("test_case_xml", ""),
                "platform": meta.get("platform", ""),
                "feature": meta.get("feature", ""),
            })
        return {"items": items, "total": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/etalons/stats")
def etalon_stats():
    store = _get_store()
    return store.get_stats()


@router.post("/api/etalons")
async def add_etalon(
    req_text: str = Form(""),
    tc_text: str = Form(""),
    platform: str = Form(""),
    feature: str = Form(""),
    req_file: Optional[UploadFile] = File(None),
    tc_file: Optional[UploadFile] = File(None),
):
    """Добавить эталонную пару. Принимает текст или файл для каждой части."""
    from agents.file_parser import parse_file

    if req_file:
        data = await req_file.read()
        req_text = parse_file(data, req_file.filename)

    if tc_file:
        data = await tc_file.read()
        tc_text = parse_file(data, tc_file.filename)

    if not req_text or not tc_text:
        raise HTTPException(status_code=400, detail="req_text и tc_text обязательны")

    pair_id = str(uuid.uuid4())
    store = _get_store()
    try:
        store.add_pair(
            pair_id=pair_id,
            requirement_text=req_text,
            test_case_xml=tc_text,
            platform=platform,
            feature=feature,
        )
        return {"id": pair_id, "status": "added"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/etalons/{pair_id}")
def delete_etalon(pair_id: str):
    store = _get_store()
    try:
        store.pairs.delete(ids=[pair_id])
        return {"status": "deleted", "id": pair_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
